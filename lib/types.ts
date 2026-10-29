import type { TASK_PRIORITIES, TASK_STATUSES, PROJECT_STATUSES } from "@/lib/schemas";

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export type Category = { id: string; name: string; color: string; slug: string | null; sort_order: number };

export type Project = {
  id: string;
  name: string;
  description: string | null;
  notes: string | null;
  color: string;
  status: ProjectStatus;
  start_date: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
};

export type ProjectSummary = Project & {
  tasks_total: number;
  tasks_done: number;
  tasks_open: number;
  next_due_date: string | null;
  next_event_at: string | null;
};

export type Subtask = { id: string; task_id: string; title: string; done: boolean; sort_order: number };

export type Task = {
  id: string;
  title: string;
  description: string | null;
  notes: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  due_time: string | null;
  planned_start: string | null;
  estimated_minutes: number | null;
  project_id: string | null;
  category_id: string | null;
  recurrence_rule: string | null;
  reschedule_count: number;
  completed_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  subtasks_total: number;
  subtasks_done: number;
  scheduled_minutes: number; // total length of calendar blocks linked to this task
  next_block_at: string | null;
};

export type TaskDetail = Task & { subtasks: Subtask[]; blocks: EventOccurrence[]; reminder_offsets: number[] };

export type EventRow = {
  id: string;
  title: string;
  description: string | null;
  notes: string | null;
  location: string | null;
  color: string | null;
  start_at: string;
  end_at: string;
  all_day: boolean;
  timezone: string;
  busy: boolean;
  locked: boolean;
  rrule: string | null;
  exdates: string[];
  recurrence_parent_id: string | null;
  original_start: string | null;
  project_id: string | null;
  category_id: string | null;
  task_id: string | null;
  created_by: "user" | "assistant";
  created_at: string;
  updated_at: string;
};

/** One concrete occurrence on the calendar (a single event, an override, or an expanded instance). */
export type EventOccurrence = EventRow & {
  /** `${id}` for single events, `${id}__${occurrenceStartISO}` for expanded recurring instances. */
  instance_id: string;
  occurrence_start: string;
  occurrence_end: string;
  is_recurring_instance: boolean;
  task_status: TaskStatus | null;
};

export type EventDetail = EventRow & { reminder_offsets: number[] };

export type Conflict = { instance_id: string; title: string; start: string; end: string };

export type Slot = { start: string; end: string; minutes: number };

export type DaySchedule = {
  date: string; // YYYY-MM-DD in user tz
  timezone: string;
  events: EventOccurrence[];
  tasks_due: Task[];
  tasks_planned: Task[];
  overdue: Task[];
  priorities: Task[];
  next_event: EventOccurrence | null;
  work_minutes: number;
  busy_minutes: number;
  free_minutes: number;
  free_slots: Slot[];
};

export type Profile = { id: string; full_name: string | null; avatar_url: string | null; timezone: string; locale: string };

export type UserSettings = {
  theme: "system" | "light" | "dark";
  week_start: number;
  time_format: "24h" | "12h";
  work_start: string;
  work_end: string;
  work_days: number[];
  default_event_minutes: number;
  buffer_minutes: number;
  ai_provider: "anthropic" | "openai";
  ai_confirm_writes: boolean;
};

export type NotificationPreferences = {
  enabled: boolean;
  event_lead_minutes: number;
  task_reminders: boolean;
  deadline_alerts: boolean;
  conflict_alerts: boolean;
  daily_summary_enabled: boolean;
  daily_summary_time: string;
  quiet_start: string | null;
  quiet_end: string | null;
  muted_category_ids: string[];
};

export type Me = {
  user: { id: string; email: string };
  profile: Profile;
  settings: UserSettings;
  notifications: NotificationPreferences;
};
