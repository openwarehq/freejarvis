import { runTurn } from "./agent";
import { resolveBrain } from "./config";
import {
  addMessage,
  getSession,
  listMessages,
  setRemoteId,
  touchSession,
} from "./db";
import type { DeckEvent } from "./events";
import * as hermes from "./hermes";

/**
 * One entry point, whichever brain is in the socket.
 *
 * The deck, the scheduler and the API all call this. Nothing above this line
 * knows whether the answer came from a Hermes Agent or from the loop in
 * `agent.ts`, which is the property that lets the same UI serve both.
 */
export async function* runPrompt(opts: {
  sessionId: string;
  input: string;
  signal?: AbortSignal;
  unattended?: boolean;
}): AsyncGenerator<DeckEvent> {
  const brain = resolveBrain();

  if (brain.kind === "none") {
    yield {
      t: "run.failed",
      message: brain.reason,
      hint: "Open Settings and point freejarvis at a Hermes Agent, or at any OpenAI-compatible model.",
    };
    return;
  }

  if (brain.kind === "direct") {
    yield* runTurn({ brain, sessionId: opts.sessionId, input: opts.input, signal: opts.signal, unattended: opts.unattended });
    return;
  }

  /* Hermes. */
  const session = getSession(opts.sessionId);
  let remote = session?.remote_id ?? null;
  if (!remote) {
    remote = await hermes.createSession(brain, session?.title);
    if (remote) setRemoteId(opts.sessionId, remote);
  }

  // Hermes owns the transcript once a remote session exists, but we keep our
  // own copy too: the tab strip, the search and the replay all read from it,
  // and they should still work when the agent is off.
  addMessage({ session_id: opts.sessionId, role: "user", content: opts.input });

  const history = listMessages(opts.sessionId)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content }));
  // The turn's own input is appended by the fallback path, so don't send it twice.
  history.pop();

  const runId = `run_${Math.random().toString(36).slice(2, 10)}`;
  yield { t: "run.started", runId, sessionId: opts.sessionId };

  let assistant = "";
  try {
    for await (const ev of hermes.streamTurn(brain, {
      remoteSessionId: remote,
      input: opts.input,
      history,
      sessionKey: `freejarvis:${opts.sessionId}`,
      signal: opts.signal,
    })) {
      if (ev.t === "assistant.delta") assistant += ev.text;
      if (ev.t === "tool.completed") {
        addMessage({
          session_id: opts.sessionId,
          role: "tool",
          content: ev.output.slice(0, 4000),
          tool_name: ev.name,
          tool_ok: ev.ok,
        });
      }
      yield ev;
    }
  } catch (e) {
    yield {
      t: "run.failed",
      message: `Lost the connection to Hermes: ${(e as Error).message}`,
      hint: `Is the gateway still up at ${brain.url}?`,
    };
  }

  if (assistant.trim())
    addMessage({ session_id: opts.sessionId, role: "assistant", content: assistant });
  touchSession(opts.sessionId);
}

/** Drain a run into plain text. Used by the scheduler, which has no screen. */
export async function collect(gen: AsyncGenerator<DeckEvent>): Promise<{
  text: string;
  ok: boolean;
  error?: string;
}> {
  let text = "";
  let ok = true;
  let error: string | undefined;
  for await (const ev of gen) {
    if (ev.t === "assistant.delta") text += ev.text;
    else if (ev.t === "run.failed") {
      ok = false;
      error = ev.message;
    }
  }
  return { text: text.trim(), ok, error };
}
