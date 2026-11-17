BEGIN;
CREATE FUNCTION fmv.manual_reading_valid(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE k text; u text; t text; vals jsonb; n text;
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR NOT v ?& ARRAY['kind','unit','observedAt','values'] OR (SELECT count(*) FROM jsonb_object_keys(v))<>4 OR octet_length(v::text)>1024 THEN RETURN false; END IF;
 IF jsonb_typeof(v->'kind') IS DISTINCT FROM 'string' OR jsonb_typeof(v->'unit') IS DISTINCT FROM 'string' OR jsonb_typeof(v->'observedAt') IS DISTINCT FROM 'string' OR jsonb_typeof(v->'values') IS DISTINCT FROM 'object' THEN RETURN false; END IF;
 k:=v->>'kind';u:=v->>'unit';t:=v->>'observedAt';vals:=v->'values';
 IF NOT ((k COLLATE "C"='blood-pressure' AND u COLLATE "C"='mmHg') OR (k COLLATE "C"='weight' AND u COLLATE "C" IN ('kg','lb')) OR (k COLLATE "C"='pulse' AND u COLLATE "C"='beats/min') OR (k COLLATE "C"='glucose' AND u COLLATE "C" IN ('mg/dL','mmol/L'))) THEN RETURN false; END IF;
 IF k COLLATE "C"='blood-pressure' THEN
  IF NOT vals ?& ARRAY['systolic','diastolic'] OR (SELECT count(*) FROM jsonb_object_keys(vals))<>2 THEN RETURN false; END IF;
 ELSE IF NOT vals ? 'value' OR (SELECT count(*) FROM jsonb_object_keys(vals))<>1 THEN RETURN false; END IF; END IF;
 FOR n IN SELECT key FROM jsonb_each(vals) LOOP
  IF jsonb_typeof(vals->n) IS DISTINCT FROM 'string' OR length(vals->>n)>32 OR (vals->>n) !~ '^(0|[1-9][0-9]*)([.][0-9]+)?$' OR (vals->>n) ~ '[^0-9.]' THEN RETURN false; END IF;
 END LOOP;
 IF length(t) NOT IN (20,25) OR t !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(Z|[+-][0-9]{2}:[0-9]{2})$' OR t ~ '[^0-9TZ:+-]' THEN RETURN false; END IF;
 IF substring(t,1,4)::int<1000 OR substring(t,12,2)::int>23 OR substring(t,15,2)::int>59 OR substring(t,18,2)::int>59 THEN RETURN false; END IF;
 IF length(t)=25 AND (substring(t,20,6)='-00:00' OR substring(t,21,2)::int>14 OR substring(t,24,2)::int>59 OR (substring(t,21,2)::int=14 AND substring(t,24,2)::int<>0)) THEN RETURN false; END IF;
 PERFORM substring(t,1,10)::date; PERFORM t::timestamptz;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION fmv.manual_reading_valid(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fmv.manual_reading_valid(jsonb) TO fmv_app;
CREATE TABLE fmv.manual_measurements (
 id uuid PRIMARY KEY, reading_id uuid NOT NULL, patient_id uuid NOT NULL REFERENCES fmv.persons(id) ON DELETE CASCADE,
 revision integer NOT NULL CHECK(revision>0), action text NOT NULL CHECK(action IN ('record','correction','withdrawal')),
 request_id uuid NOT NULL, payload_hash text NOT NULL CHECK(length(payload_hash)=64 AND payload_hash ~ '^[a-f0-9]{64}$'),
 actor_account_id uuid NOT NULL REFERENCES fmv.app_accounts(id), reading jsonb NOT NULL CHECK(fmv.manual_reading_valid(reading)),
 recorded_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(reading_id,revision), UNIQUE(reading_id,request_id), UNIQUE(patient_id,reading_id,id)
);
CREATE INDEX manual_measurements_patient_latest ON fmv.manual_measurements(patient_id,reading_id,revision DESC);
CREATE FUNCTION fmv.guard_manual_measurement() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE prev fmv.manual_measurements%ROWTYPE; owner_id uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('access-patient:'||NEW.patient_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('manual-reading:'||NEW.reading_id::text,0));
 SELECT owner_account_id INTO owner_id FROM fmv.persons WHERE id=NEW.patient_id;
 IF owner_id IS NULL OR owner_id IS DISTINCT FROM NEW.actor_account_id THEN RAISE EXCEPTION 'Invalid manual owner' USING ERRCODE='23514'; END IF;
 SELECT * INTO prev FROM fmv.manual_measurements WHERE reading_id=NEW.reading_id ORDER BY revision DESC LIMIT 1;
 IF NEW.revision<>COALESCE(prev.revision,0)+1 OR (prev.id IS NOT NULL AND prev.patient_id<>NEW.patient_id) THEN RAISE EXCEPTION 'Invalid manual revision' USING ERRCODE='23514'; END IF;
 IF prev.id IS NULL THEN
  IF NEW.action<>'record' THEN RAISE EXCEPTION 'Invalid manual action' USING ERRCODE='23514'; END IF;
 ELSE
  IF prev.action='withdrawal' OR NEW.action NOT IN ('correction','withdrawal') OR (NEW.reading->>'kind') COLLATE "C" IS DISTINCT FROM (prev.reading->>'kind') COLLATE "C" OR (NEW.action='withdrawal' AND NEW.reading IS DISTINCT FROM prev.reading) THEN RAISE EXCEPTION 'Invalid manual transition' USING ERRCODE='23514'; END IF;
 END IF;
 NEW.recorded_at:=clock_timestamp(); RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION fmv.guard_manual_measurement() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fmv.guard_manual_measurement() TO fmv_app;
CREATE TRIGGER manual_measurement_guard BEFORE INSERT ON fmv.manual_measurements FOR EACH ROW EXECUTE FUNCTION fmv.guard_manual_measurement();
CREATE TABLE fmv.manual_measurement_events (
 id uuid PRIMARY KEY, patient_id uuid NOT NULL, reading_id uuid NOT NULL, entry_id uuid NOT NULL,
 actor_account_id uuid NOT NULL REFERENCES fmv.app_accounts(id),
 kind text NOT NULL CHECK(kind IN ('manual.viewed','manual.recorded','manual.corrected','manual.withdrawn')),
 recorded_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz(3),
 FOREIGN KEY(patient_id,reading_id,entry_id) REFERENCES fmv.manual_measurements(patient_id,reading_id,id) ON DELETE CASCADE
);
CREATE FUNCTION fmv.guard_manual_event() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 NEW.recorded_at:=clock_timestamp();
 NEW.expires_at:=CASE WHEN NEW.kind='manual.viewed' THEN NEW.recorded_at+interval '90 days' ELSE NULL END;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION fmv.guard_manual_event() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fmv.guard_manual_event() TO fmv_app;
CREATE TRIGGER manual_event_guard BEFORE INSERT ON fmv.manual_measurement_events FOR EACH ROW EXECUTE FUNCTION fmv.guard_manual_event();
REVOKE ALL ON fmv.manual_measurements,fmv.manual_measurement_events FROM PUBLIC;
REVOKE ALL ON fmv.manual_measurements,fmv.manual_measurement_events FROM fmv_app;
GRANT SELECT,INSERT ON fmv.manual_measurements,fmv.manual_measurement_events TO fmv_app;
ALTER TABLE fmv.manual_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.manual_measurements FORCE ROW LEVEL SECURITY;
ALTER TABLE fmv.manual_measurement_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.manual_measurement_events FORCE ROW LEVEL SECURITY;
CREATE POLICY backend_manual_read ON fmv.manual_measurements FOR SELECT TO fmv_app USING(true);
CREATE POLICY backend_manual_insert ON fmv.manual_measurements FOR INSERT TO fmv_app WITH CHECK(true);
CREATE POLICY backend_manual_event_read ON fmv.manual_measurement_events FOR SELECT TO fmv_app USING(true);
CREATE POLICY backend_manual_event_insert ON fmv.manual_measurement_events FOR INSERT TO fmv_app WITH CHECK(true);
COMMIT;
