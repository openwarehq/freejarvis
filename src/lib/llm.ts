import type { Brain } from "./config";
import { createSseParser, type Usage } from "./events";

export type ToolCall = { id: string; name: string; args: string };

export type ChatMsg =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; name: string; content: string };

export type ToolDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type LlmEvent =
  | { t: "text"; delta: string }
  | { t: "thinking"; delta: string }
  | { t: "tool_call"; call: ToolCall }
  | { t: "done"; usage?: Usage };

/**
 * A friendlier error than the provider's own.
 *
 * Free tiers fail in ways that read as bugs: a daily quota answers with a
 * `retryDelay` measured in seconds, a wrong key answers 401 with a HTML page,
 * an Ollama with a small context silently truncates. Naming what happened
 * saves the twenty minutes everyone otherwise spends on it.
 */
export class LlmError extends Error {
  hint: string;
  constructor(message: string, hint = "") {
    super(message);
    this.hint = hint;
  }
}

function explain(status: number, body: string): LlmError {
  const short = body.slice(0, 400).replace(/\s+/g, " ").trim();
  if (status === 401 || status === 403)
    return new LlmError(
      `The model provider rejected the key (${status}).`,
      "Check LLM_API_KEY, or open Settings and paste one. Every hosted provider rejects unauthenticated requests — free means free of charge, not free of signup.",
    );
  if (status === 402)
    return new LlmError("The provider says this account is out of credit (402).", short);
  if (status === 404)
    return new LlmError(
      `No such model at that base URL (404).`,
      "LLM_MODEL has to be a model that provider actually serves. On OpenRouter the free ones end in `:free`.",
    );
  if (status === 429) {
    const daily = /per day|daily|quota/i.test(body);
    return new LlmError(
      daily ? "Daily free-tier quota is used up (429)." : "Rate limited by the provider (429).",
      daily
        ? "A daily cap is not a rate limit — waiting the suggested few seconds will not help. Switch provider, go local, or come back tomorrow."
        : short,
    );
  }
  return new LlmError(`The model provider returned ${status}.`, short);
}

/* ── the shared entry point ───────────────────────────────────────────── */

export async function* streamChat(
  brain: Extract<Brain, { kind: "direct" }>,
  messages: ChatMsg[],
  tools: ToolDef[],
  signal?: AbortSignal,
): AsyncGenerator<LlmEvent> {
  if (brain.wire === "anthropic") {
    yield* streamAnthropic(brain, messages, tools, signal);
  } else {
    yield* streamOpenAi(brain, messages, tools, signal);
  }
}

/* ── OpenAI chat-completions ──────────────────────────────────────────── */

async function* streamOpenAi(
  brain: Extract<Brain, { kind: "direct" }>,
  messages: ChatMsg[],
  tools: ToolDef[],
  signal?: AbortSignal,
): AsyncGenerator<LlmEvent> {
  const body: Record<string, unknown> = {
    model: brain.model,
    stream: true,
    messages: messages.map(toOpenAiMessage),
  };
  if (tools.length) {
    body.tools = tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    body.tool_choice = "auto";
  }

  const res = await fetch(`${brain.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(brain.apiKey ? { Authorization: `Bearer ${brain.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) throw explain(res.status, await res.text().catch(() => ""));

  // Tool calls stream in as indexed fragments; the name arrives once and the
  // arguments arrive a few characters at a time.
  const partial = new Map<number, ToolCall>();
  let usage: Usage | undefined;
  let done = false;
  let streamError: { code?: number; message?: string } | null = null;
  const out: LlmEvent[] = [];

  const parser = createSseParser((data) => {
    if (data === "[DONE]") {
      done = true;
      return;
    }
    let j: Record<string, any>;
    try {
      j = JSON.parse(data);
    } catch {
      return;
    }
    // Several providers — OpenRouter among them — answer 200, open the stream,
    // and then deliver the failure as a frame inside it. Ignoring that frame
    // turns a rate limit into an assistant that says nothing at all, which is
    // the single worst way for this to fail.
    if (j.error) {
      streamError = typeof j.error === "string" ? { message: j.error } : j.error;
      return;
    }
    if (j.usage) {
      usage = {
        input_tokens: j.usage.prompt_tokens,
        output_tokens: j.usage.completion_tokens,
        total_tokens: j.usage.total_tokens,
      };
    }
    const d = j.choices?.[0]?.delta;
    if (!d) return;
    // Reasoning models put their scratchpad in a sibling field; several
    // providers use `reasoning`, others `reasoning_content`.
    const think = d.reasoning_content ?? d.reasoning;
    if (typeof think === "string" && think) out.push({ t: "thinking", delta: think });
    if (typeof d.content === "string" && d.content) out.push({ t: "text", delta: d.content });
    for (const tc of d.tool_calls ?? []) {
      const i = tc.index ?? 0;
      const cur = partial.get(i) ?? { id: tc.id || `call_${i}`, name: "", args: "" };
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.name += tc.function.name;
      if (tc.function?.arguments) cur.args += tc.function.arguments;
      partial.set(i, cur);
    }
  });

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  while (!done) {
    const { value, done: fin } = await reader.read();
    if (fin) break;
    parser.push(dec.decode(value, { stream: true }));
    while (out.length) yield out.shift()!;
  }
  while (out.length) yield out.shift()!;

  if (streamError) throw explain((streamError as { code?: number }).code ?? 0, JSON.stringify(streamError));

  for (const call of partial.values()) if (call.name) yield { t: "tool_call", call };
  yield { t: "done", usage };
}

function toOpenAiMessage(m: ChatMsg): Record<string, unknown> {
  if (m.role === "tool") {
    return { role: "tool", tool_call_id: m.tool_call_id, content: m.content };
  }
  if (m.role === "assistant" && m.tool_calls?.length) {
    return {
      role: "assistant",
      content: m.content || null,
      tool_calls: m.tool_calls.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: c.args },
      })),
    };
  }
  return { role: m.role, content: m.content };
}

/* ── Anthropic messages ───────────────────────────────────────────────── */

async function* streamAnthropic(
  brain: Extract<Brain, { kind: "direct" }>,
  messages: ChatMsg[],
  tools: ToolDef[],
  signal?: AbortSignal,
): AsyncGenerator<LlmEvent> {
  // Anthropic takes the system prompt out of the message list entirely, and
  // wants tool results as user-role content blocks rather than a `tool` role.
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => (m as { content: string }).content)
    .join("\n\n");

  const converted: Record<string, unknown>[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "tool") {
      const last = converted[converted.length - 1] as
        | { role: string; content: unknown[] }
        | undefined;
      const block = {
        type: "tool_result",
        tool_use_id: m.tool_call_id,
        content: m.content,
      };
      if (last?.role === "user" && Array.isArray(last.content)) last.content.push(block);
      else converted.push({ role: "user", content: [block] });
      continue;
    }
    if (m.role === "assistant" && m.tool_calls?.length) {
      const content: unknown[] = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const c of m.tool_calls) {
        content.push({
          type: "tool_use",
          id: c.id,
          name: c.name,
          input: safeJson(c.args),
        });
      }
      converted.push({ role: "assistant", content });
      continue;
    }
    converted.push({ role: m.role, content: m.content });
  }

  const body: Record<string, unknown> = {
    model: brain.model,
    max_tokens: 4096,
    stream: true,
    messages: converted,
  };
  if (system) body.system = system;
  if (tools.length) {
    body.tools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  const res = await fetch(`${brain.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": brain.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw explain(res.status, await res.text().catch(() => ""));

  const out: LlmEvent[] = [];
  const blocks = new Map<number, ToolCall>();
  let usage: Usage | undefined;
  let anthropicError: { message?: string } | null = null;

  const parser = createSseParser((data) => {
    let j: Record<string, any>;
    try {
      j = JSON.parse(data);
    } catch {
      return;
    }
    if (j.type === "content_block_start" && j.content_block?.type === "tool_use") {
      blocks.set(j.index, { id: j.content_block.id, name: j.content_block.name, args: "" });
    } else if (j.type === "content_block_delta") {
      if (j.delta?.type === "text_delta") out.push({ t: "text", delta: j.delta.text });
      else if (j.delta?.type === "thinking_delta")
        out.push({ t: "thinking", delta: j.delta.thinking });
      else if (j.delta?.type === "input_json_delta") {
        const b = blocks.get(j.index);
        if (b) b.args += j.delta.partial_json;
      }
    } else if (j.type === "message_delta" && j.usage) {
      usage = { output_tokens: j.usage.output_tokens };
    } else if (j.type === "error") {
      anthropicError = j.error ?? { message: "unknown" };
    }
  });

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parser.push(dec.decode(value, { stream: true }));
    while (out.length) yield out.shift()!;
  }
  while (out.length) yield out.shift()!;

  if (anthropicError)
    throw new LlmError(
      `Anthropic failed mid-stream: ${(anthropicError as { message?: string }).message ?? "unknown"}`,
    );

  for (const call of blocks.values()) yield { t: "tool_call", call: { ...call, args: call.args || "{}" } };
  yield { t: "done", usage };
}

export function safeJson(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/** One non-streaming call, for titles and other small jobs. */
export async function completeOnce(
  brain: Extract<Brain, { kind: "direct" }>,
  messages: ChatMsg[],
): Promise<string> {
  let text = "";
  for await (const ev of streamChat(brain, messages, [])) {
    if (ev.t === "text") text += ev.delta;
  }
  return text.trim();
}
