import { useState } from 'react';
import { isTemporaryLinkActivity } from '@fmv/contracts';
import type { TemporaryLinkActivity } from '@fmv/contracts';
import { Button } from '../../components/ui/button';
import { useManualResource } from '../manual-readings/api';
export function OwnerLinkActivity({
  patientId,
  linkId,
  enabled,
  onDenied,
}: {
  patientId: string;
  linkId: string;
  enabled: boolean;
  onDenied: () => void;
}) {
  const [open, setOpen] = useState(false);
  const resource = useManualResource<TemporaryLinkActivity>(
    open && enabled
      ? `/api/patients/${encodeURIComponent(patientId)}/sharing-links/${encodeURIComponent(linkId)}/activity`
      : null,
    (v): v is TemporaryLinkActivity =>
      isTemporaryLinkActivity(v) &&
      v.patientId === patientId &&
      v.linkId === linkId,
    onDenied,
  );
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="min-h-11 cursor-pointer content-center rounded-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
        Recent access activity
      </summary>
      <div className="mt-2 space-y-2 text-xs text-muted-foreground">
        <p>
          Anonymous access events, not unique visitors or confirmed delivery to
          disk.
        </p>
        {!enabled ? (
          <p role="status">Checking access…</p>
        ) : resource.phase === 'failed' ? (
          <>
            <p role="alert">Activity could not be loaded.</p>
            <Button variant="outline" onClick={resource.reload}>
              Retry activity
            </Button>
          </>
        ) : !resource.value ? (
          <p role="status">Loading recent access…</p>
        ) : (
          <>
            <ul className="space-y-2">
              {resource.value.events.map((event) => (
                <li key={event.id}>
                  <time dateTime={event.recordedAt}>
                    {new Date(event.recordedAt).toLocaleString()}
                  </time>{' '}
                  ·{' '}
                  {event.kind === 'link.opened'
                    ? 'Link opened'
                    : `Original accessed (${event.documentId!.slice(-8)})`}
                </li>
              ))}
            </ul>
            {!resource.value.events.length && (
              <p>No recent access events are available.</p>
            )}
            {resource.value.limited && (
              <p>
                Showing the latest 20 retained events; older activity is
                omitted.
              </p>
            )}
          </>
        )}
      </div>
    </details>
  );
}
