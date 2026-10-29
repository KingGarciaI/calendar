import { NextResponse, type NextRequest } from "next/server";
import { DEV_COOKIE, devAuthEnabled } from "@/lib/auth-shared";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/login", req.url), { status: 303 });
  if (devAuthEnabled()) {
    res.cookies.delete(DEV_COOKIE);
    return res;
  }
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return res;
}
