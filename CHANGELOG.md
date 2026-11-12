# 2.9.12

- Start MCQ automation directly with Alt+A on CCBP practice and practice review pages, without a confirmation popup or startup banner.

# 2.9.11

- Reload the locally built Chrome extension as soon as the current panel is idle and a complete new build is available.
- Show the actual running build in the panel and identify older backends before starting drag-and-drop.
- Keep the backend launcher running across workspace builds and drain active requests before loading the new version.
- Read the full code on practice and review routes and check recognizable linked-list pseudocode against the displayed choices.

# 2.9.10

- Solve the six-step sorted linked-list merge exercise locally against the displayed order.
- Retry verification when ordering answers disagree and require a complete sequence with each displayed number used once.

# 2.9.9

- Detect sentence transformations when directions and passage are rendered separately or keywords are split across inline elements.
- Use the active MCQ prompt and its matching code context. Ignore stale question wrappers.
- Match Big-O options across display backticks and spacing without changing operators or option letters.

# 2.9.8

- Recognize grouped passage comprehension, person matching, and sentence gaps with a shared Submit.
- Verify two-to-five-word sentence transformations, including the unchanged given word, before filling the set.

# 2.9.7

- Continue from reading passages with multiple-choice options to passages with one text box per blank.
- Verify one word for each blank against its passage, fill every field, and check the complete set before the shared Submit.

# 2.9.6

- Recognize linked reading blanks from their numbered prompts, including layouts without named radio groups or associated labels.
- Verify every blank against its own options, check that all selections are still present, and use the shared Submit once per set.
- Wait for the next passage after submission, including when it reuses the same question and option text.

# 2.9.5

- Accept the primary answer when the independent verification solver returns unparseable responses instead of blocking automation with a 422 error.
- Accept multi-answer questions (fill-in-the-blank) when the majority of individual answers agree with the independent solve.

# 2.9.4

- Run Alt+A automation directly without opening, expanding, or moving either assistant panel; ignore the shortcut while a text or code editor has focus.
- Record direct automation runs independently from scan history in the existing local SQLite database.
- Detect linked multi-blank questions with one shared Submit action, verify each blank separately, and select every answer before submission.

# 2.9.3

- Restyle the floating panel, popup, journal controls, countdown, and practice quiz with frosted surfaces and opaque, high-contrast text.
- Add visible keyboard focus, readable disabled states, and compact layouts for narrow viewports.

# 2.9.2

- Reconnect Text Scan after the backend starts without requiring a page reload.
- Keep option letters from appearing twice in the local practice quiz scan.
- Include illustrations in answer buttons in Vision Scan.
- Keep Groq fallback keys available to each request during concurrent retries.
- Keep the backend available if the journal syllabus or prompt is missing.
- Clarify which Python environment to use to install and start the backend on Windows.

# 2.9.1

- Roll back the v2.9.0 feature set and restore the v2.8.26 implementation.

# 2.8.26

- Remove the n8n WhatsApp journal reminder, workflow template, and popup settings. Upgrading clears saved webhook credentials and reminder records.

# 2.8.25

- Start, pause and resume automation with Alt+A. Keep Alt+Shift+A as a compatible alternative and update the popup and button hints.

# 2.8.23

- Paste reviewed Node.js code into an empty `app.js` in the CCBP Online IDE. Check that the editor saved the code and that it passes JavaScript syntax checks before starting grading.

# 2.8.22

- Record the release process for every completed Browser Assistant update, including verification of the published GitHub Release.

# 2.8.21

- Preserve the rows of rendered numeric matrices and calculate RREF pivot-count answers locally.

# 2.8.20

- Track active journal countdowns separately. Opening another journal keeps earlier timers visible and keeps each reminder independent.

# 2.8.19

- Show the journal countdown in a small corner badge on other websites, even with the Assistant panel closed.

# 2.8.18

- Save the visible journal clock as soon as it appears and restore it on immediate same-tab reloads while extension storage finishes saving.

# 2.8.17

- Display approximate journal time remaining on the pinned Chrome toolbar icon across tabs.

# 2.8.16

- Explain how to reopen an existing draft when Aurora returns to Guidelines before showing the journal timer.

# 2.8.15

- Restore the saved countdown for the same journal on the Guidelines page and show the last journal countdown in QA Control elsewhere on Aurora.

# 2.8.14

- Show the last journal countdown in QA Control on Aurora's Assessments page.
- Add an optional n8n webhook reminder when the journal submission has not been confirmed near 30:00 remaining.

# 2.8.13

- Show the journal countdown after a page reload and in the Chrome extension popup when away from the journal page.

# 2.8.12

- Removed Lab Report from the extension and local backend.
- Verify the supported Row Parallelism question using the input and weight dimensions.

# 2.8.7

- Verify single-choice text answers against the original displayed options and retry once when independent solves disagree.

# 2.8.6

- Calculate supported 2×2 matrix inverse and matrix multiplication dimension questions locally when exactly one displayed choice matches.

# 2.8.5

- Continue a practice run after an answer cannot be verified. Use a verified Skip control where supported and keep deferred questions visible for review. On other pages, wait for manual advance and resume on the next question.

# 2.8.4

- Match equivalent numeric matrix notation in verified answers while preserving cell values, order, and option labels.
- Retry an incomplete text verification once. Text and Vision scans require verified answers before using them for a detected question.

# 2.8.3

- Improved chart and table answer verification. Use structured vision responses and one extra check when a response is malformed or the first two solves disagree.
- Report vision provider cooldowns so automation can wait before retrying a rate-limited request.

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
