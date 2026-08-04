import { NextResponse } from "next/server";
import { deleteSession, getSession, listMessages, touchSession } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: "no such session" }, { status: 404 });
  return NextResponse.json({ session, messages: listMessages(id) });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { title?: string };
  if (body.title) touchSession(id, body.title);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  deleteSession(id);
  return NextResponse.json({ ok: true });
}
