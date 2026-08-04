import { synthesise, voiceConfig } from "@/lib/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Text in, audio out, key stays here.
 *
 * A 409 means "no key configured" and is not an error the deck should shout
 * about — it is the signal to fall back to the browser's own voice.
 */
export async function POST(req: Request) {
  const cfg = voiceConfig();
  if (!cfg.enabled) {
    return Response.json({ error: "no-key" }, { status: 409 });
  }

  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  if (!text?.trim()) return new Response("text is required", { status: 400 });

  const out = await synthesise(cfg, text, req.signal);
  if (!out.ok) {
    return Response.json({ error: out.error }, { status: out.status || 502 });
  }

  return new Response(out.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
