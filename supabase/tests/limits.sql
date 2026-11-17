-- Execute against a disposable database after migrations, as isolated setup/testing.
-- These structural/reset assertions supplement the actual REST identity/concurrency suite.
begin;
do $$
declare who uuid := gen_random_uuid();
begin
  insert into auth.users(id,email) values(who,who::text || '@example.test');
  perform private.limit_write(who);
  if not exists(select 1 from private.mutation_limits where user_id=who and minute_count=1 and day_count=1) then raise exception 'first write counter'; end if;
  update private.mutation_limits set minute=now()-interval '2 minutes',minute_count=60,day=(now() at time zone 'UTC')::date-1,day_count=1000 where user_id=who;
  perform private.limit_write(who);
  if not exists(select 1 from private.mutation_limits where user_id=who and minute_count=1 and day_count=1) then raise exception 'window reset'; end if;
  update private.mutation_limits set day_count=1000 where user_id=who;
  begin perform private.limit_write(who); raise exception 'daily limit bypassed'; exception when sqlstate 'P0001' then if sqlerrm <> 'mutation_quota' then raise; end if; end;
  if (select count(*) from private.mutation_limits where user_id=who) <> 1 then raise exception 'unbounded storage'; end if;
  delete from auth.users where id=who;
  if exists(select 1 from private.mutation_limits where user_id=who) then raise exception 'limiter retention after deletion'; end if;
end $$;
rollback;
