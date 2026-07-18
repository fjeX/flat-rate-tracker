-- Throttle client_errors inserts at the DATABASE layer.
--
-- WHY DB-LEVEL: the browser inserts error rows straight into Supabase with the
-- user's JWT (see src/lib/report-error.ts) — it never passes through our server,
-- so a client-side or server-action guard can't enforce anything. Postgres is
-- the only choke point that a direct PostgREST insert can't route around.
--
-- THE ABUSE: the insert policy allows any authenticated user unlimited rows
-- (`user_id = auth.uid() OR user_id IS NULL`), and the client-side 1/min dedupe
-- is per-browser only. A logged-in attacker can flood the table.
--
-- TWO THINGS THIS GETS RIGHT:
--   1. We rate-limit on auth.uid() (the real JWT identity, NOT spoofable), not
--      on the client-supplied user_id — otherwise an attacker just sends
--      user_id=null and dodges a per-user counter.
--   2. The counter query needs SECURITY DEFINER: client_errors has no SELECT
--      policy (by design), so a normal invoker-rights trigger would see zero
--      rows via RLS and never throttle anything.

-- Record who ACTUALLY inserted each row (set by the trigger from the JWT — the
-- client cannot override it). Also gives real attribution for anonymous rows.
alter table public.client_errors
  add column if not exists inserted_by uuid;

-- Keep the per-user, per-window count a fast index range scan.
create index if not exists client_errors_inserted_by_created_idx
  on public.client_errors (inserted_by, created_at desc);

create or replace function public.throttle_client_errors()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent_count integer;
  -- Rows/minute/user. Generous: client dedupe already caps identical errors at
  -- 1/min, so a real session never approaches this; a flood script does. Tunable.
  window_limit constant integer := 30;
begin
  -- Stamp the real caller; ignore anything the client tried to set here.
  new.inserted_by := auth.uid();

  -- No JWT identity (shouldn't happen — policy is `to authenticated`) → allow a
  -- single row; with a null key it can't accumulate a per-user count anyway.
  if new.inserted_by is null then
    return new;
  end if;

  select count(*) into recent_count
  from public.client_errors
  where inserted_by = new.inserted_by
    and created_at > now() - interval '1 minute';

  if recent_count >= window_limit then
    -- Rejected insert surfaces as an error; both reporters swallow it silently
    -- (report-error.ts / report-error-server.ts are try/catch), so a throttled
    -- report is simply dropped — never crashes the caller.
    raise exception 'client_errors: rate limit exceeded (% rows/min per user)', window_limit
      using errcode = '53400';  -- configuration_limit_exceeded
  end if;

  return new;
end;
$$;

drop trigger if exists throttle_client_errors on public.client_errors;
create trigger throttle_client_errors
  before insert on public.client_errors
  for each row execute function public.throttle_client_errors();
