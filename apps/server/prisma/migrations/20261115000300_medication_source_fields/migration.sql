BEGIN;
CREATE FUNCTION fmv.medication_statements_valid(v JSONB) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE item JSONB; f JSONB; fields JSONB; ids TEXT[]:=ARRAY[]::text[]; n INTEGER; raw TEXT; k TEXT; label TEXT;
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(v)>20 OR octet_length(v::text)>500000 THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(v) LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR NOT item ?& ARRAY['id','page','fields','unverified','confidence'] OR (SELECT count(*) FROM jsonb_object_keys(item))<>5 OR item->'unverified' IS DISTINCT FROM 'true'::jsonb OR item->>'confidence' IS DISTINCT FROM 'unrated' THEN RETURN false; END IF;
  IF jsonb_typeof(item->'page') IS DISTINCT FROM 'number' OR (item->>'page') !~ '^[1-9][0-9]?$' THEN RETURN false; END IF;
  n:=(item->>'page')::integer;
  IF n>50 OR jsonb_typeof(item->'id') IS DISTINCT FROM 'string' OR (item->>'id') !~ ('^page-'||n||'-medication-(0|[1-9][0-9]{0,5})$') OR item->>'id'=ANY(ids) THEN RETURN false; END IF;
  IF split_part(item->>'id','-',4)::integer>=500000 THEN RETURN false; END IF;
  ids:=array_append(ids,item->>'id'); fields:=item->'fields';
  IF jsonb_typeof(fields) IS DISTINCT FROM 'object' OR NOT fields ?& ARRAY['medication','strength','dose','frequency','route','duration','start','end','instructions'] OR (SELECT count(*) FROM jsonb_object_keys(fields))<>9 THEN RETURN false; END IF;
  FOREACH k IN ARRAY ARRAY['medication','strength','dose','frequency','route','duration','start','end','instructions'] LOOP
   f:=fields->k;
   IF f='null'::jsonb AND k<>'medication' THEN CONTINUE; END IF;
   IF jsonb_typeof(f) IS DISTINCT FROM 'object' OR NOT f ?& ARRAY['value','excerpt'] OR (SELECT count(*) FROM jsonb_object_keys(f))<>2 OR NOT fmv.clinical_value_valid(f->'value',false) OR jsonb_typeof(f->'excerpt') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
   label:=CASE k WHEN 'medication' THEN 'Medication:' WHEN 'strength' THEN 'Strength:' WHEN 'dose' THEN 'Dose:' WHEN 'frequency' THEN 'Frequency:' WHEN 'route' THEN 'Route:' WHEN 'duration' THEN 'Duration:' WHEN 'start' THEN 'Start date:' WHEN 'end' THEN 'End date:' WHEN 'instructions' THEN 'Instructions:' END;
   raw:=f->>'excerpt';
   IF strpos(raw,E'\n')>0 OR left(raw,char_length(label))<>label OR char_length(raw)+char_length(regexp_replace(raw,U&'[^\+010000-\+10FFFF]','','g'))>240 THEN RETURN false; END IF;
   raw:=substring(raw from char_length(label)+1);IF left(raw,1)=' ' THEN raw:=substring(raw from 2); END IF;
   IF raw IS DISTINCT FROM f->>'value' THEN RETURN false; END IF;
  END LOOP;
 END LOOP;
 RETURN true;
END $$;
CREATE FUNCTION fmv.medication_set_valid(active JSONB,withdrawn JSONB,kind TEXT) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE item JSONB; ids TEXT[]:=ARRAY[]::text[]; n INTEGER; w INTEGER;
BEGIN
 IF kind IS NULL OR kind NOT IN ('confirmation','withdrawal') OR NOT fmv.medication_statements_valid(active) OR NOT fmv.medication_statements_valid(withdrawn) THEN RETURN false; END IF;
 n:=jsonb_array_length(active);w:=jsonb_array_length(withdrawn);
 IF n+w>20 OR NOT ((kind='confirmation' AND n>=1 AND w=0) OR (kind='withdrawal' AND w>=1)) THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(active||withdrawn) LOOP
  IF item->>'id'=ANY(ids) THEN RETURN false; END IF;ids:=array_append(ids,item->>'id');
 END LOOP;
 RETURN true;
END $$;
-- Resolve a UTF-16 offset to a PostgreSQL character position without walking blank lines.
CREATE FUNCTION fmv.medication_utf16_position(v TEXT,target INTEGER) RETURNS INTEGER LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE lo INTEGER:=0; hi INTEGER; middle INTEGER; units INTEGER; prefix TEXT;
BEGIN
 IF v IS NULL OR target IS NULL OR target<0 OR target>=500000 THEN RETURN NULL; END IF;
 hi:=least(target,char_length(v));
 IF v !~ U&'[\+010000-\+10FFFF]' THEN RETURN CASE WHEN target<=char_length(v) THEN target+1 ELSE NULL END; END IF;
 WHILE lo<=hi LOOP
  middle:=(lo+hi)/2;prefix:=left(v,middle);
  units:=char_length(prefix)+char_length(regexp_replace(prefix,U&'[^\+010000-\+10FFFF]','','g'));
  IF units=target THEN RETURN middle+1; ELSIF units<target THEN lo:=middle+1; ELSE hi:=middle-1; END IF;
 END LOOP;
 RETURN NULL;
END $$;
-- Rebuild precisely this physical source block; field presence elsewhere is insufficient.
CREATE FUNCTION fmv.medication_statement_matches(item JSONB,text_value TEXT,drop_last BOOLEAN) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE cursor_pos INTEGER; next_lf INTEGER; line_end INTEGER; content TEXT; k TEXT; label TEXT; value_text TEXT; expected JSONB; seen INTEGER:=0; total INTEGER;
BEGIN
 IF text_value IS NULL OR NOT fmv.medication_statements_valid(jsonb_build_array(item)) THEN RETURN false; END IF;
 cursor_pos:=fmv.medication_utf16_position(text_value,split_part(item->>'id','-',4)::integer);
 IF cursor_pos IS NULL OR (cursor_pos>1 AND substring(text_value from cursor_pos-1 for 1)<>E'\n') THEN RETURN false; END IF;
 total:=char_length(text_value);
 expected:=jsonb_build_object('medication',NULL,'strength',NULL,'dose',NULL,'frequency',NULL,'route',NULL,'duration',NULL,'start',NULL,'end',NULL,'instructions',NULL);
 WHILE cursor_pos<=total LOOP
  next_lf:=strpos(substring(text_value from cursor_pos),E'\n');
  line_end:=CASE WHEN next_lf=0 THEN total+1 ELSE cursor_pos+next_lf-1 END;
  IF COALESCE(drop_last,false) AND (next_lf=0 OR line_end=total) THEN EXIT; END IF;
  content:=substring(text_value from cursor_pos for line_end-cursor_pos);
  IF next_lf>0 AND right(content,1)=E'\r' THEN content:=left(content,char_length(content)-1); END IF;
  -- ECMAScript whitespace, as used by the shared conservative parser.
  IF btrim(content,U&' \0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')='' THEN EXIT; END IF;
  k:=NULL;label:=NULL;
  IF left(content,11)='Medication:' THEN k:='medication';label:='Medication:';
  ELSIF left(content,9)='Strength:' THEN k:='strength';label:='Strength:';
  ELSIF left(content,5)='Dose:' THEN k:='dose';label:='Dose:';
  ELSIF left(content,10)='Frequency:' THEN k:='frequency';label:='Frequency:';
  ELSIF left(content,6)='Route:' THEN k:='route';label:='Route:';
  ELSIF left(content,9)='Duration:' THEN k:='duration';label:='Duration:';
  ELSIF left(content,11)='Start date:' THEN k:='start';label:='Start date:';
  ELSIF left(content,9)='End date:' THEN k:='end';label:='End date:';
  ELSIF left(content,13)='Instructions:' THEN k:='instructions';label:='Instructions:'; END IF;
  IF k='medication' AND seen>0 THEN EXIT; END IF;
  IF k IS NULL OR (seen=0 AND k<>'medication') OR expected->k IS DISTINCT FROM 'null'::jsonb THEN RETURN false; END IF;
  IF char_length(content)+char_length(regexp_replace(content,U&'[^\+010000-\+10FFFF]','','g'))>240 THEN RETURN false; END IF;
  value_text:=substring(content from char_length(label)+1);IF left(value_text,1)=' ' THEN value_text:=substring(value_text from 2); END IF;
  IF NOT fmv.clinical_value_valid(to_jsonb(value_text),false) THEN RETURN false; END IF;
  expected:=jsonb_set(expected,ARRAY[k],jsonb_build_object('value',value_text,'excerpt',content));
  seen:=seen+1;
  cursor_pos:=line_end+1;
 END LOOP;
 RETURN seen>0 AND expected IS NOT DISTINCT FROM item->'fields';
END $$;
REVOKE ALL ON FUNCTION fmv.medication_statements_valid(JSONB),fmv.medication_set_valid(JSONB,JSONB,TEXT),fmv.medication_statement_matches(JSONB,TEXT,BOOLEAN),fmv.medication_utf16_position(TEXT,INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fmv.medication_statements_valid(JSONB),fmv.medication_set_valid(JSONB,JSONB,TEXT),fmv.medication_statement_matches(JSONB,TEXT,BOOLEAN),fmv.medication_utf16_position(TEXT,INTEGER) TO fmv_app;
CREATE TABLE fmv.document_medication_reviews (
 id UUID PRIMARY KEY,
 document_id UUID NOT NULL,patient_id UUID NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),source_revision INTEGER NOT NULL CHECK(source_revision>0),
 source_sha256 TEXT NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),lifecycle_version INTEGER NOT NULL CHECK(lifecycle_version>=0),
 request_id UUID NOT NULL,payload_hash TEXT NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
 actor_account_id UUID NOT NULL REFERENCES fmv.app_accounts(id) ON DELETE RESTRICT,
 rule_version TEXT NOT NULL DEFAULT 'labeled-medication-blocks-v1' CHECK(rule_version='labeled-medication-blocks-v1'),
 meaning TEXT NOT NULL DEFAULT 'source-fields-only' CHECK(meaning='source-fields-only'),
 source_context JSONB NOT NULL CHECK(jsonb_typeof(source_context)='object'),
 action TEXT NOT NULL CHECK(action IN ('confirmation','withdrawal')),
 statements JSONB NOT NULL,withdrawn_statements JSONB NOT NULL DEFAULT '[]'::jsonb,
 confirmed_at TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT medication_set_shape CHECK(fmv.medication_set_valid(statements,withdrawn_statements,action)),
 CONSTRAINT medication_review_source FOREIGN KEY(patient_id,document_id) REFERENCES fmv.documents(patient_id,id) ON DELETE CASCADE,
 UNIQUE(document_id,revision),UNIQUE(document_id,request_id)
);
CREATE FUNCTION fmv.validate_medication_review_source() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE d RECORD; e RECORD; prev fmv.document_medication_reviews%ROWTYPE; item JSONB; text_value TEXT; last_page JSONB; owner_id UUID; ids TEXT[]; kept JSONB; removed JSONB;
BEGIN
 SELECT state,deleted_at,sha256,extraction_lifecycle INTO d FROM fmv.documents WHERE id=NEW.document_id AND patient_id=NEW.patient_id FOR NO KEY UPDATE;
 SELECT owner_account_id INTO owner_id FROM fmv.persons WHERE id=NEW.patient_id;
 IF NOT FOUND OR d.state IS DISTINCT FROM 'ready' OR d.deleted_at IS NOT NULL OR NEW.source_sha256 IS DISTINCT FROM d.sha256 OR NEW.lifecycle_version IS DISTINCT FROM d.extraction_lifecycle OR owner_id IS DISTINCT FROM NEW.actor_account_id THEN RAISE EXCEPTION 'Invalid medication review source' USING ERRCODE='23514'; END IF;
 IF NOT fmv.medication_set_valid(NEW.statements,NEW.withdrawn_statements,NEW.action) THEN RAISE EXCEPTION 'Invalid medication set' USING ERRCODE='23514'; END IF;
 SELECT * INTO prev FROM fmv.document_medication_reviews WHERE document_id=NEW.document_id ORDER BY revision DESC LIMIT 1;
 IF NEW.revision<>COALESCE(prev.revision,0)+1 THEN RAISE EXCEPTION 'Invalid medication review revision' USING ERRCODE='23514'; END IF;
 IF NEW.action='withdrawal' THEN
  IF prev.revision IS NULL OR NEW.source_revision IS DISTINCT FROM prev.source_revision OR NEW.source_sha256 IS DISTINCT FROM prev.source_sha256 OR NEW.source_context IS DISTINCT FROM prev.source_context THEN RAISE EXCEPTION 'Invalid medication withdrawal source' USING ERRCODE='23514'; END IF;
  SELECT array_agg(value->>'id') INTO ids FROM jsonb_array_elements(NEW.withdrawn_statements);
  SELECT COALESCE(jsonb_agg(value ORDER BY ordinal),'[]'::jsonb) INTO kept FROM jsonb_array_elements(prev.statements) WITH ORDINALITY p(value,ordinal) WHERE NOT (value->>'id'=ANY(ids));
  SELECT COALESCE(jsonb_agg(value ORDER BY ordinal),'[]'::jsonb) INTO removed FROM jsonb_array_elements(prev.statements) WITH ORDINALITY p(value,ordinal) WHERE value->>'id'=ANY(ids);
  IF NEW.statements IS DISTINCT FROM kept OR NEW.withdrawn_statements IS DISTINCT FROM removed THEN RAISE EXCEPTION 'Invalid medication withdrawal partition' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT revision,source_sha256,result INTO e FROM fmv.document_extractions WHERE document_id=NEW.document_id AND patient_id=NEW.patient_id;
  IF NOT FOUND OR e.revision IS DISTINCT FROM NEW.source_revision OR e.source_sha256 IS DISTINCT FROM NEW.source_sha256 OR NEW.source_context IS DISTINCT FROM (e.result-'pages') THEN RAISE EXCEPTION 'Invalid medication review extraction' USING ERRCODE='23514'; END IF;
  -- Same-source confirmation may append/reconfirm explicit blocks but never
  -- silently remove an existing attestation; removal is a withdrawal action.
  IF prev.source_revision=e.revision AND EXISTS(SELECT 1 FROM jsonb_array_elements(prev.statements) prior WHERE NOT NEW.statements @> jsonb_build_array(prior.value)) THEN RAISE EXCEPTION 'Invalid medication confirmation merge' USING ERRCODE='23514'; END IF;
  last_page:=(e.result->'pages')->-1;
  FOR item IN SELECT value FROM jsonb_array_elements(NEW.statements) LOOP
   SELECT page->>'text' INTO text_value FROM jsonb_array_elements(e.result->'pages') page WHERE page->'page'=item->'page';
   IF NOT FOUND OR NOT fmv.medication_statement_matches(item,text_value,(e.result->>'partialReason'='characters') IS TRUE AND item->'page'=last_page->'page') THEN RAISE EXCEPTION 'Invalid medication evidence' USING ERRCODE='23514'; END IF;
  END LOOP;
 END IF;
 NEW.confirmed_at:=clock_timestamp();RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION fmv.validate_medication_review_source() FROM PUBLIC;
CREATE TRIGGER medication_review_source_guard BEFORE INSERT ON fmv.document_medication_reviews FOR EACH ROW EXECUTE FUNCTION fmv.validate_medication_review_source();
ALTER TABLE fmv.document_medication_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.document_medication_reviews FORCE ROW LEVEL SECURITY;
REVOKE ALL ON fmv.document_medication_reviews FROM PUBLIC;
GRANT SELECT,INSERT ON fmv.document_medication_reviews TO fmv_app;
CREATE POLICY backend_medication_read ON fmv.document_medication_reviews FOR SELECT TO fmv_app USING(true);
CREATE POLICY backend_medication_insert ON fmv.document_medication_reviews FOR INSERT TO fmv_app WITH CHECK(true);
ALTER TABLE fmv.document_events DROP CONSTRAINT document_events_kind_check;
ALTER TABLE fmv.document_events ADD CONSTRAINT document_events_kind_check CHECK(kind IN ('document.uploaded','document.viewed','document.exported','document.renamed','document.trashed','document.restored','document.extraction_saved','document.metadata_saved','document.clinical_verified','document.clinical_withdrawn','document.diagnosis_confirmed','document.diagnosis_withdrawn','document.medication_confirmed','document.medication_withdrawn'));
COMMIT;
