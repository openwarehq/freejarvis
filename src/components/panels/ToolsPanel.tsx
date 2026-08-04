"use client";

import Sheet, { Empty } from "../Sheet";
import { useResource } from "@/hooks/useResource";
import type { ToolsetView } from "@/app/api/tools/route";

type Payload = {
  owner: "hermes" | "local";
  available: boolean;
  reason?: string;
  shellEnabled?: boolean;
  toolsets: ToolsetView[];
};

export default function ToolsPanel({ onClose }: { onClose: () => void }) {
  const { data, loading } = useResource<Payload>("/api/tools", 30_000);
  const sets = data?.toolsets ?? [];
  const count = sets.reduce((n, s) => n + s.tools.length, 0);

  return (
    <Sheet
      title="Tools"
      subtitle={
        loading
          ? "reading…"
          : data?.owner === "hermes"
            ? `${count} on the attached agent`
            : `${count} built in`
      }
      onClose={onClose}
    >
      {!loading && data && !data.available && (
        <Empty title="Cannot enumerate" detail={data.reason} />
      )}

      {sets.map((set) => (
        <div key={set.name}>
          <div className="label flex items-center gap-2 border-b border-[var(--line)] bg-black/30 px-4 py-2">
            <span className="label-bright">{set.label}</span>
            <span className="ml-auto">{set.tools.length}</span>
            {!set.enabled && <span style={{ color: "var(--faint)" }}>OFF</span>}
          </div>
          {set.tools.map((t) => (
            <div key={t.name} className="border-b border-[var(--line)] px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="data text-[11.5px] text-[var(--text)]">{t.name}</span>
                {t.gated && (
                  <span
                    className="label rounded-[2px] px-1.5 py-0.5"
                    style={{
                      fontSize: 8,
                      background: "hsl(8 92% 60% / 0.14)",
                      color: "hsl(8 92% 66%)",
                    }}
                  >
                    ASKS FIRST
                  </span>
                )}
              </div>
              {t.description && (
                <p className="mt-1 text-[11px] leading-relaxed text-[var(--faint)]">
                  {t.description}
                </p>
              )}
            </div>
          ))}
        </div>
      ))}

      {data?.owner === "local" && (
        <p className="px-4 py-4 text-[11px] leading-relaxed text-[var(--faint)]">
          {data.shellEnabled ? (
            <>
              The <span className="data">shell</span> tool is on. It runs commands inside{" "}
              <span className="data">data/workspace</span> as the container user, and it always asks
              before it runs.
            </>
          ) : (
            <>
              The <span className="data">shell</span> tool is off. Turn it on with{" "}
              <span className="data">FREEJARVIS_SHELL=1</span> — it still asks before every command.
            </>
          )}
        </p>
      )}
    </Sheet>
  );
}
