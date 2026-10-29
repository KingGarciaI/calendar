import { z } from "zod";

/**
 * Single source of truth for inputs. Used by API routes, the UI forms and the
 * AI tool definitions (converted to JSON Schema), so the three can never drift.
 */

export const uuid = z.uuid();
export const isoDateTime = z.iso.datetime({ offset: true });
export const isoDate = z.iso.date();
export const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Heure invalide (HH:MM)");
export const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Couleur invalide");
export const rruleString = z
  .string()
  .max(500)
  .regex(/^(RRULE:)?FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;[A-Z]+=[A-Z0-9,+\-:T]+)*$/, "Règle de récurrence invalide");

export const TASK_STATUSES = ["todo", "in_progress", "done", "cancelled"] as const;
export const TASK_PRIORITIES = ["urgent", "high", "normal", "low"] as const;
export const PROJECT_STATUSES = ["active", "paused", "completed", "archived"] as const;
export const RECURRENCE_SCOPES = ["occurrence", "following", "series"] as const;

export const taskStatus = z.enum(TASK_STATUSES);
export const taskPriority = z.enum(TASK_PRIORITIES);
export const projectStatus = z.enum(PROJECT_STATUSES);
export const recurrenceScope = z.enum(RECURRENCE_SCOPES);

const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) => text(max).nullable().optional();

// ---------------------------------------------------------------- events
export const eventCreateSchema = z
  .object({
    title: text(300).min(1, "Titre requis"),
    description: optText(10000),
    notes: optText(20000),
    location: optText(500),
    color: hexColor.nullable().optional(),
    start_at: isoDateTime,
    end_at: isoDateTime,
    all_day: z.boolean().optional(),
    busy: z.boolean().optional(),
    locked: z.boolean().optional(),
    rrule: rruleString.nullable().optional(),
    project_id: uuid.nullable().optional(),
    category_id: uuid.nullable().optional(),
    task_id: uuid.nullable().optional(),
    reminder_offsets: z.array(z.number().int().min(0).max(40320)).max(5).optional(),
  })
  .refine((v) => new Date(v.end_at) > new Date(v.start_at), { message: "La fin doit suivre le début", path: ["end_at"] });

export const eventUpdateSchema = z.object({
  patch: z
    .object({
      title: text(300).min(1),
      description: optText(10000),
      notes: optText(20000),
      location: optText(500),
      color: hexColor.nullable(),
      start_at: isoDateTime,
      end_at: isoDateTime,
      all_day: z.boolean(),
      busy: z.boolean(),
      locked: z.boolean(),
      rrule: rruleString.nullable(),
      project_id: uuid.nullable(),
      category_id: uuid.nullable(),
      task_id: uuid.nullable(),
      reminder_offsets: z.array(z.number().int().min(0).max(40320)).max(5),
    })
    .partial(),
  scope: recurrenceScope.default("series"),
  /** Start of the occurrence being edited (required for scope occurrence/following). */
  occurrence_start: isoDateTime.optional(),
});

export const eventDeleteSchema = z.object({
  scope: recurrenceScope.default("series"),
  occurrence_start: isoDateTime.optional(),
});

export const rangeSchema = z.object({ start: isoDateTime, end: isoDateTime });

// ---------------------------------------------------------------- tasks
export const taskCreateSchema = z.object({
  title: text(300).min(1, "Titre requis"),
  description: optText(10000),
  notes: optText(20000),
  status: taskStatus.optional(),
  priority: taskPriority.optional(),
  due_date: isoDate.nullable().optional(),
  due_time: timeOfDay.nullable().optional(),
  planned_start: isoDateTime.nullable().optional(),
  estimated_minutes: z.number().int().min(5).max(1440).nullable().optional(),
  project_id: uuid.nullable().optional(),
  category_id: uuid.nullable().optional(),
  recurrence_rule: rruleString.nullable().optional(),
  subtasks: z.array(text(300).min(1)).max(50).optional(),
  reminder_offsets: z.array(z.number().int().min(0).max(40320)).max(5).optional(),
});

export const taskUpdateSchema = taskCreateSchema
  .omit({ subtasks: true })
  .partial()
  .extend({ title: text(300).min(1).optional(), sort_order: z.number().optional() });

export const taskListSchema = z.object({
  status: z.array(taskStatus).optional(),
  project_id: uuid.optional(),
  priority: z.array(taskPriority).optional(),
  due_before: isoDate.optional(),
  due_after: isoDate.optional(),
  search: z.string().max(200).optional(),
  unscheduled: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

export const subtaskCreateSchema = z.object({ title: text(300).min(1) });
export const subtaskUpdateSchema = z.object({ title: text(300).min(1).optional(), done: z.boolean().optional(), sort_order: z.number().optional() });

export const scheduleTaskSchema = z.object({
  start_at: isoDateTime,
  duration_minutes: z.number().int().min(5).max(1440).optional(),
});

// ---------------------------------------------------------------- projects
export const projectCreateSchema = z.object({
  name: text(120).min(1, "Nom requis"),
  description: optText(5000),
  notes: optText(20000),
  color: hexColor.optional(),
  status: projectStatus.optional(),
  start_date: isoDate.nullable().optional(),
  due_date: isoDate.nullable().optional(),
});
export const projectUpdateSchema = projectCreateSchema.partial();

// ---------------------------------------------------------------- categories
export const categoryCreateSchema = z.object({ name: text(60).min(1), color: hexColor });
export const categoryUpdateSchema = z.object({ name: text(60).min(1).optional(), color: hexColor.optional(), sort_order: z.number().int().optional() });

// ---------------------------------------------------------------- availability
export const slotsSchema = z.object({
  start: isoDateTime,
  end: isoDateTime,
  duration_minutes: z.number().int().min(5).max(1440),
  within_work_hours: z.boolean().default(true),
  limit: z.number().int().min(1).max(50).default(10),
});

// ---------------------------------------------------------------- settings
export const settingsUpdateSchema = z.object({
  profile: z
    .object({
      full_name: optText(120),
      avatar_url: z.url().max(2048).nullable().optional(),
      timezone: z.string().max(64).optional(),
      locale: z.enum(["fr-CA", "en-CA"]).optional(),
    })
    .optional(),
  settings: z
    .object({
      theme: z.enum(["system", "light", "dark"]),
      week_start: z.number().int().min(0).max(6),
      time_format: z.enum(["24h", "12h"]),
      work_start: timeOfDay,
      work_end: timeOfDay,
      work_days: z.array(z.number().int().min(0).max(6)).max(7),
      default_event_minutes: z.number().int().min(5).max(720),
      buffer_minutes: z.number().int().min(0).max(120),
      ai_provider: z.enum(["anthropic", "openai"]),
      ai_confirm_writes: z.boolean(),
    })
    .partial()
    .optional(),
  notifications: z
    .object({
      enabled: z.boolean(),
      event_lead_minutes: z.number().int().min(0).max(1440),
      task_reminders: z.boolean(),
      deadline_alerts: z.boolean(),
      conflict_alerts: z.boolean(),
      daily_summary_enabled: z.boolean(),
      daily_summary_time: timeOfDay,
      quiet_start: timeOfDay.nullable(),
      quiet_end: timeOfDay.nullable(),
      muted_category_ids: z.array(uuid).max(50),
    })
    .partial()
    .optional(),
});

export type EventCreateInput = z.infer<typeof eventCreateSchema>;
export type EventUpdateInput = z.input<typeof eventUpdateSchema>;
export type TaskCreateInput = z.infer<typeof taskCreateSchema>;
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>;
export type TaskListFilter = z.infer<typeof taskListSchema>;
export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;
export type SettingsUpdateInput = z.infer<typeof settingsUpdateSchema>;
