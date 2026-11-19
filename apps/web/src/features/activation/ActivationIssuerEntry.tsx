import { useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { usePatientContext } from '../patients';
import { ActivationIssuerDialog } from './ActivationIssuerDialog';
export function ActivationIssuerEntry() {
  const { selectedPatient, loading } = usePatientContext(),
    [previous, setPrevious] = useState(selectedPatient);
  if (!loading && previous !== selectedPatient) setPrevious(selectedPatient);
  const patient = loading ? previous : selectedPatient;
  return patient &&
    patient.relationship === 'caregiver' &&
    ['view', 'manage'].every((action) =>
      patient.capabilities.some(
        (c) => c.action === action && c.scope.kind === 'patient',
      ),
    ) ? (
    <Entry
      key={patient.id}
      patientId={patient.id}
      patientName={patient.displayName}
      enabled={!loading}
    />
  ) : null;
}
function Entry({
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
        Managed-profile activation
      </Button>
      {open && (
        <ActivationIssuerDialog
          patientId={patientId}
          patientName={patientName}
          enabled={enabled}
          onClose={() => setOpen(false)}
          onRestoreFocus={() => {
            if (trigger.current?.isConnected && !trigger.current.disabled)
              trigger.current.focus();
            else document.getElementById('main-content')?.focus();
          }}
        />
      )}
    </div>
  );
}
