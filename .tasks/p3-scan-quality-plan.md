# P3 synthetic printed-scan quality coverage

- AI-01/02/04/05/06, roadmap P3 work package6: add fixed synthetic rotated and reduced-contrast printed images to the existing real local OCR browser fixture. Reuse its source/access/local-asset interception and actual worker; no duplicate fixture or new dependency.
- Keep exact neutral ground truth FAMILY VAULT TEST. Report only fixed-fixture recognition and safety, not clinical accuracy, handwriting support, arbitrary scan guarantees or general error-rate benchmarks. Preserve unverified output, source availability, no automatic writes, no record logs/storage, and no external requests.
- Test-only change plus plan/report; no runtime, routes, authority, schema, UI design or provider changes. Single browser worker and bounded fixture sizes; no Docker.
- Native workers reached a usage limit while drafting the previous UI slice. Supervisor continues this bounded test task; no OpenCode fallback or unavailable independent model review is claimed. Use installed Playwright CLI and synthetic data only.
- Run the fixed quality cases in desktop/mobile on the built app, then types/lint/format/secrets. Inspect any recognition failure rather than silently weakening ground truth or treating uncertain output as verified. Commit/push after checks and continue the next ready P3 item.
