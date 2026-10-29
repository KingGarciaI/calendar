-- Reminder engine support.
-- The scheduler runs without a user session, so it needs to know which users
-- have reminders enabled. This narrow SECURITY DEFINER function exposes only
-- user ids (no content); all per-user work then runs under that user's RLS.
create or replace function public.reminder_user_ids()
returns setof uuid
language sql stable security definer set search_path = '' as $$
  select np.user_id from public.notification_preferences np where np.enabled
$$;

revoke all on function public.reminder_user_ids() from public, anon, authenticated;

create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;
