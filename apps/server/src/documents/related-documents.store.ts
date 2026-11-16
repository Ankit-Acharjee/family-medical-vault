import { randomUUID } from 'node:crypto';
import {
  isMetadataSuggestionsReadResult,
  isRelatedDocumentsResult,
  isRelatedIsoDate,
  metadataSuggestionRuleVersion,
} from '@fmv/contracts';
import type {
  MetadataSuggestion,
  RelatedDocumentsResult,
  RelatedDocumentEvidence,
} from '@fmv/contracts';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { SearchAuthorization, SearchDocument } from './document.store.js';

type Row = SearchDocument & {
  title: string;
  sha256: string;
  lifecycleVersion: number;
  sourceRevision: number | null;
  extractionSha: string | null;
  metadataRevision: number | null;
  metadataSourceRevision: number | null;
  metadataSha: string | null;
  ruleVersion: string | null;
  suggestions: unknown;
  savedAt: Date | null;
};
export type RelatedScopes = {
  all: boolean;
  categories: string[];
  documents: string[];
};
function hints(row: Row): MetadataSuggestion[] | null {
  if (row.sourceRevision === null) return null;
  if (row.extractionSha !== row.sha256)
    throw new Error('Unavailable related documents');
  if (
    row.metadataRevision === null ||
    row.metadataSourceRevision !== row.sourceRevision ||
    row.metadataSha !== row.sha256
  )
    return null;
  const snapshot = {
    context: {
      sourceRevision: row.sourceRevision,
      sourceSha256: row.sha256,
      lifecycleVersion: row.lifecycleVersion,
      revision: row.metadataRevision,
      canSave: false,
    },
    snapshot: {
      revision: row.metadataRevision,
      sourceRevision: row.metadataSourceRevision,
      sourceSha256: row.metadataSha,
      ruleVersion: row.ruleVersion,
      suggestions: row.suggestions,
      savedAt: row.savedAt?.toISOString(),
      unverified: true,
    },
  };
  if (
    !isMetadataSuggestionsReadResult(snapshot) ||
    !snapshot.snapshot ||
    row.ruleVersion !== metadataSuggestionRuleVersion
  )
    throw new Error('Unavailable related documents');
  return snapshot.snapshot.suggestions;
}
function context(row: Row) {
  return {
    documentId: row.documentId,
    sourceSha256: row.sha256,
    sourceRevision: row.sourceRevision ?? 0,
    metadataRevision: row.metadataRevision ?? 0,
    lifecycleVersion: row.lifecycleVersion,
  };
}
function pairs(suggestions: MetadataSuggestion[]) {
  return {
    providers: suggestions.filter(
      (s) => s.kind === 'provider' && s.confidence === 'explicit',
    ),
    dates: suggestions.filter(
      (s) =>
        s.kind === 'date' &&
        s.confidence === 'explicit' &&
        isRelatedIsoDate(s.value),
    ),
  };
}
export function matchRelatedHints(
  source: MetadataSuggestion[],
  candidate: MetadataSuggestion[],
): RelatedDocumentEvidence | null {
  const a = pairs(source),
    b = pairs(candidate);
  for (const sourceProvider of a.providers)
    for (const sourceDate of a.dates)
      for (const candidateProvider of b.providers)
        for (const candidateDate of b.dates)
          if (
            sourceProvider.value === candidateProvider.value &&
            sourceDate.value === candidateDate.value &&
            sourceDate.dateRole === candidateDate.dateRole
          )
            return {
              sourceProvider,
              sourceDate,
              candidateProvider,
              candidateDate,
            };
  return null;
}
export async function readRelatedDocuments(
  client: PrismaClient,
  p: string,
  d: string,
  scopes: RelatedScopes,
  authorize: SearchAuthorization,
): Promise<RelatedDocumentsResult | null> {
  return client.$transaction(
    async (db) => {
      await db.$executeRaw`SET LOCAL statement_timeout='8s'`;
      // Select only current snapshots within View scopes before applying the bound.
      const candidateIds = await db.$queryRaw<
        { id: string }[]
      >`SELECT d.id FROM fmv.documents d JOIN fmv.document_extractions e ON e.document_id=d.id AND e.patient_id=d.patient_id AND e.source_sha256=d.sha256 JOIN fmv.document_metadata_snapshots m ON m.document_id=d.id AND m.patient_id=d.patient_id AND m.source_revision=e.revision AND m.source_sha256=d.sha256 WHERE d.patient_id=${p}::uuid AND d.id<>${d}::uuid AND d.state='ready' AND d.deleted_at IS NULL AND (${scopes.all} OR d.category_id=ANY(${scopes.categories}::uuid[]) OR d.id=ANY(${scopes.documents}::uuid[])) ORDER BY d.created_at DESC,d.id ASC LIMIT 201`;
      const ids = [d, ...candidateIds.map((x) => x.id)];
      const locked = await db.$queryRaw<
        SearchDocument[]
      >`SELECT d.id AS "documentId",d.patient_id AS "patientId",d.category_id AS "categoryId",d.state,d.deleted_at AS "deletedAt" FROM fmv.documents d WHERE d.patient_id=${p}::uuid AND d.id=ANY(${ids}::uuid[]) AND d.state='ready' AND d.deleted_at IS NULL ORDER BY d.id FOR NO KEY UPDATE OF d`;
      if (!locked.some((r) => r.documentId === d)) return null;
      const actor = await authorize(locked);
      // A fresh statement after acquiring locks sees commits that preceded lock acquisition.
      const rows = await db.$queryRaw<
        Row[]
      >`SELECT d.id AS "documentId",d.patient_id AS "patientId",d.category_id AS "categoryId",d.state,d.deleted_at AS "deletedAt",COALESCE(d.display_title,d.title) AS title,d.sha256,d.extraction_lifecycle AS "lifecycleVersion",e.revision AS "sourceRevision",e.source_sha256 AS "extractionSha",m.revision AS "metadataRevision",m.source_revision AS "metadataSourceRevision",m.source_sha256 AS "metadataSha",m.rule_version AS "ruleVersion",m.suggestions,m.saved_at AS "savedAt" FROM fmv.documents d LEFT JOIN fmv.document_extractions e ON e.document_id=d.id AND e.patient_id=d.patient_id LEFT JOIN fmv.document_metadata_snapshots m ON m.document_id=d.id AND m.patient_id=d.patient_id WHERE d.patient_id=${p}::uuid AND d.id=ANY(${locked.map((r) => r.documentId)}::uuid[]) ORDER BY d.id`;
      const source = rows.find((r) => r.documentId === d);
      if (!source || rows.length !== locked.length)
        throw new Error('Unavailable related documents');
      const candidates = candidateIds.flatMap(({ id }) => {
        const row = rows.find((r) => r.documentId === id);
        return row ? [row] : [];
      });
      if (candidates.length !== candidateIds.length)
        throw new Error('Unavailable related documents');
      // A changed snapshot cannot safely serve as a current truncation sentinel.
      for (const row of candidates)
        if (!hints(row)) throw new Error('Unavailable related documents');
      const sourceHints = hints(source);
      const sourcePairs = pairs(sourceHints ?? []);
      let result: RelatedDocumentsResult;
      if (!sourcePairs.providers.length || !sourcePairs.dates.length)
        result = {
          source: context(source),
          status: 'insufficient-hints',
          matches: [],
          limited: false,
        };
      else {
        const matches: RelatedDocumentsResult['matches'] = [];
        for (const row of candidates.slice(0, 200)) {
          const candidateHints = hints(row);
          const evidence =
            candidateHints && matchRelatedHints(sourceHints!, candidateHints);
          if (evidence)
            matches.push({ ...context(row), title: row.title, evidence });
        }
        result = {
          source: context(source),
          status: 'ready',
          matches: matches.slice(0, 20),
          limited: candidates.length > 200 || matches.length > 20,
        };
      }
      if (!isRelatedDocumentsResult(result))
        throw new Error('Unavailable related documents');
      const disclosed = [d, ...result.matches.map((m) => m.documentId)];
      const eventIds = disclosed.map(() => randomUUID());
      await db.$executeRaw`INSERT INTO fmv.document_events(id,patient_id,document_id,actor_account_id,kind) SELECT id,${p}::uuid,document_id,${actor}::uuid,'document.viewed' FROM unnest(${eventIds}::uuid[],${disclosed}::uuid[]) AS events(id,document_id)`;
      if ((await authorize(locked)) !== actor)
        throw new Error('Unavailable related documents');
      return result;
    },
    { maxWait: 5000, timeout: 15000 },
  );
}
