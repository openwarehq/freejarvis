"use client";

import { useEffect, useRef } from "react";
import type { DeckState } from "@/lib/events";

/**
 * The orb.
 *
 * A few thousand points on a Fibonacci sphere, displaced by a cheap sum-of-
 * sines field and projected with a little perspective. It is drawn on a 2D
 * canvas rather than in WebGL on purpose: no shader compilation to fail in a
 * container, no third dependency, and at this point count the difference is
 * not visible.
 *
 * Everything the orb does is a readout. Spin rate, displacement, colour and
 * the radial wave all come from the agent's actual state, so "it is thinking"
 * and "it is running a tool" are legible from the far side of a room without
 * reading a word.
 */

type Props = {
  state: DeckState;
  /** 0–1. Microphone amplitude while listening, speech amplitude while speaking. */
  level: number;
  /** Distant companions — one per other open session. */
  satellites: { hue: number }[];
  /** Nudged left when a panel sheet is open. */
  offsetX: number;
  /** Shrunk when a site has the screen. 1 is full size. */
  scale?: number;
};

const STATE: Record<DeckState, { hue: number; spin: number; amp: number; freq: number; density: number }> = {
  idle: { hue: 172, spin: 0.055, amp: 0.035, freq: 2.2, density: 1 },
  listening: { hue: 205, spin: 0.1, amp: 0.06, freq: 3.0, density: 1 },
  thinking: { hue: 268, spin: 0.42, amp: 0.14, freq: 5.2, density: 1 },
  speaking: { hue: 38, spin: 0.12, amp: 0.05, freq: 2.6, density: 1 },
  tool: { hue: 148, spin: 0.26, amp: 0.09, freq: 8.5, density: 1 },
  "awaiting-approval": { hue: 8, spin: 0.02, amp: 0.02, freq: 1.6, density: 1 },
};

const POINTS = 5200;
const SAT_POINTS = 460;
const BUCKETS = 14;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function fibonacciSphere(n: number): Float32Array {
  const pts = new Float32Array(n * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    pts[i * 3] = Math.cos(theta) * r;
    pts[i * 3 + 1] = y;
    pts[i * 3 + 2] = Math.sin(theta) * r;
  }
  return pts;
}

export default function Orb({ state, level, satellites, offsetX, scale = 1 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The render loop must not restart when a prop changes, or the sphere jumps.
  const live = useRef({ state, level, satellites, offsetX, scale });
  live.current = { state, level, satellites, offsetX, scale };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const main = fibonacciSphere(POINTS);
    const sat = fibonacciSphere(SAT_POINTS);

    // Preallocated draw buckets — grouping by alpha means fourteen fillStyle
    // assignments a frame instead of several thousand.
    const bx = Array.from({ length: BUCKETS }, () => new Float32Array(POINTS));
    const by = Array.from({ length: BUCKETS }, () => new Float32Array(POINTS));
    const bs = Array.from({ length: BUCKETS }, () => new Float32Array(POINTS));
    const bn = new Int32Array(BUCKETS);

    let dpr = 1;
    let w = 0;
    let h = 0;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Every animated quantity is eased toward its target rather than snapped,
    // so a state change reads as the orb changing its mind, not cutting.
    let hue = STATE.idle.hue;
    let amp = STATE.idle.amp;
    let freq = STATE.idle.freq;
    let spin = STATE.idle.spin;
    let lvl = 0;
    let ox = 0;
    let sc = 1;
    let yaw = 0;
    let t = 0;
    let raf = 0;
    let last = performance.now();

    const ease = (cur: number, target: number, k: number, dt: number) =>
      cur + (target - cur) * (1 - Math.exp(-k * dt));

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      const cfg = STATE[live.current.state] ?? STATE.idle;
      // Hue takes the short way around the wheel.
      let dh = cfg.hue - hue;
      if (dh > 180) dh -= 360;
      if (dh < -180) dh += 360;
      hue = (hue + dh * (1 - Math.exp(-3 * dt)) + 360) % 360;
      amp = ease(amp, cfg.amp, 3, dt);
      freq = ease(freq, cfg.freq, 3, dt);
      spin = ease(spin, cfg.spin, 2.5, dt);
      lvl = ease(lvl, Math.max(0, Math.min(1, live.current.level)), 12, dt);
      ox = ease(ox, live.current.offsetX, 4, dt);
      sc = ease(sc, live.current.scale, 4, dt);

      if (!reduced) {
        t += dt;
        yaw += spin * dt;
      }

      const cx = w / 2 + ox;
      const cy = h / 2;
      const R = Math.min(w, h) * 0.235 * sc;

      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);

      drawSatellites(ctx, sat, live.current.satellites, w, h, R, yaw, t, ox);

      // A soft bloom under the points. Cheap, and it is what stops the sphere
      // reading as a flat sprite sheet.
      const glowR = R * (2.0 + lvl * 0.45);
      const glow = ctx.createRadialGradient(cx, cy, R * 0.18, cx, cy, glowR);
      glow.addColorStop(0, `hsla(${hue}, 95%, 58%, ${0.22 + lvl * 0.22})`);
      glow.addColorStop(0.45, `hsla(${hue}, 95%, 50%, 0.07)`);
      glow.addColorStop(1, "hsla(0, 0%, 0%, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(cx - glowR, cy - glowR, glowR * 2, glowR * 2);

      drawReticle(ctx, cx, cy, R, hue, t, live.current.state);

      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);
      const pitch = -0.28 + Math.sin(t * 0.13) * 0.06;
      const cosP = Math.cos(pitch);
      const sinP = Math.sin(pitch);

      bn.fill(0);

      for (let i = 0; i < POINTS; i++) {
        const px = main[i * 3];
        const py = main[i * 3 + 1];
        const pz = main[i * 3 + 2];

        // Sum-of-sines standing in for noise: smooth, seamless on a sphere at
        // these frequencies, and about a tenth the cost of real 3D noise.
        const n =
          Math.sin(px * freq + t * 1.15) *
          Math.sin(py * freq - t * 0.92) *
          Math.sin(pz * freq + t * 0.71);

        // While speaking, a wave rolls pole to pole at the voice's amplitude.
        const wave = lvl > 0.01 ? Math.sin(py * 7.5 - t * 6.5) * lvl * 0.2 : 0;
        const r = 1 + n * amp + wave;

        const x1 = px * cosY + pz * sinY;
        const z1 = pz * cosY - px * sinY;
        const y2 = py * cosP - z1 * sinP;
        const z2 = py * sinP + z1 * cosP;

        const persp = 3 / (3 - z2 * 0.92);
        const sx = cx + x1 * r * persp * R;
        const sy = cy + y2 * r * persp * R;
        if (sx < -8 || sx > w + 8 || sy < -8 || sy > h + 8) continue;

        const depth = (z2 + 1) * 0.5;
        const b = Math.min(BUCKETS - 1, (Math.pow(depth, 1.45) * (BUCKETS - 0.001)) | 0);
        const k = bn[b]++;
        // Snapped to the pixel grid, and this is not a detail. A point drawn
        // at a fractional coordinate is antialiased across three pixels at a
        // third of the intensity each, so the whole sphere renders as a haze
        // no matter what alpha you hand it.
        bx[b][k] = sx | 0;
        by[b][k] = sy | 0;
        bs[b][k] = persp > 1.18 ? 2 : 1;
      }

      ctx.globalCompositeOperation = "lighter";
      for (let b = 0; b < BUCKETS; b++) {
        const count = bn[b];
        if (!count) continue;
        const f = b / (BUCKETS - 1);
        const a = 0.09 + f * 0.91;
        const light = 56 + f * 26;
        ctx.fillStyle = `hsla(${hue}, 96%, ${light}%, ${a})`;
        const xs = bx[b];
        const ys = by[b];
        const ss = bs[b];
        for (let k = 0; k < count; k++) {
          const s = ss[k];
          ctx.fillRect(xs[k], ys[k], s, s);
        }
      }
      ctx.globalCompositeOperation = "source-over";

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 h-full w-full"
      aria-hidden="true"
    />
  );
}

/**
 * The reticle: an arc dial around the sphere. It is chrome, but it is chrome
 * that tells you the thing is live — the sweep only moves while the agent is
 * working.
 */
function drawReticle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  R: number,
  hue: number,
  t: number,
  state: DeckState,
) {
  const outer = R * 1.38;
  ctx.save();
  ctx.translate(cx, cy);

  ctx.strokeStyle = `hsla(${hue}, 80%, 60%, 0.16)`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, outer, 0, Math.PI * 2);
  ctx.stroke();

  // Ticks. Every sixth is long, which is what makes it read as an instrument
  // rather than as a circle.
  ctx.strokeStyle = `hsla(${hue}, 80%, 62%, 0.26)`;
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const long = i % 6 === 0;
    const r0 = outer + 4;
    const r1 = outer + (long ? 12 : 6);
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
    ctx.stroke();
  }

  const busy = state === "thinking" || state === "tool" || state === "listening";
  if (busy) {
    const sweep = (t * (state === "thinking" ? 1.5 : 0.8)) % (Math.PI * 2);
    ctx.strokeStyle = `hsla(${hue}, 92%, 66%, 0.6)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, outer, sweep, sweep + 0.55);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, outer, sweep + Math.PI, sweep + Math.PI + 0.28);
    ctx.stroke();
  }

  if (state === "awaiting-approval") {
    // A hard stop, not a spinner. The agent is not working — it is waiting.
    ctx.strokeStyle = `hsla(${hue}, 92%, 62%, ${0.35 + Math.sin(t * 4) * 0.25})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 9]);
    ctx.beginPath();
    ctx.arc(0, 0, outer + 18, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
}

/** Other open sessions, hanging in the distance. */
function drawSatellites(
  ctx: CanvasRenderingContext2D,
  pts: Float32Array,
  sats: { hue: number }[],
  w: number,
  h: number,
  R: number,
  yaw: number,
  t: number,
  ox: number,
) {
  if (!sats.length) return;
  const n = pts.length / 3;
  ctx.globalCompositeOperation = "lighter";

  const count = Math.min(sats.length, 4);
  for (let s = 0; s < count; s++) {
    // Deterministic placement — a satellite should be where you last saw it —
    // and kept inside the frame, because half a sphere clipped by the window
    // edge reads as a rendering bug rather than as distance.
    // Biased away from the bottom-right quadrant, where the chat dock lives —
    // a satellite behind a panel is just texture on the glass.
    const a = (s / count) * Math.PI * 1.15 + Math.PI * 0.62;
    const r = R * (0.13 + ((s * 3) % 3) * 0.018);
    const margin = r + 30;
    const cx = clamp(w / 2 + ox + Math.cos(a) * w * 0.35, margin, w - margin);
    const cy = clamp(h / 2 + Math.sin(a) * h * 0.34, margin, h - margin);
    const hue = sats[s].hue;
    const drift = Math.sin(t * 0.2 + s) * 3;
    const sy = yaw * 0.4 + s;
    const cosY = Math.cos(sy);
    const sinY = Math.sin(sy);

    ctx.fillStyle = `hsla(${hue}, 90%, 62%, 0.2)`;
    for (let i = 0; i < n; i++) {
      const px = pts[i * 3];
      const py = pts[i * 3 + 1];
      const pz = pts[i * 3 + 2];
      const x1 = px * cosY + pz * sinY;
      const z1 = pz * cosY - px * sinY;
      if (z1 < 0) continue;
      ctx.fillRect((cx + x1 * r) | 0, (cy + py * r + drift) | 0, 1, 1);
    }
  }
  ctx.globalCompositeOperation = "source-over";
}
