-- Runs the reminder engine every minute from Supabase (free), so reminders
-- fire even when the app is closed. Run ONCE in Supabase → SQL Editor after
-- deploying, replacing the two placeholders.
--
--   <APP_URL>      your production URL, e.g. https://mvmnt-os.vercel.app
--   <CRON_SECRET>  the same value as the CRON_SECRET env var on Vercel

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'mvmnt-os-reminders',
  '* * * * *',
  $$
  select net.http_post(
    url := '<APP_URL>/api/cron/reminders',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>', 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- To check:   select * from cron.job_run_details order by start_time desc limit 5;
-- To remove:  select cron.unschedule('mvmnt-os-reminders');
