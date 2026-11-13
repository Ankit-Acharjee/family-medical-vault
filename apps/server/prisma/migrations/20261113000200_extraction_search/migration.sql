BEGIN;
-- Only page text is searchable. Native simple tokenization retains case-folded
-- whole terms without stemming; no positions or clinical verification implied.
-- A bounded saved result may exceed tsvector's 1 MiB limit, so index its distinct
-- lexeme array instead. Ignore >=2047-byte lexemes as native full-text search does.
CREATE FUNCTION fmv.extraction_search_terms(v JSONB) RETURNS TEXT[]
LANGUAGE SQL IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog AS $$
 SELECT COALESCE(array_agg(DISTINCT term ORDER BY term), ARRAY[]::text[])
 FROM jsonb_array_elements(v->'pages') AS page
 CROSS JOIN LATERAL ts_debug('pg_catalog.simple'::regconfig, page->>'text') AS token
 CROSS JOIN LATERAL unnest(token.lexemes) AS term
 WHERE octet_length(term) < 2047
$$;
REVOKE ALL ON FUNCTION fmv.extraction_search_terms(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fmv.extraction_search_terms(JSONB) TO fmv_app;
ALTER TABLE fmv.document_extractions ADD COLUMN search_terms TEXT[]
 GENERATED ALWAYS AS (fmv.extraction_search_terms(result)) STORED;
CREATE INDEX document_extractions_search_terms_idx ON fmv.document_extractions USING GIN(search_terms);
COMMIT;
