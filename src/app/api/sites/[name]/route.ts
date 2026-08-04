import { readSite } from "@/lib/sites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ name: string }> };

/**
 * Serve one site into the deck's frame.
 *
 * It is served from this origin so the iframe is same-origin and the deck can
 * read its title, but it is somebody else's markup — so it goes out sandboxed
 * at the frame, and with `X-Frame-Options` left off deliberately since the
 * whole point is that it is framed here.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const { name } = await params;
  const html = readSite(name);
  if (html === null) return new Response("No such site.", { status: 404 });

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
