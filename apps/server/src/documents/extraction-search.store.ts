import { randomUUID } from 'node:crypto';
import { maximumDocumentSearchHits } from '@fmv/contracts';
import type { DocumentSearchInput, DocumentSearchResult } from '@fmv/contracts';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { SearchAuthorization, SearchDocument } from './document.store.js';

export async function searchExtractions(
  client: PrismaClient,
  patientId: string,
  input: DocumentSearchInput,
  eligibleIds: string[],
  authorize: SearchAuthorization,
): Promise<DocumentSearchResult> {
  return client.$transaction(
    async (db) => {
      // Keep query text out of paths, errors, events and database diagnostics.
      // Candidates are already View-eligible using the authoritative policy; final
      // checks cover every capped row including the sentinel before any disclosure.
      await db.$executeRaw`SET LOCAL statement_timeout='8s'`;
      const rows = await db.$queryRaw<SearchDocument[]>`
      WITH terms AS (
        SELECT tsvector_to_array(to_tsvector('pg_catalog.simple'::regconfig, ${input.query})) AS words
      )
      SELECT d.id AS "documentId",d.patient_id AS "patientId",d.category_id AS "categoryId",d.state,d.deleted_at AS "deletedAt"
      FROM fmv.documents d
      JOIN fmv.document_extractions e ON e.document_id=d.id AND e.patient_id=d.patient_id AND e.source_sha256=d.sha256
      CROSS JOIN terms
      WHERE d.patient_id=${patientId}::uuid AND d.id=ANY(${eligibleIds}::uuid[])
        AND d.state='ready' AND d.deleted_at IS NULL
        AND (${input.categoryId ?? null}::uuid IS NULL OR d.category_id=${input.categoryId ?? null}::uuid)
        AND (${input.uploadedFrom ?? null}::timestamptz IS NULL OR d.created_at>=${input.uploadedFrom ?? null}::timestamptz)
        AND (${input.uploadedBefore ?? null}::timestamptz IS NULL OR d.created_at<${input.uploadedBefore ?? null}::timestamptz)
        AND cardinality(terms.words)>0 AND e.search_terms @> terms.words
      ORDER BY d.created_at DESC,d.id ASC
      LIMIT ${maximumDocumentSearchHits + 1}
      FOR NO KEY UPDATE OF d`;
      const actor = await authorize(rows);
      const hits = rows.slice(0, maximumDocumentSearchHits);
      if (hits.length) {
        // Bulk audit only returned text-derived matches. Never persist the query,
        // text, or the extra sentinel used to signal a truncated result.
        const ids = hits.map((row) => row.documentId);
        const eventIds = hits.map(() => randomUUID());
        await db.$executeRaw`INSERT INTO fmv.document_events(id,patient_id,document_id,actor_account_id,kind)
        SELECT id,${patientId}::uuid,document_id,${actor}::uuid,'document.viewed'
        FROM unnest(${eventIds}::uuid[],${ids}::uuid[]) AS events(id,document_id)`;
      }
      if ((await authorize(rows)) !== actor)
        throw new Error('Search unavailable');
      return {
        documentIds: hits.map((row) => row.documentId),
        truncated: rows.length > maximumDocumentSearchHits,
      };
    },
    { maxWait: 5000, timeout: 15000 },
  );
}
