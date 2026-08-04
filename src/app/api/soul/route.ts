import { NextResponse } from "next/server";
import { DEFAULT_SOUL, estimateTokens, readSoul, writeSoul } from "@/lib/soul";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const body = readSoul();
  return NextResponse.json({ body, tokens: estimateTokens(body) });
}

export async function PUT(req: Request) {
  const payload = (await req.json().catch(() => ({}))) as { body?: string; reset?: boolean };
  const body = payload.reset ? DEFAULT_SOUL : (payload.body ?? "");
  try {
    writeSoul(body);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, body, tokens: estimateTokens(body) });
}
