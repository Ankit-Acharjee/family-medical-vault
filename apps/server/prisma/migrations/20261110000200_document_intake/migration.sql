BEGIN;
CREATE TABLE fmv.document_categories (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL
);
INSERT INTO fmv.document_categories (slug,name) VALUES ('unclassified','Unclassified');
CREATE TABLE fmv.documents (
 id UUID PRIMARY KEY, upload_id UUID NOT NULL UNIQUE,
 patient_id UUID NOT NULL REFERENCES fmv.persons(id) ON DELETE RESTRICT,
 category_id UUID NOT NULL REFERENCES fmv.document_categories(id) ON DELETE RESTRICT,
 title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
 mime_type TEXT NOT NULL CHECK (mime_type IN ('application/pdf','image/jpeg','image/png','image/webp')),
 bytes INTEGER NOT NULL CHECK (bytes BETWEEN 1 AND 26214400),
 sha256 TEXT NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
 idempotency_key TEXT NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{1,128}$'),
 object_key TEXT NOT NULL UNIQUE CHECK (object_key ~ '^[a-f0-9]{32}$'),
 state TEXT NOT NULL CHECK (state IN ('pending','ready','failed')),
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT statement_timestamp(),
 UNIQUE (patient_id,idempotency_key),
 CONSTRAINT documents_patient_identity UNIQUE (patient_id,id)
);
CREATE INDEX documents_patient ON fmv.documents(patient_id,created_at);
CREATE TABLE fmv.document_events (
 id UUID PRIMARY KEY,
 patient_id UUID NOT NULL REFERENCES fmv.persons(id) ON DELETE RESTRICT,
 document_id UUID NOT NULL REFERENCES fmv.documents(id) ON DELETE RESTRICT,
 actor_account_id UUID NOT NULL REFERENCES fmv.app_accounts(id) ON DELETE RESTRICT,
 kind TEXT NOT NULL CHECK (kind IN ('document.uploaded','document.viewed','document.exported')),
 occurred_at TIMESTAMPTZ(3) NOT NULL DEFAULT statement_timestamp(),
 retention_until TIMESTAMPTZ(3) NOT NULL DEFAULT (statement_timestamp() + interval '90 days')
);
CREATE INDEX document_events_retention ON fmv.document_events(retention_until);
ALTER TABLE fmv.access_grants ADD CONSTRAINT access_grants_category_fk FOREIGN KEY (category_id) REFERENCES fmv.document_categories(id) ON DELETE RESTRICT;
ALTER TABLE fmv.access_grants ADD CONSTRAINT access_grants_document_fk FOREIGN KEY (patient_id,document_id) REFERENCES fmv.documents(patient_id,id) ON DELETE RESTRICT;
ALTER TABLE fmv.document_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.document_categories FORCE ROW LEVEL SECURITY;
ALTER TABLE fmv.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.documents FORCE ROW LEVEL SECURITY;
ALTER TABLE fmv.document_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.document_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON fmv.document_categories, fmv.documents, fmv.document_events FROM PUBLIC;
GRANT SELECT ON fmv.document_categories TO fmv_app;
GRANT SELECT,INSERT ON fmv.documents, fmv.document_events TO fmv_app;
GRANT UPDATE(state) ON fmv.documents TO fmv_app;
CREATE POLICY backend_categories_read ON fmv.document_categories FOR SELECT TO fmv_app USING (true);
CREATE POLICY backend_documents_read ON fmv.documents FOR SELECT TO fmv_app USING (true);
CREATE POLICY backend_documents_insert ON fmv.documents FOR INSERT TO fmv_app WITH CHECK (true);
CREATE POLICY backend_documents_state ON fmv.documents FOR UPDATE TO fmv_app USING (true) WITH CHECK (true);
CREATE POLICY backend_document_events_read ON fmv.document_events FOR SELECT TO fmv_app USING (true);
CREATE POLICY backend_document_events_insert ON fmv.document_events FOR INSERT TO fmv_app WITH CHECK (true);
COMMIT;
