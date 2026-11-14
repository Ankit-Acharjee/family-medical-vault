export type SourceExcerptTarget = {
  page: number;
  excerpt: string;
  requestId: string;
};
export type SourceExcerptMatch = {
  pageIndex: number;
  start: number;
  end: number;
};

// Reviewed from the sandboxed worker's standalone implementation. Validate the
// whole size before indexOf so malformed oversized text cannot escape the cap.
export function resolveSourceExcerpt(
  pages: readonly { page: number; text: string }[],
  target: SourceExcerptTarget,
): SourceExcerptMatch | null {
  if (!Array.isArray(pages) || !pages.length || pages.length > 50) return null;
  if (
    !target ||
    typeof target !== 'object' ||
    !Number.isInteger(target.page) ||
    target.page < 1 ||
    target.page > 50 ||
    typeof target.requestId !== 'string' ||
    !target.requestId.length ||
    target.requestId.length > 100 ||
    typeof target.excerpt !== 'string' ||
    !target.excerpt.trim() ||
    target.excerpt.length > 240
  )
    return null;
  for (let i = 0; i < target.excerpt.length; i++) {
    const code = target.excerpt.charCodeAt(i);
    if (code === 0) return null;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = target.excerpt.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return null;
    } else if (code >= 0xdc00 && code <= 0xdfff) return null;
  }
  let total = 0,
    pageIndex = -1;
  const seen = new Set<number>();
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (
      !p ||
      typeof p !== 'object' ||
      typeof p.text !== 'string' ||
      !Number.isInteger(p.page) ||
      p.page < 1 ||
      p.page > 50 ||
      seen.has(p.page)
    )
      return null;
    seen.add(p.page);
    total += p.text.length;
    if (total > 500_000) return null;
    if (p.page === target.page) pageIndex = i;
  }
  if (pageIndex < 0) return null;
  const start = pages[pageIndex]!.text.indexOf(target.excerpt);
  return start < 0
    ? null
    : { pageIndex, start, end: start + target.excerpt.length };
}
