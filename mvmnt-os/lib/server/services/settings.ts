import "server-only";
import { AppError, type Ctx } from "@/lib/server/context";
import type { SettingsUpdateInput } from "@/lib/schemas";
import type { Me, NotificationPreferences, Profile } from "@/lib/types";

export async function getMe(ctx: Ctx, email: string): Promise<Me> {
  const [p] = await ctx.tx`select id, full_name, avatar_url, timezone, locale from public.profiles where id = ${ctx.userId}`;
  const [n] = await ctx.tx`
    select enabled, event_lead_minutes, task_reminders, deadline_alerts, conflict_alerts, daily_summary_enabled,
           to_char(daily_summary_time,'HH24:MI') as daily_summary_time,
           to_char(quiet_start,'HH24:MI') as quiet_start, to_char(quiet_end,'HH24:MI') as quiet_end, muted_category_ids
      from public.notification_preferences where user_id = ${ctx.userId}`;
  return {
    user: { id: ctx.userId, email },
    profile: (p as unknown as Profile) ?? { id: ctx.userId, full_name: null, avatar_url: null, timezone: ctx.tz, locale: "fr-CA" },
    settings: ctx.settings,
    notifications: (n as unknown as NotificationPreferences) ?? {
      enabled: true,
      event_lead_minutes: 15,
      task_reminders: true,
      deadline_alerts: true,
      conflict_alerts: true,
      daily_summary_enabled: true,
      daily_summary_time: "07:00",
      quiet_start: null,
      quiet_end: null,
      muted_category_ids: [],
    },
  };
}

function validTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function updateSettings(ctx: Ctx, input: SettingsUpdateInput) {
  if (input.profile) {
    if (input.profile.timezone && !validTimezone(input.profile.timezone)) throw new AppError("invalid", "Fuseau horaire inconnu");
    const values = Object.fromEntries(Object.entries(input.profile).filter(([, v]) => v !== undefined));
    if (Object.keys(values).length) await ctx.tx`update public.profiles set ${ctx.tx(values)} where id = ${ctx.userId}`;
  }
  if (input.settings) {
    const s = { ...ctx.settings, ...input.settings };
    if (s.work_end <= s.work_start) throw new AppError("invalid", "La fin de journée doit suivre le début");
    const values = Object.fromEntries(Object.entries(input.settings).filter(([, v]) => v !== undefined));
    if (Object.keys(values).length) {
      await ctx.tx`insert into public.user_settings (user_id) values (${ctx.userId}) on conflict do nothing`;
      await ctx.tx`update public.user_settings set ${ctx.tx(values)} where user_id = ${ctx.userId}`;
    }
  }
  if (input.notifications) {
    const values = Object.fromEntries(Object.entries(input.notifications).filter(([, v]) => v !== undefined));
    if (Object.keys(values).length) {
      await ctx.tx`insert into public.notification_preferences (user_id) values (${ctx.userId}) on conflict do nothing`;
      await ctx.tx`update public.notification_preferences set ${ctx.tx(values)} where user_id = ${ctx.userId}`;
    }
  }
}

/** Full export of the user's own data (JSON). */
export async function exportData(ctx: Ctx, what: "tasks" | "events" | "all") {
  const out: Record<string, unknown> = { exported_at: new Date().toISOString(), timezone: ctx.tz };
  if (what === "tasks" || what === "all") {
    out.tasks = await ctx.tx`select * from public.tasks where user_id = ${ctx.userId} order by created_at`;
    out.subtasks = await ctx.tx`select * from public.task_subtasks where user_id = ${ctx.userId} order by created_at`;
  }
  if (what === "events" || what === "all") {
    out.events = await ctx.tx`select * from public.events where user_id = ${ctx.userId} order by start_at`;
  }
  if (what === "all") {
    out.projects = await ctx.tx`select * from public.projects where user_id = ${ctx.userId}`;
    out.categories = await ctx.tx`select * from public.categories where user_id = ${ctx.userId}`;
  }
  return out;
}
