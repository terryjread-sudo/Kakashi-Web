-- Independent, owner-controlled learning-email programs.
create table if not exists public.kaishi_email_automation_programs (
  program_key text primary key check (program_key in ('reengagement','weekly_recap','monthly_sensei_letter','onboarding_nudge')),
  enabled boolean not null default false,
  last_run_key text,
  last_run_at timestamptz,
  last_sent_count integer not null default 0,
  last_result text,
  updated_at timestamptz not null default now()
);
insert into public.kaishi_email_automation_programs(program_key,enabled)
values ('reengagement',false),('weekly_recap',false),('monthly_sensei_letter',false),('onboarding_nudge',false)
on conflict(program_key) do nothing;
alter table public.kaishi_email_automation_programs enable row level security;
revoke all on public.kaishi_email_automation_programs from anon, authenticated;

alter table public.kaishi_notification_preferences
  add column if not exists progress_celebrations boolean not null default true,
  add column if not exists product_updates boolean not null default true;

create or replace function public.get_kaishi_email_programs()
returns table(program_key text,enabled boolean,last_run_at timestamptz,last_sent_count integer,last_result text)
language plpgsql security definer set search_path=public as $$
begin
 if not public.is_app_admin() then raise exception 'Owner access required.'; end if;
 return query select p.program_key,p.enabled,p.last_run_at,p.last_sent_count,p.last_result from public.kaishi_email_automation_programs p order by p.program_key;
end; $$;
create or replace function public.set_kaishi_email_program_enabled(p_program_key text,p_enabled boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_app_admin() then raise exception 'Owner access required.'; end if;
 update public.kaishi_email_automation_programs set enabled=coalesce(p_enabled,false),updated_at=now() where program_key=p_program_key;
 if not found then raise exception 'Unknown email program.'; end if;
end; $$;
create or replace function public.claim_kaishi_email_program(p_program_key text,p_run_key text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 update public.kaishi_email_automation_programs set last_run_key=p_run_key,last_run_at=now(),last_sent_count=0,last_result='Running',updated_at=now()
 where program_key=p_program_key and enabled and last_run_key is distinct from p_run_key;
 return found;
end; $$;
create or replace function public.finish_kaishi_email_program(p_program_key text,p_sent_count integer,p_result text)
returns void language sql security definer set search_path=public as $$
 update public.kaishi_email_automation_programs set last_sent_count=greatest(0,coalesce(p_sent_count,0)),last_result=left(coalesce(p_result,''),500),updated_at=now() where program_key=p_program_key;
$$;
revoke all on function public.get_kaishi_email_programs(),public.set_kaishi_email_program_enabled(text,boolean),public.claim_kaishi_email_program(text,text),public.finish_kaishi_email_program(text,integer,text) from public;
grant execute on function public.get_kaishi_email_programs(),public.set_kaishi_email_program_enabled(text,boolean) to authenticated;
grant execute on function public.claim_kaishi_email_program(text,text),public.finish_kaishi_email_program(text,integer,text) to service_role;
