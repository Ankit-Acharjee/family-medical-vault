import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { SharingRoot } from './features/sharing/SharingRoot';
import { AuthRoot } from './features/auth/AuthRoot';

const root = document.getElementById('root');
if (!root) throw new Error('Application root is unavailable');

createRoot(root).render(
  <StrictMode>
    <SharingRoot>
      <AuthRoot>
        <App />
      </AuthRoot>
    </SharingRoot>
  </StrictMode>,
);
