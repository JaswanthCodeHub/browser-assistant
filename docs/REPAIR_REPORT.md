# Update: Vision context and answer checks in 2.7.4

Manual Vision previously sent only a visible screenshot without recognized question/options. It now sends complete MCQ context, hydrates full editor models and captures complete illustrations. URL/prompt/ordered-source/image checks prevent displaying stale results. Malformed Vision output no longer becomes a fabricated answer through a regex fallback. Image preprocessing retains up to 2400px at quality 95 with PNG frontend chart capture to avoid two lossy conversions.

Non-code Vision MCQs now require a second solve from original evidence without proposed answers. Exact answer disagreement, missing entries/IDs, unreadable evidence and malformed check JSON fail closed with `vision_unconfirmed` (422); rate-limit/network failures retain provider error handling. This is an additional check, not a factual accuracy guarantee: the same model can make the same mistake twice and five-image synthesis shares extracted evidence. An additional model request increases latency and quota use. All 183 JavaScript tests, 84 backend tests, 36 standalone parser checks and repository/release-input checks passed. Tests are mocked offline regressions; no live provider benchmark or measured accuracy percentage is claimed. Existing code review and five-image batching remain.

# Update: editor-rendered option fix in 2.7.3

SQL/code options previously used the current rendered viewport as option text. Ace can replace these rows while scrolling or painting, producing a false question-change failure during answer requests. Complete model snapshots now include an ordered per-editor binding list in addition to deduplicated context. A content-world WeakMap attaches full source to each live editor node so the adapter sends complete, distinct options. Option comparison excludes editor viewport internals; an independent ordered complete-source snapshot is rechecked before selection, so this does not suppress real code changes. The question is refreshed after model hydration. All 179 JavaScript tests passed; live Chrome verification was not performed.

# Update: MCQ snippet route fix in 2.7.2

The snippet background handler rejected all document paths except `/primitive-coding/practice/`. This could reject a valid portal MCQ after SPA navigation because Chrome's sender document URL can still describe the original page. The read-only handler now checks the exact HTTPS learning portal origin without depending on its document path; only a missing top-frame URL can fall back to Chrome's tab URL. Extension identity and child-frame boundaries remain enforced. Regression tests reproduce the original rejection, cover current/original/review routes and missing top-frame URLs, and reject foreign senders/origins and unidentified child frames. All 177 JavaScript tests and repository version/syntax/reference checks passed. Live Chrome verification was not performed.

# Update: security workflow removed in 2.7.1

On 2 November 2026 the user explicitly requested removal of the newly added 2.7.0 security layer. The tested pre-security 2.6.76 source was restored as 2.7.1, preserving prior repairs/features. Thirteen newly added security source/test/document files were removed; the populated `.env` was not replaced. The SQLite database passed integrity validation and history was preserved (zero encrypted rows needed conversion on this installation). An owner-protected recovery backup was retained under `.cache` and excluded from releases.

Pairing, certificate/TLS requirements, added encrypted storage, Local Private/Cloud consent selection and automation permission popups are removed. The basic safeguards already present in 2.6.76 remain. The localhost certificate previously imported with explicit user approval is no longer used by the application; its removal and HTTP server startup were blocked by automatic approval review. They were not bypassed or marked successful. A one-time extension reload and normal manual server start are required to activate the restored workflow.

The report below is the historical maintenance audit for 2.6.76, not a claim that the withdrawn 2.7.0 hardening remains enabled.

# Browser Assistant maintenance report — 2.6.76

Audit date: 2 November 2026. Baseline: 2.6.73. Branch:
`codex/maintenance-audit-2026-11-02`.

The corrected source is a tested maintenance candidate. Existing features and the
UI design are retained. It is **not declared fully deployment-verified**: real
cloud authentication/inference, local Ollama inference, Docker execution and the
complete Chrome/site matrix still require validation in the intended environment.
Passing mocked tests does not guarantee every generated answer or hidden test.

## 1. Files inspected

84 original source/configuration/documentation files were inventoried before
application edits. The final inventory contains 92 files: 24 original files
modified, eight files added, zero original source files deleted. Vendor folders,
virtual environments, caches, logs, private databases and populated environment
files are not counted as project source. Runtime settings and database integrity
were inspected separately without publishing their contents.

The pre-edit source backup is
`browser-assistant-maintenance-backup-20261102.zip`
(204,136 bytes). It excludes secrets and private history. Local audit evidence is
in `tmp/maintenance-baseline.json` and the `tmp/maintenance-*.log` files; these
private working artifacts are excluded from releases. The pre-existing staged
and unstaged work was preserved; no blanket reset, staging or commit was made.

## 2–5. Findings, repairs and root causes

There are **22 repair groups**, covering defects and preventive security/configuration
hardening. This is a count of the groups below, not a count of user-visible crashes
or a claim that every historical screenshot had the same cause. All 22 have source
repairs and applicable automated verification. Four deployment validation areas
remain open, listed in section 8.

| ID | Confirmed defect or gap / root cause | Repair |
| --- | --- | --- |
| F01 | Five user images could exceed the provider's three-image request limit | Keep the five-image interface; batches of three/two produce ordered evidence, followed by one synthesis with the original question |
| F02 | Invalid image data could pass through; aggregate image size was unchecked | Strict raster/base64 decoding, numbered 422 errors, 50-megapixel decode cap and combined 27,000,000-character limit |
| F03 | Code language/context could depend only on image one; duplicates lacked logical mapping | Read all image evidence, deduplicate physical pictures and retain every original logical position |
| F04 | Fresh text default could select a catalog model restricted to enterprise accounts | Fresh default GPT-OSS-120b with GPT-OSS-20b fallback; preserve explicit existing settings |
| F05 | Exhausted 429 retries could fall through with no result; 401 did not try backup keys | Raise a clear exhaustion error, try configured backup keys and remove duplicate keys/models |
| F06 | Provider transports lacked explicit lifecycle/timeout handling | Bounded SDK timeouts, Ollama context manager, Groq shutdown cleanup and overall five-minute vision deadline |
| F07 | SQLite connection contexts did not guarantee closure; synchronous work ran on async history routes | Always close/rollback connections, sanitized 503 on database errors, history routes run in FastAPI's thread pool |
| F08 | Malformed non-code provider results could be accepted | Validate result types, MCQ answers and textual metadata; preserve numeric zero and existing code-interface validation |
| F09 | Provider failures appeared as generic 500; mixed network/empty failures could become misleading 422 | Provider exhaustion 502, missing vision provider 503, deadline 504; no-readable-question 422 only for wholly empty evidence |
| F10 | Provider error text/logging could expose secrets | Redact configured credentials, common token patterns and Bearer values in logs and API errors |
| F11 | Local API lacked explicit Host/Origin restrictions | Loopback Host guard, optional explicit host allowlist and permitted local/extension origins; no broad CORS |
| F12 | Screenshot capture could target a different active window | Validate requesting extension/tab, verify active tab and capture its own window |
| F13 | API message path/method/sender and serialization were insufficiently guarded | Explicit own-extension sender/path/method allowlists, null-message and JSON-body handling |
| F14 | Pointer capture on the collapsed badge redirected its click | Stationary pointer release opens the panel; dragging retains position behavior |
| F15 | Manual code/snippet text scans stopped at 12,000 characters | Match the backend's existing 60,000-character code/MCQ allowance |
| F16 | Broad text fallback could include invisible executable page metadata | Exclude scripts, styles, templates, noscript and password controls from fallback extraction |
| F17 | Blocked session storage could prevent Stop cleanup | Stop remains effective even when storage removal throws |
| F18 | Docker ignore rules excluded required runtime modules and syllabus/prompt assets | Align Docker COPY, ignore allowlist and actual runtime payload |
| F19 | Old dependencies had known advisories and installs were not fully locked | Target affected compatible packages and ship a complete hash-locked dependency file |
| F20 | Release allowlist omitted newer required modules and complete source/tests | Validate all release inputs, include source/testing artifacts, ZIP integrity checks, SHA256 sidecars and an external artifact manifest |
| F21 | Empty-panel keyboard hint described the wrong keys | Correct the hint to backtick=open and right bracket=close; bindings remain unchanged |
| F22 | Long inference could leave an MV3 worker inactive while a request awaited its result | Active-request-only 25-second Chrome API pulse, cleared on success/failure; no permanent idle timer |

Four/five-image processing validates exact evidence IDs and rejects missing or
unreadable entries. A transient failed second batch is retried without reprocessing
the successful first batch. Missing evidence never becomes a partial final answer.
Final synthesis receives the merged evidence and original question without
resending the images. One/three-image requests retain their direct path.

## 6. Files modified or added

Modified original files (24):

```text
.github/workflows/ci.yml
.github/workflows/release.yml
.gitignore
CHANGELOG.md
CONTRIBUTING.md
README.md
SECURITY.md
docs/API.md
docs/ARCHITECTURE.md
docs/LAUNCH.md
docs/RELEASE_NOTES.md
docs/SETUP.md
extension/background.js
extension/content.js
extension/manifest.json
extension/question-visuals.js
extension/question-visuals.test.cjs
scripts/package_release.py
server/.dockerignore
server/.env.example
server/Dockerfile
server/main.py
server/requirements.txt
server/test_chart_vision.py
```

Added files (8):

```text
docs/FEATURE_PRESERVATION.md
docs/REPAIR_REPORT.md
extension/maintenance.test.cjs
scripts/smoke_backend.py
server/local_security.py
server/requirements.lock.txt
server/test_maintenance.py
server/vision_images.py
```

## 7. Features preserved

The [26-row preservation checklist](FEATURE_PRESERVATION.md) records the source
inventory. Text/Vision scans, five-image handling, question detection, screenshots,
MCQ/math/code solving, language and starter interfaces, web projects and JS
scaffolds, floating/drag/collapse modes, answer formatting/copy, model settings,
Groq keys/Ollama fallback, popup/API communication, history, settings and shortcuts
are retained. Existing batch filtering, solved-row avoidance, long snippets,
Saving-to-Saved waits, final confirmation, submitted-question Next, class waits,
journal syllabus/timer handling and workspace auto-update are retained too.

`extension/styles.css` and the populated `server/.env` match their baseline
checksums. No UI redesign, stack migration or secret replacement was performed.
The only installation compatibility change is Python 3.11 minimum, required by
the security-fixed Pillow dependency. The installed user environment was not
replaced or upgraded during verification.

## 8. Not verified / unresolved environment conditions

| Area | Evidence and remaining limit |
| --- | --- |
| Live Groq | Current official model IDs checked; requests/retries/fallback tested with mocks. No deliberate paid live-inference test was run. Actual key permissions, remaining quota and answer quality are unverified. A generic request error is not proof of a rate limit. |
| Local Ollama | SDK timeout/context/fallback tests pass. The local service was not reachable on port 11434 during inspection. Actual model installation and inference are unverified; local inference cannot succeed until the service is available. |
| Docker | Compose configuration and static COPY/ignore validation pass. Docker engine was unavailable; Docker Desktop startup terminated unexpectedly. Image build/run and container network access to Ollama are unverified. No OS security/virtualization settings were changed. |
| Full Chrome/site matrix | Local fixture injection, one-click panel opening, mode controls and the 2.6.76 build/shortcut display were observed. Popup/reinstall/permission UI, live screenshot-to-AI rendering, prolonged worker survival, clipboard permission behavior, multiple external websites and responsive viewports are not fully verified. Responsive/screenshot attempts were interrupted by browser tab ownership errors; the temporary viewport override was reset. No successful final screenshot artifact is claimed. |

At the last backend inspection port 8000 served **2.6.72**, without the new vision
batching capability. The corrected backend passed a separate isolated HTTP smoke
run as 2.6.76. The existing server was not replaced, so updating source files alone
does not activate backend changes. The extension rejects incompatible four/five-image
requests with a meaningful update/restart message.

A prior automatic approval review rejected stopping/restarting the existing
server process. That restriction was respected; no alternate process-control
workaround was used. Only the smoke script's own disposable child was stopped.
Chrome extension settings were also not bypassed when access was unavailable.

## 9. Before-and-after automated results

| Executed suite | Baseline | Corrected source |
| --- | ---: | ---: |
| JavaScript Node tests | 164 passed | 175 passed, zero failed/skipped |
| Backend Python unittests | 61 passed | 81 passed on each of Python 3.11, 3.12 and 3.14 |
| Standalone parser checks | 36 passed | 36 passed on each of Python 3.11, 3.12 and 3.14 |
| Isolated real HTTP smoke, mocked providers | Not part of baseline | Startup, practice, text, 1/3/5 images, history and Origin guard passed |

The earlier requested figure of 114 JavaScript tests was stale: the baseline
actually executed here was 164. New assertions do not replace original suites.
The existing chart mock was normalized for strict raw/data-URI image validation;
its behavior assertions remain. Tests use temporary databases, not user history.

Reproduce from a supported Python environment:

```bash
python -m pip install --require-hashes -r server/requirements.lock.txt
npm ci
npm test
python -m unittest discover -s server -p "test_*.py"
python server/test_clean.py
python scripts/smoke_backend.py
python scripts/check_repo.py
python scripts/package_release.py --validate-only
python scripts/package_release.py --tag v2.6.76
```

`test_clean.py` is a standalone 36-check program in addition to unittest discovery;
do not add its checks to the count of 81 unittest cases.

## 10. Security and database results

- Baseline dependency resolution had eight distinct advisory IDs across the
  affected dotenv/Starlette packages. Final locked resolution: **zero known
  vulnerabilities reported by pip-audit** at audit time. npm audit also reported
  zero. This is a point-in-time dependency scan, not proof of zero unknown flaws.
- A Python 3.10/Pillow 12 compatibility candidate still had advisories and was not
  shipped. Python 3.11+ with Pillow 13 is the delivered dependency set.
- Release inputs are scanned for credential-like values. `.env`, populated
  history, logs, virtual environments, caches and previous archives are excluded.
  No actual API-key values appear in this report or the release configuration.
  No exposed key requiring rotation was found in sampled source/log inspections.
  If a key was shared elsewhere, rotate it through the provider's official dashboard.
- SQLite queries remain parameterized; schema and retention behavior are retained.
  Injection/persistence/rollback/connection-closure checks use disposable databases.
  The production database integrity check returned `ok`.
- History changed from 53 rows to zero during the audit; the user explicitly
  confirmed pressing **Clear History**. This intentional deletion was not reversed
  or attributed to test data loss. Database sequence 57 was observed.
- Unsafe answer markup is escaped; regression coverage checks escaping and exact
  copied text. Capture ownership checks reduce accidental other-tab disclosure.
- Host/Origin checks protect the local browser interface; they do **not** add token
  authentication against software or extensions on the same computer. Keep the
  server on loopback. Public/network deployment needs its own authenticated design.
- No broad CORS was added. Existing remote image fetch omits credentials and has
  content/type/size bounds. User-approved page content still reaches the configured
  AI service during ordinary scans; the extension is not a private offline-only tool.

## 11. Backend verification

Fresh hash-locked installations were created separately for Python 3.11, 3.12 and
3.14. Each passed all 81 backend cases and 36 standalone checks. Coverage includes
missing/invalid provider results, all-key 429 exhaustion, 401 backup, model fallback,
Ollama cleanup/timeout, partial vision failures, image validation, all-image code
language selection, HTTP status codes, deadline, secret redaction, Host/Origin
checks and SQLite safety. The smoke server listened on a disposable loopback port
with deliberately blank real Groq credentials, mocked AI and a separate temporary
database. It exited and cleaned up successfully.

## 12. Chrome verification

Real Chrome loaded the existing extension on the local `/practice` fixture. A
single click opened the collapsed assistant; AUTO's Text/Vision controls and the
existing MATH/QA modes remained visible. Build 2.6.76 and Alt+Shift+A were observed
in QA Control. These are observations of the installed UI, not a claim that a live
paid API call was deliberately initiated or that every portal adapter passed a
real exam. The local page also showed completed fixture state on a later read;
that concurrent state is not used as deterministic integration-test evidence.

Browser ownership errors prevented the final screenshot and responsive testing.
No Chrome-internal settings workaround or direct debugging bypass was attempted.
The current release candidate's automated screenshot/message tests cover both
authorized and rejected sender/window cases; actual permission prompts remain a
manual check.

## 13. Performance and reliability changes

Direct one/three-image paths are preserved. For four/five images, batches remain
within provider limits and successful evidence is reused during transient retries.
Duplicate images are decoded once per submitted entry but sent to the provider
once per unique picture; logical references survive. Image compression runs off
the async request loop. History's blocking SQLite work runs in the worker thread
pool and connections close promptly. SDK automatic retries remain disabled where
the application handles rotation, avoiding compounded backoff. Request-only MV3
keepalive timers are always released. No measured live latency or model-accuracy
improvement is claimed; multi-image batching necessarily uses additional AI calls.

## 14. Dependencies and compatibility

The stack remains Manifest V3 / JavaScript / HTML / CSS, Python FastAPI, Groq,
Ollama and SQLite. The direct pins are FastAPI 0.162.0, Uvicorn 0.30.6,
python-dotenv 1.2.2, Groq 0.37.1, Ollama 0.6.3, Pydantic 2.14.2, Pillow 13.0.0,
Starlette 1.3.1 and tree-sitter-language-pack 0.13.0. Existing unaffected pins are
retained. `server/requirements.lock.txt` pins transitive dependencies with hashes;
CI covers Python 3.11/3.12/3.14. Node manifests/lock and existing UI CSS remain.

Official documentation checked during the audit:

- [Groq vision limits](https://console.groq.com/docs/vision): Qwen's three-image
  request ceiling requires batching; the five-image user feature remains.
- [Groq model catalog](https://console.groq.com/docs/models) and
  [deprecations](https://console.groq.com/docs/deprecations): GPT-OSS production
  models and Qwen 3.8 are documented; older Qwen 3.6 is replaced. Llama 3.3 remains
  cataloged with enterprise availability, rather than being universally removed.
- [Ollama Python client](https://github.com/ollama/ollama-python/blob/main/ollama/_client.py)
  and [Llama 3 tags](https://ollama.com/library/llama3/tags): client lifecycle/timeout
  support and the configured model family are documented.
- [Chrome worker lifetime](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle/)
  and [service-worker migration guidance](https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers):
  extension API activity can sustain bounded active operations; this is not an
  indefinite worker lifetime guarantee.
- [Pillow 13](https://pypi.org/project/Pillow/13.0.0/),
  [FastAPI](https://pypi.org/project/fastapi/0.162.0/),
  [dotenv](https://pypi.org/project/python-dotenv/1.2.2/),
  [Starlette](https://pypi.org/project/starlette/1.3.1/) and
  [Ollama](https://pypi.org/project/ollama/0.6.3/): release metadata and Python
  compatibility checked. Account access and future catalog changes remain external.

## 15. Release artifacts and sizes

The separate release directory is `dist/v2.6.76`. It contains an extension ZIP,
backend ZIP and complete corrected source ZIP (including updated tests, fixtures,
safe configuration and setup instructions). Exact sizes, member counts and SHA256
digests are written to **`release-manifest.json` beside the archives** after
packaging; each ZIP also has a `.sha256` sidecar. This avoids embedding a circular
self-checksum/size inside the source archive. The original working folders are
not pruned. Only allowlisted distribution files are packaged after validation.

All three generated archives passed ZIP integrity, SHA256, member-count and
private-file exclusion checks. The source archive was extracted into a separate
temporary directory and passed the repository checker, all 175 JavaScript tests,
81 backend cases, 36 parser checks and the isolated HTTP smoke again. This
additional run validates the packaged source rather than relying solely on the
working checkout. The final documentation update does not alter that tested code.

## 16. Remaining manual activation and verification

1. Keep the populated `server/.env`; install the locked dependencies using Python
   3.11+ in the intended backend environment. See [setup](SETUP.md) and the root README.
2. Restart the existing backend once using the normal launch workflow, then verify
   `/health` reports version 2.6.76 and `vision_batching: true`. The old running
   process will not acquire Python changes just because a page is refreshed.
3. Continue using the workspace extension directory for its existing idle-time
   auto-update workflow. A separately extracted ZIP is a different installed
   copy and needs its own update. Refreshing the learning page does not change
   which extension directory Chrome has installed.
4. Start the configured Ollama service, check `ollama list` for `llama3`, then run
   an explicit local-inference check. No model files or software data were moved
   to a different drive by this maintenance release.
5. Verify a small authorized live scan with the configured account, then Chrome
   popup/capture/clipboard and representative external pages/sizes. Provider quota
   is confirmed by actual provider status, not by guessing from the generic error.
6. Restore Docker Engine/Desktop health before a container build/run check. The
   current Compose setup has no persistent history volume: recreating its
   container discards container-only history. Preserve it before such operations.

## 17. Readiness decision

**Source repair and deterministic regression verification: complete. Release
candidate: 2.6.76. Full live deployment acceptance: pending the four validation
areas in section 8 and activation of the updated backend.** No existing feature
was intentionally removed to make an error disappear. No promise is made that
arbitrary portal changes, provider outages, hidden tests or AI answers cannot fail.
