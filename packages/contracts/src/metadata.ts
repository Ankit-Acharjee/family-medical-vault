import {
  metadataSuggestionRuleVersion,
  type MetadataSuggestion,
} from './metadata-rules.js';
import {
  isSaveExtractionResult,
  type SaveExtractionResult,
} from './extractions.js';

export type SaveMetadataSuggestions = {
  requestId: string;
  expectedRevision: number;
  sourceRevision: number;
  sourceSha256: string;
  lifecycleVersion: number;
  ruleVersion: typeof metadataSuggestionRuleVersion;
};
export type MetadataSuggestionsContext = {
  sourceRevision: number;
  sourceSha256: string;
  lifecycleVersion: number;
  revision: number;
  canSave: boolean;
};
export type SavedMetadataSuggestions = {
  revision: number;
  sourceRevision: number;
  sourceSha256: string;
  ruleVersion: typeof metadataSuggestionRuleVersion;
  suggestions: MetadataSuggestion[];
  savedAt: string;
  unverified: true;
};
export type MetadataSuggestionsReadResult = {
  context: MetadataSuggestionsContext;
  snapshot: SavedMetadataSuggestions | null;
};
export type SaveMetadataSuggestionsResult = SaveExtractionResult;
export const isSaveMetadataSuggestionsResult = isSaveExtractionResult;

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha = /^[a-f0-9]{64}$/;

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: readonly string[]) {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}
function integer(value: unknown, min = 0): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= min &&
    value <= 2_147_483_647
  );
}
function sourceSha(value: unknown): value is string {
  return typeof value === 'string' && sha.test(value);
}
function boundedText(value: unknown, limit: number): value is string {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > limit ||
    !value.trim()
  )
    return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 0) return false;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
function canonicalTimestamp(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  )
    return false;
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}

export function isMetadataSuggestion(
  value: unknown,
): value is MetadataSuggestion {
  if (!object(value)) return false;
  const date = value.kind === 'date';
  if (
    !keys(value, [
      'kind',
      'value',
      'confidence',
      'page',
      'excerpt',
      ...(date ? ['dateRole'] : []),
    ])
  )
    return false;
  return (
    (date ||
      value.kind === 'type' ||
      value.kind === 'provider' ||
      value.kind === 'label') &&
    (!date ||
      value.dateRole === 'Report date' ||
      value.dateRole === 'Collection date') &&
    (value.confidence === 'explicit' || value.confidence === 'tentative') &&
    integer(value.page, 1) &&
    value.page <= 50 &&
    boundedText(value.value, 120) &&
    boundedText(value.excerpt, 240)
  );
}

export function isSaveMetadataSuggestions(
  value: unknown,
): value is SaveMetadataSuggestions {
  return (
    object(value) &&
    keys(value, [
      'requestId',
      'expectedRevision',
      'sourceRevision',
      'sourceSha256',
      'lifecycleVersion',
      'ruleVersion',
    ]) &&
    typeof value.requestId === 'string' &&
    uuid.test(value.requestId) &&
    integer(value.expectedRevision) &&
    integer(value.sourceRevision, 1) &&
    sourceSha(value.sourceSha256) &&
    integer(value.lifecycleVersion) &&
    value.ruleVersion === metadataSuggestionRuleVersion
  );
}

export function isMetadataSuggestionsContext(
  value: unknown,
): value is MetadataSuggestionsContext {
  return (
    object(value) &&
    keys(value, [
      'sourceRevision',
      'sourceSha256',
      'lifecycleVersion',
      'revision',
      'canSave',
    ]) &&
    integer(value.sourceRevision) &&
    sourceSha(value.sourceSha256) &&
    integer(value.lifecycleVersion) &&
    integer(value.revision) &&
    typeof value.canSave === 'boolean'
  );
}

export function isSavedMetadataSuggestions(
  value: unknown,
): value is SavedMetadataSuggestions {
  return (
    object(value) &&
    keys(value, [
      'revision',
      'sourceRevision',
      'sourceSha256',
      'ruleVersion',
      'suggestions',
      'savedAt',
      'unverified',
    ]) &&
    integer(value.revision, 1) &&
    integer(value.sourceRevision, 1) &&
    sourceSha(value.sourceSha256) &&
    value.ruleVersion === metadataSuggestionRuleVersion &&
    Array.isArray(value.suggestions) &&
    value.suggestions.length <= 12 &&
    Array.from(value.suggestions).every(isMetadataSuggestion) &&
    canonicalTimestamp(value.savedAt) &&
    value.unverified === true
  );
}

export function isMetadataSuggestionsReadResult(
  value: unknown,
): value is MetadataSuggestionsReadResult {
  if (
    !object(value) ||
    !keys(value, ['context', 'snapshot']) ||
    !isMetadataSuggestionsContext(value.context)
  )
    return false;
  // A stale snapshot is omitted without resetting its monotonic write revision.
  if (value.snapshot === null) return true;
  return (
    isSavedMetadataSuggestions(value.snapshot) &&
    value.snapshot.revision === value.context.revision &&
    value.snapshot.sourceRevision === value.context.sourceRevision &&
    value.snapshot.sourceSha256 === value.context.sourceSha256
  );
}
