"use client";

import { useEffect, useState } from "react";
import type { BrainReport } from "@/app/api/brain/route";
import type { DeckState } from "@/lib/events";

const STATE_LABEL: Record<DeckState, string> = {
  idle: "STANDBY",
  listening: "LISTENING",
  thinking: "THINKING",
  speaking: "SPEAKING",
  tool: "WORKING",
  "awaiting-approval": "AWAITING YOU",
};

export default function TopBar({
  state,
  brain,
  onOpenSettings,
}: {
  state: DeckState;
  brain: BrainReport | null;
  onOpenSettings: () => void;
}) {
  const [now, setNow] = useState<string>("");

  useEffect(() => {
    // Rendered client-side only: a server-rendered clock is a hydration
    // mismatch waiting to happen, and it would be wrong by a second anyway.
    const tick = () =>
      setNow(
        new Date().toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
        }),
      );
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const live = state !== "idle";

  return (
    <header className="pointer-events-none relative z-30 flex h-12 shrink-0 items-center gap-4 border-b border-[var(--line)] bg-black/45 px-4 backdrop-blur-xl">
      <div className="pointer-events-auto flex items-center gap-2.5">
        <span
          className="grid h-[22px] w-[22px] place-items-center rounded-[3px] text-[11px] font-bold"
          style={{
            background: "var(--accent)",
            color: "#000",
            fontFamily: "var(--chrome)",
          }}
        >
          F
        </span>
        <span
          className="text-[12px] font-medium tracking-[0.24em]"
          style={{ fontFamily: "var(--chrome)" }}
        >
          FREEJARVIS
          <sup className="ml-0.5 text-[7px] tracking-normal opacity-40">OSS</sup>
        </span>
      </div>

      <div className="flex flex-1 justify-center">
        <div
          className="pointer-events-auto flex items-center gap-2 rounded-full border px-3 py-1"
          style={{
            borderColor: live ? "var(--accent-dim)" : "var(--line)",
            background: live ? "var(--accent-ghost)" : "rgba(255,255,255,0.02)",
          }}
        >
          <span
            className={`h-[6px] w-[6px] rounded-full ${live ? "pulse" : ""}`}
            style={{ background: live ? "var(--accent)" : "var(--faint)" }}
          />
          <span
            className="label"
            style={{ color: live ? "var(--accent)" : "var(--dim)" }}
          >
            {STATE_LABEL[state]}
          </span>
        </div>
      </div>

      <div className="pointer-events-auto flex items-center gap-3">
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-2 rounded-[3px] border px-2.5 py-1 transition-colors hover:bg-white/5"
          style={{
            borderColor: brain?.ready ? "var(--line-bright)" : "hsl(8 92% 60% / 0.4)",
          }}
          title={brain?.detail ?? "Configure a brain"}
        >
          <span
            className="h-[5px] w-[5px] rounded-full"
            style={{
              background: brain?.ready ? "var(--accent)" : "hsl(8 92% 60%)",
            }}
          />
          <span className="label label-bright">{brain?.label ?? "…"}</span>
        </button>
        <span className="data w-[76px] text-right" style={{ color: "var(--dim)" }}>
          {now || "--:--:--"}
        </span>
      </div>
    </header>
  );
}
