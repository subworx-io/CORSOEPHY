-- Corso — 0021: Onboarding-Abschluss als Event
-- Bezug: .claude/prds/onboarding-flow.prd.md, .claude/plans/onboarding-flow.plan.md.
--
-- Ergänzt den Event-Typ 'onboarding_completed' (First-Run durchlaufen). Der
-- Client feuert ihn per log_event() am Ende des Onboarding-Flows mit
-- metadata.via ∈ {"read","skip"} (durchgelesen vs. übersprungen).
--
-- 🔒 Leitplanken (unverändert ggü. 0018):
--   - metadata trägt nur Enums/Referenz-IDs (hier: via), niemals Zahlen/Inhalte.
--   - events bleibt write-only (RLS ohne Lese-Policy); Schreiben nur über
--     log_event() (SECURITY DEFINER, user_id an auth.uid() gepinnt).
--
-- Append-only: 0018 wird NICHT editiert. Der Table-Check wird ersetzt, die
-- Funktion per create-or-replace neu erzeugt — beide mit der um
-- 'onboarding_completed' erweiterten kanonischen Liste.

-- ── events: Table-Check um den neuen Typ erweitern ──────────────────────────
alter table events drop constraint if exists events_event_type_check;
alter table events add constraint events_event_type_check
  check (event_type in (
    'app_open',
    'moment_posted',
    'follow_set',
    'follow_expired',
    'story_viewed',
    'nudge_sent',
    'chat_reached',
    'story_drawn',
    'onboarding_completed'
  ));

-- ── log_event(): Whitelist um den neuen Typ erweitern ───────────────────────
-- Body 1:1 aus 0018 übernommen (0018 darf nicht editiert werden → create or
-- replace hier). EINZIGE Änderung: 'onboarding_completed' in der Validierungs-
-- Liste ergänzt, konsistent mit dem Table-Check oben.
create or replace function log_event(
  p_event_type text,
  p_metadata   jsonb default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_event_type not in (
    'app_open', 'moment_posted', 'follow_set', 'follow_expired',
    'story_viewed', 'nudge_sent', 'chat_reached', 'story_drawn',
    'onboarding_completed'
  ) then
    raise exception 'invalid event_type: %', p_event_type;
  end if;

  insert into events (user_id, event_type, metadata)
  values (auth.uid(), p_event_type, p_metadata);
end;
$$;

revoke all on function log_event(text, jsonb) from public;
revoke all on function log_event(text, jsonb) from anon;
grant execute on function log_event(text, jsonb) to authenticated;
