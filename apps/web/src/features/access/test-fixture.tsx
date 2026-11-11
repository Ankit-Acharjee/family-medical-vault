// Loaded only by the access browser tests.
import { createRoot } from 'react-dom/client';
import { PatientPicker, PatientProvider } from '../patients';
import { FamilyAccessPanel } from './index';
export function mount() {
  document.body.innerHTML = '<div id="access-test-root"></div>';
  createRoot(document.getElementById('access-test-root')!).render(
    <PatientProvider sessionKey="fixture">
      <PatientPicker />
      <FamilyAccessPanel />
    </PatientProvider>,
  );
}
