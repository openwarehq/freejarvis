"use client";

import { useEffect, useState } from "react";
import Sheet from "../Sheet";

export default function SoulPanel({ onClose }: { onClose: () => void }) {
  const [body, setBody] = useState("");
  const [saved, setSaved] = useState("");
  const [tokens, setTokens] = useState(0);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await fetch("/api/soul", { cache: "no-store" });
      const j = (await r.json()) as { body: string; tokens: number };
      setBody(j.body);
      setSaved(j.body);
      setTokens(j.tokens);
    })();
  }, []);

  const save = async (reset = false) => {
    setStatus("saving");
    const r = await fetch("/api/soul", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reset ? { reset: true } : { body }),
    });
    const j = (await r.json()) as { body?: string; tokens?: number; error?: string };
    if (j.error) return setStatus(j.error);
    if (j.body !== undefined) {
      setBody(j.body);
      setSaved(j.body);
    }
    setTokens(j.tokens ?? 0);
    setStatus("saved");
    setTimeout(() => setStatus(null), 1800);
  };

  const dirty = body !== saved;

  return (
    <Sheet
      title="Soul"
      subtitle={`data/SOUL.md · ~${tokens} tokens on every turn`}
      onClose={onClose}
      actions={
        <button className="btn" onClick={() => save(true)} title="Restore the shipped file">
          Reset
        </button>
      }
    >
      <div className="flex h-full flex-col">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          spellCheck={false}
          className="scroll min-h-[300px] flex-1 resize-none border-0 bg-transparent p-4 text-[12px] leading-relaxed text-[var(--text)] outline-none"
          style={{ fontFamily: "var(--mono)" }}
        />
        <div className="flex items-center gap-2 border-t border-[var(--line)] p-3">
          <p className="flex-1 text-[10.5px] leading-snug text-[var(--faint)]">
            The identity file. Borrowed from Hermes, which keeps one at{" "}
            <span className="data">~/.hermes/SOUL.md</span> — when an agent is attached, this layers
            on top of its own.
          </p>
          {status && (
            <span className="label" style={{ color: "var(--accent)" }}>
              {status.toUpperCase()}
            </span>
          )}
          <button className="btn btn-accent" onClick={() => save()} disabled={!dirty}>
            Save
          </button>
        </div>
      </div>
    </Sheet>
  );
}
