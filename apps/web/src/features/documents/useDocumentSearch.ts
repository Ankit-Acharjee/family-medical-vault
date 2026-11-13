import { useEffect, useState } from 'react';
import {
  isDocumentSearchInput,
  isDocumentSearchResult,
  type DocumentSearchInput,
  type DocumentSearchResult,
  type DocumentSummary,
} from '@fmv/contracts';
import type { BrowseFilters } from './DocumentBrowserControls';

function validDate(date: string) {
  return (
    !date ||
    (/^\d{4}-\d{2}-\d{2}$/.test(date) &&
      Number.isFinite(Date.parse(date)) &&
      new Date(date).toISOString().slice(0, 10) === date)
  );
}

export function documentFilterError(filters: BrowseFilters) {
  return !validDate(filters.from) || !validDate(filters.to)
    ? 'Enter valid upload dates.'
    : filters.from && filters.to && filters.from > filters.to
      ? 'The start date must be on or before the end date.'
      : '';
}

// Construct each local midnight separately: a calendar day can span 23 or 25 hours.
function midnight(date: string, followingDay = false) {
  const [year, month, day] = date.split('-').map(Number);
  const instant = new Date(0);
  instant.setFullYear(year!, month! - 1, day! + Number(followingDay));
  instant.setHours(0, 0, 0, 0);
  return instant.toISOString();
}

export function matchesDocumentFilters(
  document: DocumentSummary,
  filters: BrowseFilters,
) {
  const uploaded = Date.parse(document.createdAt);
  return (
    (!filters.category || document.categoryId === filters.category) &&
    (!filters.from || uploaded >= Date.parse(midnight(filters.from))) &&
    (!filters.to || uploaded < Date.parse(midnight(filters.to, true)))
  );
}

export function matchesDocumentTitle(document: DocumentSummary, query: string) {
  const term = query.trim().toLowerCase();
  return (
    !term ||
    document.title.toLowerCase().includes(term) ||
    (document.originalTitle ?? document.title).toLowerCase().includes(term)
  );
}

class SearchDenied extends Error {}

async function jsonRequest(path: string, init: RequestInit) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...init,
  });
  init.signal?.throwIfAborted();
  if ([401, 403, 404].includes(response.status)) throw new SearchDenied();
  if (!response.ok) throw new Error('Search unavailable');
  return response.json() as Promise<unknown>;
}

type SearchState = {
  key: string;
  documents: DocumentSummary[];
  result: DocumentSearchResult | null;
};

export function useDocumentSearch({
  patientId,
  documents,
  filters,
  suspended,
  revision,
  onDenied,
}: {
  patientId: string | null;
  documents: DocumentSummary[] | null;
  filters: BrowseFilters;
  suspended: boolean;
  revision: string;
  onDenied: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<SearchState | null>(null);
  const input: DocumentSearchInput = {
    query: filters.query.trim(),
    ...(filters.category ? { categoryId: filters.category } : {}),
    ...(filters.from && validDate(filters.from)
      ? { uploadedFrom: midnight(filters.from) }
      : {}),
    ...(filters.to && validDate(filters.to)
      ? { uploadedBefore: midnight(filters.to, true) }
      : {}),
  };
  const enabled =
    !!patientId &&
    !suspended &&
    !documentFilterError(filters) &&
    isDocumentSearchInput(input) &&
    !!documents?.some(
      (document) =>
        document.canView && matchesDocumentFilters(document, filters),
    );
  const body = JSON.stringify(input);
  const key = JSON.stringify([
    patientId,
    filters,
    revision,
    suspended,
    attempt,
  ]);
  // Discard previous-context results rather than retaining a per-query cache.
  if (state && (!enabled || state.key !== key || state.documents !== documents))
    setState(null);

  useEffect(() => {
    if (!enabled || !patientId || !documents) return;
    const controller = new AbortController();
    let cancelled = false;
    let deadline: number | undefined;
    const debounce = window.setTimeout(() => {
      deadline = window.setTimeout(() => controller.abort(), 15_000);
      void (async () => {
        try {
          const bootstrap = await jsonRequest('/api/auth/bootstrap', {
            signal: controller.signal,
          });
          if (
            !bootstrap ||
            typeof bootstrap !== 'object' ||
            !('enabled' in bootstrap) ||
            bootstrap.enabled !== true ||
            !('csrf' in bootstrap) ||
            typeof bootstrap.csrf !== 'string' ||
            !/^[A-Za-z0-9_-]{43}$/.test(bootstrap.csrf)
          )
            throw new Error('Search unavailable');
          controller.signal.throwIfAborted();
          const result = await jsonRequest(
            `/api/patients/${encodeURIComponent(patientId)}/documents/search`,
            {
              method: 'POST',
              signal: controller.signal,
              headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': bootstrap.csrf,
              },
              body,
            },
          );
          controller.signal.throwIfAborted();
          if (!isDocumentSearchResult(result))
            throw new Error('Invalid search');
          if (!cancelled) setState({ key, documents, result });
        } catch (error) {
          if (
            !cancelled &&
            !controller.signal.aborted &&
            error instanceof SearchDenied
          ) {
            onDenied();
            return;
          }
          if (!cancelled) setState({ key, documents, result: null });
        } finally {
          window.clearTimeout(deadline);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(debounce);
      window.clearTimeout(deadline);
      controller.abort();
    };
  }, [enabled, patientId, documents, key, body, onDenied]);

  // Gate during render as well as effect cleanup, including the debounce window.
  const current =
    enabled && state?.key === key && state.documents === documents
      ? state
      : null;
  return {
    documentIds: new Set(current?.result?.documentIds ?? []),
    status: !enabled
      ? ('idle' as const)
      : !current
        ? ('pending' as const)
        : !current.result
          ? ('error' as const)
          : ('ready' as const),
    truncated: current?.result?.truncated ?? false,
    retry: () => setAttempt((value) => value + 1),
  };
}
