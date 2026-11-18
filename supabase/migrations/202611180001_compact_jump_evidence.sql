begin;

-- The original migration let PostgreSQL name the method check. Replace only
-- that catalog-owned constraint and quote the identifier in this migration.
do $$
declare old_check name;
begin
  select conname into strict old_check
  from pg_catalog.pg_constraint
  where conrelid = 'public.jump_results'::regclass and contype = 'c'
    and pg_catalog.pg_get_constraintdef(oid) like '%vision-feet-flight/0.1-unvalidated%'
    and pg_catalog.pg_get_constraintdef(oid) like '%vision-feet-flight/0.2-unvalidated%';
  execute pg_catalog.format('alter table public.jump_results drop constraint %I', old_check);
end $$;
alter table public.jump_results add constraint jump_results_method_supported
  check(data->>'method' in ('vision-feet-flight/0.1-unvalidated','vision-feet-flight/0.2-unvalidated','vision-feet-flight/0.3-unvalidated'));

alter function private.valid_jump(jsonb) rename to valid_jump_legacy;

create function private.valid_jump(v jsonb) returns boolean
language plpgsql stable set search_path = '' as $$
declare
  t jsonb := v->'timing'; e jsonb := v->'evidence'; stamp timestamptz;
  a numeric; b numeric; c numeric; d numeric; lo numeric; hi numeric;
  fps numeric; playback numeric; frames numeric; origin numeric; ending numeric;
begin
  if coalesce(v->>'createdAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]{1,3})?Z$' then return false; end if;
  stamp := (v->>'createdAt')::timestamptz;
  if stamp < '2000-01-01T00:00:00Z'::timestamptz or stamp > now() + interval '1 day' then return false; end if;
  if t ? 'timestamps' and v->>'method' in ('vision-feet-flight/0.1-unvalidated','vision-feet-flight/0.2-unvalidated') then
    return private.valid_jump_legacy(v);
  end if;
  if private.typed_fields(v,array['method','type','createdAt','confidence','airtime','heightM','trainingEligible','timing','evidence','heightRangeM','airtimeRange'],
    array['string','string','string','string','number','number','boolean','object','object','array','array']) is distinct from true or
    private.typed_fields(t,array['originalFPS','playbackFPS','kind','confirmedOriginal','mappings','presentationStart','presentationEnd','frameCount'],
    array['number','number','string','boolean','array','number','number','number']) is distinct from true or
    private.typed_fields(e,array['takeoff','landing'],array['array','array']) is distinct from true then return false; end if;
  if v - array['id','method','type','createdAt','confidence','airtime','heightM','trainingEligible','timing','evidence','heightRangeM','airtimeRange'] <> '{}'::jsonb or
    t - array['originalFPS','playbackFPS','kind','confirmedOriginal','mappings','presentationStart','presentationEnd','frameCount'] <> '{}'::jsonb or
    e - array['takeoff','landing'] <> '{}'::jsonb or
    v->>'method' not in ('vision-feet-flight/0.2-unvalidated','vision-feet-flight/0.3-unvalidated') or v->>'type' not in ('standing','running','repeated') or
    v->>'confidence' <> 'experimental' or v->'trainingEligible' <> 'false'::jsonb or
    t->>'kind' <> 'original' or t->'confirmedOriginal' <> 'true'::jsonb or t->'mappings' <> '[]'::jsonb then return false; end if;
  if exists(select 1 from unnest(array[e->'takeoff',e->'landing',v->'airtimeRange',v->'heightRangeM']) as ranges(r)
    where jsonb_array_length(r) <> 2 or jsonb_typeof(r->0) <> 'number' or jsonb_typeof(r->1) <> 'number') then return false; end if;
  fps := (t->>'originalFPS')::numeric; playback := (t->>'playbackFPS')::numeric;
  frames := (t->>'frameCount')::numeric; origin := (t->>'presentationStart')::numeric; ending := (t->>'presentationEnd')::numeric;
  if fps not between 24 and 240 or playback <= 0 or abs(fps/playback-1) > 0.03 or
    frames <> trunc(frames) or frames not between 4 and 7201 or ending-origin not between 0.12 and 30 or
    (ending-origin)*fps/(frames-1) not between 0.24999999 and 3.00000001 then return false; end if;
  a := (e->'takeoff'->>0)::numeric; b := (e->'takeoff'->>1)::numeric;
  c := (e->'landing'->>0)::numeric; d := (e->'landing'->>1)::numeric;
  if not(origin<=a and a<b and b<c and c<d and d<=ending) or b-a > 0.10 or d-c > 0.10 then return false; end if;
  lo := c-b; hi := d-a;
  return lo >= 0.12 and hi <= 1.5 and
    abs((v->>'airtime')::numeric-(lo+hi)/2) < 0.000001 and
    abs((v->'airtimeRange'->>0)::numeric-lo) < 0.000001 and abs((v->'airtimeRange'->>1)::numeric-hi) < 0.000001 and
    abs((v->>'heightM')::numeric-9.80665*power((lo+hi)/2,2)/8) < 0.000001 and
    abs((v->'heightRangeM'->>0)::numeric-9.80665*power(lo,2)/8) < 0.000001 and
    abs((v->'heightRangeM'->>1)::numeric-9.80665*power(hi,2)/8) < 0.000001;
exception when data_exception then return false;
end $$;
revoke all on function private.valid_jump(jsonb) from public,anon,authenticated;

-- Use the same owner and active-account policies as the base table. Clients
-- only need compact provenance even when older rows stored entire traces.
create view public.jump_history with (security_invoker = true) as
  select id,user_id,revision,created_at,data #- '{timing,timestamps}' as data from public.jump_results;
revoke all on public.jump_history from public,anon,authenticated;
grant select on public.jump_history to authenticated;
commit;
