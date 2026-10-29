"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Sparkles } from "lucide-react";
import { ASK_KEY } from "@/components/assistant/assistant-panel";
import { useInspector, useIsDesktop } from "@/components/shell/inspector";
import { cn } from "@/lib/utils";

const EXAMPLES = ["Organise ma journée", "Qu'est-ce qui est urgent cette semaine ?", "Ajoute un tournage demain à 10 h", "Combien d'heures libres j'ai vendredi ?"];

/** Quick command field: hands the question to the assistant (side panel on desktop, full page on mobile). */
export function AskBar({ className }: { className?: string }) {
  const [q, setQ] = useState("");
  const router = useRouter();
  const isDesktop = useIsDesktop();
  const { open, close } = useInspector();

  const ask = (text: string) => {
    const t = text.trim();
    if (!t) return;
    try {
      sessionStorage.setItem(ASK_KEY, t);
    } catch {}
    setQ("");
    if (isDesktop) {
      close();
      // remount the panel so it picks up the pending question
      setTimeout(() => open({ kind: "assistant" }), 0);
    } else router.push("/assistant");
  };

  return (
    <div className={className}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
        className="flex items-center gap-3 rounded-[14px] border border-line bg-surface py-1.5 pl-4 pr-1.5 transition-colors focus-within:border-accent"
      >
        <Sparkles className="h-4 w-4 shrink-0 text-accent-text" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Demande quelque chose à ton assistant…"
          aria-label="Demander à l'assistant"
          className="h-9 min-w-0 flex-1 bg-transparent text-[15px] placeholder:text-ink-3 focus:outline-none"
        />
        <button type="submit" disabled={!q.trim()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-accent text-accent-fg disabled:opacity-30" aria-label="Envoyer">
          <ArrowUp className="h-4 w-4" />
        </button>
      </form>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {EXAMPLES.map((e) => (
          <button key={e} onClick={() => ask(e)} className={cn("rounded-full px-2.5 py-1 text-xs text-ink-3 hover:bg-surface-2 hover:text-ink")}>
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
