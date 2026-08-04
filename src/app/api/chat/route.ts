import { titleFrom } from "@/lib/agent";
import { createSession, getSession, logActivity, touchSession } from "@/lib/db";
import { sse } from "@/lib/events";
import { runPrompt } from "@/lib/runner";
import { startScheduler } from "@/lib/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A tool-using turn can sit on an approval for minutes. Next's default would
// cut the stream long before the owner has finished reading the card.
export const maxDuration = 600;

export async function POST(req: Request) {
  startScheduler();

  const body = (await req.json().catch(() => ({}))) as {
    input?: string;
    sessionId?: string;
  };
  const input = (body.input ?? "").trim();
  if (!input) return new Response("input is required", { status: 400 });

  let sessionId = body.sessionId ?? "";
  if (!sessionId || !getSession(sessionId)) {
    sessionId = createSession(titleFrom(input)).id;
  } else {
    const s = getSession(sessionId)!;
    if (s.title === "New session") touchSession(sessionId, titleFrom(input));
  }

  logActivity("turn", input.slice(0, 120));

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const close = () => {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      try {
        for await (const ev of runPrompt({ sessionId, input, signal: req.signal })) {
          controller.enqueue(sse(ev));
        }
      } catch (e) {
        if (!req.signal.aborted) {
          controller.enqueue(
            sse({ t: "run.failed", message: (e as Error).message }),
          );
        }
      }
      close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Nginx buffers SSE into uselessness unless told not to.
      "X-Accel-Buffering": "no",
      "X-Session-Id": sessionId,
    },
  });
}
