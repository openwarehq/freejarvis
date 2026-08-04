"use client";

import { useEffect, useState } from "react";

/**
 * The only thing demo mode puts on screen by default, and it takes itself off
 * again after five seconds so it is never in the shot.
 *
 * Without it the deck in demo mode looks identical to the deck not in demo
 * mode, and the chord is the sort of thing you forget between takes.
 */
export default function DemoHint() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 5000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className="pointer-events-none absolute bottom-4 left-4 z-40 transition-opacity duration-700"
      style={{ opacity: visible ? 1 : 0 }}
      aria-hidden={!visible}
    >
      <div className="glass rounded-[4px] px-3 py-2">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="h-[5px] w-[5px] rounded-full" style={{ background: "hsl(38 95% 60%)" }} />
          <span className="label" style={{ color: "hsl(38 95% 66%)", fontSize: 8.5 }}>
            DEMO MODE · SCRIPTED
          </span>
        </div>
        {[
          ["⌘⌥⇧A", "take"],
          ["⌘⌥⇧R", "reset"],
          ["⌘⌥⇧D", "controls"],
        ].map(([chord, what]) => (
          <div key={chord} className="flex items-baseline gap-2">
            <span className="data text-[10px] text-[var(--text)]">{chord}</span>
            <span className="label" style={{ fontSize: 8.5 }}>
              {what}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
