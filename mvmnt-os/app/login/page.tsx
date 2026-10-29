import { redirect } from "next/navigation";
import { devAuthEnabled } from "@/lib/auth-shared";
import { getSessionUser } from "@/lib/server/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "Connexion" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  if (await getSessionUser()) redirect(sp.next?.startsWith("/") ? sp.next : "/");
  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="w-full max-w-[360px]">
        <div className="mb-10 flex items-center gap-2.5">
          <svg viewBox="0 0 24 24" className="h-8 w-8" aria-hidden>
            <rect width="24" height="24" rx="6" fill="var(--accent)" />
            <path d="M6 17V7.5l6 6 6-6V17" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-lg font-bold tracking-[0.06em]">MVMNT</span>
          <span className="text-lg text-ink-3">OS</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-[-0.015em]">Ta journée, en ordre.</h1>
        <p className="mt-2 text-sm text-ink-2">Connecte-toi pour retrouver ton calendrier, tes tâches et ton assistant.</p>
        <LoginForm devMode={devAuthEnabled()} next={sp.next} linkError={sp.error === "link"} />
      </div>
    </main>
  );
}
