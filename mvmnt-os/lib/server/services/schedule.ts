import "server-only";
import { DateTime } from "luxon";
import type { Ctx } from "@/lib/server/context";
import { getOccurrences } from "@/lib/server/services/events";
import { listTasks, todayIn } from "@/lib/server/services/tasks";
import type { DaySchedule, EventOccurrence, Slot, Task } from "@/lib/types";

type Interval = { start: number; end: number };

function subtract(window: Interval, busy: Interval[]): Interval[] {
  const sorted = busy.filter((b) => b.end > window.start && b.start < window.end).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  let cursor = window.start;
  for (const b of sorted) {
    if (b.start > cursor) out.push({ start: cursor, end: Math.min(b.start, window.end) });
    cursor = Math.max(cursor, b.end);
    if (cursor >= window.end) break;
  }
  if (cursor < window.end) out.push({ start: cursor, end: window.end });
  return out;
}

function busyIntervals(occ: EventOccurrence[], bufferMin: number): Interval[] {
  const pad = bufferMin * 60_000;
  return occ
    .filter((o) => o.busy && !o.all_day)
    .map((o) => ({ start: new Date(o.occurrence_start).getTime() - pad, end: new Date(o.occurrence_end).getTime() + pad }));
}

function dayWindow(ctx: Ctx, day: DateTime, withinWorkHours: boolean): Interval | null {
  const s = ctx.settings;
  if (withinWorkHours && !s.work_days.includes(day.weekday % 7)) return null;
  const [sh, sm] = (withinWorkHours ? s.work_start : "07:00").split(":").map(Number);
  const [eh, em] = (withinWorkHours ? s.work_end : "22:00").split(":").map(Number);
  return {
    start: day.set({ hour: sh, minute: sm, second: 0, millisecond: 0 }).toMillis(),
    end: day.set({ hour: eh, minute: em, second: 0, millisecond: 0 }).toMillis(),
  };
}

const roundUp15 = (ms: number) => Math.ceil(ms / 900_000) * 900_000;

/** Free time slots of at least `duration_minutes` between start and end. Never invents availability: based on stored events only. */
export async function findAvailableSlots(
  ctx: Ctx,
  args: { start: string; end: string; duration_minutes: number; within_work_hours?: boolean; limit?: number },
): Promise<Slot[]> {
  const from = new Date(args.start);
  const to = new Date(args.end);
  const occ = await getOccurrences(ctx, from, to, { busyOnly: true });
  const busy = busyIntervals(occ, ctx.settings.buffer_minutes);
  const now = roundUp15(ctx.now().getTime());
  const out: Slot[] = [];
  let day = DateTime.fromJSDate(from, { zone: ctx.tz }).startOf("day");
  const lastDay = DateTime.fromJSDate(to, { zone: ctx.tz });
  while (day <= lastDay && out.length < (args.limit ?? 10)) {
    const w = dayWindow(ctx, day, args.within_work_hours ?? true);
    if (w) {
      const clipped = { start: Math.max(w.start, from.getTime(), now), end: Math.min(w.end, to.getTime()) };
      if (clipped.end > clipped.start) {
        for (const raw of subtract({ start: roundUp15(clipped.start), end: clipped.end }, busy)) {
          const gap = { start: roundUp15(raw.start), end: raw.end }; // proposals start on a quarter hour
          const minutes = Math.floor((gap.end - gap.start) / 60_000);
          if (minutes >= args.duration_minutes) {
            out.push({ start: new Date(gap.start).toISOString(), end: new Date(gap.end).toISOString(), minutes });
            if (out.length >= (args.limit ?? 10)) break;
          }
        }
      }
    }
    day = day.plus({ days: 1 });
  }
  return out;
}

const PRIORITY_RANK: Record<Task["priority"], number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export function rankPriorities(tasks: Task[], today: string): Task[] {
  const score = (t: Task) => {
    let s = PRIORITY_RANK[t.priority] * 10;
    if (t.due_date) {
      const days = DateTime.fromISO(t.due_date).diff(DateTime.fromISO(today), "days").days;
      s += days < 0 ? -15 : days === 0 ? -10 : days <= 2 ? -5 : days <= 7 ? 0 : 5;
    } else s += 8;
    if (t.status === "in_progress") s -= 3;
    return s;
  };
  return [...tasks].sort((a, b) => score(a) - score(b));
}

/** Everything about one day, in the user's timezone. `date` = YYYY-MM-DD (defaults to today). */
export async function getDaySchedule(ctx: Ctx, date?: string): Promise<DaySchedule> {
  const today = todayIn(ctx);
  const d = date ?? today;
  const dayStart = DateTime.fromISO(d, { zone: ctx.tz }).startOf("day");
  const dayEnd = dayStart.plus({ days: 1 });
  const events = await getOccurrences(ctx, dayStart.toJSDate(), dayEnd.toJSDate());
  const open = await listTasks(ctx, { status: ["todo", "in_progress"] });

  const tasks_due = open.filter((t) => t.due_date === d);
  const tasks_planned = open.filter(
    (t) => t.planned_start && DateTime.fromISO(t.planned_start, { zone: ctx.tz }).toISODate() === d && t.due_date !== d,
  );
  const overdue = d === today ? open.filter((t) => t.due_date && t.due_date < today) : [];
  const priorities = rankPriorities(open, d).slice(0, 5);

  const now = ctx.now();
  const next_event = events.find((e) => !e.all_day && (d !== today || new Date(e.occurrence_end) > now)) ?? null;

  const w = dayWindow(ctx, dayStart, true);
  let work_minutes = 0;
  let busy_minutes = 0;
  let free_slots: Slot[] = [];
  if (w) {
    work_minutes = Math.round((w.end - w.start) / 60_000);
    const busyRaw = busyIntervals(events, 0);
    const free = subtract(w, busyRaw);
    const freeTotal = free.reduce((a, g) => a + (g.end - g.start), 0) / 60_000;
    busy_minutes = Math.max(0, work_minutes - Math.round(freeTotal));
    const startFrom = d === today ? Math.max(w.start, roundUp15(now.getTime())) : w.start;
    free_slots = subtract({ start: startFrom, end: w.end }, busyIntervals(events, ctx.settings.buffer_minutes))
      .filter((g) => g.end - g.start >= 15 * 60_000)
      .map((g) => ({ start: new Date(g.start).toISOString(), end: new Date(g.end).toISOString(), minutes: Math.round((g.end - g.start) / 60_000) }));
  }
  const free_minutes = free_slots.reduce((a, s) => a + s.minutes, 0);

  return { date: d, timezone: ctx.tz, events, tasks_due, tasks_planned, overdue, priorities, next_event, work_minutes, busy_minutes, free_minutes, free_slots };
}

export async function getWeekSchedule(ctx: Ctx, weekOf?: string) {
  const ref = DateTime.fromISO(weekOf ?? todayIn(ctx), { zone: ctx.tz });
  const offset = (ref.weekday % 7 - ctx.settings.week_start + 7) % 7;
  const start = ref.minus({ days: offset }).startOf("day");
  const end = start.plus({ days: 7 });
  const events = await getOccurrences(ctx, start.toJSDate(), end.toJSDate());
  const open = await listTasks(ctx, { status: ["todo", "in_progress"], due_before: end.minus({ days: 1 }).toISODate()! });
  const busyMinutes = events
    .filter((e) => e.busy && !e.all_day)
    .reduce((a, e) => a + (new Date(e.occurrence_end).getTime() - new Date(e.occurrence_start).getTime()) / 60_000, 0);
  return {
    start: start.toISODate()!,
    end: end.minus({ days: 1 }).toISODate()!,
    timezone: ctx.tz,
    events,
    tasks_due: open.filter((t) => t.due_date && t.due_date >= start.toISODate()!),
    overdue: open.filter((t) => t.due_date && t.due_date < todayIn(ctx)),
    scheduled_minutes: Math.round(busyMinutes),
    estimated_task_minutes: open.reduce((a, t) => a + (t.estimated_minutes ?? 0), 0),
  };
}

/** Global search across tasks, projects and events (titles). */
export async function search(ctx: Ctx, q: string) {
  const term = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
  const [tasks, projects, events] = await Promise.all([
    ctx.tx`select id, title, status, due_date from public.tasks where user_id = ${ctx.userId} and title ilike ${term}
           order by (status in ('done','cancelled')), updated_at desc limit 8`,
    ctx.tx`select id, name, color, status from public.projects where user_id = ${ctx.userId} and name ilike ${term} order by updated_at desc limit 5`,
    ctx.tx`select id, title, start_at, rrule is not null as recurring from public.events
           where user_id = ${ctx.userId} and (title ilike ${term} or location ilike ${term})
           order by abs(extract(epoch from (start_at - now()))) limit 8`,
  ]);
  return {
    tasks: tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, due_date: t.due_date })),
    projects: projects.map((p) => ({ id: p.id, name: p.name, color: p.color, status: p.status })),
    events: events.map((e) => ({ id: e.id, title: e.title, start_at: new Date(e.start_at).toISOString(), recurring: e.recurring })),
  };
}
