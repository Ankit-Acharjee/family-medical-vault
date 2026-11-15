BEGIN;
CREATE FUNCTION fmv.processing_categories_valid(v TEXT[]) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT v IS NOT NULL AND cardinality(v) BETWEEN 1 AND 2 AND array_ndims(v)=1 AND array_lower(v,1)=1 AND NOT EXISTS(SELECT 1 FROM unnest(v) x WHERE x IS NULL OR x NOT IN ('original-document','saved-text')) AND cardinality(v)=(SELECT count(DISTINCT x) FROM unnest(v) x)
$$;
REVOKE ALL ON FUNCTION fmv.processing_categories_valid(TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fmv.processing_categories_valid(TEXT[]) TO fmv_app;
-- Infrastructure-reviewed catalog. No providers are seeded or enabled.
CREATE TABLE fmv.processing_provider_policies(
 generation UUID PRIMARY KEY,provider_id TEXT NOT NULL CHECK(provider_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(provider_id)<=64),
 policy_version TEXT NOT NULL CHECK(policy_version ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(policy_version)<=64),
 purposes TEXT[] NOT NULL CHECK(purposes=ARRAY['document-extraction']::text[]),
 data_categories TEXT[] NOT NULL CHECK(fmv.processing_categories_valid(data_categories)),
 expires_at TIMESTAMPTZ(3) NOT NULL CHECK(isfinite(expires_at)),review_reference TEXT NOT NULL CHECK(length(btrim(review_reference)) BETWEEN 1 AND 128),
 enabled BOOLEAN NOT NULL DEFAULT false,reviewed_at TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(provider_id,policy_version),CHECK(expires_at>reviewed_at)
);
CREATE UNIQUE INDEX processing_one_enabled_policy ON fmv.processing_provider_policies(provider_id) WHERE enabled;
CREATE FUNCTION fmv.processing_policy_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Immutable processing policy' USING ERRCODE='23514'; END IF;
 IF OLD.enabled IS DISTINCT FROM true OR NEW.enabled IS DISTINCT FROM false OR (to_jsonb(NEW)-'enabled') IS DISTINCT FROM (to_jsonb(OLD)-'enabled') THEN RAISE EXCEPTION 'Immutable processing policy' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION fmv.processing_policy_immutable() FROM PUBLIC;
CREATE TRIGGER processing_policy_immutable BEFORE UPDATE OR DELETE ON fmv.processing_provider_policies FOR EACH ROW EXECUTE FUNCTION fmv.processing_policy_immutable();
ALTER TABLE fmv.processing_provider_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.processing_provider_policies FORCE ROW LEVEL SECURITY;
REVOKE ALL ON fmv.processing_provider_policies FROM PUBLIC;
GRANT SELECT ON fmv.processing_provider_policies TO fmv_app;
CREATE POLICY backend_processing_policy_read ON fmv.processing_provider_policies FOR SELECT TO fmv_app USING(true);
CREATE TABLE fmv.document_processing_consents(
 id UUID PRIMARY KEY,document_id UUID NOT NULL,patient_id UUID NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),request_id UUID NOT NULL,payload_hash TEXT NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
 actor_account_id UUID NOT NULL REFERENCES fmv.app_accounts(id) ON DELETE RESTRICT,
 action TEXT NOT NULL CHECK(action IN ('grant','withdrawal')),
 source_sha256 TEXT NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),source_revision INTEGER NOT NULL CHECK(source_revision>=0),lifecycle_version INTEGER NOT NULL CHECK(lifecycle_version>=0),
 policy_generation UUID NOT NULL REFERENCES fmv.processing_provider_policies(generation) ON DELETE RESTRICT,
 provider_id TEXT NOT NULL,policy_version TEXT NOT NULL,purpose TEXT NOT NULL CHECK(purpose='document-extraction'),
 data_categories TEXT[] NOT NULL CHECK(fmv.processing_categories_valid(data_categories)),
 expires_at TIMESTAMPTZ(3) NOT NULL CHECK(isfinite(expires_at)),recorded_at TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 CHECK(NOT ('saved-text'=ANY(data_categories)) OR source_revision>0),
 CONSTRAINT processing_consent_source FOREIGN KEY(patient_id,document_id) REFERENCES fmv.documents(patient_id,id) ON DELETE CASCADE,
 UNIQUE(document_id,revision),UNIQUE(document_id,request_id)
);
CREATE FUNCTION fmv.validate_processing_consent() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE d RECORD; owner_id UUID; source_rev INTEGER; prev fmv.document_processing_consents%ROWTYPE; policy fmv.processing_provider_policies%ROWTYPE;
BEGIN
 SELECT state,deleted_at,sha256,extraction_lifecycle INTO d FROM fmv.documents WHERE id=NEW.document_id AND patient_id=NEW.patient_id FOR NO KEY UPDATE;
 SELECT owner_account_id INTO owner_id FROM fmv.persons WHERE id=NEW.patient_id;
 IF owner_id IS DISTINCT FROM NEW.actor_account_id OR d.state IS DISTINCT FROM 'ready' OR d.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Invalid processing consent owner' USING ERRCODE='23514'; END IF;
 SELECT * INTO prev FROM fmv.document_processing_consents WHERE document_id=NEW.document_id ORDER BY revision DESC LIMIT 1;
 IF NEW.revision<>COALESCE(prev.revision,0)+1 THEN RAISE EXCEPTION 'Invalid processing consent revision' USING ERRCODE='23514'; END IF;
 IF NEW.action='withdrawal' THEN
  IF prev.action IS DISTINCT FROM 'grant' OR ROW(NEW.source_sha256,NEW.source_revision,NEW.lifecycle_version,NEW.policy_generation,NEW.provider_id,NEW.policy_version,NEW.purpose,NEW.data_categories,NEW.expires_at) IS DISTINCT FROM ROW(prev.source_sha256,prev.source_revision,prev.lifecycle_version,prev.policy_generation,prev.provider_id,prev.policy_version,prev.purpose,prev.data_categories,prev.expires_at) THEN RAISE EXCEPTION 'Invalid processing withdrawal binding' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT revision INTO source_rev FROM fmv.document_extractions WHERE document_id=NEW.document_id AND patient_id=NEW.patient_id;
  IF NEW.source_sha256 IS DISTINCT FROM d.sha256 OR NEW.lifecycle_version IS DISTINCT FROM d.extraction_lifecycle OR NEW.source_revision<>COALESCE(source_rev,0) THEN RAISE EXCEPTION 'Invalid processing consent source' USING ERRCODE='23514'; END IF;
  SELECT * INTO policy FROM fmv.processing_provider_policies WHERE generation=NEW.policy_generation;
  IF policy.enabled IS DISTINCT FROM true OR policy.provider_id IS DISTINCT FROM NEW.provider_id OR policy.policy_version IS DISTINCT FROM NEW.policy_version OR NEW.purpose<>ALL(policy.purposes) OR NOT NEW.data_categories<@policy.data_categories OR NEW.expires_at<=clock_timestamp() OR NEW.expires_at>policy.expires_at THEN RAISE EXCEPTION 'Unavailable processing policy' USING ERRCODE='23514'; END IF;
 END IF;
 NEW.recorded_at:=clock_timestamp();RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION fmv.validate_processing_consent() FROM PUBLIC;
CREATE TRIGGER processing_consent_source_guard BEFORE INSERT ON fmv.document_processing_consents FOR EACH ROW EXECUTE FUNCTION fmv.validate_processing_consent();
ALTER TABLE fmv.document_processing_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.document_processing_consents FORCE ROW LEVEL SECURITY;
REVOKE ALL ON fmv.document_processing_consents FROM PUBLIC;
GRANT SELECT,INSERT ON fmv.document_processing_consents TO fmv_app;
CREATE POLICY backend_processing_consent_read ON fmv.document_processing_consents FOR SELECT TO fmv_app USING(true);
CREATE POLICY backend_processing_consent_insert ON fmv.document_processing_consents FOR INSERT TO fmv_app WITH CHECK(true);
ALTER TABLE fmv.document_events DROP CONSTRAINT document_events_kind_check;
ALTER TABLE fmv.document_events ADD CONSTRAINT document_events_kind_check CHECK(kind IN ('document.uploaded','document.viewed','document.exported','document.renamed','document.trashed','document.restored','document.extraction_saved','document.metadata_saved','document.clinical_verified','document.clinical_withdrawn','document.diagnosis_confirmed','document.diagnosis_withdrawn','document.medication_confirmed','document.medication_withdrawn','processing.consent_granted','processing.consent_withdrawn'));
COMMIT;
