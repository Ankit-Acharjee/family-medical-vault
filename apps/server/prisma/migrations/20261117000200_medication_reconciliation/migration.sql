BEGIN;
CREATE FUNCTION fmv.reconciled_medication_fields_valid(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE k text; s text;
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR NOT v ?& ARRAY['medication','strength','dose','frequency','route','duration','start','end','instructions'] OR (SELECT count(*) FROM jsonb_object_keys(v))<>9 THEN RETURN false; END IF;
 FOR k IN SELECT key FROM jsonb_each(v) LOOP
  IF v->k='null'::jsonb AND k<>'medication' THEN CONTINUE; END IF;
  IF jsonb_typeof(v->k) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
  s:=v->>k;
  IF char_length(s)+char_length(regexp_replace(s,U&'[^\+010000-\+10FFFF]','','g'))>120 OR btrim(s,U&' \0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')='' OR EXISTS(SELECT 1 FROM generate_series(1,char_length(s)) AS i WHERE ascii(substr(s,i,1))<32 OR ascii(substr(s,i,1))=127) THEN RETURN false; END IF;
 END LOOP; RETURN true;
END $$;
REVOKE ALL ON FUNCTION fmv.reconciled_medication_fields_valid(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fmv.reconciled_medication_fields_valid(jsonb) TO fmv_app;
CREATE TABLE fmv.medication_reconciliations (
 id uuid PRIMARY KEY, medication_id uuid NOT NULL, patient_id uuid NOT NULL,
 document_id uuid NOT NULL, candidate_id text NOT NULL,
 source_revision integer NOT NULL CHECK(source_revision>0), source_sha256 text NOT NULL CHECK(length(source_sha256)=64 AND source_sha256 ~ '^[a-f0-9]{64}$'),
 lifecycle_version integer NOT NULL CHECK(lifecycle_version>=0), review_revision integer NOT NULL CHECK(review_revision>0),
 revision integer NOT NULL CHECK(revision>0), action text NOT NULL CHECK(action IN ('reconciliation','correction')),
 recorded_status text NOT NULL CHECK(recorded_status IN ('current','historical')),
 fields jsonb NOT NULL CHECK(fmv.reconciled_medication_fields_valid(fields)),
 request_id uuid NOT NULL, payload_hash text NOT NULL CHECK(length(payload_hash)=64 AND payload_hash ~ '^[a-f0-9]{64}$'),
 actor_account_id uuid NOT NULL REFERENCES fmv.app_accounts(id), recorded_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(patient_id,document_id) REFERENCES fmv.documents(patient_id,id) ON DELETE CASCADE,
 UNIQUE(medication_id,revision), UNIQUE(medication_id,request_id), UNIQUE(patient_id,medication_id,id)
);
CREATE INDEX medication_reconciliations_latest ON fmv.medication_reconciliations(patient_id,medication_id,revision DESC);
CREATE FUNCTION fmv.guard_medication_reconciliation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE prev fmv.medication_reconciliations%ROWTYPE; d record; r record; e record; owner_id uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('access-patient:'||NEW.patient_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('medication:'||NEW.medication_id::text,0));
 SELECT owner_account_id INTO owner_id FROM fmv.persons WHERE id=NEW.patient_id;
 IF owner_id IS NULL OR owner_id IS DISTINCT FROM NEW.actor_account_id THEN RAISE EXCEPTION 'Invalid medication owner' USING ERRCODE='23514'; END IF;
 SELECT * INTO d FROM fmv.documents WHERE patient_id=NEW.patient_id AND id=NEW.document_id FOR NO KEY UPDATE;
 IF NOT FOUND OR d.state<>'ready' OR d.deleted_at IS NOT NULL OR d.sha256<>NEW.source_sha256 OR d.extraction_lifecycle<>NEW.lifecycle_version THEN RAISE EXCEPTION 'Invalid medication original' USING ERRCODE='23514'; END IF;
 SELECT * INTO prev FROM fmv.medication_reconciliations WHERE medication_id=NEW.medication_id ORDER BY revision DESC LIMIT 1;
 IF NEW.revision<>COALESCE(prev.revision,0)+1 OR (prev.id IS NULL AND NEW.action<>'reconciliation') OR (prev.id IS NOT NULL AND (NEW.action<>'correction' OR prev.patient_id<>NEW.patient_id OR prev.document_id<>NEW.document_id)) THEN RAISE EXCEPTION 'Invalid medication revision' USING ERRCODE='23514'; END IF;
 SELECT * INTO e FROM fmv.document_extractions WHERE patient_id=NEW.patient_id AND document_id=NEW.document_id;
 IF NOT FOUND OR e.revision<>NEW.source_revision OR e.source_sha256<>NEW.source_sha256 OR e.lifecycle_version<>NEW.lifecycle_version THEN RAISE EXCEPTION 'Invalid medication extraction' USING ERRCODE='23514'; END IF;
 SELECT * INTO r FROM fmv.document_medication_reviews WHERE patient_id=NEW.patient_id AND document_id=NEW.document_id ORDER BY revision DESC LIMIT 1;
 IF NOT FOUND OR r.revision<>NEW.review_revision OR r.source_revision<>NEW.source_revision OR r.source_sha256<>NEW.source_sha256 OR r.lifecycle_version<>NEW.lifecycle_version OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.statements) s WHERE s->>'id'=NEW.candidate_id) THEN RAISE EXCEPTION 'Invalid medication attestation' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp(); RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION fmv.guard_medication_reconciliation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fmv.guard_medication_reconciliation() TO fmv_app;
CREATE TRIGGER medication_reconciliation_guard BEFORE INSERT ON fmv.medication_reconciliations FOR EACH ROW EXECUTE FUNCTION fmv.guard_medication_reconciliation();
CREATE TABLE fmv.medication_reconciliation_events (
 id uuid PRIMARY KEY, patient_id uuid NOT NULL, medication_id uuid NOT NULL, entry_id uuid NOT NULL,
 actor_account_id uuid NOT NULL REFERENCES fmv.app_accounts(id), kind text NOT NULL CHECK(kind IN ('medication.viewed','medication.reconciled','medication.corrected')),
 recorded_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz(3),
 FOREIGN KEY(patient_id,medication_id,entry_id) REFERENCES fmv.medication_reconciliations(patient_id,medication_id,id) ON DELETE CASCADE
);
CREATE FUNCTION fmv.guard_medication_reconciliation_event() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 NEW.recorded_at:=clock_timestamp(); NEW.expires_at:=CASE WHEN NEW.kind='medication.viewed' THEN NEW.recorded_at+interval '90 days' ELSE NULL END; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION fmv.guard_medication_reconciliation_event() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fmv.guard_medication_reconciliation_event() TO fmv_app;
CREATE TRIGGER medication_reconciliation_event_guard BEFORE INSERT ON fmv.medication_reconciliation_events FOR EACH ROW EXECUTE FUNCTION fmv.guard_medication_reconciliation_event();
REVOKE ALL ON fmv.medication_reconciliations,fmv.medication_reconciliation_events FROM PUBLIC,fmv_app;
GRANT SELECT,INSERT ON fmv.medication_reconciliations,fmv.medication_reconciliation_events TO fmv_app;
ALTER TABLE fmv.medication_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.medication_reconciliations FORCE ROW LEVEL SECURITY;
ALTER TABLE fmv.medication_reconciliation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.medication_reconciliation_events FORCE ROW LEVEL SECURITY;
CREATE POLICY backend_medication_reconciliation_read ON fmv.medication_reconciliations FOR SELECT TO fmv_app USING(true);
CREATE POLICY backend_medication_reconciliation_insert ON fmv.medication_reconciliations FOR INSERT TO fmv_app WITH CHECK(true);
CREATE POLICY backend_medication_reconciliation_event_read ON fmv.medication_reconciliation_events FOR SELECT TO fmv_app USING(true);
CREATE POLICY backend_medication_reconciliation_event_insert ON fmv.medication_reconciliation_events FOR INSERT TO fmv_app WITH CHECK(true);
COMMIT;
