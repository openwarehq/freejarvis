"use client";

import { useState } from "react";
import Icon from "./Icon";
import { useResource } from "@/hooks/useResource";
import { when } from "./Sheet";

type Entry = { id: number; kind: string; detail: string; created_at: number };

const TONE: Record<string, string> = {
  error: "hsl(8 92% 64%)",
  approval: "hsl(38 95% 62%)",
  job: "var(--accent)",
};

/**
 * What the agent has been doing while you were not looking. Scheduled runs
 * land here, which is the only place an unattended job's answer surfaces.
 */
export default function ActivityTicker() {
  const [open, setOpen] = useState(false);
  const { data } = useResource<{ activity: Entry[] }>("/api/activity", open ? 4000 : 20_000);
  const rows = data?.activity ?? [];
  const latest = rows[0];

  return (
    <div className="pointer-events-auto absolute bottom-4 left-4 z-20 w-[min(330px,40vw)]">
      {open && (
        <div className="glass scroll rise mb-1.5 max-h-[42vh] overflow-y-auto rounded-[4px]">
          {rows.length === 0 ? (
            <p className="label px-3 py-4 text-center">NOTHING YET</p>
          ) : (
            rows.map((e) => (
              <div key={e.id} className="border-b border-[var(--line)] px-3 py-1.5 last:border-0">
                <div className="flex items-baseline gap-2">
                  <span
                    className="label shrink-0"
                    style={{ fontSize: 8, color: TONE[e.kind] ?? "var(--faint)" }}
                  >
                    {e.kind}
                  </span>
                  <span className="flex-1 truncate text-[11px] text-[var(--dim)]">{e.detail}</span>
                  <span className="data shrink-0 text-[9px] text-[var(--faint)]">
                    {when(e.created_at)}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className="glass flex w-full items-center gap-2 rounded-[4px] px-2.5 py-1.5 transition-colors hover:bg-white/[0.05]"
      >
        <Icon
          name="chevronDown"
          size={11}
          className={`shrink-0 text-[var(--faint)] transition-transform ${open ? "" : "rotate-180"}`}
        />
        <span className="label shrink-0">ACTIVITY</span>
        <span className="flex-1 truncate text-left text-[10.5px] text-[var(--faint)]">
          {latest ? latest.detail : "quiet"}
        </span>
      </button>
    </div>
  );
}
