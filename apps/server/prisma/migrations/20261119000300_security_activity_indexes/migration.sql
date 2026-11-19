-- SEC-03: indexes only; no changes to events, permissions or retention.
BEGIN;
CREATE INDEX access_events_patient_time ON fmv.access_events(patient_id,occurred_at DESC,id DESC);
CREATE INDEX temporary_links_revoked ON fmv.temporary_links(patient_id,revoked_at DESC,id DESC);
COMMIT;
