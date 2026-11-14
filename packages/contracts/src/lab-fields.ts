// Conservative source-linked candidates only; no clinical interpretation or verification.
export interface LabFieldsPage {
  /** Integer in 1..50; strictly ascending across the array. */
  page: number;
  /** Raw page text; must be well-formed Unicode without NUL. */
  text: string;
}

export interface LabFieldsOptions {
  /**
   * True when upstream character-truncated the final physical line; the last
   * physical line of the final page is then dropped before parsing.
   */
  truncatedFinalLine?: boolean;
}

/** Verbatim evidence for one field: the exact line plus the exact value text. */
export interface FieldEvidence {
  /** Exact value as written after the label (single leading space consumed). */
  value: string;
  /** Exact original line from the page text (<= 240 UTF-16 code units). */
  excerpt: string;
}

export interface LabFieldCandidate {
  confidence: 'unrated';
  /** Stable `page-N-block-OFFSET`; exact UTF-16 offset of the block-start line. */
  id: string;
  page: number;
  fields: {
    analyte: FieldEvidence;
    result: FieldEvidence;
    unit: FieldEvidence | null;
    reference: FieldEvidence | null;
    specimen: FieldEvidence | null;
    method: FieldEvidence | null;
    date: FieldEvidence | null;
    laboratory: FieldEvidence | null;
  };
  /** Always true: extracted text is unverified and is never clinical fact. */
  unverified: true;
}

const MAX_PAGES = 50;
const MAX_TOTAL_UNITS = 500_000;
const MAX_PAGE_NUMBER = 50;
const MAX_CANDIDATES = 20;
const MAX_EXCERPT_UNITS = 240;
const MAX_VALUE_UNITS = 120;

const SLOT_ANALYTE = 0;
const SLOT_RESULT = 1;
const SLOT_UNIT = 2;
const SLOT_REFERENCE = 3;
const SLOT_SPECIMEN = 4;
const SLOT_METHOD = 5;
const SLOT_DATE = 6;
const SLOT_LABORATORY = 7;

interface LabelEntry {
  label: string;
  slot: number;
}

/**
 * Exact, case-sensitive labels. No label here is a prefix of another, so the
 * first match in this fixed table is the only possible match.
 */
const LABEL_TABLE: readonly LabelEntry[] = [
  { label: 'Collection date:', slot: SLOT_DATE },
  { label: 'Reference range:', slot: SLOT_REFERENCE },
  { label: 'Laboratory:', slot: SLOT_LABORATORY },
  { label: 'Specimen:', slot: SLOT_SPECIMEN },
  { label: 'Analyte:', slot: SLOT_ANALYTE },
  { label: 'Result:', slot: SLOT_RESULT },
  { label: 'Method:', slot: SLOT_METHOD },
  { label: 'Units:', slot: SLOT_UNIT },
  { label: 'Unit:', slot: SLOT_UNIT },
  { label: 'Test:', slot: SLOT_ANALYTE },
];

function newSlots(): Array<FieldEvidence | null> {
  return [null, null, null, null, null, null, null, null];
}

/** Rejects NUL and lone surrogates; bounded by the page length. */
function isWellFormedWithoutNul(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0) return false;
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (d < 0xdc00 || d > 0xdfff) return false;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/** Blank = empty or ASCII whitespace only (handles CRLF remnants). */
function isBlankLine(line: string): boolean {
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 0x20 && c !== 0x09 && c !== 0x0d && c !== 0x0b && c !== 0x0c) {
      return false;
    }
  }
  return true;
}

function matchLabel(line: string): LabelEntry | null {
  for (let i = 0; i < LABEL_TABLE.length; i++) {
    const entry = LABEL_TABLE[i]!;
    if (line.startsWith(entry.label)) return entry;
  }
  return null;
}

/** Exact text after the label; one canonical leading space is consumed. */
function fieldValue(line: string, label: string): string {
  let value = line.slice(label.length);
  if (value.length > 0 && value.charCodeAt(0) === 0x20) {
    value = value.slice(1);
  }
  return value;
}

/** Counts physical lines exactly like the walk in parsePage (no allocation). */
function countLines(text: string): number {
  let count = 0;
  let pos = 0;
  while (pos < text.length) {
    const nl = text.indexOf('\n', pos);
    count++;
    if (nl === -1) break;
    pos = nl + 1;
  }
  return count;
}

function parsePage(
  page: number,
  text: string,
  dropFinalLine: boolean,
  out: LabFieldCandidate[],
): void {
  const lastLineIndex = countLines(text) - 1;

  let inBlock = false;
  let blockOffset = -1;
  let slots = newSlots();

  // Ends the open block at a blank line / block-start line / page end and
  // emits a candidate only when the mandatory Result is present.
  const endBlock = (): void => {
    if (!inBlock) return;
    inBlock = false;
    const analyte = slots[SLOT_ANALYTE];
    const result = slots[SLOT_RESULT];
    if (!analyte || !result) return; // Result absent: ignore (possibly truncated) block
    if (out.length >= MAX_CANDIDATES) return;
    out.push({
      confidence: 'unrated',
      id: 'page-' + page + '-block-' + blockOffset,
      page,
      fields: {
        analyte,
        result,
        unit: slots[SLOT_UNIT] ?? null,
        reference: slots[SLOT_REFERENCE] ?? null,
        specimen: slots[SLOT_SPECIMEN] ?? null,
        method: slots[SLOT_METHOD] ?? null,
        date: slots[SLOT_DATE] ?? null,
        laboratory: slots[SLOT_LABORATORY] ?? null,
      },
      unverified: true,
    });
  };

  // Aborts discard the block entirely; scanning continues outside any block.
  const abortBlock = (): void => {
    inBlock = false;
  };

  let pos = 0;
  for (let lineIndex = 0; pos < text.length; lineIndex++) {
    const nl = text.indexOf('\n', pos);
    const hasNext = nl !== -1;
    let end = hasNext ? nl : text.length;
    // A CR immediately before LF is separator machinery, not line content.
    if (hasNext && end > pos && text.charCodeAt(end - 1) === 0x0d) end -= 1;

    if (!(dropFinalLine && lineIndex === lastLineIndex)) {
      const line = text.slice(pos, end);

      if (isBlankLine(line)) {
        endBlock();
      } else {
        const hit = matchLabel(line);
        if (hit === null) {
          // Unknown nonblank line: prose/title outside blocks is ignored;
          // inside a block it aborts the block.
          abortBlock();
        } else if (hit.slot === SLOT_ANALYTE) {
          endBlock(); // finalize the previous block before starting a new one
          if (line.length <= MAX_EXCERPT_UNITS) {
            const value = fieldValue(line, hit.label);
            if (value.trim().length > 0 && value.length <= MAX_VALUE_UNITS) {
              inBlock = true;
              blockOffset = pos;
              slots = newSlots();
              slots[SLOT_ANALYTE] = { value, excerpt: line };
            }
          }
          // Overlong block-start line (or overlong value): no block is begun.
        } else if (inBlock) {
          if (line.length > MAX_EXCERPT_UNITS) {
            abortBlock(); // overlong line aborts the block, never clipped
          } else {
            const value = fieldValue(line, hit.label);
            if (!value.trim() || value.length > MAX_VALUE_UNITS) {
              abortBlock();
            } else if (slots[hit.slot] !== null) {
              abortBlock(); // duplicate field aborts the block
            } else {
              slots[hit.slot] = { value, excerpt: line };
            }
          }
        }
        // Known field label outside any block (e.g. orphan Result:): ignored.
      }

      if (out.length >= MAX_CANDIDATES) return;
    }

    if (!hasNext) break;
    pos = nl + 1;
  }

  endBlock(); // page end terminates any open block
}

/**
 * Extracts unverified labeled-field candidates from validated page texts.
 * Returns at most 20 candidates in document order; never throws, never
 * mutates the inputs, never interprets clinical meaning.
 */
export function extractLabFields(
  pages: readonly LabFieldsPage[],
  options?: LabFieldsOptions,
): LabFieldCandidate[] {
  const candidates: LabFieldCandidate[] = [];
  if (!Array.isArray(pages)) return candidates;

  // ---- validate the whole input before parsing anything ----
  if (pages.length > MAX_PAGES) return candidates;
  let totalUnits = 0;
  let prevPage = 0;
  for (let i = 0; i < pages.length; i++) {
    const rec = pages[i] as unknown as {
      page?: unknown;
      text?: unknown;
    } | null;
    if (rec === null || typeof rec !== 'object') return candidates;
    const num = rec.page;
    const text = rec.text;
    if (typeof num !== 'number' || !Number.isInteger(num)) return candidates;
    if (num < 1 || num > MAX_PAGE_NUMBER) return candidates;
    if (num <= prevPage) return candidates; // strictly ascending, hence unique
    prevPage = num;
    if (typeof text !== 'string') return candidates;
    totalUnits += text.length;
    if (totalUnits > MAX_TOTAL_UNITS) return candidates;
    if (!isWellFormedWithoutNul(text)) return candidates;
  }

  const dropFinalLine =
    options !== null &&
    typeof options === 'object' &&
    (options as LabFieldsOptions).truncatedFinalLine === true;

  for (let i = 0; i < pages.length; i++) {
    if (candidates.length >= MAX_CANDIDATES) break;
    const page = pages[i] as LabFieldsPage;
    parsePage(
      page.page,
      page.text,
      dropFinalLine && i === pages.length - 1,
      candidates,
    );
  }
  return candidates;
}
