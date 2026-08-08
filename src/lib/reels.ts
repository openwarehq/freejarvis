/**
 * The reel folder.
 *
 * You put a video in it. One keystroke sends the oldest one that has not gone
 * yet — measured, captioned, and carried through Instagram's uploader by
 * `uploader.ts`, which stops with Share unpressed.
 *
 * Nothing here speaks and nothing here asks. That is the point: the deck is
 * built around talking to it, and this is the one thing you want done without
 * saying a word.
 *
 * Three properties the folder has to have before any of it is safe:
 *
 * - **A file still being written is not ready.** An AirDrop, an export from an
 *   editor or a download lands as a growing file, and picking one up halfway
 *   gives a corrupt upload with no error anywhere.
 * - **What has flown is remembered by content, not by path**, so filing a clip
 *   into an archive after posting it does not make it look new again.
 * - **Cancelling leaves the clip at the front of the queue.** Only a real post
 *   is recorded, which is what you want when you cancelled on purpose.
 *
 * And one the caption has to have: it never claims to know what is *in* the
 * video unless something actually looked at it. With a key, four stills go to
 * a model. Without one the caption is built from the measurements and says only
 * those — the length, the cuts, the shape, the hour it was shot. A caption that
 * invents what is in a clip nothing has seen is worse than a caption that
 * counts.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { DATA_DIR } from "./config";

const run = promisify(execFile);

export type Probe = {
  file: string;
  name: string;
  bytes: number;
  seconds: number;
  width: number;
  height: number;
  fps: number;
  /** 9:16, 1:1, 16:9 … as the nearest thing Instagram would call it. */
  shape: "portrait" | "square" | "landscape";
  hasAudio: boolean;
  /** Cuts detected, or null when the scan could not run. */
  cuts: number | null;
  /** When the file was created, from the filesystem. */
  created: Date;
  codec: string;
};

export class ProbeError extends Error {}

const num = (v: unknown, fallback = 0) => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : fallback;
};

/** `30000/1001` → 29.97. ffprobe reports frame rates as fractions. */
function rate(fraction: unknown): number {
  if (typeof fraction !== "string") return 0;
  const [a, b] = fraction.split("/").map(Number);
  if (!b) return Number.isFinite(a) ? a : 0;
  return Math.round((a / b) * 100) / 100;
}

export async function probe(file: string): Promise<Probe> {
  const stat = await fs.promises.stat(file).catch(() => {
    throw new ProbeError(`no such file: ${file}`);
  });

  let json: {
    streams?: Array<Record<string, unknown>>;
    format?: Record<string, unknown>;
  };
  try {
    const { stdout } = await run(
      "ffprobe",
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file],
      { maxBuffer: 8 << 20 },
    );
    json = JSON.parse(stdout);
  } catch (e) {
    const msg = (e as { code?: string }).code === "ENOENT"
      ? "ffprobe is not on PATH — install ffmpeg (brew install ffmpeg)"
      : `ffprobe could not read ${path.basename(file)}: ${(e as Error).message}`;
    throw new ProbeError(msg);
  }

  const streams = json.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  if (!video) throw new ProbeError(`${path.basename(file)} has no video track`);

  let width = num(video.width);
  let height = num(video.height);
  // A phone clip is usually stored landscape with a rotation tag. Ignoring it
  // reports a vertical video as 16:9, and then everything downstream is wrong.
  const rotation = Math.abs(num(video.rotation ?? readRotation(video)));
  if (rotation === 90 || rotation === 270) [width, height] = [height, width];

  const ratio = width / Math.max(1, height);
  const shape = ratio < 0.95 ? "portrait" : ratio > 1.05 ? "landscape" : "square";

  return {
    file,
    name: path.basename(file),
    bytes: stat.size,
    seconds: Math.round(num(json.format?.duration) * 100) / 100,
    width,
    height,
    fps: rate(video.avg_frame_rate) || rate(video.r_frame_rate),
    shape,
    hasAudio: streams.some((s) => s.codec_type === "audio"),
    cuts: await countCuts(file).catch(() => null),
    created: stat.birthtime ?? stat.mtime,
    codec: String(video.codec_name ?? "unknown"),
  };
}

/** Rotation lives in a side-data list on newer ffprobe builds. */
function readRotation(video: Record<string, unknown>): number {
  const side = video.side_data_list;
  if (!Array.isArray(side)) return 0;
  for (const entry of side) {
    if (entry && typeof entry === "object" && "rotation" in entry) {
      return num((entry as Record<string, unknown>).rotation);
    }
  }
  return 0;
}

/**
 * How many times the picture changes completely.
 *
 * The threshold is the whole game: too low and every camera shake is a cut, too
 * high and only hard fades register. 0.4 is the value that matches what a
 * person would count on hand-held phone footage.
 */
export async function countCuts(file: string): Promise<number> {
  const { stderr } = await run(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-i", file, "-filter:v", "select='gt(scene,0.4)',showinfo", "-f", "null", "-"],
    { maxBuffer: 32 << 20 },
  );
  return (stderr.match(/pts_time:/g) ?? []).length;
}

export type Frames = { dir: string; files: string[] };

/**
 * Pulls `count` stills, evenly spread, avoiding the very first and last frame.
 *
 * The first frame of a phone video is often the lens still adjusting and the
 * last is often a hand reaching for the button; neither says anything about the
 * clip.
 */
export async function frames(p: Probe, count = 4): Promise<Frames> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "hangar-"));
  const files: string[] = [];
  const span = Math.max(p.seconds, 0.5);

  for (let i = 0; i < count; i++) {
    const at = (span * (i + 1)) / (count + 1);
    const out = path.join(dir, `frame-${i + 1}.jpg`);
    try {
      await run("ffmpeg", [
        "-hide_banner", "-loglevel", "error",
        "-ss", at.toFixed(2), "-i", p.file,
        "-frames:v", "1", "-q:v", "4",
        // Small enough to hand to a model, large enough to see what it is.
        "-vf", "scale='min(768,iw)':-2",
        "-y", out,
      ]);
      if (fs.existsSync(out)) files.push(out);
    } catch {
      // One missing still is not worth failing a post over.
    }
  }
  return { dir, files };
}

/** Human file size, for the log. */
export function size(bytes: number): string {
  if (bytes > 1 << 30) return `${(bytes / (1 << 30)).toFixed(1)}GB`;
  if (bytes > 1 << 20) return `${Math.round(bytes / (1 << 20))}MB`;
  return `${Math.round(bytes / 1024)}KB`;
}

/** `9.4` → `0:09`. */
export function clock(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}


export const VIDEO = new Set([".mp4", ".mov", ".m4v", ".webm"]);

export const REELS_HOME = process.env.REELS_HOME || path.resolve(DATA_DIR, "reels");
export const DROP = process.env.REELS_DIR || path.join(os.homedir(), "Movies", "Freejarvis");

const LOG = () => path.join(REELS_HOME, "flown.json");

export type Flight = {
  /** Content fingerprint — size plus the first and last 64KB. */
  id: string;
  name: string;
  at: number;
  caption: string;
  posted: boolean;
};

export function ensureDirs(): void {
  fs.mkdirSync(REELS_HOME, { recursive: true });
  fs.mkdirSync(DROP, { recursive: true });
}

/**
 * A cheap content fingerprint.
 *
 * Hashing a 600MB video to decide whether it has been posted is a second of
 * disk for no benefit. Size plus both ends collides only for files that are
 * genuinely near-identical, which for this purpose is the same file.
 */
export function fingerprint(file: string): string {
  const { size } = fs.statSync(file);
  const chunk = Math.min(64 * 1024, size);
  const fd = fs.openSync(file, "r");
  try {
    const head = Buffer.alloc(chunk);
    const tail = Buffer.alloc(chunk);
    fs.readSync(fd, head, 0, chunk, 0);
    fs.readSync(fd, tail, 0, chunk, Math.max(0, size - chunk));
    return crypto
      .createHash("sha256")
      .update(String(size))
      .update(head)
      .update(tail)
      .digest("hex")
      .slice(0, 24);
  } finally {
    fs.closeSync(fd);
  }
}

export function flown(): Flight[] {
  try {
    return JSON.parse(fs.readFileSync(LOG(), "utf8")) as Flight[];
  } catch {
    return [];
  }
}

export function record(flight: Flight): void {
  ensureDirs();
  const all = flown().filter((f) => f.id !== flight.id);
  all.push(flight);
  fs.writeFileSync(LOG(), JSON.stringify(all, null, 1));
}

/** True once the file has stopped growing. */
export async function settled(file: string, waitMs = 900): Promise<boolean> {
  const a = fs.statSync(file).size;
  if (a === 0) return false;
  await new Promise((r) => setTimeout(r, waitMs));
  try {
    return fs.statSync(file).size === a;
  } catch {
    return false;
  }
}

export type Candidate = { file: string; name: string; bytes: number; created: number };

/** Everything in the drop folder that looks like a video, oldest first. */
export function candidates(dir = DROP): Candidate[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: Candidate[] = [];
  for (const name of names) {
    // Dotfiles, Finder metadata, and the half-written files download managers
    // leave behind while they work.
    if (name.startsWith(".") || /\.(download|part|crdownload|tmp)$/i.test(name)) continue;
    if (!VIDEO.has(path.extname(name).toLowerCase())) continue;
    const file = path.join(dir, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    out.push({ file, name, bytes: stat.size, created: (stat.birthtime ?? stat.mtime).getTime() });
  }
  return out.sort((a, b) => a.created - b.created);
}

export type Pick =
  | { ok: true; file: string; name: string; id: string }
  | { ok: false; why: string };

/**
 * The next video to send.
 *
 * Oldest first, so the folder behaves like a queue rather than a stack — you
 * drop three clips in on Sunday and they go out in the order you made them.
 */
export async function next(dir = DROP): Promise<Pick> {
  const all = candidates(dir);
  if (!all.length) {
    return { ok: false, why: `nothing to send — ${dir} has no video files in it` };
  }

  const gone = new Set(flown().map((f) => f.id));
  const waiting: string[] = [];

  for (const c of all) {
    const id = fingerprint(c.file);
    if (gone.has(id)) continue;
    if (!(await settled(c.file))) {
      waiting.push(c.name);
      continue;
    }
    return { ok: true, file: c.file, name: c.name, id };
  }

  if (waiting.length) {
    return { ok: false, why: `still being written: ${waiting.join(", ")}` };
  }
  return {
    ok: false,
    why: `all ${all.length} video${all.length === 1 ? "" : "s"} in ${dir} have already been sent`,
  };
}



export type Caption = {
  text: string;
  by: "claude" | "measured";
  model?: string;
  tokens?: number;
};

const RATES: Array<{ prefix: string; in: number; out: number }> = [
  { prefix: "claude-opus-", in: 15, out: 75 },
  { prefix: "claude-sonnet-", in: 3, out: 15 },
  { prefix: "claude-haiku-", in: 1, out: 5 },
];

export const CAPTION_MODEL = process.env.REELS_MODEL || "claude-sonnet-5";

export function hasKey(): boolean {
  return Boolean((process.env.ANTHROPIC_API_KEY ?? "").trim());
}

// ── the measured caption ────────────────────────────────────────────────────

/**
 * A filename turned back into words.
 *
 * `Screen Recording 2026-04-24 at 5.04.01 PM` is not a title and never was, so
 * it is thrown away rather than dressed up. `vexlb`, `hangar_demo_v2` and
 * `FinalCutExport` are the operator's own words and are kept.
 */
export function titleFrom(name: string): string | null {
  const stem = name.replace(/\.[^.]+$/, "");
  // Not \b: an underscore is a word character, so `\bimg\b` does not match
  // "IMG_4021" — which is the single most common name a phone produces.
  if (/^(screen[\s_-]?recording|img|mvi|dji|gopro|untitled|movie|video|clip)(?![a-z])/i.test(stem)) {
    return null;
  }
  if (/^\d[\d\s._-]*$/.test(stem)) return null;

  const words = stem
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s*\b(final|export|edit|render|v\d+|copy|\d{2,})\b\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return words.length > 1 ? words : null;
}

/** "just past four in the morning", from a real timestamp. */
function hourPhrase(d: Date): string {
  const h = d.getHours();
  if (h < 5) return "some time before dawn";
  if (h < 8) return "early";
  if (h < 12) return "in the morning";
  if (h < 14) return "around midday";
  if (h < 18) return "in the afternoon";
  if (h < 22) return "in the evening";
  return "late";
}

const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function measuredCaption(p: Probe): string {
  const title = titleFrom(p.name);
  const lines: string[] = [];

  lines.push(title ?? `${clock(p.seconds)} of ${p.shape} footage.`);

  // Only facts. Every clause below came out of ffprobe.
  const facts: string[] = [];
  facts.push(`${clock(p.seconds)}`);
  if (p.cuts !== null && p.cuts > 0) facts.push(`${p.cuts} cut${p.cuts === 1 ? "" : "s"}`);
  facts.push(`${p.width}×${p.height}`);
  if (p.fps >= 50) facts.push(`${Math.round(p.fps)}fps`);
  if (!p.hasAudio) facts.push("no sound");
  lines.push(facts.join(" · "));

  lines.push(`Shot on a ${DAY[p.created.getDay()]}, ${hourPhrase(p.created)}.`);

  return lines.join("\n\n");
}

// ── the caption Claude writes ───────────────────────────────────────────────

const SYSTEM = `You write Instagram captions for someone who does not want to write them.

You are shown stills from their video and told what was measured about it. Write the caption they would have written if they could be bothered: short, specific, and about what is actually on screen. One or two lines. Lowercase unless a proper noun needs otherwise. No emoji unless the video obviously calls for one, and never more than one.

Never invent a place, a person, a brand, a date, a price or an event. If the stills do not tell you where it is or what it is for, do not say. Being vague is fine; being wrong is not.

End with a blank line and between two and four hashtags that describe what is genuinely in the frame. No hashtag stacks, no #fyp, no #viral, no reach-bait.

Output only the caption. No preamble, no quotes around it, no explanation.`;

async function ask(p: Probe, files: string[]): Promise<Caption> {
  const key = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  const images = files.map((f) => ({
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: "image/jpeg" as const,
      data: fs.readFileSync(f).toString("base64"),
    },
  }));

  const measured = [
    `Length: ${clock(p.seconds)} (${p.seconds}s)`,
    `Frame: ${p.width}×${p.height}, ${p.shape}`,
    p.fps ? `Frame rate: ${Math.round(p.fps)}fps` : null,
    p.cuts !== null ? `Cuts detected: ${p.cuts}` : null,
    p.hasAudio ? "Has an audio track" : "Silent",
    `Filename: ${p.name}`,
  ].filter(Boolean).join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CAPTION_MODEL,
      max_tokens: 400,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            ...images,
            {
              type: "text",
              text: `These are ${files.length} stills taken evenly across the clip, in order.\n\nWhat was measured:\n${measured}\n\nWrite the caption.`,
            },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      res.status === 401 || res.status === 403
        ? `the API key was rejected (${res.status})`
        : `the caption request failed (${res.status}): ${body.slice(0, 160)}`,
    );
  }

  const json = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
    model?: string;
  };
  const text = (json.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();
  if (!text) throw new Error("the model returned an empty caption");

  return {
    text,
    by: "claude",
    model: json.model ?? CAPTION_MODEL,
    tokens: (json.usage?.input_tokens ?? 0) + (json.usage?.output_tokens ?? 0),
  };
}

export function price(model: string, inTok: number, outTok: number): number | null {
  const r = RATES.find((x) => model.startsWith(x.prefix));
  return r ? (inTok * r.in + outTok * r.out) / 1_000_000 : null;
}

/**
 * The caption, however it can be got.
 *
 * A failed model call falls back to the measured caption rather than stopping
 * the run. The video is the post; the caption is editable in the box before you
 * press anything.
 */
export async function caption(p: Probe, opts: { force?: "measured" } = {}): Promise<Caption> {
  if (opts.force === "measured" || !hasKey()) {
    return { text: measuredCaption(p), by: "measured" };
  }
  const shots = await frames(p, 4);
  try {
    if (!shots.files.length) return { text: measuredCaption(p), by: "measured" };
    return await ask(p, shots.files);
  } catch {
    return { text: measuredCaption(p), by: "measured" };
  } finally {
    await fs.promises.rm(shots.dir, { recursive: true, force: true }).catch(() => {});
  }
}
