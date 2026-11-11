import { useEffect, useRef, useState } from 'react';
import { permissionActions } from '@fmv/contracts';
import type {
  AccessLinkResult,
  AccessProposal,
  FamilyAccessResult,
  PermissionAction,
  PermissionScope,
} from '@fmv/contracts';
import { Button } from '../../components/ui/button';
import { usePatientContext } from '../patients';
import {
  captureIncomingLink,
  clearIncomingLink,
  getIncomingLink,
} from './incoming-link';

const patientPath = (id: string) =>
  `/api/patients/${encodeURIComponent(id)}/access`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tokenPattern = /^[A-Za-z0-9_-]{20,256}$/;
type Inspection = {
  kind: 'invitation' | 'request';
  actions: PermissionAction[];
  scope: PermissionScope;
  expiresAt: string;
  requesterName: string | null;
  requesterPersonId: string | null;
  token: string;
};
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
class RequestError extends Error {
  constructor(readonly status: number) {
    super('Access request failed');
  }
}
async function call(path: string, init: RequestInit = {}) {
  const result = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...init,
  });
  if (!result.ok) throw new RequestError(result.status);
  return result;
}
function errorText(e: unknown) {
  return e instanceof RequestError && [401, 403, 404].includes(e.status)
    ? 'This action is unavailable for your current access.'
    : 'The request could not be completed. Please try again.';
}
function scopeLabel(scope: PermissionScope) {
  return scope.kind === 'patient'
    ? 'Whole patient profile'
    : scope.kind === 'category'
      ? `Category ${scope.categoryId}`
      : `Document ${scope.documentId}`;
}
function validScope(value: unknown): value is PermissionScope {
  return (
    record(value) &&
    (value.kind === 'patient' ||
      (value.kind === 'category' &&
        typeof value.categoryId === 'string' &&
        uuid.test(value.categoryId)) ||
      (value.kind === 'document' &&
        typeof value.documentId === 'string' &&
        uuid.test(value.documentId)))
  );
}
function actions(value: unknown): value is PermissionAction[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (a: unknown) =>
        typeof a === 'string' &&
        permissionActions.includes(a as PermissionAction),
    )
  );
}
function validList(value: unknown): value is FamilyAccessResult {
  const common = (v: unknown): v is Record<string, unknown> =>
    record(v) &&
    typeof v.id === 'string' &&
    !!v.id &&
    actions(v.actions) &&
    validScope(v.scope);
  return (
    record(value) &&
    Array.isArray(value.grants) &&
    Array.isArray(value.invitations) &&
    value.grants.every(
      (v: unknown) =>
        common(v) &&
        (v.expiresAt === null || typeof v.expiresAt === 'string') &&
        (v.revokedAt === null || typeof v.revokedAt === 'string'),
    ) &&
    value.invitations.every(
      (v: unknown) =>
        common(v) &&
        typeof v.expiresAt === 'string' &&
        ['pending', 'claimed', 'accepted', 'revoked'].includes(
          String(v.state),
        ) &&
        (v.recipientName === null || typeof v.recipientName === 'string'),
    )
  );
}
export function FamilyAccessPanel() {
  const { selectedPatient } = usePatientContext();
  return <FamilyAccessContent key={selectedPatient?.id ?? 'no-patient'} />;
}

function FamilyAccessContent() {
  const { selectedPatient } = usePatientContext();
  const patientId = selectedPatient?.id ?? null;
  const canManage = !!selectedPatient?.capabilities.some(
    (c) => c.action === 'manage',
  );
  const [initialLink] = useState(getIncomingLink);
  const [inviteCode, setInviteCode] = useState(() =>
    initialLink?.kind === 'invite' ? initialLink.token : '',
  );
  const [requestCode, setRequestCode] = useState(() =>
    initialLink?.kind === 'request' ? initialLink.token : '',
  );
  const [list, setList] = useState<{
    id: string;
    value: FamilyAccessResult;
  } | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [chosen, setChosen] = useState<PermissionAction[]>([]);
  const [kind, setKind] = useState<'patient' | 'category' | 'document'>(
    'patient',
  );
  const [scopeId, setScopeId] = useState('');
  const [hours, setHours] = useState('24');
  const [link, setLink] = useState<{
    kind: 'invite' | 'request';
    value: AccessLinkResult;
  } | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef(patientId);
  active.current = patientId;
  const action = useRef<AbortController | null>(null);
  const submitting = useRef(false);
  const prior = useRef(patientId);
  useEffect(() => {
    clearIncomingLink();
    const receive = () => {
      const incoming = captureIncomingLink() ?? getIncomingLink();
      if (!incoming) return;
      setInspection(null);
      setInviteCode(incoming.kind === 'invite' ? incoming.token : '');
      setRequestCode(incoming.kind === 'request' ? incoming.token : '');
      clearIncomingLink();
    };
    window.addEventListener('hashchange', receive);
    return () => window.removeEventListener('hashchange', receive);
  }, []);
  useEffect(() => {
    if (prior.current !== patientId) {
      prior.current = patientId;
      action.current?.abort();
      submitting.current = false;
      setBusy(false);
      setLink(null);
      setStatus('');
      setError('');
      setInviteCode('');
      setRequestCode('');
    }
    setList(null);
    setLoadError('');
    if (!patientId || !canManage) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    void call(patientPath(patientId), { signal: controller.signal })
      .then((r) => r.json() as Promise<unknown>)
      .then((value) => {
        if (!validList(value)) throw new Error();
        if (!controller.signal.aborted && active.current === patientId)
          setList({ id: patientId, value });
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted && active.current === patientId)
          setLoadError(errorText(e));
      })
      .finally(() => {
        if (!controller.signal.aborted && active.current === patientId)
          setLoading(false);
      });
    return () => controller.abort();
  }, [patientId, canManage, revision]);
  useEffect(
    () => () => {
      action.current?.abort();
    },
    [],
  );
  async function post(
    path: string,
    body: unknown,
    done: (value: unknown) => void,
  ) {
    if (submitting.current) return;
    submitting.current = true;
    const context = patientId;
    const controller = new AbortController();
    action.current?.abort();
    action.current = controller;
    setBusy(true);
    setError('');
    setStatus('');
    setLink(null);
    try {
      const bootstrap: unknown = await (
        await call('/api/auth/bootstrap', { signal: controller.signal })
      ).json();
      if (
        !record(bootstrap) ||
        bootstrap.enabled !== true ||
        typeof bootstrap.csrf !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(bootstrap.csrf)
      )
        throw new Error();
      if (controller.signal.aborted || active.current !== context) return;
      const response = await call(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': bootstrap.csrf,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const value: unknown = await response.json();
      if (!controller.signal.aborted && active.current === context) done(value);
    } catch (e) {
      if (!controller.signal.aborted && active.current === context)
        setError(errorText(e));
    } finally {
      if (!controller.signal.aborted && active.current === context) {
        submitting.current = false;
        setBusy(false);
      }
    }
  }
  function proposal(): AccessProposal | null {
    const expiry = Number(hours);
    if (
      !chosen.length ||
      !Number.isInteger(expiry) ||
      expiry < 1 ||
      expiry > 168 ||
      (kind !== 'patient' && !uuid.test(scopeId))
    ) {
      setError(
        'Choose at least one right, a valid scope and an expiry from 1 to 168 hours.',
      );
      return null;
    }
    const scope: PermissionScope =
      kind === 'patient'
        ? { kind }
        : kind === 'category'
          ? { kind, categoryId: scopeId }
          : { kind, documentId: scopeId };
    return { actions: chosen, scope, expiresInHours: expiry };
  }
  function createLink(type: 'invite' | 'request') {
    const input = proposal();
    if (!input || (type === 'invite' && (!patientId || !canManage))) return;
    const path =
      type === 'invite'
        ? `${patientPath(patientId!)}/invitations`
        : '/api/access/requests';
    void post(path, input, (value) => {
      if (
        !record(value) ||
        typeof value.id !== 'string' ||
        typeof value.token !== 'string' ||
        !tokenPattern.test(value.token) ||
        typeof value.expiresAt !== 'string'
      )
        throw new Error();
      setLink({ kind: type, value: value as AccessLinkResult });
      setRevision((n) => n + 1);
    });
  }
  function inspect(code: string, expected: 'invitation' | 'request') {
    setInspection(null);
    void post('/api/access/inspect', { token: code }, (value) => {
      if (
        !record(value) ||
        value.kind !== expected ||
        !actions(value.actions) ||
        !validScope(value.scope) ||
        typeof value.expiresAt !== 'string' ||
        Number.isNaN(Date.parse(value.expiresAt)) ||
        (value.requesterName !== null &&
          typeof value.requesterName !== 'string') ||
        (value.requesterPersonId !== null &&
          (typeof value.requesterPersonId !== 'string' ||
            !uuid.test(value.requesterPersonId)))
      )
        throw new Error();
      setInspection({
        kind: expected,
        actions: value.actions,
        scope: value.scope,
        expiresAt: value.expiresAt,
        requesterName: value.requesterName,
        requesterPersonId: value.requesterPersonId,
        token: code,
      });
    });
  }
  const refresh = () => setRevision((n) => n + 1);
  return (
    <section aria-label="Family access">
      <p>
        {selectedPatient
          ? `Patient: ${selectedPatient.displayName}`
          : 'Select a patient to manage their access.'}
      </p>
      <p>
        Opening a link does not grant access. A patient or authorized manager
        must explicitly approve it.
      </p>
      {!selectedPatient && requestCode && (
        <p>
          Select the patient, then reopen the original request link to review
          it.
        </p>
      )}
      <label htmlFor="invite-code">Invitation code</label>
      <input
        id="invite-code"
        value={inviteCode}
        onChange={(e) => {
          setInviteCode(e.target.value);
          setInspection(null);
        }}
        autoComplete="off"
      />
      <Button
        disabled={busy || !tokenPattern.test(inviteCode)}
        onClick={() => inspect(inviteCode, 'invitation')}
      >
        Review invitation
      </Button>
      <Button
        disabled={
          busy ||
          inspection?.kind !== 'invitation' ||
          inspection.token !== inviteCode
        }
        onClick={() =>
          void post('/api/access/claim', { token: inviteCode }, (value) => {
            if (
              !record(value) ||
              typeof value.id !== 'string' ||
              value.state !== 'claimed'
            )
              throw new Error();
            setInviteCode('');
            setInspection(null);
            setStatus('Invitation claimed. Access requires manager approval.');
          })
        }
      >
        Claim invitation
      </Button>
      {canManage && patientId && (
        <>
          <label htmlFor="request-code">Caregiver request code</label>
          <input
            id="request-code"
            value={requestCode}
            onChange={(e) => {
              setRequestCode(e.target.value);
              setInspection(null);
            }}
            autoComplete="off"
          />
          <Button
            disabled={busy || !tokenPattern.test(requestCode)}
            onClick={() => inspect(requestCode, 'request')}
          >
            Review request
          </Button>
          <Button
            disabled={
              busy ||
              inspection?.kind !== 'request' ||
              inspection.token !== requestCode ||
              !inspection.requesterPersonId
            }
            onClick={() =>
              void post(
                `${patientPath(patientId)}/requests/approve`,
                { token: requestCode },
                () => {
                  setRequestCode('');
                  setInspection(null);
                  setStatus('Request approved.');
                  refresh();
                },
              )
            }
          >
            Approve request
          </Button>
        </>
      )}
      {inspection && (
        <div>
          <p>
            Review {inspection.kind}:{' '}
            {inspection.requesterName ?? 'Name unavailable'}; Person ID:{' '}
            {inspection.requesterPersonId ?? 'unavailable'}; rights:{' '}
            {inspection.actions.join(', ')}; scope:{' '}
            {scopeLabel(inspection.scope)}; expires {inspection.expiresAt}.
          </p>
          <p>
            Names are not verified legal identity. Confirm the person and Person
            ID with them through another channel before approval.
          </p>
        </div>
      )}
      <fieldset disabled={busy}>
        <legend>Proposed rights</legend>
        {permissionActions.map((a) => (
          <label key={a}>
            <input
              type="checkbox"
              checked={chosen.includes(a)}
              onChange={(e) =>
                setChosen((old) =>
                  e.target.checked ? [...old, a] : old.filter((v) => v !== a),
                )
              }
            />{' '}
            {a}
          </label>
        ))}
        <label htmlFor="access-scope">Scope</label>
        <select
          id="access-scope"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as typeof kind);
            setScopeId('');
          }}
        >
          <option value="patient">Whole patient</option>
          <option value="category">Category</option>
          <option value="document">Document</option>
        </select>
        {kind !== 'patient' && (
          <>
            <label htmlFor="scope-id">
              {kind === 'category' ? 'Category ID' : 'Document ID'}
            </label>
            <input
              id="scope-id"
              value={scopeId}
              onChange={(e) => setScopeId(e.target.value)}
            />
          </>
        )}
        <label htmlFor="expiry-hours">Expires after hours (1–168)</label>
        <input
          id="expiry-hours"
          type="number"
          min="1"
          max="168"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
        />
        <p>
          Rights: {chosen.length ? chosen.join(', ') : 'none selected'}. Scope:{' '}
          {kind === 'patient'
            ? 'whole patient'
            : `${kind} ${scopeId || '(ID required)'}`}
          . Expires after {hours} hours.
        </p>
        <Button onClick={() => createLink('request')}>
          Create caregiver request
        </Button>
        {canManage && patientId && (
          <Button onClick={() => createLink('invite')}>
            Create invitation
          </Button>
        )}
      </fieldset>
      {link && (
        <div>
          <p>
            Link expires at {link.value.expiresAt}. Share it only with the
            intended person.
          </p>
          <label htmlFor="access-link">Secure {link.kind} link</label>
          <input
            id="access-link"
            readOnly
            value={`${window.location.origin}${window.location.pathname}#family-access?${link.kind}=${encodeURIComponent(link.value.token)}`}
          />
          <Button
            onClick={() => {
              void navigator.clipboard
                .writeText(
                  `${window.location.origin}${window.location.pathname}#family-access?${link.kind}=${encodeURIComponent(link.value.token)}`,
                )
                .then(() => setStatus('Link copied.'))
                .catch(() => setError('Copy the link from the field.'));
            }}
          >
            Copy link
          </Button>
        </div>
      )}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
      {canManage && patientId && (
        <>
          <h2>Patient access</h2>
          {loading && <p role="status">Loading access…</p>}
          {loadError && (
            <div role="alert">
              <p>{loadError}</p>
              <Button onClick={refresh}>Try again</Button>
            </div>
          )}
          {list?.id === patientId && (
            <>
              <p>
                Names are not verified legal identity. Confirm the person and
                Person ID with them through another channel before approval.
              </p>
              <h3>Invitations</h3>
              {list.value.invitations.length ? (
                <ul>
                  {list.value.invitations.map((invitation) => {
                    const personId =
                      'recipientPersonId' in invitation &&
                      typeof invitation.recipientPersonId === 'string' &&
                      uuid.test(invitation.recipientPersonId)
                        ? invitation.recipientPersonId
                        : null;
                    return (
                      <li key={invitation.id}>
                        {invitation.state}:{' '}
                        {invitation.recipientName ?? 'No recipient yet'}; Person
                        ID: {personId ?? 'unavailable'};{' '}
                        {invitation.actions.join(', ')};{' '}
                        {scopeLabel(invitation.scope)}; expires{' '}
                        {invitation.expiresAt}.{' '}
                        {invitation.state === 'claimed' && (
                          <Button
                            disabled={busy || !personId}
                            onClick={() =>
                              void post(
                                `${patientPath(patientId)}/invitations/${encodeURIComponent(invitation.id)}/approve`,
                                {},
                                () => {
                                  setStatus('Invitation approved.');
                                  refresh();
                                },
                              )
                            }
                          >
                            Approve invitation
                          </Button>
                        )}{' '}
                        {(invitation.state === 'pending' ||
                          invitation.state === 'claimed') && (
                          <Button
                            disabled={busy}
                            onClick={() =>
                              void post(
                                `${patientPath(patientId)}/invitations/${encodeURIComponent(invitation.id)}/revoke`,
                                {},
                                () => {
                                  setStatus('Invitation revoked.');
                                  refresh();
                                },
                              )
                            }
                          >
                            Revoke invitation
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p>No invitations.</p>
              )}
              <h3>Grants</h3>
              {list.value.grants.length ? (
                <ul>
                  {list.value.grants.map((grant) => (
                    <li key={grant.id}>
                      {'recipientName' in grant &&
                      typeof grant.recipientName === 'string'
                        ? grant.recipientName
                        : `Grant ${grant.id}`}
                      ; Person ID:{' '}
                      {'recipientPersonId' in grant &&
                      typeof grant.recipientPersonId === 'string'
                        ? grant.recipientPersonId
                        : 'unavailable'}
                      ; {grant.actions.join(', ')}; {scopeLabel(grant.scope)};{' '}
                      {grant.expiresAt
                        ? `expires ${grant.expiresAt}`
                        : 'no expiry'}
                      ; {grant.revokedAt ? 'revoked' : 'not revoked'}.{' '}
                      {!grant.revokedAt && (
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void post(
                              `${patientPath(patientId)}/grants/${encodeURIComponent(grant.id)}/revoke`,
                              {},
                              () => {
                                setStatus('Grant revoked.');
                                refresh();
                              },
                            )
                          }
                        >
                          Revoke grant
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No grants.</p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
