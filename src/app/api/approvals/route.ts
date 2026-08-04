import { NextResponse } from "next/server";
import { listApprovals } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const rows = listApprovals();
  return NextResponse.json({
    approvals: rows,
    pending: rows.filter((r) => r.status === "pending").length,
  });
}
