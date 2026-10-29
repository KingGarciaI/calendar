/**
 * Shared between middleware (edge) and server code. No Node-only imports.
 *
 * Local development mode: when MVMNT_DEV_AUTH=1 (and never on Vercel), the
 * app can run without a Supabase project, using an HMAC-signed cookie. It
 * exists so the whole app can be tested against a plain local Postgres.
 */

export const DEV_COOKIE = "mvmnt_dev_session";

export function devAuthEnabled(): boolean {
  return (
    process.env.MVMNT_DEV_AUTH === "1" &&
    !process.env.VERCEL &&
    (process.env.DEV_AUTH_SECRET?.length ?? 0) >= 32
  );
}

const enc = new TextEncoder();

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(process.env.DEV_AUTH_SECRET!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export async function signDevSession(userId: string, email: string): Promise<string> {
  const payload = btoa(JSON.stringify({ id: userId, email })).replace(/=+$/, "");
  return `${payload}.${await hmac(payload)}`;
}

export async function verifyDevSession(token: string | undefined): Promise<{ id: string; email: string } | null> {
  if (!token || !devAuthEnabled()) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = await hmac(payload);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const data = JSON.parse(atob(payload));
    if (typeof data.id === "string" && typeof data.email === "string") return data;
  } catch {}
  return null;
}
