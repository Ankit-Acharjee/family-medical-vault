BEGIN;
-- Exact original metadata/lifecycle snapshots, not live category/patient grants.
CREATE FUNCTION fmv.share_sources_current(p uuid,s jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE x jsonb; d record; total bigint:=0; seen uuid[]:=ARRAY[]::uuid[];
BEGIN
 IF s IS NULL OR jsonb_typeof(s)<>'array' OR jsonb_array_length(s) NOT BETWEEN 1 AND 20 THEN RETURN false; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(s) LOOP
  IF jsonb_typeof(x)<>'object' OR (x-ARRAY['id','patientId','categoryId','state','deletedAt','title','originalTitle','mimeType','bytes','sha256','objectKey','lifecycle','active'])<>'{}'::jsonb OR (SELECT count(*) FROM jsonb_object_keys(x))<>13 OR (x->>'id')::uuid=ANY(seen) THEN RETURN false; END IF;
  seen:=array_append(seen,(x->>'id')::uuid);
  SELECT q.*,EXISTS(SELECT 1 FROM fmv.document_object_attempts a WHERE a.document_id=q.id AND a.object_key=q.object_key AND a.retired_at IS NULL) active INTO d FROM fmv.documents q WHERE q.patient_id=p AND q.id=(x->>'id')::uuid;
  IF NOT FOUND OR d.state<>'ready' OR d.deleted_at IS NOT NULL OR NOT d.active OR x<>jsonb_build_object('id',d.id,'patientId',d.patient_id,'categoryId',d.category_id,'state',d.state,'deletedAt',d.deleted_at,'title',COALESCE(d.display_title,d.title),'originalTitle',d.title,'mimeType',d.mime_type,'bytes',d.bytes,'sha256',d.sha256,'objectKey',d.object_key,'lifecycle',d.extraction_lifecycle,'active',true) THEN RETURN false; END IF;
  total:=total+d.bytes;
 END LOOP;
 RETURN total<=33554432;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION fmv.share_sources_current(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fmv.share_sources_current(uuid,jsonb) TO fmv_app;
CREATE TABLE fmv.temporary_links(
 id uuid PRIMARY KEY,patient_id uuid NOT NULL REFERENCES fmv.persons(id) ON DELETE CASCADE,
 creator_account_id uuid NOT NULL REFERENCES fmv.app_accounts(id),patient_name text NOT NULL CHECK(length(patient_name) BETWEEN 1 AND 200),request_id uuid NOT NULL,
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[a-f0-9]{64}$' AND length(payload_sha256)=64),
 token_sha256 text NOT NULL UNIQUE CHECK(token_sha256 ~ '^[a-f0-9]{64}$' AND length(token_sha256)=64),
 selection_sha256 text NOT NULL CHECK(selection_sha256 ~ '^[a-f0-9]{64}$' AND length(selection_sha256)=64),
 source_snapshot jsonb NOT NULL CHECK(jsonb_typeof(source_snapshot)='array' AND jsonb_array_length(source_snapshot) BETWEEN 1 AND 20 AND octet_length(source_snapshot::text)<=262144),
 created_at timestamptz(3) NOT NULL DEFAULT statement_timestamp(),expires_at timestamptz(3) NOT NULL,
 revoked_at timestamptz(3),revoker_account_id uuid REFERENCES fmv.app_accounts(id),
 UNIQUE(patient_id,request_id),CHECK(isfinite(expires_at) AND expires_at>created_at AND expires_at<=created_at+interval '7 days'),
 CHECK((revoked_at IS NULL)=(revoker_account_id IS NULL)),CHECK(revoked_at IS NULL OR (isfinite(revoked_at) AND revoked_at>=created_at))
);
CREATE INDEX temporary_links_patient ON fmv.temporary_links(patient_id,created_at DESC,id);
CREATE FUNCTION fmv.guard_temporary_link() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE account uuid;
BEGIN
 SELECT owner_account_id INTO account FROM fmv.persons WHERE id=NEW.patient_id;
 IF TG_OP='INSERT' THEN
  IF account IS DISTINCT FROM NEW.creator_account_id OR NOT EXISTS(SELECT 1 FROM fmv.persons WHERE id=NEW.patient_id AND display_name=NEW.patient_name) OR NEW.revoked_at IS NOT NULL OR NEW.revoker_account_id IS NOT NULL THEN RAISE EXCEPTION 'Invalid share owner' USING ERRCODE='23514'; END IF;
  -- Lock exact originals against concurrent lifecycle/metadata changes while creating the grant.
  PERFORM d.id FROM fmv.documents d WHERE d.patient_id=NEW.patient_id AND d.id IN(SELECT (value->>'id')::uuid FROM jsonb_array_elements(NEW.source_snapshot)) ORDER BY d.id FOR NO KEY UPDATE;
  IF NOT fmv.share_sources_current(NEW.patient_id,NEW.source_snapshot) THEN RAISE EXCEPTION 'Invalid share sources' USING ERRCODE='23514'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['revoked_at','revoker_account_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['revoked_at','revoker_account_id']) OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL OR NEW.revoked_at>clock_timestamp() OR NEW.revoker_account_id IS DISTINCT FROM account THEN RAISE EXCEPTION 'Immutable share or invalid revocation' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION fmv.guard_temporary_link() FROM PUBLIC;
CREATE TRIGGER temporary_link_guard BEFORE INSERT OR UPDATE ON fmv.temporary_links FOR EACH ROW EXECUTE FUNCTION fmv.guard_temporary_link();
ALTER TABLE fmv.temporary_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.temporary_links FORCE ROW LEVEL SECURITY;
REVOKE ALL ON fmv.temporary_links FROM PUBLIC,fmv_app;
GRANT SELECT ON fmv.temporary_links TO fmv_app;
GRANT INSERT(id,patient_id,creator_account_id,patient_name,request_id,payload_sha256,token_sha256,selection_sha256,source_snapshot,expires_at) ON fmv.temporary_links TO fmv_app;
GRANT UPDATE(revoked_at,revoker_account_id) ON fmv.temporary_links TO fmv_app;
CREATE POLICY backend_temporary_link_read ON fmv.temporary_links FOR SELECT TO fmv_app USING(true);
CREATE POLICY backend_temporary_link_insert ON fmv.temporary_links FOR INSERT TO fmv_app WITH CHECK(true);
CREATE POLICY backend_temporary_link_revoke ON fmv.temporary_links FOR UPDATE TO fmv_app USING(true) WITH CHECK(true);
-- Ordinary anonymous document-access audit only; no token, IP, medical field or owner impersonation.
CREATE TABLE fmv.temporary_link_access_events(
 id uuid PRIMARY KEY,link_id uuid NOT NULL REFERENCES fmv.temporary_links(id) ON DELETE CASCADE,
 document_id uuid REFERENCES fmv.documents(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN('link.opened','original.accessed')),
 recorded_at timestamptz(3) NOT NULL DEFAULT statement_timestamp(),
 retention_until timestamptz(3) NOT NULL DEFAULT (statement_timestamp()+interval '90 days'),
 CHECK(retention_until=recorded_at+interval '90 days'),CHECK((kind='link.opened')=(document_id IS NULL))
);
CREATE INDEX temporary_link_access_retention ON fmv.temporary_link_access_events(retention_until);
CREATE INDEX temporary_link_access_link ON fmv.temporary_link_access_events(link_id,recorded_at DESC,id);
CREATE FUNCTION fmv.guard_temporary_link_access() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE link fmv.temporary_links%ROWTYPE;
BEGIN
 SELECT * INTO link FROM fmv.temporary_links WHERE id=NEW.link_id FOR NO KEY UPDATE;
 IF NOT FOUND OR link.revoked_at IS NOT NULL OR link.expires_at<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM fmv.persons WHERE id=link.patient_id AND owner_account_id=link.creator_account_id AND display_name=link.patient_name) OR NOT fmv.share_sources_current(link.patient_id,link.source_snapshot) OR (NEW.document_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(link.source_snapshot) x WHERE (x->>'id')::uuid=NEW.document_id)) THEN RAISE EXCEPTION 'Unavailable share access' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION fmv.guard_temporary_link_access() FROM PUBLIC;
CREATE TRIGGER temporary_link_access_guard BEFORE INSERT ON fmv.temporary_link_access_events FOR EACH ROW EXECUTE FUNCTION fmv.guard_temporary_link_access();
ALTER TABLE fmv.temporary_link_access_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.temporary_link_access_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON fmv.temporary_link_access_events FROM PUBLIC,fmv_app;
GRANT SELECT ON fmv.temporary_link_access_events TO fmv_app;
GRANT INSERT(id,link_id,document_id,kind) ON fmv.temporary_link_access_events TO fmv_app;
CREATE POLICY backend_temporary_link_access_read ON fmv.temporary_link_access_events FOR SELECT TO fmv_app USING(true);
CREATE POLICY backend_temporary_link_access_insert ON fmv.temporary_link_access_events FOR INSERT TO fmv_app WITH CHECK(true);
COMMIT;
