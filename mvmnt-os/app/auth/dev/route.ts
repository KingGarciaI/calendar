import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { DEV_COOKIE, devAuthEnabled, signDevSession } from "@/lib/auth-shared";
import { sql } from "@/lib/server/db";

/**
 * LOCAL DEVELOPMENT ONLY — disabled unless MVMNT_DEV_AUTH=1, a 32+ char
 * DEV_AUTH_SECRET is set, and the app is not running on Vercel.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled()) return NextResponse.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 });
  const parsed = z.object({ email: z.email() }).safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: { code: "invalid", message: "Courriel invalide" } }, { status: 400 });
  const email = parsed.data.email.toLowerCase();
  const db = sql();
  const existing = await db`select id from auth.users where email = ${email}`;
  const id = existing[0]?.id ?? (await db`insert into auth.users (email) values (${email}) returning id`)[0].id;
  const res = NextResponse.json({ data: { id, email } });
  res.cookies.set(DEV_COOKIE, await signDevSession(id, email), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return res;
}
