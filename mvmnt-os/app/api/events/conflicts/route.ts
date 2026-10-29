import { z } from "zod";
import { route } from "@/lib/server/api";
import { isoDateTime, rruleString, uuid } from "@/lib/schemas";
import { findConflicts } from "@/lib/server/services/events";
import { findAvailableSlots } from "@/lib/server/services/schedule";
import { expandSeries } from "@/lib/recurrence";

const schema = z.object({
  start_at: isoDateTime,
  end_at: isoDateTime,
  rrule: rruleString.nullable().optional(),
  exclude_event_id: uuid.optional(),
  exclude_instance_id: z.string().max(100).optional(),
  suggest: z.boolean().optional(),
});

/** Pre-flight check used by the editor: what would this time overlap, and what's free instead. */
export const POST = route(async ({ ctx, body }) => {
  const start = new Date(body.start_at);
  const end = new Date(body.end_at);
  const intervals = body.rrule
    ? expandSeries({ start_at: start, end_at: end, all_day: false, timezone: ctx.tz, rrule: body.rrule }, start, new Date(start.getTime() + 56 * 86400_000))
    : [{ start, end }];
  const conflicts = await findConflicts(ctx, intervals, { eventId: body.exclude_event_id, instanceId: body.exclude_instance_id });
  let suggestions: Awaited<ReturnType<typeof findAvailableSlots>> = [];
  if (conflicts.length && body.suggest) {
    const minutes = Math.round((end.getTime() - start.getTime()) / 60_000);
    const from = new Date(start.getTime() - 4 * 3600_000);
    suggestions = await findAvailableSlots(ctx, { start: from.toISOString(), end: new Date(start.getTime() + 3 * 86400_000).toISOString(), duration_minutes: minutes, limit: 4 });
  }
  return { conflicts, suggestions };
}, schema);
