"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import type { SessionMeta, ToolRun, Turn } from "@/hooks/useDeck";

export default function ChatDock({
  turns,
  tools,
  sessions,
  sessionId,
  running,
  listening,
  micSupported,
  interim,
  onSend,
  onStop,
  onToggleMic,
  onOpenSession,
  onNewSession,
}: {
  turns: Turn[];
  tools: ToolRun[];
  sessions: SessionMeta[];
  sessionId: string | null;
  running: boolean;
  listening: boolean;
  micSupported: boolean;
  interim: string;
  onSend: (text: string) => void;
  onStop: () => void;
  onToggleMic: () => void;
  onOpenSession: (id: string) => void;
  onNewSession: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [tall, setTall] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, tools, interim]);

  const submit = () => {
    const text = draft.trim();
    if (!text || running) return;
    setDraft("");
    onSend(text);
  };

  const tabs = sessions.slice(0, 4);

  return (
    <div
      className="glass pointer-events-auto flex w-[min(420px,calc(100vw-88px))] flex-col rounded-[5px] shadow-[0_24px_70px_-20px_rgba(0,0,0,0.95)] transition-[height] duration-300"
      style={{ height: tall ? "min(72vh, 620px)" : "300px" }}
    >
      {/* tab strip */}
      <div className="flex items-center gap-0 border-b border-[var(--line)] px-1.5">
        <div className="scroll flex flex-1 items-center gap-0 overflow-x-auto">
          <button
            onClick={onNewSession}
            className="shrink-0 px-2.5 py-2.5 transition-colors"
            style={{ color: sessionId === null ? "var(--accent)" : "var(--faint)" }}
            title="New session"
          >
            <span className="label" style={{ color: "inherit" }}>
              JARVIS
            </span>
          </button>
          {tabs.map((s) => (
            <button
              key={s.id}
              onClick={() => onOpenSession(s.id)}
              className="max-w-[120px] shrink-0 truncate px-2.5 py-2.5 transition-colors"
              style={{ color: sessionId === s.id ? "var(--accent)" : "var(--faint)" }}
              title={s.title}
            >
              <span className="label" style={{ color: "inherit" }}>
                {s.title}
              </span>
            </button>
          ))}
        </div>
        <button
          onClick={() => setTall((v) => !v)}
          className="shrink-0 p-2 text-[var(--faint)] transition-colors hover:text-[var(--text)]"
          title={tall ? "Shrink" : "Expand"}
        >
          <Icon name="expand" size={14} />
        </button>
      </div>

      {/* transcript */}
      <div ref={scroller} className="scroll flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
        {turns.length === 0 && (
          <p className="label mt-6 text-center leading-relaxed" style={{ color: "var(--faint)" }}>
            Hold space to talk
            <br />
            or type below
          </p>
        )}

        {turns.map((t) =>
          t.role === "user" ? (
            <div key={t.id} className="rise flex justify-end">
              <div
                className="max-w-[85%] rounded-[4px] rounded-br-[1px] px-2.5 py-1.5 text-[12.5px] leading-relaxed"
                style={{ background: "var(--accent-ghost)", border: "1px solid var(--accent-dim)" }}
              >
                {t.text}
              </div>
            </div>
          ) : (
            <div key={t.id} className="rise flex gap-2">
              <span
                className="mt-1 h-[5px] w-[5px] shrink-0 rounded-full"
                style={{ background: "var(--accent)" }}
              />
              <div className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-[var(--text)]">
                {t.text}
                {running && !t.text && (
                  <span className="pulse label" style={{ color: "var(--accent)" }}>
                    ▍
                  </span>
                )}
              </div>
            </div>
          ),
        )}

        {tools.map((t) => (
          <div
            key={t.id}
            className="rise relative overflow-hidden rounded-[3px] border px-2 py-1.5"
            style={{
              borderColor: t.status === "failed" ? "hsl(8 92% 60% / 0.4)" : "var(--line)",
              background: "rgba(255,255,255,0.02)",
            }}
          >
            <div className="flex items-center gap-2">
              <Icon
                name={t.status === "running" ? "bolt" : t.status === "ok" ? "check" : "close"}
                size={11}
                className={t.status === "running" ? "pulse" : ""}
              />
              <span className="label label-bright">{t.name}</span>
              <span className="label ml-auto">
                {t.status === "running" ? "RUNNING" : t.status === "ok" ? "OK" : "FAILED"}
              </span>
            </div>
            {t.output && tall && (
              <pre className="data mt-1.5 max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-[10px] leading-snug text-[var(--dim)]">
                {t.output.slice(0, 900)}
              </pre>
            )}
            {t.status === "running" && <span className="sweep absolute inset-x-0 bottom-0 h-px" />}
          </div>
        ))}

        {interim && (
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-[4px] border border-dashed border-[var(--line-bright)] px-2.5 py-1.5 text-[12.5px] italic leading-relaxed text-[var(--dim)]">
              {interim}
            </div>
          </div>
        )}
      </div>

      {/* composer */}
      <div className="border-t border-[var(--line)] p-2">
        <div className="flex items-end gap-1.5">
          <button
            onClick={onToggleMic}
            disabled={!micSupported}
            title={micSupported ? "Voice (hold space)" : "This browser has no speech recognition"}
            className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[3px] border transition-all"
            style={{
              borderColor: listening ? "var(--accent-dim)" : "var(--line-bright)",
              background: listening ? "var(--accent-ghost)" : "transparent",
              color: listening ? "var(--accent)" : "var(--faint)",
              opacity: micSupported ? 1 : 0.35,
            }}
          >
            <Icon name="mic" size={15} className={listening ? "pulse" : ""} />
          </button>

          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder="Ask it something…"
            className="scroll max-h-24 min-h-[34px] flex-1 resize-none rounded-[3px] border border-[var(--line)] bg-black/40 px-2.5 py-2 text-[12.5px] leading-snug text-[var(--text)] outline-none transition-colors placeholder:text-[var(--faint)] focus:border-[var(--accent-dim)]"
          />

          <button
            onClick={running ? onStop : submit}
            disabled={!running && !draft.trim()}
            className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[3px] border transition-all disabled:opacity-30"
            style={{
              borderColor: "var(--accent-dim)",
              background: "var(--accent-ghost)",
              color: "var(--accent)",
            }}
            title={running ? "Stop" : "Send"}
          >
            <Icon name={running ? "stop" : "send"} size={14} />
          </button>
        </div>
        <p
          className="mt-1.5 text-center text-[9px] tracking-[0.14em]"
          style={{ color: "var(--faint)", fontFamily: "var(--chrome)" }}
        >
          YOUR MODEL · YOUR MACHINE · NO ACCOUNT
        </p>
      </div>
    </div>
  );
}
