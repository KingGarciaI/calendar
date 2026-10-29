"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Check, CircleSlash, History, Loader2, Plus, Sparkles, TriangleAlert, X } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import { useInvalidateData } from "@/lib/client/hooks";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/overlay";
import { cn } from "@/lib/utils";

type Block =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | { type: "tool_result"; call_id: string; name: string; result: unknown; is_error?: boolean }
  | { type: "action"; action_id: string; tool: string; summary: string; status: "proposed" | "executed" | "rejected" | "failed"; error?: string };
type Message = { id: string; role: "user" | "assistant"; content: Block[]; created_at: string };

const CONV_KEY = "mvmnt.assistant.conversation";
export const ASK_KEY = "mvmnt.assistant.pending";

const SUGGESTIONS = [
  "Qu'est-ce que j'ai à faire aujourd'hui ?",
  "Qu'est-ce qui est urgent cette semaine ?",
  "Organise ma journée de demain selon mes priorités.",
  "Combien d'heures libres j'ai vendredi ?",
  "Quelles tâches je repousse depuis trop longtemps ?",
];

const READ_LABELS: Record<string, string> = {
  get_day_schedule: "Lecture de ton horaire",
  get_week_schedule: "Lecture de ta semaine",
  get_events: "Lecture du calendrier",
  get_event: "Lecture d'un événement",
  get_tasks: "Lecture des tâches",
  get_task: "Lecture d'une tâche",
  get_priorities: "Analyse des priorités",
  get_upcoming_deadlines: "Lecture des échéances",
  get_projects: "Lecture des projets",
  get_project: "Lecture d'un projet",
  get_categories: "Lecture des catégories",
  find_available_slots: "Recherche de disponibilités",
  check_conflicts: "Vérification des conflits",
};

/** Tiny, safe markdown: **bold**, bullet lists, paragraphs. */
function Prose({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let list: string[] = [];
  const inline = (s: string, k: number) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? <strong key={`${k}-${i}`} className="font-semibold">{part.slice(2, -2)}</strong> : <span key={`${k}-${i}`}>{part}</span>,
    );
  const flush = () => {
    if (list.length) {
      out.push(
        <ul key={`l${out.length}`} className="my-1.5 space-y-1 pl-4">
          {list.map((li, i) => (
            <li key={i} className="list-disc marker:text-ink-3">
              {inline(li, i)}
            </li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  lines.forEach((l, i) => {
    const m = l.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
    if (m) return void list.push(m[1]);
    flush();
    if (l.trim()) out.push(<p key={`p${i}`} className="my-1">{inline(l.replace(/^#+\s*/, ""), i)}</p>);
  });
  flush();
  return <div className="text-[14px] leading-relaxed">{out}</div>;
}

function ActionCard({ block, onDecide, busy }: { block: Extract<Block, { type: "action" }>; onDecide?: (d: "approve" | "reject") => void; busy?: boolean }) {
  const s = block.status;
  return (
    <div
      className={cn(
        "my-2 rounded-[10px] border px-3.5 py-3",
        s === "proposed" && "border-accent/40 bg-accent-soft",
        s === "executed" && "border-line bg-surface",
        s === "rejected" && "border-line bg-surface opacity-70",
        s === "failed" && "border-danger/40 bg-danger-soft",
      )}
    >
      <p className="flex items-center gap-2 text-xs font-semibold">
        {s === "proposed" ? <span className="text-accent-text">Proposé · en attente de ta confirmation</span> : null}
        {s === "executed" ? (
          <span className="flex items-center gap-1 text-success">
            <Check className="h-3.5 w-3.5" /> Exécuté
          </span>
        ) : null}
        {s === "rejected" ? (
          <span className="flex items-center gap-1 text-ink-3">
            <CircleSlash className="h-3.5 w-3.5" /> Refusé
          </span>
        ) : null}
        {s === "failed" ? (
          <span className="flex items-center gap-1 text-danger">
            <TriangleAlert className="h-3.5 w-3.5" /> Échec
          </span>
        ) : null}
      </p>
      <p className="mt-1 text-sm">{block.summary}</p>
      {block.error ? <p className="mt-1 text-xs text-danger">{block.error}</p> : null}
      {s === "proposed" && onDecide ? (
        <div className="mt-2.5 flex gap-2">
          <button disabled={busy} onClick={() => onDecide("approve")} className="h-8 rounded-[var(--radius-ctl)] bg-accent px-3 text-xs font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-50">
            Confirmer
          </button>
          <button disabled={busy} onClick={() => onDecide("reject")} className="h-8 rounded-[var(--radius-ctl)] border border-line bg-surface px-3 text-xs font-semibold hover:bg-surface-hover disabled:opacity-50">
            Refuser
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AssistantPanel({ compact }: { compact?: boolean }) {
  const qc = useQueryClient();
  const invalidate = useInvalidateData();
  const [convId, setConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [statuses, setStatuses] = useState<Record<string, { status: "proposed" | "executed" | "rejected" | "failed"; error?: string }>>({});
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const started = useRef(false);

  const { data: history = [] } = useQuery({
    queryKey: ["ai-conversations"],
    queryFn: () => api.get<{ id: string; title: string; updated_at: string }[]>("/api/ai/conversations"),
  });

  const load = async (id: string) => {
    try {
      const c = await api.get<{ messages: Message[]; actions: Record<string, { status: "proposed"; error?: string }> }>(`/api/ai/conversations/${id}`);
      setConvId(id);
      setMessages(c.messages);
      setStatuses(c.actions);
      try {
        localStorage.setItem(CONV_KEY, id);
      } catch {}
    } catch {
      newConversation();
    }
  };

  const newConversation = () => {
    setConvId(null);
    setMessages([]);
    setStatuses({});
    setError(null);
    try {
      localStorage.removeItem(CONV_KEY);
    } catch {}
    inputRef.current?.focus();
  };

  const send = async (text: string, conv = convId) => {
    const msg = text.trim();
    if (!msg || thinking) return;
    setError(null);
    setInput("");
    setThinking(true);
    const optimistic: Message = { id: `tmp-${Date.now()}`, role: "user", content: [{ type: "text", text: msg }], created_at: new Date().toISOString() };
    setMessages((m) => [...m, optimistic]);
    try {
      const r = await api.post<{ conversation_id: string; messages: Message[] }>("/api/ai/chat", { conversation_id: conv ?? undefined, message: msg });
      setConvId(r.conversation_id);
      try {
        localStorage.setItem(CONV_KEY, r.conversation_id);
      } catch {}
      setMessages((m) => [...m.filter((x) => x.id !== optimistic.id), ...r.messages]);
      if (r.messages.some((m) => m.content.some((b) => b.type === "action" && b.status === "executed"))) await invalidate();
      qc.invalidateQueries({ queryKey: ["ai-conversations"] });
    } catch (e) {
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      setInput(msg);
      setError(e instanceof ApiError ? e.message : "L'assistant n'a pas pu répondre.");
    } finally {
      setThinking(false);
    }
  };

  const decide = async (actionId: string, decision: "approve" | "reject") => {
    setDeciding(actionId);
    try {
      const r = await api.post<{ status: "executed" | "rejected" | "failed"; error?: string; message: Message | null }>(`/api/ai/actions/${actionId}`, { decision });
      setStatuses((s) => ({ ...s, [actionId]: { status: r.status, error: r.error } }));
      if (r.message) setMessages((m) => [...m, r.message!]);
      if (r.status === "executed") await invalidate();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Impossible d'appliquer cette décision.");
    } finally {
      setDeciding(null);
    }
  };

  // Resume the last conversation, or run a question handed over by the ask bar.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let pending: string | null = null;
    let last: string | null = null;
    try {
      pending = sessionStorage.getItem(ASK_KEY);
      sessionStorage.removeItem(ASK_KEY);
      last = localStorage.getItem(CONV_KEY);
    } catch {}
    if (pending) void send(pending, null);
    else if (last) void load(last);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, thinking]);

  // Only the final status of an action matters for display; hide the duplicate "decision" notes.
  const rendered = messages.filter((m) => !(m.role === "user" && m.content.every((b) => b.type === "action")));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cn("flex items-center justify-between gap-2 px-4 md:px-5", compact ? "pb-2" : "py-3")}>
        {!compact ? <h1 className="text-xl font-semibold tracking-[-0.01em]">Assistant</h1> : <span />}
        <div className="flex items-center gap-1">
          {history.length ? (
            <Menu>
              <MenuTrigger asChild>
                <button className="rounded-md p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Conversations précédentes">
                  <History className="h-4 w-4" />
                </button>
              </MenuTrigger>
              <MenuContent className="max-h-80 w-72 overflow-y-auto">
                {history.map((h) => (
                  <MenuItem key={h.id} onSelect={() => load(h.id)} className={cn("truncate", h.id === convId && "font-semibold")}>
                    <span className="truncate">{h.title || "Sans titre"}</span>
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
          ) : null}
          <button onClick={newConversation} className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold text-ink-3 hover:bg-surface-2 hover:text-ink">
            <Plus className="h-3.5 w-3.5" /> Nouvelle
          </button>
        </div>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 md:px-5">
        {rendered.length === 0 && !thinking ? (
          <div className="flex h-full flex-col justify-end pb-4">
            <Sparkles className="mb-3 h-5 w-5 text-accent-text" />
            <p className="text-[15px] font-semibold">Demande-moi ce que tu veux sur ton horaire.</p>
            <p className="mt-1 text-sm text-ink-2">Je lis ton calendrier et tes tâches, et je peux les modifier. Je te demande toujours avant de supprimer ou de déplacer un rendez-vous.</p>
            <div className="mt-4 flex flex-col items-start gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-full border border-line px-3 py-1.5 text-left text-[13px] text-ink-2 hover:border-accent hover:text-accent-text">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {rendered.map((m) => {
              if (m.role === "user" && m.content.some((b) => b.type === "text")) {
                const t = m.content.find((b) => b.type === "text") as { text: string };
                return (
                  <div key={m.id} className="flex justify-end">
                    <p className="max-w-[85%] whitespace-pre-wrap rounded-[14px] rounded-br-[4px] bg-surface-2 px-3.5 py-2 text-[14px]">{t.text}</p>
                  </div>
                );
              }
              const blocks = m.content.filter((b) => b.type === "text" || b.type === "action" || (b.type === "tool_call" && READ_LABELS[b.name]));
              if (!blocks.length) return null;
              return (
                <div key={m.id}>
                  {blocks.map((b, i) => {
                    if (b.type === "text") return b.text ? <Prose key={i} text={b.text} /> : null;
                    if (b.type === "tool_call") return <p key={i} className="text-xs text-ink-3">{READ_LABELS[b.name]}…</p>;
                    if (b.type === "action") {
                      const st = statuses[b.action_id];
                      const merged = st ? { ...b, status: st.status, error: st.error ?? b.error } : b;
                      return <ActionCard key={i} block={merged as typeof b} busy={deciding === b.action_id} onDecide={(d) => decide(b.action_id, d)} />;
                    }
                    return null;
                  })}
                </div>
              );
            })}
            {thinking ? (
              <p className="flex items-center gap-2 text-sm text-ink-3">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Je regarde…
              </p>
            ) : null}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <div className="px-4 pb-4 pt-2 md:px-5">
        {error ? (
          <p className="mb-2 flex items-start justify-between gap-2 rounded-md bg-danger-soft px-3 py-2 text-xs text-danger" role="alert">
            {error}
            <button onClick={() => setError(null)} aria-label="Fermer">
              <X className="h-3.5 w-3.5" />
            </button>
          </p>
        ) : null}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          className="flex items-end gap-2 rounded-[14px] border border-line bg-surface p-1.5 pl-3.5 focus-within:border-accent"
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={1}
            placeholder="Demain matin, bloque-moi 3 h pour monter les vidéos de Georgio…"
            aria-label="Message à l'assistant"
            className="max-h-36 min-h-9 flex-1 resize-none bg-transparent py-2 text-[14px] placeholder:text-ink-3 focus:outline-none"
          />
          <button type="submit" disabled={!input.trim() || thinking} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-accent text-accent-fg disabled:opacity-35" aria-label="Envoyer">
            {thinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </form>
      </div>
    </div>
  );
}
