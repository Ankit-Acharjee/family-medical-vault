import { useId } from 'react';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';

export type BrowseFilters = {
  query: string;
  category: string;
  from: string;
  to: string;
};

const controlClass =
  'w-full min-w-0 min-h-11 max-w-full rounded-xl border border-input bg-card px-3 py-2 text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

const labelClass = 'block text-sm font-medium text-foreground';
const helpClass = 'mt-1 text-xs text-muted-foreground';
const errorClass = 'text-sm text-destructive';

export function DocumentBrowserControls({
  filters,
  onChange,
  onReset,
  categories,
  count,
  error,
}: {
  filters: BrowseFilters;
  onChange: (next: BrowseFilters) => void;
  onReset: () => void;
  categories: { id: string; name: string }[];
  count: number;
  error: string;
}) {
  const queryId = useId();
  const categoryId = useId();
  const fromId = useId();
  const toId = useId();
  const errorId = useId();
  const countId = useId();

  const hasFilters =
    filters.query !== '' ||
    filters.category !== '' ||
    filters.from !== '' ||
    filters.to !== '';

  return (
    <section
      role="group"
      aria-label="Document filters"
      className="w-full rounded-xl border border-border bg-card p-4 text-foreground"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Search documents — spans two columns from sm up */}
        <div className="min-w-0 sm:col-span-2">
          <label htmlFor={queryId} className={labelClass}>
            Search documents
          </label>
          <Input
            id={queryId}
            type="search"
            value={filters.query}
            maxLength={200}
            onChange={(event) =>
              onChange({ ...filters, query: event.target.value })
            }
            aria-describedby={`${queryId}-help`}
            className="mt-1 w-full min-w-0 border-input focus-visible:outline-ring rounded-xl"
          />
          <p id={`${queryId}-help`} className={helpClass}>
            Search titles, original filenames and saved text you can view.
          </p>
        </div>

        {/* Category — native select, "All categories" first */}
        <div className="min-w-0">
          <label htmlFor={categoryId} className={labelClass}>
            Category
          </label>
          <select
            id={categoryId}
            value={filters.category}
            onChange={(event) =>
              onChange({ ...filters, category: event.target.value })
            }
            className={`mt-1 ${controlClass}`}
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>

        {/* Uploaded from / Uploaded through — parent validates the date range */}
        <div className="min-w-0">
          <label htmlFor={fromId} className={labelClass}>
            Uploaded from
          </label>
          <input
            id={fromId}
            type="date"
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            value={filters.from}
            onChange={(event) =>
              onChange({ ...filters, from: event.target.value })
            }
            className={`mt-1 ${controlClass}`}
          />
        </div>
        <div className="min-w-0">
          <label htmlFor={toId} className={labelClass}>
            Uploaded through
          </label>
          <input
            id={toId}
            type="date"
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            value={filters.to}
            onChange={(event) =>
              onChange({ ...filters, to: event.target.value })
            }
            className={`mt-1 ${controlClass}`}
          />
        </div>
      </div>

      {error ? (
        <p id={errorId} role="alert" className={`mt-3 ${errorClass}`}>
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <p
          id={countId}
          role="status"
          aria-live="polite"
          className="text-sm text-muted-foreground"
        >
          {count} {count === 1 ? 'document' : 'documents'} shown
        </p>
        {hasFilters ? (
          <Button type="button" variant="secondary" onClick={onReset}>
            Clear filters
          </Button>
        ) : null}
      </div>
    </section>
  );
}

export function DocumentTitleEditor({
  title,
  onTitleChange,
  onSave,
  onCancel,
  saving,
  error,
}: {
  title: string;
  onTitleChange: (title: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string;
}) {
  const titleId = useId();
  const helpId = useId();
  const errorId = useId();

  const describedBy = error ? `${helpId} ${errorId}` : helpId;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
      className="w-full rounded-xl border border-border bg-card p-4 text-foreground"
    >
      <div className="grid grid-cols-1 gap-3">
        <div className="min-w-0">
          <label htmlFor={titleId} className={labelClass}>
            Document title
          </label>
          <Input
            id={titleId}
            type="text"
            value={title}
            maxLength={200}
            required
            autoFocus
            readOnly={saving}
            onChange={(event) => onTitleChange(event.target.value)}
            aria-describedby={describedBy}
            className="mt-1 w-full min-w-0 border-input focus-visible:outline-ring rounded-xl"
          />
          <p id={helpId} className={helpClass}>
            Only the display title changes. Original file stays unchanged.
          </p>
          {error ? (
            <p id={errorId} role="alert" className={`mt-1 ${errorClass}`}>
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={saving}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save title'}
          </Button>
        </div>
      </div>
    </form>
  );
}
