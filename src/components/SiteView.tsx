"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";

/**
 * A site, pulled up on the deck.
 *
 * The agent calls `open_site` and this takes the screen. It is a real frame
 * around a real document served from `/api/sites/<name>` — the reveal is
 * timed, but there is nothing behind it except the file on your disk.
 */
export default function SiteView({
  name,
  full,
  onToggleFull,
  onClose,
}: {
  name: string;
  /** Windowed by default so the orb stays on screen beside it. */
  full: boolean;
  onToggleFull: () => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<"opening" | "open">("opening");
  const [title, setTitle] = useState("");
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    setPhase("opening");
    setTitle("");
    const t = setTimeout(() => setPhase("open"), 620);
    return () => clearTimeout(t);
  }, [name]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    // Below the chat dock, so the deck stays usable while a site is up —
    // asking for the next thing without closing this one is the point.
    //
    // Windowed, it sits in the top-right corner: clear of the telemetry strip
    // above, clear of the chat dock below, and clear of the orb, which stays
    // full size in the middle of the screen where you can still watch it.
    // Full, it takes the frame and the top inset clears the telemetry strip
    // rather than sliding under it.
    <div
      className={
        full
          ? "pointer-events-auto absolute inset-0 z-20 flex flex-col p-4 pb-5 lg:pt-12 xl:pr-[452px]"
          : "pointer-events-auto absolute right-4 top-4 z-20 flex h-[min(340px,42vh)] w-[min(460px,44vw)] flex-col"
      }
    >
      <div
        className="glass flex min-h-0 flex-1 flex-col overflow-hidden rounded-[6px] shadow-[0_40px_120px_-30px_rgba(0,0,0,1)]"
        style={{
          borderColor: "var(--accent-dim)",
          opacity: phase === "opening" ? 0 : 1,
          transform: phase === "opening" ? "scale(0.965) translateY(10px)" : "none",
          transition: "opacity 520ms cubic-bezier(.2,.8,.2,1), transform 520ms cubic-bezier(.2,.8,.2,1)",
        }}
      >
        {/* chrome */}
        <div className="flex shrink-0 items-center gap-3 border-b border-[var(--line)] bg-black/50 px-3 py-2">
          <div className="flex shrink-0 gap-1.5">
            {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
              <span
                key={c}
                className="h-[9px] w-[9px] rounded-full opacity-70"
                style={{ background: c }}
              />
            ))}
          </div>

          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[3px] border border-[var(--line)] bg-black/50 px-2.5 py-1">
            <Icon name="deck" size={10} className="shrink-0 text-[var(--accent)]" />
            <span className="data truncate text-[10px] text-[var(--dim)]">
              localhost:4333/api/sites/{name}
            </span>
          </div>

          {title && full && (
            <span className="label hidden shrink-0 truncate md:block" style={{ maxWidth: 280 }}>
              {title}
            </span>
          )}

          <button
            onClick={onToggleFull}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-[3px] text-[var(--faint)] transition-colors hover:bg-white/10 hover:text-[var(--text)]"
            aria-label={full ? "Shrink site" : "Expand site"}
            title={full ? "Shrink" : "Expand"}
          >
            <Icon name="expand" size={12} />
          </button>

          <button
            onClick={onClose}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-[3px] text-[var(--faint)] transition-colors hover:bg-white/10 hover:text-[var(--text)]"
            aria-label="Close site"
            title="Close · Esc"
          >
            <Icon name="close" size={13} />
          </button>
        </div>

        {/* the document */}
        <div className="relative min-h-0 flex-1 bg-black">
          <iframe
            ref={frame}
            src={`/api/sites/${encodeURIComponent(name)}`}
            title={name}
            className="h-full w-full border-0"
            // Somebody else's markup. Scripts and styles yes, because a real
            // page needs them; top-level navigation and form submission no.
            sandbox="allow-scripts allow-same-origin allow-popups"
            onLoad={() => {
              try {
                const t = frame.current?.contentDocument?.title;
                if (t) setTitle(t);
              } catch {
                /* cross-origin, which this should never be */
              }
            }}
          />

          {/* one sweep across the frame as it lands */}
          {phase === "opening" && (
            <div
              className="pointer-events-none absolute inset-0 overflow-hidden"
              aria-hidden="true"
            >
              <div
                className="absolute inset-y-0 w-1/3"
                style={{
                  background:
                    "linear-gradient(90deg, transparent, hsl(var(--h) var(--s) var(--l) / 0.22), transparent)",
                  animation: "fj-sweep 900ms cubic-bezier(.3,.7,.3,1) forwards",
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
