// Applies supabase/migrations/*.sql in order, once each.
// Usage: DATABASE_URL=postgres://... node scripts/migrate.mjs [--with-test-shim]
// Against Supabase use the *direct* or *session* connection string (not the
// transaction pooler) — DDL needs a session.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  if (process.argv.includes("--with-test-shim")) {
    const shim = await readFile(path.join(root, "supabase/local-test/00_supabase_shim.sql"), "utf8");
    await sql.unsafe(shim);
    console.log("✓ test shim");
  }
  await sql`create table if not exists public.schema_migrations (version text primary key, applied_at timestamptz not null default now())`;
  await sql`revoke all on public.schema_migrations from public`;
  const dir = path.join(root, "supabase/migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const applied = new Set((await sql`select version from public.schema_migrations`).map((r) => r.version));
  for (const file of files) {
    if (applied.has(file)) continue;
    const body = await readFile(path.join(dir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into public.schema_migrations (version) values (${file})`;
    });
    console.log("✓", file);
  }
  await sql`revoke all on public.schema_migrations from anon, authenticated`.catch(() => {});
  console.log("Migrations up to date.");
} catch (err) {
  console.error("Migration failed:", err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
