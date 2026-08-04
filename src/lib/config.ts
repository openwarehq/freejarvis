import { getSetting } from "./db";

export type Brain =
  | {
      kind: "hermes";
      url: string;
      key: string;
      model: string;
    }
  | {
      kind: "direct";
      baseUrl: string;
      model: string;
      apiKey: string;
      /** Anthropic speaks a different wire format on the same three variables. */
      wire: "openai" | "anthropic";
    }
  | { kind: "none"; reason: string };

/**
 * Docker cannot reach the host's localhost. A Hermes Agent running on the host
 * — the overwhelmingly common case, since it is a CLI you install for yourself
 * — is at `host.docker.internal`, which compose maps for us. Rewriting here
 * means the same `.env` works inside and outside the container, which is the
 * whole point of the repo-root config.
 */
export function hostRewrite(url: string): string {
  if (!process.env.IN_DOCKER) return url;
  return url.replace(
    /^(https?:\/\/)(localhost|127\.0\.0\.1)(?=[:/]|$)/,
    "$1host.docker.internal",
  );
}

function clean(v: string | undefined | null): string {
  return (v ?? "").trim().replace(/\/+$/, "");
}

/**
 * Settings written from the UI beat the environment. A drop you can configure
 * from its own settings panel is a drop you can hand to someone who has never
 * opened a `.env`, and the file still works for people who prefer it.
 */
export function resolveBrain(): Brain {
  const hermesUrl = clean(getSetting("hermes_url") ?? process.env.HERMES_URL);
  const hermesKey = (getSetting("hermes_key") ?? process.env.HERMES_KEY ?? "").trim();

  if (hermesUrl) {
    return {
      kind: "hermes",
      url: hostRewrite(hermesUrl),
      key: hermesKey,
      model:
        (getSetting("hermes_model") ?? process.env.HERMES_MODEL ?? "hermes-agent").trim(),
    };
  }

  const baseUrl = clean(getSetting("llm_base_url") ?? process.env.LLM_BASE_URL);
  const model = (getSetting("llm_model") ?? process.env.LLM_MODEL ?? "").trim();
  const apiKey = (getSetting("llm_api_key") ?? process.env.LLM_API_KEY ?? "").trim();

  if (!baseUrl || !model) {
    return {
      kind: "none",
      reason: !baseUrl
        ? "No brain configured. Attach a Hermes Agent, or set LLM_BASE_URL and LLM_MODEL."
        : "LLM_BASE_URL is set but LLM_MODEL is empty.",
    };
  }

  return {
    kind: "direct",
    baseUrl: hostRewrite(baseUrl),
    model,
    apiKey,
    wire: /api\.anthropic\.com/.test(baseUrl) ? "anthropic" : "openai",
  };
}

export const DATA_DIR = process.env.DATA_DIR || "./data";
export const DB_PATH = process.env.DB_PATH || `${DATA_DIR}/freejarvis.db`;
export const SOUL_PATH = process.env.SOUL_PATH || `${DATA_DIR}/SOUL.md`;
export const WORKSPACE_DIR = process.env.WORKSPACE_DIR || `${DATA_DIR}/workspace`;

/**
 * The shell tool is off unless you turn it on, and even on it asks first.
 * A web page that can run commands on the host is a different threat model
 * than a web page that can read a file, and the difference should be a
 * deliberate line in a `.env`, not a default.
 */
export const SHELL_ENABLED = process.env.FREEJARVIS_SHELL === "1";
