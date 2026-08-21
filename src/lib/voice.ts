import { getSetting } from "./db";

/**
 * The voice, when you have a key for one.
 *
 * freejarvis speaks through the browser by default, which is free and sounds
 * like it. Point it at an ElevenLabs key and it speaks properly — and the orb
 * gets better too, because a real audio stream can be measured. The browser's
 * `speechSynthesis` exposes no waveform at all, so the amplitude there is
 * inferred from word-boundary events; with a real stream the orb is driven by
 * an AnalyserNode reading the actual voice.
 *
 * The key never reaches the browser. Audio is proxied through this server, the
 * same way everything else here is.
 */

/**
 * Matilda — American, middle-aged, professional.
 *
 * E.D.I.T.H. is voiced by Dawn Michelle King, a Marvel Studios assistant editor
 * rather than an actor, and it shows in the right way: the delivery is flat,
 * unhurried and entirely uninterested in being liked. The young, bright,
 * "engaging" voices are all wrong for her — she is a defence system reading you
 * a status, not an assistant pleased to help.
 */
export const DEFAULT_VOICE_ID = "XrExE9yKIg1WjnnlVkGX"; // Matilda
export const DEFAULT_MODEL = "eleven_turbo_v2_5";

/**
 * One reply should not be able to spend a month's characters. A model that
 * loops, or is asked for an essay, is the normal way that happens.
 */
export const MAX_SPEECH_CHARS = 700;

export const DEFAULT_SPEED = 1.12;

export type VoiceConfig = {
  enabled: boolean;
  apiKey: string;
  voiceId: string;
  model: string;
  speed: number;
};

export function voiceConfig(): VoiceConfig {
  const apiKey = (getSetting("xi_api_key") ?? process.env.ELEVENLABS_API_KEY ?? "").trim();
  const rawSpeed = Number(
    getSetting("xi_speed") ?? process.env.ELEVENLABS_SPEED ?? DEFAULT_SPEED,
  );
  return {
    enabled: !!apiKey,
    apiKey,
    voiceId:
      (getSetting("xi_voice_id") ?? process.env.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID).trim(),
    model: (getSetting("xi_model") ?? process.env.ELEVENLABS_MODEL ?? DEFAULT_MODEL).trim(),
    // Out of range the API rejects the whole request, so clamp rather than
    // let a typo in a `.env` turn the voice off entirely.
    speed: Number.isFinite(rawSpeed) ? Math.min(1.2, Math.max(0.7, rawSpeed)) : DEFAULT_SPEED,
  };
}

export type Voice = {
  voice_id: string;
  name: string;
  labels?: Record<string, string>;
  preview_url?: string;
};

export async function listVoices(cfg: VoiceConfig): Promise<Voice[] | null> {
  if (!cfg.enabled) return null;
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": cfg.apiKey },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { voices?: Voice[] };
    return j.voices ?? [];
  } catch {
    return null;
  }
}

export type Quota = { used: number; limit: number; tier: string; remaining: number };

export async function quota(cfg: VoiceConfig): Promise<Quota | null> {
  if (!cfg.enabled) return null;
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
      headers: { "xi-api-key": cfg.apiKey },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      character_count?: number;
      character_limit?: number;
      tier?: string;
    };
    const used = j.character_count ?? 0;
    const limit = j.character_limit ?? 0;
    return { used, limit, tier: j.tier ?? "unknown", remaining: Math.max(0, limit - used) };
  } catch {
    return null;
  }
}

/**
 * Strip the things that sound wrong when read out.
 *
 * A voice reading "```" or "**" aloud is the fastest way to break the
 * illusion, and a filename read as "notes dot M D" is better than "notes dot
 * md" — but only just, so paths are left alone and only the markup goes.
 */
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " — code block — ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[#>\s]*#+\s*/gm, "")
    .replace(/[*_~|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Ask ElevenLabs for the audio. Returns the upstream response to stream on. */
export async function synthesise(
  cfg: VoiceConfig,
  text: string,
  signal?: AbortSignal,
): Promise<{ ok: true; body: ReadableStream<Uint8Array> } | { ok: false; status: number; error: string }> {
  const body = speakable(text).slice(0, MAX_SPEECH_CHARS);
  if (!body) return { ok: false, status: 400, error: "Nothing to say." };

  // `optimize_streaming_latency` trades a little quality for the first byte
  // arriving sooner, which is the difference between a reply and a pause.
  const url =
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(cfg.voiceId)}/stream` +
    `?optimize_streaming_latency=2&output_format=mp3_44100_128`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": cfg.apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: body,
        model_id: cfg.model,
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.75,
          style: 0.2,
          use_speaker_boost: true,
          // A shade above natural. An assistant that reads at audiobook pace
          // sounds like it is being careful with you. ElevenLabs accepts
          // 0.7–1.2; past about 1.12 the consonants start to smear.
          speed: cfg.speed,
        },
        apply_text_normalization: "on",
      }),
      signal,
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      return {
        ok: false,
        status: res.status,
        error:
          res.status === 401
            ? "ElevenLabs rejected the key."
            : res.status === 429
              ? "ElevenLabs rate limited or out of characters."
              : detail.slice(0, 200),
      };
    }
    return { ok: true, body: res.body };
  } catch (e) {
    return { ok: false, status: 0, error: (e as Error).message };
  }
}
