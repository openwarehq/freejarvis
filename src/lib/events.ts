/**
 * One event vocabulary for the deck.
 *
 * Both brains emit these. Hermes' own SSE stream already speaks something very
 * close to it (`assistant.delta`, `tool.started`, `tool.completed`,
 * `run.completed`), so the adapter is a rename rather than a translation; the
 * standalone loop emits them directly. The UI never learns which brain it is
 * talking to — it renders events.
 */
export type DeckEvent =
  | { t: "run.started"; runId: string; sessionId: string }
  | { t: "assistant.delta"; text: string }
  | { t: "thinking.delta"; text: string }
  | { t: "tool.started"; id: string; name: string; args: string }
  | { t: "tool.progress"; id: string; text: string }
  | { t: "tool.completed"; id: string; name: string; ok: boolean; output: string }
  | { t: "approval.required"; id: string; name: string; args: string; reason: string }
  | { t: "run.completed"; runId: string; usage?: Usage }
  | { t: "run.failed"; message: string; hint?: string };

export type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
};

/** The five things the orb can be doing. Derived from the event stream. */
export type DeckState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "tool"
  | "awaiting-approval";

const encoder = new TextEncoder();

/** Serialise one event as an SSE frame. */
export function sse(event: DeckEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * Parse an SSE body into events, tolerating chunk boundaries that fall in the
 * middle of a frame. Returns a callback-driven reader rather than an async
 * iterator because both callers already own their loop.
 */
export function createSseParser(onFrame: (data: string) => void) {
  let buffer = "";
  return {
    push(chunk: string) {
      buffer += chunk;
      let split: number;
      // Frames end at a blank line. \r\n\r\n shows up from some proxies.
      while ((split = findFrameEnd(buffer)) !== -1) {
        const raw = buffer.slice(0, split);
        buffer = buffer.slice(split).replace(/^(\r?\n){2}/, "");
        for (const line of raw.split(/\r?\n/)) {
          if (line.startsWith("data:")) onFrame(line.slice(5).trim());
        }
      }
    },
  };
}

function findFrameEnd(s: string): number {
  const a = s.indexOf("\n\n");
  const b = s.indexOf("\r\n\r\n");
  if (a === -1) return b;
  if (b === -1) return a;
  return Math.min(a, b);
}
