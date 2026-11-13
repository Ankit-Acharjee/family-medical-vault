// Synthetic, disposable native PostgreSQL feasibility benchmark for DOC-05 / AI-01.
// Uses no project configuration, real records, credentials, cloud services or Docker.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import net from 'node:net';
import { performance } from 'node:perf_hooks';

const { Client } = createRequire(
  new URL('../../apps/server/package.json', import.meta.url),
)('pg');
const bin = path.join(
  homedir(),
  'Applications/Postgres.app/Contents/Versions/latest/bin',
);
const temporary = await mkdtemp(path.join(tmpdir(), 'fmv-search-benchmark-'));
const data = path.join(temporary, 'data');
const reportPath = fileURLToPath(
  new URL('../../.tasks/p3-search-benchmark.md', import.meta.url),
);
let started = false;
let client;
const results = {
  run: new Date().toISOString(),
  dataset: [],
  edges: [],
  timings: [],
};
function command(name, args) {
  const r = spawnSync(path.join(bin, name), args, {
    encoding: 'utf8',
    timeout: 60000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.error || r.status !== 0)
    throw new Error(`Disposable PostgreSQL ${name} failed`);
}
async function timed(sql, values) {
  const start = performance.now();
  const result = await client.query(sql, values);
  return { ms: performance.now() - start, result };
}
const round = (n) => Math.round(n * 100) / 100;
async function sample(label, size, sql, values, repetitions = 20) {
  await client.query(sql, values); // one warm-up; all reported measurements are warm-cache
  const times = [];
  let rows;
  for (let i = 0; i < repetitions; i++) {
    const r = await timed(sql, values);
    times.push(r.ms);
    rows = r.result.rowCount;
  }
  times.sort((a, b) => a - b);
  results.timings.push({
    size,
    label,
    samples: repetitions,
    median: round(times[Math.floor(times.length / 2)]),
    p95: round(times[Math.ceil(times.length * 0.95) - 1]),
    rows,
  });
}

// Positions are deliberately omitted: this benchmark specifies all normalized query
// lexemes anywhere in a document, including different pages/chunks; no phrase/rank API.
// Each lexeme is bounded to PostgreSQL's native <2047-byte limit. <=128 lexemes
// gives <=262,016 lexeme bytes plus 512 bytes of entries, far below 1 MiB.
const deriveChunks = `
  SELECT p.ordinality::int AS page_no, ((row_number() OVER (
    PARTITION BY p.ordinality ORDER BY lexeme) - 1) / 128)::int AS chunk_no, lexeme
  FROM jsonb_array_elements($1::jsonb -> 'pages') WITH ORDINALITY p(value, ordinality)
  CROSS JOIN LATERAL (
    SELECT DISTINCT lexeme FROM ts_debug('pg_catalog.simple', p.value ->> 'text') d
    CROSS JOIN LATERAL unnest(d.lexemes) AS lexeme
    WHERE octet_length(lexeme) < 2047
  ) normalized`;
const terms = `SELECT lexeme, array_to_tsvector(ARRAY[lexeme])::text::tsquery AS query
  FROM unnest(tsvector_to_array(to_tsvector('pg_catalog.simple', $1))) lexeme`;
const chunkSearch = `WITH terms AS (${terms})
  SELECT c.document_id FROM bench_chunks c JOIN terms t ON c.vector @@ t.query
  WHERE ($2::int IS NULL OR c.patient_id = $2)
  GROUP BY c.document_id HAVING count(DISTINCT t.lexeme) = (SELECT count(*) FROM terms)
  ORDER BY c.document_id DESC LIMIT 25`;
const arraySearch = `SELECT id FROM bench_documents
  WHERE ($2::int IS NULL OR patient_id = $2)
  AND cardinality(tsvector_to_array(to_tsvector('pg_catalog.simple', $1))) > 0
  AND lexemes @> tsvector_to_array(to_tsvector('pg_catalog.simple', $1))
  ORDER BY id DESC LIMIT 25`;
const wholeSearch = `SELECT id FROM bench_documents
  WHERE ($2::int IS NULL OR patient_id = $2)
  AND numnode(plainto_tsquery('pg_catalog.simple', $1)) > 0
  AND whole_vector @@ plainto_tsquery('pg_catalog.simple', $1)
  ORDER BY id DESC LIMIT 25`;
const pageSearch = `SELECT DISTINCT document_id FROM bench_pages
  WHERE ($2::int IS NULL OR patient_id = $2)
  AND numnode(plainto_tsquery('pg_catalog.simple', $1)) > 0
  AND vector @@ plainto_tsquery('pg_catalog.simple', $1)
  ORDER BY document_id DESC LIMIT 25`;
const dynamicSearch = `SELECT d.id FROM bench_documents d
  WHERE ($2::int IS NULL OR patient_id = $2)
  AND numnode(plainto_tsquery('pg_catalog.simple', $1)) > 0
  AND to_tsvector('pg_catalog.simple', (
    SELECT string_agg(p ->> 'text', ' ') FROM jsonb_array_elements(d.extraction -> 'pages') p
  )) @@ plainto_tsquery('pg_catalog.simple', $1)
  ORDER BY d.id DESC LIMIT 25`;

try {
  const port = await new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.on('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const port = socket.address().port;
      socket.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
  const password = randomBytes(32).toString('hex');
  const passwordFile = path.join(temporary, 'owner-password');
  await writeFile(passwordFile, password, { mode: 0o600 });
  command('initdb', [
    '-D',
    data,
    '--username=fmv_benchmark',
    '--auth-local=trust',
    '--auth-host=scram-sha-256',
    '--pwfile=' + passwordFile,
    '--encoding=UTF8',
    '--locale=C',
  ]);
  command('pg_ctl', [
    '-D',
    data,
    '-l',
    path.join(temporary, 'postgres.log'),
    '-o',
    `-h 127.0.0.1 -p ${port} -k ${temporary} -c shared_buffers=32MB -c max_connections=10 -c log_statement=none -c log_min_error_statement=panic -c log_error_verbosity=terse`,
    '-w',
    'start',
  ]);
  started = true;
  client = new Client({
    host: '127.0.0.1',
    port,
    user: 'fmv_benchmark',
    password,
    database: 'postgres',
    connectionTimeoutMillis: 5000,
  });
  await client.connect();
  client.on('notice', () => {});
  await client.query(
    `SET statement_timeout = '60s'; SET work_mem = '8MB'; SET jit = off; SET client_min_messages = warning;`,
  );
  results.postgres = (
    await client.query('SHOW server_version')
  ).rows[0].server_version;
  await client.query(`
    CREATE FUNCTION extraction_lexemes(extraction jsonb) RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
      SELECT coalesce(array_agg(DISTINCT lexeme ORDER BY lexeme), ARRAY[]::text[])
      FROM jsonb_array_elements(extraction -> 'pages') p
      CROSS JOIN LATERAL ts_debug('pg_catalog.simple', p ->> 'text') d
      CROSS JOIN LATERAL unnest(d.lexemes) lexeme WHERE octet_length(lexeme) < 2047
    $$;
    CREATE TABLE bench_documents(id int PRIMARY KEY, patient_id int NOT NULL, extraction jsonb NOT NULL, whole_vector tsvector, lexemes text[]);
    CREATE TABLE bench_pages(document_id int NOT NULL REFERENCES bench_documents ON DELETE CASCADE, patient_id int NOT NULL, page_no int NOT NULL, vector tsvector NOT NULL, PRIMARY KEY(document_id, page_no));
    CREATE TABLE bench_chunks(document_id int NOT NULL REFERENCES bench_documents ON DELETE CASCADE, patient_id int NOT NULL, page_no int NOT NULL, chunk_no int NOT NULL, lexemes text[] NOT NULL, vector tsvector GENERATED ALWAYS AS (array_to_tsvector(lexemes)) STORED, PRIMARY KEY(document_id, page_no, chunk_no));
    CREATE INDEX bench_whole_gin ON bench_documents USING gin(whole_vector);
    CREATE INDEX bench_array_gin ON bench_documents USING gin(lexemes);
    CREATE INDEX bench_document_patient ON bench_documents(patient_id, id);
    CREATE INDEX bench_page_gin ON bench_pages USING gin(vector);
    CREATE INDEX bench_page_patient ON bench_pages(patient_id, document_id);
    CREATE INDEX bench_chunk_gin ON bench_chunks USING gin(vector);
    CREATE INDEX bench_chunk_patient ON bench_chunks(patient_id, document_id);`);
  for (const size of [1000, 10000]) {
    await client.query('TRUNCATE bench_documents CASCADE');
    const load = await timed(
      `INSERT INTO bench_documents(id, patient_id, extraction)
      SELECT i, (i - 1) % 100, jsonb_build_object('method', 'pdf-text', 'engineVersion', 'notsearchablemarker', 'pages',
        jsonb_build_array(
          jsonb_build_object('page', 1, 'text', repeat('routine assessment commonterm stable observation synthetic ', 18) || ' crossalpha'),
          jsonb_build_object('page', 2, 'text', repeat('routine assessment commonterm stable observation synthetic ', 18) || CASE WHEN i % 97 = 0 THEN ' rareanchor' ELSE '' END || ' item' || i),
          jsonb_build_object('page', 3, 'text', repeat('routine assessment commonterm stable observation synthetic ', 18) || ' crossomega')))
      FROM generate_series(1, $1::int) i`,
      [size],
    );
    const wholeBuild = await timed(
      `UPDATE bench_documents d SET whole_vector = to_tsvector('pg_catalog.simple', (SELECT string_agg(p ->> 'text', ' ') FROM jsonb_array_elements(d.extraction -> 'pages') p))`,
    );
    const pageBuild = await timed(
      `INSERT INTO bench_pages SELECT d.id, d.patient_id, p.ordinality, to_tsvector('pg_catalog.simple', p.value ->> 'text') FROM bench_documents d CROSS JOIN LATERAL jsonb_array_elements(d.extraction -> 'pages') WITH ORDINALITY p(value, ordinality)`,
    );
    const chunkBuild =
      await timed(`INSERT INTO bench_chunks(document_id, patient_id, page_no, chunk_no, lexemes)
      SELECT d.id, d.patient_id, p.ordinality::int, 0, tsvector_to_array(to_tsvector('pg_catalog.simple', p.value ->> 'text'))
      FROM bench_documents d CROSS JOIN LATERAL jsonb_array_elements(d.extraction -> 'pages') WITH ORDINALITY p(value, ordinality)`);
    const arrayBuild = await timed(
      `UPDATE bench_documents SET lexemes = extraction_lexemes(extraction)`,
    );
    // The representative pages have <128 lexemes: this fast path is equivalent
    // to deriveChunks, whose parser-based bounded path is exercised below.
    for (const table of ['bench_documents', 'bench_pages', 'bench_chunks'])
      await client.query(`VACUUM ANALYZE ${table}`);
    const sizeStats = (
      await client.query(`SELECT
      pg_relation_size('bench_whole_gin') AS whole_gin_bytes,
      pg_relation_size('bench_page_gin') AS page_gin_bytes,
      pg_relation_size('bench_chunk_gin') AS chunk_gin_bytes,
      pg_relation_size('bench_array_gin') AS array_gin_bytes,
      pg_total_relation_size('bench_documents') AS documents_total_bytes,
      pg_total_relation_size('bench_pages') AS pages_total_bytes,
      pg_total_relation_size('bench_chunks') AS chunks_total_bytes,
      (SELECT count(*) FROM bench_chunks) AS chunk_rows`)
    ).rows[0];
    const extractionUnits = (
      await client.query(
        `SELECT sum(length(p ->> 'text'))::int AS units FROM bench_documents d CROSS JOIN LATERAL jsonb_array_elements(d.extraction -> 'pages') p WHERE d.id = 1`,
      )
    ).rows[0].units;
    results.dataset.push({
      size,
      patients: 100,
      pages: 3,
      asciiUnitsPerDocument: extractionUnits,
      loadMs: round(load.ms),
      wholeBuildMs: round(wholeBuild.ms),
      pageBuildMs: round(pageBuild.ms),
      chunkBuildMs: round(chunkBuild.ms),
      arrayBuildMs: round(arrayBuild.ms),
      ...sizeStats,
    });
    for (const [name, query, patient] of [
      ['common', 'commonterm', null],
      ['rare', 'rareanchor', null],
      ['missing', 'absentterm', null],
      ['cross-pages', 'crossalpha crossomega', null],
      ['patient-common', 'commonterm', 0],
      ['patient-rare', 'rareanchor', 0],
    ]) {
      for (const [strategy, sql] of [
        ['whole', wholeSearch],
        ['page', pageSearch],
        ['chunk', chunkSearch],
        ['array', arraySearch],
      ])
        await sample(`${strategy}/${name}`, size, sql, [query, patient]);
      await sample(`dynamic/${name}`, size, dynamicSearch, [query, patient], 5);
    }
    const plan = await client.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${chunkSearch}`,
      ['rareanchor', null],
    );
    results.dataset.at(-1).rareChunkPlan = plan.rows[0]['QUERY PLAN'][0];
    results.dataset.at(-1).rareArrayPlan = (
      await client.query(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${arraySearch}`,
        ['rareanchor', null],
      )
    ).rows[0]['QUERY PLAN'][0];
    // Update costs include JSON update and rebuilding each strategy's derived data.
    // Each transaction is rolled back; all use the same original synthetic text.
    for (const strategy of ['whole', 'page', 'chunk', 'array']) {
      const times = [];
      for (let i = 0; i < 20; i++) {
        await client.query('BEGIN');
        const start = performance.now();
        await client.query(
          `UPDATE bench_documents SET extraction = jsonb_set(extraction, '{pages,0,text}', to_jsonb((extraction #>> '{pages,0,text}') || ' updateword')) WHERE id = 1`,
        );
        if (strategy === 'array')
          await client.query(
            `UPDATE bench_documents SET lexemes = extraction_lexemes(extraction) WHERE id = 1`,
          );
        else if (strategy === 'whole')
          await client.query(
            `UPDATE bench_documents d SET whole_vector = to_tsvector('pg_catalog.simple', (SELECT string_agg(p ->> 'text', ' ') FROM jsonb_array_elements(d.extraction -> 'pages') p)) WHERE id = 1`,
          );
        else {
          const table = strategy === 'page' ? 'bench_pages' : 'bench_chunks';
          await client.query(`DELETE FROM ${table} WHERE document_id = 1`);
          await client.query(
            strategy === 'page'
              ? `INSERT INTO bench_pages SELECT d.id, d.patient_id, p.ordinality, to_tsvector('pg_catalog.simple', p.value ->> 'text') FROM bench_documents d CROSS JOIN LATERAL jsonb_array_elements(d.extraction -> 'pages') WITH ORDINALITY p(value, ordinality) WHERE d.id = 1`
              : `INSERT INTO bench_chunks(document_id, patient_id, page_no, chunk_no, lexemes) SELECT d.id, d.patient_id, p.ordinality, 0, tsvector_to_array(to_tsvector('pg_catalog.simple', p.value ->> 'text')) FROM bench_documents d CROSS JOIN LATERAL jsonb_array_elements(d.extraction -> 'pages') WITH ORDINALITY p(value, ordinality) WHERE d.id = 1`,
          );
        }
        times.push(performance.now() - start);
        await client.query('ROLLBACK');
      }
      times.sort((a, b) => a - b);
      results.timings.push({
        size,
        label: `${strategy}/update-rollback`,
        samples: times.length,
        median: round(times[10]),
        p95: round(times[18]),
        rows: 1,
      });
    }
  }
  // Native-simple lexical semantics: no stemming, accent folding, substring or CJK segmentation.
  for (const [name, text, query] of [
    ['case', 'Synthetic ALPHA beta', 'alpha BETA'],
    ['accent-preserved', 'café résumé', 'cafe'],
    ['accent-exact', 'café résumé', 'café'],
    ['cjk-whole-token', '患者検査結果正常', '検査'],
    ['cjk-spaced', '患者 検査 正常', '検査'],
    ['emoji', '🧪 alpha 😀', '🧪'],
    ['longword-2047', 'a'.repeat(2047), 'a'.repeat(2047)],
    ['longword-2048', 'a'.repeat(2048), 'a'.repeat(2048)],
    ['empty-query', 'alpha beta', ''],
    ['punctuation-query', 'alpha beta', '--- !!!'],
    ['simple-stopwords', 'the and is', 'the'],
    ['parser-compounds', 'follow-up foo@example.test', 'follow up'],
    ['normalization-nfc-vs-nfd', 'café', 'cafe\u0301'],
  ]) {
    const native = (
      await client.query(
        `SELECT to_tsvector('pg_catalog.simple', $1) @@ plainto_tsquery('pg_catalog.simple', $2) AS matches, cardinality(tsvector_to_array(to_tsvector('pg_catalog.simple', $1))) AS document_lexemes, numnode(plainto_tsquery('pg_catalog.simple', $2)) AS query_nodes`,
        [text, query],
      )
    ).rows[0];
    const extraction = JSON.stringify({
      engineVersion: 'notsearchablemarker',
      pages: [{ page: 1, text }],
    });
    const chunks = (
      await client.query(
        `WITH x AS (${deriveChunks}), chunks AS (SELECT array_to_tsvector(array_agg(lexeme)) AS vector FROM x GROUP BY page_no, chunk_no), terms AS (SELECT lexeme, array_to_tsvector(ARRAY[lexeme])::text::tsquery AS query FROM unnest(tsvector_to_array(to_tsvector('pg_catalog.simple', $2))) lexeme) SELECT (SELECT count(*) FROM terms) > 0 AND NOT EXISTS(SELECT FROM terms t WHERE NOT EXISTS(SELECT FROM chunks c WHERE c.vector @@ t.query)) AS matches`,
        [extraction, query],
      )
    ).rows[0];
    const array = (
      await client.query(
        `SELECT cardinality(tsvector_to_array(to_tsvector('pg_catalog.simple', $2))) > 0 AND extraction_lexemes($1::jsonb) @> tsvector_to_array(to_tsvector('pg_catalog.simple', $2)) AS matches`,
        [extraction, query],
      )
    ).rows[0];
    if (native.matches !== chunks.matches)
      throw new Error(`Chunk semantic mismatch in synthetic case ${name}`);
    if (native.matches !== array.matches)
      throw new Error(`Array semantic mismatch in synthetic case ${name}`);
    results.edges.push({
      name,
      ...native,
      chunkMatches: chunks.matches,
      arrayMatches: array.matches,
    });
  }
  await client.query(
    `CREATE TABLE bench_bounded_save(id int PRIMARY KEY, extraction jsonb NOT NULL, lexemes text[] GENERATED ALWAYS AS (extraction_lexemes(extraction)) STORED); CREATE INDEX bench_bounded_save_gin ON bench_bounded_save USING gin(lexemes)`,
  );
  for (const [name, limit, pages] of [
    ['pdf-one-page', 500000, 1],
    ['pdf-fifty-pages', 500000, 50],
    ['image-one-page', 100000, 1],
  ]) {
    const tokens = Array.from(
      { length: limit / 4 },
      (_, i) =>
        '中' +
        String.fromCharCode(0x4e00 + (i % 20000)) +
        String.fromCharCode(0x4e00 + Math.floor(i / 20000)),
    );
    const text = tokens.join(' ') + ' ';
    const pageTexts = Array.from({ length: pages }, (_, i) =>
      text.slice((i * text.length) / pages, ((i + 1) * text.length) / pages),
    );
    const extraction = JSON.stringify({
      engineVersion: 'notsearchablemarker',
      pages: pageTexts.map((text, i) => ({ page: i + 1, text })),
    });
    const edge = {
      name,
      utf16Units: text.length,
      utf8Bytes: Buffer.byteLength(text),
      pages,
    };
    for (const [strategy, sql] of [
      [
        'whole',
        `SELECT pg_column_size(to_tsvector('pg_catalog.simple', $1)) AS bytes`,
      ],
      [
        'whole-strip',
        `SELECT pg_column_size(strip(to_tsvector('pg_catalog.simple', $1))) AS bytes`,
      ],
    ]) {
      try {
        edge[strategy] = (await timed(sql, [text])).result.rows[0];
      } catch (error) {
        edge[strategy] = { error: error.code, message: error.message };
      }
    }
    try {
      edge.page = (
        await client.query(
          `SELECT max(pg_column_size(to_tsvector('pg_catalog.simple', p ->> 'text'))) AS max_bytes FROM jsonb_array_elements($1::jsonb -> 'pages') p`,
          [extraction],
        )
      ).rows[0];
    } catch (error) {
      edge.page = { error: error.code, message: error.message };
    }
    const bounded = await timed(
      `WITH x AS (${deriveChunks}), c AS (SELECT array_to_tsvector(array_agg(lexeme)) AS vector FROM x GROUP BY page_no, chunk_no) SELECT count(*) AS chunks, sum(cardinality(tsvector_to_array(vector))) AS lexemes, max(pg_column_size(vector)) AS max_vector_bytes FROM c`,
      [extraction],
    );
    edge.chunk = { ...bounded.result.rows[0], ms: round(bounded.ms) };
    const array = await timed(
      `SELECT cardinality(extraction_lexemes($1::jsonb)) AS lexemes, pg_column_size(extraction_lexemes($1::jsonb)) AS bytes`,
      [extraction],
    );
    edge.array = {
      ...array.result.rows[0],
      ms: round(array.ms),
      note: 'timing computes helper twice for count and byte size',
    };
    const save = await timed(
      `INSERT INTO bench_bounded_save VALUES ($1, $2::jsonb)`,
      [results.edges.length, extraction],
    );
    edge.generatedArraySaveWithGinMs = round(save.ms);
    const acrossChunks = (
      await client.query(
        `WITH x AS (${deriveChunks}), chunks AS (SELECT array_to_tsvector(array_agg(lexeme)) AS vector FROM x GROUP BY page_no, chunk_no), terms AS (SELECT lexeme, array_to_tsvector(ARRAY[lexeme])::text::tsquery AS query FROM unnest(tsvector_to_array(to_tsvector('pg_catalog.simple', $2))) lexeme) SELECT (SELECT count(*) FROM terms) = 2 AND NOT EXISTS(SELECT FROM terms t WHERE NOT EXISTS(SELECT FROM chunks c WHERE c.vector @@ t.query)) AS chunks_match, extraction_lexemes($1::jsonb) @> tsvector_to_array(to_tsvector('pg_catalog.simple', $2)) AS array_matches`,
        [extraction, tokens[0] + ' ' + tokens.at(-1)],
      )
    ).rows[0];
    if (!acrossChunks.chunks_match || !acrossChunks.array_matches)
      throw new Error('Lost cross-chunk words');
    edge.firstAndLastTerms = acrossChunks;
    results.edges.push(edge);
  }
  results.edges.push({
    name: 'metadata-excluded',
    matches: (await client.query(chunkSearch, ['notsearchablemarker', null]))
      .rowCount,
  });
  results.edges.push({
    name: 'cross-page-and',
    whole: (await client.query(wholeSearch, ['crossalpha crossomega', null]))
      .rowCount,
    samePage: (await client.query(pageSearch, ['crossalpha crossomega', null]))
      .rowCount,
    chunkDocumentAnd: (
      await client.query(chunkSearch, ['crossalpha crossomega', null])
    ).rowCount,
  });
  const lines = [
    '# Synthetic extraction search benchmark',
    '',
    `Run: ${results.run}; PostgreSQL ${results.postgres}; local Postgres.app disposable UTF8/C-locale cluster, 32MB shared buffers, 8MB work_mem, JIT off.`,
    'Requirements assessed: DOC-05 and AI-01. No runtime/migration changes. Synthetic data only; no project environment, retained database, cloud, Docker or new dependencies.',
    '',
    '## Semantics and recommendation',
    '',
    'Native pg_catalog.simple lexical search, all normalized query lexemes anywhere across a document’s saved pages[].text; no phrase/order/rank/substring/prefix/fuzzy/stemming/accent-folding guarantee. Blank/punctuation-only queries return no matches. JSON metadata is excluded. Patient filtering in this benchmark is a SQL predicate, not an authorization implementation.',
    'One page may hold all 500,000 UTF-16 units of a PDF. A whole-document vector, a vector per page, and strip(to_tsvector(...)) cannot safely index every valid saved extraction: adversarial Unicode lexemes can exceed the native vector limit. Splitting raw text by character count also changes tokens at chunk boundaries.',
    'Recommended minimal candidate: one generated/stored TEXT[] of DISTINCT native-simple lexemes per document, using ts_debug(simple, each pages[].text), unnest lexemes, omit native-ignored >=2047-byte lexemes, and GIN(array). Query with lexemes @> normalized-query-lexemes and require nonempty query lexemes. This supports AND across all pages without the tsvector size limit, secondary chunk table or grouping at read time. Maximum extraction source is bounded; measured maximum unique-token array size is reported below, far below the array 1GB limit. A SQL IMMUTABLE helper with explicitly fixed pg_catalog.simple config is suitable for a generated column; dictionary/parser config changes would require rebuild just as native text-search indexes do. Update/delete with the document; backfill existing results. Authorization, lifecycle fences and RLS need supervisor implementation/review.',
    'The alternative bounded chunk design uses <=128 DISTINCT lexemes per page chunk and array_to_tsvector stored/generated vectors. Max lexeme payload <=262,016 bytes plus <=512 entry bytes, safely below 1MiB. It preserves all words but needs multiple rows and grouped reads.',
    'Query each unique normalized term against the GIN chunks, group by document and require count(DISTINCT matching term)=query term count. A query is matched across chunks/pages. Merely EXISTS(chunk.vector @@ full_AND_query) would silently lose cross-page/chunk matches. Query length/token count needs an explicit bounded API contract before runtime use.',
    '',
    '## Dataset and construction',
    '',
    'Three ASCII pages/document, ~3.1k UTF-16 units/document, 100 evenly distributed patients; common term every document, rare term every 97th document; crossalpha/crossomega on separate pages. Indexes are created before loading. Times below include local Node↔Postgres round-trip. No concurrent users; no hosted-storage/network behavior inferred. All query timings are warm-cache, one warm-up; whole/page/chunk 20 samples, dynamic 5 samples. Query shape returns <=25 IDs, descending document ID, with no total-count or relevance/snippet work.',
    'Representative pages have fewer than 128 unique lexemes, so construction/update timings use native to_tsvector → tsvector_to_array fast path, equivalent results for this corpus. These are NOT timings for the full ts_debug bounded ingest algorithm. Adversarial chunk derivation below exercises that algorithm directly.',
    '',
    '| Documents | Source units/doc | Load ms | Whole build ms | Page build ms | Chunk fast-path build ms | Array bounded build ms | Whole GIN bytes | Page GIN bytes | Chunk GIN bytes | Array GIN bytes |',
    '|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...results.dataset.map(
      (r) =>
        `| ${r.size} | ${r.asciiUnitsPerDocument} | ${r.loadMs} | ${r.wholeBuildMs} | ${r.pageBuildMs} | ${r.chunkBuildMs} | ${r.arrayBuildMs} | ${r.whole_gin_bytes} | ${r.page_gin_bytes} | ${r.chunk_gin_bytes} | ${r.array_gin_bytes} |`,
    ),
    '',
    '## Query/update timings',
    '',
    'Update is one document JSON replacement + rebuilding that strategy’s derived data, measured inside a transaction and rolled back. Excludes commit/fsync latency; repeated rollback/index churn may affect later measurements. The benchmark retains all three comparison indexes/tables concurrently, so these timings are comparative, not isolated production capacity.',
    '',
    '| Documents | Strategy/case | Samples | Median ms | p95 ms | Returned IDs |',
    '|---:|---|---:|---:|---:|---:|',
    ...results.timings.map(
      (r) =>
        `| ${r.size} | ${r.label} | ${r.samples} | ${r.median} | ${r.p95} | ${r.rows} |`,
    ),
    '',
    '## Edge-case observations (actual database results)',
    '',
    '```json',
    JSON.stringify(results.edges, null, 2),
    '```',
    '',
    '## Chunk rare-term EXPLAIN evidence',
    '',
    '```json',
    JSON.stringify(
      results.dataset.map(({ size, rareChunkPlan, rareArrayPlan }) => ({
        size,
        rareChunkPlan,
        rareArrayPlan,
      })),
      null,
      2,
    ),
    '```',
    '',
    '## Limits and next decision',
    '',
    'The common-term grouped document-wide-AND query may scan/group many matching rows even with GIN; rare matches should use the GIN index (see actual plans). Do not advertise constant-time search. 10k small synthetic documents do not measure 10k maximum-size PDFs. The max-size cases prove bounded vector construction on a few worst-case inputs, not a universal latency bound or production concurrency capacity. No HTTP route, authorization, migration/backfill, save retry or deletion integration was changed/tested.',
    'Before implementation decide lexical word matching versus the existing literal preview search, same-page versus document-wide AND (candidate here is document-wide), query bounds, ordering and whether full-text joins augment metadata results. CJK without spaces remains parser-token matching; NFC/NFD and locale behavior are not normalized here. Long tokens can be silently ignored by native FTS, so communicate lexical limitations instead of promising arbitrary text/substrings.',
    'Primary reference: [PostgreSQL text search limits](https://www.postgresql.org/docs/current/textsearch-limitations.html). Local database observations above govern this installed version. Reproduce: `node infra/scripts/benchmark-extraction-search.mjs` (requires existing Postgres.app and server pg dependency); the disposable cluster is stopped and removed in finally.',
    '',
  ];
  await writeFile(reportPath, lines.join('\n'));
  console.log(
    JSON.stringify({
      report: '.tasks/p3-search-benchmark.md',
      postgres: results.postgres,
      datasets: results.dataset.map((row) =>
        Object.fromEntries(
          Object.entries(row).filter(([key]) => !key.endsWith('Plan')),
        ),
      ),
      edgeCases: results.edges.length,
    }),
  );
} finally {
  try {
    if (client) await client.end();
  } finally {
    try {
      if (started) command('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}
