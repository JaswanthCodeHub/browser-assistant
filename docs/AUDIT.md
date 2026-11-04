# Publication audit — 14 October 2026

## Implemented

Rewrote public documentation and contributor/community files from implementation; removed placeholder routing and unsupported release claims. Preserved MIT license and attribution. Aligned backend API version with existing extension 2.6.6. Corrected Compose duplicate environment mapping and included practice HTML in Docker. Added offline repository validation and explicit release allowlists; CI now enforces existing tests with read-only pull-request permissions, and releases are drafts. Added Dependabot, roadmap, release notes, and account-side launch instructions.

## Publication and private data

No applicable AGENTS.md was found in the project or ancestor directories. The folder initially had no Git metadata, remote, tracked files, tags, or history. After reviewing exclusions, Git was initialized on main; nothing was staged, committed, pushed, or published.

A credential-pattern scan of readable project files found a match only in server/.env. Values were never printed. The file remains unchanged and ignored. No evidence of a historical Git leak is available because no history existed. Revoke/rotate that credential if it was previously shared, uploaded, or exposed elsewhere; exclusion does not undo a prior leak. Pattern scanning is not proof that all possible private data is absent.

Local scan_history.db, virtual environments, caches, node_modules, logs, generated archives, and screenshot directories are excluded. The unrelated .github/quizhub-agent.agent.md and .github/skills/quizhub-mcq-expert integration include organization-specific references; both remain local and ignored. QA_REPORT.md is preserved locally and excluded because it describes an obsolete version. Review any new screenshots or fixture data before adding them; ignore rules cannot identify arbitrary private content.

## Validation

Passed on Windows with Node 22.23.2 and fresh Python 3.10.11 environment:

- Clean npm ci and all 11 existing JavaScript tests.
- Fresh Python dependency installation from server/requirements.txt.
- All 36 executable parsing/validation checks and 13 unittest language/provider-pipeline tests, without a copied .env or live AI access.
- Fresh backend startup on temporary loopback port 18001: health, bundled practice HTML, and empty history response.
- Manifest/runtime-file references, matching version, JS/Python syntax, and local Markdown file links.
- Both release archives build, pass ZIP integrity checks, and contain only declared allowlisted files.
- Docker Compose configuration validates without displaying resolved environment values.

Blocked or deferred: Docker image build/startup (Docker Desktop Linux engine unavailable); actual GitHub Actions runs and repository settings (no remote/account repository); Chrome UI/screenshot/editor manual QA; real Groq and Ollama inference; macOS/Linux and Python 3.11/3.12 execution. CI defines those Python matrix and Docker checks, but they have not run remotely. External research links were opened where available; local file-link checks do not validate all external links or heading anchors.

Remaining runtime risks: broad host permissions and generic automation targets, no backend authentication, no screenshot redaction, model correctness limitations, no local vision fallback, ephemeral container history, and Python dependencies not fully locked. These are documented rather than silently changing behavior.

## Launch blockers

Owner/repository name, real private reporting channels, and confirmation of publication rights remain required. Verify browser and provider behavior and require passing hosted CI before release. Follow LAUNCH.md for exact account settings and publication sequence. No public release history has been invented.
