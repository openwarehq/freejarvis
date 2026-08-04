"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The output half of the voice.
 *
 * Sentences are queued rather than spoken as one block, so it starts talking
 * on the first full sentence instead of after the last one — and the next
 * clip is fetched while the current one plays, so the queue never starves
 * between them.
 *
 * With an ElevenLabs key the audio is real, which means an AnalyserNode can
 * read it and the orb is driven by the actual waveform. Without one this falls
 * back to the browser's `speechSynthesis`, which exposes no waveform at all —
 * there the amplitude is inferred from word-boundary events, and it is an
 * approximation that the README says is an approximation.
 */

export type SpeechEngine = "elevenlabs" | "browser";

export type SpeechApi = {
  engine: SpeechEngine;
  speaking: boolean;
  /**
   * The sentence currently coming out of the speaker.
   *
   * The text stream finishes well before the voice does — five sentences
   * arrive in six seconds and take ten to say — so a caption driven off the
   * stream shows the last line while the voice is still on the second. When
   * the deck is speaking, this is what the caption should follow.
   */
  current: string | null;
  /** 0–1. Real amplitude on ElevenLabs; inferred on the browser voice. */
  level: number;
  enqueue: (sentence: string) => void;
  /**
   * Queue something to happen *at this point in the speech*, rather than now.
   *
   * The only reliable clock for "when has it finished saying that line" is the
   * audio element that is playing the line. Estimating it server-side is off
   * by 15–27% on short sentences, which is either a hole in the audio or an
   * event that fires while the voice is still three lines back.
   */
  enqueueAction: (fn: () => void) => void;
  cancel: () => void;
  /** Speak one line immediately, jumping the queue. Used by Settings preview. */
  preview: (text: string, voiceId?: string) => void;
  ready: boolean;
};

type QueueItem = { kind: "say"; text: string } | { kind: "do"; fn: () => void };

export function useSpeech(enabled: boolean): SpeechApi {
  const [engine, setEngine] = useState<SpeechEngine>("browser");
  const [speaking, setSpeaking] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [ready, setReady] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef(0);

  const queue = useRef<QueueItem[]>([]);
  const prefetch = useRef<Map<string, Promise<string | null>>>(new Map());
  const playing = useRef(false);
  const cancelled = useRef(false);
  const browserLevel = useRef(0);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/api/voices", { cache: "no-store" });
        const j = (await r.json()) as { engine: SpeechEngine };
        setEngine(j.engine === "elevenlabs" ? "elevenlabs" : "browser");
      } catch {
        setEngine("browser");
      } finally {
        setReady(true);
      }
    })();
  }, []);

  /* ── the audio graph, built once ──────────────────────────────────────── */

  const graph = useCallback(() => {
    if (!audioRef.current) {
      const el = new Audio();
      el.preload = "auto";
      audioRef.current = el;
    }
    if (!ctxRef.current) {
      const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!Ctx) return null;
      const ctx = new Ctx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.7;
      // A MediaElementAudioSourceNode can only ever be created once per
      // element — a second call throws and takes the whole voice with it.
      const src = ctx.createMediaElementSource(audioRef.current);
      src.connect(analyser);
      analyser.connect(ctx.destination);
      ctxRef.current = ctx;
      analyserRef.current = analyser;
    }
    // Autoplay policy suspends a context created outside a gesture; every
    // call into here is downstream of the owner sending or pressing something.
    void ctxRef.current.resume().catch(() => {});
    return ctxRef.current;
  }, []);

  /**
   * Build and unlock the audio graph on the very first interaction.
   *
   * Autoplay policy suspends a context created outside a user gesture, and by
   * the time a clip has been fetched the gesture that started the turn may no
   * longer count. Creating and resuming the context on the first keydown or
   * pointerdown — any one, anywhere — means the first reply is never the one
   * that comes out silent.
   */
  useEffect(() => {
    const unlock = () => {
      graph();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [graph]);

  const meter = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    const analyser = analyserRef.current;
    if (!analyser) return;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      setLevel(Math.min(1, Math.pow(rms * 3.4, 0.8)));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  /* ── fetching a clip ──────────────────────────────────────────────────── */

  const fetchClip = useCallback((text: string, voiceId?: string): Promise<string | null> => {
    const existing = prefetch.current.get(text);
    if (existing) return existing;
    const p = (async () => {
      try {
        const res = await fetch("/api/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(voiceId ? { text, voiceId } : { text }),
        });
        if (res.status === 409) {
          setEngine("browser");
          return null;
        }
        if (!res.ok) return null;
        return URL.createObjectURL(await res.blob());
      } catch {
        return null;
      }
    })();
    prefetch.current.set(text, p);
    return p;
  }, []);

  /* ── the browser fallback ─────────────────────────────────────────────── */

  const speakBrowser = useCallback(
    (text: string) =>
      new Promise<void>((resolve) => {
        if (!("speechSynthesis" in window)) return resolve();
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 1.03;
        u.pitch = 0.95;
        const animate = () => {
          browserLevel.current *= 0.9;
          setLevel(browserLevel.current);
          rafRef.current = requestAnimationFrame(animate);
        };
        u.onstart = () => {
          browserLevel.current = 0.55;
          cancelAnimationFrame(rafRef.current);
          rafRef.current = requestAnimationFrame(animate);
        };
        u.onboundary = () => {
          browserLevel.current = 0.45 + Math.random() * 0.45;
        };
        const done = () => {
          cancelAnimationFrame(rafRef.current);
          setLevel(0);
          resolve();
        };
        u.onend = done;
        u.onerror = done;
        window.speechSynthesis.speak(u);
      }),
    [],
  );

  /* ── the queue ────────────────────────────────────────────────────────── */

  const pump = useCallback(async () => {
    if (playing.current) return;
    playing.current = true;
    setSpeaking(true);

    while (queue.current.length && !cancelled.current) {
      const item = queue.current.shift()!;

      if (item.kind === "do") {
        // Lands exactly between two clips, which is the whole point.
        item.fn();
        continue;
      }

      const text = item.text;
      setCurrent(text);
      // Start the next spoken line downloading while this one plays, looking
      // past any queued actions to find it.
      if (engine === "elevenlabs") {
        const next = queue.current.find((q) => q.kind === "say");
        if (next && next.kind === "say") void fetchClip(next.text);
      }

      if (engine === "elevenlabs") {
        const url = await fetchClip(text);
        prefetch.current.delete(text);
        if (cancelled.current) {
          if (url) URL.revokeObjectURL(url);
          break;
        }
        if (url) {
          graph();
          const el = audioRef.current!;
          meter();
          await new Promise<void>((resolve) => {
            const done = () => {
              el.onended = null;
              el.onerror = null;
              resolve();
            };
            el.onended = done;
            el.onerror = done;
            el.src = url;
            void el.play().catch(done);
          });
          cancelAnimationFrame(rafRef.current);
          setLevel(0);
          URL.revokeObjectURL(url);
          continue;
        }
        // The clip failed; say it with the browser rather than skipping it.
      }
      await speakBrowser(text);
    }

    playing.current = false;
    setSpeaking(false);
    setCurrent(null);
    setLevel(0);
  }, [engine, fetchClip, graph, meter, speakBrowser]);

  const enqueue = useCallback(
    (sentence: string) => {
      const text = sentence.trim();
      if (!text || !enabledRef.current) return;
      cancelled.current = false;
      queue.current.push({ kind: "say", text });
      // Start downloading the moment the sentence is complete, not when the
      // previous clip starts playing. Waiting costs a fetch's worth of silence
      // in front of the very first hand-off, every single take — measured at
      // 829ms before this line existed, and 17ms after it.
      if (engine === "elevenlabs") void fetchClip(text);
      void pump();
    },
    [engine, fetchClip, pump],
  );

  const enqueueAction = useCallback(
    (fn: () => void) => {
      // With the voice off there is nothing to wait for, so it happens now.
      if (!enabledRef.current) return fn();
      cancelled.current = false;
      queue.current.push({ kind: "do", fn });
      void pump();
    },
    [pump],
  );

  const cancel = useCallback(() => {
    cancelled.current = true;
    queue.current = [];
    for (const [, p] of prefetch.current) void p.then((u) => u && URL.revokeObjectURL(u));
    prefetch.current.clear();
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.removeAttribute("src");
    }
    window.speechSynthesis?.cancel();
    cancelAnimationFrame(rafRef.current);
    playing.current = false;
    setSpeaking(false);
    setCurrent(null);
    setLevel(0);
  }, []);

  const preview = useCallback(
    (text: string, voiceId?: string) => {
      cancel();
      cancelled.current = false;
      void (async () => {
        if (engine === "elevenlabs") {
          const url = await fetchClip(text, voiceId);
          prefetch.current.delete(text);
          if (url) {
            graph();
            const el = audioRef.current!;
            meter();
            setSpeaking(true);
            el.onended = () => {
              cancelAnimationFrame(rafRef.current);
              setLevel(0);
              setSpeaking(false);
              URL.revokeObjectURL(url);
            };
            el.src = url;
            void el.play().catch(() => {});
            return;
          }
        }
        setSpeaking(true);
        await speakBrowser(text);
        setSpeaking(false);
      })();
    },
    [cancel, engine, fetchClip, graph, meter, speakBrowser],
  );

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      window.speechSynthesis?.cancel();
      audioRef.current?.pause();
      void ctxRef.current?.close().catch(() => {});
    },
    [],
  );

  return { engine, speaking, current, level, enqueue, enqueueAction, cancel, preview, ready };
}
