"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BrainReport } from "@/app/api/brain/route";
import { createSseParser, type DeckEvent, type DeckState } from "@/lib/events";
import { takeSentences } from "@/lib/sentences";

export type Turn = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  at: number;
};

export type ToolRun = {
  id: string;
  name: string;
  args: string;
  status: "running" | "ok" | "failed";
  output?: string;
  at: number;
};

export type PendingApproval = { id: string; name: string; args: string; reason: string };

export type SessionMeta = {
  id: string;
  title: string;
  updated_at: number;
};

/**
 * The deck's state machine.
 *
 * One SSE connection per turn, one reducer over DeckEvents, and a sentence
 * splitter feeding the caption line and the voice. The splitter is the part
 * that makes it feel like a person: waiting for a whole answer before
 * speaking adds seconds of silence, and speaking every token makes a stutter.
 * Sentences are the right unit.
 */
export type DeckHandlers = {
  onSentence: (s: string) => void;
  /** Fires the moment a tool starts, so the deck can open the matching view. */
  onTool?: (name: string, args: string) => void;
  /**
   * Where a turn streams from. Demo mode points this at `/api/demo`, which
   * emits the identical event stream off a script — so nothing below this
   * line needs a demo branch.
   */
  endpoint?: string;
  /** Merged into the POST body. Demo mode passes the script id. */
  extra?: Record<string, unknown>;
};

export type Telemetry = {
  /** Milliseconds from send to the first token of the reply. */
  firstToken: number | null;
  /** Milliseconds for the whole turn. */
  turn: number | null;
  toolCalls: number;
  turns: number;
};

export function useDeck(handlers: DeckHandlers) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [tools, setTools] = useState<ToolRun[]>([]);
  const [caption, setCaption] = useState("");
  const [running, setRunning] = useState(false);
  const [toolState, setToolState] = useState<DeckState | null>(null);
  const [approval, setApproval] = useState<PendingApproval | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [brain, setBrain] = useState<BrainReport | null>(null);
  const [failure, setFailure] = useState<{ message: string; hint?: string } | null>(null);

  const [telemetry, setTelemetry] = useState<Telemetry>({
    firstToken: null,
    turn: null,
    toolCalls: 0,
    turns: 0,
  });

  const abortRef = useRef<AbortController | null>(null);
  const spoken = useRef("");
  // Handlers change identity every render; the stream loop must not. Reading
  // them through a ref keeps `drain` and `send` stable without going stale.
  const cb = useRef(handlers);
  cb.current = handlers;

  const refreshBrain = useCallback(async () => {
    try {
      const r = await fetch("/api/brain", { cache: "no-store" });
      setBrain((await r.json()) as BrainReport);
    } catch {
      /* the deck stays usable with an unknown brain */
    }
  }, []);

  const refreshSessions = useCallback(async () => {
    try {
      const r = await fetch("/api/sessions", { cache: "no-store" });
      const j = (await r.json()) as { sessions: SessionMeta[] };
      setSessions(j.sessions ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refreshBrain();
    void refreshSessions();
    const t = setInterval(refreshBrain, 20_000);
    return () => clearInterval(t);
  }, [refreshBrain, refreshSessions]);

  const openSession = useCallback(async (id: string) => {
    setSessionId(id);
    setTools([]);
    setCaption("");
    setApproval(null);
    try {
      const r = await fetch(`/api/sessions/${id}`, { cache: "no-store" });
      const j = (await r.json()) as {
        messages: { id: string; role: string; content: string; created_at: number }[];
      };
      setTurns(
        (j.messages ?? [])
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            text: m.content,
            at: m.created_at,
          })),
      );
    } catch {
      setTurns([]);
    }
  }, []);

  const newSession = useCallback(() => {
    setSessionId(null);
    setTurns([]);
    setTools([]);
    setCaption("");
    setApproval(null);
    setFailure(null);
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    setToolState(null);
  }, []);

  /** Emit whole sentences as they complete; flush the remainder at the end. */
  const drain = useCallback((buffer: string, final: boolean): string => {
    const { sentences, rest } = takeSentences(buffer, final);
    for (const s of sentences) {
      cb.current.onSentence(s);
      setCaption(s);
    }
    return rest;
  }, []);

  const send = useCallback(
    async (input: string) => {
      const text = input.trim();
      if (!text || running) return;

      setFailure(null);
      setRunning(true);
      setTools([]);
      setApproval(null);

      const started = performance.now();
      let firstToken: number | null = null;
      let toolCalls = 0;
      setTurns((t) => [
        ...t,
        { id: `u_${Date.now()}`, role: "user", text, at: Date.now() },
      ]);

      const assistantId = `a_${Date.now()}`;
      setTurns((t) => [...t, { id: assistantId, role: "assistant", text: "", at: Date.now() }]);

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      spoken.current = "";

      try {
        const res = await fetch(cb.current.endpoint ?? "/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: text, sessionId, ...cb.current.extra }),
          signal: ctrl.signal,
        });

        const returned = res.headers.get("X-Session-Id");
        if (returned) setSessionId(returned);

        if (!res.ok || !res.body) {
          setFailure({ message: `The deck's own API returned ${res.status}.` });
          setRunning(false);
          return;
        }

        const parser = createSseParser((data) => {
          let ev: DeckEvent;
          try {
            ev = JSON.parse(data) as DeckEvent;
          } catch {
            return;
          }
          apply(ev);
        });

        const apply = (ev: DeckEvent) => {
          switch (ev.t) {
            case "assistant.delta":
              if (firstToken === null) firstToken = Math.round(performance.now() - started);
              setTurns((t) =>
                t.map((x) => (x.id === assistantId ? { ...x, text: x.text + ev.text } : x)),
              );
              spoken.current = drain(spoken.current + ev.text, false);
              break;
            case "tool.started":
              if (firstToken === null) firstToken = Math.round(performance.now() - started);
              toolCalls++;
              cb.current.onTool?.(ev.name, ev.args);
              setToolState("tool");
              setTools((t) => [
                ...t,
                { id: ev.id, name: ev.name, args: ev.args, status: "running", at: Date.now() },
              ]);
              setCaption(`running ${ev.name}…`);
              break;
            case "tool.progress":
              if (ev.text) setCaption(ev.text.slice(0, 120));
              break;
            case "tool.completed":
              setTools((t) =>
                t.map((x) =>
                  x.id === ev.id ? { ...x, status: ev.ok ? "ok" : "failed", output: ev.output } : x,
                ),
              );
              setToolState(null);
              break;
            case "approval.required":
              setApproval({ id: ev.id, name: ev.name, args: ev.args, reason: ev.reason });
              setCaption(`waiting on you — ${ev.name}`);
              break;
            case "run.completed":
              drain(spoken.current, true);
              spoken.current = "";
              setToolState(null);
              break;
            case "run.failed":
              setFailure({ message: ev.message, hint: ev.hint });
              setCaption("");
              break;
          }
        };

        const reader = res.body.getReader();
        const dec = new TextDecoder();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          parser.push(dec.decode(value, { stream: true }));
        }
        drain(spoken.current, true);
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setFailure({ message: (e as Error).message });
        }
      } finally {
        setRunning(false);
        setToolState(null);
        setApproval(null);
        abortRef.current = null;
        setTelemetry((t) => ({
          firstToken,
          turn: Math.round(performance.now() - started),
          toolCalls: t.toolCalls + toolCalls,
          turns: t.turns + 1,
        }));
        void refreshSessions();
      }
    },
    [drain, refreshSessions, running, sessionId],
  );

  const decide = useCallback(async (id: string, decision: "approve" | "deny") => {
    setApproval(null);
    await fetch(`/api/approvals/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    }).catch(() => {});
  }, []);

  return {
    turns,
    tools,
    caption,
    setCaption,
    running,
    toolState,
    approval,
    decide,
    sessionId,
    sessions,
    brain,
    failure,
    telemetry,
    send,
    stop,
    openSession,
    newSession,
    refreshSessions,
    refreshBrain,
  };
}
