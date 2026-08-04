import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { startScheduler } from "@/lib/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    getDb().prepare("SELECT 1").get();
    // The container healthcheck hits this, which makes it the earliest
    // reliable moment to have the scheduler running.
    startScheduler();
    return NextResponse.json({ status: "ok" });
  } catch (e) {
    return NextResponse.json({ status: "degraded", error: (e as Error).message }, { status: 503 });
  }
}
