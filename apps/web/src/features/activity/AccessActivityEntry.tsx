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
  const [open, setOpen] = useState(false),
    trigger = useRef<HTMLButtonElement>(null);
  return (
    <div className="my-4">
      <Button
        disabled={!enabled}
        variant="outline"
        onClick={(event) => {
          trigger.current = event.currentTarget;
          setOpen(true);
        }}
      >
        <History size={18} aria-hidden="true" />
        Document access history
      </Button>
      {open && (
        <AccessActivityDialog
          enabled={enabled}
          patientId={patientId}
          patientName={patientName}
          onClose={() => setOpen(false)}
          onRestoreFocus={() => {
            if (trigger.current?.isConnected) trigger.current.focus();
            else document.getElementById('main-content')?.focus();
          }}
        />
      )}
    </div>
  );
}
