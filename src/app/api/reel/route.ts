import { isLive, lastFrame, onFrame } from "@/lib/screencast";

/**
 * Its own encoder rather than the deck's `sse`.
 *
 * That helper is typed to DeckEvent, and these are not deck events — a frame of
 * video is not something the agent said. Widening that union to let a picture
 * through would make every consumer of it handle a case it does not care about.
 */
const enc = new TextEncoder();
const sse = (o: unknown) => enc.encode(`data: ${JSON.stringify(o)}\n\n`);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The reel browser's screen, as an event stream.
 *
 * One frame per repaint, base64 JPEG, in the same SSE shape as everything else
 * on the deck. The last frame is sent immediately on connect so a viewer that
 * joins late — or reloads mid-run — sees the current state rather than a black
 * rectangle until the page next moves.
 */
export async function GET(req: Request) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (data: Uint8Array) => {
        try {
          controller.enqueue(data);
          return true;
        } catch {
          return false;
        }
      };

      const first = lastFrame();
      if (first) push(sse({ t: "reel.frame", data: first.data, live: isLive() }));

      const off = onFrame((f) => {
        if (!push(sse({ t: "reel.frame", data: f.data, live: isLive() }))) off();
      });

      // A heartbeat, so a proxy that times out idle connections does not cut
      // the feed between repaints on a page that is simply not moving.
      const beat = setInterval(() => {
        if (!push(sse({ t: "reel.beat", live: isLive() }))) {
          clearInterval(beat);
          off();
        }
      }, 15_000);

      req.signal.addEventListener("abort", () => {
        clearInterval(beat);
        off();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
