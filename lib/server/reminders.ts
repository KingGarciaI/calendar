import "server-only";
import { DateTime } from "luxon";
import webpush from "web-push";
import { loadContext, type Ctx } from "@/lib/server/context";
import { sql, withUser } from "@/lib/server/db";
import { getOccurrences } from "@/lib/server/services/events";
import { getDaySchedule } from "@/lib/server/services/schedule";

/**
 * Reminder engine. Called every minute by an external scheduler (see README):
 * finds what is due in the last few minutes, records an in-app notification
 * (deduplicated, so a late or repeated run never double-notifies), then sends
 * Web Push to the user's devices unless it's quiet hours.
 */

const WINDOW_MS = 6 * 60_000; // tolerate a few missed scheduler runs
const LOOKAHEAD_DAYS = 8;

export type PushPayload = { title: string; body: string; url: string; tag: string };
export type PushSubscriptionRow = { id: string; endpoint: string; p256dh: string; auth: string };
export type PushSender = (sub: PushSubscriptionRow, payload: PushPayload) => Promise<{ gone?: boolean; ok: boolean }>;

export function pushConfigured() {
  return !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export const webPushSender: PushSender = async (sub, payload) => {
  if (!pushConfigured()) return { ok: false };
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.com", process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: 3600, urgency: "high" });
    return { ok: true };
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    return { ok: false, gone: status === 404 || status === 410 };
  }
};

type Prefs = {
  enabled: boolean;
  task_reminders: boolean;
  daily_summary_enabled: boolean;
  daily_summary_time: string;
  quiet_start: string | null;
  quiet_end: string | null;
  muted_category_ids: string[];
};

function inQuietHours(local: DateTime, p: Prefs) {
  if (!p.quiet_start || !p.quiet_end) return false;
  const t = local.toFormat("HH:mm");
  const s = p.quiet_start.slice(0, 5);
  const e = p.quiet_end.slice(0, 5);
  return s <= e ? t >= s && t < e : t >= s || t < e; // window may cross midnight
}

const hm = (iso: string, tz: string) => {
  const d = DateTime.fromISO(iso, { zone: tz });
  return d.minute ? d.toFormat("H 'h' mm") : d.toFormat("H 'h'");
};

function leadText(min: number) {
  if (min === 0) return "Maintenant";
  if (min < 60) return `Dans ${min} min`;
  if (min < 1440) return `Dans ${Math.round(min / 60)} h`;
  return min === 1440 ? "Demain" : `Dans ${Math.round(min / 1440)} jours`;
}

type Pending = { payload: PushPayload; push: boolean };

async function notify(ctx: Ctx, kind: string, key: string, payload: PushPayload, push: boolean, out: Pending[]) {
  const rows = await ctx.tx`insert into public.notifications (user_id, kind, title, body, link, dedupe_key)
    values (${ctx.userId}, ${kind}, ${payload.title}, ${payload.body}, ${payload.url}, ${key})
    on conflict (user_id, dedupe_key) do nothing returning id`;
  if (rows.length) out.push({ payload, push });
}

export async function processUser(userId: string, now: Date): Promise<{ pending: Pending[]; subs: PushSubscriptionRow[] }> {
  return withUser(userId, async (tx) => {
    const ctx = await loadContext(tx, userId, "user");
    ctx.now = () => now;
    const [p] = (await tx`select enabled, task_reminders, daily_summary_enabled,
        to_char(daily_summary_time, 'HH24:MI') as daily_summary_time,
        to_char(quiet_start, 'HH24:MI') as quiet_start, to_char(quiet_end, 'HH24:MI') as quiet_end, muted_category_ids
      from public.notification_preferences where user_id = ${userId}`) as unknown as Prefs[];
    const out: Pending[] = [];
    if (!p?.enabled) return { pending: out, subs: [] };
    const local = DateTime.fromJSDate(now, { zone: ctx.tz });
    const quiet = inQuietHours(local, p);
    const from = now.getTime() - WINDOW_MS;
    const due = (fireAt: number) => fireAt > from && fireAt <= now.getTime();

    // ---- events
    const occ = await getOccurrences(ctx, new Date(from), new Date(now.getTime() + LOOKAHEAD_DAYS * 86400_000));
    const ids = [...new Set(occ.map((o) => o.id))];
    if (ids.length) {
      const rem = await tx`select event_id, offset_minutes from public.reminders where event_id = any(${ids}::uuid[])`;
      const byEvent = new Map<string, number[]>();
      for (const r of rem) byEvent.set(r.event_id, [...(byEvent.get(r.event_id) ?? []), r.offset_minutes]);
      for (const o of occ) {
        if (o.all_day || (o.category_id && p.muted_category_ids?.includes(o.category_id))) continue;
        for (const off of byEvent.get(o.id) ?? []) {
          const fire = new Date(o.occurrence_start).getTime() - off * 60_000;
          if (!due(fire)) continue;
          await notify(
            ctx,
            "event_reminder",
            `ev:${o.instance_id}:${off}`,
            {
              title: o.title,
              body: [leadText(off), `${hm(o.occurrence_start, ctx.tz)} – ${hm(o.occurrence_end, ctx.tz)}`, o.location].filter(Boolean).join(" · "),
              url: "/today",
              tag: `ev-${o.instance_id}`,
            },
            !quiet,
            out,
          );
        }
      }
    }

    // ---- tasks with a deadline reminder
    if (p.task_reminders) {
      const rows = await tx`select t.id, t.title, t.due_date, to_char(t.due_time,'HH24:MI') as due_time, r.offset_minutes
        from public.reminders r join public.tasks t on t.id = r.task_id
        where t.user_id = ${userId} and t.status in ('todo','in_progress') and t.due_date is not null
          and t.due_date between ${local.minus({ days: 1 }).toISODate()}::date and ${local.plus({ days: 30 }).toISODate()}::date`;
      for (const t of rows) {
        const dueAt = DateTime.fromISO(`${t.due_date}T${t.due_time ?? "09:00"}`, { zone: ctx.tz }).toMillis();
        const fire = dueAt - t.offset_minutes * 60_000;
        if (!due(fire)) continue;
        await notify(
          ctx,
          "task_reminder",
          `task:${t.id}:${t.offset_minutes}:${t.due_date}`,
          { title: t.title, body: t.offset_minutes ? `Échéance ${t.offset_minutes >= 1440 ? "demain" : `dans ${Math.round(t.offset_minutes / 60)} h`}` : "Échéance maintenant", url: "/tasks", tag: `task-${t.id}` },
          !quiet,
          out,
        );
      }
    }

    // ---- daily summary
    if (p.daily_summary_enabled) {
      const at = DateTime.fromISO(`${local.toISODate()}T${p.daily_summary_time}`, { zone: ctx.tz }).toMillis();
      if (due(at)) {
        const day = await getDaySchedule(ctx, local.toISODate()!);
        const timed = day.events.filter((e) => !e.all_day);
        const parts = [
          timed.length ? `${timed.length} rendez-vous` : "Aucun rendez-vous",
          `${day.tasks_due.length + day.tasks_planned.length} tâche${day.tasks_due.length + day.tasks_planned.length > 1 ? "s" : ""}`,
          day.overdue.length ? `${day.overdue.length} en retard` : null,
        ].filter(Boolean);
        const first = timed[0] ? `Premier : ${timed[0].title} à ${hm(timed[0].occurrence_start, ctx.tz)}.` : day.priorities[0] ? `Priorité : ${day.priorities[0].title}.` : "";
        await notify(ctx, "daily_summary", `daily:${local.toISODate()}`, { title: "Ta journée", body: `${parts.join(" · ")}. ${first}`.trim(), url: "/today", tag: "daily" }, !quiet, out);
      }
    }

    const subs = out.some((o) => o.push)
      ? ((await tx`select id, endpoint, p256dh, auth from public.push_subscriptions where user_id = ${userId}`) as unknown as PushSubscriptionRow[])
      : [];
    return { pending: out, subs };
  });
}

export async function runReminders(opts: { now?: Date; send?: PushSender; userIds?: string[] } = {}) {
  const now = opts.now ?? new Date();
  const send = opts.send ?? webPushSender;
  const ids = opts.userIds ?? (await sql()`select public.reminder_user_ids() as id`).map((r) => r.id as string);
  let notifications = 0;
  let pushes = 0;
  for (const id of ids) {
    try {
      const { pending, subs } = await processUser(id, now);
      notifications += pending.length;
      for (const n of pending.filter((x) => x.push)) {
        for (const s of subs) {
          const r = await send(s, n.payload);
          if (r.ok) pushes++;
          if (r.gone) await withUser(id, (tx) => tx`delete from public.push_subscriptions where id = ${s.id}`);
        }
      }
    } catch (e) {
      console.error("[reminders] user failed", id, e);
    }
  }
  return { users: ids.length, notifications, pushes, push_configured: pushConfigured() };
}
