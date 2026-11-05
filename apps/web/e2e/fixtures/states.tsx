// Development test fixture. This entry is not included in production builds.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ResourceState } from '../../src/components/ui/resource-state';
import type { ResourceStatus } from '../../src/components/ui/resource-state';
import '../../src/styles.css';

const states: ResourceStatus[] = [
  'loading',
  'empty',
  'error',
  'denied',
  'offline',
  'pending',
  'success',
];

function Fixture() {
  const [retried, setRetried] = useState(false);
  return (
    <main>
      <h1>UI state test fixture</h1>
      {states.map((state) => (
        <ResourceState
          key={state}
          state={state}
          title={`${state} state`}
          description="Synthetic interface state without patient information."
          {...(state === 'error' || state === 'offline'
            ? { actionLabel: 'Try again', onAction: () => setRetried(true) }
            : {})}
        />
      ))}
      {retried ? <p role="status">Retry requested</p> : null}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
