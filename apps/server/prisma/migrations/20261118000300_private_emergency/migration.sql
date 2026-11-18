BEGIN;
CREATE FUNCTION fmv.emergency_fields_valid(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE k text; item text; maxlen int;
BEGIN
 IF v IS NULL OR jsonb_typeof(v)<>'object' THEN RETURN false; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(v))<>4 OR NOT(v ?& ARRAY['contactName','contactRelationship','contactPhone','note']) THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['contactName','contactRelationship','contactPhone','note'] LOOP
  IF jsonb_typeof(v->k)='null' THEN CONTINUE; END IF;
  IF jsonb_typeof(v->k)<>'string' THEN RETURN false; END IF;
  item:=v->>k; maxlen:=CASE k WHEN 'contactName' THEN 80 WHEN 'contactRelationship' THEN 60 WHEN 'contactPhone' THEN 64 ELSE 1000 END;
  IF char_length(item)<1 OR char_length(item)>maxlen OR item ~ '[[:cntrl:]]' AND (k<>'note' OR replace(replace(item,E'\n',''),E'\t','') ~ '[[:cntrl:]]') OR item ~ '^\s|\s$' THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION fmv.emergency_fields_valid(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fmv.emergency_fields_valid(jsonb) TO fmv_app;
CREATE TABLE fmv.emergency_profile_entries (
 id uuid PRIMARY KEY,
 patient_id uuid NOT NULL REFERENCES fmv.persons(id) ON DELETE CASCADE,
 actor_account_id uuid NOT NULL REFERENCES fmv.app_accounts(id),
 revision integer NOT NULL CHECK(revision>0), request_id uuid NOT NULL,
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[a-f0-9]{64}$'),
 fields jsonb NOT NULL CHECK(fmv.emergency_fields_valid(fields)),
 recorded_at timestamptz(3) NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(patient_id,revision), UNIQUE(patient_id,request_id)
);
CREATE FUNCTION fmv.guard_emergency_profile() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE current_owner uuid; prev integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('access-patient:'||NEW.patient_id::text,0));
 SELECT owner_account_id INTO current_owner FROM fmv.persons WHERE id=NEW.patient_id;
 IF current_owner IS NULL OR current_owner IS DISTINCT FROM NEW.actor_account_id THEN RAISE EXCEPTION 'Invalid emergency owner' USING ERRCODE='23514'; END IF;
 SELECT revision INTO prev FROM fmv.emergency_profile_entries WHERE patient_id=NEW.patient_id ORDER BY revision DESC LIMIT 1;
 IF NEW.revision<>COALESCE(prev,0)+1 THEN RAISE EXCEPTION 'Invalid emergency revision' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION fmv.guard_emergency_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fmv.guard_emergency_profile() TO fmv_app;
CREATE TRIGGER emergency_profile_guard BEFORE INSERT ON fmv.emergency_profile_entries FOR EACH ROW EXECUTE FUNCTION fmv.guard_emergency_profile();
CREATE TABLE fmv.emergency_profile_events (
 id uuid PRIMARY KEY,
 patient_id uuid NOT NULL REFERENCES fmv.persons(id) ON DELETE CASCADE,
 actor_account_id uuid NOT NULL REFERENCES fmv.app_accounts(id),
 kind text NOT NULL CHECK(kind IN ('emergency.viewed','emergency.saved')),
 recorded_at timestamptz(3) NOT NULL DEFAULT statement_timestamp(),
 retention_until timestamptz(3) DEFAULT (statement_timestamp()+interval '90 days')
);
CREATE FUNCTION fmv.guard_emergency_event() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.kind='emergency.saved' AND NOT EXISTS(SELECT 1 FROM fmv.persons WHERE id=NEW.patient_id AND owner_account_id=NEW.actor_account_id) THEN RAISE EXCEPTION 'Invalid emergency event actor' USING ERRCODE='23514'; END IF;
 NEW.retention_until:=CASE WHEN NEW.kind='emergency.viewed' THEN NEW.recorded_at+interval '90 days' ELSE NULL END;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION fmv.guard_emergency_event() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fmv.guard_emergency_event() TO fmv_app;
CREATE TRIGGER emergency_event_guard BEFORE INSERT ON fmv.emergency_profile_events FOR EACH ROW EXECUTE FUNCTION fmv.guard_emergency_event();
CREATE INDEX emergency_profile_events_patient ON fmv.emergency_profile_events(patient_id,recorded_at DESC,id);
REVOKE ALL ON fmv.emergency_profile_entries,fmv.emergency_profile_events FROM PUBLIC,fmv_app;
GRANT SELECT ON fmv.emergency_profile_entries,fmv.emergency_profile_events TO fmv_app;
GRANT INSERT(id,patient_id,actor_account_id,revision,request_id,payload_sha256,fields) ON fmv.emergency_profile_entries TO fmv_app;
GRANT INSERT(id,patient_id,actor_account_id,kind) ON fmv.emergency_profile_events TO fmv_app;
ALTER TABLE fmv.emergency_profile_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.emergency_profile_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE fmv.emergency_profile_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.emergency_profile_events FORCE ROW LEVEL SECURITY;
CREATE POLICY emergency_profile_read ON fmv.emergency_profile_entries FOR SELECT TO fmv_app USING(true);
CREATE POLICY emergency_profile_insert ON fmv.emergency_profile_entries FOR INSERT TO fmv_app WITH CHECK(true);
CREATE POLICY emergency_event_read ON fmv.emergency_profile_events FOR SELECT TO fmv_app USING(true);
CREATE POLICY emergency_event_insert ON fmv.emergency_profile_events FOR INSERT TO fmv_app WITH CHECK(true);
COMMIT;
