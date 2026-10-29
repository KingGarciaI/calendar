import "server-only";
import { DateTime } from "luxon";
import { AppError, notFound, type Ctx } from "@/lib/server/context";
import { createEvent, getOccurrences } from "@/lib/server/services/events";
import type { TaskCreateInput, TaskListFilter, TaskUpdateInput } from "@/lib/schemas";
import type { Conflict, EventDetail, Subtask, Task, TaskDetail } from "@/lib/types";

const iso = (d: Date | string | null) => (d == null ? null : new Date(d).toISOString());

const SELECT = `
  select t.id, t.title, t.description, t.notes, t.status, t.priority, t.due_date,
         to_char(t.due_time, 'HH24:MI') as due_time, t.planned_start, t.estimated_minutes,
         t.project_id, t.category_id, t.recurrence_rule, t.reschedule_count, t.completed_at,
         t.sort_order, t.created_at, t.updated_at,
         coalesce(st.total, 0)::int as subtasks_total, coalesce(st.done, 0)::int as subtasks_done,
         coalesce(b.minutes, 0)::int as scheduled_minutes, b.next_block_at
    from public.tasks t
    left join lateral (
      select count(*) as total, count(*) filter (where s.done) as done
        from public.task_subtasks s where s.task_id = t.id) st on true
    left join lateral (
      select sum(extract(epoch from (e.end_at - e.start_at)) / 60) as minutes,
             min(e.start_at) filter (where e.end_at > now()) as next_block_at
        from public.events e where e.task_id = t.id and e.rrule is null) b on true`;

function mapTask(r: Record<string, unknown>): Task {
  return {
    id: r.id as string,
    title: r.title as string,
    description: (r.description as string) ?? null,
    notes: (r.notes as string) ?? null,
    status: r.status as Task["status"],
    priority: r.priority as Task["priority"],
    due_date: (r.due_date as string) ?? null,
    due_time: (r.due_time as string) ?? null,
    planned_start: iso(r.planned_start as Date),
    estimated_minutes: (r.estimated_minutes as number) ?? null,
    project_id: (r.project_id as string) ?? null,
    category_id: (r.category_id as string) ?? null,
    recurrence_rule: (r.recurrence_rule as string) ?? null,
    reschedule_count: r.reschedule_count as number,
    completed_at: iso(r.completed_at as Date),
    sort_order: Number(r.sort_order),
    created_at: iso(r.created_at as Date)!,
    updated_at: iso(r.updated_at as Date)!,
    subtasks_total: r.subtasks_total as number,
    subtasks_done: r.subtasks_done as number,
    scheduled_minutes: r.scheduled_minutes as number,
    next_block_at: iso(r.next_block_at as Date),
  };
}

const PRIORITY_ORDER = `case t.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`;

export function todayIn(ctx: Ctx): string {
  return DateTime.fromJSDate(ctx.now(), { zone: ctx.tz }).toISODate()!;
}

export async function listTasks(ctx: Ctx, f: TaskListFilter = {}): Promise<Task[]> {
  const where: string[] = ["t.user_id = $1"];
  const params: unknown[] = [ctx.userId];
  const add = (clause: (p: string) => string, value: unknown) => {
    params.push(value);
    where.push(clause(`$${params.length}`));
  };
  if (f.status?.length) add((p) => `t.status = any(${p}::text[])`, f.status);
  if (f.priority?.length) add((p) => `t.priority = any(${p}::text[])`, f.priority);
  if (f.project_id) add((p) => `t.project_id = ${p}`, f.project_id);
  if (f.due_before) add((p) => `t.due_date <= ${p}::date`, f.due_before);
  if (f.due_after) add((p) => `t.due_date >= ${p}::date`, f.due_after);
  if (f.search) add((p) => `(t.title ilike ${p} or t.description ilike ${p})`, `%${f.search.replace(/[%_\\]/g, "\\$&")}%`);
  if (f.unscheduled) where.push(`not exists (select 1 from public.events e where e.task_id = t.id and e.end_at > now())`);
  params.push(f.limit ?? 500);
  const rows = await ctx.tx.unsafe(
    `${SELECT} where ${where.join(" and ")}
     order by (t.status in ('done','cancelled')), ${PRIORITY_ORDER}, t.due_date nulls last, t.sort_order, t.created_at
     limit $${params.length}`,
    params as never[],
  );
  return rows.map(mapTask);
}

export async function getTask(ctx: Ctx, id: string): Promise<TaskDetail> {
  const rows = await ctx.tx.unsafe(`${SELECT} where t.id = $1 and t.user_id = $2`, [id, ctx.userId]);
  if (!rows[0]) throw notFound("Tâche");
  const task = mapTask(rows[0]);
  const subtasks = await ctx.tx`select id, task_id, title, done, sort_order from public.task_subtasks
    where task_id = ${id} order by sort_order, created_at`;
  const evRows = await ctx.tx`select id from public.events where task_id = ${id} and rrule is null order by start_at`;
  let blocks: TaskDetail["blocks"] = [];
  if (evRows.length) {
    const from = new Date(Date.now() - 365 * 86400_000);
    const all = await getOccurrences(ctx, from, new Date(from.getTime() + 399 * 86400_000));
    blocks = all.filter((o) => o.task_id === id);
  }
  const rem = await ctx.tx`select offset_minutes from public.reminders where task_id = ${id} order by offset_minutes`;
  return {
    ...task,
    subtasks: subtasks.map((s) => ({ ...s, sort_order: Number(s.sort_order) }) as Subtask),
    blocks,
    reminder_offsets: rem.map((r) => r.offset_minutes as number),
  };
}

function dueInstant(ctx: Ctx, due_date: string | null | undefined, due_time: string | null | undefined): Date | null {
  if (!due_date) return null;
  const t = due_time ?? "09:00";
  return DateTime.fromISO(`${due_date}T${t}`, { zone: ctx.tz }).toJSDate();
}

async function setTaskReminders(ctx: Ctx, taskId: string, offsets: number[] | undefined, due: Date | null) {
  if (offsets === undefined) return;
  await ctx.tx`delete from public.reminders where task_id = ${taskId}`;
  for (const off of [...new Set(offsets)]) {
    const fire = due ? new Date(due.getTime() - off * 60_000) : null;
    await ctx.tx`insert into public.reminders (user_id, task_id, offset_minutes, channel, next_fire_at)
      values (${ctx.userId}, ${taskId}, ${off}, 'push', ${fire && fire > ctx.now() ? fire : null})`;
  }
}

export async function createTask(ctx: Ctx, input: TaskCreateInput): Promise<TaskDetail> {
  const [{ max }] = await ctx.tx`select coalesce(max(sort_order), 0) as max from public.tasks where user_id = ${ctx.userId}`;
  const [row] = await ctx.tx`insert into public.tasks ${ctx.tx({
    user_id: ctx.userId,
    title: input.title,
    description: input.description ?? null,
    notes: input.notes ?? null,
    status: input.status ?? "todo",
    priority: input.priority ?? "normal",
    due_date: input.due_date ?? null,
    due_time: input.due_time ?? null,
    planned_start: input.planned_start ? new Date(input.planned_start) : null,
    estimated_minutes: input.estimated_minutes ?? null,
    project_id: input.project_id ?? null,
    category_id: input.category_id ?? null,
    recurrence_rule: input.recurrence_rule ?? null,
    sort_order: Number(max) + 1,
  })} returning id`;
  let i = 0;
  for (const title of input.subtasks ?? []) {
    await ctx.tx`insert into public.task_subtasks (user_id, task_id, title, sort_order) values (${ctx.userId}, ${row.id}, ${title}, ${i++})`;
  }
  await setTaskReminders(ctx, row.id, input.reminder_offsets, dueInstant(ctx, input.due_date, input.due_time));
  return getTask(ctx, row.id);
}

export async function updateTask(ctx: Ctx, id: string, patch: TaskUpdateInput): Promise<TaskDetail> {
  const { reminder_offsets, ...fields } = patch;
  const values: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    values[k] = k === "planned_start" && v ? new Date(v as string) : v;
  }
  if (Object.keys(values).length) {
    const res = await ctx.tx`update public.tasks set ${ctx.tx(values)} where id = ${id} and user_id = ${ctx.userId} returning id, due_date, to_char(due_time,'HH24:MI') as due_time`;
    if (!res.length) throw notFound("Tâche");
    // Completing a recurring task rolls the next occurrence forward.
    if (fields.status === "done") await rollRecurringTask(ctx, id);
  }
  if (reminder_offsets !== undefined || "due_date" in fields || "due_time" in fields) {
    const [t] = await ctx.tx`select due_date, to_char(due_time,'HH24:MI') as due_time from public.tasks where id = ${id}`;
    if (!t) throw notFound("Tâche");
    const offsets = reminder_offsets ?? (await ctx.tx`select offset_minutes from public.reminders where task_id = ${id}`).map((r) => r.offset_minutes as number);
    await setTaskReminders(ctx, id, offsets, dueInstant(ctx, t.due_date, t.due_time));
  }
  return getTask(ctx, id);
}

async function rollRecurringTask(ctx: Ctx, id: string) {
  const [t] = await ctx.tx`select * from public.tasks where id = ${id}`;
  if (!t?.recurrence_rule) return;
  const { RRule } = await import("rrule");
  const base = DateTime.fromISO((t.due_date as string | null) ?? todayIn(ctx), { zone: "utc" });
  const rule = new RRule({ ...RRule.parseString(String(t.recurrence_rule).replace(/^RRULE:/, "")), dtstart: base.toJSDate() });
  const next = rule.after(base.toJSDate(), false);
  if (!next) return;
  const nextDate = DateTime.fromJSDate(next, { zone: "utc" }).toISODate();
  await createTask(ctx, {
    title: t.title,
    description: t.description,
    notes: t.notes,
    priority: t.priority,
    due_date: nextDate,
    due_time: t.due_time ? String(t.due_time).slice(0, 5) : null,
    estimated_minutes: t.estimated_minutes,
    project_id: t.project_id,
    category_id: t.category_id,
    recurrence_rule: t.recurrence_rule,
  });
  // The completed instance no longer carries the rule.
  await ctx.tx`update public.tasks set recurrence_rule = null where id = ${id}`;
}

export async function completeTask(ctx: Ctx, id: string, done = true): Promise<TaskDetail> {
  return updateTask(ctx, id, { status: done ? "done" : "todo" });
}

export async function deleteTask(ctx: Ctx, id: string, opts: { deleteBlocks?: boolean } = {}): Promise<{ deleted: true }> {
  if (opts.deleteBlocks) await ctx.tx`delete from public.events where task_id = ${id} and user_id = ${ctx.userId}`;
  const res = await ctx.tx`delete from public.tasks where id = ${id} and user_id = ${ctx.userId} returning id`;
  if (!res.length) throw notFound("Tâche");
  return { deleted: true };
}

/** Put a task on the calendar as a linked work block. */
export async function scheduleTask(
  ctx: Ctx,
  id: string,
  args: { start_at: string; duration_minutes?: number },
): Promise<{ event: EventDetail; conflicts: Conflict[] }> {
  const task = await getTask(ctx, id);
  if (task.status === "done" || task.status === "cancelled") throw new AppError("invalid", "Cette tâche est déjà terminée ou annulée");
  const minutes = args.duration_minutes ?? task.estimated_minutes ?? ctx.settings.default_event_minutes;
  const start = new Date(args.start_at);
  return createEvent(ctx, {
    title: task.title,
    start_at: start.toISOString(),
    end_at: new Date(start.getTime() + minutes * 60_000).toISOString(),
    task_id: task.id,
    project_id: task.project_id,
    category_id: task.category_id,
    busy: true,
  });
}

// ------------------------------------------------------------ subtasks
export async function addSubtask(ctx: Ctx, taskId: string, title: string): Promise<Subtask> {
  const [{ max }] = await ctx.tx`select coalesce(max(sort_order), -1) as max from public.task_subtasks where task_id = ${taskId}`;
  const [row] = await ctx.tx`insert into public.task_subtasks (user_id, task_id, title, sort_order)
    values (${ctx.userId}, ${taskId}, ${title}, ${Number(max) + 1}) returning id, task_id, title, done, sort_order`;
  return { ...row, sort_order: Number(row.sort_order) } as Subtask;
}

export async function updateSubtask(ctx: Ctx, id: string, patch: { title?: string; done?: boolean; sort_order?: number }): Promise<Subtask> {
  const values = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  if (!Object.keys(values).length) throw new AppError("invalid", "Rien à modifier");
  const [row] = await ctx.tx`update public.task_subtasks set ${ctx.tx(values)} where id = ${id} and user_id = ${ctx.userId}
    returning id, task_id, title, done, sort_order`;
  if (!row) throw notFound("Sous-tâche");
  return { ...row, sort_order: Number(row.sort_order) } as Subtask;
}

export async function deleteSubtask(ctx: Ctx, id: string) {
  const res = await ctx.tx`delete from public.task_subtasks where id = ${id} and user_id = ${ctx.userId} returning id`;
  if (!res.length) throw notFound("Sous-tâche");
  return { deleted: true };
}

/** Upcoming deadlines (open tasks with a due date within `days`, plus overdue ones). */
export async function getUpcomingDeadlines(ctx: Ctx, days = 14): Promise<{ overdue: Task[]; upcoming: Task[] }> {
  const today = todayIn(ctx);
  const until = DateTime.fromISO(today).plus({ days }).toISODate()!;
  const open = await listTasks(ctx, { status: ["todo", "in_progress"], due_before: until });
  return {
    overdue: open.filter((t) => t.due_date! < today),
    upcoming: open.filter((t) => t.due_date! >= today).sort((a, b) => a.due_date!.localeCompare(b.due_date!)),
  };
}
