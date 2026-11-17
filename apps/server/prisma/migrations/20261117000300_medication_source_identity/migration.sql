BEGIN;
-- Never silently choose a winner if a pre-policy source has conflicting identities.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM fmv.medication_reconciliations GROUP BY patient_id,document_id,source_revision,lifecycle_version,candidate_id HAVING count(DISTINCT medication_id)>1 OR count(DISTINCT source_sha256)>1) THEN
  RAISE EXCEPTION 'Medication source identity requires explicit resolution' USING ERRCODE='23514';
 END IF;
END $$;
CREATE TABLE fmv.medication_source_records (
 patient_id uuid NOT NULL, document_id uuid NOT NULL, source_revision integer NOT NULL CHECK(source_revision>0),
 lifecycle_version integer NOT NULL CHECK(lifecycle_version>=0), candidate_id text NOT NULL,
 source_sha256 text NOT NULL CHECK(length(source_sha256)=64 AND source_sha256 ~ '^[a-f0-9]{64}$'),
 medication_id uuid NOT NULL, first_entry_id uuid NOT NULL,
 PRIMARY KEY(patient_id,document_id,source_revision,lifecycle_version,candidate_id),
 FOREIGN KEY(patient_id,medication_id,first_entry_id) REFERENCES fmv.medication_reconciliations(patient_id,medication_id,id) ON DELETE CASCADE
);
CREATE INDEX medication_source_records_entry ON fmv.medication_source_records(patient_id,medication_id,first_entry_id);
INSERT INTO fmv.medication_source_records(patient_id,document_id,source_revision,lifecycle_version,candidate_id,source_sha256,medication_id,first_entry_id)
SELECT DISTINCT ON(patient_id,document_id,source_revision,lifecycle_version,candidate_id) patient_id,document_id,source_revision,lifecycle_version,candidate_id,source_sha256,medication_id,id
FROM fmv.medication_reconciliations ORDER BY patient_id,document_id,source_revision,lifecycle_version,candidate_id,revision,recorded_at,id;
CREATE FUNCTION fmv.guard_medication_source_record() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('access-patient:'||NEW.patient_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM fmv.medication_reconciliations r WHERE r.id=NEW.first_entry_id AND r.patient_id=NEW.patient_id AND r.medication_id=NEW.medication_id AND r.document_id=NEW.document_id AND r.source_revision=NEW.source_revision AND r.lifecycle_version=NEW.lifecycle_version AND r.candidate_id=NEW.candidate_id AND r.source_sha256=NEW.source_sha256) THEN
  RAISE EXCEPTION 'Invalid medication source claim' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION fmv.claim_medication_source_record() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE claim fmv.medication_source_records%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('access-patient:'||NEW.patient_id::text,0));
 SELECT * INTO claim FROM fmv.medication_source_records WHERE patient_id=NEW.patient_id AND document_id=NEW.document_id AND source_revision=NEW.source_revision AND lifecycle_version=NEW.lifecycle_version AND candidate_id=NEW.candidate_id;
 IF FOUND THEN
  IF claim.medication_id<>NEW.medication_id OR claim.source_sha256<>NEW.source_sha256 THEN RAISE EXCEPTION 'Medication source already has a record' USING ERRCODE='23514'; END IF;
 ELSE
  INSERT INTO fmv.medication_source_records(patient_id,document_id,source_revision,lifecycle_version,candidate_id,source_sha256,medication_id,first_entry_id) VALUES(NEW.patient_id,NEW.document_id,NEW.source_revision,NEW.lifecycle_version,NEW.candidate_id,NEW.source_sha256,NEW.medication_id,NEW.id);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION fmv.guard_medication_source_record(),fmv.claim_medication_source_record() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fmv.guard_medication_source_record(),fmv.claim_medication_source_record() TO fmv_app;
CREATE TRIGGER medication_source_record_guard BEFORE INSERT ON fmv.medication_source_records FOR EACH ROW EXECUTE FUNCTION fmv.guard_medication_source_record();
CREATE TRIGGER medication_source_identity_guard AFTER INSERT ON fmv.medication_reconciliations FOR EACH ROW EXECUTE FUNCTION fmv.claim_medication_source_record();
REVOKE ALL ON fmv.medication_source_records FROM PUBLIC,fmv_app;
GRANT SELECT,INSERT ON fmv.medication_source_records TO fmv_app;
ALTER TABLE fmv.medication_source_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.medication_source_records FORCE ROW LEVEL SECURITY;
CREATE POLICY backend_medication_source_record_read ON fmv.medication_source_records FOR SELECT TO fmv_app USING(true);
CREATE POLICY backend_medication_source_record_insert ON fmv.medication_source_records FOR INSERT TO fmv_app WITH CHECK(true);
COMMIT;
