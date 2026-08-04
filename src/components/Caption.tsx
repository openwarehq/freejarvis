"use client";

import { useEffect, useState } from "react";

/**
 * The caption line.
 *
 * This is the piece that makes the deck usable from across a room, and the
 * reason the system prompt asks for short sentences. It shows one sentence at
 * a time, fading between them, and clears itself when nothing is happening
 * rather than leaving the last thing said hanging under the orb forever.
 */
export default function Caption({ text, interim }: { text: string; interim: string }) {
  const [shown, setShown] = useState("");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const value = interim || text;
    if (!value) {
      setVisible(false);
      const t = setTimeout(() => setShown(""), 300);
      return () => clearTimeout(t);
    }
    setShown(value);
    setVisible(true);
    if (interim) return;
    // A caption that lingers is worse than one that goes. Long lines get
    // longer on screen, which is roughly how long they take to say.
    const hold = 2600 + value.length * 34;
    const t = setTimeout(() => setVisible(false), hold);
    return () => clearTimeout(t);
  }, [text, interim]);

  if (!shown) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[19%] z-40 flex justify-center px-8">
      <p
        className="caption max-w-[min(880px,80vw)] text-center transition-all duration-300"
        style={{
          fontSize: "clamp(19px, 2.55vw, 34px)",
          lineHeight: 1.28,
          opacity: visible ? 1 : 0,
          transform: visible ? "none" : "translateY(8px)",
          color: interim ? "var(--dim)" : "rgba(255,255,255,0.95)",
          fontStyle: interim ? "italic" : "normal",
        }}
      >
        {shown}
      </p>
    </div>
  );
}
