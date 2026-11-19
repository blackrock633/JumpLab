begin;

-- Extract the JSON object before removing server-controlled keys.
create or replace function private.write_record(kind text, record_id uuid, expected_revision integer, payload jsonb) returns integer
language plpgsql set search_path = '' as $$
declare
  who uuid := auth.uid();
  saved_profile public.profiles;
  replacement jsonb;
  profile_data jsonb;
  plan_id uuid;
  accepted_revision integer;
begin
  if kind in ('profile','profile_plan','plan') then
    select * into saved_profile from public.profiles where user_id=who;
  end if;

  if kind = 'profile_plan' then
    if record_id is null or expected_revision is null or expected_revision not between 0 and 100000 or
      private.typed_fields(payload,array['profile'],array['object']) is distinct from true or
      payload - array['profile','replacement'] <> '{}'::jsonb or
      not(payload ? 'replacement') or octet_length(payload::text) > 262144 then
      raise exception 'invalid_profile_plan' using errcode='22023';
    end if;
    replacement := payload->'replacement';
    profile_data := ((payload->'profile') - array['planBinding','replacementPlanId']) || jsonb_build_object('planBinding',true);
    if replacement = 'null'::jsonb then
      if profile_data->'pain' is distinct from 'true'::jsonb then
        raise exception 'replacement_plan_required' using errcode='22023';
      end if;
    else
      if private.typed_fields(replacement,array['id','payload'],array['string','object']) is distinct from true or
        replacement - array['id','payload'] <> '{}'::jsonb or profile_data->'pain' is distinct from 'false'::jsonb then
        raise exception 'invalid_replacement' using errcode='22023';
      end if;
      plan_id := (replacement->>'id')::uuid;
      profile_data := profile_data || jsonb_build_object('replacementPlanId',plan_id);
    end if;
    -- save_record holds the per-account lock. Its exception subtransaction
    -- rolls back both records if either write fails, while consuming quota.
    accepted_revision := private.write_record_legacy('profile',who,expected_revision,profile_data);
    if plan_id is not null then
      perform private.write_record_legacy('plan',plan_id,0,
        (replacement->'payload') || jsonb_build_object('profileRevision',accepted_revision));
      perform private.check_plan_profile(replacement->'payload',profile_data);
    end if;
    return accepted_revision;
  elsif kind = 'profile' then
    -- Older clients can replay a legacy profile. Linked profiles can only be
    -- changed by the atomic entry point.
    if saved_profile.data->'planBinding' = 'true'::jsonb or payload ?| array['planBinding','replacementPlanId'] then
      raise exception 'linked_profile_required' using errcode='22023';
    end if;
    return private.write_record_legacy(kind,who,expected_revision,payload);
  elsif kind = 'plan' then
    -- Allow lost-ack retries even if a newer profile was published meanwhile.
    if exists(select 1 from public.plans p where p.user_id=who and p.id=record_id and p.data=payload) then
      return private.write_record_legacy(kind,record_id,expected_revision,payload);
    end if;
    if jsonb_typeof(payload->'profileRevision') is distinct from 'number' then
      raise exception 'linked_profile_required' using errcode='22023';
    end if;
    if (payload->>'profileRevision')::numeric is distinct from saved_profile.revision::numeric or
      saved_profile.data->'pain' is distinct from 'false'::jsonb then
      raise exception 'profile_revision_conflict' using errcode='40001';
    end if;
    accepted_revision := private.write_record_legacy(kind,record_id,expected_revision,payload);
    perform private.check_plan_profile(payload,saved_profile.data);
    return accepted_revision;
  elsif kind = 'workout' then
    if jsonb_typeof(payload->'updatedAt') is distinct from 'string' or
      not private.valid_workout_timestamp(payload->>'updatedAt') or
      not (payload ? 'completedAt') or
      (payload->'completed' = 'true'::jsonb and (
        jsonb_typeof(payload->'completedAt') is distinct from 'string' or
        not private.valid_workout_timestamp(payload->>'completedAt'))) or
      (payload->'completed' = 'false'::jsonb and payload->'completedAt' is distinct from 'null'::jsonb) then
      raise exception 'invalid_workout_timestamp' using errcode='22023';
    end if;
  end if;
  return private.write_record_legacy(kind,record_id,expected_revision,payload);
end $$;

commit;
