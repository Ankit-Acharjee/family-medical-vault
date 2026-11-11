import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type { PatientSummary, PatientsResult } from '@fmv/contracts';
import { Button } from '../../components/ui/button';

type PatientError = 'denied' | 'unavailable';
type State = {
  session: string;
  patients: PatientSummary[];
  selectedId: string | null;
  loading: boolean;
  error: PatientError | null;
};
type PatientContextValue = {
  patients: PatientSummary[];
  selectedPatient: PatientSummary | null;
  loading: boolean;
  error: PatientError | null;
  selectPatient: (id: string) => void;
  clearSelection: () => void;
  reload: () => void;
};
const PatientContext = createContext<PatientContextValue | null>(null);
const empty = (session: string): State => ({
  session,
  patients: [],
  selectedId: null,
  loading: true,
  error: null,
});
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 128;

function validResult(value: unknown): value is PatientsResult {
  if (!record(value) || !Array.isArray(value.patients)) return false;
  const ids = new Set<string>();
  return value.patients.every((patient: unknown) => {
    if (
      !record(patient) ||
      !identifier(patient.id) ||
      ids.has(patient.id) ||
      typeof patient.displayName !== 'string' ||
      !patient.displayName.trim() ||
      patient.displayName.length > 100 ||
      (patient.relationship !== 'self' &&
        patient.relationship !== 'caregiver') ||
      !Array.isArray(patient.capabilities)
    )
      return false;
    ids.add(patient.id);
    return patient.capabilities.every((capability: unknown) => {
      if (
        !record(capability) ||
        typeof capability.action !== 'string' ||
        !['view', 'upload', 'edit', 'export', 'manage'].includes(
          capability.action,
        ) ||
        !record(capability.scope)
      )
        return false;
      const scope = capability.scope;
      return (
        scope.kind === 'patient' ||
        (scope.kind === 'category' && identifier(scope.categoryId)) ||
        (scope.kind === 'document' && identifier(scope.documentId))
      );
    });
  });
}

export function PatientProvider({
  sessionKey,
  children,
}: {
  sessionKey: string;
  children: ReactNode;
}) {
  const [state, setState] = useState<State>(() => empty(sessionKey));
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const currentSession = useRef(sessionKey);
  currentSession.current = sessionKey;
  const reload = useCallback(() => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const version = ++generation.current;
    setState((previous) =>
      previous.session === sessionKey
        ? { ...previous, loading: true, error: null }
        : empty(sessionKey),
    );
    void (async () => {
      try {
        const response = await fetch('/api/patients', {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: request.signal,
        });
        if (!response.ok)
          throw new Error(
            response.status === 401 || response.status === 403
              ? 'denied'
              : 'unavailable',
          );
        const result: unknown = await response.json();
        if (!validResult(result)) throw new Error('unavailable');
        if (
          request.signal.aborted ||
          generation.current !== version ||
          currentSession.current !== sessionKey
        )
          return;
        setState((previous) => ({
          session: sessionKey,
          patients: result.patients,
          selectedId:
            previous.session === sessionKey &&
            result.patients.some(({ id }) => id === previous.selectedId)
              ? previous.selectedId
              : null,
          loading: false,
          error: null,
        }));
      } catch (error) {
        if (
          request.signal.aborted ||
          generation.current !== version ||
          currentSession.current !== sessionKey
        )
          return;
        setState({
          session: sessionKey,
          patients: [],
          selectedId: null,
          loading: false,
          error:
            error instanceof Error && error.message === 'denied'
              ? 'denied'
              : 'unavailable',
        });
      }
    })();
  }, [sessionKey]);
  useEffect(() => {
    reload();
    const refresh = () => {
      if (document.visibilityState === 'visible') reload();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      ++generation.current;
      controller.current?.abort();
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [reload]);
  const visible = state.session === sessionKey ? state : empty(sessionKey);
  const selectPatient = useCallback(
    (id: string) => {
      setState((previous) =>
        previous.session === sessionKey &&
        !previous.loading &&
        !previous.error &&
        previous.patients.some((patient) => patient.id === id)
          ? { ...previous, selectedId: id }
          : previous,
      );
    },
    [sessionKey],
  );
  const clearSelection = useCallback(() => {
    setState((previous) =>
      previous.session === sessionKey
        ? { ...previous, selectedId: null }
        : previous,
    );
  }, [sessionKey]);
  return (
    <PatientContext.Provider
      value={{
        patients: visible.loading ? [] : visible.patients,
        selectedPatient: visible.loading
          ? null
          : (visible.patients.find(({ id }) => id === visible.selectedId) ??
            null),
        loading: visible.loading,
        error: visible.error,
        selectPatient,
        clearSelection,
        reload,
      }}
    >
      {children}
    </PatientContext.Provider>
  );
}

export function usePatientContext(): PatientContextValue {
  const context = useContext(PatientContext);
  if (!context)
    throw new Error('usePatientContext must be used within PatientProvider');
  return context;
}

export function PatientPicker({ onSelected }: { onSelected?: () => void }) {
  const { patients, selectedPatient, loading, error, selectPatient, reload } =
    usePatientContext();
  if (loading) return <p role="status">Loading patient profiles…</p>;
  if (error)
    return (
      <div role="alert">
        <p>
          {error === 'denied'
            ? 'Patient profiles are unavailable for this session.'
            : 'Patient profiles could not be loaded.'}
        </p>
        <Button onClick={reload}>Try again</Button>
      </div>
    );
  if (!patients.length)
    return (
      <div>
        <p>No patient profiles are available.</p>
        <Button asChild variant="outline">
          <a href="#account">Your account</a>
        </Button>
      </div>
    );
  return (
    <ul aria-label="Available patient profiles">
      {patients.map((patient) => (
        <li key={patient.id}>
          <Button
            variant="ghost"
            aria-pressed={selectedPatient?.id === patient.id}
            onClick={() => {
              selectPatient(patient.id);
              onSelected?.();
            }}
          >
            {patient.displayName}{' '}
            <span>
              (
              {patient.relationship === 'self'
                ? 'Your profile'
                : 'Caregiver access'}
              )
            </span>
          </Button>
        </li>
      ))}
    </ul>
  );
}
