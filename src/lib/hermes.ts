import type { Brain } from "./config";
import type { DeckEvent } from "./events";

/**
 * A client for a self-hosted Hermes Agent's API server.
 *
 * Two things shape every call in here.
 *
 * First, Hermes does not enable browser CORS by default, so nothing in the
 * deck talks to it from the page — every request goes through our own route
 * handlers. That is not a workaround; it is the better arrangement anyway,
 * because it keeps `API_SERVER_KEY` on the server and means the only Hermes
 * config you need is `API_SERVER_ENABLED=true` and a key.
 *
 * Second, the surface is feature-detected, never assumed. `/v1/capabilities`
 * says what this build supports and `/v1/toolsets` says what it can do; a
 * panel whose endpoint is missing says so rather than rendering an empty
 * table that looks like an agent with nothing in it.
 */

export type HermesBrain = Extract<Brain, { kind: "hermes" }>;

export type HermesCapabilities = {
  object?: string;
  platform?: string;
  auth?: { type?: string; required?: boolean };
  features?: Record<string, unknown>;
};

export type HermesStatus = {
  reachable: boolean;
  authed: boolean;
  url: string;
  model: string;
  error?: string;
  hint?: string;
  capabilities?: HermesCapabilities;
  version?: string;
};

function headers(b: HermesBrain): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(b.key ? { Authorization: `Bearer ${b.key}` } : {}),
  };
}

async function call<T>(
  b: HermesBrain,
  path: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${b.url}${path}`, {
      ...init,
      headers: { ...headers(b), ...(init.headers as Record<string, string>) },
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, error: text.slice(0, 300) };
    return { ok: true, data: (text ? JSON.parse(text) : null) as T };
  } catch (e) {
    return { ok: false, status: 0, error: (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

/* ── status & discovery ───────────────────────────────────────────────── */

export async function status(b: HermesBrain): Promise<HermesStatus> {
  const base: HermesStatus = { reachable: false, authed: false, url: b.url, model: b.model };

  // /health needs no key, so it separates "not running" from "wrong key".
  const health = await call<{ status?: string }>(b, "/health", {}, 4000);
  if (!health.ok) {
    return {
      ...base,
      error: `Cannot reach a Hermes Agent at ${b.url}`,
      hint:
        "Start it with `hermes gateway`, and set API_SERVER_ENABLED=true plus API_SERVER_KEY in ~/.hermes/.env. From a container the host is host.docker.internal, which freejarvis rewrites for you.",
    };
  }

  const caps = await call<HermesCapabilities>(b, "/v1/capabilities", {}, 6000);
  if (!caps.ok) {
    if (caps.status === 401 || caps.status === 403) {
      return {
        ...base,
        reachable: true,
        error: "Hermes is running but rejected the key.",
        hint: "HERMES_KEY must match API_SERVER_KEY in ~/.hermes/.env.",
      };
    }
    // Reachable, authed, but an older build without the capabilities endpoint.
    return { ...base, reachable: true, authed: true, capabilities: {} };
  }

  return { ...base, reachable: true, authed: true, capabilities: caps.data ?? {} };
}

export type Toolset = { name: string; label?: string; enabled?: boolean; tools?: string[] };
export type Skill = { name: string; description?: string; category?: string };

export async function toolsets(b: HermesBrain): Promise<Toolset[] | null> {
  const r = await call<Toolset[] | { toolsets?: Toolset[] }>(b, "/v1/toolsets");
  if (!r.ok) return null;
  return Array.isArray(r.data) ? r.data : (r.data?.toolsets ?? []);
}

export async function skills(b: HermesBrain): Promise<Skill[] | null> {
  const r = await call<Skill[] | { skills?: Skill[] }>(b, "/v1/skills");
  if (!r.ok) return null;
  return Array.isArray(r.data) ? r.data : (r.data?.skills ?? []);
}

export async function detailedHealth(b: HermesBrain): Promise<Record<string, unknown> | null> {
  const r = await call<Record<string, unknown>>(b, "/health/detailed");
  return r.ok ? r.data : null;
}

/* ── jobs (Hermes cron, over REST) ────────────────────────────────────── */

export type HermesJob = Record<string, unknown> & {
  id?: string;
  job_id?: string;
  name?: string;
  schedule?: string;
  prompt?: string;
  enabled?: boolean;
  paused?: boolean;
};

export async function listJobs(b: HermesBrain): Promise<HermesJob[] | null> {
  const r = await call<HermesJob[] | { jobs?: HermesJob[] }>(b, "/api/jobs");
  if (!r.ok) return null;
  return Array.isArray(r.data) ? r.data : (r.data?.jobs ?? []);
}

export async function createJob(b: HermesBrain, job: Record<string, unknown>) {
  return call<HermesJob>(b, "/api/jobs", { method: "POST", body: JSON.stringify(job) });
}

export async function jobAction(
  b: HermesBrain,
  id: string,
  action: "pause" | "resume" | "run",
) {
  return call<unknown>(b, `/api/jobs/${encodeURIComponent(id)}/${action}`, { method: "POST" });
}

export async function deleteJob(b: HermesBrain, id: string) {
  return call<unknown>(b, `/api/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/* ── sessions ─────────────────────────────────────────────────────────── */

export async function createSession(b: HermesBrain, title?: string): Promise<string | null> {
  const r = await call<Record<string, unknown>>(b, "/api/sessions", {
    method: "POST",
    body: JSON.stringify(title ? { title } : {}),
  });
  if (!r.ok) return null;
  const d = r.data as Record<string, any> | null;
  return (d?.id ?? d?.session_id ?? d?.session?.id ?? null) as string | null;
}

export async function listRemoteSessions(b: HermesBrain, limit = 30) {
  const r = await call<unknown>(b, `/api/sessions?limit=${limit}`);
  if (!r.ok) return null;
  const d = r.data as Record<string, any>;
  return (Array.isArray(d) ? d : (d?.sessions ?? d?.data ?? [])) as Record<string, unknown>[];
}

/* ── approvals ────────────────────────────────────────────────────────── */

export async function resolveApproval(
  b: HermesBrain,
  runId: string,
  decision: "approve" | "deny",
) {
  return call<unknown>(b, `/v1/runs/${encodeURIComponent(runId)}/approval`, {
    method: "POST",
    body: JSON.stringify({ decision, approved: decision === "approve" }),
  });
}

export async function stopRun(b: HermesBrain, runId: string) {
  return call<unknown>(b, `/v1/runs/${encodeURIComponent(runId)}/stop`, { method: "POST" });
}

/* ── the chat stream ──────────────────────────────────────────────────── */

/**
 * Hermes has two ways to stream a turn and they are not equally good for a
 * deck like this one.
 *
 * `/api/sessions/{id}/chat/stream` emits lifecycle events — `tool.started`,
 * `tool.completed` — so the orb can show the agent reaching for something
 * instead of just going quiet. `/v1/chat/completions` is the OpenAI shape,
 * present in every build, and carries tool activity only as the custom
 * `hermes.tool.progress` event.
 *
 * So: try the session stream, and fall back to the OpenAI one when this build
 * does not have it. Either way the caller gets DeckEvents.
 */
export async function* streamTurn(
  b: HermesBrain,
  opts: {
    remoteSessionId: string | null;
    input: string;
    history: { role: string; content: string }[];
    sessionKey?: string;
    signal?: AbortSignal;
  },
): AsyncGenerator<DeckEvent> {
  if (opts.remoteSessionId) {
    const res = await fetch(
      `${b.url}/api/sessions/${encodeURIComponent(opts.remoteSessionId)}/chat/stream`,
      {
        method: "POST",
        headers: {
          ...headers(b),
          Accept: "text/event-stream",
          // Scopes long-term memory to this conversation for providers that
          // support it. Ignored by builds that do not.
          ...(opts.sessionKey ? { "X-Hermes-Session-Key": opts.sessionKey } : {}),
        },
        body: JSON.stringify({ input: opts.input }),
        signal: opts.signal,
      },
    );
    if (res.ok && res.body) {
      yield* readHermesSse(res.body);
      return;
    }
  }

  // Fallback: the OpenAI-compatible endpoint every build serves.
  const res = await fetch(`${b.url}/v1/chat/completions`, {
    method: "POST",
    headers: { ...headers(b), Accept: "text/event-stream" },
    body: JSON.stringify({
      model: b.model,
      stream: true,
      messages: [...opts.history, { role: "user", content: opts.input }],
    }),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    yield {
      t: "run.failed",
      message: `Hermes returned ${res.status}.`,
      hint:
        res.status === 401 || res.status === 403
          ? "HERMES_KEY must match API_SERVER_KEY in ~/.hermes/.env."
          : res.status === 429
            ? "Hermes caps concurrent runs (10 by default). Wait for the current ones to finish or raise gateway.api_server.max_concurrent_runs."
            : body.slice(0, 300),
    };
    return;
  }

  yield* readOpenAiSse(res.body);
}

/**
 * Hermes' SSE carries the event name on an `event:` line for the session
 * stream and inside the payload for the chat one, so this reads both.
 */
async function* readHermesSse(body: ReadableStream<Uint8Array>): AsyncGenerator<DeckEvent> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const tools = new Map<string, string>();

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });

    let idx: number;
    while ((idx = buf.search(/\r?\n\r?\n/)) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx).replace(/^(\r?\n){2}/, "");

      let name = "";
      let data = "";
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith("event:")) name = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data || data === "[DONE]") continue;

      let j: Record<string, any> = {};
      try {
        j = JSON.parse(data);
      } catch {
        // A build that streams bare text deltas rather than JSON.
        if (data) yield { t: "assistant.delta", text: data };
        continue;
      }

      const type = name || j.type || j.event || "";
      switch (type) {
        case "assistant.delta":
          if (j.delta || j.text || j.content)
            yield { t: "assistant.delta", text: j.delta ?? j.text ?? j.content };
          break;
        case "thinking.delta":
        case "reasoning.delta":
          yield { t: "thinking.delta", text: j.delta ?? j.text ?? "" };
          break;
        case "tool.started": {
          const id = String(j.id ?? j.call_id ?? j.tool_call_id ?? Math.random());
          const toolName = String(j.name ?? j.tool ?? "tool");
          tools.set(id, toolName);
          yield {
            t: "tool.started",
            id,
            name: toolName,
            args: typeof j.arguments === "string" ? j.arguments : JSON.stringify(j.arguments ?? j.args ?? {}),
          };
          break;
        }
        case "hermes.tool.progress":
        case "tool.progress":
          yield {
            t: "tool.progress",
            id: String(j.id ?? j.call_id ?? ""),
            text: String(j.message ?? j.text ?? j.delta ?? ""),
          };
          break;
        case "tool.completed": {
          const id = String(j.id ?? j.call_id ?? j.tool_call_id ?? "");
          yield {
            t: "tool.completed",
            id,
            name: tools.get(id) ?? String(j.name ?? "tool"),
            ok: j.error == null && j.ok !== false,
            output: String(j.output ?? j.result ?? j.error ?? ""),
          };
          break;
        }
        case "approval.required":
        case "run.approval_required":
          yield {
            t: "approval.required",
            id: String(j.run_id ?? j.id ?? ""),
            name: String(j.tool ?? j.name ?? "tool"),
            args: JSON.stringify(j.arguments ?? j.args ?? {}),
            reason: String(j.reason ?? "Hermes is asking before it runs this."),
          };
          break;
        case "subagent.start":
          yield { t: "tool.progress", id: "subagent", text: `subagent started: ${j.name ?? ""}` };
          break;
        case "subagent.complete":
          yield { t: "tool.progress", id: "subagent", text: `subagent finished` };
          break;
        case "run.completed":
          yield { t: "run.completed", runId: String(j.run_id ?? ""), usage: j.usage };
          break;
        case "run.failed":
        case "error":
          yield { t: "run.failed", message: String(j.message ?? j.error ?? "Hermes failed the run.") };
          break;
        default:
          // Unknown event types are not an error; newer builds add them.
          if (typeof j.delta === "string" && j.delta)
            yield { t: "assistant.delta", text: j.delta };
      }
    }
  }
}

async function* readOpenAiSse(body: ReadableStream<Uint8Array>): AsyncGenerator<DeckEvent> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.search(/\r?\n\r?\n/)) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx).replace(/^(\r?\n){2}/, "");
      let name = "";
      let data = "";
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith("event:")) name = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      if (data === "[DONE]") {
        yield { t: "run.completed", runId: "" };
        return;
      }
      let j: Record<string, any>;
      try {
        j = JSON.parse(data);
      } catch {
        continue;
      }
      if (name === "hermes.tool.progress" || j.object === "hermes.tool.progress") {
        yield {
          t: "tool.progress",
          id: String(j.id ?? ""),
          text: String(j.message ?? j.text ?? j.tool ?? ""),
        };
        continue;
      }
      const d = j.choices?.[0]?.delta;
      if (d?.content) yield { t: "assistant.delta", text: d.content };
      if (d?.reasoning_content) yield { t: "thinking.delta", text: d.reasoning_content };
    }
  }
  yield { t: "run.completed", runId: "" };
}
