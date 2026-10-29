"use client";
import Link from "next/link";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";
import { ArrowLeft, CalendarPlus, MoreHorizontal, Pencil, Trash2, Archive } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/overlay";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { Textarea } from "@/components/ui/field";
import { ProjectFormDialog, PROJECT_STATUS } from "@/components/projects/project-form";
import { QuickAddTask, TaskGroup } from "@/components/tasks/task-list";
import { newEventDraft, useInspector } from "@/components/shell/inspector";
import { useMe, useProject, useProjectMutations } from "@/lib/client/hooks";
import { fmtRange, relDay } from "@/lib/format";

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: me } = useMe();
  const tz = me?.profile.timezone ?? "America/Toronto";
  const { data: p, isLoading, error } = useProject(id);
  const { update, remove } = useProjectMutations();
  const { open } = useInspector();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notes, setNotes] = useState<string | null>(null);

  if (isLoading)
    return (
      <div className="mx-auto max-w-[920px] space-y-4 px-4 pt-4 md:px-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-40" />
      </div>
    );
  if (error || !p)
    return (
      <div className="mx-auto max-w-[920px] px-4 pt-4 md:px-8">
        <EmptyState title="Projet introuvable" body="Il a peut-être été supprimé." action={<Link href="/projects" className="text-sm font-semibold text-accent-text">Retour aux projets</Link>} />
      </div>
    );

  const open_ = p.tasks.filter((t) => t.status === "todo" || t.status === "in_progress");
  const done = p.tasks.filter((t) => t.status === "done");
  const pct = p.tasks_total ? Math.round((p.tasks_done / p.tasks_total) * 100) : 0;
  const deadlines = open_.filter((t) => t.due_date).sort((a, b) => a.due_date!.localeCompare(b.due_date!)).slice(0, 4);

  return (
    <div className="mx-auto w-full max-w-[1040px] px-4 pb-10 pt-2 md:px-8 md:pt-4">
      <Link href="/projects" className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-3 hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" /> Projets
      </Link>
      <header className="mb-8 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className="h-4 w-4 shrink-0 rounded-[5px]" style={{ background: p.color }} />
            <h1 className="truncate text-[28px] font-semibold tracking-[-0.02em]">{p.name}</h1>
          </div>
          {p.description ? <p className="mt-2 max-w-[62ch] text-[15px] text-ink-2">{p.description}</p> : null}
          <p className="mt-3 text-sm text-ink-3">
            {PROJECT_STATUS[p.status]}
            {p.start_date ? ` · depuis le ${DateTime.fromISO(p.start_date).setLocale("fr-CA").toFormat("d LLLL")}` : ""}
            {p.due_date ? ` · échéance ${DateTime.fromISO(p.due_date).setLocale("fr-CA").toFormat("d LLLL yyyy")}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" onClick={() => open({ kind: "new-event", draft: { ...newEventDraft(tz, me?.settings.default_event_minutes), project_id: p.id } })}>
            <CalendarPlus className="h-3.5 w-3.5" /> Événement
          </Button>
          <Menu>
            <MenuTrigger asChild>
              <Button size="icon" variant="ghost" aria-label="Plus d'actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem onSelect={() => setEditing(true)}>
                <Pencil /> Modifier
              </MenuItem>
              <MenuItem onSelect={() => update.mutate({ id: p.id, patch: { status: p.status === "archived" ? "active" : "archived" } }, { onSuccess: () => toast.success(p.status === "archived" ? "Projet réactivé" : "Projet archivé") })}>
                <Archive /> {p.status === "archived" ? "Réactiver" : "Archiver"}
              </MenuItem>
              <MenuSeparator />
              <MenuItem tone="danger" onSelect={() => setConfirmDelete(true)}>
                <Trash2 /> Supprimer
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      </header>

      {/* Progress line */}
      <section className="mb-10">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-semibold">
            {pct} %<span className="ml-2 font-normal text-ink-3">terminé</span>
          </span>
          <span className="text-ink-3 tabular">
            {p.tasks_done} sur {p.tasks_total} tâches
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full transition-[width]" style={{ width: `${pct}%`, background: p.color }} />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1.4fr_1fr] lg:gap-12">
        <div className="-mx-2.5">
          <TaskGroup title="Tâches restantes" tasks={open_} showProject={false}>
            <QuickAddTask defaults={{ project_id: p.id }} placeholder="Ajouter une tâche au projet" />
          </TaskGroup>
          <TaskGroup title="Terminées" tasks={done} showProject={false} collapsible defaultOpen={false} />
        </div>

        <aside className="space-y-9">
          <section>
            <h2 className="mb-2 text-[13px] font-semibold text-ink-2">Prochaines échéances</h2>
            {deadlines.length ? (
              <ul className="space-y-1.5 text-sm">
                {deadlines.map((t) => (
                  <li key={t.id} className="flex justify-between gap-3">
                    <button onClick={() => open({ kind: "task", id: t.id })} className="truncate text-left hover:underline">
                      {t.title}
                    </button>
                    <span className="shrink-0 text-ink-3">{relDay(t.due_date!, tz)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-3">Aucune échéance à venir.</p>
            )}
          </section>
          <section>
            <h2 className="mb-2 text-[13px] font-semibold text-ink-2">Événements liés</h2>
            {p.upcoming_events.length || p.recent_events.length ? (
              <ul className="space-y-0.5">
                {[...p.upcoming_events.slice(0, 6), ...p.recent_events.slice(0, 3)].map((e, i) => (
                  <li key={e.instance_id}>
                    {i === p.upcoming_events.slice(0, 6).length && p.recent_events.length ? <p className="mb-1 mt-3 text-xs text-ink-3">Récents</p> : null}
                    <button
                      onClick={() => open({ kind: "event", id: e.id, occurrence: { instance_id: e.instance_id, start: e.occurrence_start, end: e.occurrence_end, recurring: e.is_recurring_instance } })}
                      className="-mx-2 flex w-[calc(100%+16px)] items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-hover"
                    >
                      <span className="truncate font-semibold">{e.title}</span>
                      <span className="shrink-0 text-xs text-ink-3 tabular">
                        {relDay(DateTime.fromISO(e.occurrence_start, { zone: tz }).toISODate()!, tz)} {fmtRange(e.occurrence_start, e.occurrence_end, tz).split(" – ")[0]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-3">Aucun événement associé.</p>
            )}
          </section>
          <section>
            <h2 className="mb-2 text-[13px] font-semibold text-ink-2">Notes</h2>
            <Textarea
              value={notes ?? p.notes ?? ""}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => {
                if (notes !== null && notes !== (p.notes ?? "")) update.mutate({ id: p.id, patch: { notes: notes || null } }, { onSuccess: () => toast.success("Notes enregistrées") });
              }}
              rows={6}
              placeholder="Accès, contacts, décisions…"
              aria-label="Notes du projet"
            />
          </section>
        </aside>
      </div>

      {editing ? <ProjectFormDialog open onOpenChange={setEditing} project={p} /> : null}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Supprimer ce projet ?"
        body="Les tâches et événements restent, mais ne seront plus rattachés à ce projet."
        confirmLabel="Supprimer le projet"
        onConfirm={() => remove.mutate(p.id, { onSuccess: () => (toast.success("Projet supprimé"), router.push("/projects")) })}
      />
    </div>
  );
}
