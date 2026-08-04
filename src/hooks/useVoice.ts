"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Hearing. Speaking lives in `useSpeech`.
 *
 * Recognition is the browser's, so there is no transcription key and no cost
 * per minute — a Jarvis you pay by the word to talk *to* is the thing this
 * repo exists to delete.
 *
 * The honest catch, also stated in the README: Chrome and Edge send
 * recognition audio to Google's servers. Safari recognises on-device. Firefox
 * has none at all, so the deck falls back to typing.
 */

type Handlers = {
  onFinal: (text: string) => void;
  onInterim: (text: string) => void;
};

export type VoiceApi = {
  supported: { recognition: boolean };
  listening: boolean;
  /** 0–1 microphone amplitude while listening. Drives the orb. */
  level: number;
  interim: string;
  error: string | null;
  startListening: () => void;
  stopListening: () => void;
  toggleListening: () => void;
};

export function useVoice(handlers: Handlers): VoiceApi {
  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState({ recognition: false });

  const recRef = useRef<any>(null);
  const wantRef = useRef(false);
  const audioRef = useRef<{ ctx: AudioContext; stream: MediaStream; raf: number } | null>(null);
  const cb = useRef(handlers);
  cb.current = handlers;

  useEffect(() => {
    const Rec =
      (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null;
    setSupported({ recognition: !!Rec });
  }, []);

  /* ── microphone amplitude ───────────────────────────────────────────── */

  const startMeter = useCallback(async () => {
    if (audioRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new (window.AudioContext ?? (window as any).webkitAudioContext)();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.75;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        // RMS is small for speech; the curve below maps a normal voice into
        // the top half of the range so the orb actually moves.
        const rms = Math.sqrt(sum / buf.length);
        setLevel(Math.min(1, Math.pow(rms * 4.2, 0.75)));
        const state = audioRef.current;
        if (state) state.raf = requestAnimationFrame(tick);
      };
      audioRef.current = { ctx, stream, raf: 0 };
      audioRef.current.raf = requestAnimationFrame(tick);
    } catch {
      // No mic permission. Recognition may still work; the orb just stays calm.
    }
  }, []);

  const stopMeter = useCallback(() => {
    const state = audioRef.current;
    if (!state) return;
    cancelAnimationFrame(state.raf);
    state.stream.getTracks().forEach((t) => t.stop());
    void state.ctx.close().catch(() => {});
    audioRef.current = null;
    setLevel(0);
  }, []);

  /* ── recognition ────────────────────────────────────────────────────── */

  const startListening = useCallback(() => {
    const Rec =
      (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null;
    if (!Rec) {
      setError("This browser has no speech recognition. Chrome, Edge and Safari do; Firefox does not.");
      return;
    }
    if (recRef.current) return;

    const rec = new Rec();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";

    rec.onresult = (e: any) => {
      let final = "";
      let partial = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const chunk = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += chunk;
        else partial += chunk;
      }
      setInterim(partial);
      cb.current.onInterim(partial);
      if (final.trim()) {
        setInterim("");
        cb.current.onFinal(final.trim());
      }
    };

    rec.onerror = (e: any) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      setError(
        e.error === "not-allowed"
          ? "Microphone permission was denied. The deck still works by typing."
          : `Recognition error: ${e.error}`,
      );
      wantRef.current = false;
      setListening(false);
    };

    // Chrome ends a continuous session on its own every minute or so. Restart
    // it unless the owner actually asked to stop, otherwise hands-free mode
    // quietly dies after the first pause.
    rec.onend = () => {
      recRef.current = null;
      if (wantRef.current) {
        try {
          rec.start();
          recRef.current = rec;
        } catch {
          setListening(false);
          wantRef.current = false;
        }
      } else {
        setListening(false);
      }
    };

    try {
      rec.start();
      recRef.current = rec;
      wantRef.current = true;
      setListening(true);
      setError(null);
      void startMeter();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [startMeter]);

  const stopListening = useCallback(() => {
    wantRef.current = false;
    try {
      recRef.current?.stop();
    } catch {
      /* already stopped */
    }
    recRef.current = null;
    setListening(false);
    setInterim("");
    stopMeter();
  }, [stopMeter]);

  const toggleListening = useCallback(() => {
    if (wantRef.current) stopListening();
    else startListening();
  }, [startListening, stopListening]);

  useEffect(
    () => () => {
      try {
        recRef.current?.abort?.();
      } catch {
        /* teardown */
      }
      stopMeter();
    },
    [stopMeter],
  );

  return {
    supported,
    listening,
    level,
    interim,
    error,
    startListening,
    stopListening,
    toggleListening,
  };
}
