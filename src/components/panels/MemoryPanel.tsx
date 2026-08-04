"use client";

import { useState } from "react";
import Icon from "../Icon";
import Sheet, { Empty, when } from "../Sheet";
import { useResource } from "@/hooks/useResource";

type Memory = { id: string; body: string; tag: string; created_at: number };

export default function MemoryPanel({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState("");
  const url = q.trim() ? `/api/memory?q=${encodeURIComponent(q.trim())}` : "/api/memory";
  const { data, reload } = useResource<{ memories: Memory[] }>(url);
  const memories = data?.memories ?? [];

  const add = async () => {
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, tag: "note" }),
    });
    void reload();
  };

  const remove = async (id: string) => {
    await fetch(`/api/memory?id=${id}`, { method: "DELETE" });
    void reload();
  };

  return (
    <Sheet title="Memory" subtitle={`${memories.length} stored`} onClose={onClose}>
      <div className="space-y-2 border-b border-[var(--line)] p-3">
        <input
          className="field"
          placeholder="Search memory…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="flex gap-1.5">
          <input
            className="field"
            placeholder="Tell it something to remember"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <button className="btn btn-accent" onClick={add} disabled={!draft.trim()}>
            Add
          </button>
        </div>
      </div>

      {memories.length === 0 ? (
        <Empty
          title={q ? "No match" : "Memory is empty"}
          detail={
            q
              ? undefined
              : "It writes here itself when something is worth keeping. You can also add facts by hand — they go into the system prompt on every turn."
          }
        />
      ) : (
        memories.map((m) => (
          <div key={m.id} className="group border-b border-[var(--line)] px-4 py-2.5">
            <div className="flex items-start gap-2">
              <span
                className="label mt-[3px] shrink-0 rounded-[2px] px-1.5 py-0.5"
                style={{ background: "var(--accent-ghost)", color: "var(--accent)", fontSize: 8.5 }}
              >
                {m.tag}
              </span>
              <p className="flex-1 text-[12px] leading-relaxed text-[var(--text)]">{m.body}</p>
              <button
                onClick={() => remove(m.id)}
                className="shrink-0 p-0.5 text-[var(--faint)] opacity-0 transition-opacity hover:text-[hsl(8_92%_64%)] group-hover:opacity-100"
                title="Forget"
              >
                <Icon name="trash" size={12} />
              </button>
            </div>
            <span className="data mt-1 block text-[9.5px] text-[var(--faint)]">
              {when(m.created_at)}
            </span>
          </div>
        ))
      )}
    </Sheet>
  );
}
