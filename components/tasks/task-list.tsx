"use client";
import { useState } from "react";
import { DateTime } from "luxon";
import { CalendarCheck2, ListChecks, Plus, Repeat } from "lucide-react";
import { toast } from "sonner";
import { useInspector } from "@/components/shell/inspector";
import { Badge, Dot, PriorityIcon, Spinner, TaskCheck } from "@/components/ui/misc";
import { useCreateTask, useMe, useProjects, useUpdateTask } from "@/lib/client/hooks";
import { dueLabel, fmtMinutes } from "@/lib/format";
import type { TaskCreateInput } from "@/lib/schemas";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";

export function TaskRow({ task, showProject = true, dense }: { task: Task; showProject?: boolean; dense?: boolean }) {
  const { open, panel } = useInspector();
  const { data: me } = useMe();
  const { data: projects = [] } = useProjects();
  const update = useUpdateTask();
  const tz = me?.profile.timezone ?? "America/Toronto";
  const project = projects.find((p) => p.id === task.project_id);
  const closed = task.status === "done" || task.status === "cancelled";
  const due = closed ? null : dueLabel(task.due_date, tz);
  const selected = panel?.kind === "task" && panel.id === task.id;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => open({ kind: "task", id: task.id })}
      onKeyDown={(e) => {
        if (e.key === "Enter") open({ kind: "task", id: task.id });
        if (e.key === " " && (e.target as HTMLElement) === e.currentTarget) {
          e.preventDefault();
          update.mutate({ id: task.id, patch: { status: closed ? "todo" : "done" } });
        }
      }}
      className={cn(
        "group flex cursor-pointer items-center gap-3 rounded-[8px] px-2.5 transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover",
        dense ? "py-1.5" : "py-2",
        selected && "bg-accent-soft hover:bg-accent-soft",
      )}
    >
      <TaskCheck
        checked={task.status === "done"}
        priority={task.priority}
        label={closed ? `Rouvrir ${task.title}` : `Terminer ${task.title}`}
        onChange={(v) => {
          update.mutate({ id: task.id, patch: { status: v ? "done" : "todo" } });
          if (v) toast.success("Tâche terminée", { action: { label: "Annuler", onClick: () => update.mutate({ id: task.id, patch: { status: "todo" } }) } });
        }}
      />
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm", closed ? "text-ink-3 line-through decoration-1" : "text-ink", task.status === "in_progress" && "font-semibold")}>{task.title}</p>
        {!dense && (due || (showProject && project) || task.estimated_minutes || task.subtasks_total || task.next_block_at || task.recurrence_rule) ? (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-ink-3">
            {due ? <span className={cn(due.tone === "danger" && "font-semibold text-danger", due.tone === "warning" && "font-semibold text-warning")}>{due.text}</span> : null}
            {task.next_block_at && !closed ? (
              <span className="flex items-center gap-1 text-accent-text">
                <CalendarCheck2 className="h-3 w-3" />
                {DateTime.fromISO(task.next_block_at, { zone: tz }).setLocale("fr-CA").toFormat("ccc H'h'mm")}
              </span>
            ) : null}
            {task.estimated_minutes ? <span className="tabular">{fmtMinutes(task.estimated_minutes)}</span> : null}
            {task.subtasks_total ? (
              <span className="flex items-center gap-1 tabular">
                <ListChecks className="h-3 w-3" />
                {task.subtasks_done}/{task.subtasks_total}
              </span>
            ) : null}
            {task.recurrence_rule ? <Repeat className="h-3 w-3" aria-label="Récurrente" /> : null}
            {showProject && project ? (
              <span className="flex items-center gap-1.5">
                <Dot color={project.color} className="h-1.5 w-1.5" />
                {project.name}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      {task.status === "in_progress" ? <Badge tone="accent">En cours</Badge> : null}
      {task.priority === "urgent" || task.priority === "high" ? <PriorityIcon priority={task.priority} /> : null}
    </div>
  );
}

export function QuickAddTask({ defaults, placeholder = "Ajouter une tâche", className }: { defaults?: Partial<TaskCreateInput>; placeholder?: string; className?: string }) {
  const [title, setTitle] = useState("");
  const create = useCreateTask();
  return (
    <form
      className={cn("flex items-center gap-3 rounded-[8px] px-2.5 py-1.5 focus-within:bg-surface-hover", className)}
      onSubmit={async (e) => {
        e.preventDefault();
        const t = title.trim();
        if (!t) return;
        setTitle("");
        await create.mutateAsync({ title: t, ...defaults }).catch(() => setTitle(t));
      }}
    >
      {create.isPending ? <Spinner className="h-[18px] w-[18px] text-ink-3" /> : <Plus className="h-[18px] w-[18px] text-ink-3" />}
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-7 flex-1 bg-transparent text-sm placeholder:text-ink-3 focus:outline-none"
      />
      {title ? <span className="text-xs text-ink-3">Entrée ↵</span> : null}
    </form>
  );
}

export function TaskGroup({ title, tasks, count, tone, children, collapsible = false, defaultOpen = true, showProject }: {
  title: string;
  tasks: Task[];
  count?: number;
  tone?: "danger";
  children?: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  showProject?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!tasks.length && !children) return null;
  return (
    <section className="mb-5">
      <button
        disabled={!collapsible}
        onClick={() => setOpen(!open)}
        className={cn("mb-1 flex items-center gap-2 px-2.5 text-xs font-semibold", tone === "danger" ? "text-danger" : "text-ink-2", collapsible && "hover:text-ink")}
        aria-expanded={collapsible ? open : undefined}
      >
        {title}
        <span className="font-normal text-ink-3 tabular">{count ?? tasks.length}</span>
      </button>
      {open ? (
        <div className="space-y-px">
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} showProject={showProject} />
          ))}
          {children}
        </div>
      ) : null}
    </section>
  );
}
