import { NextResponse } from "next/server";
import { createSession, listSessions } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ sessions: listSessions() });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { title?: string };
  return NextResponse.json({ session: createSession(body.title || "New session") });
}
