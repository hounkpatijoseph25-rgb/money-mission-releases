-- Runs entirely inside a rolled-back transaction; no test users or budgets remain.
begin;
insert into auth.users(id) values ('b7de5e51-67f2-48ad-b7b8-3be65ef121a0'),('f81183ba-a78f-4627-8ef8-db777e93d609');
set local role authenticated;
select set_config('request.jwt.claim.sub','b7de5e51-67f2-48ad-b7b8-3be65ef121a0',true);
do $$ begin
  if public.steadypath_save('{"budgets":[],"bills":[],"goals":[],"transactions":[]}',0) <> 1 then raise exception 'create revision failed'; end if;
  if public.steadypath_save('{"budgets":[],"bills":[],"goals":[],"transactions":[],"name":"Test"}',1) <> 2 then raise exception 'update revision failed'; end if;
  begin perform public.steadypath_save('{}',1); raise exception 'stale write accepted'; exception when serialization_failure then null; end;
end $$;
select set_config('request.jwt.claim.sub','f81183ba-a78f-4627-8ef8-db777e93d609',true);
do $$ begin
  if (select count(*) from public.steadypath_snapshots) <> 0 then raise exception 'another user budget visible'; end if;
  begin
    insert into public.steadypath_snapshots(user_id,data,revision) values ('b7de5e51-67f2-48ad-b7b8-3be65ef121a0','{}',3);
    raise exception 'foreign insert accepted';
  exception when insufficient_privilege then null; end;
  if public.steadypath_save('{}',0) <> 1 then raise exception 'second account create failed'; end if;
  update public.steadypath_snapshots set data='{"cross_user":true}' where user_id='b7de5e51-67f2-48ad-b7b8-3be65ef121a0';
  if found then raise exception 'foreign update accepted'; end if;
  begin
    update public.steadypath_snapshots set user_id='b7de5e51-67f2-48ad-b7b8-3be65ef121a0';
    raise exception 'ownership reassignment accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'passed: revisions, stale write rejection, account isolation, insert/update ownership' as verification;
rollback;
