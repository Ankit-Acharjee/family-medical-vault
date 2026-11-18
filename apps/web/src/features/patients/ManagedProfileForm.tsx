import { useEffect, useId, useRef, useState } from 'react';
import { UserPlus } from 'lucide-react';
import {
  isCreateManagedProfile,
  isCreatedManagedProfile,
} from '@fmv/contracts';
import type { CreateManagedProfile } from '@fmv/contracts';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { ManualApiError } from '../manual-readings/api';
import { sharingJson } from '../sharing/api';
export function ManagedProfileForm({
  enabled,
  onCreated,
}: {
  enabled: boolean;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false),
    [name, setName] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [notice, setNotice] = useState(''),
    [phase, setPhase] = useState<'idle' | 'pending' | 'uncertain' | 'denied'>(
      'idle',
    ),
    id = useId();
  const request = useRef<AbortController | null>(null),
    operation = useRef<CreateManagedProfile | null>(null),
    allowed = useRef(enabled),
    busy = useRef(false);
  allowed.current = enabled;
  useEffect(() => {
    if (!enabled) {
      setConfirmed(false);
      if (busy.current) {
        request.current?.abort();
        busy.current = false;
        setPhase('uncertain');
      }
    }
  }, [enabled]);
  useEffect(() => () => request.current?.abort(), []);
  async function create() {
    if (!allowed.current || busy.current || !confirmed) return;
    const body = operation.current ?? {
      requestId: crypto.randomUUID(),
      displayName: name.trim(),
      confirmed: true,
    };
    if (!isCreateManagedProfile(body)) {
      setNotice('Enter a name of 1–100 characters without control characters.');
      return;
    }
    operation.current = body;
    const abort = new AbortController();
    request.current = abort;
    busy.current = true;
    setPhase('pending');
    setNotice('');
    const timer = window.setTimeout(() => abort.abort(), 15000);
    try {
      const value = await sharingJson(
        '/api/patients/managed',
        body,
        abort.signal,
      );
      abort.signal.throwIfAborted();
      if (!allowed.current || request.current !== abort) return;
      if (
        !isCreatedManagedProfile(value) ||
        value.displayName !== body.displayName
      )
        throw Error();
      operation.current = null;
      setPhase('idle');
      setName('');
      setConfirmed(false);
      setOpen(false);
      setNotice(
        'Managed profile created. Select it from the patient list; no login account was created.',
      );
      onCreated();
    } catch (e) {
      if (request.current !== abort) return;
      if (e instanceof ManualApiError && [401, 403, 404].includes(e.status)) {
        operation.current = null;
        setName('');
        setConfirmed(false);
        setPhase('denied');
        setNotice('Profile creation is unavailable for this session.');
      } else if (e instanceof ManualApiError && e.status === 400) {
        operation.current = null;
        setPhase('idle');
        setNotice('Check the name and confirmation before trying again.');
      } else if (e instanceof ManualApiError && e.status === 409) {
        operation.current = null;
        setPhase('idle');
        setConfirmed(false);
        setNotice(
          'This request conflicts with an earlier creation. Review the profile list before starting again.',
        );
      } else {
        setPhase('uncertain');
        setNotice(
          'Creation may have completed. Retry the same request to avoid creating a duplicate.',
        );
      }
    } finally {
      window.clearTimeout(timer);
      if (request.current === abort) {
        request.current = null;
        busy.current = false;
      }
    }
  }
  const locked = phase === 'pending' || phase === 'uncertain';
  return (
    <div className="my-3 space-y-3 rounded-xl border border-border bg-muted/30 p-3">
      {notice && (
        <p
          role={
            phase === 'uncertain' || phase === 'denied' ? 'alert' : 'status'
          }
          className="text-sm"
        >
          {notice}
        </p>
      )}
      {!enabled ? (
        <p role="status" className="text-sm">
          Checking profile creation access…
        </p>
      ) : phase === 'denied' ? null : open ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <h3 className="font-medium">Create a managed patient profile</h3>
          <p className="text-sm text-muted-foreground">
            Keep a separate private Person for someone without an account. You
            receive caregiver permissions, not ownership. Owner-only clinical
            verification, emergency editing and external sharing remain
            unavailable until activation.
          </p>
          <label className="block text-sm font-medium" htmlFor={id}>
            Patient display name
          </label>
          <Input
            id={id}
            autoComplete="off"
            maxLength={100}
            required
            value={name}
            disabled={locked}
            onChange={(e) => {
              setName(e.target.value);
              setConfirmed(false);
            }}
          />
          <p className="text-xs text-muted-foreground">
            Names do not establish identity. Equal names may belong to different
            people; profiles are never merged automatically.
          </p>
          <label className="flex min-h-11 items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1 size-5 shrink-0 accent-primary"
              checked={confirmed}
              disabled={phase === 'pending'}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I intend to create a separate managed Person with explicit caregiver
            View, Upload, Edit, Export and Manage access, without credentials or
            ownership.
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              disabled={!confirmed || !name.trim() || phase === 'pending'}
            >
              {phase === 'pending'
                ? 'Creating managed profile…'
                : phase === 'uncertain'
                  ? 'Retry same creation'
                  : 'Create managed profile'}
            </Button>
            <Button
              variant="outline"
              disabled={locked}
              onClick={() => {
                setOpen(false);
                setName('');
                setConfirmed(false);
                setNotice('');
                operation.current = null;
              }}
            >
              Cancel managed creation
            </Button>
          </div>
        </form>
      ) : (
        <Button
          variant="outline"
          onClick={() => {
            setOpen(true);
            setNotice('');
          }}
        >
          <UserPlus aria-hidden="true" size={18} />
          Create managed profile
        </Button>
      )}
    </div>
  );
}
