import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { cn } from '../../lib/utils';
import {
  findTextMatches,
  textFindMatchLimit,
  textFindQueryLimit,
} from './textMatches';

export function ExtractedTextResult({
  pages,
}: {
  pages: readonly { page: number; text: string }[];
}) {
  const inputId = useId();
  const helperId = useId();
  const statusId = useId();
  const [query, setQuery] = useState('');
  const [activeMatch, setActiveMatch] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);
  const viewport = useRef<HTMLDivElement | null>(null);
  const currentMark = useRef<HTMLElement | null>(null);
  const { matches, capped } = findTextMatches(pages, query);
  const navigate = (direction: number) => {
    if (matches.length)
      setActiveMatch(
        (current) => (current + direction + matches.length) % matches.length,
      );
  };

  useEffect(() => {
    const container = viewport.current;
    const mark = currentMark.current;
    if (!container || !mark) return;
    const bounds = container.getBoundingClientRect();
    const matchBounds = mark.getBoundingClientRect();
    // Scroll only the text viewport, without moving keyboard focus or the page.
    if (matchBounds.top < bounds.top)
      container.scrollTop += matchBounds.top - bounds.top - 16;
    else if (matchBounds.bottom > bounds.bottom)
      container.scrollTop += matchBounds.bottom - bounds.bottom + 16;
  }, [activeMatch, query, pages]);

  const status = !query
    ? 'Enter text to find a match.'
    : !matches.length
      ? 'No matches in this extracted text.'
      : `Match ${activeMatch + 1} of ${matches.length}${capped ? ` shown. More than ${textFindMatchLimit} matches; refine your search.` : '.'}`;

  return (
    <div className="min-w-0 space-y-3">
      <div className="min-w-0 space-y-2">
        <label
          htmlFor={inputId}
          className="text-sm font-medium text-foreground"
        >
          Find in this text
        </label>
        <div className="flex min-w-0 flex-wrap gap-2">
          <Input
            ref={input}
            id={inputId}
            type="text"
            value={query}
            maxLength={textFindQueryLimit}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={`${helperId} ${statusId}`}
            className="basis-40 flex-1 text-base"
            onChange={(event) => {
              setQuery(event.target.value.slice(0, textFindQueryLimit));
              setActiveMatch(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                navigate(event.shiftKey ? -1 : 1);
              }
            }}
          />
          <Button
            variant="ghost"
            disabled={!query}
            onClick={() => {
              setQuery('');
              setActiveMatch(0);
              input.current?.focus();
            }}
          >
            Clear search
          </Button>
        </div>
        <p id={helperId} className="text-sm text-muted-foreground">
          Finds literal text, ignoring case, only in the extracted text shown
          here. Punctuation and accents must match.
        </p>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            disabled={!matches.length}
            onClick={() => navigate(-1)}
          >
            Previous match
          </Button>
          <Button
            variant="secondary"
            disabled={!matches.length}
            onClick={() => navigate(1)}
          >
            Next match
          </Button>
          <p
            id={statusId}
            role="status"
            aria-atomic="true"
            className="text-sm tabular-nums text-muted-foreground"
          >
            {status}
          </p>
        </div>
      </div>
      <div
        ref={viewport}
        role="region"
        aria-label="Extracted text pages"
        tabIndex={0}
        className="max-h-[50vh] overflow-y-auto overscroll-contain scroll-auto rounded-xl border-border bg-muted px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {pages.map(({ page, text }, pageIndex) => {
          const content: ReactNode[] = [];
          let offset = 0;
          for (const [index, match] of matches.entries()) {
            if (match.pageIndex !== pageIndex) continue;
            content.push(text.slice(offset, match.start));
            content.push(
              <mark
                key={match.start}
                ref={index === activeMatch ? currentMark : undefined}
                aria-current={index === activeMatch ? 'true' : undefined}
                className={cn(
                  'rounded-sm bg-accent text-accent-foreground underline decoration-primary underline-offset-2',
                  index === activeMatch &&
                    'bg-primary text-primary-foreground no-underline outline outline-1 outline-offset-1 outline-primary',
                )}
              >
                {text.slice(match.start, match.end)}
              </mark>,
            );
            offset = match.end;
          }
          content.push(text.slice(offset));
          return (
            <div key={page} className="min-w-0">
              <h3 className="text-foreground text-sm font-semibold">
                Page {page}
              </h3>
              <p className="text-foreground/90 mt-1 mb-4 min-w-0 whitespace-pre-wrap break-words">
                {text ? content : 'No embedded text on this page.'}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
