# Synthetic extraction search benchmark

Run: 2026-11-13T17:01:35.000Z; PostgreSQL 17.11 (Postgres.app); local Postgres.app disposable UTF8/C-locale cluster, 32MB shared buffers, 8MB work_mem, JIT off.
Requirements assessed: DOC-05 and AI-01. No runtime/migration changes. Synthetic data only; no project environment, retained database, cloud, Docker or new dependencies.

## Semantics and recommendation

Native pg_catalog.simple lexical search, all normalized query lexemes anywhere across a document’s saved pages[].text; no phrase/order/rank/substring/prefix/fuzzy/stemming/accent-folding guarantee. Blank/punctuation-only queries return no matches. JSON metadata is excluded. Patient filtering in this benchmark is a SQL predicate, not an authorization implementation.
One page may hold all 500,000 UTF-16 units of a PDF. A whole-document vector, a vector per page, and strip(to_tsvector(...)) cannot safely index every valid saved extraction: adversarial Unicode lexemes can exceed the native vector limit. Splitting raw text by character count also changes tokens at chunk boundaries.
Recommended minimal candidate: one generated/stored TEXT[] of DISTINCT native-simple lexemes per document, using ts_debug(simple, each pages[].text), unnest lexemes, omit native-ignored >=2047-byte lexemes, and GIN(array). Query with lexemes @> normalized-query-lexemes and require nonempty query lexemes. This supports AND across all pages without the tsvector size limit, secondary chunk table or grouping at read time. Maximum extraction source is bounded; measured maximum unique-token array size is reported below, far below the array 1GB limit. A SQL IMMUTABLE helper with explicitly fixed pg_catalog.simple config is suitable for a generated column; dictionary/parser config changes would require rebuild just as native text-search indexes do. Update/delete with the document; backfill existing results. Authorization, lifecycle fences and RLS need supervisor implementation/review.
The alternative bounded chunk design uses <=128 DISTINCT lexemes per page chunk and array_to_tsvector stored/generated vectors. Max lexeme payload <=262,016 bytes plus <=512 entry bytes, safely below 1MiB. It preserves all words but needs multiple rows and grouped reads.
Query each unique normalized term against the GIN chunks, group by document and require count(DISTINCT matching term)=query term count. A query is matched across chunks/pages. Merely EXISTS(chunk.vector @@ full_AND_query) would silently lose cross-page/chunk matches. Query length/token count needs an explicit bounded API contract before runtime use.

## Dataset and construction

Three ASCII pages/document, ~3.1k UTF-16 units/document, 100 evenly distributed patients; common term every document, rare term every 97th document; crossalpha/crossomega on separate pages. Indexes are created before loading. Times below include local Node↔Postgres round-trip. No concurrent users; no hosted-storage/network behavior inferred. All query timings are warm-cache, one warm-up; whole/page/chunk 20 samples, dynamic 5 samples. Query shape returns <=25 IDs, descending document ID, with no total-count or relevance/snippet work.
Representative pages have fewer than 128 unique lexemes, so construction/update timings use native to_tsvector → tsvector_to_array fast path, equivalent results for this corpus. These are NOT timings for the full ts_debug bounded ingest algorithm. Adversarial chunk derivation below exercises that algorithm directly.

| Documents | Source units/doc | Load ms | Whole build ms | Page build ms | Chunk fast-path build ms | Array bounded build ms | Whole GIN bytes | Page GIN bytes | Chunk GIN bytes | Array GIN bytes |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1000 | 3214 | 30.61 | 206.41 | 231.66 | 233.2 | 4569.23 | 614400 | 663552 | 663552 | 385024 |
| 10000 | 3214 | 455.54 | 2396.84 | 2663.31 | 2577.51 | 50197.75 | 5324800 | 5062656 | 5062656 | 3497984 |

## Query/update timings

Update is one document JSON replacement + rebuilding that strategy’s derived data, measured inside a transaction and rolled back. Excludes commit/fsync latency; repeated rollback/index churn may affect later measurements. The benchmark retains all three comparison indexes/tables concurrently, so these timings are comparative, not isolated production capacity.

| Documents | Strategy/case | Samples | Median ms | p95 ms | Returned IDs |
|---:|---|---:|---:|---:|---:|
| 1000 | whole/common | 20 | 0.61 | 0.96 | 25 |
| 1000 | page/common | 20 | 0.45 | 0.57 | 25 |
| 1000 | chunk/common | 20 | 1.46 | 1.83 | 25 |
| 1000 | array/common | 20 | 0.42 | 0.58 | 25 |
| 1000 | dynamic/common | 5 | 170.7 | 193.67 | 25 |
| 1000 | whole/rare | 20 | 0.45 | 0.83 | 10 |
| 1000 | page/rare | 20 | 0.25 | 0.4 | 10 |
| 1000 | chunk/rare | 20 | 0.32 | 0.37 | 10 |
| 1000 | array/rare | 20 | 0.2 | 0.31 | 10 |
| 1000 | dynamic/rare | 5 | 167.69 | 188.22 | 10 |
| 1000 | whole/missing | 20 | 0.32 | 0.56 | 0 |
| 1000 | page/missing | 20 | 0.18 | 0.27 | 0 |
| 1000 | chunk/missing | 20 | 0.28 | 0.41 | 0 |
| 1000 | array/missing | 20 | 0.24 | 0.44 | 0 |
| 1000 | dynamic/missing | 5 | 164.39 | 167.84 | 0 |
| 1000 | whole/cross-pages | 20 | 0.38 | 0.52 | 25 |
| 1000 | page/cross-pages | 20 | 0.72 | 0.96 | 0 |
| 1000 | chunk/cross-pages | 20 | 1.14 | 1.57 | 25 |
| 1000 | array/cross-pages | 20 | 0.22 | 0.42 | 25 |
| 1000 | dynamic/cross-pages | 5 | 164.23 | 165.43 | 25 |
| 1000 | whole/patient-common | 20 | 0.33 | 0.51 | 10 |
| 1000 | page/patient-common | 20 | 0.21 | 0.26 | 10 |
| 1000 | chunk/patient-common | 20 | 0.56 | 0.8 | 10 |
| 1000 | array/patient-common | 20 | 0.22 | 0.31 | 10 |
| 1000 | dynamic/patient-common | 5 | 2.05 | 2.31 | 10 |
| 1000 | whole/patient-rare | 20 | 0.22 | 0.38 | 0 |
| 1000 | page/patient-rare | 20 | 0.19 | 0.34 | 0 |
| 1000 | chunk/patient-rare | 20 | 0.41 | 1.04 | 0 |
| 1000 | array/patient-rare | 20 | 0.29 | 1.04 | 0 |
| 1000 | dynamic/patient-rare | 5 | 2.09 | 2.9 | 0 |
| 1000 | whole/update-rollback | 20 | 0.55 | 0.71 | 1 |
| 1000 | page/update-rollback | 20 | 0.76 | 1.16 | 1 |
| 1000 | chunk/update-rollback | 20 | 0.77 | 1.06 | 1 |
| 1000 | array/update-rollback | 20 | 5.13 | 6.05 | 1 |
| 10000 | whole/common | 20 | 0.32 | 0.46 | 25 |
| 10000 | page/common | 20 | 0.21 | 0.38 | 25 |
| 10000 | chunk/common | 20 | 9.45 | 10.92 | 25 |
| 10000 | array/common | 20 | 0.34 | 0.46 | 25 |
| 10000 | dynamic/common | 5 | 4.38 | 5.4 | 25 |
| 10000 | whole/rare | 20 | 0.42 | 0.53 | 25 |
| 10000 | page/rare | 20 | 0.34 | 0.42 | 25 |
| 10000 | chunk/rare | 20 | 0.38 | 0.46 | 25 |
| 10000 | array/rare | 20 | 0.26 | 0.41 | 25 |
| 10000 | dynamic/rare | 5 | 394.67 | 449.89 | 25 |
| 10000 | whole/missing | 20 | 0.32 | 0.46 | 0 |
| 10000 | page/missing | 20 | 0.16 | 0.32 | 0 |
| 10000 | chunk/missing | 20 | 0.22 | 0.28 | 0 |
| 10000 | array/missing | 20 | 0.14 | 0.17 | 0 |
| 10000 | dynamic/missing | 5 | 1654.1 | 2186.46 | 0 |
| 10000 | whole/cross-pages | 20 | 0.33 | 0.65 | 25 |
| 10000 | page/cross-pages | 20 | 6.13 | 8.07 | 0 |
| 10000 | chunk/cross-pages | 20 | 0.51 | 0.76 | 25 |
| 10000 | array/cross-pages | 20 | 0.22 | 0.25 | 25 |
| 10000 | dynamic/cross-pages | 5 | 1772.04 | 1981.61 | 25 |
| 10000 | whole/patient-common | 20 | 0.31 | 0.4 | 25 |
| 10000 | page/patient-common | 20 | 0.19 | 0.25 | 25 |
| 10000 | chunk/patient-common | 20 | 2.52 | 2.91 | 25 |
| 10000 | array/patient-common | 20 | 0.31 | 0.46 | 25 |
| 10000 | dynamic/patient-common | 5 | 17.13 | 17.78 | 25 |
| 10000 | whole/patient-rare | 20 | 0.3 | 0.38 | 1 |
| 10000 | page/patient-rare | 20 | 0.17 | 0.29 | 1 |
| 10000 | chunk/patient-rare | 20 | 0.34 | 0.56 | 1 |
| 10000 | array/patient-rare | 20 | 0.2 | 0.25 | 1 |
| 10000 | dynamic/patient-rare | 5 | 17.19 | 17.42 | 1 |
| 10000 | whole/update-rollback | 20 | 0.6 | 1.02 | 1 |
| 10000 | page/update-rollback | 20 | 0.66 | 0.79 | 1 |
| 10000 | chunk/update-rollback | 20 | 0.74 | 1.07 | 1 |
| 10000 | array/update-rollback | 20 | 5.24 | 5.83 | 1 |

## Edge-case observations (actual database results)

```json
[
  {
    "name": "case",
    "matches": true,
    "document_lexemes": 3,
    "query_nodes": 3,
    "chunkMatches": true,
    "arrayMatches": true
  },
  {
    "name": "accent-preserved",
    "matches": false,
    "document_lexemes": 2,
    "query_nodes": 1,
    "chunkMatches": false,
    "arrayMatches": false
  },
  {
    "name": "accent-exact",
    "matches": true,
    "document_lexemes": 2,
    "query_nodes": 1,
    "chunkMatches": true,
    "arrayMatches": true
  },
  {
    "name": "cjk-whole-token",
    "matches": false,
    "document_lexemes": 1,
    "query_nodes": 1,
    "chunkMatches": false,
    "arrayMatches": false
  },
  {
    "name": "cjk-spaced",
    "matches": true,
    "document_lexemes": 3,
    "query_nodes": 1,
    "chunkMatches": true,
    "arrayMatches": true
  },
  {
    "name": "emoji",
    "matches": true,
    "document_lexemes": 3,
    "query_nodes": 1,
    "chunkMatches": true,
    "arrayMatches": true
  },
  {
    "name": "longword-2047",
    "matches": false,
    "document_lexemes": 0,
    "query_nodes": 0,
    "chunkMatches": false,
    "arrayMatches": false
  },
  {
    "name": "longword-2048",
    "matches": false,
    "document_lexemes": 0,
    "query_nodes": 0,
    "chunkMatches": false,
    "arrayMatches": false
  },
  {
    "name": "empty-query",
    "matches": false,
    "document_lexemes": 2,
    "query_nodes": 0,
    "chunkMatches": false,
    "arrayMatches": false
  },
  {
    "name": "punctuation-query",
    "matches": false,
    "document_lexemes": 2,
    "query_nodes": 0,
    "chunkMatches": false,
    "arrayMatches": false
  },
  {
    "name": "simple-stopwords",
    "matches": true,
    "document_lexemes": 3,
    "query_nodes": 1,
    "chunkMatches": true,
    "arrayMatches": true
  },
  {
    "name": "parser-compounds",
    "matches": true,
    "document_lexemes": 4,
    "query_nodes": 3,
    "chunkMatches": true,
    "arrayMatches": true
  },
  {
    "name": "normalization-nfc-vs-nfd",
    "matches": false,
    "document_lexemes": 1,
    "query_nodes": 1,
    "chunkMatches": false,
    "arrayMatches": false
  },
  {
    "name": "pdf-one-page",
    "utf16Units": 500000,
    "utf8Bytes": 1250000,
    "pages": 1,
    "whole": {
      "error": "54000",
      "message": "string is too long for tsvector (1750000 bytes, max 1048575 bytes)"
    },
    "whole-strip": {
      "error": "54000",
      "message": "string is too long for tsvector (1750000 bytes, max 1048575 bytes)"
    },
    "page": {
      "error": "54000",
      "message": "string is too long for tsvector (1750000 bytes, max 1048575 bytes)"
    },
    "chunk": {
      "chunks": "977",
      "lexemes": "125000",
      "max_vector_bytes": 1672,
      "ms": 1765.08
    },
    "array": {
      "lexemes": 125000,
      "bytes": 2000024,
      "ms": 3473.89,
      "note": "timing computes helper twice for count and byte size"
    },
    "generatedArraySaveWithGinMs": 2497.87,
    "firstAndLastTerms": {
      "chunks_match": true,
      "array_matches": true
    }
  },
  {
    "name": "pdf-fifty-pages",
    "utf16Units": 500000,
    "utf8Bytes": 1250000,
    "pages": 50,
    "whole": {
      "error": "54000",
      "message": "string is too long for tsvector (1750000 bytes, max 1048575 bytes)"
    },
    "whole-strip": {
      "error": "54000",
      "message": "string is too long for tsvector (1750000 bytes, max 1048575 bytes)"
    },
    "page": {
      "max_bytes": 45008
    },
    "chunk": {
      "chunks": "1000",
      "lexemes": "125000",
      "max_vector_bytes": 1672,
      "ms": 1587.4
    },
    "array": {
      "lexemes": 125000,
      "bytes": 2000024,
      "ms": 3121.55,
      "note": "timing computes helper twice for count and byte size"
    },
    "generatedArraySaveWithGinMs": 2974.18,
    "firstAndLastTerms": {
      "chunks_match": true,
      "array_matches": true
    }
  },
  {
    "name": "image-one-page",
    "utf16Units": 100000,
    "utf8Bytes": 250000,
    "pages": 1,
    "whole": {
      "bytes": 450008
    },
    "whole-strip": {
      "bytes": 325008
    },
    "page": {
      "max_bytes": 450008
    },
    "chunk": {
      "chunks": "196",
      "lexemes": "25000",
      "max_vector_bytes": 1672,
      "ms": 314.77
    },
    "array": {
      "lexemes": 25000,
      "bytes": 400024,
      "ms": 600.88,
      "note": "timing computes helper twice for count and byte size"
    },
    "generatedArraySaveWithGinMs": 311.86,
    "firstAndLastTerms": {
      "chunks_match": true,
      "array_matches": true
    }
  },
  {
    "name": "metadata-excluded",
    "matches": 0
  },
  {
    "name": "cross-page-and",
    "whole": 25,
    "samePage": 0,
    "chunkDocumentAnd": 25
  }
]
```

## Chunk rare-term EXPLAIN evidence

```json
[
  {
    "size": 1000,
    "rareChunkPlan": {
      "Plan": {
        "Node Type": "Limit",
        "Parallel Aware": false,
        "Async Capable": false,
        "Startup Cost": 49.62,
        "Total Cost": 49.92,
        "Plan Rows": 15,
        "Plan Width": 4,
        "Actual Startup Time": 0.042,
        "Actual Total Time": 0.047,
        "Actual Rows": 10,
        "Actual Loops": 1,
        "Shared Hit Blocks": 13,
        "Shared Read Blocks": 0,
        "Shared Dirtied Blocks": 0,
        "Shared Written Blocks": 0,
        "Local Hit Blocks": 0,
        "Local Read Blocks": 0,
        "Local Dirtied Blocks": 0,
        "Local Written Blocks": 0,
        "Temp Read Blocks": 0,
        "Temp Written Blocks": 0,
        "Plans": [
          {
            "Node Type": "Function Scan",
            "Parent Relationship": "InitPlan",
            "Subplan Name": "CTE terms",
            "Parallel Aware": false,
            "Async Capable": false,
            "Function Name": "unnest",
            "Alias": "lexeme",
            "Startup Cost": 0,
            "Total Cost": 0.03,
            "Plan Rows": 1,
            "Plan Width": 64,
            "Actual Startup Time": 0.007,
            "Actual Total Time": 0.007,
            "Actual Rows": 1,
            "Actual Loops": 1,
            "Shared Hit Blocks": 0,
            "Shared Read Blocks": 0,
            "Shared Dirtied Blocks": 0,
            "Shared Written Blocks": 0,
            "Local Hit Blocks": 0,
            "Local Read Blocks": 0,
            "Local Dirtied Blocks": 0,
            "Local Written Blocks": 0,
            "Temp Read Blocks": 0,
            "Temp Written Blocks": 0
          },
          {
            "Node Type": "Aggregate",
            "Strategy": "Plain",
            "Partial Mode": "Simple",
            "Parent Relationship": "InitPlan",
            "Subplan Name": "InitPlan 2",
            "Parallel Aware": false,
            "Async Capable": false,
            "Startup Cost": 0.02,
            "Total Cost": 0.03,
            "Plan Rows": 1,
            "Plan Width": 8,
            "Actual Startup Time": 0.001,
            "Actual Total Time": 0.001,
            "Actual Rows": 1,
            "Actual Loops": 1,
            "Shared Hit Blocks": 0,
            "Shared Read Blocks": 0,
            "Shared Dirtied Blocks": 0,
            "Shared Written Blocks": 0,
            "Local Hit Blocks": 0,
            "Local Read Blocks": 0,
            "Local Dirtied Blocks": 0,
            "Local Written Blocks": 0,
            "Temp Read Blocks": 0,
            "Temp Written Blocks": 0,
            "Plans": [
              {
                "Node Type": "CTE Scan",
                "Parent Relationship": "Outer",
                "Parallel Aware": false,
                "Async Capable": false,
                "CTE Name": "terms",
                "Alias": "terms",
                "Startup Cost": 0,
                "Total Cost": 0.02,
                "Plan Rows": 1,
                "Plan Width": 0,
                "Actual Startup Time": 0,
                "Actual Total Time": 0,
                "Actual Rows": 1,
                "Actual Loops": 1,
                "Shared Hit Blocks": 0,
                "Shared Read Blocks": 0,
                "Shared Dirtied Blocks": 0,
                "Shared Written Blocks": 0,
                "Local Hit Blocks": 0,
                "Local Read Blocks": 0,
                "Local Dirtied Blocks": 0,
                "Local Written Blocks": 0,
                "Temp Read Blocks": 0,
                "Temp Written Blocks": 0
              }
            ]
          },
          {
            "Node Type": "Aggregate",
            "Strategy": "Sorted",
            "Partial Mode": "Simple",
            "Parent Relationship": "Outer",
            "Parallel Aware": false,
            "Async Capable": false,
            "Startup Cost": 49.57,
            "Total Cost": 49.87,
            "Plan Rows": 15,
            "Plan Width": 4,
            "Actual Startup Time": 0.042,
            "Actual Total Time": 0.046,
            "Actual Rows": 10,
            "Actual Loops": 1,
            "Group Key": [
              "c.document_id"
            ],
            "Filter": "(count(DISTINCT t.lexeme) = (InitPlan 2).col1)",
            "Rows Removed by Filter": 0,
            "Shared Hit Blocks": 13,
            "Shared Read Blocks": 0,
            "Shared Dirtied Blocks": 0,
            "Shared Written Blocks": 0,
            "Local Hit Blocks": 0,
            "Local Read Blocks": 0,
            "Local Dirtied Blocks": 0,
            "Local Written Blocks": 0,
            "Temp Read Blocks": 0,
            "Temp Written Blocks": 0,
            "Plans": [
              {
                "Node Type": "Sort",
                "Parent Relationship": "Outer",
                "Parallel Aware": false,
                "Async Capable": false,
                "Startup Cost": 49.57,
                "Total Cost": 49.6,
                "Plan Rows": 15,
                "Plan Width": 36,
                "Actual Startup Time": 0.037,
                "Actual Total Time": 0.038,
                "Actual Rows": 10,
                "Actual Loops": 1,
                "Sort Key": [
                  "c.document_id DESC",
                  "t.lexeme"
                ],
                "Sort Method": "quicksort",
                "Sort Space Used": 25,
                "Sort Space Type": "Memory",
                "Shared Hit Blocks": 13,
                "Shared Read Blocks": 0,
                "Shared Dirtied Blocks": 0,
                "Shared Written Blocks": 0,
                "Local Hit Blocks": 0,
                "Local Read Blocks": 0,
                "Local Dirtied Blocks": 0,
                "Local Written Blocks": 0,
                "Temp Read Blocks": 0,
                "Temp Written Blocks": 0,
                "Plans": [
                  {
                    "Node Type": "Nested Loop",
                    "Parent Relationship": "Outer",
                    "Parallel Aware": false,
                    "Async Capable": false,
                    "Join Type": "Inner",
                    "Startup Cost": 8.63,
                    "Total Cost": 49.27,
                    "Plan Rows": 15,
                    "Plan Width": 36,
                    "Actual Startup Time": 0.023,
                    "Actual Total Time": 0.032,
                    "Actual Rows": 10,
                    "Actual Loops": 1,
                    "Inner Unique": false,
                    "Shared Hit Blocks": 13,
                    "Shared Read Blocks": 0,
                    "Shared Dirtied Blocks": 0,
                    "Shared Written Blocks": 0,
                    "Local Hit Blocks": 0,
                    "Local Read Blocks": 0,
                    "Local Dirtied Blocks": 0,
                    "Local Written Blocks": 0,
                    "Temp Read Blocks": 0,
                    "Temp Written Blocks": 0,
                    "Plans": [
                      {
                        "Node Type": "CTE Scan",
                        "Parent Relationship": "Outer",
                        "Parallel Aware": false,
                        "Async Capable": false,
                        "CTE Name": "terms",
                        "Alias": "t",
                        "Startup Cost": 0,
                        "Total Cost": 0.02,
                        "Plan Rows": 1,
                        "Plan Width": 64,
                        "Actual Startup Time": 0.008,
                        "Actual Total Time": 0.008,
                        "Actual Rows": 1,
                        "Actual Loops": 1,
                        "Shared Hit Blocks": 0,
                        "Shared Read Blocks": 0,
                        "Shared Dirtied Blocks": 0,
                        "Shared Written Blocks": 0,
                        "Local Hit Blocks": 0,
                        "Local Read Blocks": 0,
                        "Local Dirtied Blocks": 0,
                        "Local Written Blocks": 0,
                        "Temp Read Blocks": 0,
                        "Temp Written Blocks": 0
                      },
                      {
                        "Node Type": "Bitmap Heap Scan",
                        "Parent Relationship": "Inner",
                        "Parallel Aware": false,
                        "Async Capable": false,
                        "Relation Name": "bench_chunks",
                        "Alias": "c",
                        "Startup Cost": 8.63,
                        "Total Cost": 49.1,
                        "Plan Rows": 15,
                        "Plan Width": 99,
                        "Actual Startup Time": 0.014,
                        "Actual Total Time": 0.021,
                        "Actual Rows": 10,
                        "Actual Loops": 1,
                        "Recheck Cond": "(vector @@ t.query)",
                        "Rows Removed by Index Recheck": 0,
                        "Exact Heap Blocks": 10,
                        "Lossy Heap Blocks": 0,
                        "Shared Hit Blocks": 13,
                        "Shared Read Blocks": 0,
                        "Shared Dirtied Blocks": 0,
                        "Shared Written Blocks": 0,
                        "Local Hit Blocks": 0,
                        "Local Read Blocks": 0,
                        "Local Dirtied Blocks": 0,
                        "Local Written Blocks": 0,
                        "Temp Read Blocks": 0,
                        "Temp Written Blocks": 0,
                        "Plans": [
                          {
                            "Node Type": "Bitmap Index Scan",
                            "Parent Relationship": "Outer",
                            "Parallel Aware": false,
                            "Async Capable": false,
                            "Index Name": "bench_chunk_gin",
                            "Startup Cost": 0,
                            "Total Cost": 8.63,
                            "Plan Rows": 15,
                            "Plan Width": 0,
                            "Actual Startup Time": 0.008,
                            "Actual Total Time": 0.008,
                            "Actual Rows": 10,
                            "Actual Loops": 1,
                            "Index Cond": "(vector @@ t.query)",
                            "Shared Hit Blocks": 3,
                            "Shared Read Blocks": 0,
                            "Shared Dirtied Blocks": 0,
                            "Shared Written Blocks": 0,
                            "Local Hit Blocks": 0,
                            "Local Read Blocks": 0,
                            "Local Dirtied Blocks": 0,
                            "Local Written Blocks": 0,
                            "Temp Read Blocks": 0,
                            "Temp Written Blocks": 0
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      },
      "Planning": {
        "Shared Hit Blocks": 1,
        "Shared Read Blocks": 0,
        "Shared Dirtied Blocks": 0,
        "Shared Written Blocks": 0,
        "Local Hit Blocks": 0,
        "Local Read Blocks": 0,
        "Local Dirtied Blocks": 0,
        "Local Written Blocks": 0,
        "Temp Read Blocks": 0,
        "Temp Written Blocks": 0
      },
      "Planning Time": 0.106,
      "Triggers": [],
      "Execution Time": 0.071
    },
    "rareArrayPlan": {
      "Plan": {
        "Node Type": "Limit",
        "Parallel Aware": false,
        "Async Capable": false,
        "Startup Cost": 43.83,
        "Total Cost": 43.86,
        "Plan Rows": 10,
        "Plan Width": 4,
        "Actual Startup Time": 0.022,
        "Actual Total Time": 0.023,
        "Actual Rows": 10,
        "Actual Loops": 1,
        "Shared Hit Blocks": 13,
        "Shared Read Blocks": 0,
        "Shared Dirtied Blocks": 0,
        "Shared Written Blocks": 0,
        "Local Hit Blocks": 0,
        "Local Read Blocks": 0,
        "Local Dirtied Blocks": 0,
        "Local Written Blocks": 0,
        "Temp Read Blocks": 0,
        "Temp Written Blocks": 0,
        "Plans": [
          {
            "Node Type": "Sort",
            "Parent Relationship": "Outer",
            "Parallel Aware": false,
            "Async Capable": false,
            "Startup Cost": 43.83,
            "Total Cost": 43.86,
            "Plan Rows": 10,
            "Plan Width": 4,
            "Actual Startup Time": 0.021,
            "Actual Total Time": 0.022,
            "Actual Rows": 10,
            "Actual Loops": 1,
            "Sort Key": [
              "id DESC"
            ],
            "Sort Method": "quicksort",
            "Sort Space Used": 25,
            "Sort Space Type": "Memory",
            "Shared Hit Blocks": 13,
            "Shared Read Blocks": 0,
            "Shared Dirtied Blocks": 0,
            "Shared Written Blocks": 0,
            "Local Hit Blocks": 0,
            "Local Read Blocks": 0,
            "Local Dirtied Blocks": 0,
            "Local Written Blocks": 0,
            "Temp Read Blocks": 0,
            "Temp Written Blocks": 0,
            "Plans": [
              {
                "Node Type": "Bitmap Heap Scan",
                "Parent Relationship": "Outer",
                "Parallel Aware": false,
                "Async Capable": false,
                "Relation Name": "bench_documents",
                "Alias": "bench_documents",
                "Startup Cost": 8.6,
                "Total Cost": 43.67,
                "Plan Rows": 10,
                "Plan Width": 4,
                "Actual Startup Time": 0.01,
                "Actual Total Time": 0.019,
                "Actual Rows": 10,
                "Actual Loops": 1,
                "Recheck Cond": "(lexemes @> '{rareanchor}'::text[])",
                "Rows Removed by Index Recheck": 0,
                "Exact Heap Blocks": 10,
                "Lossy Heap Blocks": 0,
                "Shared Hit Blocks": 13,
                "Shared Read Blocks": 0,
                "Shared Dirtied Blocks": 0,
                "Shared Written Blocks": 0,
                "Local Hit Blocks": 0,
                "Local Read Blocks": 0,
                "Local Dirtied Blocks": 0,
                "Local Written Blocks": 0,
                "Temp Read Blocks": 0,
                "Temp Written Blocks": 0,
                "Plans": [
                  {
                    "Node Type": "Bitmap Index Scan",
                    "Parent Relationship": "Outer",
                    "Parallel Aware": false,
                    "Async Capable": false,
                    "Index Name": "bench_array_gin",
                    "Startup Cost": 0,
                    "Total Cost": 8.6,
                    "Plan Rows": 10,
                    "Plan Width": 0,
                    "Actual Startup Time": 0.006,
                    "Actual Total Time": 0.006,
                    "Actual Rows": 10,
                    "Actual Loops": 1,
                    "Index Cond": "(lexemes @> '{rareanchor}'::text[])",
                    "Shared Hit Blocks": 3,
                    "Shared Read Blocks": 0,
                    "Shared Dirtied Blocks": 0,
                    "Shared Written Blocks": 0,
                    "Local Hit Blocks": 0,
                    "Local Read Blocks": 0,
                    "Local Dirtied Blocks": 0,
                    "Local Written Blocks": 0,
                    "Temp Read Blocks": 0,
                    "Temp Written Blocks": 0
                  }
                ]
              }
            ]
          }
        ]
      },
      "Planning": {
        "Shared Hit Blocks": 1,
        "Shared Read Blocks": 0,
        "Shared Dirtied Blocks": 0,
        "Shared Written Blocks": 0,
        "Local Hit Blocks": 0,
        "Local Read Blocks": 0,
        "Local Dirtied Blocks": 0,
        "Local Written Blocks": 0,
        "Temp Read Blocks": 0,
        "Temp Written Blocks": 0
      },
      "Planning Time": 0.063,
      "Triggers": [],
      "Execution Time": 0.031
    }
  },
  {
    "size": 10000,
    "rareChunkPlan": {
      "Plan": {
        "Node Type": "Limit",
        "Parallel Aware": false,
        "Async Capable": false,
        "Startup Cost": 425.33,
        "Total Cost": 425.83,
        "Plan Rows": 25,
        "Plan Width": 4,
        "Actual Startup Time": 0.332,
        "Actual Total Time": 0.343,
        "Actual Rows": 25,
        "Actual Loops": 1,
        "Shared Hit Blocks": 58,
        "Shared Read Blocks": 48,
        "Shared Dirtied Blocks": 0,
        "Shared Written Blocks": 0,
        "Local Hit Blocks": 0,
        "Local Read Blocks": 0,
        "Local Dirtied Blocks": 0,
        "Local Written Blocks": 0,
        "Temp Read Blocks": 0,
        "Temp Written Blocks": 0,
        "Plans": [
          {
            "Node Type": "Function Scan",
            "Parent Relationship": "InitPlan",
            "Subplan Name": "CTE terms",
            "Parallel Aware": false,
            "Async Capable": false,
            "Function Name": "unnest",
            "Alias": "lexeme",
            "Startup Cost": 0,
            "Total Cost": 0.03,
            "Plan Rows": 1,
            "Plan Width": 64,
            "Actual Startup Time": 0.008,
            "Actual Total Time": 0.008,
            "Actual Rows": 1,
            "Actual Loops": 1,
            "Shared Hit Blocks": 0,
            "Shared Read Blocks": 0,
            "Shared Dirtied Blocks": 0,
            "Shared Written Blocks": 0,
            "Local Hit Blocks": 0,
            "Local Read Blocks": 0,
            "Local Dirtied Blocks": 0,
            "Local Written Blocks": 0,
            "Temp Read Blocks": 0,
            "Temp Written Blocks": 0
          },
          {
            "Node Type": "Aggregate",
            "Strategy": "Plain",
            "Partial Mode": "Simple",
            "Parent Relationship": "InitPlan",
            "Subplan Name": "InitPlan 2",
            "Parallel Aware": false,
            "Async Capable": false,
            "Startup Cost": 0.02,
            "Total Cost": 0.03,
            "Plan Rows": 1,
            "Plan Width": 8,
            "Actual Startup Time": 0.001,
            "Actual Total Time": 0.002,
            "Actual Rows": 1,
            "Actual Loops": 1,
            "Shared Hit Blocks": 0,
            "Shared Read Blocks": 0,
            "Shared Dirtied Blocks": 0,
            "Shared Written Blocks": 0,
            "Local Hit Blocks": 0,
            "Local Read Blocks": 0,
            "Local Dirtied Blocks": 0,
            "Local Written Blocks": 0,
            "Temp Read Blocks": 0,
            "Temp Written Blocks": 0,
            "Plans": [
              {
                "Node Type": "CTE Scan",
                "Parent Relationship": "Outer",
                "Parallel Aware": false,
                "Async Capable": false,
                "CTE Name": "terms",
                "Alias": "terms",
                "Startup Cost": 0,
                "Total Cost": 0.02,
                "Plan Rows": 1,
                "Plan Width": 0,
                "Actual Startup Time": 0,
                "Actual Total Time": 0,
                "Actual Rows": 1,
                "Actual Loops": 1,
                "Shared Hit Blocks": 0,
                "Shared Read Blocks": 0,
                "Shared Dirtied Blocks": 0,
                "Shared Written Blocks": 0,
                "Local Hit Blocks": 0,
                "Local Read Blocks": 0,
                "Local Dirtied Blocks": 0,
                "Local Written Blocks": 0,
                "Temp Read Blocks": 0,
                "Temp Written Blocks": 0
              }
            ]
          },
          {
            "Node Type": "Aggregate",
            "Strategy": "Sorted",
            "Partial Mode": "Simple",
            "Parent Relationship": "Outer",
            "Parallel Aware": false,
            "Async Capable": false,
            "Startup Cost": 425.28,
            "Total Cost": 428.28,
            "Plan Rows": 150,
            "Plan Width": 4,
            "Actual Startup Time": 0.331,
            "Actual Total Time": 0.34,
            "Actual Rows": 25,
            "Actual Loops": 1,
            "Group Key": [
              "c.document_id"
            ],
            "Filter": "(count(DISTINCT t.lexeme) = (InitPlan 2).col1)",
            "Rows Removed by Filter": 0,
            "Shared Hit Blocks": 58,
            "Shared Read Blocks": 48,
            "Shared Dirtied Blocks": 0,
            "Shared Written Blocks": 0,
            "Local Hit Blocks": 0,
            "Local Read Blocks": 0,
            "Local Dirtied Blocks": 0,
            "Local Written Blocks": 0,
            "Temp Read Blocks": 0,
            "Temp Written Blocks": 0,
            "Plans": [
              {
                "Node Type": "Sort",
                "Parent Relationship": "Outer",
                "Parallel Aware": false,
                "Async Capable": false,
                "Startup Cost": 425.28,
                "Total Cost": 425.65,
                "Plan Rows": 150,
                "Plan Width": 36,
                "Actual Startup Time": 0.325,
                "Actual Total Time": 0.327,
                "Actual Rows": 26,
                "Actual Loops": 1,
                "Sort Key": [
                  "c.document_id DESC",
                  "t.lexeme"
                ],
                "Sort Method": "quicksort",
                "Sort Space Used": 28,
                "Sort Space Type": "Memory",
                "Shared Hit Blocks": 58,
                "Shared Read Blocks": 48,
                "Shared Dirtied Blocks": 0,
                "Shared Written Blocks": 0,
                "Local Hit Blocks": 0,
                "Local Read Blocks": 0,
                "Local Dirtied Blocks": 0,
                "Local Written Blocks": 0,
                "Temp Read Blocks": 0,
                "Temp Written Blocks": 0,
                "Plans": [
                  {
                    "Node Type": "Nested Loop",
                    "Parent Relationship": "Outer",
                    "Parallel Aware": false,
                    "Async Capable": false,
                    "Join Type": "Inner",
                    "Startup Cost": 13.61,
                    "Total Cost": 419.86,
                    "Plan Rows": 150,
                    "Plan Width": 36,
                    "Actual Startup Time": 0.079,
                    "Actual Total Time": 0.307,
                    "Actual Rows": 103,
                    "Actual Loops": 1,
                    "Inner Unique": false,
                    "Shared Hit Blocks": 58,
                    "Shared Read Blocks": 48,
                    "Shared Dirtied Blocks": 0,
                    "Shared Written Blocks": 0,
                    "Local Hit Blocks": 0,
                    "Local Read Blocks": 0,
                    "Local Dirtied Blocks": 0,
                    "Local Written Blocks": 0,
                    "Temp Read Blocks": 0,
                    "Temp Written Blocks": 0,
                    "Plans": [
                      {
                        "Node Type": "CTE Scan",
                        "Parent Relationship": "Outer",
                        "Parallel Aware": false,
                        "Async Capable": false,
                        "CTE Name": "terms",
                        "Alias": "t",
                        "Startup Cost": 0,
                        "Total Cost": 0.02,
                        "Plan Rows": 1,
                        "Plan Width": 64,
                        "Actual Startup Time": 0.009,
                        "Actual Total Time": 0.009,
                        "Actual Rows": 1,
                        "Actual Loops": 1,
                        "Shared Hit Blocks": 0,
                        "Shared Read Blocks": 0,
                        "Shared Dirtied Blocks": 0,
                        "Shared Written Blocks": 0,
                        "Local Hit Blocks": 0,
                        "Local Read Blocks": 0,
                        "Local Dirtied Blocks": 0,
                        "Local Written Blocks": 0,
                        "Temp Read Blocks": 0,
                        "Temp Written Blocks": 0
                      },
                      {
                        "Node Type": "Bitmap Heap Scan",
                        "Parent Relationship": "Inner",
                        "Parallel Aware": false,
                        "Async Capable": false,
                        "Relation Name": "bench_chunks",
                        "Alias": "c",
                        "Startup Cost": 13.61,
                        "Total Cost": 418.34,
                        "Plan Rows": 150,
                        "Plan Width": 99,
                        "Actual Startup Time": 0.069,
                        "Actual Total Time": 0.282,
                        "Actual Rows": 103,
                        "Actual Loops": 1,
                        "Recheck Cond": "(vector @@ t.query)",
                        "Rows Removed by Index Recheck": 0,
                        "Exact Heap Blocks": 103,
                        "Lossy Heap Blocks": 0,
                        "Shared Hit Blocks": 58,
                        "Shared Read Blocks": 48,
                        "Shared Dirtied Blocks": 0,
                        "Shared Written Blocks": 0,
                        "Local Hit Blocks": 0,
                        "Local Read Blocks": 0,
                        "Local Dirtied Blocks": 0,
                        "Local Written Blocks": 0,
                        "Temp Read Blocks": 0,
                        "Temp Written Blocks": 0,
                        "Plans": [
                          {
                            "Node Type": "Bitmap Index Scan",
                            "Parent Relationship": "Outer",
                            "Parallel Aware": false,
                            "Async Capable": false,
                            "Index Name": "bench_chunk_gin",
                            "Startup Cost": 0,
                            "Total Cost": 13.57,
                            "Plan Rows": 150,
                            "Plan Width": 0,
                            "Actual Startup Time": 0.043,
                            "Actual Total Time": 0.043,
                            "Actual Rows": 103,
                            "Actual Loops": 1,
                            "Index Cond": "(vector @@ t.query)",
                            "Shared Hit Blocks": 3,
                            "Shared Read Blocks": 0,
                            "Shared Dirtied Blocks": 0,
                            "Shared Written Blocks": 0,
                            "Local Hit Blocks": 0,
                            "Local Read Blocks": 0,
                            "Local Dirtied Blocks": 0,
                            "Local Written Blocks": 0,
                            "Temp Read Blocks": 0,
                            "Temp Written Blocks": 0
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      },
      "Planning": {
        "Shared Hit Blocks": 1,
        "Shared Read Blocks": 0,
        "Shared Dirtied Blocks": 0,
        "Shared Written Blocks": 0,
        "Local Hit Blocks": 0,
        "Local Read Blocks": 0,
        "Local Dirtied Blocks": 0,
        "Local Written Blocks": 0,
        "Temp Read Blocks": 0,
        "Temp Written Blocks": 0
      },
      "Planning Time": 0.197,
      "Triggers": [],
      "Execution Time": 0.434
    },
    "rareArrayPlan": {
      "Plan": {
        "Node Type": "Limit",
        "Parallel Aware": false,
        "Async Capable": false,
        "Startup Cost": 371.68,
        "Total Cost": 371.74,
        "Plan Rows": 25,
        "Plan Width": 4,
        "Actual Startup Time": 0.109,
        "Actual Total Time": 0.112,
        "Actual Rows": 25,
        "Actual Loops": 1,
        "Shared Hit Blocks": 106,
        "Shared Read Blocks": 0,
        "Shared Dirtied Blocks": 0,
        "Shared Written Blocks": 0,
        "Local Hit Blocks": 0,
        "Local Read Blocks": 0,
        "Local Dirtied Blocks": 0,
        "Local Written Blocks": 0,
        "Temp Read Blocks": 0,
        "Temp Written Blocks": 0,
        "Plans": [
          {
            "Node Type": "Sort",
            "Parent Relationship": "Outer",
            "Parallel Aware": false,
            "Async Capable": false,
            "Startup Cost": 371.68,
            "Total Cost": 371.94,
            "Plan Rows": 103,
            "Plan Width": 4,
            "Actual Startup Time": 0.108,
            "Actual Total Time": 0.11,
            "Actual Rows": 25,
            "Actual Loops": 1,
            "Sort Key": [
              "id DESC"
            ],
            "Sort Method": "top-N heapsort",
            "Sort Space Used": 25,
            "Sort Space Type": "Memory",
            "Shared Hit Blocks": 106,
            "Shared Read Blocks": 0,
            "Shared Dirtied Blocks": 0,
            "Shared Written Blocks": 0,
            "Local Hit Blocks": 0,
            "Local Read Blocks": 0,
            "Local Dirtied Blocks": 0,
            "Local Written Blocks": 0,
            "Temp Read Blocks": 0,
            "Temp Written Blocks": 0,
            "Plans": [
              {
                "Node Type": "Bitmap Heap Scan",
                "Parent Relationship": "Outer",
                "Parallel Aware": false,
                "Async Capable": false,
                "Relation Name": "bench_documents",
                "Alias": "bench_documents",
                "Startup Cost": 13.36,
                "Total Cost": 368.77,
                "Plan Rows": 103,
                "Plan Width": 4,
                "Actual Startup Time": 0.024,
                "Actual Total Time": 0.096,
                "Actual Rows": 103,
                "Actual Loops": 1,
                "Recheck Cond": "(lexemes @> '{rareanchor}'::text[])",
                "Rows Removed by Index Recheck": 0,
                "Exact Heap Blocks": 103,
                "Lossy Heap Blocks": 0,
                "Shared Hit Blocks": 106,
                "Shared Read Blocks": 0,
                "Shared Dirtied Blocks": 0,
                "Shared Written Blocks": 0,
                "Local Hit Blocks": 0,
                "Local Read Blocks": 0,
                "Local Dirtied Blocks": 0,
                "Local Written Blocks": 0,
                "Temp Read Blocks": 0,
                "Temp Written Blocks": 0,
                "Plans": [
                  {
                    "Node Type": "Bitmap Index Scan",
                    "Parent Relationship": "Outer",
                    "Parallel Aware": false,
                    "Async Capable": false,
                    "Index Name": "bench_array_gin",
                    "Startup Cost": 0,
                    "Total Cost": 13.34,
                    "Plan Rows": 103,
                    "Plan Width": 0,
                    "Actual Startup Time": 0.012,
                    "Actual Total Time": 0.012,
                    "Actual Rows": 103,
                    "Actual Loops": 1,
                    "Index Cond": "(lexemes @> '{rareanchor}'::text[])",
                    "Shared Hit Blocks": 3,
                    "Shared Read Blocks": 0,
                    "Shared Dirtied Blocks": 0,
                    "Shared Written Blocks": 0,
                    "Local Hit Blocks": 0,
                    "Local Read Blocks": 0,
                    "Local Dirtied Blocks": 0,
                    "Local Written Blocks": 0,
                    "Temp Read Blocks": 0,
                    "Temp Written Blocks": 0
                  }
                ]
              }
            ]
          }
        ]
      },
      "Planning": {
        "Shared Hit Blocks": 1,
        "Shared Read Blocks": 0,
        "Shared Dirtied Blocks": 0,
        "Shared Written Blocks": 0,
        "Local Hit Blocks": 0,
        "Local Read Blocks": 0,
        "Local Dirtied Blocks": 0,
        "Local Written Blocks": 0,
        "Temp Read Blocks": 0,
        "Temp Written Blocks": 0
      },
      "Planning Time": 0.056,
      "Triggers": [],
      "Execution Time": 0.122
    }
  }
]
```

## Limits and next decision

The common-term grouped document-wide-AND query may scan/group many matching rows even with GIN; rare matches should use the GIN index (see actual plans). Do not advertise constant-time search. 10k small synthetic documents do not measure 10k maximum-size PDFs. The max-size cases prove bounded vector construction on a few worst-case inputs, not a universal latency bound or production concurrency capacity. No HTTP route, authorization, migration/backfill, save retry or deletion integration was changed/tested.
Before implementation decide lexical word matching versus the existing literal preview search, same-page versus document-wide AND (candidate here is document-wide), query bounds, ordering and whether full-text joins augment metadata results. CJK without spaces remains parser-token matching; NFC/NFD and locale behavior are not normalized here. Long tokens can be silently ignored by native FTS, so communicate lexical limitations instead of promising arbitrary text/substrings.
Primary reference: [PostgreSQL text search limits](https://www.postgresql.org/docs/current/textsearch-limitations.html). Local database observations above govern this installed version. Reproduce: `node infra/scripts/benchmark-extraction-search.mjs` (requires existing Postgres.app and server pg dependency); the disposable cluster is stopped and removed in finally.
