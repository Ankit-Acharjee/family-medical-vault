# Saved extraction — frozen implementation boundary

Scope: explicit Save for ready embedded-PDF, image OCR and selected-page PDF OCR; saved read reuses source/Find presentation. No background processing, external AI, clinical verification or full-vault index.

## Public contracts (packages/contracts/src/extractions.ts, re-exported by index)
- `ExtractionMethod = 'pdf-text' | 'image-ocr' | 'pdf-page-ocr'`.
- `ExtractionResult = {method,engineVersion,pages:{page:number;text:string}[],partial:boolean,partialReason:'pages'|'characters'|'selected-page'|null,downsized:boolean}`.
- Engine allowlist: pdf-text `pdfjs-6.5.438`; image-ocr `tesseract-7.0.0+eng-1.0.0`; pdf-page-ocr `pdfjs-6.5.438+tesseract-7.0.0+eng-1.0.0`.
- `ExtractionContext = {sourceSha256:string,lifecycleVersion:number,revision:number,canSave:boolean}`. Hash lowerhex64, nonnegative int versions. Revision0 means no saved snapshot.
- `SavedExtraction = ExtractionResult & {revision:number,sourceSha256:string,savedAt:string,unverified:true}`. Actor, request identity/fingerprint remain server-private.
- `ExtractionReadResult = {context:ExtractionContext,snapshot:SavedExtraction|null}`.
- `SaveExtraction = {requestId:string,expectedRevision:number,lifecycleVersion:number,sourceSha256:string,result:ExtractionResult}`; `SaveExtractionResult={saved:true,revision:number}`.
- Strict exported validators: `isExtractionResult`, `isExtractionContext`, `isExtractionReadResult`, `isSaveExtraction`, `isSaveExtractionResult`; reject unknown keys and invalid Unicode/NUL. Method/source MIME checked separately in service. Export `maximumExtractionRequestBytes=4*1024*1024`, `extractionEngineVersions` mapping.
- 1..50 strictly increasing unique page numbers, each1..50; pdf-text starts at1 and contiguous, total<=500,000 UTF16units; OCR exactly1page,total<=100,000, imagepage1. At least one non-whitespace text. pdf-text downsizedfalse; partial iff reasonnon-null. image partialreason characters only. pdf-page-ocr alwayspartialtrue and reasonselected-page orcharacters. No loss of original text/source spacing on save.

## HTTP
- GET `/api/patients/:patientId/documents/:documentId/extraction/context` -> `{context}` (VIEW, no content audit).
- GET same without `/context` -> `ExtractionReadResult` (VIEW; audit existing document.viewed only when saved content exists).
- PUT same -> `SaveExtractionResult` (joint EDIT+VIEW), authenticated/CSRF JSON, bounded raw body read after per-document authorization; ordinary routes retain100KiB JSON parser cap.
- All responses no-store, generic404/409/400/413/503 without content. Source binary/MIME/10MiB processing cap remains independent of saved data retrieval.

## Store boundary (root + backend worker coordinate)
- Add `ExtractionSource` private type `{documentId,patientId,categoryId,mimeType,state,deletedAt,sha256,lifecycleVersion}`.
- `ExtractionAuthority = {accountId:string;canSave:boolean}`; callback `(source:ExtractionSource)=>Promise<ExtractionAuthority>` reads one current permission snapshot and evaluates both actions. VIEW always required; save additionally requirescanSave.
- `DocumentStore.readExtraction(patientId,documentId,authorize,includeSnapshot=true)` returns `ExtractionReadResult|null` (activeREADY row locked, callback before/after; audit saved reads whenincludeSnapshot).
- `DocumentStore.saveExtraction(patientId,documentId,input:SaveExtraction,authorize)` returns `{saved:true,revision}` or `'missing'|'conflict'`; callback before/after mutation; requirecanSave. Serialize by original row `FOR NO KEY UPDATE` in one transaction. Failed final auth/audit rolls back.
- Implement SQL adapter in a new extraction.store.ts, called by PrismaDocumentStore using its existing client. No second authorization store or separate pool.
- documents.extraction_lifecycle int default0, trigger increments on real deleted_at changes only; runtime has no direct UPDATE privilege on it. Latest snapshot table `document_extractions` keyed document_id, composite patient/documentFK, resultJSONB, source_sha256, lifecycle_version, revision>0, request_idUUID, payload_hashhex64, actor_account_idUUIDFK, saved_atserver timestamp.
- Compare source hash+lifecycle and expectedRevision (current snapshot revision or0). Same-base concurrent saves: first successful commit wins. Current same requestId+actor+canonical-payload hash replay returns same revision/no duplicate event; replaced or Trash/restore replay conflicts. Never silently refresh write basis.
- Snapshot retained but hidden inTrash; restored snapshot readable even when its stored lifecycle predates current lifecycle. Lifecycle fences writes, not restored reads. FK CASCADE removes derived row on eventual document purge; production purge/backups remain existing release gates.

## Frontend
Capture context before each extraction/preview-byte fetch; failure of this optional metadata request disables Save but never prevents local extraction. Tie captured context and stable requestId/payload to that exact ready result. No refreshing context on Save or409. Explicit Save/retry only; ambiguous network/5xx says “Save could not be confirmed”, reuse identical requestId. Prevent duplicate pending submits.
VIEW rows gain Saved text action; it fetches saved text only, no re-extraction or original-byte request. No snapshot -> honest empty state. No claims of verified output; single-page OCR explicitly says only selected page recognized. Clear/hide/cancel on existing source/patient/session/Trash/access revalidation lifetimes; restorefocus and both themes/mobile.
