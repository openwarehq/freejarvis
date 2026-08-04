import type { Brain } from "./config";
import {
  addMessage,
  createApproval,
  getApproval,
  listMemories,
  listMessages,
  logActivity,
} from "./db";
import type { DeckEvent } from "./events";
import { LlmError, safeJson, streamChat, type ChatMsg } from "./llm";
import { readSoul } from "./soul";
import { builtinTools, toolDefs, type Tool } from "./tools";

const MAX_STEPS = 8;
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

export type DirectBrain = Extract<Brain, { kind: "direct" }>;

/**
 * The standalone loop: model, tools, memory, approvals.
 *
 * This runs when no Hermes Agent is attached. It is not a fallback in the
 * apologetic sense — a drop that only works if you already run a second piece
 * of software is not one command, and one command is the bar.
 */
export async function* runTurn(opts: {
  brain: DirectBrain;
  sessionId: string;
  input: string;
  signal?: AbortSignal;
  /** Scheduled runs have nobody to ask, so gated tools are refused, not queued. */
  unattended?: boolean;
}): AsyncGenerator<DeckEvent> {
  const { brain, sessionId, input, signal } = opts;
  const tools = builtinTools();
  const byName = new Map(tools.map((t) => [t.name, t]));

  const runId = `run_${Math.random().toString(36).slice(2, 10)}`;
  yield { t: "run.started", runId, sessionId };

  const messages: ChatMsg[] = [
    { role: "system", content: systemPrompt(opts.unattended ?? false) },
    ...history(sessionId),
    { role: "user", content: input },
  ];

  addMessage({ session_id: sessionId, role: "user", content: input });

  // Whether anything at all was said, across every step of the turn.
  let spoke = false;

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      if (signal?.aborted) return;

      let text = "";
      const calls: { id: string; name: string; args: string }[] = [];

      for await (const ev of streamChat(brain, messages, toolDefs(tools), signal)) {
        if (ev.t === "text") {
          text += ev.delta;
          yield { t: "assistant.delta", text: ev.delta };
        } else if (ev.t === "thinking") {
          yield { t: "thinking.delta", text: ev.delta };
        } else if (ev.t === "tool_call") {
          calls.push(ev.call);
        }
      }

      if (text.trim()) spoke = true;

      if (!calls.length) {
        // A turn that ends without a word looks exactly like a hang, and it
        // happens: small models answer an empty completion and stop, both on
        // the first step and — more often — on the step after a tool result.
        // Naming it is the difference between a bug report and a second try.
        if (!spoke) {
          yield {
            t: "run.failed",
            message: "The model returned an empty response.",
            hint: "Small free models do this intermittently, more so after a tool result or under a long system prompt. Send it again, trim SOUL.md, or move to a larger model.",
          };
          return;
        }
        if (text.trim()) addMessage({ session_id: sessionId, role: "assistant", content: text });
        yield { t: "run.completed", runId };
        return;
      }

      messages.push({ role: "assistant", content: text, tool_calls: calls });
      if (text.trim()) addMessage({ session_id: sessionId, role: "assistant", content: text });

      for (const call of calls) {
        const tool = byName.get(call.name);
        if (!tool) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            name: call.name,
            content: `No tool named ${call.name}. Available: ${tools.map((t) => t.name).join(", ")}.`,
          });
          continue;
        }

        yield { t: "tool.started", id: call.id, name: call.name, args: call.args };

        const decision = yield* gate(tool, call, sessionId, opts.unattended ?? false, signal);
        if (decision !== "run") {
          const refusal =
            decision === "denied"
              ? "The owner denied this. Do not retry it; say what you would need instead."
              : decision === "unattended"
                ? "Refused: this is a scheduled run with nobody present to approve a gated tool."
                : "Timed out waiting for approval.";
          yield { t: "tool.completed", id: call.id, name: call.name, ok: false, output: refusal };
          messages.push({ role: "tool", tool_call_id: call.id, name: call.name, content: refusal });
          addMessage({
            session_id: sessionId,
            role: "tool",
            content: refusal,
            tool_name: call.name,
            tool_args: call.args,
            tool_ok: false,
          });
          continue;
        }

        let output: string;
        let ok = true;
        try {
          output = await tool.run(safeJson(call.args));
        } catch (e) {
          ok = false;
          output = `Tool failed: ${(e as Error).message}`;
        }

        yield { t: "tool.completed", id: call.id, name: call.name, ok, output };
        messages.push({ role: "tool", tool_call_id: call.id, name: call.name, content: output });
        addMessage({
          session_id: sessionId,
          role: "tool",
          content: output,
          tool_name: call.name,
          tool_args: call.args,
          tool_ok: ok,
        });
        logActivity("tool", `${call.name} ${ok ? "ok" : "failed"}`);
      }
    }

    // Out of steps. Say so rather than going silent — a loop that stops
    // without a word is indistinguishable from one that crashed.
    const note = `Stopped after ${MAX_STEPS} tool steps without settling on an answer.`;
    yield { t: "assistant.delta", text: `\n\n${note}` };
    addMessage({ session_id: sessionId, role: "assistant", content: note });
    yield { t: "run.completed", runId };
  } catch (e) {
    if (signal?.aborted) return;
    const err = e as LlmError;
    yield { t: "run.failed", message: err.message, hint: err.hint };
    logActivity("error", err.message);
  }
}

/**
 * Gated tools stop the run and wait for a human, in the same stream. Polling
 * a table beats an in-memory promise registry here because the approval is
 * decided by a different HTTP request, and in dev that request may land on a
 * different module instance.
 */
async function* gate(
  tool: Tool,
  call: { id: string; name: string; args: string },
  sessionId: string,
  unattended: boolean,
  signal?: AbortSignal,
): AsyncGenerator<DeckEvent, "run" | "denied" | "timeout" | "unattended"> {
  if (!tool.gated) return "run";
  if (unattended) return "unattended";

  const approval = createApproval(
    sessionId,
    call.name,
    call.args,
    tool.gateReason ?? "This tool changes something outside the conversation.",
  );
  yield {
    t: "approval.required",
    id: approval.id,
    name: call.name,
    args: call.args,
    reason: approval.reason,
  };
  logActivity("approval", `${call.name} awaiting approval`);

  const deadline = Date.now() + APPROVAL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (signal?.aborted) return "denied";
    await sleep(400);
    const row = getApproval(approval.id);
    if (row?.status === "approved") return "run";
    if (row?.status === "denied") return "denied";
  }
  return "timeout";
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function history(sessionId: string): ChatMsg[] {
  // The last dozen turns. Tool traffic is replayed as narration rather than as
  // tool messages, because re-sending tool_call_ids the provider never issued
  // in this request is a 400 on several of them.
  const rows = listMessages(sessionId).slice(-24);
  const out: ChatMsg[] = [];
  for (const r of rows) {
    if (r.role === "user") out.push({ role: "user", content: r.content });
    else if (r.role === "assistant") out.push({ role: "assistant", content: r.content });
    else if (r.role === "tool")
      out.push({
        role: "user",
        content: `[earlier: ${r.tool_name} returned] ${r.content.slice(0, 800)}`,
      });
  }
  return out;
}

function systemPrompt(unattended: boolean): string {
  const memories = listMemories(12);
  const parts = [readSoul()];

  if (memories.length) {
    parts.push(
      "## What you already know\n" +
        memories.map((m) => `- [${m.tag}] ${m.body}`).join("\n") +
        "\n\nThis is a digest. Use `recall` to search the rest.",
    );
  }

  parts.push(
    unattended
      ? "## Right now\nThis is a scheduled run. Nobody is watching. Tools that need approval will be refused, so do not reach for them. Produce a finished answer in one pass — it goes straight to the activity feed."
      : "## Right now\nThe owner is at the deck. Your reply is spoken aloud and shown one line at a time, so lead with the answer and keep sentences short.",
  );

  return parts.join("\n\n");
}

/**
 * A title from the first thing the owner said, rather than from a model call.
 * On a free tier that allows fifty requests a day, spending one of them to
 * name a tab is a bad trade.
 */
export function titleFrom(input: string): string {
  const clean = input.replace(/\s+/g, " ").trim();
  if (!clean) return "New session";
  const words = clean.split(" ").slice(0, 7).join(" ");
  return (words.length < clean.length ? `${words}…` : words).slice(0, 60);
}
