BEGIN;
CREATE FUNCTION fmv.comparison_members_valid(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE x jsonb; docs text[]:=ARRAY[]::text[]; pairs text[]:=ARRAY[]::text[]; d text; c text; k text; n text;
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(v) NOT BETWEEN 2 AND 20 OR octet_length(v::text)>12000 THEN RETURN false; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(v) LOOP
  IF jsonb_typeof(x) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF NOT x ?& ARRAY['documentId','candidateId','reviewRevision','sourceRevision','sourceSha256','lifecycleVersion'] OR (SELECT count(*) FROM jsonb_object_keys(x))<>6 THEN RETURN false; END IF;
  IF jsonb_typeof(x->'documentId') IS DISTINCT FROM 'string' OR (x->>'documentId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR jsonb_typeof(x->'candidateId') IS DISTINCT FROM 'string' OR (x->>'candidateId') !~ '^page-([1-9]|[1-4][0-9]|50)-block-[0-9]{1,6}$' OR jsonb_typeof(x->'sourceSha256') IS DISTINCT FROM 'string' OR (x->>'sourceSha256') !~ '^[0-9a-f]{64}$' THEN RETURN false; END IF;
  FOREACH k IN ARRAY ARRAY['reviewRevision','sourceRevision','lifecycleVersion'] LOOP
   IF jsonb_typeof(x->k) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
   n:=x->>k;
   IF n !~ '^(0|[1-9][0-9]{0,9})$' OR length(n)>10 OR (length(n)=10 AND n>'2147483647') OR (k<>'lifecycleVersion' AND n='0') THEN RETURN false; END IF;
  END LOOP;
  d:=x->>'documentId'; c:=d||':'||(x->>'candidateId');
  IF c=ANY(pairs) THEN RETURN false; END IF;
  pairs:=array_append(pairs,c); IF NOT d=ANY(docs) THEN docs:=array_append(docs,d); END IF;
 END LOOP;
 RETURN cardinality(docs)>=2;
END $$;
REVOKE ALL ON FUNCTION fmv.comparison_members_valid(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fmv.comparison_members_valid(jsonb) TO fmv_app;
CREATE TABLE fmv.measurement_comparisons (
 id uuid PRIMARY KEY, set_id uuid NOT NULL, patient_id uuid NOT NULL REFERENCES fmv.persons(id) ON DELETE CASCADE,
 revision integer NOT NULL CHECK(revision>0), action text NOT NULL CHECK(action IN ('confirmation','withdrawal')),
 request_id uuid NOT NULL, payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'), actor_account_id uuid NOT NULL REFERENCES fmv.app_accounts(id),
 members jsonb NOT NULL CHECK(fmv.comparison_members_valid(members)), recorded_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(set_id,revision), UNIQUE(set_id,request_id)
);
CREATE TABLE fmv.comparison_sources (
 ledger_id uuid NOT NULL REFERENCES fmv.measurement_comparisons(id) ON DELETE CASCADE,
 patient_id uuid NOT NULL REFERENCES fmv.persons(id) ON DELETE CASCADE, set_id uuid NOT NULL,
 document_id uuid NOT NULL REFERENCES fmv.documents(id) ON DELETE CASCADE,
 PRIMARY KEY(ledger_id,document_id)
);
CREATE FUNCTION fmv.guard_measurement_comparison() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE prev fmv.measurement_comparisons%ROWTYPE; owner_id uuid; m jsonb; d record; e record; r record; item jsonb; fields jsonb; analyte text; unit text; specimen text; method text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('access-patient:'||NEW.patient_id::text,0));
 IF NOT fmv.comparison_members_valid(NEW.members) THEN RAISE EXCEPTION 'Invalid comparison members' USING ERRCODE='23514'; END IF;
 SELECT owner_account_id INTO owner_id FROM fmv.persons WHERE id=NEW.patient_id;
 IF owner_id IS DISTINCT FROM NEW.actor_account_id THEN RAISE EXCEPTION 'Invalid comparison owner' USING ERRCODE='23514'; END IF;
 SELECT * INTO prev FROM fmv.measurement_comparisons WHERE set_id=NEW.set_id ORDER BY revision DESC LIMIT 1;
 IF NEW.revision<>COALESCE(prev.revision,0)+1 OR (prev.id IS NOT NULL AND prev.patient_id<>NEW.patient_id) THEN RAISE EXCEPTION 'Invalid comparison revision' USING ERRCODE='23514'; END IF;
 FOR m IN SELECT value FROM jsonb_array_elements(NEW.members) ORDER BY value->>'documentId',value->>'candidateId' LOOP
  SELECT state,deleted_at,sha256,extraction_lifecycle INTO d FROM fmv.documents WHERE id=(m->>'documentId')::uuid AND patient_id=NEW.patient_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid comparison document' USING ERRCODE='23514'; END IF;
  IF NEW.action='confirmation' THEN
   IF d.state IS DISTINCT FROM 'ready' OR d.deleted_at IS NOT NULL OR d.sha256 IS DISTINCT FROM m->>'sourceSha256' OR d.extraction_lifecycle IS DISTINCT FROM (m->>'lifecycleVersion')::int THEN RAISE EXCEPTION 'Invalid comparison source' USING ERRCODE='23514'; END IF;
   SELECT revision,source_sha256,lifecycle_version INTO e FROM fmv.document_extractions WHERE document_id=(m->>'documentId')::uuid AND patient_id=NEW.patient_id;
   IF NOT FOUND OR e.revision<>(m->>'sourceRevision')::int OR e.source_sha256 IS DISTINCT FROM m->>'sourceSha256' OR e.lifecycle_version<>(m->>'lifecycleVersion')::int THEN RAISE EXCEPTION 'Invalid comparison extraction' USING ERRCODE='23514'; END IF;
   SELECT revision,source_revision,source_sha256,lifecycle_version,items INTO r FROM fmv.document_clinical_reviews WHERE document_id=(m->>'documentId')::uuid AND patient_id=NEW.patient_id ORDER BY revision DESC LIMIT 1;
   IF NOT FOUND OR r.revision<>(m->>'reviewRevision')::int OR r.source_revision<>e.revision OR r.source_sha256 IS DISTINCT FROM e.source_sha256 OR r.lifecycle_version<>e.lifecycle_version THEN RAISE EXCEPTION 'Invalid comparison review' USING ERRCODE='23514'; END IF;
   SELECT value INTO item FROM jsonb_array_elements(r.items) WHERE value->'source'->>'id'=m->>'candidateId';
   IF NOT FOUND THEN RAISE EXCEPTION 'Invalid comparison candidate' USING ERRCODE='23514'; END IF;
   fields:=item->'fields';
   IF fields->>'unit' IS NULL THEN RAISE EXCEPTION 'Invalid comparison unit' USING ERRCODE='23514'; END IF;
   IF analyte IS NULL THEN analyte:=fields->>'analyte'; unit:=fields->>'unit'; ELSE
    IF analyte IS DISTINCT FROM ((fields->>'analyte') COLLATE "C") OR unit IS DISTINCT FROM ((fields->>'unit') COLLATE "C") THEN RAISE EXCEPTION 'Incompatible comparison fields' USING ERRCODE='23514'; END IF;
   END IF;
   IF fields->>'specimen' IS NOT NULL THEN IF specimen IS NOT NULL AND specimen<>((fields->>'specimen') COLLATE "C") THEN RAISE EXCEPTION 'Incompatible specimen' USING ERRCODE='23514'; END IF; specimen:=fields->>'specimen'; END IF;
   IF fields->>'method' IS NOT NULL THEN IF method IS NOT NULL AND method<>((fields->>'method') COLLATE "C") THEN RAISE EXCEPTION 'Incompatible method' USING ERRCODE='23514'; END IF; method:=fields->>'method'; END IF;
  END IF;
 END LOOP;
 NEW.recorded_at:=clock_timestamp();
 IF NEW.action='withdrawal' AND (prev.id IS NULL OR prev.action<>'confirmation' OR NEW.members IS DISTINCT FROM prev.members) THEN RAISE EXCEPTION 'Invalid comparison withdrawal' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER measurement_comparison_guard BEFORE INSERT ON fmv.measurement_comparisons FOR EACH ROW EXECUTE FUNCTION fmv.guard_measurement_comparison();
CREATE FUNCTION fmv.guard_comparison_source() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM fmv.measurement_comparisons c WHERE c.id=NEW.ledger_id AND c.patient_id=NEW.patient_id AND c.set_id=NEW.set_id AND EXISTS(SELECT 1 FROM jsonb_array_elements(c.members) m WHERE m->>'documentId'=NEW.document_id::text)) OR NOT EXISTS(SELECT 1 FROM fmv.documents d WHERE d.id=NEW.document_id AND d.patient_id=NEW.patient_id) THEN RAISE EXCEPTION 'Invalid comparison source link' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER comparison_source_guard BEFORE INSERT ON fmv.comparison_sources FOR EACH ROW EXECUTE FUNCTION fmv.guard_comparison_source();
CREATE FUNCTION fmv.link_comparison_sources() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 INSERT INTO fmv.comparison_sources(ledger_id,patient_id,set_id,document_id) SELECT NEW.id,NEW.patient_id,NEW.set_id,(m->>'documentId')::uuid FROM jsonb_array_elements(NEW.members) m GROUP BY m->>'documentId';
 RETURN NEW;
END $$;
CREATE TRIGGER comparison_link_sources AFTER INSERT ON fmv.measurement_comparisons FOR EACH ROW EXECUTE FUNCTION fmv.link_comparison_sources();
-- Invoker-only cleanup: no runtime DELETE or SECURITY DEFINER. A future
-- privileged P6 purger must satisfy existing retention FKs and ledger RLS/rights.
CREATE FUNCTION fmv.purge_comparison_set() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 DELETE FROM fmv.measurement_comparisons WHERE set_id=OLD.set_id;
 RETURN OLD;
END $$;
CREATE TRIGGER comparison_purge_set AFTER DELETE ON fmv.comparison_sources FOR EACH ROW EXECUTE FUNCTION fmv.purge_comparison_set();
CREATE FUNCTION fmv.check_comparison_sources_complete() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE ledger uuid; parent fmv.measurement_comparisons%ROWTYPE; expected uuid[]; actual uuid[];
BEGIN
 IF TG_TABLE_NAME='measurement_comparisons' THEN ledger:=NEW.id;
 ELSIF TG_OP='DELETE' THEN ledger:=OLD.ledger_id;
 ELSE ledger:=NEW.ledger_id; END IF;
 SELECT * INTO parent FROM fmv.measurement_comparisons WHERE id=ledger;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT array_agg(DISTINCT (m->>'documentId')::uuid ORDER BY (m->>'documentId')::uuid) INTO expected FROM jsonb_array_elements(parent.members) m;
 SELECT array_agg(document_id ORDER BY document_id) INTO actual FROM fmv.comparison_sources WHERE ledger_id=ledger;
 IF expected IS DISTINCT FROM actual THEN RAISE EXCEPTION 'Incomplete comparison source links' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER comparison_ledger_complete AFTER INSERT ON fmv.measurement_comparisons DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fmv.check_comparison_sources_complete();
CREATE CONSTRAINT TRIGGER comparison_links_complete AFTER INSERT OR DELETE ON fmv.comparison_sources DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fmv.check_comparison_sources_complete();
ALTER TABLE fmv.measurement_comparisons ENABLE ROW LEVEL SECURITY; ALTER TABLE fmv.measurement_comparisons FORCE ROW LEVEL SECURITY;
ALTER TABLE fmv.comparison_sources ENABLE ROW LEVEL SECURITY; ALTER TABLE fmv.comparison_sources FORCE ROW LEVEL SECURITY;
REVOKE ALL ON fmv.measurement_comparisons, fmv.comparison_sources FROM PUBLIC, fmv_app;
GRANT SELECT,INSERT ON fmv.measurement_comparisons, fmv.comparison_sources TO fmv_app;
CREATE POLICY comparison_read ON fmv.measurement_comparisons FOR SELECT TO fmv_app USING(true);
CREATE POLICY comparison_insert ON fmv.measurement_comparisons FOR INSERT TO fmv_app WITH CHECK(true);
CREATE POLICY comparison_source_read ON fmv.comparison_sources FOR SELECT TO fmv_app USING(true);
CREATE POLICY comparison_source_insert ON fmv.comparison_sources FOR INSERT TO fmv_app WITH CHECK(true);
ALTER TABLE fmv.document_events DROP CONSTRAINT document_events_kind_check;
ALTER TABLE fmv.document_events ADD CONSTRAINT document_events_kind_check CHECK(kind IN ('document.uploaded','document.viewed','document.exported','document.renamed','document.trashed','document.restored','document.extraction_saved','document.metadata_saved','document.clinical_verified','document.clinical_withdrawn','document.diagnosis_confirmed','document.diagnosis_withdrawn','document.medication_confirmed','document.medication_withdrawn','processing.consent_granted','processing.consent_withdrawn','measurement.comparability_confirmed','measurement.comparability_withdrawn'));
REVOKE ALL ON FUNCTION fmv.guard_measurement_comparison() FROM PUBLIC;
REVOKE ALL ON FUNCTION fmv.guard_comparison_source() FROM PUBLIC;
REVOKE ALL ON FUNCTION fmv.link_comparison_sources() FROM PUBLIC;
REVOKE ALL ON FUNCTION fmv.purge_comparison_set() FROM PUBLIC;
REVOKE ALL ON FUNCTION fmv.check_comparison_sources_complete() FROM PUBLIC;
COMMIT;
