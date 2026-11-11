// Imported only by the browser test harness.
import { createRoot } from 'react-dom/client';
import { PatientPicker, PatientProvider } from '../patients';
import { DocumentUploadForm, DocumentsPanel } from './index';
export function mount() {
  document.body.innerHTML = '<div id="documents-test-root"></div>';
  createRoot(document.getElementById('documents-test-root')!).render(
    <PatientProvider sessionKey="fixture">
      <PatientPicker />
      <DocumentsPanel />
      <DocumentUploadForm />
    </PatientProvider>,
  );
}
