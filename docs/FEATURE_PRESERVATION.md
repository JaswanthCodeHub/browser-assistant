# Maintenance feature preservation checklist

Baseline: 2.6.73, 2 November 2026. Branch: `codex/maintenance-audit-2026-11-02`.
Before application edits: 84 project files inventoried; 164 JavaScript tests, 61
Python unittests and 36 standalone parser checks passed. Source backup is outside
the repository; populated environment files, databases and local artifacts are
excluded. `tmp/maintenance-baseline.json` records original source checksums.

The checked boxes record source preservation, not claims that every live integration
has been verified. The final audit report records executed verification separately.

| Preserve | Feature | Implementation / existing coverage |
| --- | --- | --- |
| [x] | Text Scan, extraction and automatic detection | content.js, automation-policy.js, audit-regressions tests |
| [x] | Vision Scan and up to five illustrations | content.js, question-visuals.js, /solve-vision, chart/visual tests |
| [x] | Screenshots, image compression and chart context | background.js, question-visuals.js, main.py |
| [x] | MCQ single/multiple answers, short answers, ordering | policy adapters, content.js, card/snippet/ordering tests |
| [x] | Mathematics solving | text/vision practice_type=math, result rendering |
| [x] | Coding languages, starter interfaces, independent review | coding-automation.js, editor-bridge.js, code_contract.py |
| [x] | HTML/CSS/JavaScript projects and JS playground scaffolds | editor bridge, web-project tests, language pipeline |
| [x] | Coding batch filters, pagination, solved-row avoidance | coding-batch.js and tests |
| [x] | Floating panel, drag position, collapse/close/minimal modes | content.js, styles.css, position preferences |
| [x] | Results, code formatting, copy and provider badges | renderFullResults, copyToClipboard, escaping |
| [x] | Model configuration and Groq key switching | .env.example, main.py, provider tests |
| [x] | Ollama fallback and keep-alive | try_ollama, language pipeline tests |
| [x] | API proxy, MV3 worker and popup status | background.js, popup.js, manifest |
| [x] | History, SQLite schema/retention and clear-history UI | /history, content.js history rendering |
| [x] | Existing settings and site-local preferences | content.js localStorage/sessionStorage |
| [x] | Backtick / ] / backslash / [ shortcuts | content.js keyboard handler, popup hints |
| [x] | Alt+Shift+A Start/Pause/Resume | automation-shortcut tests |
| [x] | Alt+Shift+J journal workflow | journal-automation.js and tests |
| [x] | Errors, notifications, request retry/cancellation | answer-requests.js and tests |
| [x] | Saving-to-Saved wait and final quiz confirmation | quiz-final and transition tests |
| [x] | Submitted-question Next and expired-attempt handling | submitted-practice tests |
| [x] | Class participant wait | class-quiz-wait tests |
| [x] | Journal syllabus matching and five 80-word fields | journal.py, syllabus JSON and tests |
| [x] | Journal countdown wait to 30:00, Pause/Stop | journal-timer tests |
| [x] | Workspace auto-update without website reload | background.js, auto-update tests |
| [x] | Docker, installation and clean ZIP distribution | Dockerfile, Compose, release/check scripts |

No UI redesign, stack migration, feature removal, live-history reset or existing
secret replacement is authorized by this checklist. Repairs retain existing API
fields and add compatible validation, batching and diagnostics.
