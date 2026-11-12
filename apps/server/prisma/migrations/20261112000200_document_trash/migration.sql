BEGIN;
ALTER TABLE fmv.documents ADD COLUMN deleted_at TIMESTAMPTZ(3)
 CHECK (deleted_at IS NULL OR state='ready');
GRANT UPDATE(deleted_at) ON fmv.documents TO fmv_app;
ALTER TABLE fmv.document_events DROP CONSTRAINT document_events_kind_check;
ALTER TABLE fmv.document_events ADD CONSTRAINT document_events_kind_check
 CHECK (kind IN ('document.uploaded','document.viewed','document.exported','document.renamed','document.trashed','document.restored'));
COMMIT;
