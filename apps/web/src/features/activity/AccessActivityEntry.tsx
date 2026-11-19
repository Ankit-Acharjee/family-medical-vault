import { useRef, useState } from 'react';
import { History } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { usePatientContext } from '../patients';
import { AccessActivityDialog } from './AccessActivityDialog';
export function AccessActivityEntry() {
  const { selectedPatient, loading } = usePatientContext();
  const [previous, setPrevious] = useState(selectedPatient);
  if (!loading && previous !== selectedPatient) setPrevious(selectedPatient);
  const patient = loading ? previous : selectedPatient;
  return patient?.relationship === 'self' ? (
    <Entry
      enabled={!loading}
      key={patient.id}
      patientId={patient.id}
      patientName={patient.displayName}
    />
  ) : null;
}
function Entry({
  patientId,
  patientName,
  enabled,
}: {
  enabled: boolean;
  patientId: string;
  patientName: string;
}) {
  const [open, setOpen] = useState<'ordinary' | 'security' | null>(null),
    trigger = useRef<HTMLButtonElement>(null);
  return (
    <div className="my-4 flex flex-wrap gap-3">
      <Button
        disabled={!enabled}
        variant="outline"
        onClick={(event) => {
          trigger.current = event.currentTarget;
          setOpen('ordinary');
        }}
      >
        <History size={18} aria-hidden="true" />
        Document access history
      </Button>
      <Button
        variant="outline"
        disabled={!enabled}
        onClick={(event) => {
          trigger.current = event.currentTarget;
          setOpen('security');
        }}
      >
        <History size={18} aria-hidden="true" />
        Grant and sharing activity
      </Button>
      {open && (
        <AccessActivityDialog
          security={open === 'security'}
          key={open}
          enabled={enabled}
          patientId={patientId}
          patientName={patientName}
          onClose={() => setOpen(null)}
          onRestoreFocus={() => {
            if (trigger.current?.isConnected) trigger.current.focus();
            else document.getElementById('main-content')?.focus();
          }}
        />
      )}
    </div>
  );
}
