import { useEffect, useRef, useState } from 'react';
import { Download, LockKeyhole, Moon, Sun } from 'lucide-react';
import { isTemporaryRecipientSelection } from '@fmv/contracts';
import type { TemporaryRecipientSelection } from '@fmv/contracts';
import { Button } from '../../components/ui/button';
import { useTheme } from '../../hooks/use-theme';
import { ManualApiError } from '../manual-readings/api';
import { readOriginalPreview } from '../documents/originalPreview';
import { sharingJson, sharingRequest } from './api';
export function RecipientView({
  token,
  onExit,
}: {
  token: string | null;
  onExit: () => void;
}) {
  const { theme, toggleTheme } = useTheme(),
    [value, setValue] = useState<TemporaryRecipientSelection | null>(null),
    [phase, setPhase] = useState<
      'idle' | 'loading' | 'ready' | 'failed' | 'denied'
    >('idle'),
    [notice, setNotice] = useState(''),
    [downloading, setDownloading] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null),
    opened = useRef(false),
    sequence = useRef(0);
  const clear = () => {
    controller.current?.abort();
    controller.current = null;
    sequence.current++;
    setValue(null);
    setDownloading(null);
    setNotice('');
  };
  useEffect(
    () => () => {
      controller.current?.abort();
      controller.current = null;
      sequence.current++;
    },
    [],
  );
  async function open() {
    if (!token) return;
    clear();
    opened.current = true;
    setPhase('loading');
    const abort = new AbortController(),
      version = sequence.current;
    controller.current = abort;
    const timer = window.setTimeout(() => abort.abort(), 15000);
    try {
      const next = await sharingJson(
        '/api/sharing/open',
        { token },
        abort.signal,
      );
      abort.signal.throwIfAborted();
      if (sequence.current !== version) return;
      if (!isTemporaryRecipientSelection(next)) throw Error();
      if (Date.parse(next.expiresAt) <= Date.now()) {
        setPhase('denied');
        return;
      }
      setValue(next);
      setPhase('ready');
    } catch (error) {
      if (sequence.current !== version) return;
      setValue(null);
      setPhase(
        error instanceof ManualApiError &&
          [400, 401, 403, 404].includes(error.status)
          ? 'denied'
          : 'failed',
      );
    } finally {
      window.clearTimeout(timer);
      if (controller.current === abort) controller.current = null;
    }
  }
  async function download(
    file: TemporaryRecipientSelection['selection']['files'][number],
  ) {
    if (!token || !value || controller.current) return;
    setNotice('');
    setDownloading(file.id);
    const abort = new AbortController(),
      version = sequence.current;
    controller.current = abort;
    const timer = window.setTimeout(() => abort.abort(), 50000);
    try {
      const response = await sharingRequest(
          '/api/sharing/original',
          { token, documentId: file.id },
          abort.signal,
        ),
        blob = await readOriginalPreview(
          response,
          { bytes: file.bytes, mime: file.mimeType, sha256: file.sha256 },
          abort.signal,
        );
      abort.signal.throwIfAborted();
      if (sequence.current !== version) return;
      const url = URL.createObjectURL(blob),
        link = document.createElement('a'),
        extension = {
          'application/pdf': 'pdf',
          'image/jpeg': 'jpg',
          'image/png': 'png',
          'image/webp': 'webp',
        }[file.mimeType];
      link.href = url;
      link.download = `shared-original.${extension}`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      setNotice(
        'Download started. Check your browser’s downloads; copies cannot be recalled.',
      );
    } catch (error) {
      if (sequence.current !== version) return;
      if (
        error instanceof ManualApiError &&
        [400, 401, 403, 404].includes(error.status)
      ) {
        clear();
        setPhase('denied');
      } else
        setNotice(
          'The original could not be downloaded. No unverified bytes were delivered. Try again.',
        );
    } finally {
      window.clearTimeout(timer);
      if (controller.current === abort) {
        controller.current = null;
        setDownloading(null);
      }
    }
  }
  useEffect(() => {
    const refresh = () => {
        if (opened.current) void open();
      },
      hide = () => {
        if (document.visibilityState === 'hidden') {
          controller.current?.abort();
          controller.current = null;
          sequence.current++;
          setValue(null);
          setDownloading(null);
          setPhase('idle');
        } else refresh();
      };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', hide);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', hide);
    };
  });
  useEffect(() => {
    if (!value) return;
    const timer = window.setInterval(() => {
      if (Date.now() >= Date.parse(value.expiresAt)) {
        clear();
        setPhase('denied');
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [value]);
  return (
    <main className="min-h-dvh bg-background px-4 py-8 text-foreground">
      <section
        className="mx-auto max-w-2xl space-y-5 rounded-2xl border border-border bg-card p-5 sm:p-8"
        aria-labelledby="shared-title"
      >
        <header className="flex items-center justify-between gap-4">
          <p className="text-sm font-medium text-muted-foreground">
            Family Medical Vault
          </p>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`}
            onClick={toggleTheme}
          >
            {theme === 'dark' ? (
              <Sun aria-hidden="true" />
            ) : (
              <Moon aria-hidden="true" />
            )}
          </Button>
        </header>
        <div className="space-y-2">
          <LockKeyhole className="text-primary" size={24} aria-hidden="true" />
          <h1
            id="shared-title"
            className="text-2xl font-semibold tracking-tight"
          >
            Shared original documents
          </h1>
          <p className="text-sm text-muted-foreground">
            Private access to a limited selection, not the patient’s full vault.
            Anyone holding the secret link can use it until it expires or is
            revoked.
          </p>
        </div>
        {!token || phase === 'denied' ? (
          <p role="alert">
            This link is unavailable, expired, revoked or no longer matches its
            sources. Ask the owner for a new link. If you reloaded this page,
            reopen the original secret link.
          </p>
        ) : phase === 'loading' ? (
          <p role="status">Checking current shared access…</p>
        ) : phase === 'failed' ? (
          <div className="space-y-3">
            <p role="alert">
              Shared access could not be checked. No records are displayed.
            </p>
            <Button onClick={() => void open()}>Try shared access again</Button>
          </div>
        ) : value && phase === 'ready' ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm">
              <p className="font-medium">
                Patient: {value.selection.patientName}
              </p>
              <p className="mt-1 text-muted-foreground">
                Expires {new Date(value.expiresAt).toLocaleString()}. Downloaded
                copies cannot be revoked.
              </p>
            </div>
            <ul className="space-y-3">
              {value.selection.files.map((file) => (
                <li
                  key={file.id}
                  className="min-w-0 space-y-2 rounded-xl border border-border p-4"
                >
                  <p className="break-words font-medium">{file.title}</p>
                  <p className="text-xs text-muted-foreground">
                    Original file ·{' '}
                    {file.bytes < 1024
                      ? `${file.bytes} B`
                      : `${(file.bytes / 1048576).toFixed(2)} MiB`}
                  </p>
                  <Button
                    variant="outline"
                    disabled={downloading !== null}
                    onClick={() => void download(file)}
                  >
                    <Download size={16} aria-hidden="true" />
                    {downloading === file.id
                      ? 'Checking original…'
                      : 'Download original'}
                  </Button>
                </li>
              ))}
            </ul>
            {notice && (
              <p role="status" className="text-sm">
                {notice}
              </p>
            )}
          </div>
        ) : (
          <Button onClick={() => void open()}>Open shared originals</Button>
        )}
        <Button
          variant="ghost"
          onClick={() => {
            clear();
            onExit();
          }}
        >
          Close shared view
        </Button>
      </section>
    </main>
  );
}
