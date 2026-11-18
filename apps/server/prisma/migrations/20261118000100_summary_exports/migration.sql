-- Value-free, ordinary 90-day audit of generated summary exports. No artifact or clinical fields.
CREATE TABLE fmv.summary_export_events (
 id uuid PRIMARY KEY,
 patient_id uuid NOT NULL REFERENCES fmv.persons(id) ON DELETE CASCADE,
 actor_account_id uuid NOT NULL REFERENCES fmv.app_accounts(id),
 request_id uuid NOT NULL,
 scope text NOT NULL CHECK(scope IN ('patient','laboratory','manual','medication')),
 snapshot_sha256 text NOT NULL CHECK(length(snapshot_sha256)=64 AND snapshot_sha256 ~ '^[a-f0-9]{64}$'),
 artifact_sha256 text NOT NULL CHECK(length(artifact_sha256)=64 AND artifact_sha256 ~ '^[a-f0-9]{64}$'),
 bytes integer NOT NULL CHECK(bytes>0 AND bytes<=16777216),
 source_document_ids uuid[] NOT NULL CHECK(cardinality(source_document_ids)<=70 AND array_position(source_document_ids,NULL) IS NULL),
 manual_reading_ids uuid[] NOT NULL CHECK(cardinality(manual_reading_ids)<=20 AND array_position(manual_reading_ids,NULL) IS NULL),
 medication_ids uuid[] NOT NULL CHECK(cardinality(medication_ids)<=20 AND array_position(medication_ids,NULL) IS NULL),
 recorded_at timestamptz(3) NOT NULL DEFAULT statement_timestamp(),
 retention_until timestamptz(3) NOT NULL DEFAULT (statement_timestamp()+interval '90 days'),
 CHECK(retention_until=recorded_at+interval '90 days')
);
CREATE INDEX summary_export_events_patient ON fmv.summary_export_events(patient_id,recorded_at DESC,id);
CREATE INDEX summary_export_events_retention ON fmv.summary_export_events(retention_until);
ALTER TABLE fmv.summary_export_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.summary_export_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON fmv.summary_export_events FROM PUBLIC,fmv_app;
GRANT SELECT ON fmv.summary_export_events TO fmv_app;
GRANT INSERT(id,patient_id,actor_account_id,request_id,scope,snapshot_sha256,artifact_sha256,bytes,source_document_ids,manual_reading_ids,medication_ids) ON fmv.summary_export_events TO fmv_app;
CREATE POLICY backend_summary_export_read ON fmv.summary_export_events FOR SELECT TO fmv_app USING(true);
CREATE POLICY backend_summary_export_insert ON fmv.summary_export_events FOR INSERT TO fmv_app WITH CHECK(true);
