BEGIN;
CREATE FUNCTION fmv.medication_schedule_definition_valid(v jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE t jsonb; item jsonb; n numeric; prev_day integer:=0; label text; prev_time text:=''; key text; parsed date;
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR NOT v ?& ARRAY['timing','startDate','endDate','instructions'] OR (SELECT count(*) FROM jsonb_object_keys(v))<>4 THEN RETURN false; END IF;
 IF NOT fmv.medication_inventory_fields_valid(jsonb_build_object('quantity',v->'instructions','expiry',NULL,'refill',NULL)) THEN RETURN false; END IF;
 FOREACH key IN ARRAY ARRAY['startDate','endDate'] LOOP
  IF v->key='null'::jsonb THEN CONTINUE; END IF;
  IF jsonb_typeof(v->key) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
  label:=v->>key;
  IF length(label)<>10 OR label !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR left(label,4)='0000' THEN RETURN false; END IF;
  BEGIN parsed:=make_date(substr(label,1,4)::integer,substr(label,6,2)::integer,substr(label,9,2)::integer); EXCEPTION WHEN OTHERS THEN RETURN false; END;
  IF to_char(parsed,'YYYY-MM-DD')<>label THEN RETURN false; END IF;
 END LOOP;
 IF v->'startDate'<>'null'::jsonb AND v->'endDate'<>'null'::jsonb AND v->>'startDate'>v->>'endDate' THEN RETURN false; END IF;
 t:=v->'timing';IF jsonb_typeof(t) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
 IF t->>'kind'='literal' THEN
  RETURN (SELECT count(*) FROM jsonb_object_keys(t))=2 AND t ?& ARRAY['kind','text'] AND t->'text'<>'null'::jsonb AND fmv.medication_inventory_fields_valid(jsonb_build_object('quantity',t->'text','expiry',NULL,'refill',NULL));
 END IF;
 IF t->>'kind' IS DISTINCT FROM 'clock-times' OR NOT t ?& ARRAY['kind','timeZone','weekdays','times'] OR (SELECT count(*) FROM jsonb_object_keys(t))<>4 OR jsonb_typeof(t->'timeZone') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
 label:=t->>'timeZone';IF length(label)>64 OR label !~ '^[A-Za-z][A-Za-z0-9_+/-]*$' OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE lower(name)=lower(label)) THEN RETURN false; END IF;
 IF jsonb_typeof(t->'weekdays') IS DISTINCT FROM 'array' OR jsonb_typeof(t->'times') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(t->'weekdays') NOT BETWEEN 1 AND 7 OR jsonb_array_length(t->'times') NOT BETWEEN 1 AND 8 THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(t->'weekdays') LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
  n:=(item#>>'{}')::numeric;IF n<>trunc(n) OR n<1 OR n>7 OR n<=prev_day THEN RETURN false; END IF;prev_day:=n::integer;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(t->'times') LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
  label:=item#>>'{}';IF length(label)<>5 OR label !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR label<=prev_time THEN RETURN false; END IF;prev_time:=label;
 END LOOP;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION fmv.medication_schedule_definition_valid(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fmv.medication_schedule_definition_valid(jsonb) TO fmv_app;
CREATE TABLE fmv.medication_schedules (
 id uuid PRIMARY KEY, patient_id uuid NOT NULL, medication_id uuid NOT NULL, medication_entry_id uuid NOT NULL,
 medication_revision integer NOT NULL CHECK(medication_revision>0), revision integer NOT NULL CHECK(revision>0),
 action text NOT NULL CHECK(action IN ('recording','correction','retirement')), recorded_state text NOT NULL CHECK(recorded_state IN ('recorded','retired')), definition jsonb NOT NULL CHECK(fmv.medication_schedule_definition_valid(definition)),
 request_id uuid NOT NULL, payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$' AND length(payload_hash)=64),
 actor_account_id uuid NOT NULL REFERENCES fmv.app_accounts(id), recorded_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(patient_id,medication_id,medication_entry_id) REFERENCES fmv.medication_reconciliations(patient_id,medication_id,id) ON DELETE CASCADE,
 UNIQUE(medication_id,revision), UNIQUE(medication_id,request_id), UNIQUE(patient_id,medication_id,id)
);
CREATE INDEX medication_schedules_latest ON fmv.medication_schedules(patient_id,medication_id,revision DESC);
CREATE FUNCTION fmv.guard_medication_schedule() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE m fmv.medication_reconciliations%ROWTYPE; prev fmv.medication_schedules%ROWTYPE; retirement boolean; d record; r record; e record;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('access-patient:'||NEW.patient_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('medication:'||NEW.medication_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM fmv.persons WHERE id=NEW.patient_id AND owner_account_id=NEW.actor_account_id) THEN RAISE EXCEPTION 'Invalid schedule owner' USING ERRCODE='23514'; END IF;
 SELECT * INTO m FROM fmv.medication_reconciliations WHERE patient_id=NEW.patient_id AND medication_id=NEW.medication_id ORDER BY revision DESC LIMIT 1;
 IF NOT FOUND OR m.id<>NEW.medication_entry_id OR m.revision<>NEW.medication_revision THEN RAISE EXCEPTION 'Invalid schedule medication revision' USING ERRCODE='23514'; END IF;
 SELECT * INTO prev FROM fmv.medication_schedules WHERE medication_id=NEW.medication_id ORDER BY revision DESC LIMIT 1;
 retirement:=prev.id IS NOT NULL AND prev.recorded_state='recorded' AND NEW.recorded_state='retired' AND prev.definition=NEW.definition;
 IF NEW.revision<>COALESCE(prev.revision,0)+1 OR (prev.id IS NULL AND (NEW.action<>'recording' OR NEW.recorded_state<>'recorded')) OR (prev.id IS NOT NULL AND (prev.patient_id<>NEW.patient_id OR NEW.action<>CASE WHEN retirement THEN 'retirement' ELSE 'correction' END)) THEN RAISE EXCEPTION 'Invalid schedule revision' USING ERRCODE='23514'; END IF;
 IF retirement THEN NEW.recorded_at:=clock_timestamp();RETURN NEW;END IF;
 SELECT * INTO d FROM fmv.documents WHERE id=m.document_id AND patient_id=NEW.patient_id FOR NO KEY UPDATE;
 IF NOT FOUND OR d.state<>'ready' OR d.deleted_at IS NOT NULL OR d.sha256<>m.source_sha256 OR d.extraction_lifecycle<>m.lifecycle_version THEN RAISE EXCEPTION 'Invalid schedule original' USING ERRCODE='23514'; END IF;
 SELECT * INTO e FROM fmv.document_extractions WHERE document_id=m.document_id AND patient_id=NEW.patient_id;
 IF NOT FOUND OR e.revision<>m.source_revision OR e.source_sha256<>m.source_sha256 OR e.lifecycle_version<>m.lifecycle_version THEN RAISE EXCEPTION 'Invalid schedule extraction' USING ERRCODE='23514'; END IF;
 SELECT * INTO r FROM fmv.document_medication_reviews WHERE document_id=m.document_id AND patient_id=NEW.patient_id ORDER BY revision DESC LIMIT 1;
 IF NOT FOUND OR r.revision<>m.review_revision OR r.source_revision<>m.source_revision OR r.source_sha256<>m.source_sha256 OR r.lifecycle_version<>m.lifecycle_version OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.statements) s WHERE s->>'id'=m.candidate_id) THEN RAISE EXCEPTION 'Invalid schedule source review' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp(); RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION fmv.guard_medication_schedule() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fmv.guard_medication_schedule() TO fmv_app;
CREATE TRIGGER medication_schedule_guard BEFORE INSERT ON fmv.medication_schedules FOR EACH ROW EXECUTE FUNCTION fmv.guard_medication_schedule();
CREATE TABLE fmv.medication_schedule_events (
 id uuid PRIMARY KEY, patient_id uuid NOT NULL, medication_id uuid NOT NULL, entry_id uuid NOT NULL,
 actor_account_id uuid NOT NULL REFERENCES fmv.app_accounts(id), kind text NOT NULL CHECK(kind IN ('medication.schedule.viewed','medication.schedule.recorded','medication.schedule.corrected','medication.schedule.retired')),
 recorded_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz(3),
 FOREIGN KEY(patient_id,medication_id,entry_id) REFERENCES fmv.medication_schedules(patient_id,medication_id,id) ON DELETE CASCADE
);
CREATE FUNCTION fmv.guard_medication_schedule_event() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN NEW.recorded_at:=clock_timestamp(); NEW.expires_at:=CASE WHEN NEW.kind='medication.schedule.viewed' THEN NEW.recorded_at+interval '90 days' ELSE NULL END; RETURN NEW; END $$;
REVOKE ALL ON FUNCTION fmv.guard_medication_schedule_event() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fmv.guard_medication_schedule_event() TO fmv_app;
CREATE TRIGGER medication_schedule_event_guard BEFORE INSERT ON fmv.medication_schedule_events FOR EACH ROW EXECUTE FUNCTION fmv.guard_medication_schedule_event();
REVOKE ALL ON fmv.medication_schedules,fmv.medication_schedule_events FROM PUBLIC,fmv_app;
GRANT SELECT,INSERT ON fmv.medication_schedules,fmv.medication_schedule_events TO fmv_app;
ALTER TABLE fmv.medication_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.medication_schedules FORCE ROW LEVEL SECURITY;
ALTER TABLE fmv.medication_schedule_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.medication_schedule_events FORCE ROW LEVEL SECURITY;
CREATE POLICY backend_medication_schedule_read ON fmv.medication_schedules FOR SELECT TO fmv_app USING(true);
CREATE POLICY backend_medication_schedule_insert ON fmv.medication_schedules FOR INSERT TO fmv_app WITH CHECK(true);
CREATE POLICY backend_medication_schedule_event_read ON fmv.medication_schedule_events FOR SELECT TO fmv_app USING(true);
CREATE POLICY backend_medication_schedule_event_insert ON fmv.medication_schedule_events FOR INSERT TO fmv_app WITH CHECK(true);
COMMIT;
