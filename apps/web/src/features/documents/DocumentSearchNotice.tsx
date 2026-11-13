import { Button } from '../../components/ui/button';

export function DocumentSearchNotice({
  status,
  truncated,
  onRetry,
}: {
  status: 'idle' | 'pending' | 'error' | 'ready';
  truncated: boolean;
  onRetry: () => void;
}) {
  if (status === 'idle') return null;
  return (
    <div className="space-y-2 text-sm text-muted-foreground">
      <p role="status">
        {status === 'pending'
          ? 'Searching saved text… Title and filename matches are available.'
          : status === 'error'
            ? 'Saved text search is unavailable. Results are incomplete; title and filename matches are still available.'
            : truncated
              ? 'Showing up to 200 saved text matches. Refine your search or filters to find more.'
              : 'Saved text matches all search words across saved pages. Text may be partial or unverified; open Saved text to review.'}
      </p>
      {status === 'error' ? (
        <Button type="button" variant="secondary" onClick={onRetry}>
          Retry saved text search
        </Button>
      ) : null}
    </div>
  );
}
