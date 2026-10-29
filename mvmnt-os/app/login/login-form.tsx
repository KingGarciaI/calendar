"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Spinner } from "@/components/ui/misc";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function LoginForm({ devMode, next, linkError }: { devMode: boolean; next?: string; linkError?: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"password" | "link">("password");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(linkError ? "Ce lien de connexion a expiré. Demandes-en un nouveau." : null);
  const [sent, setSent] = useState(false);
  const target = next?.startsWith("/") && !next.startsWith("//") ? next : "/";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (devMode) {
        const r = await fetch("/auth/dev", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
        if (!r.ok) throw new Error((await r.json()).error?.message ?? "Connexion impossible");
        window.location.href = target;
        return;
      }
      const supabase = createSupabaseBrowserClient();
      if (mode === "link") {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(target)}`, shouldCreateUser: false },
        });
        if (error) throw error;
        setSent(true);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message === "Invalid login credentials" ? "Courriel ou mot de passe incorrect." : error.message);
        window.location.href = target;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connexion impossible");
    } finally {
      setBusy(false);
    }
  };

  if (sent)
    return (
      <div className="mt-8 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <p className="font-semibold">Vérifie ta boîte courriel</p>
        <p className="mt-1 text-sm text-ink-2">Un lien de connexion a été envoyé à {email}. Ouvre-le sur cet appareil.</p>
      </div>
    );

  return (
    <form onSubmit={submit} className="mt-8 space-y-3">
      {devMode ? (
        <p className="rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">Mode développement local : connexion sans mot de passe.</p>
      ) : null}
      <Input type="email" required autoComplete="email" placeholder="Courriel" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Courriel" className="h-11" />
      {!devMode && mode === "password" ? (
        <Input type="password" required autoComplete="current-password" placeholder="Mot de passe" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Mot de passe" className="h-11" />
      ) : null}
      {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}
      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy}>
        {busy ? <Spinner className="h-4 w-4" /> : null}
        {devMode ? "Entrer" : mode === "link" ? "Recevoir un lien de connexion" : "Se connecter"}
      </Button>
      {!devMode ? (
        <button type="button" onClick={() => setMode(mode === "link" ? "password" : "link")} className="w-full pt-1 text-center text-sm text-ink-2 hover:text-ink">
          {mode === "link" ? "Utiliser mon mot de passe" : "Recevoir un lien par courriel plutôt"}
        </button>
      ) : null}
    </form>
  );
}
