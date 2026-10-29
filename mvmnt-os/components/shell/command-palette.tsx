"use client";
import { Command } from "cmdk";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { CalendarDays, CalendarPlus, CheckSquare, FolderKanban, LayoutGrid, ListPlus, Moon, Search, Settings, Sparkles, Sun } from "lucide-react";
import { DateTime } from "luxon";
import { api } from "@/lib/client/api";
import { useMe } from "@/lib/client/hooks";
import { newEventDraft, useInspector } from "@/components/shell/inspector";
import { Dot } from "@/components/ui/misc";

type Results = {
  tasks: { id: string; title: string; status: string; due_date: string | null }[];
  projects: { id: string; name: string; color: string; status: string }[];
  events: { id: string; title: string; start_at: string; recurring: boolean }[];
};

const item =
  "flex h-10 cursor-default items-center gap-3 rounded-md px-3 text-sm aria-selected:bg-surface-2 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:text-ink-3 md:h-9";
const group = "px-2 pb-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-ink-3";

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const { open: openPanel } = useInspector();
  const { resolvedTheme, setTheme } = useTheme();
  const { data: me } = useMe();
  const tz = me?.profile.timezone ?? "America/Toronto";
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Results | null>(null);

  useEffect(() => {
    if (!open) setQ("");
  }, [open]);
  useEffect(() => {
    if (q.trim().length < 2) {
      setRes(null);
      return;
    }
    const t = setTimeout(() => {
      api.get<Results>("/api/search", { q: q.trim() }).then(setRes).catch(() => setRes(null));
    }, 160);
    return () => clearTimeout(t);
  }, [q]);

  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="animate-fade fixed inset-0 z-50 bg-overlay" />
        <DialogPrimitive.Content className="animate-pop fixed left-1/2 top-[10vh] z-50 w-[min(620px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-pop">
          <DialogPrimitive.Title className="sr-only">Recherche et commandes</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Cherche une tâche, un projet, un événement ou lance une action.</DialogPrimitive.Description>
          <Command shouldFilter={!res} label="Recherche et commandes" loop>
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="h-4 w-4 text-ink-3" />
              <Command.Input
                value={q}
                onValueChange={setQ}
                placeholder="Chercher ou lancer une action…"
                className="h-13 flex-1 bg-transparent text-[15px] placeholder:text-ink-3 focus:outline-none"
              />
            </div>
            <Command.List className="scroll-thin max-h-[min(60vh,440px)] overflow-y-auto py-1">
              <Command.Empty className="px-5 py-6 text-sm text-ink-3">Aucun résultat pour « {q} ».</Command.Empty>
              {res?.tasks.length ? (
                <Command.Group heading="Tâches" className={group}>
                  {res.tasks.map((t) => (
                    <Command.Item key={t.id} value={`task-${t.id}`} className={item} onSelect={() => run(() => openPanel({ kind: "task", id: t.id }))}>
                      <CheckSquare />
                      <span className={t.status === "done" ? "text-ink-3 line-through" : ""}>{t.title}</span>
                      {t.due_date ? <span className="ml-auto text-xs text-ink-3">{DateTime.fromISO(t.due_date).setLocale("fr-CA").toFormat("d LLL")}</span> : null}
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}
              {res?.projects.length ? (
                <Command.Group heading="Projets" className={group}>
                  {res.projects.map((p) => (
                    <Command.Item key={p.id} value={`project-${p.id}`} className={item} onSelect={() => run(() => router.push(`/projects/${p.id}`))}>
                      <Dot color={p.color} className="mx-1" />
                      {p.name}
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}
              {res?.events.length ? (
                <Command.Group heading="Événements" className={group}>
                  {res.events.map((e) => (
                    <Command.Item key={e.id} value={`event-${e.id}`} className={item} onSelect={() => run(() => openPanel({ kind: "event", id: e.id }))}>
                      <CalendarDays />
                      {e.title}
                      <span className="ml-auto text-xs text-ink-3">
                        {e.recurring ? "Récurrent" : DateTime.fromISO(e.start_at, { zone: tz }).setLocale("fr-CA").toFormat("d LLL, H'h'mm")}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}
              {!res ? (
                <>
                  <Command.Group heading="Créer" className={group}>
                    <Command.Item className={item} onSelect={() => run(() => openPanel({ kind: "new-task" }))}>
                      <ListPlus /> Nouvelle tâche
                    </Command.Item>
                    <Command.Item className={item} onSelect={() => run(() => openPanel({ kind: "new-event", draft: newEventDraft(tz, me?.settings.default_event_minutes) }))}>
                      <CalendarPlus /> Nouvel événement
                    </Command.Item>
                    <Command.Item className={item} onSelect={() => run(() => router.push("/projects?new=1"))}>
                      <FolderKanban /> Nouveau projet
                    </Command.Item>
                  </Command.Group>
                  <Command.Group heading="Aller à" className={group}>
                    {[
                      ["/", "Tableau de bord", LayoutGrid],
                      ["/today", "Aujourd'hui", Sun],
                      ["/calendar", "Calendrier", CalendarDays],
                      ["/tasks", "Tâches", CheckSquare],
                      ["/projects", "Projets", FolderKanban],
                      ["/assistant", "Assistant", Sparkles],
                      ["/settings", "Paramètres", Settings],
                    ].map(([href, label, Icon]) => {
                      const I = Icon as typeof Sun;
                      return (
                        <Command.Item key={href as string} className={item} onSelect={() => run(() => router.push(href as string))}>
                          <I /> {label as string}
                        </Command.Item>
                      );
                    })}
                  </Command.Group>
                  <Command.Group heading="Préférences" className={group}>
                    <Command.Item className={item} onSelect={() => run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))}>
                      {resolvedTheme === "dark" ? <Sun /> : <Moon />} Passer en mode {resolvedTheme === "dark" ? "clair" : "sombre"}
                    </Command.Item>
                  </Command.Group>
                </>
              ) : null}
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
