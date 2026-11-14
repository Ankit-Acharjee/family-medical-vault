export const metadataSuggestionRuleVersion = 'explicit-lines-v1';

export type MetadataSuggestion = {
  kind: 'type' | 'date' | 'provider' | 'label';
  value: string;
  // Rule strength only, never a calibrated probability or verified fact.
  confidence: 'explicit' | 'tentative';
  page: number;
  excerpt: string;
  dateRole?: 'Report date' | 'Collection date';
};

const heading =
  /^(laboratory report|lab report|prescription|discharge summary|radiology report)$/i;
const typedHeading = /^(?:document type|report type|type):[ \t]*(.+)$/i;
const labeledDate = /^(report date|collection date):[ \t]*(.+)$/i;
const labeledProvider = /^(?:provider|laboratory|hospital):[ \t]*(.+)$/i;
const labeledLabels = /^labels:[ \t]*(.+)$/i;
const providerText = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} .,'’&()/-]*$/u;
const labelText = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} /-]*$/u;
const months = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

function validDay(year: number, month: number, day: number): boolean {
  if (year < 1000 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1]!;
}

function dateStrength(value: string): MetadataSuggestion['confidence'] | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) return validDay(+iso[1]!, +iso[2]!, +iso[3]!) ? 'explicit' : null;
  const numeric = /^(\d{1,2})([/.-])(\d{1,2})([/.-])(\d{4})$/.exec(value);
  if (numeric) {
    if (numeric[2] !== numeric[4]) return null;
    const first = +numeric[1]!,
      second = +numeric[3]!,
      year = +numeric[5]!;
    const dayFirst = validDay(year, second, first);
    const monthFirst = validDay(year, first, second);
    if (!dayFirst && !monthFirst) return null;
    return dayFirst && monthFirst && first !== second
      ? 'tentative'
      : 'explicit';
  }
  const named = /^(\d{1,2}) ([A-Za-z]{3,9}) (\d{4})$/.exec(value);
  if (!named) return null;
  const name = named[2]!.toLowerCase();
  const month =
    months.findIndex((item) => item === name || item.slice(0, 3) === name) + 1;
  return validDay(+named[3]!, month, +named[1]!) ? 'explicit' : null;
}

function safeLine(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if ((code < 32 && code !== 9) || (code >= 127 && code <= 159)) return false;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

/** DOC-03 / AI-02 / AI-05: local, deliberately incomplete source-linked hints.
 * No inference from prose, no date normalization, and no medical interpretation.
 * Limits can omit later matches; overlong values/lines are skipped, never clipped.
 */
export function suggestMetadata(
  pages: readonly { page: number; text: string }[],
  options?: { truncatedFinalLine?: boolean },
): MetadataSuggestion[] {
  const suggestions: MetadataSuggestion[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(pages)) return suggestions;
  let remaining = 500_000;

  function inspect(excerpt: string, page: number) {
    if (!excerpt || excerpt.length > 240 || !safeLine(excerpt)) return;
    const line = excerpt.trim();
    function add(
      kind: MetadataSuggestion['kind'],
      value: string,
      confidence: MetadataSuggestion['confidence'] = 'explicit',
      dateRole?: MetadataSuggestion['dateRole'],
    ) {
      if (!value || value.length > 120 || suggestions.length === 12) return;
      const key = `${kind}:${dateRole ?? ''}:${value.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      suggestions.push({
        kind,
        value,
        confidence,
        page,
        excerpt,
        ...(dateRole ? { dateRole } : {}),
      });
    }
    const type = typedHeading.exec(line)?.[1]?.trim() ?? line;
    if (heading.test(type)) {
      add('type', type);
      return;
    }
    const dateMatch = labeledDate.exec(line);
    const date = dateMatch?.[2]?.trim();
    if (date && dateMatch) {
      const confidence = dateStrength(date);
      const role =
        dateMatch[1]!.toLowerCase() === 'report date'
          ? 'Report date'
          : 'Collection date';
      if (confidence) add('date', date, confidence, role);
      return;
    }
    const provider = labeledProvider.exec(line)?.[1]?.trim();
    if (provider && providerText.test(provider)) {
      add('provider', provider);
      return;
    }
    const labels = labeledLabels
      .exec(line)?.[1]
      ?.split(',')
      .map((label) => label.trim());
    if (
      labels &&
      labels.length <= 6 &&
      labels.every(
        (label) =>
          label.length > 0 && label.length <= 40 && labelText.test(label),
      )
    ) {
      for (const label of labels) add('label', label);
    }
  }

  // Valid snapshots have <=50 pages and <=500k UTF-16 units. Runtime guards
  // and line caps keep malformed input bounded without trusting the caller.
  for (
    let index = 0;
    index < Math.min(pages.length, 50) && remaining > 0;
    index++
  ) {
    const entry = pages[index];
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof entry.text !== 'string' ||
      !Number.isInteger(entry.page) ||
      entry.page < 1 ||
      entry.page > 50
    )
      continue;
    const text = entry.text;
    const limit = Math.min(text.length, remaining);
    let start = 0,
      offset = 0,
      lines = 0;
    for (; offset < limit && lines < 5_000; offset++) {
      const code = text.charCodeAt(offset);
      if (code !== 10 && code !== 13) continue;
      if (offset - start <= 240) inspect(text.slice(start, offset), entry.page);
      if (suggestions.length === 12) return suggestions;
      if (
        code === 13 &&
        offset + 1 < limit &&
        text.charCodeAt(offset + 1) === 10
      )
        offset++;
      start = offset + 1;
      lines++;
    }
    remaining -= offset;
    // Neither this scan boundary nor an upstream extraction character limit
    // may turn a partial final source line into complete metadata.
    const truncatedSource =
      options?.truncatedFinalLine && index === pages.length - 1;
    if (offset === text.length && offset - start <= 240 && !truncatedSource)
      inspect(text.slice(start), entry.page);
    if (suggestions.length === 12) return suggestions;
  }
  return suggestions;
}
