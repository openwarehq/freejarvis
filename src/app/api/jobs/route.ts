import { NextResponse } from "next/server";
import { resolveBrain } from "@/lib/config";
import { createJob, listJobs } from "@/lib/db";
import { describeCron, isValidCron, nextRun } from "@/lib/cron";
import * as hermes from "@/lib/hermes";
import { startScheduler } from "@/lib/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type JobView = {
  id: string;
  owner: "local" | "hermes";
  name: string;
  schedule: string;
  scheduleLabel: string;
  prompt: string;
  enabled: boolean;
  nextRun: number | null;
  lastRunAt: number | null;
  lastStatus: string | null;
  lastOutput: string | null;
};

export async function GET() {
  startScheduler();

  const local: JobView[] = listJobs().map((j) => ({
    id: j.id,
    owner: "local",
    name: j.name,
    schedule: j.schedule,
    scheduleLabel: describeCron(j.schedule),
    prompt: j.prompt,
    enabled: !!j.enabled,
    nextRun: j.enabled ? (nextRun(j.schedule)?.getTime() ?? null) : null,
    lastRunAt: j.last_run_at,
    lastStatus: j.last_status,
    lastOutput: j.last_output,
  }));

  // When an agent is attached, its own cron is the better one — it can deliver
  // to Telegram or Discord, which nothing in here can. Show both, labelled.
  const brain = resolveBrain();
  let remote: JobView[] | null = null;
  if (brain.kind === "hermes") {
    const rows = await hermes.listJobs(brain);
    remote =
      rows?.map((j) => {
        const id = String(j.id ?? j.job_id ?? "");
        const schedule = String(j.schedule ?? (j as Record<string, unknown>).cron ?? "");
        return {
          id,
          owner: "hermes" as const,
          name: String(j.name ?? id),
          schedule,
          scheduleLabel: schedule ? describeCron(schedule) : "—",
          prompt: String(j.prompt ?? ""),
          enabled: j.enabled !== false && j.paused !== true,
          nextRun: schedule ? (nextRun(schedule)?.getTime() ?? null) : null,
          lastRunAt: null,
          lastStatus: null,
          lastOutput: null,
        };
      }) ?? null;
  }

  return NextResponse.json({ local, remote });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    schedule?: string;
    prompt?: string;
    owner?: "local" | "hermes";
  };
  const name = (body.name ?? "").trim();
  const schedule = (body.schedule ?? "").trim();
  const prompt = (body.prompt ?? "").trim();

  if (!name || !prompt) return NextResponse.json({ error: "name and prompt are required" }, { status: 400 });
  if (!isValidCron(schedule))
    return NextResponse.json(
      { error: `\`${schedule}\` is not a five-field cron expression. Try \`0 9 * * *\`.` },
      { status: 400 },
    );

  const brain = resolveBrain();
  if (body.owner === "hermes" && brain.kind === "hermes") {
    const r = await hermes.createJob(brain, { name, schedule, prompt });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
    return NextResponse.json({ job: r.data, owner: "hermes" });
  }

  startScheduler();
  return NextResponse.json({ job: createJob(name, schedule, prompt), owner: "local" });
}
