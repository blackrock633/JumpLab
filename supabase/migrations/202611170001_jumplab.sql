begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create function public.active_account() returns boolean language sql stable security definer
set search_path = '' as $$ select exists(select 1 from auth.users where id = auth.uid()) $$;
revoke all on function public.active_account() from public, anon;
grant execute on function public.active_account() to authenticated;

create table public.profiles (
  id uuid primary key, user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  revision integer not null check (revision > 0), data jsonb not null check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(user_id), unique(id,user_id),
  check ((data->>'weightKg')::numeric between 25 and 300),
  check (data ?& array['goal','experience','days','practiceDays','startHour','weeklyMinutes','sessionMinutes','equipment','weightKg','displayUnits','knownSquatKg','limitation','pain']),
  check (data->>'goal' in ('standing','running','repeated')),
  check (data->>'experience' in ('new','trained')),
  check (data->>'equipment' in ('none','dumbbells','barbell')),
  check (data->>'displayUnits' in ('kg','lb')),
  check (data->>'limitation' in ('none','no-impact','no-loaded-squats')),
  check (jsonb_typeof(data->'pain') = 'boolean'),
  check ((data->>'sessionMinutes')::numeric between 0 and 120),
  check ((data->>'weeklyMinutes')::numeric between 0 and 600),
  check ((data->>'startHour')::integer between 0 and 23),
  check (data->'knownSquatKg' = 'null'::jsonb or (data->>'knownSquatKg')::numeric between 0 and 500)
);
create table public.plans (
  id uuid primary key, user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  revision integer not null check(revision > 0), data jsonb not null check(jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,user_id),
  check (data->>'version' = 'conservative/1'), check (jsonb_typeof(data->'sessions') = 'array'),
  check ((data->>'week')::integer > 0)
);
create table public.prescriptions (
  id uuid primary key, user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plan_id uuid not null, data jsonb not null check(jsonb_typeof(data) = 'object'),
  unique(id,user_id), foreign key(plan_id,user_id) references public.plans(id,user_id) on delete cascade
);
create table public.workouts (
  id uuid primary key, user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  revision integer not null check(revision > 0), prescription_id uuid not null,
  data jsonb not null check(jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(prescription_id,user_id) references public.prescriptions(id,user_id) on delete cascade,
  unique(user_id,prescription_id), unique(id,user_id),
  check (jsonb_typeof(data->'sets') = 'array'), check (jsonb_typeof(data->'completed') = 'boolean'),
  check ((data->>'effort')::integer between 1 and 10),
  check (data->>'recovery' in ('good','fatigued')), check(jsonb_typeof(data->'pain') = 'boolean')
);
create table public.jump_results (
  id uuid primary key, user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  revision integer not null check(revision = 1), data jsonb not null check(jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,user_id),
  check(data ?& array['method','type','airtime','heightM','timing','evidence','heightRangeM','airtimeRange','confidence','trainingEligible','createdAt']),
  check(data->>'method' = 'vision-feet-flight/0.1-unvalidated'),
  check(data->>'type' in ('standing','running','repeated')),
  check((data->>'airtime')::numeric between 0.12 and 1.5),
  check(abs((data->>'heightM')::numeric - 9.80665 * power((data->>'airtime')::numeric,2) / 8) < 0.000001),
  check(data->>'confidence' = 'experimental' and data->'trainingEligible' = 'false'::jsonb)
);
create table public.adaptations (
  id uuid primary key, user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plan_id uuid not null, data jsonb not null,
  created_at timestamptz not null default now(),
  foreign key(plan_id,user_id) references public.plans(id,user_id) on delete cascade,
  check(data->>'version' = 'conservative/1'), check(length(data->>'reason') between 1 and 500)
);
create index plans_owner_date on public.plans(user_id,created_at desc,id);
create index jumps_owner_date on public.jump_results(user_id,created_at desc,id);
create index workouts_owner_date on public.workouts(user_id,created_at desc,id);
create index prescriptions_owner_plan on public.prescriptions(user_id,plan_id);
create index adaptations_owner_plan on public.adaptations(user_id,plan_id);

alter table public.profiles enable row level security;
alter table public.plans enable row level security;
alter table public.prescriptions enable row level security;
alter table public.workouts enable row level security;
alter table public.jump_results enable row level security;
alter table public.adaptations enable row level security;
create policy own_profile on public.profiles for select to authenticated using(user_id = auth.uid() and public.active_account());
create policy own_plan on public.plans for select to authenticated using(user_id = auth.uid() and public.active_account());
create policy own_prescription on public.prescriptions for select to authenticated using(user_id = auth.uid() and public.active_account());
create policy own_workout on public.workouts for select to authenticated using(user_id = auth.uid() and public.active_account());
create policy own_jump on public.jump_results for select to authenticated using(user_id = auth.uid() and public.active_account());
create policy own_adaptation on public.adaptations for select to authenticated using(user_id = auth.uid() and public.active_account());
revoke all on all tables in schema public from anon, authenticated;
grant select on public.profiles,public.plans,public.prescriptions,public.workouts,public.jump_results,public.adaptations to authenticated;

-- One bounded row per live account, locked for atomic minute/day limits.
create table private.mutation_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  minute timestamptz not null, minute_count integer not null,
  day date not null, day_count integer not null
);
alter table private.mutation_limits enable row level security;
create function private.limit_write(who uuid) returns void language plpgsql security definer set search_path = '' as $$
declare bucket private.mutation_limits; current_minute timestamptz := date_trunc('minute',clock_timestamp()); current_day date := (clock_timestamp() at time zone 'UTC')::date;
begin
  insert into private.mutation_limits values(who,current_minute,0,current_day,0) on conflict(user_id) do nothing;
  select * into bucket from private.mutation_limits where user_id = who for update;
  if bucket.minute <> current_minute then bucket.minute_count := 0; end if;
  if bucket.day <> current_day then bucket.day_count := 0; end if;
  if bucket.minute_count >= 60 or bucket.day_count >= 1000 then raise exception 'mutation_quota' using errcode = 'P0001'; end if;
  update private.mutation_limits set minute=current_minute,minute_count=bucket.minute_count+1,day=current_day,day_count=bucket.day_count+1 where user_id=who;
end $$;
revoke all on function private.limit_write(uuid) from public,anon,authenticated;

create function private.validate_days(v jsonb) returns boolean language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(v) is distinct from 'array' then false else jsonb_array_length(v) <= 7 and
    not exists(select 1 from jsonb_array_elements(v) x where jsonb_typeof(x) <> 'number' or x::text !~ '^[0-6]$') and
    (select count(*) = count(distinct x) from jsonb_array_elements(v) x) end
$$;
revoke all on function private.validate_days(jsonb) from public,anon,authenticated;

create function private.typed_fields(v jsonb, names text[], types text[]) returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(v) = 'object' and not exists (
    select 1 from unnest(names,types) as f(name,kind) where jsonb_typeof(v->f.name) is distinct from f.kind
  )
$$;
revoke all on function private.typed_fields(jsonb,text[],text[]) from public,anon,authenticated;

create function private.valid_jump(v jsonb) returns boolean language plpgsql immutable set search_path = '' as $$
declare t jsonb := v->'timing'; e jsonb := v->'evidence'; x jsonb; previous_time numeric; frame_time numeric; count_frames integer;
  a numeric; b numeric; c numeric; d numeric; lo numeric; hi numeric; fps numeric; median_interval numeric;
begin
  if private.typed_fields(v,array['method','type','createdAt','confidence','airtime','heightM','trainingEligible','timing','evidence','heightRangeM','airtimeRange'],
    array['string','string','string','string','number','number','boolean','object','object','array','array']) is distinct from true or
    private.typed_fields(t,array['originalFPS','playbackFPS','kind','confirmedOriginal','mappings','timestamps'],array['number','number','string','boolean','array','array']) is distinct from true or
    private.typed_fields(e,array['takeoff','landing'],array['array','array']) is distinct from true then return false; end if;
  if v->>'method' <> 'vision-feet-flight/0.1-unvalidated' or v->>'type' not in ('standing','running','repeated') or
    v->>'confidence' <> 'experimental' or v->'trainingEligible' <> 'false'::jsonb or
    t->>'kind' <> 'original' or t->'confirmedOriginal' <> 'true'::jsonb or jsonb_array_length(t->'mappings') <> 0 or
    jsonb_array_length(e->'takeoff') <> 2 or jsonb_array_length(e->'landing') <> 2 or
    jsonb_array_length(v->'heightRangeM') <> 2 or jsonb_array_length(v->'airtimeRange') <> 2 then return false; end if;
  fps := (t->>'originalFPS')::numeric;
  if fps not between 24 and 240 or (t->>'playbackFPS')::numeric <= 0 or abs(fps/(t->>'playbackFPS')::numeric-1) > 0.03 then return false; end if;
  count_frames := jsonb_array_length(t->'timestamps');
  if count_frames not between 4 and 7201 then return false; end if;
  for x in select value from jsonb_array_elements(t->'timestamps') loop
    if jsonb_typeof(x) <> 'number' then return false; end if;
    frame_time := x::text::numeric;
    if previous_time is not null and (frame_time <= previous_time or frame_time-previous_time > 3/fps) then return false; end if;
    previous_time := frame_time;
  end loop;
  select percentile_cont(0.5) within group (order by gap) into median_interval from (
    select value::text::numeric - lag(value::text::numeric) over (order by ordinality) as gap
    from jsonb_array_elements(t->'timestamps') with ordinality
  ) intervals where gap is not null;
  if median_interval is null or abs(median_interval*fps-1)>0.15 or
    (t->'timestamps'->>(count_frames-1))::numeric - (t->'timestamps'->>0)::numeric > 30 then return false; end if;
  a := (e->'takeoff'->>0)::numeric; b := (e->'takeoff'->>1)::numeric; c := (e->'landing'->>0)::numeric; d := (e->'landing'->>1)::numeric;
  if not(a<b and b<c and c<d) or b-a > 0.10 or d-c > 0.10 or
    not(t->'timestamps' @> jsonb_build_array(a,b,c,d)) then return false; end if;
  lo := c-b; hi := d-a;
  return lo >= 0.12 and hi <= 1.5 and
    abs((v->>'airtime')::numeric-(lo+hi)/2) < 0.000001 and
    abs((v->'airtimeRange'->>0)::numeric-lo) < 0.000001 and abs((v->'airtimeRange'->>1)::numeric-hi) < 0.000001 and
    abs((v->>'heightM')::numeric-9.80665*power((lo+hi)/2,2)/8) < 0.000001 and
    abs((v->'heightRangeM'->>0)::numeric-9.80665*power(lo,2)/8) < 0.000001 and
    abs((v->'heightRangeM'->>1)::numeric-9.80665*power(hi,2)/8) < 0.000001;
exception when others then return false;
end $$;
revoke all on function private.valid_jump(jsonb) from public,anon,authenticated;

create function public.save_record(kind text, record_id uuid, expected_revision integer, payload jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare who uuid := auth.uid(); current_revision integer; previous jsonb; item jsonb; exercise jsonb; prescribed jsonb; parent uuid; result_revision integer;
begin
  if who is null or not public.active_account() then raise exception 'account_required' using errcode='28000'; end if;
  if kind is null or record_id is null or expected_revision is null or kind not in ('profile','plan','workout','jump') or expected_revision < 0 or expected_revision > 100000 or
    payload is null or jsonb_typeof(payload) <> 'object' or octet_length(payload::text) > 262144 then raise exception 'invalid_record' using errcode='22023'; end if;
  perform private.limit_write(who);
  -- Serialize all writes for this account, including duplicate/lost-ack retries.
  if kind = 'profile' then
    if private.typed_fields(payload,array['goal','experience','startDate','days','practiceDays','startHour','weeklyMinutes','sessionMinutes','equipment','weightKg','displayUnits','limitation','pain'],
      array['string','string','string','array','array','number','number','number','string','number','string','string','boolean']) is distinct from true or
      not(payload ? 'knownSquatKg') or jsonb_typeof(payload->'knownSquatKg') not in ('number','null') or
      private.validate_days(payload->'days') is distinct from true or private.validate_days(payload->'practiceDays') is distinct from true or
      (payload->>'startDate') !~ '^\d{4}-\d{2}-\d{2}$' or (payload->>'startDate')::date::text <> payload->>'startDate' then raise exception 'invalid_profile' using errcode='22023'; end if;
    select revision,data into current_revision,previous from public.profiles where id=record_id and user_id=who;
  elsif kind = 'plan' then select revision,data into current_revision,previous from public.plans where id=record_id and user_id=who;
  elsif kind = 'workout' then
    select revision,data into current_revision,previous from public.workouts where id=record_id and user_id=who;
    parent := (payload->>'prescriptionId')::uuid;
    select data into prescribed from public.prescriptions where id=parent and user_id=who;
    if prescribed is null then raise exception 'prescription_required' using errcode='22023'; end if;
    if private.typed_fields(payload,array['prescriptionId','sets','completed','effort','recovery','pain','updatedAt'],array['string','array','boolean','number','string','boolean','string']) is distinct from true or jsonb_array_length(payload->'sets') > 100 then raise exception 'invalid_sets' using errcode='22023'; end if;
    for item in select value from jsonb_array_elements(payload->'sets') loop
      select value into exercise from jsonb_array_elements(prescribed->'exercises') where value->>'id'=item->>'exerciseId';
      if exercise is null or private.typed_fields(item,array['exerciseId','index','reps','done'],array['string','number','number','boolean']) is distinct from true or
        not(item ? 'loadKg') or jsonb_typeof(item->'loadKg') not in ('number','null') or
        (item->>'index')::integer < 0 or (item->>'index')::integer >= (exercise->>'sets')::integer or
        (item->>'reps')::integer not between 0 and 100 or
        (item->'loadKg' <> 'null'::jsonb and (item->>'loadKg')::numeric not between 0 and 500) then raise exception 'invalid_set' using errcode='22023'; end if;
    end loop;
    if exists(select 1 from jsonb_array_elements(payload->'sets') x group by x->>'exerciseId',x->>'index' having count(*)>1) then raise exception 'duplicate_set'; end if;
  else
    if private.valid_jump(payload) is distinct from true then raise exception 'invalid_measurement' using errcode='22023'; end if;
    select revision,data into current_revision,previous from public.jump_results where id=record_id and user_id=who;
  end if;
  if current_revision is not null and previous = payload then return current_revision; end if;
  if coalesce(current_revision,0) <> expected_revision then raise exception 'revision_conflict' using errcode='40001'; end if;
  if kind='jump' and current_revision is not null then raise exception 'immutable_measurement' using errcode='22023'; end if;
  result_revision := coalesce(current_revision,0)+1;
  if kind='profile' then
    insert into public.profiles(id,user_id,revision,data) values(record_id,who,result_revision,payload)
      on conflict(id) do update set revision=excluded.revision,data=excluded.data,updated_at=now() where profiles.user_id=who;
  elsif kind='plan' then
    if current_revision is not null then raise exception 'create_new_future_plan' using errcode='22023'; end if;
    if private.typed_fields(payload,array['version','sessions','week','explanation'],array['string','array','number','string']) is distinct from true or payload->>'version' is distinct from 'conservative/1' or
      jsonb_typeof(payload->'sessions') <> 'array' or jsonb_array_length(payload->'sessions') not between 1 and 3 then raise exception 'invalid_plan' using errcode='22023'; end if;
    for item in select value from jsonb_array_elements(payload->'sessions') loop
      if private.typed_fields(item,array['prescriptionId','workoutId','id','scheduledOn','day','startHour','minutes','exercises'],array['string','string','string','string','number','number','number','array']) is distinct from true or
        (item->>'day')::integer not between 0 and 6 or (item->>'minutes')::numeric not between 1 and 120 or
        (item->>'startHour')::integer not between 0 and 23 or jsonb_typeof(item->'exercises') <> 'array' or
        jsonb_array_length(item->'exercises') not between 1 and 5 then raise exception 'invalid_session'; end if;
      for exercise in select value from jsonb_array_elements(item->'exercises') loop
        if private.typed_fields(exercise,array['id','name','instructions','sets','baseSets','reps','effort','restSeconds'],array['string','string','string','number','number','number','string','number']) is distinct from true or
          not(exercise ? 'loadKg') or jsonb_typeof(exercise->'loadKg') not in ('number','null') or
          exercise->>'id' not in ('squat','jump','calf') or (exercise->>'sets')::integer not between 0 and 5 or
          (exercise->>'reps')::integer not between 1 and 20 or (exercise->>'restSeconds')::integer not between 30 and 300 or
          (exercise->'loadKg' <> 'null'::jsonb and (exercise->>'loadKg')::numeric not between 0 and 500) then raise exception 'invalid_exercise'; end if;
      end loop;
    end loop;
    insert into public.plans(id,user_id,revision,data) values(record_id,who,result_revision,payload);
    for item in select value from jsonb_array_elements(payload->'sessions') loop
      insert into public.prescriptions(id,user_id,plan_id,data) values((item->>'prescriptionId')::uuid,who,record_id,item);
    end loop;
    if payload ? 'changeReason' then
      insert into public.adaptations(id,user_id,plan_id,data) values(record_id,who,record_id,jsonb_build_object('version',payload->>'version','reason',payload->>'changeReason'));
    end if;
  elsif kind='workout' then
    -- Completed history can be explicitly corrected, but adaptation never updates it.
    insert into public.workouts(id,user_id,revision,prescription_id,data) values(record_id,who,result_revision,parent,payload)
      on conflict(id) do update set revision=excluded.revision,data=excluded.data,updated_at=now() where workouts.user_id=who and workouts.prescription_id=excluded.prescription_id;
  else insert into public.jump_results(id,user_id,revision,data) values(record_id,who,result_revision,payload);
  end if;
  if not found then raise exception 'ownership_conflict' using errcode='42501'; end if;
  return result_revision;
end $$;
revoke all on function public.save_record(text,uuid,integer,jsonb) from public,anon;
grant execute on function public.save_record(text,uuid,integer,jsonb) to authenticated;

create function public.delete_account() returns void language plpgsql security definer set search_path = '' as $$
declare who uuid := auth.uid();
begin
  if who is null or not public.active_account() then raise exception 'account_required' using errcode='28000'; end if;
  perform private.limit_write(who);
  delete from auth.users where id=who;
end $$;
revoke all on function public.delete_account() from public,anon;
grant execute on function public.delete_account() to authenticated;
commit;
