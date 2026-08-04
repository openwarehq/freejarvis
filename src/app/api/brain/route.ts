import { NextResponse } from "next/server";
import { resolveBrain } from "@/lib/config";
import * as hermes from "@/lib/hermes";
import { builtinTools } from "@/lib/tools";
import { startScheduler } from "@/lib/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type BrainReport = {
  kind: "hermes" | "direct" | "none";
  label: string;
  detail: string;
  ready: boolean;
  model?: string;
  endpoint?: string;
  error?: string;
  hint?: string;
  /** Which deck panels have something real behind them right now. */
  backed: {
    sessions: boolean;
    memory: boolean;
    jobs: boolean;
    skills: boolean;
    toolsets: boolean;
    approvals: boolean;
    soul: boolean;
  };
  features?: Record<string, unknown>;
  toolCount?: number;
  skillCount?: number;
};

export async function GET() {
  startScheduler();
  const brain = resolveBrain();

  if (brain.kind === "none") {
    return NextResponse.json<BrainReport>({
      kind: "none",
      label: "NO BRAIN",
      detail: brain.reason,
      ready: false,
      hint: "Attach a Hermes Agent, or set LLM_BASE_URL and LLM_MODEL in the repo-root .env.",
      backed: {
        sessions: true,
        memory: true,
        jobs: true,
        skills: false,
        toolsets: true,
        approvals: true,
        soul: true,
      },
    });
  }

  if (brain.kind === "direct") {
    return NextResponse.json<BrainReport>({
      kind: "direct",
      label: "DIRECT",
      detail: `${new URL(brain.baseUrl).host} · ${brain.model}`,
      ready: true,
      model: brain.model,
      endpoint: brain.baseUrl,
      backed: {
        sessions: true,
        memory: true,
        jobs: true,
        skills: false,
        toolsets: true,
        approvals: true,
        soul: true,
      },
      toolCount: builtinTools().length,
    });
  }

  const st = await hermes.status(brain);
  const [sets, sk] = st.authed
    ? await Promise.all([hermes.toolsets(brain), hermes.skills(brain)])
    : [null, null];

  return NextResponse.json<BrainReport>({
    kind: "hermes",
    label: "HERMES",
    detail: st.authed ? `${new URL(brain.url).host} · ${brain.model}` : (st.error ?? "unreachable"),
    ready: st.reachable && st.authed,
    model: brain.model,
    endpoint: brain.url,
    error: st.error,
    hint: st.hint,
    features: st.capabilities?.features,
    toolCount: sets?.reduce((n, s) => n + (s.tools?.length ?? 0), 0),
    skillCount: sk?.length,
    backed: {
      sessions: true,
      memory: true,
      jobs: st.authed,
      skills: sk !== null,
      toolsets: sets !== null,
      approvals: true,
      soul: true,
    },
  });
}
