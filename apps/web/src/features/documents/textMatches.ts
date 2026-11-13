export const textFindQueryLimit = 200;
export const textFindMatchLimit = 500;

export interface TextFindMatch {
  pageIndex: number;
  start: number;
  end: number;
}

export function findTextMatches(
  pages: readonly { page: number; text: string }[],
  query: string,
): { matches: TextFindMatch[]; capped: boolean } {
  const matches: TextFindMatch[] = [];
  if (!query || query.length > textFindQueryLimit)
    return { matches, capped: false };

  // Escape syntax before applying Unicode-aware case folding. exec preserves
  // original UTF-16 offsets without copying or normalizing the source text.
  const literal = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(literal, 'giu');
  for (const [pageIndex, { text }] of pages.entries()) {
    pattern.lastIndex = 0;
    let hit: RegExpExecArray | null;
    while ((hit = pattern.exec(text)) !== null) {
      if (matches.length === textFindMatchLimit)
        return { matches, capped: true };
      matches.push({
        pageIndex,
        start: hit.index,
        end: hit.index + hit[0].length,
      });
    }
  }
  return { matches, capped: false };
}
