"use client";

import { useEffect, useState } from "react";
import type { Telemetry as TelemetryData } from "@/hooks/useDeck";
import type { BrainReport } from "@/app/api/brain/route";

/**
 * The readout strip.
 *
 * Six numbers, all measured. Latency is wall-clock from send to first token —
 * the number you actually feel — not a token count dressed up as speed.
 */
export default function Telemetry({
  data,
  brain,
  engine,
  sessions,
}: {
  data: TelemetryData;
  brain: BrainReport | null;
  engine: string;
  sessions: number;
}) {
  const [uptime, setUptime] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const t = setInterval(() => setUptime(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const clock = `${String(Math.floor(uptime / 60)).padStart(2, "0")}:${String(uptime % 60).padStart(2, "0")}`;

  const cells: [string, string][] = [
    ["LAT", data.firstToken === null ? "—" : `${data.firstToken}ms`],
    ["TURN", data.turn === null ? "—" : `${(data.turn / 1000).toFixed(1)}s`],
    ["TOOLS", String(data.toolCalls)],
    ["TURNS", String(data.turns)],
    ["SESS", String(sessions)],
    ["VOICE", engine === "elevenlabs" ? "XI" : "BROWSER"],
    ["UP", clock],
  ];

  return (
    <div className="pointer-events-none absolute left-1/2 top-2 z-40 hidden -translate-x-1/2 lg:block">
      <div className="glass flex items-center gap-0 rounded-[4px] px-1 py-1">
        {cells.map(([k, v], i) => (
          <div
            key={k}
            className="flex items-baseline gap-1.5 px-2.5"
            style={{ borderLeft: i ? "1px solid var(--line)" : undefined }}
          >
            <span className="label" style={{ fontSize: 8 }}>
              {k}
            </span>
            <span className="data text-[10px] text-[var(--text)]">{v}</span>
          </div>
        ))}
        <div className="flex items-baseline gap-1.5 px-2.5" style={{ borderLeft: "1px solid var(--line)" }}>
          <span
            className="h-[5px] w-[5px] rounded-full"
            style={{ background: brain?.ready ? "var(--accent)" : "hsl(8 92% 60%)" }}
          />
          <span className="data text-[10px]" style={{ color: "var(--dim)" }}>
            {brain?.model?.split("/").pop()?.slice(0, 22) ?? "—"}
          </span>
        </div>
      </div>
    </div>
  );
}
