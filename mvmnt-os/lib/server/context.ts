import "server-only";
import type { Tx } from "@/lib/server/db";
import type { UserSettings } from "@/lib/types";

export type Ctx = {
  tx: Tx;
  userId: string;
  tz: string;
  settings: UserSettings;
  /** Who is acting — used for audit and `created_by`. */
  actor: "user" | "assistant";
  /** Injectable clock (tests, AI "now"). */
  now: () => Date;
};

export class AppError extends Error {
  constructor(
    public code: "not_found" | "invalid" | "conflict" | "forbidden" | "unavailable",
    message: string,
    public status = code === "not_found" ? 404 : code === "forbidden" ? 403 : code === "unavailable" ? 503 : 400,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new AppError("not_found", `${what} introuvable`);

const DEFAULT_SETTINGS: UserSettings = {
  theme: "system",
  week_start: 1,
  time_format: "24h",
  work_start: "09:00",
  work_end: "17:00",
  work_days: [1, 2, 3, 4, 5],
  default_event_minutes: 60,
  buffer_minutes: 10,
  ai_provider: "anthropic",
  ai_confirm_writes: false,
};

export async function loadContext(tx: Tx, userId: string, actor: Ctx["actor"] = "user"): Promise<Ctx> {
  const rows = await tx`
    select p.timezone,
           s.theme, s.week_start, s.time_format,
           to_char(s.work_start, 'HH24:MI') as work_start,
           to_char(s.work_end, 'HH24:MI') as work_end,
           s.work_days, s.default_event_minutes, s.buffer_minutes, s.ai_provider, s.ai_confirm_writes
    from public.profiles p
    left join public.user_settings s on s.user_id = p.id
    where p.id = ${userId}`;
  const r = rows[0];
  const settings: UserSettings = r?.theme
    ? {
        theme: r.theme,
        week_start: r.week_start,
        time_format: r.time_format,
        work_start: r.work_start,
        work_end: r.work_end,
        work_days: r.work_days,
        default_event_minutes: r.default_event_minutes,
        buffer_minutes: r.buffer_minutes,
        ai_provider: r.ai_provider,
        ai_confirm_writes: r.ai_confirm_writes,
      }
    : DEFAULT_SETTINGS;
  return { tx, userId, tz: r?.timezone ?? "America/Toronto", settings, actor, now: () => new Date() };
}
