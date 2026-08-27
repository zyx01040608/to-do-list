-- Run this file in Supabase Dashboard > SQL Editor.
-- This version uses one private shared Auth account for exactly two people.

create table if not exists public.app_settings (
  id boolean primary key default true check (id = true),
  login_email text not null check (login_email = lower(login_email)),
  person_one text not null default '你' check (char_length(person_one) between 1 and 20),
  person_two text not null default 'TA' check (char_length(person_two) between 1 and 20),
  updated_at timestamptz not null default now()
);

create table if not exists public.anniversaries (
  id text primary key default gen_random_uuid()::text,
  title text not null check (char_length(title) between 1 and 40),
  anniversary_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.todos (
  id text primary key default gen_random_uuid()::text,
  text text not null check (char_length(text) between 1 and 300),
  note text not null default '' check (char_length(note) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'completed')),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  restored_at timestamptz,
  completed_at timestamptz,
  constraint completed_items_have_a_time check (
    (status = 'pending' and completed_at is null)
    or (status = 'completed' and completed_at is not null)
  )
);

create or replace function public.is_private_member()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.app_settings
    where id = true and login_email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.is_private_member() from public;
grant execute on function public.is_private_member() to authenticated;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at = now(); return new; end; $$;

drop trigger if exists todos_set_updated_at on public.todos;
create trigger todos_set_updated_at before update on public.todos
for each row execute function public.set_updated_at();
drop trigger if exists app_settings_set_updated_at on public.app_settings;
create trigger app_settings_set_updated_at before update on public.app_settings
for each row execute function public.set_updated_at();
drop trigger if exists anniversaries_set_updated_at on public.anniversaries;
create trigger anniversaries_set_updated_at before update on public.anniversaries
for each row execute function public.set_updated_at();

alter table public.app_settings enable row level security;
alter table public.todos enable row level security;
alter table public.anniversaries enable row level security;
revoke all on table public.app_settings from anon, authenticated;
revoke all on table public.todos from anon, authenticated;
revoke all on table public.anniversaries from anon, authenticated;
grant select (person_one, person_two) on table public.app_settings to authenticated;
grant update (person_one, person_two) on table public.app_settings to authenticated;
grant select, insert, delete on table public.todos to authenticated;
grant update (text, note, status, restored_at, completed_at) on table public.todos to authenticated;
grant select, insert, delete on table public.anniversaries to authenticated;
grant update (title, anniversary_date) on table public.anniversaries to authenticated;

-- Remove policy names from the earlier email-whitelist version if this project
-- was already initialized with the previous schema. The table may not exist
-- in a fresh project, so guard the cleanup first.
do $$
begin
  if to_regclass('public.private_members') is not null then
    execute 'drop policy if exists "members can read the private member list" on public.private_members';
  end if;
end $$;
drop policy if exists "members can read shared todos" on public.todos;
drop policy if exists "members can create shared todos" on public.todos;
drop policy if exists "members can update shared todos" on public.todos;
drop policy if exists "members can delete shared todos" on public.todos;

drop policy if exists "the shared account can read settings" on public.app_settings;
create policy "the shared account can read settings" on public.app_settings
for select to authenticated using (public.is_private_member());
drop policy if exists "the shared account can update settings" on public.app_settings;
create policy "the shared account can update settings" on public.app_settings
for update to authenticated using (public.is_private_member()) with check (public.is_private_member());
drop policy if exists "the shared account can read todos" on public.todos;
create policy "the shared account can read todos" on public.todos
for select to authenticated using (public.is_private_member());
drop policy if exists "the shared account can create todos" on public.todos;
create policy "the shared account can create todos" on public.todos
for insert to authenticated with check (public.is_private_member() and created_by = auth.uid());
drop policy if exists "the shared account can update todos" on public.todos;
create policy "the shared account can update todos" on public.todos
for update to authenticated using (public.is_private_member()) with check (public.is_private_member());
drop policy if exists "the shared account can delete todos" on public.todos;
create policy "the shared account can delete todos" on public.todos
for delete to authenticated using (public.is_private_member());
drop policy if exists "the shared account can read anniversaries" on public.anniversaries;
create policy "the shared account can read anniversaries" on public.anniversaries
for select to authenticated using (public.is_private_member());
drop policy if exists "the shared account can create anniversaries" on public.anniversaries;
create policy "the shared account can create anniversaries" on public.anniversaries
for insert to authenticated with check (public.is_private_member());
drop policy if exists "the shared account can update anniversaries" on public.anniversaries;
create policy "the shared account can update anniversaries" on public.anniversaries
for update to authenticated using (public.is_private_member()) with check (public.is_private_member());
drop policy if exists "the shared account can delete anniversaries" on public.anniversaries;
create policy "the shared account can delete anniversaries" on public.anniversaries
for delete to authenticated using (public.is_private_member());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'todos') then
    alter publication supabase_realtime add table public.todos;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_settings') then
    alter publication supabase_realtime add table public.app_settings;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'anniversaries') then
    alter publication supabase_realtime add table public.anniversaries;
  end if;
end $$;

-- Before using the page, create one Auth user in Authentication > Users > Add user.
-- Use a private email only as the hidden account identifier and set a strong password.
insert into public.app_settings (id, login_email, person_one, person_two)
values (true, 'haoni9276@gmail.com', 'zyx', 'nzh')
on conflict (id) do update set
  login_email = excluded.login_email,
  person_one = excluded.person_one,
  person_two = excluded.person_two;

-- Migrate the former single-date setting, when it exists, into the new list.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'app_settings' and column_name = 'anniversary_date'
  ) then
    insert into public.anniversaries (title, anniversary_date)
    select '在一起', anniversary_date
    from public.app_settings
    where id = true and anniversary_date is not null
      and not exists (select 1 from public.anniversaries);
  end if;
end $$;

-- Replace values and run separately:
-- update public.app_settings
-- set login_email = 'haoni9276@gmail.com', person_one = 'zyx',
--     person_two = 'nzh'
-- where id = true;

-- Add anniversaries from the page, or seed one here if desired:
-- insert into public.anniversaries (title, anniversary_date)
-- values ('在一起', '2024-05-20');
