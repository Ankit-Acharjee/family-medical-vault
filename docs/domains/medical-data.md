# Laboratory & Observations

**Canonical owner:** This file owns the requirement IDs below. Consult adjacent domain docs only for cross-domain work.

## LAB-01 — Structured measurements
**Requirement:** Capture analyte, value/type, unit, specimen/method where known, reference interval, date, lab and source document.

**Acceptance check:** Measurement provenance and original representation remain accessible.

## LAB-02 — Verification
**Requirement:** Separate provisional extraction from verified clinical observations.

**Acceptance check:** Only verified values power trusted trends and patient summaries.

## LAB-03 — Trend accuracy
**Requirement:** Graph comparable time-series with units, differing reference ranges and explicit comparability limits.

**Acceptance check:** Incompatible units or methods are not silently combined.

## LAB-04 — Manual readings
**Requirement:** Support clearly labeled manual vital measurements including BP, weight, pulse and glucose.

**Acceptance check:** Manual entries remain distinguishable from laboratory reports.

## LAB-05 — Future imports
**Requirement:** Use replaceable data ingestion interfaces for potential wearable/device sources without initial native app requirement.

**Acceptance check:** Baseline works without third-party health connectors.

### Approved cross-report comparability policy — November 2026

Source-field verification and cross-report comparability are separate decisions. Results from different reports may share a trusted trend only after explicit profile-owner confirmation of comparability; unmatched results remain separate. Matching analyte/unit/specimen/method labels alone do not confirm comparability. This does not authorize silently combining incompatible units or methods, inferring missing fields, or applying unreviewed conversions. Comparability must retain exact source/version references and be rechecked when those sources or confirmations change.

### Approved manual-reading authority — 17 November 2026

Only the explicit Person owner may create, correct or withdraw manually entered BP, weight, pulse and glucose observations initially. Corrections and withdrawal preserve prior history; delegates cannot write manual readings even with Edit, View or Manage. Manual entries remain explicitly user-reported and separate from source-document verification and laboratory comparability. This policy does not authorize converting units or inferring clinical interpretation.
