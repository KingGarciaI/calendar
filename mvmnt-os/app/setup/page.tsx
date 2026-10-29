import { redirect } from "next/navigation";
import postgres from "postgres";
import { devAuthEnabled } from "@/lib/auth-shared";

export const dynamic = "force-dynamic";
export const metadata = { title: "Configuration" };

type Check = { label: string; ok: boolean; fix?: string; optional?: boolean };

async function dbChecks(): Promise<Check[]> {
  const url = process.env.DATABASE_URL;
  if (!url) return [];
  const sql = postgres(url, { prepare: false, max: 1, connect_timeout: 8, onnotice: () => {} });
  const out: Check[] = [];
  try {
    await sql`select 1`;
    out.push({ label: "Connexion à la base de données", ok: true });
    const [t] = await sql`select to_regclass('public.events') is not null as events, to_regclass('public.reminders') is not null as reminders`;
    out.push({ label: "Tables créées (migrations)", ok: !!t.events, fix: "Lance les migrations : DATABASE_URL=<session pooler> node scripts/migrate.mjs" });
    const [f] = await sql`select to_regprocedure('public.reminder_user_ids()') is not null as ok`;
    out.push({ label: "Migration des rappels", ok: !!f.ok, fix: "Applique supabase/migrations/20261029000002_reminders.sql" });
    const [r] = await sql`select pg_has_role(current_user, 'authenticated', 'member') as ok`;
    out.push({ label: "Le rôle de connexion peut agir comme utilisateur (RLS)", ok: !!r.ok, fix: "Dans Supabase → SQL Editor : grant authenticated to postgres;" });
  } catch (e) {
    const msg = (e as Error).message ?? "";
    out.push({
      label: "Connexion à la base de données",
      ok: false,
      fix: /password/i.test(msg)
        ? "Mot de passe refusé : vérifie le mot de passe dans DATABASE_URL."
        : /ENOTFOUND|getaddrinfo/i.test(msg)
          ? "Hôte introuvable : copie la chaîne « Transaction pooler » (port 6543) depuis Supabase."
          : "Vérifie DATABASE_URL (chaîne « Transaction pooler », port 6543).",
    });
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {});
  }
  return out;
}

export default async function SetupPage() {
  const env = (k: string) => !!process.env[k];
  const checks: Check[] = [
    { label: "NEXT_PUBLIC_SUPABASE_URL", ok: env("NEXT_PUBLIC_SUPABASE_URL") || devAuthEnabled(), fix: "Supabase → Project Settings → API → Project URL" },
    { label: "NEXT_PUBLIC_SUPABASE_ANON_KEY", ok: env("NEXT_PUBLIC_SUPABASE_ANON_KEY") || devAuthEnabled(), fix: "Supabase → Project Settings → API → clé anon public" },
    { label: "DATABASE_URL", ok: env("DATABASE_URL"), fix: "Supabase → Connect → Transaction pooler (port 6543)" },
    ...(await dbChecks()),
    { label: "ANTHROPIC_API_KEY (assistant)", ok: env("ANTHROPIC_API_KEY") || env("OPENAI_API_KEY"), optional: true },
    { label: "Clés VAPID (notifications push)", ok: env("NEXT_PUBLIC_VAPID_PUBLIC_KEY") && env("VAPID_PRIVATE_KEY"), optional: true },
    { label: "CRON_SECRET (rappels)", ok: (process.env.CRON_SECRET?.length ?? 0) >= 16, optional: true },
  ];
  const blocking = checks.filter((c) => !c.ok && !c.optional);
  if (!blocking.length) redirect("/");

  return (
    <main className="mx-auto max-w-[560px] px-5 py-12">
      <h1 className="text-2xl font-semibold tracking-[-0.015em]">Configuration incomplète</h1>
      <p className="mt-2 text-sm text-ink-2">
        MVMNT OS est déployé, mais il lui manque des réglages. Ajoute les variables manquantes dans Vercel → Settings → Environment Variables, puis <strong>redéploie</strong> (Deployments → ⋯ → Redeploy) : les variables ne sont prises en compte qu&apos;au déploiement suivant.
      </p>
      <ul className="mt-8 divide-y divide-line rounded-[12px] border border-line bg-surface">
        {checks.map((c) => (
          <li key={c.label} className="px-4 py-3">
            <p className="flex items-center gap-2.5 text-sm font-semibold">
              <span className={c.ok ? "text-success" : c.optional ? "text-ink-3" : "text-danger"}>{c.ok ? "✓" : c.optional ? "○" : "✕"}</span>
              {c.label}
              {c.optional && !c.ok ? <span className="font-normal text-ink-3">· facultatif pour démarrer</span> : null}
            </p>
            {!c.ok && c.fix ? <p className="mt-1 pl-6 text-xs text-ink-2">{c.fix}</p> : null}
          </li>
        ))}
      </ul>
      <p className="mt-6 text-xs text-ink-3">Cette page disparaît automatiquement dès que tout ce qui est obligatoire est en place.</p>
    </main>
  );
}
