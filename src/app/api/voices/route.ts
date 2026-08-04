import { NextResponse } from "next/server";
import { listVoices, quota, voiceConfig } from "@/lib/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = voiceConfig();
  if (!cfg.enabled) {
    return NextResponse.json({
      engine: "browser",
      voices: [],
      quota: null,
      voiceId: null,
      reason:
        "No ElevenLabs key. freejarvis is using the browser's own speech synthesis — free, offline, and it sounds like it.",
    });
  }

  const [voices, q] = await Promise.all([listVoices(cfg), quota(cfg)]);
  if (voices === null) {
    return NextResponse.json({
      engine: "browser",
      voices: [],
      quota: null,
      voiceId: cfg.voiceId,
      reason: "ElevenLabs is configured but did not answer. Falling back to the browser voice.",
    });
  }

  return NextResponse.json({
    engine: "elevenlabs",
    voiceId: cfg.voiceId,
    model: cfg.model,
    quota: q,
    voices: voices.map((v) => ({
      id: v.voice_id,
      name: v.name,
      accent: v.labels?.accent ?? "",
      gender: v.labels?.gender ?? "",
    })),
  });
}
