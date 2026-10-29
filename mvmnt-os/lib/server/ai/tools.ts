import "server-only";
import { DateTime } from "luxon";
import { z, type ZodType } from "zod";
import { AppError, type Ctx } from "@/lib/server/context";
import { createEvent, deleteEvent, findConflicts, getEvent, getOccurrences, parseInstanceId, updateEvent } from "@/lib/server/services/events";
import { completeTask, createTask, deleteTask, getTask, getUpcomingDeadlines, listTasks, scheduleTask, updateTask } from "@/lib/server/services/tasks";
import { createProject, getProject, listCategories, listProjects } from "@/lib/server/services/projects";
import { findAvailableSlots, getDaySchedule, getWeekSchedule, rankPriorities } from "@/lib/server/services/schedule";
import { isValidRule } from "@/lib/recurrence";
import type { EventOccurrence, Task } from "@/lib/types";

/**
 * AI tool layer. Every tool:
 *  - validates its arguments with zod (also exported as JSON Schema for the model),
 *  - runs through the same services as the UI, inside an RLS-scoped transaction,
 *  - declares its risk level, which decides whether it runs or waits for confirmation.
 * The same registry can back a future MCP server.
 */

export type Risk = "read" | "write" | "destructive";

export type ToolDef<A = unknown> = {
  name: string;
  description: string;
  schema: ZodType<A>;
  risk: Risk;
  /** Extra condition that makes a write need confirmation (e.g. moving an existing event). */
  needsConfirmation?: (args: A) => boolean;
  /** French one-liner shown on the confirmation card. */
  summarize: (args: A, ctx: Ctx) => Promise<string> | string;
  run: (ctx: Ctx, args: A) => Promise<unknown>;
};

// ------------------------------------------------------------------ helpers
const localDateTime = z
  .string()
  .describe("Local date-time in the user's timezone, format YYYY-MM-DDTHH:mm (an explicit UTC offset is also accepted)");
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Date YYYY-MM-DD in the user's timezone");
const id = z.string().min(1).max(120);

export function parseLocal(value: string, tz: string): Date {
  const hasOffset = /([zZ]|[+-]\d{2}:?\d{2})$/.test(value);
  const d = hasOffset ? DateTime.fromISO(value, { setZone: true }) : DateTime.fromISO(value, { zone: tz });
  if (!d.isValid) throw new AppError("invalid", `Date invalide : ${value}`);
  return d.toJSDate();
}

const local = (iso: string | Date, tz: string) => DateTime.fromJSDate(new Date(iso), { zone: tz }).toFormat("yyyy-LL-dd'T'HH:mm");
const human = (iso: string | Date, tz: string) => DateTime.fromJSDate(new Date(iso), { zone: tz }).setLocale("fr-CA").toFormat("cccc d LLLL 'à' H'h'mm");

function compactEvent(e: EventOccurrence, tz: string) {
  return {
    id: e.instance_id,
    title: e.title,
    start: e.all_day ? e.occurrence_start.slice(0, 10) : local(e.occurrence_start, tz),
    end: e.all_day ? undefined : local(e.occurrence_end, tz),
    all_day: e.all_day || undefined,
    location: e.location ?? undefined,
    recurring: e.is_recurring_instance || undefined,
    locked: e.locked || undefined,
    busy: e.busy ? undefined : false,
    task_id: e.task_id ?? undefined,
    task_status: e.task_status ?? undefined,
    project_id: e.project_id ?? undefined,
  };
}

function compactTask(t: Task, tz: string) {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    due_date: t.due_date ?? undefined,
    due_time: t.due_time ?? undefined,
    estimated_minutes: t.estimated_minutes ?? undefined,
    project_id: t.project_id ?? undefined,
    scheduled_minutes: t.scheduled_minutes || undefined,
    next_block: t.next_block_at ? local(t.next_block_at, tz) : undefined,
    subtasks: t.subtasks_total ? `${t.subtasks_done}/${t.subtasks_total}` : undefined,
    times_postponed: t.reschedule_count || undefined,
    created: t.created_at.slice(0, 10),
  };
}

function describeTaskPatch(p: Record<string, unknown>) {
  const labels: Record<string, string> = {
    title: "titre",
    status: "statut",
    priority: "priorité",
    due_date: "échéance",
    estimated_minutes: "durée",
    project_id: "projet",
    description: "description",
    notes: "notes",
  };
  return Object.keys(p)
    .filter((k) => k !== "task_id")
    .map((k) => labels[k] ?? k)
    .join(", ");
}

// ------------------------------------------------------------------ tools
const tools: ToolDef<any>[] = [];
function tool<A>(def: ToolDef<A>) {
  tools.push(def as ToolDef<any>);
}

tool({
  name: "get_day_schedule",
  description:
    "Full picture of one day: events (with exact local times), tasks due, overdue tasks, top priorities, next event, busy/free minutes and free slots within working hours. Use for 'qu'est-ce que j'ai aujourd'hui/demain'.",
  schema: z.object({ date: localDate.optional().describe("Defaults to today") }),
  risk: "read",
  summarize: () => "Lire l'horaire du jour",
  run: async (ctx, a) => {
    const d = await getDaySchedule(ctx, a.date);
    return {
      date: d.date,
      events: d.events.map((e) => compactEvent(e, ctx.tz)),
      tasks_due: d.tasks_due.map((t) => compactTask(t, ctx.tz)),
      tasks_planned: d.tasks_planned.map((t) => compactTask(t, ctx.tz)),
      overdue: d.overdue.map((t) => compactTask(t, ctx.tz)),
      priorities: d.priorities.map((t) => compactTask(t, ctx.tz)),
      next_event: d.next_event ? compactEvent(d.next_event, ctx.tz) : null,
      work_minutes: d.work_minutes,
      busy_minutes: d.busy_minutes,
      free_minutes: d.free_minutes,
      free_slots: d.free_slots.map((s) => ({ start: local(s.start, ctx.tz), end: local(s.end, ctx.tz), minutes: s.minutes })),
    };
  },
});

tool({
  name: "get_week_schedule",
  description: "Events of the week containing `date`, tasks due that week, overdue tasks, total scheduled minutes and total estimated task minutes.",
  schema: z.object({ date: localDate.optional() }),
  risk: "read",
  summarize: () => "Lire l'horaire de la semaine",
  run: async (ctx, a) => {
    const w = await getWeekSchedule(ctx, a.date);
    return {
      start: w.start,
      end: w.end,
      events: w.events.map((e) => compactEvent(e, ctx.tz)),
      tasks_due: w.tasks_due.map((t) => compactTask(t, ctx.tz)),
      overdue: w.overdue.map((t) => compactTask(t, ctx.tz)),
      scheduled_minutes: w.scheduled_minutes,
      estimated_task_minutes: w.estimated_task_minutes,
    };
  },
});

tool({
  name: "get_events",
  description: "List calendar events (recurring ones expanded) between two local date-times. Max range 400 days. Optionally filter by text in the title.",
  schema: z.object({ start: localDateTime, end: localDateTime, query: z.string().max(100).optional() }),
  risk: "read",
  summarize: () => "Lire les événements",
  run: async (ctx, a) => {
    const occ = await getOccurrences(ctx, parseLocal(a.start, ctx.tz), parseLocal(a.end, ctx.tz));
    const q = a.query?.toLowerCase();
    return occ.filter((e) => !q || e.title.toLowerCase().includes(q)).slice(0, 200).map((e) => compactEvent(e, ctx.tz));
  },
});

tool({
  name: "get_event",
  description: "Details of one event by id (an occurrence id like 'uuid__2026-11-02T14:00:00.000Z' is accepted).",
  schema: z.object({ event_id: id }),
  risk: "read",
  summarize: () => "Lire un événement",
  run: async (ctx, a) => {
    const e = await getEvent(ctx, parseInstanceId(a.event_id).id);
    return { ...e, start_at: local(e.start_at, ctx.tz), end_at: local(e.end_at, ctx.tz) };
  },
});

tool({
  name: "get_tasks",
  description:
    "List tasks. Filters: status (todo, in_progress, done, cancelled), priority, project_id, due_before/due_after (YYYY-MM-DD), search text, unscheduled=true for tasks without a future calendar block. Each task includes times_postponed and created date (useful to find tasks pushed back too long).",
  schema: z.object({
    status: z.array(z.enum(["todo", "in_progress", "done", "cancelled"])).optional().describe("Defaults to open tasks (todo, in_progress)"),
    priority: z.array(z.enum(["urgent", "high", "normal", "low"])).optional(),
    project_id: id.optional(),
    due_before: localDate.optional(),
    due_after: localDate.optional(),
    search: z.string().max(100).optional(),
    unscheduled: z.boolean().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }),
  risk: "read",
  summarize: () => "Lire les tâches",
  run: async (ctx, a) => {
    const list = await listTasks(ctx, { ...a, status: a.status ?? ["todo", "in_progress"], limit: a.limit ?? 100 });
    return list.map((t) => compactTask(t, ctx.tz));
  },
});

tool({
  name: "get_task",
  description: "Details of one task: description, notes, subtasks, calendar blocks.",
  schema: z.object({ task_id: id }),
  risk: "read",
  summarize: () => "Lire une tâche",
  run: async (ctx, a) => {
    const t = await getTask(ctx, a.task_id);
    return { ...compactTask(t, ctx.tz), description: t.description, notes: t.notes, subtasks: t.subtasks.map((s) => ({ id: s.id, title: s.title, done: s.done })), blocks: t.blocks.map((b) => compactEvent(b, ctx.tz)) };
  },
});

tool({
  name: "get_priorities",
  description: "Open tasks ranked by urgency (priority + deadline proximity + in-progress). Use to decide what matters most.",
  schema: z.object({ limit: z.number().int().min(1).max(30).optional() }),
  risk: "read",
  summarize: () => "Analyser les priorités",
  run: async (ctx, a) => {
    const open = await listTasks(ctx, { status: ["todo", "in_progress"] });
    const today = DateTime.fromJSDate(ctx.now(), { zone: ctx.tz }).toISODate()!;
    return rankPriorities(open, today).slice(0, a.limit ?? 10).map((t) => compactTask(t, ctx.tz));
  },
});

tool({
  name: "get_upcoming_deadlines",
  description: "Overdue open tasks plus open tasks due within the next `days` days.",
  schema: z.object({ days: z.number().int().min(1).max(90).optional() }),
  risk: "read",
  summarize: () => "Lire les échéances",
  run: async (ctx, a) => {
    const r = await getUpcomingDeadlines(ctx, a.days ?? 14);
    return { overdue: r.overdue.map((t) => compactTask(t, ctx.tz)), upcoming: r.upcoming.map((t) => compactTask(t, ctx.tz)) };
  },
});

tool({
  name: "get_projects",
  description: "Projects with progress (tasks done/total/open), next deadline and next event.",
  schema: z.object({ include_archived: z.boolean().optional() }),
  risk: "read",
  summarize: () => "Lire les projets",
  run: async (ctx, a) =>
    (await listProjects(ctx, { includeArchived: a.include_archived })).map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      due_date: p.due_date,
      tasks_open: p.tasks_open,
      tasks_done: p.tasks_done,
      tasks_total: p.tasks_total,
      next_due_date: p.next_due_date,
    })),
});

tool({
  name: "get_project",
  description: "One project with its tasks and upcoming events.",
  schema: z.object({ project_id: id }),
  risk: "read",
  summarize: () => "Lire un projet",
  run: async (ctx, a) => {
    const p = await getProject(ctx, a.project_id);
    return { id: p.id, name: p.name, description: p.description, status: p.status, due_date: p.due_date, tasks: p.tasks.map((t) => compactTask(t, ctx.tz)), upcoming_events: p.upcoming_events.map((e) => compactEvent(e, ctx.tz)) };
  },
});

tool({
  name: "get_categories",
  description: "Event/task categories (Rendez-vous, Tournage, Montage, Réunion, …) with ids.",
  schema: z.object({}),
  risk: "read",
  summarize: () => "Lire les catégories",
  run: async (ctx) => (await listCategories(ctx)).map((c) => ({ id: c.id, name: c.name })),
});

tool({
  name: "find_available_slots",
  description:
    "Free time slots of at least duration_minutes between start and end, computed from real events, respecting working hours (unless within_work_hours=false) and the user's buffer between meetings. Never invent availability: always call this before proposing times.",
  schema: z.object({
    start: localDateTime,
    end: localDateTime,
    duration_minutes: z.number().int().min(5).max(720),
    within_work_hours: z.boolean().optional(),
    limit: z.number().int().min(1).max(30).optional(),
  }),
  risk: "read",
  summarize: () => "Chercher des disponibilités",
  run: async (ctx, a) => {
    const slots = await findAvailableSlots(ctx, {
      start: parseLocal(a.start, ctx.tz).toISOString(),
      end: parseLocal(a.end, ctx.tz).toISOString(),
      duration_minutes: a.duration_minutes,
      within_work_hours: a.within_work_hours ?? true,
      limit: a.limit ?? 10,
    });
    return slots.map((s) => ({ start: local(s.start, ctx.tz), end: local(s.end, ctx.tz), minutes: s.minutes }));
  },
});

tool({
  name: "check_conflicts",
  description: "Busy events overlapping a proposed time range.",
  schema: z.object({ start: localDateTime, end: localDateTime, exclude_event_id: id.optional() }),
  risk: "read",
  summarize: () => "Vérifier les conflits",
  run: async (ctx, a) => {
    const c = await findConflicts(ctx, [{ start: parseLocal(a.start, ctx.tz), end: parseLocal(a.end, ctx.tz) }], { eventId: a.exclude_event_id ? parseInstanceId(a.exclude_event_id).id : undefined });
    return c.map((x) => ({ title: x.title, start: local(x.start, ctx.tz), end: local(x.end, ctx.tz) }));
  },
});

// ---------------------------------------------------------------- writes
const priority = z.enum(["urgent", "high", "normal", "low"]);

tool({
  name: "create_task",
  description: "Create a task. Leave optional fields out unless the user gave them.",
  schema: z.object({
    title: z.string().min(1).max(300),
    description: z.string().max(5000).optional(),
    priority: priority.optional(),
    due_date: localDate.optional(),
    due_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    estimated_minutes: z.number().int().min(5).max(1440).optional(),
    project_id: id.optional(),
    category_id: id.optional(),
    subtasks: z.array(z.string().min(1).max(300)).max(20).optional(),
  }),
  risk: "write",
  summarize: (a) => `Créer la tâche « ${a.title} »${a.due_date ? ` pour le ${DateTime.fromISO(a.due_date).setLocale("fr-CA").toFormat("d LLLL")}` : ""}`,
  run: async (ctx, a) => compactTask(await createTask(ctx, a), ctx.tz),
});

tool({
  name: "update_task",
  description: "Change fields of a task (title, status, priority, due date, estimate, project, notes…). Use complete_task to mark it done.",
  schema: z.object({
    task_id: id,
    title: z.string().min(1).max(300).optional(),
    description: z.string().max(5000).nullable().optional(),
    notes: z.string().max(10000).nullable().optional(),
    status: z.enum(["todo", "in_progress", "done", "cancelled"]).optional(),
    priority: priority.optional(),
    due_date: localDate.nullable().optional(),
    due_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
    estimated_minutes: z.number().int().min(5).max(1440).nullable().optional(),
    project_id: id.nullable().optional(),
    category_id: id.nullable().optional(),
  }),
  risk: "write",
  summarize: async (a, ctx) => {
    const { task_id, ...patch } = a;
    const t = await getTask(ctx, task_id).catch(() => null);
    return `Modifier la tâche « ${t?.title ?? task_id} » (${describeTaskPatch(patch)})`;
  },
  run: async (ctx, a) => {
    const { task_id, ...patch } = a;
    return compactTask(await updateTask(ctx, task_id, patch), ctx.tz);
  },
});

tool({
  name: "complete_task",
  description: "Mark a task as done (or reopen it with done=false).",
  schema: z.object({ task_id: id, done: z.boolean().optional() }),
  risk: "write",
  summarize: async (a, ctx) => {
    const t = await getTask(ctx, a.task_id).catch(() => null);
    return `${a.done === false ? "Rouvrir" : "Terminer"} la tâche « ${t?.title ?? a.task_id} »`;
  },
  run: async (ctx, a) => compactTask(await completeTask(ctx, a.task_id, a.done ?? true), ctx.tz),
});

tool({
  name: "delete_task",
  description: "Delete a task permanently. Always requires the user's confirmation.",
  schema: z.object({ task_id: id, delete_calendar_blocks: z.boolean().optional() }),
  risk: "destructive",
  summarize: async (a, ctx) => {
    const t = await getTask(ctx, a.task_id).catch(() => null);
    return `Supprimer la tâche « ${t?.title ?? a.task_id} »${a.delete_calendar_blocks ? " et ses blocs" : ""}`;
  },
  run: async (ctx, a) => deleteTask(ctx, a.task_id, { deleteBlocks: a.delete_calendar_blocks }),
});

tool({
  name: "create_event",
  description:
    "Create a calendar event (appointment, shoot, editing block…). Returns any conflicts with existing busy events — tell the user about them. Use rrule (RFC 5545 body like 'FREQ=WEEKLY;BYDAY=MO') only for recurring events.",
  schema: z.object({
    title: z.string().min(1).max(300),
    start: localDateTime,
    end: localDateTime,
    all_day: z.boolean().optional(),
    location: z.string().max(500).optional(),
    description: z.string().max(5000).optional(),
    category_id: id.optional(),
    project_id: id.optional(),
    task_id: id.optional(),
    rrule: z.string().max(300).optional(),
    locked: z.boolean().optional().describe("Firm appointment that must never be moved automatically"),
    reminder_minutes_before: z.array(z.number().int().min(0).max(10080)).max(3).optional(),
  }),
  risk: "write",
  summarize: (a, ctx) => `Créer « ${a.title} » ${human(parseLocal(a.start, ctx.tz), ctx.tz)} (jusqu'à ${DateTime.fromJSDate(parseLocal(a.end, ctx.tz), { zone: ctx.tz }).toFormat("H'h'mm")})`,
  run: async (ctx, a) => {
    if (a.rrule && !isValidRule(a.rrule)) throw new AppError("invalid", "rrule invalide");
    const r = await createEvent(ctx, {
      title: a.title,
      start_at: parseLocal(a.start, ctx.tz).toISOString(),
      end_at: parseLocal(a.end, ctx.tz).toISOString(),
      all_day: a.all_day,
      location: a.location,
      description: a.description,
      category_id: a.category_id,
      project_id: a.project_id,
      task_id: a.task_id,
      rrule: a.rrule,
      locked: a.locked,
      reminder_offsets: a.reminder_minutes_before,
    });
    return {
      event: { id: r.event.id, title: r.event.title, start: local(r.event.start_at, ctx.tz), end: local(r.event.end_at, ctx.tz) },
      conflicts: r.conflicts.map((c) => ({ title: c.title, start: local(c.start, ctx.tz), end: local(c.end, ctx.tz) })),
    };
  },
});

tool({
  name: "update_event",
  description:
    "Modify an event: move it (start/end), rename, change location/notes/category/project. For a recurring occurrence pass its occurrence id and scope ('occurrence' = only this one, 'following', 'series'). Moving an existing event always asks the user to confirm. Locked events cannot be moved.",
  schema: z.object({
    event_id: id.describe("Event id or occurrence id"),
    scope: z.enum(["occurrence", "following", "series"]).optional(),
    title: z.string().min(1).max(300).optional(),
    start: localDateTime.optional(),
    end: localDateTime.optional(),
    location: z.string().max(500).nullable().optional(),
    description: z.string().max(5000).nullable().optional(),
    notes: z.string().max(10000).nullable().optional(),
    category_id: id.nullable().optional(),
    project_id: id.nullable().optional(),
    locked: z.boolean().optional(),
  }),
  risk: "write",
  needsConfirmation: (a) => a.start !== undefined || a.end !== undefined || a.scope === "series" || a.scope === "following",
  summarize: async (a, ctx) => {
    const { id: eid, occurrence_start } = parseInstanceId(a.event_id);
    const e = await getEvent(ctx, eid).catch(() => null);
    const from = occurrence_start ?? e?.start_at;
    if (a.start) return `Déplacer « ${e?.title ?? "l'événement"} »${from ? ` du ${human(from, ctx.tz)}` : ""} au ${human(parseLocal(a.start, ctx.tz), ctx.tz)}`;
    return `Modifier « ${e?.title ?? "l'événement"} »`;
  },
  run: async (ctx, a) => {
    const { id: eid, occurrence_start } = parseInstanceId(a.event_id);
    const current = await getEvent(ctx, eid);
    const patch: Record<string, unknown> = {};
    for (const k of ["title", "location", "description", "notes", "category_id", "project_id", "locked"] as const) if (a[k] !== undefined) patch[k] = a[k];
    const occStart = occurrence_start ?? current.start_at;
    const occDur = new Date(current.end_at).getTime() - new Date(current.start_at).getTime();
    if (a.start) {
      const s = parseLocal(a.start, ctx.tz);
      patch.start_at = s.toISOString();
      patch.end_at = a.end ? parseLocal(a.end, ctx.tz).toISOString() : new Date(s.getTime() + occDur).toISOString();
    } else if (a.end) {
      patch.start_at = new Date(occStart).toISOString();
      patch.end_at = parseLocal(a.end, ctx.tz).toISOString();
    }
    const scope = current.rrule ? (a.scope ?? (occurrence_start ? "occurrence" : "series")) : "series";
    const r = await updateEvent(ctx, eid, { patch, scope, occurrence_start: current.rrule ? occStart : undefined });
    return {
      event: { id: r.event.id, title: r.event.title, start: local(r.event.start_at, ctx.tz), end: local(r.event.end_at, ctx.tz) },
      conflicts: r.conflicts.map((c) => ({ title: c.title, start: local(c.start, ctx.tz), end: local(c.end, ctx.tz) })),
    };
  },
});

tool({
  name: "delete_event",
  description: "Cancel/delete an event (or one occurrence / this-and-following of a series). Always requires the user's confirmation.",
  schema: z.object({ event_id: id, scope: z.enum(["occurrence", "following", "series"]).optional() }),
  risk: "destructive",
  summarize: async (a, ctx) => {
    const { id: eid, occurrence_start } = parseInstanceId(a.event_id);
    const e = await getEvent(ctx, eid).catch(() => null);
    const when = occurrence_start ?? e?.start_at;
    const what = e?.rrule ? (a.scope === "series" ? " (toute la série)" : a.scope === "following" ? " (et les suivants)" : " (cette occurrence)") : "";
    return `Supprimer « ${e?.title ?? "l'événement"} »${when ? ` du ${human(when, ctx.tz)}` : ""}${what}`;
  },
  run: async (ctx, a) => {
    const { id: eid, occurrence_start } = parseInstanceId(a.event_id);
    const e = await getEvent(ctx, eid);
    const scope = e.rrule ? (a.scope ?? (occurrence_start ? "occurrence" : "series")) : "series";
    return deleteEvent(ctx, eid, { scope, occurrence_start: occurrence_start ?? (e.rrule && scope !== "series" ? e.start_at : undefined) });
  },
});

tool({
  name: "schedule_task",
  description: "Put a task on the calendar as a linked work block starting at `start` (duration defaults to the task estimate). Returns conflicts if any.",
  schema: z.object({ task_id: id, start: localDateTime, duration_minutes: z.number().int().min(5).max(720).optional() }),
  risk: "write",
  summarize: async (a, ctx) => {
    const t = await getTask(ctx, a.task_id).catch(() => null);
    return `Planifier « ${t?.title ?? "la tâche"} » ${human(parseLocal(a.start, ctx.tz), ctx.tz)}`;
  },
  run: async (ctx, a) => {
    const r = await scheduleTask(ctx, a.task_id, { start_at: parseLocal(a.start, ctx.tz).toISOString(), duration_minutes: a.duration_minutes });
    return {
      event: { id: r.event.id, title: r.event.title, start: local(r.event.start_at, ctx.tz), end: local(r.event.end_at, ctx.tz) },
      conflicts: r.conflicts.map((c) => ({ title: c.title, start: local(c.start, ctx.tz), end: local(c.end, ctx.tz) })),
    };
  },
});

tool({
  name: "create_project",
  description: "Create a project (client or internal initiative).",
  schema: z.object({ name: z.string().min(1).max(120), description: z.string().max(2000).optional(), due_date: localDate.optional() }),
  risk: "write",
  summarize: (a) => `Créer le projet « ${a.name} »`,
  run: async (ctx, a) => {
    const p = await createProject(ctx, a);
    return { id: p.id, name: p.name };
  },
});

export const TOOLS = tools;
export const toolByName = (name: string) => tools.find((t) => t.name === name);

export function toolSpecs() {
  return tools.map((t) => {
    const schema = z.toJSONSchema(t.schema) as Record<string, unknown>;
    delete schema.$schema;
    return { name: t.name, description: t.description, input_schema: schema };
  });
}

/** Does this call need the user's explicit go-ahead before running? */
export function requiresConfirmation(t: ToolDef<any>, args: unknown, ctx: Ctx) {
  if (t.risk === "read") return false;
  if (t.risk === "destructive") return true;
  if (ctx.settings.ai_confirm_writes) return true;
  return t.needsConfirmation?.(args) ?? false;
}
