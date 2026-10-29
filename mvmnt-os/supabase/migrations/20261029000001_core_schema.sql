-- ============================================================================
-- MVMNT OS — core schema
-- Every user-owned row carries user_id and is protected by RLS.
-- Child rows reference parents through (id, user_id) composite keys, so a row
-- can never point at another user's project/task/category, even though
-- foreign-key checks bypass RLS.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Profiles & settings
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text check (char_length(full_name) <= 120),
  avatar_url  text check (char_length(avatar_url) <= 2048),
  timezone    text not null default 'America/Toronto' check (char_length(timezone) <= 64),
  locale      text not null default 'fr-CA' check (locale in ('fr-CA', 'en-CA')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.user_settings (
  user_id                 uuid primary key references auth.users (id) on delete cascade,
  theme                   text not null default 'system' check (theme in ('system', 'light', 'dark')),
  week_start              smallint not null default 1 check (week_start between 0 and 6),
  time_format             text not null default '24h' check (time_format in ('24h', '12h')),
  work_start              time not null default '09:00',
  work_end                time not null default '17:00',
  work_days               smallint[] not null default '{1,2,3,4,5}',
  default_event_minutes   integer not null default 60 check (default_event_minutes between 5 and 720),
  buffer_minutes          integer not null default 10 check (buffer_minutes between 0 and 120),
  ai_provider             text not null default 'anthropic' check (ai_provider in ('anthropic', 'openai')),
  ai_confirm_writes       boolean not null default false,   -- true = confirm every write, false = confirm only destructive/important ones
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check (work_end > work_start)
);

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  color       text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  slug        text check (char_length(slug) <= 40),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, name)
);

-- ---------------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------------
create table public.projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 120),
  description text check (char_length(description) <= 5000),
  notes       text check (char_length(notes) <= 20000),
  color       text not null default '#5E17EB' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  status      text not null default 'active' check (status in ('active', 'paused', 'completed', 'archived')),
  start_date  date,
  due_date    date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, user_id),
  check (due_date is null or start_date is null or due_date >= start_date)
);

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------
create table public.tasks (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  project_id         uuid,
  category_id        uuid,
  title              text not null check (char_length(title) between 1 and 300),
  description        text check (char_length(description) <= 10000),
  notes              text check (char_length(notes) <= 20000),
  status             text not null default 'todo' check (status in ('todo', 'in_progress', 'done', 'cancelled')),
  priority           text not null default 'normal' check (priority in ('urgent', 'high', 'normal', 'low')),
  due_date           date,                    -- deadline, as a calendar date in the user's timezone
  due_time           time,                    -- optional time on that date
  planned_start      timestamptz,             -- "date de début planifiée"
  estimated_minutes  integer check (estimated_minutes between 5 and 1440),
  recurrence_rule    text check (char_length(recurrence_rule) <= 500),
  reschedule_count   integer not null default 0,   -- how often the deadline was pushed back
  completed_at       timestamptz,
  sort_order         double precision not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, user_id),
  foreign key (project_id, user_id)  references public.projects (id, user_id)   on delete set null (project_id),
  foreign key (category_id, user_id) references public.categories (id, user_id) on delete set null (category_id)
);

create table public.task_subtasks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  task_id     uuid not null,
  title       text not null check (char_length(title) between 1 and 300),
  done        boolean not null default false,
  sort_order  double precision not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (task_id, user_id) references public.tasks (id, user_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Events (appointments, work blocks, task blocks)
-- Recurring series: rrule (RFC 5545 RRULE body, no DTSTART) interpreted in
-- `timezone` wall-clock time starting at start_at. Single-occurrence
-- exceptions: exdates (original occurrence starts) + override rows that point
-- to the series through recurrence_parent_id / original_start.
-- ---------------------------------------------------------------------------
create table public.events (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users (id) on delete cascade,
  project_id            uuid,
  category_id           uuid,
  task_id               uuid,
  title                 text not null check (char_length(title) between 1 and 300),
  description           text check (char_length(description) <= 10000),
  notes                 text check (char_length(notes) <= 20000),
  location              text check (char_length(location) <= 500),
  color                 text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  start_at              timestamptz not null,
  end_at                timestamptz not null,
  all_day               boolean not null default false,
  timezone              text not null default 'America/Toronto' check (char_length(timezone) <= 64),
  busy                  boolean not null default true,     -- counts for conflict detection / availability
  locked                boolean not null default false,    -- AI may never move it without explicit permission
  rrule                 text check (char_length(rrule) <= 500),
  rrule_until           timestamptz,                       -- denormalised series end, null = open-ended
  exdates               timestamptz[] not null default '{}',
  recurrence_parent_id  uuid,
  original_start        timestamptz,
  created_by            text not null default 'user' check (created_by in ('user', 'assistant')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (id, user_id),
  check (end_at > start_at),
  check (rrule is null or recurrence_parent_id is null),
  foreign key (project_id, user_id)  references public.projects (id, user_id)   on delete set null (project_id),
  foreign key (category_id, user_id) references public.categories (id, user_id) on delete set null (category_id),
  foreign key (task_id, user_id)     references public.tasks (id, user_id)      on delete set null (task_id),
  foreign key (recurrence_parent_id, user_id) references public.events (id, user_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Reminders & notifications
-- ---------------------------------------------------------------------------
create table public.reminders (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  event_id        uuid,
  task_id         uuid,
  offset_minutes  integer not null default 15 check (offset_minutes between 0 and 40320),
  channel         text not null default 'push' check (channel in ('in_app', 'push', 'email')),
  next_fire_at    timestamptz,             -- computed by the scheduler (phase 3)
  last_fired_at   timestamptz,
  created_at      timestamptz not null default now(),
  check ((event_id is null) <> (task_id is null)),
  foreign key (event_id, user_id) references public.events (id, user_id) on delete cascade,
  foreign key (task_id, user_id)  references public.tasks (id, user_id)  on delete cascade
);

create table public.notification_preferences (
  user_id                uuid primary key references auth.users (id) on delete cascade,
  enabled                boolean not null default true,
  event_lead_minutes     integer not null default 15 check (event_lead_minutes between 0 and 1440),
  task_reminders         boolean not null default true,
  deadline_alerts        boolean not null default true,
  conflict_alerts        boolean not null default true,
  daily_summary_enabled  boolean not null default true,
  daily_summary_time     time not null default '07:00',
  quiet_start            time,
  quiet_end              time,
  muted_category_ids     uuid[] not null default '{}',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('event_reminder', 'task_reminder', 'deadline', 'daily_summary', 'conflict', 'system')),
  title       text not null check (char_length(title) <= 200),
  body        text check (char_length(body) <= 2000),
  link        text check (char_length(link) <= 500),
  dedupe_key  text,
  read_at     timestamptz,
  created_at  timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create table public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  endpoint    text not null unique check (char_length(endpoint) <= 2048),
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- AI assistant
-- ---------------------------------------------------------------------------
create table public.ai_conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text check (char_length(title) <= 200),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, user_id)
);

create table public.ai_messages (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  conversation_id  uuid not null,
  role             text not null check (role in ('user', 'assistant')),
  content          jsonb not null,      -- provider-neutral content blocks
  created_at       timestamptz not null default now(),
  foreign key (conversation_id, user_id) references public.ai_conversations (id, user_id) on delete cascade
);

-- Audit trail: every tool call the assistant proposes or executes.
create table public.ai_actions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  conversation_id  uuid,
  tool             text not null,
  args             jsonb not null default '{}'::jsonb,
  status           text not null check (status in ('proposed', 'executed', 'rejected', 'failed')),
  result           jsonb,
  error            text,
  created_at       timestamptz not null default now(),
  decided_at       timestamptz,
  foreign key (conversation_id, user_id) references public.ai_conversations (id, user_id) on delete set null (conversation_id)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index events_user_start_idx        on public.events (user_id, start_at);
create index events_user_end_idx          on public.events (user_id, end_at);
create index events_user_recurring_idx    on public.events (user_id) where rrule is not null;
create index events_parent_idx            on public.events (recurrence_parent_id) where recurrence_parent_id is not null;
create index events_task_idx              on public.events (task_id) where task_id is not null;
create index events_project_idx           on public.events (project_id) where project_id is not null;
create index tasks_user_status_due_idx    on public.tasks (user_id, status, due_date);
create index tasks_user_project_idx       on public.tasks (user_id, project_id);
create index tasks_user_planned_idx       on public.tasks (user_id, planned_start) where planned_start is not null;
create index subtasks_task_idx            on public.task_subtasks (task_id, sort_order);
create index projects_user_status_idx     on public.projects (user_id, status);
create index categories_user_idx          on public.categories (user_id, sort_order);
create index reminders_fire_idx           on public.reminders (next_fire_at) where next_fire_at is not null;
create index reminders_event_idx          on public.reminders (event_id) where event_id is not null;
create index reminders_task_idx           on public.reminders (task_id) where task_id is not null;
create index notifications_user_idx       on public.notifications (user_id, created_at desc);
create index ai_messages_conv_idx         on public.ai_messages (conversation_id, created_at);
create index ai_actions_user_idx          on public.ai_actions (user_id, created_at desc);
create index push_subscriptions_user_idx  on public.push_subscriptions (user_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create trigger profiles_updated_at          before update on public.profiles                 for each row execute function public.set_updated_at();
create trigger user_settings_updated_at     before update on public.user_settings            for each row execute function public.set_updated_at();
create trigger categories_updated_at        before update on public.categories               for each row execute function public.set_updated_at();
create trigger projects_updated_at          before update on public.projects                 for each row execute function public.set_updated_at();
create trigger tasks_updated_at             before update on public.tasks                    for each row execute function public.set_updated_at();
create trigger subtasks_updated_at          before update on public.task_subtasks            for each row execute function public.set_updated_at();
create trigger events_updated_at            before update on public.events                   for each row execute function public.set_updated_at();
create trigger notif_prefs_updated_at       before update on public.notification_preferences for each row execute function public.set_updated_at();
create trigger ai_conversations_updated_at  before update on public.ai_conversations         for each row execute function public.set_updated_at();

-- Task bookkeeping: completion timestamp + deadline push-back counter.
create or replace function public.tasks_bookkeeping() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if new.status = 'done' and old.status <> 'done' then
      new.completed_at := now();
    elsif new.status <> 'done' and old.status = 'done' then
      new.completed_at := null;
    end if;
    if old.due_date is not null and new.due_date is not null and new.due_date > old.due_date then
      new.reschedule_count := old.reschedule_count + 1;
    end if;
  elsif tg_op = 'INSERT' and new.status = 'done' and new.completed_at is null then
    new.completed_at := now();
  end if;
  return new;
end $$;

create trigger tasks_bookkeeping before insert or update on public.tasks
  for each row execute function public.tasks_bookkeeping();

-- ---------------------------------------------------------------------------
-- New user bootstrap: profile, settings, preferences, default categories.
-- These are configuration defaults, not demo data.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name)
    values (new.id, nullif(new.raw_user_meta_data ->> 'full_name', ''))
    on conflict do nothing;
  insert into public.user_settings (user_id) values (new.id) on conflict do nothing;
  insert into public.notification_preferences (user_id) values (new.id) on conflict do nothing;
  insert into public.categories (user_id, name, color, slug, sort_order) values
    (new.id, 'Rendez-vous',          '#5E17EB', 'meeting',     10),
    (new.id, 'Tournage',             '#E5484D', 'shoot',       20),
    (new.id, 'Montage',              '#F5A524', 'edit',        30),
    (new.id, 'Réunion',              '#3E7BFA', 'call',        40),
    (new.id, 'Travail administratif','#8B8D98', 'admin',       50),
    (new.id, 'Prospection',          '#12A594', 'prospecting', 60),
    (new.id, 'Personnel',            '#D6409F', 'personal',    70),
    (new.id, 'Autre',                '#6E6E78', 'other',       80)
  on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security — one owner policy per table.
-- ---------------------------------------------------------------------------
alter table public.profiles                 enable row level security;
alter table public.user_settings            enable row level security;
alter table public.categories               enable row level security;
alter table public.projects                 enable row level security;
alter table public.tasks                    enable row level security;
alter table public.task_subtasks            enable row level security;
alter table public.events                   enable row level security;
alter table public.reminders                enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notifications            enable row level security;
alter table public.push_subscriptions       enable row level security;
alter table public.ai_conversations         enable row level security;
alter table public.ai_messages              enable row level security;
alter table public.ai_actions               enable row level security;

create policy "own profile"  on public.profiles for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

do $$
declare t text;
begin
  foreach t in array array[
    'user_settings', 'categories', 'projects', 'tasks', 'task_subtasks', 'events',
    'reminders', 'notification_preferences', 'notifications', 'push_subscriptions',
    'ai_conversations', 'ai_messages', 'ai_actions'
  ] loop
    execute format(
      'create policy "owner access" on public.%I for all to authenticated
         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- The anon role gets nothing. Authenticated users get table privileges,
-- which RLS then narrows to their own rows.
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
