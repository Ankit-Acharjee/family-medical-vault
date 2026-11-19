-- SEC-03 / SEC-04: bounded patient activity ordering; no data or privilege changes.
CREATE INDEX document_events_patient_time ON fmv.document_events(patient_id,occurred_at DESC,id DESC);
