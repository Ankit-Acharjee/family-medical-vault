import { useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { usePatientContext } from '../patients';
import { EmergencyProfileDialog } from './EmergencyProfileDialog';
export function EmergencyProfileEntry() {
  const { selectedPatient, loading } = usePatientContext();
  const [previous, setPrevious] = useState(selectedPatient);
  if (!loading && previous !== selectedPatient) setPrevious(selectedPatient);
  const patient = loading ? previous : selectedPatient;
  return patient ? (
    <PatientEntry
      key={patient.id}
      patientId={patient.id}
      patientName={patient.displayName}
      enabled={!loading}
    />
  ) : null;
}
function PatientEntry({
  patientId,
  patientName,
  enabled,
}: {
  patientId: string;
  patientName: string;
  enabled: boolean;
}) {
  const [open, setOpen] = useState(false),
    trigger = useRef<HTMLButtonElement | null>(null);
  return (
    <div className="my-4">
      <Button
        variant="outline"
        disabled={!enabled}
        onClick={(event) => {
          trigger.current = event.currentTarget;
          setOpen(true);
        }}
      >
        Private emergency profile
      </Button>
      {open && (
        <EmergencyProfileDialog
          patientId={patientId}
          patientName={patientName}
          enabled={enabled}
          onClose={() => setOpen(false)}
          onRestoreFocus={() => {
            if (trigger.current?.isConnected && !trigger.current.disabled)
              trigger.current.focus();
          }}
        />
      )}
    </div>
  );
}
