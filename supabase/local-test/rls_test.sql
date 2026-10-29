-- TEST ONLY — verifies data isolation between two users.
\set ON_ERROR_STOP 1
begin;
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'b@test.local');

-- bootstrap trigger ran
do $$ begin
  assert (select count(*) from public.categories where user_id = '11111111-1111-1111-1111-111111111111') = 8, 'default categories';
  assert (select count(*) from public.user_settings where user_id in ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222')) = 2, 'settings rows';
end $$;

-- ---- user A creates data
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
insert into public.projects (id, user_id, name) values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Projet A');
insert into public.tasks (id, user_id, project_id, title) values ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'Tâche A');
insert into public.events (user_id, title, start_at, end_at) values ('11111111-1111-1111-1111-111111111111', 'Evt A', now(), now() + interval '1 hour');

-- A cannot write rows owned by B
do $$ begin
  begin
    insert into public.projects (user_id, name) values ('22222222-2222-2222-2222-222222222222', 'spoof');
    raise exception 'RLS FAILED: insert for other user allowed';
  exception when insufficient_privilege then null; end;
end $$;

-- ---- user B
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222"}', true);
do $$ begin
  assert (select count(*) from public.projects) = 0, 'B sees A projects';
  assert (select count(*) from public.tasks) = 0, 'B sees A tasks';
  assert (select count(*) from public.events) = 0, 'B sees A events';
  assert (select count(*) from public.categories) = 8, 'B sees only own categories';
  assert (select count(*) from public.profiles) = 1, 'B sees one profile';
end $$;

-- B cannot update or delete A's rows (silently affects 0 rows)
update public.tasks set title = 'hacked' where id = 'aaaaaaaa-0000-0000-0000-000000000002';
delete from public.projects where id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- B cannot attach its task to A's project (composite FK)
do $$ begin
  begin
    insert into public.tasks (user_id, project_id, title) values ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000001', 'leech');
    raise exception 'FK FAILED: cross-user project link allowed';
  exception when foreign_key_violation then null; end;
end $$;

-- B cannot change user_id of its own row to A (with check)
insert into public.projects (id, user_id, name) values ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Projet B');
do $$ begin
  begin
    update public.projects set user_id = '11111111-1111-1111-1111-111111111111' where id = 'bbbbbbbb-0000-0000-0000-000000000001';
    raise exception 'RLS FAILED: ownership transfer allowed';
  exception when insufficient_privilege then null; end;
end $$;

-- ---- anon sees nothing
reset role;
set local role anon;
do $$ begin
  begin
    perform 1 from public.tasks;
    raise exception 'anon can read tasks';
  exception when insufficient_privilege then null; end;
end $$;

-- ---- back to A: data intact, bookkeeping works
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
update public.tasks set due_date = '2026-11-01' where id = 'aaaaaaaa-0000-0000-0000-000000000002';
update public.tasks set due_date = '2026-11-05', status = 'done' where id = 'aaaaaaaa-0000-0000-0000-000000000002';
do $$
declare t record;
begin
  select * into t from public.tasks where id = 'aaaaaaaa-0000-0000-0000-000000000002';
  assert t.title = 'Tâche A', 'title was modified by B';
  assert t.reschedule_count = 1, 'reschedule_count';
  assert t.completed_at is not null, 'completed_at';
  assert (select count(*) from public.projects) = 1, 'A project deleted by B';
end $$;

-- deleting a project nulls the link but keeps user_id
delete from public.projects where id = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$ begin
  assert (select project_id from public.tasks where id = 'aaaaaaaa-0000-0000-0000-000000000002') is null, 'project_id not nulled';
  assert (select user_id from public.tasks where id = 'aaaaaaaa-0000-0000-0000-000000000002') is not null, 'user_id nulled';
end $$;

select 'ALL RLS TESTS PASSED' as result;
rollback;
