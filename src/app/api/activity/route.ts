import { NextResponse } from "next/server";
import { listActivity } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ activity: listActivity() });
}
