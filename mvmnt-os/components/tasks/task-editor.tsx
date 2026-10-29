"use client";
import { useEffect, useRef, useState } from "react";
import { DateTime } from "luxon";
import { CalendarPlus, Clock, Plus, Repeat, Trash2, X, FolderKanban, Tag, Bell, CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea, TitleInput } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/ui/overlay";
import { PRIORITY_META, PriorityIcon, Skeleton, Spinner, TaskCheck } from "@/components/ui/misc";
import { useInspector } from "@/components/shell/inspector";
import { api } from "@/lib/client/api";
import {
  conflictToast,
  useCategories,
  useCreateTask,
  useDeleteTask,
  useMe,
  useProjects,
  useScheduleTask,
  useSubtaskMutations,
  useTask,
  useUpdateTask,
} from "@/lib/client/hooks";
import { fmtMinutes, fmtRange, relDay } from "@/lib/format";
import type { TaskCreateInput, TaskUpdateInput } from "@/lib/schemas";
import type { Slot, TaskDetail, TaskPriority, TaskStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<TaskStatus, string> = { todo: "À faire", in_progress: "En cours", done: "Terminée", cancelled: "Annulée" };
const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240, 360, 480];
const REMINDERS = [
  { v: 0, l: "À l'échéance" },
  { v: 60, l: "1 h avant" },
  { v: 1440, l: "1 jour avant" },
];
const TASK_RECURRENCE = [
  { v: "", l: "Ne se répète pas" },
  { v: "FREQ=DAILY", l: "Tous les jours" },
  { v: "FREQ=WEEKLY", l: "Chaque semaine" },
  { v: "FREQ=MONTHLY", l: "Chaque mois" },
];

function Row({ icon: Icon, label, children }: { icon: React.ComponentType<{ className?: string }>; label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[112px_1fr] items-center gap-3 py-1">
      <div className="flex items-center gap-2 text-xs font-semibold text-ink-3">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

type Draft = TaskCreateInput & { status: TaskStatus; priority: TaskPriority };

function draftFrom(t?: TaskDetail, defaults?: Partial<TaskCreateInput>): Draft {
  return {
    title: t?.title ?? defaults?.title ?? "",
    description: t?.description ?? defaults?.description ?? "",
    notes: t?.notes ?? "",
    status: t?.status ?? (defaults?.status as TaskStatus) ?? "todo",
    priority: t?.priority ?? (defaults?.priority as TaskPriority) ?? "normal",
    due_date: t?.due_date ?? defaults?.due_date ?? null,
    due_time: t?.due_time ?? null,
    estimated_minutes: t?.estimated_minutes ?? defaults?.estimated_minutes ?? null,
    project_id: t?.project_id ?? defaults?.project_id ?? null,
    category_id: t?.category_id ?? defaults?.category_id ?? null,
    recurrence_rule: t?.recurrence_rule ?? null,
    reminder_offsets: t?.reminder_offsets ?? [],
  };
}

export function TaskEditor({ id, defaults }: { id?: string; defaults?: Partial<TaskCreateInput> }) {
  const { data: task, isLoading } = useTask(id ?? null);
  if (id && isLoading) return <EditorSkeleton />;
  if (id && !task) return <p className="p-5 text-sm text-ink-2">Cette tâche n&apos;existe plus.</p>;
  return <TaskForm key={task?.id ?? "new"} task={task} defaults={defaults} />;
}

function EditorSkeleton() {
  return (
    <div className="space-y-4 p-5">
      <Skeleton className="h-7 w-2/3" />
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

function TaskForm({ task, defaults }: { task?: TaskDetail; defaults?: Partial<TaskCreateInput> }) {
  const isNew = !task;
  const { close, open } = useInspector();
  const { data: me } = useMe();
  const tz = me?.profile.timezone ?? "America/Toronto";
  const h12 = me?.settings.time_format === "12h";
  const { data: categories = [] } = useCategories();
  const { data: projects = [] } = useProjects();
  const create = useCreateTask();
  const update = useUpdateTask();
  const del = useDeleteTask();
  const schedule = useScheduleTask();
  const subs = useSubtaskMutations(task?.id ?? "");
  const [d, setD] = useState<Draft>(() => draftFrom(task, defaults));
  const [newSub, setNewSub] = useState("");
  const [pendingSubs, setPendingSubs] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isNew) titleRef.current?.focus();
  }, [isNew]);

  /** Existing tasks save field by field; new tasks wait for "Créer". */
  const set = <K extends keyof Draft>(k: K, v: Draft[K], save = true) => {
    setD((prev) => ({ ...prev, [k]: v }));
    if (!isNew && save) update.mutate({ id: task!.id, patch: { [k]: v === "" ? null : v } as TaskUpdateInput });
  };
  const saveText = (k: "title" | "description" | "notes") => {
    if (isNew || !task) return;
    const v = (d[k] ?? "").trim();
    if (k === "title" && !v) {
      setD((p) => ({ ...p, title: task.title }));
      return;
    }
    if (v !== (task[k] ?? "")) update.mutate({ id: task.id, patch: { [k]: v || null } });
  };

  const submit = async () => {
    if (!d.title.trim()) {
      titleRef.current?.focus();
      toast.error("Donne un titre à la tâche");
      return;
    }
    const created = await create.mutateAsync({
      ...d,
      title: d.title.trim(),
      description: d.description?.trim() || null,
      notes: d.notes?.trim() || null,
      recurrence_rule: d.recurrence_rule || null,
      subtasks: pendingSubs,
    });
    toast.success("Tâche créée");
    open({ kind: "task", id: created.id });
  };

  const findSlots = async () => {
    if (!task) return;
    setSlotsLoading(true);
    try {
      const now = DateTime.now().setZone(tz);
      const end = d.due_date ? DateTime.fromISO(d.due_date, { zone: tz }).endOf("day") : now.plus({ days: 7 });
      const res = await api.post<Slot[]>("/api/slots", {
        start: now.toUTC().toISO(),
        end: (end < now.plus({ days: 1 }) ? now.plus({ days: 3 }) : end).toUTC().toISO(),
        duration_minutes: d.estimated_minutes ?? me?.settings.default_event_minutes ?? 60,
        limit: 5,
      });
      setSlots(res);
    } catch {
      toast.error("Impossible de calculer les disponibilités");
    } finally {
      setSlotsLoading(false);
    }
  };

  const placeAt = async (startIso: string) => {
    if (!task) return;
    const r = await schedule.mutateAsync({ id: task.id, start_at: startIso, duration_minutes: d.estimated_minutes ?? undefined });
    toast.success(`Planifiée ${relDay(DateTime.fromISO(startIso, { zone: tz }).toISODate()!, tz).toLowerCase()} à ${fmtRange(r.event.start_at, r.event.end_at, tz, h12)}`);
    conflictToast(r.conflicts, tz);
    setSlots(null);
  };

  const done = d.status === "done";

  return (
    <div className="flex h-full flex-col">
      <div className="scroll-thin flex-1 space-y-5 overflow-y-auto px-5 pb-6 pt-1">
        <div className="flex items-start gap-3">
          {!isNew && (
            <div className="pt-[7px]">
              <TaskCheck checked={done} priority={d.priority} label="Terminer la tâche" onChange={(v) => set("status", v ? "done" : "todo")} />
            </div>
          )}
          <TitleInput
            ref={titleRef}
            value={d.title}
            placeholder="Nom de la tâche"
            aria-label="Titre"
            onChange={(e) => setD({ ...d, title: e.target.value })}
            onBlur={() => saveText("title")}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (isNew) submit();
                else (e.target as HTMLInputElement).blur();
              }
            }}
            className={cn(done && "text-ink-3 line-through decoration-1")}
          />
        </div>

        <div className="space-y-0.5">
          <Row icon={CalendarDays} label="Statut">
            <Select value={d.status} onChange={(e) => set("status", e.target.value as TaskStatus)} aria-label="Statut">
              {Object.entries(STATUS_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Row>
          <Row icon={() => <PriorityIcon priority={d.priority} />} label="Priorité">
            <Select value={d.priority} onChange={(e) => set("priority", e.target.value as TaskPriority)} aria-label="Priorité">
              {(Object.keys(PRIORITY_META) as TaskPriority[]).map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_META[p].label}
                </option>
              ))}
            </Select>
          </Row>
          <Row icon={CalendarDays} label="Échéance">
            <div className="flex gap-2">
              <Input type="date" value={d.due_date ?? ""} onChange={(e) => set("due_date", e.target.value || null)} aria-label="Date limite" className="flex-1" />
              {d.due_date ? (
                <Input type="time" value={d.due_time ?? ""} onChange={(e) => set("due_time", e.target.value || null)} aria-label="Heure limite" className="w-[108px]" />
              ) : null}
            </div>
          </Row>
          <Row icon={Clock} label="Durée estimée">
            <Select
              value={d.estimated_minutes ?? ""}
              onChange={(e) => set("estimated_minutes", e.target.value ? Number(e.target.value) : null)}
              aria-label="Durée estimée"
            >
              <option value="">Non estimée</option>
              {[...new Set([...DURATIONS, ...(d.estimated_minutes ? [d.estimated_minutes] : [])])]
                .sort((a, b) => a - b)
                .map((m) => (
                  <option key={m} value={m}>
                    {fmtMinutes(m)}
                  </option>
                ))}
            </Select>
          </Row>
          <Row icon={FolderKanban} label="Projet">
            <Select value={d.project_id ?? ""} onChange={(e) => set("project_id", e.target.value || null)} aria-label="Projet">
              <option value="">Aucun projet</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Row>
          <Row icon={Tag} label="Catégorie">
            <Select value={d.category_id ?? ""} onChange={(e) => set("category_id", e.target.value || null)} aria-label="Catégorie">
              <option value="">Aucune</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Row>
          <Row icon={Repeat} label="Répétition">
            <Select value={d.recurrence_rule ?? ""} onChange={(e) => set("recurrence_rule", e.target.value || null)} aria-label="Répétition">
              {TASK_RECURRENCE.map((r) => (
                <option key={r.v} value={r.v}>
                  {r.l}
                </option>
              ))}
            </Select>
          </Row>
          {d.due_date ? (
            <Row icon={Bell} label="Rappels">
              <div className="flex flex-wrap gap-1.5">
                {REMINDERS.map((r) => {
                  const on = d.reminder_offsets?.includes(r.v);
                  return (
                    <button
                      key={r.v}
                      type="button"
                      aria-pressed={on}
                      onClick={() => set("reminder_offsets", on ? d.reminder_offsets!.filter((x) => x !== r.v) : [...(d.reminder_offsets ?? []), r.v])}
                      className={cn("h-7 rounded-full border px-2.5 text-xs font-semibold", on ? "border-accent bg-accent-soft text-accent-text" : "border-line text-ink-2 hover:border-line-strong")}
                    >
                      {r.l}
                    </button>
                  );
                })}
              </div>
            </Row>
          ) : null}
        </div>

        {/* Calendar blocks */}
        {!isNew && task ? (
          <section className="rounded-[10px] border border-line">
            <div className="flex items-center justify-between px-3.5 py-2.5">
              <p className="text-xs font-semibold text-ink-2">
                Dans le calendrier
                {task.scheduled_minutes ? <span className="ml-1.5 font-normal text-ink-3">{fmtMinutes(task.scheduled_minutes)} planifiées</span> : null}
              </p>
              <Button size="sm" variant="ghost" onClick={findSlots} disabled={slotsLoading || done}>
                {slotsLoading ? <Spinner className="h-3 w-3" /> : <CalendarPlus className="h-3.5 w-3.5" />}
                Planifier
              </Button>
            </div>
            {task.blocks.length ? (
              <ul className="border-t border-line">
                {task.blocks.map((b) => (
                  <li key={b.instance_id}>
                    <button
                      onClick={() => open({ kind: "event", id: b.id })}
                      className="flex w-full items-center justify-between px-3.5 py-2 text-left text-sm hover:bg-surface-hover"
                    >
                      <span>{relDay(DateTime.fromISO(b.occurrence_start, { zone: tz }).toISODate()!, tz)}</span>
                      <span className="tabular text-ink-2">{fmtRange(b.occurrence_start, b.occurrence_end, tz, h12)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : !slots ? (
              <p className="border-t border-line px-3.5 py-2.5 text-xs text-ink-3">
                Pas encore planifiée. Glisse-la sur le calendrier ou choisis un créneau libre.
              </p>
            ) : null}
            {slots ? (
              <div className="border-t border-line px-3.5 py-2.5">
                {slots.length ? (
                  <>
                    <p className="mb-2 text-xs text-ink-3">Créneaux libres pour {fmtMinutes(d.estimated_minutes ?? me?.settings.default_event_minutes ?? 60)} :</p>
                    <div className="flex flex-wrap gap-1.5">
                      {slots.map((s) => (
                        <button
                          key={s.start}
                          onClick={() => placeAt(s.start)}
                          disabled={schedule.isPending}
                          className="h-7 rounded-full border border-line px-2.5 text-xs font-semibold hover:border-accent hover:text-accent-text"
                        >
                          {relDay(DateTime.fromISO(s.start, { zone: tz }).toISODate()!, tz)} · {DateTime.fromISO(s.start, { zone: tz }).toFormat("H'h'mm")}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-ink-3">Aucun créneau assez long d&apos;ici l&apos;échéance pendant tes heures de travail.</p>
                )}
              </div>
            ) : null}
          </section>
        ) : null}

        {/* Subtasks */}
        <section>
          <p className="mb-1.5 text-xs font-semibold text-ink-2">
            Sous-tâches
            {task?.subtasks.length ? (
              <span className="ml-1.5 font-normal text-ink-3 tabular">
                {task.subtasks_done}/{task.subtasks_total}
              </span>
            ) : null}
          </p>
          <ul className="space-y-0.5">
            {task?.subtasks.map((s) => (
              <li key={s.id} className="group flex items-center gap-2.5 rounded-md px-1 py-1 hover:bg-surface-hover">
                <TaskCheck size="sm" checked={s.done} label={`Terminer ${s.title}`} onChange={(v) => subs.update.mutate({ id: s.id, done: v })} />
                <span className={cn("flex-1 text-sm", s.done && "text-ink-3 line-through")}>{s.title}</span>
                <button onClick={() => subs.remove.mutate(s.id)} className="rounded p-0.5 text-ink-3 opacity-0 hover:text-danger group-hover:opacity-100 focus:opacity-100" aria-label="Supprimer la sous-tâche">
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
            {isNew &&
              pendingSubs.map((s, i) => (
                <li key={i} className="flex items-center gap-2.5 px-1 py-1 text-sm">
                  <span className="h-4 w-4 rounded-full border-[1.5px] border-line-strong" />
                  <span className="flex-1">{s}</span>
                  <button onClick={() => setPendingSubs(pendingSubs.filter((_, j) => j !== i))} className="text-ink-3 hover:text-danger" aria-label="Retirer">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
          </ul>
          <form
            className="mt-1 flex items-center gap-2.5 px-1"
            onSubmit={(e) => {
              e.preventDefault();
              const v = newSub.trim();
              if (!v) return;
              if (isNew) setPendingSubs([...pendingSubs, v]);
              else subs.add.mutate(v);
              setNewSub("");
            }}
          >
            <Plus className="h-4 w-4 text-ink-3" />
            <input
              value={newSub}
              onChange={(e) => setNewSub(e.target.value)}
              placeholder="Ajouter une sous-tâche"
              className="h-8 flex-1 bg-transparent text-sm placeholder:text-ink-3 focus:outline-none"
            />
          </form>
        </section>

        <section className="space-y-3">
          <Textarea
            value={d.description ?? ""}
            onChange={(e) => setD({ ...d, description: e.target.value })}
            onBlur={() => saveText("description")}
            placeholder="Description"
            aria-label="Description"
            rows={3}
          />
          <Textarea value={d.notes ?? ""} onChange={(e) => setD({ ...d, notes: e.target.value })} onBlur={() => saveText("notes")} placeholder="Notes" aria-label="Notes" rows={3} />
        </section>

        {task ? (
          <p className="text-xs text-ink-3">
            Créée {relDay(task.created_at.slice(0, 10), tz).toLowerCase()}
            {task.reschedule_count > 0 ? ` · échéance repoussée ${task.reschedule_count} fois` : ""}
            {update.isPending ? " · enregistrement…" : ""}
          </p>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
        {isNew ? (
          <>
            <Button variant="ghost" onClick={close}>
              Annuler
            </Button>
            <Button variant="primary" onClick={submit} disabled={create.isPending}>
              {create.isPending ? <Spinner className="h-3.5 w-3.5" /> : null}
              Créer la tâche
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" className="text-danger hover:bg-danger-soft hover:text-danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" />
              Supprimer
            </Button>
            <Button variant="secondary" onClick={close}>
              Fermer
            </Button>
          </>
        )}
      </div>

      {task ? (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Supprimer cette tâche ?"
          body={task.blocks.length ? "Elle a des blocs dans le calendrier. Tu peux les garder ou les supprimer avec elle." : "Ses sous-tâches seront aussi supprimées."}
          options={
            task.blocks.length
              ? [
                  { label: "Supprimer la tâche et ses blocs", tone: "danger", onSelect: () => del.mutate({ id: task.id, blocks: true }, { onSuccess: () => (toast.success("Tâche supprimée"), close()) }) },
                  { label: "Garder les blocs", tone: "secondary", onSelect: () => del.mutate({ id: task.id }, { onSuccess: () => (toast.success("Tâche supprimée"), close()) }) },
                ]
              : [{ label: "Supprimer", tone: "danger", onSelect: () => del.mutate({ id: task.id }, { onSuccess: () => (toast.success("Tâche supprimée"), close()) }) }]
          }
        />
      ) : null}
    </div>
  );
}
