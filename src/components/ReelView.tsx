"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The reel browser, on the deck.
 *
 * Instagram refuses to be put in an iframe — `X-Frame-Options: DENY` — so this
 * is not an embed. It is a live view: the browser is driven somewhere else and
 * every repaint arrives here as a JPEG over SSE. Which turns out to be the
 * better arrangement anyway, because the window can be behind anything, on
 * another desktop, minimised, and the work still shows up beside the orb.
 *
 * Frames are written to an <img> through an object URL rather than a data URI.
 * A data URI re-parses a quarter-megabyte base64 string on every repaint, which
 * at ten frames a second is the whole frame budget; a blob is decoded once and
 * the old one is revoked, which is the difference between smooth and a
 * slideshow that heats the room.
 */
export default function ReelView({ onClose }: { onClose: () => void }) {
  const img = useRef<HTMLImageElement>(null);
  const url = useRef<string | null>(null);
  const [live, setLive] = useState(false);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const es = new EventSource("/api/reel");

    es.onmessage = (ev) => {
      let msg: { t: string; data?: string; live?: boolean };
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (typeof msg.live === "boolean") setLive(msg.live);
      if (msg.t !== "reel.frame" || !msg.data || !img.current) return;

      const bin = atob(msg.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const next = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
      const previous = url.current;
      url.current = next;
      img.current.src = next;
      // Revoked after the swap, not before — revoking the URL the <img> is
      // still decoding blanks the frame.
      if (previous) setTimeout(() => URL.revokeObjectURL(previous), 120);
      setSeen(true);
    };

    return () => {
      es.close();
      if (url.current) URL.revokeObjectURL(url.current);
    };
  }, []);

  return (
    <div className="pointer-events-auto overflow-hidden rounded-xl border border-white/10 bg-black/80 shadow-2xl backdrop-blur">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <span
          className={`h-[6px] w-[6px] rounded-full ${live ? "animate-pulse bg-emerald-400" : "bg-white/25"}`}
        />
        <span className="text-[10px] tracking-[0.18em] text-white/45 uppercase">
          instagram · {live ? "live" : "idle"}
        </span>
        <button
          onClick={onClose}
          className="ml-auto text-[10px] tracking-[0.14em] text-white/35 uppercase hover:text-white/80"
        >
          Close
        </button>
      </div>

      <div className="relative aspect-[16/10] w-full bg-black">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={img} alt="" className="h-full w-full object-contain" />
        {!seen && (
          <div className="absolute inset-0 grid place-items-center text-[11px] tracking-[0.14em] text-white/30 uppercase">
            waiting for the browser
          </div>
        )}
      </div>
    </div>
  );
}
