import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runReminders } from "@/lib/server/reminders";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Called every minute by Supabase pg_cron (or any scheduler) with `Authorization: Bearer CRON_SECRET`. */
async function handler(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: { code: "unauthorized", message: "Unauthorized" } }, { status: 401 });
  const result = await runReminders();
  return NextResponse.json({ data: result });
}

export const GET = handler;
export const POST = handler;
