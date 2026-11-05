import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AuthRoot } from './features/auth/AuthRoot';

const root = document.getElementById('root');
if (!root) throw new Error('Application root is unavailable');

createRoot(root).render(
  <StrictMode>
    <AuthRoot>
      <App />
    </AuthRoot>
  </StrictMode>,
);
