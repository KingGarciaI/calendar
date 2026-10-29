import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { DEV_COOKIE, devAuthEnabled, verifyDevSession } from "@/lib/auth-shared";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SessionUser = { id: string; email: string };

/** The authenticated user, verified server-side (never trusted from the client). */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  if (devAuthEnabled()) {
    const store = await cookies();
    return verifyDevSession(store.get(DEV_COOKIE)?.value);
  }
  const supabase = await createSupabaseServerClient();
  // getUser() validates the JWT with Supabase Auth — do not use getSession() here.
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? "" };
});

export class UnauthorizedError extends Error {
  constructor() {
    super("Non authentifié");
  }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new UnauthorizedError();
  return user;
}
