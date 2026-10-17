-- SteadyPath: one private, versioned budget snapshot per authenticated user.
create table public.steadypath_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 8388608),
  revision bigint not null check (revision > 0),
  updated_at timestamptz not null default now()
);
alter table public.steadypath_snapshots enable row level security;
revoke all on public.steadypath_snapshots from anon, authenticated;
grant select, insert, update on public.steadypath_snapshots to authenticated;
create policy own_snapshot_read on public.steadypath_snapshots for select to authenticated using ((select auth.uid()) = user_id);
create policy own_snapshot_insert on public.steadypath_snapshots for insert to authenticated with check ((select auth.uid()) = user_id);
create policy own_snapshot_update on public.steadypath_snapshots for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create function public.steadypath_save(snapshot jsonb, expected_revision bigint)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  next_revision bigint;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if expected_revision is null or expected_revision < 0 then raise exception 'Invalid revision' using errcode = '22023'; end if;
  if jsonb_typeof(snapshot) is distinct from 'object' or octet_length(snapshot::text) > 8388608 then
    raise exception 'Invalid snapshot' using errcode = '22023';
  end if;
  if expected_revision = 0 then
    begin
      insert into public.steadypath_snapshots(user_id,data,revision) values(owner_id,snapshot,1);
      return 1;
    exception when unique_violation then
      raise exception 'Snapshot changed on another device' using errcode = '40001';
    end;
  end if;
  update public.steadypath_snapshots
    set data=snapshot, revision=revision+1, updated_at=now()
    where user_id=owner_id and revision=expected_revision
    returning revision into next_revision;
  if next_revision is null then raise exception 'Snapshot changed on another device' using errcode = '40001'; end if;
  return next_revision;
end;
$$;
revoke all on function public.steadypath_save(jsonb,bigint) from public, anon;
grant execute on function public.steadypath_save(jsonb,bigint) to authenticated;
