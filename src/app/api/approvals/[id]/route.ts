import { NextResponse } from "next/server";
import { resolveBrain } from "@/lib/config";
import { decideApproval, getApproval, logActivity } from "@/lib/db";
import * as hermes from "@/lib/hermes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    decision?: "approve" | "deny";
    owner?: "local" | "hermes";
  };
  const decision = body.decision === "approve" ? "approve" : "deny";

  // A Hermes run gates on Hermes' side; the id is its run id, not ours.
  if (body.owner === "hermes") {
    const brain = resolveBrain();
    if (brain.kind !== "hermes")
      return NextResponse.json({ error: "no agent attached" }, { status: 409 });
    const r = await hermes.resolveApproval(brain, id, decision);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
    return NextResponse.json({ ok: true });
  }

  const row = getApproval(id);
  if (!row) return NextResponse.json({ error: "no such approval" }, { status: 404 });
  if (row.status !== "pending")
    return NextResponse.json({ error: `already ${row.status}` }, { status: 409 });

  decideApproval(id, decision === "approve" ? "approved" : "denied");
  logActivity("approval", `${row.tool_name} ${decision === "approve" ? "approved" : "denied"}`);
  return NextResponse.json({ ok: true });
}
