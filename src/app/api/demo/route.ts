import { NextResponse } from "next/server";
import { chunk, count, PLACEHOLDER, SCRIPTS, scriptById } from "@/lib/demo";
import { sse } from "@/lib/events";
import { listJobs, listMemories, listSessions } from "@/lib/db";
import { builtinTools } from "@/lib/tools";
import { listSites } from "@/lib/sites";
import { voiceConfig } from "@/lib/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * `/api/chat`, but the answers come off a tape.
 *
 * It emits the identical DeckEvent stream in the identical SSE format, which
 * is the whole trick: the deck needs no demo branch, no mock components and no
 * second code path. Every pixel on screen is the real UI reacting to events
 * that look exactly like the real ones — because the only difference is who
 * decided them.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Nothing here is paced to the voice, on purpose.
 *
 * An earlier version held each line for its estimated spoken duration so that
 * visual events landed on the right word. Estimating from character count is
 * off by 15–27% on short sentences, and every one of those errors is either a
 * hole in the audio or an event that fires while the voice is three lines
 * back. There is no constant that fixes it, because the variance is in the
 * punctuation and the words themselves.
 *
 * So the whole script streams as fast as it renders, and the *client*
 * sequences it: sentences go into the speech queue and play back to back with
 * only the gap between two audio clips, and the tool is queued as an action
 * between them — firing off the real end of the real clip that precedes it.
 * See `enqueueAction` in `useSpeech`.
 */

/**
 * Fill a script's placeholders from the live system.
 *
 * The status report is the only part of a take that would be a lie if it were
 * written down, so it isn't — these are the tools actually loaded and the jobs
 * actually armed, read off the same places the panels read them from. If you
 * delete a job before filming, the line changes.
 */
function stats(): Record<string, string> {
  const safe = <T>(f: () => T, fallback: T): T => {
    try {
      return f();
    } catch {
      return fallback;
    }
  };
  return {
    tools: count(safe(() => builtinTools().length, 0), "tool"),
    memories: count(safe(() => listMemories(1000).length, 0), "memory", "memories"),
    jobs: count(safe(() => listJobs().filter((j) => j.enabled).length, 0), "job"),
    sessions: count(safe(() => listSessions(1000).length, 0), "session"),
    sites: count(safe(() => listSites().length, 0), "site"),
    voice: safe(() => (voiceConfig().enabled ? "ElevenLabs" : "browser synthesis"), "browser synthesis"),
  };
}

export async function GET() {
  return NextResponse.json({
    scripts: SCRIPTS.map((s) => ({ id: s.id, label: s.label, prompt: s.prompt })),
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { script?: string };
  const script = scriptById(body.script);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const runId = `run_demo_${Math.random().toString(36).slice(2, 8)}`;
      const facts = stats();
      let said = false;
      const push = (data: Uint8Array) => {
        try {
          controller.enqueue(data);
          return true;
        } catch {
          return false;
        }
      };

      push(sse({ t: "run.started", runId, sessionId: `demo_${script.id}` }));

      for (const step of script.steps) {
        if (req.signal.aborted) break;

        if (step.kind === "pause") {
          await sleep(step.ms);
          continue;
        }

        if (step.kind === "say") {
          // The separator matters more than it looks. Two `say` steps run
          // together produce "sir.I'll", and the sentence splitter needs real
          // whitespace after a full stop to call it a sentence — without this
          // the caption shows both lines at once and the voice says them as
          // one clip, which is exactly the beat the script exists to control.
          if (said) push(sse({ t: "assistant.delta", text: " " }));
          said = true;

          // A line that opens on a placeholder starts lowercase once it is
          // filled in — "nine tools online" — so the first letter is raised
          // after substitution rather than before.
          const filled = step.text.replace(PLACEHOLDER, (m, key: string) => facts[key] ?? m);
          const line = filled.charAt(0).toUpperCase() + filled.slice(1);
          for (const piece of chunk(line)) {
            if (req.signal.aborted) break;
            if (!push(sse({ t: "assistant.delta", text: piece }))) break;
            // Roughly the token cadence of a hosted model, with enough
            // jitter that it does not read as a typewriter effect. Every
            // sentence is therefore in the client's queue — and downloading —
            // long before the voice gets anywhere near it.
            await sleep(14 + Math.random() * 18);
          }
          continue;
        }

        const id = `call_demo_${Math.random().toString(36).slice(2, 8)}`;
        push(
          sse({
            t: "tool.started",
            id,
            name: step.name,
            args: JSON.stringify(step.args),
          }),
        );
        await sleep(step.runMs ?? 1200);
        push(
          sse({
            t: "tool.completed",
            id,
            name: step.name,
            ok: true,
            output: step.output ?? "Done.",
          }),
        );
      }

      push(sse({ t: "run.completed", runId }));
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Session-Id": `demo_${script.id}`,
      // So it is obvious in the network tab what this is.
      "X-Freejarvis-Mode": "demo",
    },
  });
}
