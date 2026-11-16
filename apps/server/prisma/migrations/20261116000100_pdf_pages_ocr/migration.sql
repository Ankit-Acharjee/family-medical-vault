BEGIN;
-- Add bounded selected-range OCR; retain existing method formats and privileges.
CREATE OR REPLACE FUNCTION fmv.extraction_result_valid(v JSONB) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE item JSONB; m TEXT; reason TEXT; t TEXT; n INTEGER; previous INTEGER := 0; total INTEGER := 0; has_text BOOLEAN := false; is_partial BOOLEAN;
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(v)) <> 6 OR NOT v ?& ARRAY['method','engineVersion','pages','partial','partialReason','downsized'] THEN RETURN false; END IF;
 m := v->>'method'; reason := v->>'partialReason';
 IF m NOT IN ('pdf-text','image-ocr','pdf-page-ocr','pdf-pages-ocr') OR m IS NULL THEN RETURN false; END IF;
 IF v->>'engineVersion' IS DISTINCT FROM (CASE m WHEN 'pdf-text' THEN 'pdfjs-6.5.438' WHEN 'image-ocr' THEN 'tesseract-7.0.0+eng-1.0.0' ELSE 'pdfjs-6.5.438+tesseract-7.0.0+eng-1.0.0' END) THEN RETURN false; END IF;
 IF jsonb_typeof(v->'partial') <> 'boolean' OR jsonb_typeof(v->'downsized') <> 'boolean' OR jsonb_typeof(v->'pages') <> 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(v->'pages') NOT BETWEEN 1 AND 50 OR octet_length(v::text) > 3100000 THEN RETURN false; END IF;
 is_partial := (v->>'partial')::boolean;
 IF is_partial <> (reason IS NOT NULL) THEN RETURN false; END IF;
 IF m='pdf-text' THEN
  IF (v->>'downsized')::boolean OR (reason IS NOT NULL AND reason NOT IN ('pages','characters')) OR (reason='pages' AND jsonb_array_length(v->'pages')<>50) THEN RETURN false; END IF;
 ELSIF m='pdf-pages-ocr' THEN
  IF jsonb_array_length(v->'pages')>5 OR NOT is_partial OR reason NOT IN ('selected-pages','characters') THEN RETURN false; END IF;
 ELSE
  IF jsonb_array_length(v->'pages')<>1 THEN RETURN false; END IF;
  IF m='image-ocr' AND reason IS NOT NULL AND reason<>'characters' THEN RETURN false; END IF;
  IF m='pdf-page-ocr' AND (NOT is_partial OR reason NOT IN ('selected-page','characters')) THEN RETURN false; END IF;
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(v->'pages') LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(item))<>2 OR NOT item ?& ARRAY['page','text'] THEN RETURN false; END IF;
  IF jsonb_typeof(item->'page')<>'number' OR (item->>'page') !~ '^[1-9][0-9]?$' OR jsonb_typeof(item->'text')<>'string' THEN RETURN false; END IF;
  n := (item->>'page')::integer; t := item->>'text';
  IF n>50 OR n<=previous OR (m='pdf-text' AND n<>previous+1) OR (m='pdf-pages-ocr' AND previous>0 AND n<>previous+1) OR (m='image-ocr' AND n<>1) THEN RETURN false; END IF;
  previous := n;
  -- PostgreSQL counts code points; include supplementary characters a second
  -- time to enforce the same UTF-16 bound as the browser/contract validator.
  total := total + char_length(t) + char_length(regexp_replace(t,U&'[^\+010000-\+10FFFF]','','g'));
  IF total > (CASE WHEN m='pdf-text' THEN 500000 ELSE 100000 END) THEN RETURN false; END IF;
  has_text := has_text OR t ~ U&'[^\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]';
 END LOOP;
 RETURN has_text;
END $$;
COMMIT;
