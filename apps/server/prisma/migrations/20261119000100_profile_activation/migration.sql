BEGIN;
CREATE FUNCTION fmv.activation_creator_current(p uuid,a uuid) RETURNS boolean LANGUAGE sql VOLATILE SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM fmv.managed_profile_creations WHERE patient_id=p AND creator_account_id=a)
 AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['view','manage']::text[]) required(action) WHERE NOT EXISTS(SELECT 1 FROM fmv.access_grants g WHERE g.patient_id=p AND g.grantee_account_id=a AND g.scope_kind='patient' AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>clock_timestamp()) AND required.action=ANY(g.actions)))
$$;
REVOKE ALL ON FUNCTION fmv.activation_creator_current(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fmv.activation_creator_current(uuid,uuid) TO fmv_app;
CREATE TABLE fmv.profile_activations (
 id uuid PRIMARY KEY,
 patient_id uuid NOT NULL REFERENCES fmv.persons(id) ON DELETE RESTRICT,
 issuer_account_id uuid NOT NULL REFERENCES fmv.app_accounts(id),
 request_id uuid NOT NULL,payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[a-f0-9]{64}$'),
 token_sha256 text NOT NULL UNIQUE CHECK(token_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz(3) NOT NULL DEFAULT statement_timestamp(),
 expires_at timestamptz(3) NOT NULL,
 state text NOT NULL CHECK(state IN ('pending','claimed','accepted','revoked')),
 claimant_account_id uuid REFERENCES fmv.app_accounts(id),claimant_ref uuid,
 approved_request_id uuid,
 accepted_at timestamptz(3),revoked_at timestamptz(3),
 transition_account_id uuid NOT NULL REFERENCES fmv.app_accounts(id),
 transitioned_at timestamptz(3) NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(patient_id,request_id),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '7 days'),
 CHECK((claimant_account_id IS NULL)=(claimant_ref IS NULL)),
 CHECK(state NOT IN ('claimed','accepted') OR claimant_account_id IS NOT NULL),
 CHECK((state='accepted')=(accepted_at IS NOT NULL AND approved_request_id IS NOT NULL)),
 CHECK((state='revoked')=(revoked_at IS NOT NULL))
);
CREATE INDEX profile_activations_patient ON fmv.profile_activations(patient_id,created_at DESC,id);
CREATE TABLE fmv.profile_activation_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 activation_id uuid NOT NULL REFERENCES fmv.profile_activations(id) ON DELETE RESTRICT,
 patient_id uuid NOT NULL REFERENCES fmv.persons(id) ON DELETE RESTRICT,
 actor_account_id uuid NOT NULL REFERENCES fmv.app_accounts(id),
 kind text NOT NULL CHECK(kind IN ('activation.issued','activation.claimed','activation.accepted','activation.revoked')),
 recorded_at timestamptz(3) NOT NULL DEFAULT statement_timestamp()
);
ALTER TABLE fmv.profile_activation_events ADD CONSTRAINT profile_activation_event_once UNIQUE(activation_id,kind);
CREATE FUNCTION fmv.guard_profile_activation_event() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM fmv.profile_activations a WHERE a.id=NEW.activation_id AND a.patient_id=NEW.patient_id AND a.transition_account_id=NEW.actor_account_id AND NEW.kind=CASE a.state WHEN 'pending' THEN 'activation.issued' WHEN 'claimed' THEN 'activation.claimed' WHEN 'accepted' THEN 'activation.accepted' ELSE 'activation.revoked' END) THEN RAISE EXCEPTION 'Invalid activation audit' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION fmv.guard_profile_activation_event() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fmv.guard_profile_activation_event() TO fmv_app;
CREATE TRIGGER profile_activation_event_guard BEFORE INSERT ON fmv.profile_activation_events FOR EACH ROW EXECUTE FUNCTION fmv.guard_profile_activation_event();
CREATE FUNCTION fmv.guard_profile_activation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('access-patient:'||NEW.patient_id::text,0));
 IF NOT fmv.activation_creator_current(NEW.patient_id,NEW.issuer_account_id) THEN RAISE EXCEPTION 'Unavailable activation authority' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'pending' OR NEW.transition_account_id<>NEW.issuer_account_id OR NEW.claimant_account_id IS NOT NULL OR NEW.claimant_ref IS NOT NULL OR NEW.accepted_at IS NOT NULL OR NEW.approved_request_id IS NOT NULL OR NEW.revoked_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM fmv.persons WHERE id=NEW.patient_id AND owner_account_id IS NULL) OR EXISTS(SELECT 1 FROM fmv.profile_activations WHERE patient_id=NEW.patient_id AND state IN ('pending','claimed') AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Invalid activation issue' USING ERRCODE='23514'; END IF;
 ELSE
  IF ROW(NEW.id,NEW.patient_id,NEW.issuer_account_id,NEW.request_id,NEW.payload_sha256,NEW.token_sha256,NEW.created_at,NEW.expires_at) IS DISTINCT FROM ROW(OLD.id,OLD.patient_id,OLD.issuer_account_id,OLD.request_id,OLD.payload_sha256,OLD.token_sha256,OLD.created_at,OLD.expires_at) OR OLD.state IN ('accepted','revoked') THEN RAISE EXCEPTION 'Immutable activation' USING ERRCODE='23514'; END IF;
  IF NEW.state='claimed' AND OLD.state='pending' THEN
   IF NEW.expires_at<=clock_timestamp() OR NEW.claimant_account_id IS NULL OR NEW.claimant_ref IS NULL OR NEW.transition_account_id IS DISTINCT FROM NEW.claimant_account_id OR NEW.accepted_at IS NOT NULL OR NEW.approved_request_id IS NOT NULL OR NEW.revoked_at IS NOT NULL OR EXISTS(SELECT 1 FROM fmv.persons WHERE owner_account_id=NEW.claimant_account_id) OR NOT EXISTS(SELECT 1 FROM fmv.persons WHERE id=NEW.patient_id AND owner_account_id IS NULL) THEN RAISE EXCEPTION 'Invalid activation claim' USING ERRCODE='23514'; END IF;
  ELSIF NEW.state='revoked' AND OLD.state IN ('pending','claimed') THEN
   IF NEW.transition_account_id<>NEW.issuer_account_id OR ROW(NEW.claimant_account_id,NEW.claimant_ref,NEW.accepted_at,NEW.approved_request_id) IS DISTINCT FROM ROW(OLD.claimant_account_id,OLD.claimant_ref,OLD.accepted_at,OLD.approved_request_id) THEN RAISE EXCEPTION 'Invalid activation revocation' USING ERRCODE='23514'; END IF;
   NEW.revoked_at:=statement_timestamp();
  ELSIF NEW.state='accepted' AND OLD.state='claimed' THEN
   IF NEW.expires_at<=clock_timestamp() OR NEW.transition_account_id<>NEW.issuer_account_id OR NEW.accepted_at IS NULL OR NEW.approved_request_id IS NULL OR NEW.revoked_at IS NOT NULL OR ROW(NEW.claimant_account_id,NEW.claimant_ref) IS DISTINCT FROM ROW(OLD.claimant_account_id,OLD.claimant_ref) OR NOT EXISTS(SELECT 1 FROM fmv.persons WHERE id=NEW.patient_id AND owner_account_id=NEW.claimant_account_id) THEN RAISE EXCEPTION 'Invalid activation approval' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'Invalid activation transition' USING ERRCODE='23514'; END IF;
 END IF;
 NEW.transitioned_at:=statement_timestamp();RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION fmv.guard_profile_activation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fmv.guard_profile_activation() TO fmv_app;
CREATE TRIGGER profile_activation_guard BEFORE INSERT OR UPDATE ON fmv.profile_activations FOR EACH ROW EXECUTE FUNCTION fmv.guard_profile_activation();
CREATE FUNCTION fmv.audit_profile_activation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 INSERT INTO fmv.profile_activation_events(activation_id,patient_id,actor_account_id,kind) VALUES(NEW.id,NEW.patient_id,NEW.transition_account_id,CASE NEW.state WHEN 'pending' THEN 'activation.issued' WHEN 'claimed' THEN 'activation.claimed' WHEN 'accepted' THEN 'activation.accepted' ELSE 'activation.revoked' END);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION fmv.audit_profile_activation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fmv.audit_profile_activation() TO fmv_app;
CREATE TRIGGER profile_activation_audit AFTER INSERT OR UPDATE ON fmv.profile_activations FOR EACH ROW EXECUTE FUNCTION fmv.audit_profile_activation();
REVOKE ALL ON fmv.profile_activations,fmv.profile_activation_events FROM PUBLIC,fmv_app;
GRANT SELECT ON fmv.profile_activations,fmv.profile_activation_events TO fmv_app;
GRANT INSERT(id,patient_id,issuer_account_id,request_id,payload_sha256,token_sha256,expires_at,state,transition_account_id) ON fmv.profile_activations TO fmv_app;
GRANT UPDATE(state,claimant_account_id,claimant_ref,transition_account_id) ON fmv.profile_activations TO fmv_app;
GRANT INSERT(activation_id,patient_id,actor_account_id,kind) ON fmv.profile_activation_events TO fmv_app;
ALTER TABLE fmv.profile_activations ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.profile_activations FORCE ROW LEVEL SECURITY;
ALTER TABLE fmv.profile_activation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmv.profile_activation_events FORCE ROW LEVEL SECURITY;
CREATE POLICY backend_activation_read ON fmv.profile_activations FOR SELECT TO fmv_app USING(true);
CREATE POLICY backend_activation_insert ON fmv.profile_activations FOR INSERT TO fmv_app WITH CHECK(true);
CREATE POLICY backend_activation_update ON fmv.profile_activations FOR UPDATE TO fmv_app USING(true) WITH CHECK(true);
CREATE POLICY backend_activation_event_read ON fmv.profile_activation_events FOR SELECT TO fmv_app USING(true);
CREATE POLICY backend_activation_event_insert ON fmv.profile_activation_events FOR INSERT TO fmv_app WITH CHECK(true);
-- The only backend ownership transition. No raw owner UPDATE grant is introduced.
-- Fixed search_path, no dynamic SQL, exact stored claimant/creator/expiry checks.
CREATE FUNCTION fmv.approve_profile_activation(a uuid,actor uuid,claim_ref uuid,request uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item fmv.profile_activations%ROWTYPE;
BEGIN
 SELECT * INTO item FROM fmv.profile_activations WHERE id=a;
 IF NOT FOUND OR item.claimant_account_id IS NULL THEN RAISE EXCEPTION 'Unavailable activation' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('identity-account:'||item.claimant_account_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('access-patient:'||item.patient_id::text,0));
 SELECT * INTO item FROM fmv.profile_activations WHERE id=a FOR UPDATE;
 IF item.issuer_account_id<>actor OR item.claimant_ref IS DISTINCT FROM claim_ref OR NOT fmv.activation_creator_current(item.patient_id,actor) THEN RAISE EXCEPTION 'Unavailable activation authority' USING ERRCODE='23514'; END IF;
 IF item.state='accepted' AND item.approved_request_id=request AND EXISTS(SELECT 1 FROM fmv.persons WHERE id=item.patient_id AND owner_account_id=item.claimant_account_id) THEN RETURN item.patient_id; END IF;
 IF item.state<>'claimed' OR item.expires_at<=clock_timestamp() OR EXISTS(SELECT 1 FROM fmv.persons WHERE owner_account_id=item.claimant_account_id) THEN RAISE EXCEPTION 'Unavailable activation claim' USING ERRCODE='23514'; END IF;
 UPDATE fmv.persons SET owner_account_id=item.claimant_account_id WHERE id=item.patient_id AND owner_account_id IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unavailable managed identity' USING ERRCODE='23514'; END IF;
 UPDATE fmv.profile_activations SET state='accepted',accepted_at=statement_timestamp(),approved_request_id=request,transition_account_id=actor WHERE id=a;
 IF item.expires_at<=clock_timestamp() OR NOT fmv.activation_creator_current(item.patient_id,actor) THEN RAISE EXCEPTION 'Activation expired during approval' USING ERRCODE='23514'; END IF;
 RETURN item.patient_id;
END $$;
REVOKE ALL ON FUNCTION fmv.approve_profile_activation(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fmv.approve_profile_activation(uuid,uuid,uuid,uuid) TO fmv_app;
COMMIT;
