import { NextResponse } from "next/server";
import { resolveBrain } from "@/lib/config";
import { deleteJob, getJob, setJobEnabled } from "@/lib/db";
import * as hermes from "@/lib/hermes";
import { runJob } from "@/lib/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

type Ctx = { params: Promise<{ id: string }> };

function owner(req: Request): "local" | "hermes" {
  return new URL(req.url).searchParams.get("owner") === "hermes" ? "hermes" : "local";
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { enabled?: boolean; run?: boolean };
  const brain = resolveBrain();

  if (owner(req) === "hermes" && brain.kind === "hermes") {
    const action = body.run ? "run" : body.enabled === false ? "pause" : "resume";
    const r = await hermes.jobAction(brain, id, action);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
    return NextResponse.json({ ok: true });
  }

  const job = getJob(id);
  if (!job) return NextResponse.json({ error: "no such job" }, { status: 404 });

  if (body.run) {
    // Fire and forget: a job can take minutes, and the button should not be
    // the thing holding the connection open.
    void runJob(job.id, job.name, job.prompt);
    return NextResponse.json({ ok: true, started: true });
  }
  if (typeof body.enabled === "boolean") setJobEnabled(id, body.enabled);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  const brain = resolveBrain();
  if (owner(req) === "hermes" && brain.kind === "hermes") {
    const r = await hermes.deleteJob(brain, id);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
    return NextResponse.json({ ok: true });
  }
  deleteJob(id);
  return NextResponse.json({ ok: true });
}
