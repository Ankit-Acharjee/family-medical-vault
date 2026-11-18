import { useEffect, useRef, useState } from 'react';
import { isMedicationScheduleHistory } from '@fmv/contracts';
import { manualJson } from '../../manual-readings/api';
import { PageReminderSession } from './session';
import type { ReminderItem } from './session';
export function usePageReminders(patientId: string, owner: boolean | null) {
  const [items, setItems] = useState<ReminderItem[]>([]);
  const [session] = useState(
    () =>
      new PageReminderSession({
        now: () => Date.now(),
        publish: setItems,
        load: async (id, signal) => {
          const abort = new AbortController();
          const cancel = () => abort.abort();
          signal.addEventListener('abort', cancel, { once: true });
          const timer = window.setTimeout(cancel, 15000);
          try {
            signal.throwIfAborted();
            const value = await manualJson(
              `/api/patients/${encodeURIComponent(patientId)}/medication-reconciliations/${encodeURIComponent(id)}/schedule`,
              abort.signal,
            );
            if (
              !isMedicationScheduleHistory(value) ||
              value.patientId !== patientId ||
              value.medicationId !== id
            )
              throw Error();
            return value;
          } finally {
            window.clearTimeout(timer);
            signal.removeEventListener('abort', cancel);
          }
        },
        yield: (signal) =>
          new Promise<void>((resolve, reject) => {
            const cancel = () => {
              window.clearTimeout(timer);
              reject(new Error('Cancelled'));
            };
            const timer = window.setTimeout(() => {
              signal.removeEventListener('abort', cancel);
              resolve();
            }, 0);
            if (signal.aborted) cancel();
            else signal.addEventListener('abort', cancel, { once: true });
          }),
      }),
  );
  const authority = useRef(owner);
  authority.current = owner;
  useEffect(() => {
    const sync = () =>
      session.setActive(
        authority.current === true && document.visibilityState === 'visible',
      );
    const leave = () => session.clear();
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('pagehide', leave);
    window.addEventListener('pageshow', sync);
    const timer = window.setInterval(() => {
      void session.tick();
    }, 10000);
    sync();
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('pageshow', sync);
      session.clear();
    };
  }, [session]);
  useEffect(() => {
    if (owner === false) session.clear();
    session.setActive(owner === true && document.visibilityState === 'visible');
  }, [owner, session]);
  return { items, session };
}
