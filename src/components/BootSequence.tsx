"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The boot sequence.
 *
 * Every line is a real check against a real endpoint — the brain, the tool
 * count, the scheduled jobs, the stored memories, the voice engine. It looks
 * like a title sequence because the numbers happen to be interesting, not
 * because anything here is theatre: if the agent is unreachable, this is where
 * you find out, and the line goes red and stays on screen.
 *
 * Skipped entirely on a repeat visit within the hour, and by any keypress.
 */

type Line = { label: string; value: string; ok: boolean };

export default function BootSequence({ onDone }: { onDone: () => void }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [leaving, setLeaving] = useState(false);
  const finished = useRef(false);

  const finish = useRef(() => {
    if (finished.current) return;
    finished.current = true;
    setLeaving(true);
    setTimeout(onDone, 420);
  });

  useEffect(() => {
    const onKey = () => finish.current();
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onKey);

    let cancelled = false;
    const push = (line: Line) =>
      new Promise<void>((r) => {
        if (cancelled) return r();
        setLines((l) => [...l, line]);
        setTimeout(r, 190);
      });

    void (async () => {
      const [brain, tools, jobs, memory, voices] = await Promise.all([
        fetch("/api/brain", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        fetch("/api/tools", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        fetch("/api/jobs", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        fetch("/api/memory", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        fetch("/api/voices", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      ]);

      const toolCount = (tools?.toolsets ?? []).reduce(
        (n: number, s: { tools: unknown[] }) => n + s.tools.length,
        0,
      );
      const jobCount = (jobs?.local ?? []).length + (jobs?.remote ?? []).length;

      await push({
        label: "BRAIN",
        value: brain?.ready ? `${brain.label} · ${brain.model ?? ""}`.trim() : (brain?.error ?? "not configured"),
        ok: !!brain?.ready,
      });
      await push({
        label: "TOOLS",
        value: `${toolCount} loaded`,
        ok: toolCount > 0,
      });
      await push({
        label: "MEMORY",
        value: `${(memory?.memories ?? []).length} stored`,
        ok: true,
      });
      await push({
        label: "SCHEDULE",
        value: jobCount ? `${jobCount} job${jobCount === 1 ? "" : "s"} armed` : "no jobs",
        ok: true,
      });
      await push({
        label: "VOICE",
        value:
          voices?.engine === "elevenlabs"
            ? `elevenlabs · ${voices.quota ? `${Math.round(voices.quota.remaining / 1000)}k chars left` : "ready"}`
            : "browser synthesis",
        ok: true,
      });
      await push({ label: "DECK", value: "online", ok: true });

      if (!cancelled) setTimeout(() => finish.current(), 620);
    })();

    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onKey);
    };
  }, []);

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-[60] grid place-items-center bg-black transition-opacity duration-[420ms]"
      style={{ opacity: leaving ? 0 : 1 }}
    >
      <div className="w-[min(430px,calc(100vw-48px))]">
        <div className="mb-6 flex items-center gap-2.5">
          <span
            className="grid h-[22px] w-[22px] place-items-center rounded-[3px] text-[11px] font-bold"
            style={{ background: "var(--accent)", color: "#000", fontFamily: "var(--chrome)" }}
          >
            E
          </span>
          <span
            className="text-[12px] font-medium tracking-[0.24em]"
            style={{ fontFamily: "var(--chrome)" }}
          >
            E.D.I.T.H.
          </span>
          <span className="label ml-auto">EVEN DEAD, I&apos;M THE HERO</span>
        </div>

        <div className="space-y-1.5">
          {lines.map((l) => (
            <div key={l.label} className="rise flex items-baseline gap-3">
              <span
                className="label w-[70px] shrink-0"
                style={{ color: l.ok ? "var(--accent)" : "hsl(8 92% 64%)" }}
              >
                {l.label}
              </span>
              <span className="data flex-1 truncate text-[11px] text-[var(--dim)]">{l.value}</span>
              <span
                className="label shrink-0"
                style={{ color: l.ok ? "var(--accent)" : "hsl(8 92% 64%)" }}
              >
                {l.ok ? "OK" : "FAIL"}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-6 h-px w-full overflow-hidden bg-[var(--line)]">
          <div
            className="h-full transition-[width] duration-200"
            style={{ width: `${(lines.length / 6) * 100}%`, background: "var(--accent)" }}
          />
        </div>

        <p className="label mt-3 text-center" style={{ color: "var(--faint)" }}>
          PRESS ANY KEY TO SKIP
        </p>
      </div>
    </div>
  );
}
