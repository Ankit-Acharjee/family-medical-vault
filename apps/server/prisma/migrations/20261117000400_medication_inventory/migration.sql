BEGIN;
CREATE FUNCTION fmv.medication_inventory_fields_valid(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE k text; s text;
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR NOT v ?& ARRAY['quantity','expiry','refill'] OR (SELECT count(*) FROM jsonb_object_keys(v))<>3 THEN RETURN false; END IF;
 FOR k IN SELECT key FROM jsonb_each(v) LOOP
  IF v->k='null'::jsonb THEN CONTINUE; END IF;
  IF jsonb_typeof(v->k) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
  s:=v->>k;
  IF char_length(s)+char_length(regexp_replace(s,U&'[^\+010000-\+10FFFF]','','g'))>120 OR btrim(s,U&' \0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')='' OR EXISTS(SELECT 1 FROM generate_series(1,char_length(s)) AS i WHERE ascii(substr(s,i,1))<32 OR ascii(substr(s,i,1))=127) THEN RETURN false; END IF;
 END LOOP; RETURN true;
END $$;
REVOKE ALL ON FUNCTION fmv.medication_inventory_fields_valid(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fmv.medication_inventory_fields_valid(jsonb) TO fmv_app;
CREATE TABLE fmv.medication_inventory (
 id uuid PRIMARY KEY, patient_id uuid NOT NULL, medication_id uuid NOT NULL, medication_entry_id uuid NOT NULL,
 medication_revision integer NOT NULL CHECK(medication_revision>0), revision integer NOT NULL CHECK(revision>0),
 fields jsonb NOT NULL CHECK(fmv.medication_inventory_fields_valid(fields)),
 request_id uuid NOT NULL, payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$' AND length(payload_hash)=64),
 actor_account_id uuid NOT NULL REFERENCES fmv.app_accounts(id), recorded_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(patient_id,medication_id,medication_entry_id) REFERENCES fmv.medication_reconciliations(patient_id,medication_id,id) ON DELETE CASCADE,
 UNIQUE(medication_id,revision), UNIQUE(medication_id,request_id), UNIQUE(patient_id,medication_id,id)
);
CREATE INDEX medication_inventory_latest ON fmv.medication_inventory(patient_id,medication_id,revision DESC);
CREATE FUNCTION fmv.guard_medication_inventory() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE m fmv.medication_reconciliations%ROWTYPE; prev integer; d record; r record; e record;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('access-patient:'||NEW.patient_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('medication:'||NEW.medication_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM fmv.persons WHERE id=NEW.patient_id AND owner_account_id=NEW.actor_account_id) THEN RAISE EXCEPTION 'Invalid inventory owner' USING ERRCODE='23514'; END IF;
 SELECT * INTO m FROM fmv.medication_reconciliations WHERE patient_id=NEW.patient_id AND medication_id=NEW.medication_id ORDER BY revision DESC LIMIT 1;
 IF NOT FOUND OR m.id<>NEW.medication_entry_id OR m.revision<>NEW.medication_revision THEN RAISE EXCEPTION 'Invalid inventory medication revision' USING ERRCODE='23514'; END IF;
 SELECT * INTO d FROM fmv.documents WHERE id=m.document_id AND patient_id=NEW.patient_id FOR NO KEY UPDATE;
 IF NOT FOUND OR d.state<>'ready' OR d.deleted_at IS NOT NULL OR d.sha256<>m.source_sha256 OR d.extraction_lifecycle<>m.lifecycle_version THEN RAISE EXCEPTION 'Invalid inventory original' USING ERRCODE='23514'; END IF;
 SELECT * INTO e FROM fmv.document_extractions WHERE document_id=m.document_id AND patient_id=NEW.patient_id;
 IF NOT FOUND OR e.revision<>m.source_revision OR e.source_sha256<>m.source_sha256 OR e.lifecycle_version<>m.lifecycle_version THEN RAISE EXCEPTION 'Invalid inventory extraction' USING ERRCODE='23514'; END IF;
 SELECT * INTO r FROM fmv.document_medication_reviews WHERE document_id=m.document_id AND patient_id=NEW.patient_id ORDER BY revision DESC LIMIT 1;
 IF NOT FOUND OR r.revision<>m.review_revision OR r.source_revision<>m.source_revision OR r.source_sha256<>m.source_sha256 OR r.lifecycle_version<>m.lifecycle_version OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.statements) s WHERE s->>'id'=m.candidate_id) THEN RAISE EXCEPTION 'Invalid inventory source review' USING ERRCODE='23514'; END IF;
 SELECT revision INTO prev FROM fmv.medication_inventory WHERE medication_id=NEW.medication_id ORDER BY revision DESC LIMIT 1;
 IF NEW.revision<>COALESCE(prev,0)+1 THEN RAISE EXCEPTION 'Invalid inventory revision' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp(); RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION fmv.guard_medication_inventory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fmv.guard_medication_inventory() TO fmv_app;
CREATE TRIGGER medication_inventory_guard BEFORE INSERT ON fmv.medication_inventory FOR EACH ROW EXECUTE FUNCTION fmv.guard_medication_inventory();
CREATE TABLE fmv.medication_inventory_events (
 id uuid PRIMARY KEY, patient_id uuid NOT NULL, medication_id uuid NOT NULL, entry_id uuid NOT NULL,
 actor_account_id uuid NOT NULL REFERENCES fmv.app_accounts(id), kind text NOT NULL CHECK(kind IN ('medication.inventory.viewed','medication.inventory.recorded','medication.inventory.corrected')),
 recorded_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz(3),
 FOREIGN KEY(patient_id,medication_id,entry_id) REFERENCES fmv.medication_inventory(patient_id,medication_id,id) ON DELETE CASCADE
);
CREATE FUNCTION fmv.guard_medication_inventory_event() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN NEW.recorded_at:=clock_timestamp(); NEW.expires_at:=CASE WHEN NEW.kind='medication.inventory.viewed' THEN NEW.recorded_at+interval '90 days' ELSE NULL END; RETURN NEW; END $$;
REVOKE ALL ON FUNCTION fmv.guard_medication_inventory_event() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fmv.guard_medication_inventory_event() TO fmv_app;
CREATE TRIGGER medication_inventory_event_guard BEFORE INSERT ON fmv.medication_inventory_events FOR EACH ROW EXECUTE FUNCTION fmv.guard_medication_inventory_event();
REVOKE ALL ON fmv.medication_inventory,fmv.medication_inventory_events FROM PUBLIC,fmv_app;
GRANT SELECT,INSERT ON fmv.medication_inventory,fmv.medication_inventory_events TO fmv_app;
ALTER TABLE fmv.medication_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.medication_inventory FORCE ROW LEVEL SECURITY;
ALTER TABLE fmv.medication_inventory_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.medication_inventory_events FORCE ROW LEVEL SECURITY;
CREATE POLICY backend_medication_inventory_read ON fmv.medication_inventory FOR SELECT TO fmv_app USING(true);
CREATE POLICY backend_medication_inventory_insert ON fmv.medication_inventory FOR INSERT TO fmv_app WITH CHECK(true);
CREATE POLICY backend_medication_inventory_event_read ON fmv.medication_inventory_events FOR SELECT TO fmv_app USING(true);
CREATE POLICY backend_medication_inventory_event_insert ON fmv.medication_inventory_events FOR INSERT TO fmv_app WITH CHECK(true);
COMMIT;
