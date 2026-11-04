# 2.8.2

- Added npm distribution for the Chrome extension and local backend. GitHub release tags publish the matching package through npm Trusted Publishing.

# 2.8.1

- Git tracks the extension source and regression tests as TypeScript. The build generates the JavaScript for the Chrome install ZIP.

# 2.8.0

- Migrated all Chrome extension scripts to TypeScript and kept the existing automation behavior.
- The installable extension includes compiled JavaScript. The source archive includes TypeScript and build configuration.

# 2.7.7

- Generate and review online IDE code while the workspace opens, so the two waits overlap.

# 2.7.6 — 2026-11-03

- Extend Start automation for single-file CCBP Node.js IDE questions. Match the workspace to the question's submit command, open `app.js`, save reviewed JavaScript into an empty file after a syntax check, and submit for grading. Existing source is left for review. A new grading report is required to show completion.

# 2.7.5 — 2026-11-03

- Start automation on a CCBP Node.js assignment opens its Online IDE or focuses its existing workspace tab, then prepares a complete `app.js` from the question description. Copy the result into the IDE editor and save it.

# 2.7.4 — 2026-11-02

- Manual Vision Scan now includes complete recognized MCQ text/options and full code models. Read complete chart/option illustrations rather than only a cropped viewport, and reject stale results after question changes.
- Preserve small labels with a 2400px image limit and one backend JPEG compression; frontend chart capture uses PNG.
- Cross-check vision MCQs with a second visual solve that does not receive the proposed answers. Disagreement, incomplete checks and unreadable evidence return an explicit unconfirmed response instead of the first answer.
- Remove fabricated certainty from the vision prompt; distinguish percentage points from percentage comparisons and support multiple selections/free responses. Agreement is not a 100% accuracy guarantee and adds a model request.

# 2.7.3 — 2026-11-02

- Fix false question-change errors when SQL/code answer options repaint their editor viewport during answer generation.
- Populate option text from full editor models before requesting an answer. Preserve a separate ordered model snapshot, including duplicate source bindings, and reject actual source changes before selection.
- Verify complete option text, viewport repaint stability, real prompt/model changes and duplicate bindings; all 179 JavaScript tests pass.

# 2.7.2 — 2026-11-02

- Fix full MCQ snippet access after portal navigation without a document reload and on review routes. Chrome's original document route no longer blocks the read-only editor bridge.
- Recover a missing top-frame document URL from Chrome's tab URL; retain exact portal-origin, extension-sender and child-frame checks, complete-model extraction and partial-code rejection.

# 2.7.1 — 2026-11-02

- At the user’s request, remove the added 2.7.0 pairing, TLS, encrypted storage, privacy-mode and authorization-confirmation layer.
- Restore the tested 2.6.76 feature set, including five-image batching and existing shortcuts, with no pairing/setup requirement.
- Preserve history and settings. Baseline loopback binding, Host/Origin checks and safe rendering remain.

# Changelog

## 2.6.76 — maintenance candidate, 2 November 2026

- Preserved the five-image feature through three-image evidence batches, complete
  context synthesis, duplicate mapping, bounded retries and strict raster checks.
- Fixed provider key exhaustion, authentication fallback, malformed results,
  database connection cleanup and meaningful API status/error handling.
- Bound screenshot capture to its requesting tab/window; validated extension
  messages and added request-scoped MV3 keepalive cleanup.
- Corrected stationary badge opening, long Text Scan extraction, hidden executable
  text leakage, blocked-storage Stop and inaccurate shortcut help.
- Added local origin/Host protection and provider-secret redaction.
- Corrected Docker build context, full hashed dependency locking, complete-source
  packaging and release test coverage. Security-fixed Pillow 13 requires Python 3.11+.
- See the repair report for executed checks and remaining deployment limitations;
  this entry does not claim a published release or verified cloud credentials.

## Unreleased

- Reworked onboarding, configuration, API and architecture documentation from source.
- Added contributor checks, explicit release packaging, roadmap, and launch checklist.
- Made CI execute existing tests with failures enforced and read-only PR permissions.
- Fixed duplicate Compose environment mapping and included the practice page in Docker.
- Strengthened exclusions for credentials, history, and private local artifacts.

The original publication preparation identified itself as 2.6.6. No earlier public
release history was substantiated; these local maintenance versions do not imply
that tags or public releases have been created.
