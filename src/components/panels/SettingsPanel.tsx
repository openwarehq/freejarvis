"use client";

import { useEffect, useState } from "react";
import Sheet from "../Sheet";
import type { BrainReport } from "@/app/api/brain/route";

type VoicePayload = {
  engine: "elevenlabs" | "browser";
  voiceId: string | null;
  quota: { used: number; limit: number; tier: string; remaining: number } | null;
  voices: { id: string; name: string; accent: string; gender: string }[];
  reason?: string;
};

type SitesPayload = {
  dir: string | null;
  sites: { name: string; title: string }[];
  reason: string | null;
};

type Settings = {
  settings: Record<string, string>;
  secretsSet: { hermes_key: boolean; llm_api_key: boolean; xi_api_key: boolean };
  env: { hermes_url: string; llm_base_url: string; llm_model: string };
};

const PROVIDERS = [
  { label: "OpenRouter", url: "https://openrouter.ai/api/v1", model: "google/gemma-4-26b-a4b-it:free" },
  { label: "Groq", url: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  { label: "Cerebras", url: "https://api.cerebras.ai/v1", model: "llama-3.3-70b" },
  { label: "Ollama", url: "http://localhost:11434/v1", model: "qwen2.5-coder:7b" },
];

export default function SettingsPanel({
  onClose,
  brain,
  onChanged,
  onPreviewVoice,
  onOpenSite,
}: {
  onClose: () => void;
  brain: BrainReport | null;
  onChanged: () => void;
  onPreviewVoice: (text: string, voiceId?: string) => void;
  onOpenSite: (name: string) => void;
}) {
  const [s, setS] = useState<Settings | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [voice, setVoice] = useState<VoicePayload | null>(null);
  const [sites, setSites] = useState<SitesPayload | null>(null);

  useEffect(() => {
    void (async () => {
      const [r, v, si] = await Promise.all([
        fetch("/api/settings", { cache: "no-store" }),
        fetch("/api/voices", { cache: "no-store" }),
        fetch("/api/sites", { cache: "no-store" }),
      ]);
      const j = (await r.json()) as Settings;
      setS(j);
      setForm(j.settings);
      setVoice((await v.json()) as VoicePayload);
      setSites((await si.json()) as SitesPayload);
    })();
  }, []);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setBusy(true);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setBusy(false);
    onChanged();
  };

  const check = async (kind: "hermes" | "direct") => {
    setBusy(true);
    setTest(null);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        kind === "hermes"
          ? { kind, url: form.hermes_url, key: form.hermes_key }
          : { kind, url: form.llm_base_url, key: form.llm_api_key, model: form.llm_model },
      ),
    });
    const j = (await res.json()) as { ok: boolean; detail?: string; error?: string };
    setTest({ ok: j.ok, text: j.detail ?? j.error ?? "" });
    setBusy(false);
  };

  if (!s) return <Sheet title="Settings" onClose={onClose}><div /></Sheet>;

  return (
    <Sheet title="Settings" subtitle={brain?.detail} onClose={onClose}>
      <div className="space-y-6 p-4">
        {brain && !brain.ready && (
          <div
            className="rounded-[3px] border p-3"
            style={{ borderColor: "hsl(8 92% 60% / 0.4)", background: "hsl(8 92% 60% / 0.07)" }}
          >
            <p className="text-[12px] leading-relaxed text-[var(--text)]">
              {brain.error ?? brain.detail}
            </p>
            {brain.hint && (
              <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--faint)]">{brain.hint}</p>
            )}
          </div>
        )}

        {/* ── Hermes ── */}
        <section className="space-y-2">
          <h3 className="label label-bright">Attach a Hermes Agent</h3>
          <p className="text-[11px] leading-relaxed text-[var(--faint)]">
            Optional, and it is the good path. Enable the API server in{" "}
            <span className="data">~/.hermes/.env</span> with{" "}
            <span className="data">API_SERVER_ENABLED=true</span> and an{" "}
            <span className="data">API_SERVER_KEY</span>, then run{" "}
            <span className="data">hermes gateway</span>. You do not need to touch CORS — every
            call goes through this server, not your browser.
          </p>
          <input
            className="field"
            placeholder={s.env.hermes_url || "http://localhost:8642"}
            value={form.hermes_url ?? ""}
            onChange={(e) => set("hermes_url", e.target.value)}
          />
          <input
            className="field"
            type="password"
            placeholder={s.secretsSet.hermes_key ? "•••• set" : "API_SERVER_KEY"}
            value={form.hermes_key ?? ""}
            onChange={(e) => set("hermes_key", e.target.value)}
          />
          <div className="flex gap-1.5">
            <button className="btn flex-1" onClick={() => check("hermes")} disabled={busy}>
              Test
            </button>
            <button
              className="btn flex-1"
              onClick={() => {
                set("hermes_url", "");
                set("hermes_key", "");
              }}
            >
              Detach
            </button>
          </div>
        </section>

        <div className="h-px bg-[var(--line)]" />

        {/* ── direct model ── */}
        <section className="space-y-2">
          <h3 className="label label-bright">Or talk to a model directly</h3>
          <p className="text-[11px] leading-relaxed text-[var(--faint)]">
            The same three variables every drop in this repo reads. Used when no agent is attached.
          </p>
          <div className="flex flex-wrap gap-1">
            {PROVIDERS.map((p) => (
              <button
                key={p.label}
                className="btn"
                style={{ padding: "4px 8px" }}
                onClick={() => {
                  set("llm_base_url", p.url);
                  set("llm_model", p.model);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <input
            className="field"
            placeholder={s.env.llm_base_url || "https://openrouter.ai/api/v1"}
            value={form.llm_base_url ?? ""}
            onChange={(e) => set("llm_base_url", e.target.value)}
          />
          <input
            className="field"
            placeholder={s.env.llm_model || "model id"}
            value={form.llm_model ?? ""}
            onChange={(e) => set("llm_model", e.target.value)}
          />
          <input
            className="field"
            type="password"
            placeholder={s.secretsSet.llm_api_key ? "•••• set" : "API key (blank for local)"}
            value={form.llm_api_key ?? ""}
            onChange={(e) => set("llm_api_key", e.target.value)}
          />
          <button className="btn w-full" onClick={() => check("direct")} disabled={busy}>
            Test
          </button>
        </section>

        {test && (
          <p
            className="rounded-[3px] border p-2.5 text-[11.5px] leading-relaxed"
            style={{
              borderColor: test.ok ? "var(--accent-dim)" : "hsl(8 92% 60% / 0.4)",
              color: test.ok ? "var(--accent)" : "hsl(8 92% 68%)",
              background: test.ok ? "var(--accent-ghost)" : "hsl(8 92% 60% / 0.07)",
            }}
          >
            {test.ok ? "✓ " : "✗ "}
            {test.text}
          </p>
        )}

        <div className="h-px bg-[var(--line)]" />

        {/* ── voice ── */}
        <section className="space-y-2">
          <h3 className="label label-bright">Voice</h3>

          {voice?.engine === "elevenlabs" ? (
            <>
              <p className="text-[11px] leading-relaxed text-[var(--faint)]">
                ElevenLabs is connected. Audio is proxied through this server, so the key never
                reaches your browser — and because it is a real audio stream, the orb is driven by
                the actual waveform rather than an approximation.
              </p>

              {voice.quota && (
                <div className="rounded-[3px] border border-[var(--line)] bg-black/40 p-2.5">
                  <div className="flex items-baseline justify-between">
                    <span className="label">{voice.quota.tier.toUpperCase()}</span>
                    <span className="data text-[10px] text-[var(--dim)]">
                      {voice.quota.remaining.toLocaleString()} of{" "}
                      {voice.quota.limit.toLocaleString()} characters left
                    </span>
                  </div>
                  <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full"
                      style={{
                        width: `${Math.max(0, Math.min(100, (voice.quota.remaining / Math.max(1, voice.quota.limit)) * 100))}%`,
                        background: "var(--accent)",
                      }}
                    />
                  </div>
                </div>
              )}

              <label className="label block">Voice</label>
              <select
                className="field"
                value={form.xi_voice_id || voice.voiceId || ""}
                onChange={(e) => set("xi_voice_id", e.target.value)}
              >
                {voice.voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                    {v.accent ? ` · ${v.accent}` : ""}
                  </option>
                ))}
              </select>

              <button
                className="btn w-full"
                onClick={() =>
                  onPreviewVoice(
                    "Deck online. Your model, your machine, no account.",
                    form.xi_voice_id || voice.voiceId || undefined,
                  )
                }
              >
                Hear it
              </button>
              <p className="text-[10.5px] leading-relaxed text-[var(--faint)]">
                Save to make the choice stick — the preview uses it immediately either way.
              </p>
            </>
          ) : (
            <>
              <p className="text-[11px] leading-relaxed text-[var(--faint)]">
                {voice?.reason ??
                  "Using the browser's own speech synthesis — free, offline, and it sounds like it."}{" "}
                Add an <span className="data">ELEVENLABS_API_KEY</span> to the repo-root{" "}
                <span className="data">.env</span>, or paste one here.
              </p>
              <input
                className="field"
                type="password"
                placeholder={s.secretsSet.xi_api_key ? "•••• set" : "ElevenLabs API key"}
                value={form.xi_api_key ?? ""}
                onChange={(e) => set("xi_api_key", e.target.value)}
              />
              <button
                className="btn w-full"
                onClick={() => onPreviewVoice("Deck online. Your model, your machine, no account.")}
              >
                Hear the browser voice
              </button>
            </>
          )}
        </section>

        <div className="h-px bg-[var(--line)]" />

        {/* ── sites ── */}
        <section className="space-y-2">
          <h3 className="label label-bright">Sites</h3>
          {sites?.dir ? (
            <>
              <p className="text-[11px] leading-relaxed text-[var(--faint)]">
                Reading <span className="data">{sites.dir}</span>. The agent knows these by name —
                ask it to pull one up.
              </p>
              <div className="space-y-1">
                {sites.sites.map((site) => (
                  <button
                    key={site.name}
                    onClick={() => onOpenSite(site.name)}
                    className="flex w-full items-baseline gap-2 rounded-[3px] border border-[var(--line)] px-2.5 py-2 text-left transition-colors hover:border-[var(--accent-dim)] hover:bg-[var(--accent-ghost)]"
                  >
                    <span className="data shrink-0 text-[11px] text-[var(--accent)]">
                      {site.name}
                    </span>
                    <span className="flex-1 truncate text-[11px] text-[var(--faint)]">
                      {site.title}
                    </span>
                  </button>
                ))}
                {sites.sites.length === 0 && (
                  <p className="label" style={{ color: "var(--faint)" }}>
                    NO .HTML FILES FOUND
                  </p>
                )}
              </div>
            </>
          ) : (
            <p className="text-[11px] leading-relaxed text-[var(--faint)]">
              {sites?.reason ?? "Loading…"}
            </p>
          )}
        </section>

        <button className="btn btn-accent w-full" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save settings"}
        </button>

        <p className="text-[10.5px] leading-relaxed text-[var(--faint)]">
          Saved to the local database and used ahead of the environment. Keys are never sent back to
          this page. Leave everything blank to fall back to the repo-root{" "}
          <span className="data">.env</span>.
        </p>
      </div>
    </Sheet>
  );
}
