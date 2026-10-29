"use client";
import { useMemo, useState } from "react";
import { DateTime } from "luxon";
import { CheckCircle2, Search } from "lucide-react";
import { QuickAddTask, TaskGroup } from "@/components/tasks/task-list";
import { EmptyState, PRIORITY_META, Segmented, Skeleton } from "@/components/ui/misc";
import { Input } from "@/components/ui/field";
import { useMe, useProjects, useTasks } from "@/lib/client/hooks";
import { todayISO } from "@/lib/format";
import type { Task, TaskPriority } from "@/lib/types";

type GroupBy = "due" | "priority" | "project" | "status";
type Show = "open" | "done" | "all";

const STATUS: Record<string, string> = { todo: "À faire", in_progress: "En cours", done: "Terminées", cancelled: "Annulées" };

function groupTasks(tasks: Task[], by: GroupBy, tz: string, projects: { id: string; name: string }[]) {
  const groups: { key: string; title: string; tone?: "danger"; tasks: Task[] }[] = [];
  const push = (key: string, title: string, t: Task, tone?: "danger") => {
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push((g = { key, title, tone, tasks: [] }));
    g.tasks.push(t);
  };
  if (by === "due") {
    const today = todayISO(tz);
    const tomorrow = DateTime.fromISO(today).plus({ days: 1 }).toISODate()!;
    const week = DateTime.fromISO(today).plus({ days: 7 }).toISODate()!;
    const order = ["overdue", "today", "tomorrow", "week", "later", "none", "closed"];
    for (const t of tasks) {
      if (t.status === "done" || t.status === "cancelled") push("closed", "Terminées", t);
      else if (!t.due_date) push("none", "Sans échéance", t);
      else if (t.due_date < today) push("overdue", "En retard", t, "danger");
      else if (t.due_date === today) push("today", "Aujourd'hui", t);
      else if (t.due_date === tomorrow) push("tomorrow", "Demain", t);
      else if (t.due_date <= week) push("week", "Cette semaine", t);
      else push("later", "Plus tard", t);
    }
    for (const g of groups) if (g.key !== "none" && g.key !== "closed") g.tasks.sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));
    return groups.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  }
  if (by === "priority") {
    for (const t of tasks) push(t.priority, PRIORITY_META[t.priority].label, t, t.priority === "urgent" ? "danger" : undefined);
    const order: TaskPriority[] = ["urgent", "high", "normal", "low"];
    return groups.sort((a, b) => order.indexOf(a.key as TaskPriority) - order.indexOf(b.key as TaskPriority));
  }
  if (by === "project") {
    for (const t of tasks) push(t.project_id ?? "none", projects.find((p) => p.id === t.project_id)?.name ?? "Sans projet", t);
    return groups.sort((a, b) => (a.key === "none" ? 1 : b.key === "none" ? -1 : a.title.localeCompare(b.title, "fr")));
  }
  for (const t of tasks) push(t.status, STATUS[t.status], t);
  const order = ["in_progress", "todo", "done", "cancelled"];
  return groups.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

export default function TasksPage() {
  const { data: me } = useMe();
  const tz = me?.profile.timezone ?? "America/Toronto";
  const [by, setBy] = useState<GroupBy>("due");
  const [show, setShow] = useState<Show>("open");
  const [q, setQ] = useState("");
  const filter = useMemo(
    () => ({ status: show === "open" ? "todo,in_progress" : show === "done" ? "done,cancelled" : undefined, search: q.trim() || undefined }),
    [show, q],
  );
  const { data: tasks = [], isLoading } = useTasks(filter);
  const { data: projects = [] } = useProjects();
  const groups = groupTasks(tasks, by, tz, projects);

  return (
    <div className="mx-auto w-full max-w-[820px] px-4 pb-10 pt-2 md:px-8 md:pt-4">
      <header className="mb-6">
        <h1 className="text-[28px] font-semibold tracking-[-0.02em]">Tâches</h1>
        <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              value={show}
              onChange={setShow}
              options={[
                { value: "open", label: "Ouvertes" },
                { value: "done", label: "Terminées" },
                { value: "all", label: "Toutes" },
              ]}
            />
            <Segmented
              value={by}
              onChange={setBy}
              options={[
                { value: "due", label: "Échéance" },
                { value: "priority", label: "Priorité" },
                { value: "project", label: "Projet" },
                { value: "status", label: "Statut" },
              ]}
            />
          </div>
          <div className="relative md:w-56">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer" aria-label="Filtrer les tâches" className="h-8 pl-8" />
          </div>
        </div>
      </header>

      <div className="-mx-2.5">
        {show !== "done" ? <QuickAddTask className="mb-4" /> : null}
        {isLoading ? (
          <div className="space-y-2 px-2.5">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-11" />
            ))}
          </div>
        ) : groups.length ? (
          groups.map((g) => (
            <TaskGroup
              key={g.key}
              title={g.title}
              tone={g.tone}
              tasks={g.tasks}
              showProject={by !== "project"}
              collapsible
              defaultOpen={g.key !== "closed" || show === "done"}
            />
          ))
        ) : (
          <div className="px-2.5">
            <EmptyState
              icon={CheckCircle2}
              title={q ? `Aucune tâche ne correspond à « ${q} »` : show === "done" ? "Rien de terminé pour l'instant" : "Aucune tâche ouverte"}
              body={q ? undefined : show === "done" ? undefined : "Tape une tâche ci-dessus et appuie sur Entrée."}
            />
          </div>
        )}
      </div>
    </div>
  );
}
