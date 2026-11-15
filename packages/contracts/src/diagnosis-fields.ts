/** Literal labeled text only; never a diagnosis, disease status or verification. */
export interface DiagnosisCandidate {
  id: string;
  page: number;
  field: { value: string; excerpt: string };
  confidence: 'unrated';
  unverified: true;
}
export interface DiagnosisFieldsPage {
  page: number;
  text: string;
}
export interface DiagnosisFieldsOptions {
  /** Drop the final physical line of the final page after character truncation. */
  truncatedFinalLine?: boolean;
}
/** No terminology mapping, splitting, clinical inference, mutation or I/O. */
export function extractDiagnosisFields(
  pages: readonly DiagnosisFieldsPage[],
  options?: DiagnosisFieldsOptions,
): DiagnosisCandidate[] {
  if (!Array.isArray(pages) || pages.length > 50) return [];
  if (
    options !== undefined &&
    (!options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      (options.truncatedFinalLine !== undefined &&
        typeof options.truncatedFinalLine !== 'boolean'))
  )
    return [];
  let previous = 0,
    total = 0;
  // Validate the entire input, even pages beyond the candidate cap.
  for (const item of pages) {
    if (
      !item ||
      typeof item !== 'object' ||
      !Number.isInteger(item.page) ||
      item.page <= previous ||
      item.page > 50 ||
      typeof item.text !== 'string'
    )
      return [];
    previous = item.page;
    total += item.text.length;
    if (total > 500_000) return [];
    for (let i = 0; i < item.text.length; i++) {
      const c = item.text.charCodeAt(i);
      if (c === 0) return [];
      if (c >= 0xd800 && c <= 0xdbff) {
        const next = item.text.charCodeAt(++i);
        if (!(next >= 0xdc00 && next <= 0xdfff)) return [];
      } else if (c >= 0xdc00 && c <= 0xdfff) return [];
    }
  }
  const out: DiagnosisCandidate[] = [];
  for (let p = 0; p < pages.length; p++) {
    const { page, text } = pages[p]!;
    let start = 0;
    while (start < text.length) {
      const newline = text.indexOf('\n', start);
      const next = newline === -1 ? text.length : newline + 1;
      const last = next === text.length;
      if (!(
        options?.truncatedFinalLine === true &&
        p === pages.length - 1 &&
        last
      )) {
        const end =
          newline === -1
            ? text.length
            : newline > start && text[newline - 1] === '\r'
              ? newline - 1
              : newline;
        const excerpt = text.slice(start, end);
        if (excerpt.startsWith('Diagnosis:') && excerpt.length <= 240) {
          const raw = excerpt.slice('Diagnosis:'.length);
          const value = raw.startsWith(' ') ? raw.slice(1) : raw;
          if (value.trim() && value.length <= 120) {
            out.push({
              id: `page-${page}-diagnosis-${start}`,
              page,
              field: { value, excerpt },
              confidence: 'unrated',
              unverified: true,
            });
            if (out.length === 20) return out;
          }
        }
      }
      start = next;
    }
  }
  return out;
}
