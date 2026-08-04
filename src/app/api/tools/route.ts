import { NextResponse } from "next/server";
import { resolveBrain, SHELL_ENABLED } from "@/lib/config";
import * as hermes from "@/lib/hermes";
import { builtinTools } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type ToolsetView = {
  name: string;
  label: string;
  enabled: boolean;
  tools: { name: string; description?: string; gated?: boolean }[];
};

export async function GET() {
  const brain = resolveBrain();

  if (brain.kind === "hermes") {
    const [sets, skills] = await Promise.all([hermes.toolsets(brain), hermes.skills(brain)]);
    if (sets === null) {
      return NextResponse.json({
        owner: "hermes",
        available: false,
        reason:
          "This Hermes build does not serve /v1/toolsets. Everything else still works — the agent has its tools, this panel just cannot enumerate them.",
        toolsets: [],
        skills: skills ?? [],
      });
    }
    return NextResponse.json({
      owner: "hermes",
      available: true,
      toolsets: sets.map<ToolsetView>((s) => ({
        name: s.name,
        label: s.label ?? s.name,
        enabled: s.enabled !== false,
        tools: (s.tools ?? []).map((t) => ({ name: t })),
      })),
      skills: skills ?? [],
    });
  }

  return NextResponse.json({
    owner: "local",
    available: true,
    shellEnabled: SHELL_ENABLED,
    toolsets: [
      {
        name: "builtin",
        label: "freejarvis built-ins",
        enabled: true,
        tools: builtinTools().map((t) => ({
          name: t.name,
          description: t.description,
          gated: t.gated,
        })),
      },
    ] satisfies ToolsetView[],
    skills: [],
  });
}
