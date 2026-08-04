"use client";

import Sheet, { Empty } from "../Sheet";
import { useResource } from "@/hooks/useResource";

type Skill = { name: string; description?: string; category?: string };
type Payload = { owner: "hermes" | "local"; skills: Skill[] };

export default function SkillsPanel({ onClose }: { onClose: () => void }) {
  const { data, loading } = useResource<Payload>("/api/tools", 60_000);
  const skills = data?.skills ?? [];

  return (
    <Sheet
      title="Skills"
      subtitle={data?.owner === "hermes" ? `${skills.length} on the agent` : "agent-owned"}
      onClose={onClose}
    >
      {loading ? null : data?.owner !== "hermes" ? (
        <Empty
          title="No agent attached"
          detail="Skills are a Hermes Agent feature — markdown procedures it writes for itself and reuses. Attach one in Settings and they show up here. freejarvis on its own has tools, not skills."
        />
      ) : skills.length === 0 ? (
        <Empty
          title="No skills yet"
          detail="Your agent has not written or installed any. `hermes skills browse` on the host is where they come from."
        />
      ) : (
        skills.map((s) => (
          <div key={s.name} className="border-b border-[var(--line)] px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="data text-[11.5px] text-[var(--text)]">{s.name}</span>
              {s.category && (
                <span className="label ml-auto" style={{ fontSize: 8.5 }}>
                  {s.category}
                </span>
              )}
            </div>
            {s.description && (
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--faint)]">{s.description}</p>
            )}
          </div>
        ))
      )}
    </Sheet>
  );
}
