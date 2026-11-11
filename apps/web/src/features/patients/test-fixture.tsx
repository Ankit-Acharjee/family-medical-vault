// Loaded only by the patient-context browser tests, never by the application.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PatientPicker, PatientProvider, usePatientContext } from './index';

function Content() {
  const { selectedPatient, reload } = usePatientContext();
  return (
    <>
      <p>Selected: {selectedPatient?.displayName ?? 'none'}</p>
      <button onClick={reload}>Refresh profiles</button>
      <PatientPicker />
    </>
  );
}
function Fixture() {
  const [session, setSession] = useState('session-a');
  return (
    <>
      <button onClick={() => setSession('session-b')}>Change session</button>
      <PatientProvider sessionKey={session}>
        <Content />
      </PatientProvider>
    </>
  );
}
export function mount() {
  document.body.innerHTML = '<div id="patient-test-root"></div>';
  createRoot(document.getElementById('patient-test-root')!).render(<Fixture />);
}
