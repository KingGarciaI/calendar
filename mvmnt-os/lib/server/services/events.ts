import "server-only";
import { AppError, notFound, type Ctx } from "@/lib/server/context";
import { expandSeries, isValidRule, seriesUntil, truncateRuleBefore } from "@/lib/recurrence";
import type { EventCreateInput } from "@/lib/schemas";
import type { Conflict, EventDetail, EventOccurrence, EventRow, TaskStatus } from "@/lib/types";

const iso = (d: Date | string | null): string | null => (d == null ? null : new Date(d).toISOString());

const COLS = `e.id, e.title, e.description, e.notes, e.location, e.color, e.start_at, e.end_at, e.all_day, e.timezone,
  e.busy, e.locked, e.rrule, e.exdates, e.recurrence_parent_id, e.original_start, e.project_id, e.category_id,
  e.task_id, e.created_by, e.created_at, e.updated_at`;

type RawEvent = Record<string, unknown> & { task_status?: TaskStatus | null };

function mapRow(r: RawEvent): EventRow & { task_status: TaskStatus | null } {
  return {
    id: r.id as string,
    title: r.title as string,
    description: (r.description as string) ?? null,
    notes: (r.notes as string) ?? null,
    location: (r.location as string) ?? null,
    color: (r.color as string) ?? null,
    start_at: iso(r.start_at as Date)!,
    end_at: iso(r.end_at as Date)!,
    all_day: r.all_day as boolean,
    timezone: r.timezone as string,
    busy: r.busy as boolean,
    locked: r.locked as boolean,
    rrule: (r.rrule as string) ?? null,
    exdates: ((r.exdates as Date[]) ?? []).map((d) => iso(d)!),
    recurrence_parent_id: (r.recurrence_parent_id as string) ?? null,
    original_start: iso(r.original_start as Date),
    project_id: (r.project_id as string) ?? null,
    category_id: (r.category_id as string) ?? null,
    task_id: (r.task_id as string) ?? null,
    created_by: r.created_by as "user" | "assistant",
    created_at: iso(r.created_at as Date)!,
    updated_at: iso(r.updated_at as Date)!,
    task_status: (r.task_status as TaskStatus) ?? null,
  };
}

async function fetchRow(ctx: Ctx, id: string) {
  const rows = await ctx.tx.unsafe(
    `select ${COLS}, t.status as task_status from public.events e left join public.tasks t on t.id = e.task_id
     where e.id = $1 and e.user_id = $2`,
    [id, ctx.userId],
  );
  if (!rows[0]) throw notFound("Événement");
  return mapRow(rows[0]);
}

async function reminderOffsets(ctx: Ctx, eventId: string): Promise<number[]> {
  const rows = await ctx.tx`select offset_minutes from public.reminders where event_id = ${eventId} order by offset_minutes`;
  return rows.map((r) => r.offset_minutes as number);
}

export async function getEvent(ctx: Ctx, id: string): Promise<EventDetail> {
  const { task_status: _ignored, ...row } = await fetchRow(ctx, id);
  return { ...row, reminder_offsets: await reminderOffsets(ctx, id) };
}

async function setReminders(ctx: Ctx, eventId: string, startAt: string, offsets: number[] | undefined) {
  if (offsets === undefined) return;
  await ctx.tx`delete from public.reminders where event_id = ${eventId}`;
  for (const off of [...new Set(offsets)]) {
    const fire = new Date(new Date(startAt).getTime() - off * 60_000);
    await ctx.tx`insert into public.reminders (user_id, event_id, offset_minutes, channel, next_fire_at)
      values (${ctx.userId}, ${eventId}, ${off}, 'push', ${fire > ctx.now() ? fire : null})`;
  }
}

function occurrence(row: EventRow & { task_status: TaskStatus | null }, start: Date, end: Date, instance: boolean): EventOccurrence {
  const s = start.toISOString();
  return {
    ...row,
    instance_id: instance ? `${row.id}__${s}` : row.id,
    occurrence_start: s,
    occurrence_end: end.toISOString(),
    is_recurring_instance: instance,
  };
}

/** Parse an instance id coming back from the calendar. */
export function parseInstanceId(instanceId: string): { id: string; occurrence_start?: string } {
  const [id, occ] = instanceId.split("__");
  return occ ? { id, occurrence_start: occ } : { id };
}

/** All concrete occurrences overlapping [start, end), sorted by start. */
export async function getOccurrences(
  ctx: Ctx,
  start: Date,
  end: Date,
  opts: { busyOnly?: boolean; projectId?: string } = {},
): Promise<EventOccurrence[]> {
  if (end <= start) return [];
  if (end.getTime() - start.getTime() > 400 * 86400_000) throw new AppError("invalid", "Plage de dates trop large (max. 400 jours)");
  const filters: string[] = ["e.user_id = $1"];
  const params: unknown[] = [ctx.userId, start, end];
  if (opts.busyOnly) filters.push("e.busy");
  if (opts.projectId) {
    params.push(opts.projectId);
    filters.push(`e.project_id = $${params.length}`);
  }
  const where = filters.join(" and ");
  const rows = await ctx.tx.unsafe(
    `select ${COLS}, t.status as task_status
       from public.events e left join public.tasks t on t.id = e.task_id
      where ${where} and (
        (e.rrule is null and e.start_at < $3 and e.end_at > $2)
        or (e.rrule is not null and e.start_at < $3 and (e.rrule_until is null or e.rrule_until > $2 - interval '40 days'))
      )`,
    params as never[],
  );
  const out: EventOccurrence[] = [];
  for (const raw of rows) {
    const row = mapRow(raw);
    if (!row.rrule) {
      out.push(occurrence(row, new Date(row.start_at), new Date(row.end_at), false));
      continue;
    }
    for (const o of expandSeries(row as EventRow & { rrule: string }, start, end)) out.push(occurrence(row, o.start, o.end, true));
  }
  // Overrides replace their original occurrence (already excluded through exdates).
  return out.sort((a, b) => a.occurrence_start.localeCompare(b.occurrence_start) || a.title.localeCompare(b.title));
}

/** Busy occurrences overlapping the given intervals, excluding the event being edited. */
export async function findConflicts(
  ctx: Ctx,
  intervals: { start: Date; end: Date }[],
  exclude: { eventId?: string; instanceId?: string } = {},
): Promise<Conflict[]> {
  if (!intervals.length) return [];
  const min = new Date(Math.min(...intervals.map((i) => i.start.getTime())));
  const max = new Date(Math.max(...intervals.map((i) => i.end.getTime())));
  const occ = await getOccurrences(ctx, min, max, { busyOnly: true });
  const seen = new Set<string>();
  const out: Conflict[] = [];
  for (const o of occ) {
    if (o.all_day) continue; // all-day markers don't block time
    if (exclude.eventId && (o.id === exclude.eventId || o.recurrence_parent_id === exclude.eventId)) continue;
    if (exclude.instanceId && o.instance_id === exclude.instanceId) continue;
    const s = new Date(o.occurrence_start);
    const e = new Date(o.occurrence_end);
    if (intervals.some((i) => s < i.end && e > i.start) && !seen.has(o.instance_id)) {
      seen.add(o.instance_id);
      out.push({ instance_id: o.instance_id, title: o.title, start: o.occurrence_start, end: o.occurrence_end });
    }
  }
  return out;
}

function intervalsFor(e: { start_at: string; end_at: string; all_day: boolean; timezone: string; rrule: string | null; exdates?: string[] }, now: Date) {
  if (e.all_day) return [];
  if (!e.rrule) return [{ start: new Date(e.start_at), end: new Date(e.end_at) }];
  // For a series, check the next eight weeks of occurrences.
  const from = new Date(Math.max(now.getTime(), new Date(e.start_at).getTime()) - 86400_000);
  return expandSeries({ ...e, rrule: e.rrule }, from, new Date(from.getTime() + 56 * 86400_000));
}

function checkRule(rrule: string | null | undefined) {
  if (rrule && !isValidRule(rrule)) throw new AppError("invalid", "Règle de récurrence invalide");
}

export async function createEvent(ctx: Ctx, input: EventCreateInput): Promise<{ event: EventDetail; conflicts: Conflict[] }> {
  checkRule(input.rrule);
  const tz = ctx.tz;
  const start = new Date(input.start_at);
  const until = input.rrule ? seriesUntil(input.rrule, start, tz) : null;
  const [row] = await ctx.tx`
    insert into public.events ${ctx.tx({
      user_id: ctx.userId,
      title: input.title,
      description: input.description ?? null,
      notes: input.notes ?? null,
      location: input.location ?? null,
      color: input.color ?? null,
      start_at: start,
      end_at: new Date(input.end_at),
      all_day: input.all_day ?? false,
      timezone: tz,
      busy: input.busy ?? true,
      locked: input.locked ?? false,
      rrule: input.rrule ? input.rrule.replace(/^RRULE:/, "") : null,
      rrule_until: until,
      project_id: input.project_id ?? null,
      category_id: input.category_id ?? null,
      task_id: input.task_id ?? null,
      created_by: ctx.actor,
    })}
    returning id`;
  if (input.task_id) {
    await ctx.tx`update public.tasks set planned_start = ${start}
      where id = ${input.task_id} and (planned_start is null or planned_start > ${start} or planned_start < now())`;
  }
  await setReminders(ctx, row.id, input.start_at, input.reminder_offsets);
  const event = await getEvent(ctx, row.id);
  const conflicts = await findConflicts(ctx, intervalsFor(event, ctx.now()), { eventId: event.id });
  return { event, conflicts };
}

type Patch = Partial<Omit<EventCreateInput, "reminder_offsets">> & { reminder_offsets?: number[] };

async function applyPatch(ctx: Ctx, id: string, current: EventRow, patch: Patch) {
  const { reminder_offsets, ...fields } = patch;
  const next = { ...current, ...fields } as EventRow;
  if (new Date(next.end_at) <= new Date(next.start_at)) throw new AppError("invalid", "La fin doit suivre le début");
  if ("rrule" in fields) checkRule(fields.rrule);
  const values: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    values[k] = k === "start_at" || k === "end_at" ? new Date(v as string) : k === "rrule" && typeof v === "string" ? v.replace(/^RRULE:/, "") : v;
  }
  if (next.rrule && ("rrule" in fields || "start_at" in fields)) {
    values.rrule_until = seriesUntil(next.rrule, new Date(next.start_at), next.timezone);
  } else if ("rrule" in fields && !next.rrule) {
    values.rrule_until = null;
    values.exdates = [];
  }
  if (Object.keys(values).length) {
    await ctx.tx`update public.events set ${ctx.tx(values)} where id = ${id} and user_id = ${ctx.userId}`;
  }
  if (reminder_offsets !== undefined) await setReminders(ctx, id, next.start_at, reminder_offsets);
  else if ("start_at" in fields) {
    // keep reminders aligned with the new start
    await ctx.tx`update public.reminders set next_fire_at =
        case when ${new Date(next.start_at)}::timestamptz - make_interval(mins => offset_minutes) > now()
             then ${new Date(next.start_at)}::timestamptz - make_interval(mins => offset_minutes) end
      where event_id = ${id}`;
  }
}

export async function updateEvent(
  ctx: Ctx,
  id: string,
  args: { patch: Patch; scope?: "occurrence" | "following" | "series"; occurrence_start?: string },
): Promise<{ event: EventDetail; conflicts: Conflict[] }> {
  const current = await fetchRow(ctx, id);
  const scope = args.scope ?? "series";
  const patch = args.patch;
  if (current.locked && ctx.actor === "assistant" && (patch.start_at || patch.end_at)) {
    throw new AppError("forbidden", "Cet événement est verrouillé : l'assistant ne peut pas le déplacer sans ton accord explicite.");
  }

  let targetId = id;
  if (current.rrule && scope !== "series") {
    if (!args.occurrence_start) throw new AppError("invalid", "occurrence_start requis pour modifier une occurrence");
    const occStart = new Date(args.occurrence_start);
    const dur = new Date(current.end_at).getTime() - new Date(current.start_at).getTime();
    const base = {
      title: current.title,
      description: current.description,
      notes: current.notes,
      location: current.location,
      color: current.color,
      start_at: occStart.toISOString(),
      end_at: new Date(occStart.getTime() + dur).toISOString(),
      all_day: current.all_day,
      busy: current.busy,
      locked: current.locked,
      project_id: current.project_id,
      category_id: current.category_id,
      task_id: current.task_id,
    };
    const merged = { ...base, ...patch };
    if (scope === "occurrence") {
      await ctx.tx`update public.events set exdates = array_append(exdates, ${occStart}::timestamptz) where id = ${id}`;
      const { reminder_offsets, ...m } = merged as Patch & typeof base;
      const [row] = await ctx.tx`insert into public.events ${ctx.tx({
        ...m,
        user_id: ctx.userId,
        start_at: new Date(m.start_at!),
        end_at: new Date(m.end_at!),
        timezone: current.timezone,
        rrule: null,
        recurrence_parent_id: id,
        original_start: occStart,
        created_by: ctx.actor,
      } as Record<string, unknown>)} returning id`;
      targetId = row.id;
      const offsets = reminder_offsets ?? (await reminderOffsets(ctx, id));
      await setReminders(ctx, targetId, m.start_at!, offsets);
    } else {
      // this and following: end the old series, start a new one
      const truncated = truncateRuleBefore(current.rrule, new Date(current.start_at), occStart, current.timezone);
      const newRule = (patch.rrule !== undefined ? patch.rrule : current.rrule)?.replace(/;?COUNT=\d+/, "") ?? null;
      const { reminder_offsets, ...m } = merged as Patch & typeof base;
      const [row] = await ctx.tx`insert into public.events ${ctx.tx({
        ...m,
        user_id: ctx.userId,
        start_at: new Date(m.start_at!),
        end_at: new Date(m.end_at!),
        timezone: current.timezone,
        rrule: newRule,
        rrule_until: newRule ? seriesUntil(newRule, new Date(m.start_at!), current.timezone) : null,
        exdates: current.exdates.filter((d) => new Date(d) >= occStart).map((d) => new Date(d)),
        created_by: ctx.actor,
      } as Record<string, unknown>)} returning id`;
      targetId = row.id;
      await ctx.tx`update public.events set recurrence_parent_id = ${targetId}
        where recurrence_parent_id = ${id} and original_start >= ${occStart}`;
      if (truncated) {
        await ctx.tx`update public.events set rrule = ${truncated},
          rrule_until = ${seriesUntil(truncated, new Date(current.start_at), current.timezone)} where id = ${id}`;
      } else {
        await ctx.tx`delete from public.events where id = ${id}`;
      }
      await setReminders(ctx, targetId, m.start_at!, reminder_offsets ?? []);
    }
  } else if (current.rrule && scope === "series" && args.occurrence_start && patch.start_at) {
    // Dragging one instance with "all events": shift the whole series by the same delta.
    const delta = new Date(patch.start_at).getTime() - new Date(args.occurrence_start).getTime();
    const durNew = patch.end_at
      ? new Date(patch.end_at).getTime() - new Date(patch.start_at).getTime()
      : new Date(current.end_at).getTime() - new Date(current.start_at).getTime();
    const newStart = new Date(new Date(current.start_at).getTime() + delta);
    await applyPatch(ctx, id, current, {
      ...patch,
      start_at: newStart.toISOString(),
      end_at: new Date(newStart.getTime() + durNew).toISOString(),
    });
    if (delta !== 0) {
      await ctx.tx`update public.events set exdates = (select coalesce(array_agg(d + make_interval(secs => ${delta / 1000})), '{}') from unnest(exdates) d)
        where id = ${id}`;
      await ctx.tx`update public.events set original_start = original_start + make_interval(secs => ${delta / 1000})
        where recurrence_parent_id = ${id}`;
    }
  } else {
    await applyPatch(ctx, id, current, patch);
  }

  const event = await getEvent(ctx, targetId);
  const conflicts = await findConflicts(ctx, intervalsFor(event, ctx.now()), { eventId: event.id });
  return { event, conflicts };
}

export async function deleteEvent(
  ctx: Ctx,
  id: string,
  args: { scope?: "occurrence" | "following" | "series"; occurrence_start?: string } = {},
): Promise<{ deleted: "event" | "occurrence" | "following" }> {
  const current = await fetchRow(ctx, id);
  const scope = args.scope ?? "series";
  if (current.locked && ctx.actor === "assistant") {
    throw new AppError("forbidden", "Cet événement est verrouillé : l'assistant ne peut pas le supprimer.");
  }
  if (current.rrule && scope !== "series") {
    if (!args.occurrence_start) throw new AppError("invalid", "occurrence_start requis");
    const occ = new Date(args.occurrence_start);
    if (scope === "occurrence") {
      await ctx.tx`update public.events set exdates = array_append(exdates, ${occ}::timestamptz) where id = ${id}`;
      return { deleted: "occurrence" };
    }
    const truncated = truncateRuleBefore(current.rrule, new Date(current.start_at), occ, current.timezone);
    await ctx.tx`delete from public.events where recurrence_parent_id = ${id} and original_start >= ${occ}`;
    if (truncated) {
      await ctx.tx`update public.events set rrule = ${truncated},
        rrule_until = ${seriesUntil(truncated, new Date(current.start_at), current.timezone)} where id = ${id}`;
      return { deleted: "following" };
    }
  }
  await ctx.tx`delete from public.events where id = ${id} and user_id = ${ctx.userId}`;
  return { deleted: "event" };
}
