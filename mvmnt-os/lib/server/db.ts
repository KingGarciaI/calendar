import "server-only";
import postgres, { type Sql, type TransactionSql } from "postgres";

/**
 * Server-side Postgres access.
 *
 * Every query that touches user data runs inside `withUser()`, which opens a
 * transaction, switches to the `authenticated` role and sets the JWT claims
 * exactly like Supabase's API gateway does. Row Level Security therefore
 * applies to the app, the AI assistant and any future MCP server alike —
 * nobody gets admin privileges on user data.
 */

declare global {
  // eslint-disable-next-line no-var
  var __mvmntSql: Sql | undefined;
}

function createClient(): Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  return postgres(url, {
    // Supabase transaction pooler does not support prepared statements.
    prepare: false,
    max: process.env.VERCEL ? 3 : 10,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
    types: {
      // Keep DATE and TIME as plain strings ("2026-10-29", "13:00:00").
      date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
    },
  });
}

export function sql(): Sql {
  if (!globalThis.__mvmntSql) globalThis.__mvmntSql = createClient();
  return globalThis.__mvmntSql;
}

export type Tx = TransactionSql;

export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("Invalid user id");
  return sql().begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`;
    await tx.unsafe("set local role authenticated");
    return fn(tx);
  }) as Promise<T>;
}
