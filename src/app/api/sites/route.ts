import { NextResponse } from "next/server";
import { listSites, SITES_DIR } from "@/lib/sites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    dir: SITES_DIR || null,
    sites: listSites(),
    reason: SITES_DIR
      ? null
      : "SITES_DIR is not set. Point it at a folder of .html files and the agent can pull any of them up by name.",
  });
}
