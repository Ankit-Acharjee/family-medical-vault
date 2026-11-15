import type { FieldEvidence } from './lab-fields.js';
/**
 * medication-fields.ts
 *
 * Generic, dependency-free source-block parser that extracts medication
 * fields from raw page text. Pure TypeScript: no imports, no I/O, no
 * mutation of its input, no throwing on malformed ordinary JSON input.
 *
 * Source safety rules:
 *  - Column-zero, case-sensitive exact labels. `Medication:` starts a block
 *    and is required; the other labels are optional and only have meaning
 *    inside a currently open block.
 *  - Blocks never join across pages or lines; a block ends (and is emitted
 *    if valid) at a whitespace-only line, a page end, or the next
 *    `Medication:` line.
 *  - Any violation inside a block (unknown nonblank line, duplicate optional
 *    field, blank or too-long value, overlong line) aborts the WHOLE block:
 *    no last-wins, no partial clipping, nothing emitted.
 *  - Values are consumed verbatim (at most one ASCII space after the colon
 *    is consumed). Never normalized: no date/unit/dose/name rewriting, no
 *    active/stopped classification, no dose calculation, no verification.
 *  - Instructions text is an untrusted literal string: returned as-is,
 *    never interpreted.
 *  - Validation happens on the WHOLE input before parsing; invalid input or
 *    malformed options returns [] without throwing.
 *  - Output is bounded directly to 20 candidates; lines are scanned
 *    streaming (no allocate-all-lines), scanning stops early once the
 *    candidate budget is full.
 */

export interface MedicationFieldsPage {
  page: number;
  text: string;
}

export interface MedicationFieldsOptions {
  truncatedFinalLine?: boolean;
}

export interface MedicationFields {
  medication: FieldEvidence;
  strength: FieldEvidence | null;
  dose: FieldEvidence | null;
  frequency: FieldEvidence | null;
  route: FieldEvidence | null;
  duration: FieldEvidence | null;
  start: FieldEvidence | null;
  end: FieldEvidence | null;
  instructions: FieldEvidence | null;
}

export interface MedicationCandidate {
  id: string;
  page: number;
  confidence: 'unrated';
  unverified: true;
  fields: MedicationFields;
}

const MAX_PAGES = 50;
const MAX_PAGE_NUMBER = 50;
const MAX_TOTAL_CHARS = 500000; // UTF-16 code units across all pages
const MAX_CANDIDATES = 20;
const MAX_VALUE_CHARS = 120; // UTF-16 code units per value
const MAX_EXCERPT_CHARS = 240; // UTF-16 code units per physical line

const CR = 13; // \r
const LF = 10; // \n
const SPACE = 32; // ASCII space

type FieldName =
  | 'medication'
  | 'strength'
  | 'dose'
  | 'frequency'
  | 'route'
  | 'duration'
  | 'start'
  | 'end'
  | 'instructions';

/**
 * Column-zero, case-sensitive exact labels. Longest first so no label can
 * shadow a longer one (none currently overlap, but ordering makes the
 * prefix matching safe by construction).
 */
const LABELS: ReadonlyArray<readonly [label: string, field: FieldName]> = [
  ['Instructions:', 'instructions'],
  ['Medication:', 'medication'],
  ['Start date:', 'start'],
  ['Frequency:', 'frequency'],
  ['Duration:', 'duration'],
  ['Strength:', 'strength'],
  ['End date:', 'end'],
  ['Route:', 'route'],
  ['Dose:', 'dose'],
];

/** An in-progress source block. `valid` flips to false permanently on any violation. */
interface Block {
  page: number;
  start: number; // exact UTF-16 start offset of the Medication line within its page
  valid: boolean;
  medication: FieldEvidence | null;
  fields: Record<Exclude<FieldName, 'medication'>, FieldEvidence | null>;
}

function emptyOptionalFields(): Block['fields'] {
  return {
    strength: null,
    dose: null,
    frequency: null,
    route: null,
    duration: null,
    start: null,
    end: null,
    instructions: null,
  };
}

/**
 * Extracts medication candidates from raw page text.
 *
 * Returns at most 20 candidates in document order. Invalid input (wrong
 * shapes, out-of-range pages, non-ascending page numbers, oversized input,
 * NUL or lone surrogates) or malformed options returns [] without throwing.
 */
export function extractMedicationFields(
  pages: readonly MedicationFieldsPage[],
  options?: MedicationFieldsOptions,
): MedicationCandidate[] {
  const validated = validateInput(pages, options);
  if (validated === null) return [];

  const out: MedicationCandidate[] = [];
  const pageCount = validated.pages.length;
  for (let i = 0; i < pageCount; i++) {
    const entry = validated.pages[i]!;
    const skipLast = validated.skipLastLine && i === pageCount - 1;
    if (parsePage(entry.page, entry.text, skipLast, out)) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Input validation (whole input, before any parsing)
// ---------------------------------------------------------------------------

interface ValidatedInput {
  pages: MedicationFieldsPage[];
  skipLastLine: boolean;
}

function validateInput(
  pages: unknown,
  options: unknown,
): ValidatedInput | null {
  if (!Array.isArray(pages) || pages.length > MAX_PAGES) return null;

  const accepted: MedicationFieldsPage[] = [];
  let total = 0;
  let previousPage = 0;
  for (const entry of pages as readonly unknown[]) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry))
      return null;
    const record = entry as Record<string, unknown>;

    const pageNo = record.page;
    if (typeof pageNo !== 'number' || !Number.isInteger(pageNo)) return null;
    if (pageNo < 1 || pageNo > MAX_PAGE_NUMBER) return null;
    if (pageNo <= previousPage) return null; // strictly ascending => unique

    const text = record.text;
    if (typeof text !== 'string') return null;

    total += text.length;
    if (total > MAX_TOTAL_CHARS) return null;
    if (containsForbiddenChars(text)) return null; // NUL or lone surrogate

    previousPage = pageNo;
    accepted.push({ page: pageNo, text }); // defensive copy: input never mutated
  }

  const skipLastLine = validateOptions(options);
  if (skipLastLine === null) return null;

  return { pages: accepted, skipLastLine };
}

/** Options must be undefined or a non-null, non-array object whose flag is absent or boolean. */
function validateOptions(options: unknown): boolean | null {
  if (options === undefined) return false;
  if (options === null || typeof options !== 'object' || Array.isArray(options))
    return null;
  const record = options as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(record, 'truncatedFinalLine'))
    return false;
  const flag = record.truncatedFinalLine;
  if (typeof flag !== 'boolean') return null;
  return flag;
}

/** True when the text contains NUL or a lone (unpaired) surrogate code unit. */
function containsForbiddenChars(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0) return true;
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next < 0xdc00 || next > 0xdfff) return true; // high surrogate not followed by low
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      const prev = i > 0 ? text.charCodeAt(i - 1) : 0;
      if (prev < 0xd800 || prev > 0xdbff) return true; // low surrogate not preceded by high
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Per-page parsing (streaming line scan; no allocate-all-lines)
// ---------------------------------------------------------------------------

/**
 * Parses one page. Returns true when the candidate budget is full so the
 * caller can stop scanning the rest of the document.
 */
function parsePage(
  page: number,
  text: string,
  skipLastLine: boolean,
  out: MedicationCandidate[],
): boolean {
  let block: Block | null = null;
  let lineStart = 0;
  const lastLineStart = skipLastLine ? startOfLastPhysicalLine(text) : -1;

  while (lineStart < text.length) {
    if (skipLastLine && lineStart >= lastLineStart) break; // skip last physical line of final page

    // Only LF separates lines; indexOf/lastIndexOf need string literals here
    // (they would coerce the numeric LF constant into the substring "10").
    const nl = text.indexOf('\n', lineStart); // a CR right before LF is
    const rawEnd = nl === -1 ? text.length : nl; // excluded from the line but stays counted in offsets
    let lineEnd = rawEnd;
    if (nl !== -1 && rawEnd > lineStart && text.charCodeAt(rawEnd - 1) === CR)
      lineEnd = rawEnd - 1;
    const line = text.slice(lineStart, lineEnd); // isolated CRs elsewhere remain literal

    const label = matchLabel(line);
    if (label === null) {
      if (block !== null) {
        if (isBlank(line)) {
          emitBlock(block, out); // whitespace-only line ends and emits a valid block
          block = null;
          if (out.length >= MAX_CANDIDATES) return true;
        } else {
          block.valid = false; // unknown nonblank line aborts the whole block
        }
      }
      // Outside a block: unknown and whitespace-only lines are ignored.
    } else if (label[1] === 'medication') {
      if (block !== null) {
        emitBlock(block, out); // new Medication emits the prior valid block, then starts fresh
        if (out.length >= MAX_CANDIDATES) return true;
      }
      block = startBlock(page, lineStart, line, label[0]);
    } else if (block !== null) {
      addOptionalField(block, line, label[0], label[1]);
    }
    // Known orphan optional fields outside a block are ignored.

    lineStart = nl === -1 ? text.length : nl + 1; // CR before LF still counted in offsets
  }

  if (block !== null) emitBlock(block, out); // page end emits a still-open valid block; no joining across pages
  return out.length >= MAX_CANDIDATES;
}

/** UTF-16 start offset of the last physical line (a trailing LF/CRLF creates no phantom line). */
function startOfLastPhysicalLine(text: string): number {
  if (text.length === 0) return 0;
  if (text.charCodeAt(text.length - 1) === LF) {
    const from = text.length - 2;
    return (from < 0 ? -1 : text.lastIndexOf('\n', from)) + 1;
  }
  return text.lastIndexOf('\n') + 1;
}

function matchLabel(
  line: string,
): readonly [label: string, field: FieldName] | null {
  for (const entry of LABELS) {
    if (line.startsWith(entry[0])) return entry;
  }
  return null;
}

function isBlank(line: string): boolean {
  return line.trim() === '';
}

/** Splits "Label:" + value, consuming at most one ASCII space after the colon, verbatim otherwise. */
function valueAfterLabel(line: string, label: string): string {
  const skip = label.length + (line.charCodeAt(label.length) === SPACE ? 1 : 0);
  return line.slice(skip);
}

function startBlock(
  page: number,
  start: number,
  line: string,
  label: string,
): Block {
  const block: Block = {
    page,
    start,
    valid: false,
    medication: null,
    fields: emptyOptionalFields(),
  };
  if (line.length > MAX_EXCERPT_CHARS) return block; // overlong line aborts the block; no clipping
  const value = valueAfterLabel(line, label);
  if (isBlank(value) || value.length > MAX_VALUE_CHARS) return block; // blank/too-long value aborts
  block.valid = true;
  block.medication = { value, excerpt: line };
  return block;
}

function addOptionalField(
  block: Block,
  line: string,
  label: string,
  field: Exclude<FieldName, 'medication'>,
): void {
  if (!block.valid) return; // aborted blocks accept nothing further
  if (line.length > MAX_EXCERPT_CHARS) {
    block.valid = false; // overlong line aborts the whole block
    return;
  }
  if (block.fields[field] !== null) {
    block.valid = false; // duplicate optional field aborts the whole block; no last-wins
    return;
  }
  const value = valueAfterLabel(line, label);
  if (isBlank(value) || value.length > MAX_VALUE_CHARS) {
    block.valid = false; // blank/too-long value aborts the whole block; no partial clipping
    return;
  }
  block.fields[field] = { value, excerpt: line };
}

function emitBlock(block: Block, out: MedicationCandidate[]): void {
  if (!block.valid || out.length >= MAX_CANDIDATES) return;
  const f = block.fields;
  out.push({
    id: 'page-' + block.page + '-medication-' + block.start,
    page: block.page,
    confidence: 'unrated',
    unverified: true,
    fields: {
      medication: block.medication!,
      strength: f.strength,
      dose: f.dose,
      frequency: f.frequency,
      route: f.route,
      duration: f.duration,
      start: f.start,
      end: f.end,
      instructions: f.instructions,
    },
  });
}
