import { NextResponse } from "next/server";
import { hostRewrite } from "@/lib/config";
import { allSettings, getDb, setSetting } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Settings you can change from the app, because "edit a .env and restart the
 * container" is a worse first five minutes than a form. Keys are never sent
 * back to the browser — only whether one is set.
 */
const KEYS = [
  "hermes_url",
  "hermes_key",
  "hermes_model",
  "llm_base_url",
  "llm_model",
  "llm_api_key",
  "voice_name",
  "voice_rate",
  "xi_api_key",
  "xi_voice_id",
  "xi_model",
] as const;

const SECRET = new Set(["hermes_key", "llm_api_key", "xi_api_key"]);

export async function GET() {
  const stored = allSettings();
  const out: Record<string, string> = {};
  for (const k of KEYS) {
    if (SECRET.has(k)) continue;
    out[k] = stored[k] ?? "";
  }
  return NextResponse.json({
    settings: out,
    secretsSet: {
      hermes_key: !!(stored.hermes_key || process.env.HERMES_KEY),
      llm_api_key: !!(stored.llm_api_key || process.env.LLM_API_KEY),
      xi_api_key: !!(stored.xi_api_key || process.env.ELEVENLABS_API_KEY),
    },
    env: {
      // What the .env is offering, so the form can show what it would fall
      // back to rather than pretending the field is genuinely empty.
      hermes_url: process.env.HERMES_URL ?? "",
      llm_base_url: process.env.LLM_BASE_URL ?? "",
      llm_model: process.env.LLM_MODEL ?? "",
    },
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, string>;
  for (const k of KEYS) {
    if (!(k in body)) continue;
    setSetting(k, String(body[k] ?? "").trim());
  }
  return NextResponse.json({ ok: true });
}

/** Try a candidate endpoint before saving it, so the panel can say yes or no. */
export async function PUT(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    kind?: "hermes" | "direct";
    url?: string;
    key?: string;
    model?: string;
  };
  const url = hostRewrite((body.url ?? "").trim().replace(/\/+$/, ""));
  if (!url) return NextResponse.json({ ok: false, error: "No URL given." });

  try {
    if (body.kind === "hermes") {
      const health = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
      if (!health.ok) return NextResponse.json({ ok: false, error: `Health check returned ${health.status}.` });
      const caps = await fetch(`${url}/v1/capabilities`, {
        headers: body.key ? { Authorization: `Bearer ${body.key}` } : {},
        signal: AbortSignal.timeout(6000),
      });
      if (caps.status === 401 || caps.status === 403)
        return NextResponse.json({ ok: false, error: "Reachable, but the key was rejected." });
      return NextResponse.json({ ok: true, detail: "Agent reachable and the key works." });
    }

    const res = await fetch(`${url}/models`, {
      headers: body.key ? { Authorization: `Bearer ${body.key}` } : {},
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401 || res.status === 403)
      return NextResponse.json({ ok: false, error: "The provider rejected that key." });
    if (!res.ok) return NextResponse.json({ ok: false, error: `The provider returned ${res.status}.` });
    const j = (await res.json()) as { data?: { id: string }[] };
    const ids = (j.data ?? []).map((m) => m.id);
    if (body.model && ids.length && !ids.includes(body.model)) {
      return NextResponse.json({
        ok: false,
        error: `That endpoint works, but it does not serve \`${body.model}\`.`,
      });
    }
    return NextResponse.json({ ok: true, detail: `${ids.length || "?"} models available.` });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message });
  } finally {
    // Touch the database so a first-run check also proves storage works.
    try {
      getDb();
    } catch {
      /* reported elsewhere */
    }
  }
}
