import { NextResponse } from "next/server";
import { addMemory, deleteMemory, listMemories, searchMemories } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  return NextResponse.json({ memories: q ? searchMemories(q, 100) : listMemories(200) });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { body?: string; tag?: string };
  if (!body.body?.trim()) return NextResponse.json({ error: "body required" }, { status: 400 });
  return NextResponse.json({ memory: addMemory(body.body.trim(), body.tag || "note") });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  deleteMemory(id);
  return NextResponse.json({ ok: true });
}
