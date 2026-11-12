BEGIN;
-- Keep the original declaration title immutable for upload idempotency.
ALTER TABLE fmv.documents ADD COLUMN display_title TEXT
 CHECK (display_title IS NULL OR (length(display_title) BETWEEN 1 AND 200 AND display_title !~ '[[:cntrl:]]'));
GRANT UPDATE(display_title) ON fmv.documents TO fmv_app;
ALTER TABLE fmv.document_events DROP CONSTRAINT document_events_kind_check;
ALTER TABLE fmv.document_events ADD CONSTRAINT document_events_kind_check
 CHECK (kind IN ('document.uploaded','document.viewed','document.exported','document.renamed'));
COMMIT;
