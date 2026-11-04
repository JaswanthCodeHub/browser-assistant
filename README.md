# Browser Assistant

A Chrome Manifest V3 extension with a local Python backend for exploring multiple-choice questions and coding exercises on webpages. Built for learners reviewing answers and developers experimenting with automation on pages they own or have permission to operate.

## What it does

- Extracts page text and requests answers from Groq, with Ollama fallback for text requests.
- Captures the visible browser tab for Groq vision analysis.
- Detects requested programming languages and validates generated code syntax; model review does not prove correctness.
- Displays results in an in-page panel, offers code copying, and saves successful scans in local SQLite history.
- Includes a local practice page and automation for selecting answers, filling editors, and submitting supported forms after starting a run.
- Resumes CCBP practice from an already submitted answer through its submitted-question Next control, without generating or submitting that answer again. Delayed Submit controls are awaited for up to 15 seconds while the question and selected answer remain unchanged.
- Press **Alt + Shift + A** on the webpage to start automation, then press it again to pause or resume. It also works with the code editor focused and opens QA Control. Journal automation uses the same toggle; its existing **Alt + Shift + J** shortcut remains available.

AI answers can be wrong. Automation can change or submit page content: use it only where authorized, review results, and avoid restricted assessments. Site detection is heuristic; custom controls, frames, editors, and navigation can fail. The policy includes a general HTTP/HTTPS fallback, so it is not a strict site allowlist.

## First run

### Continuous coding batch

On CCBP `/problems-set`, start on page 1 and keep both **Not Attempted** and
**In Progress** visible in the status filters. Choose **QA Control → Start automation**.
The batch skips Solved rows, opens an eligible question, reads its language and
existing code, generates and submits a solution, and returns to the list only after
a confirmed passing result. It follows numbered pages within the selected filters.
Keep the browser tab and local AI server open; Pause/Resume and Stop are available.
Failed tests, unsupported layouts, or unconfirmed results stop the batch with a reason.
Reloading during solving/submission stops rather than submitting twice. Starting on
a single question still solves just that question. Batch behavior has fixture tests;
completion on the live portal has not been verified.

Use Chrome, Python **3.11+**, and either a Groq key or an installed Ollama model for text scans. Building from source or running contributor tests requires Node.js **22.18+**. Chrome internal pages cannot run content scripts; other Chromium browsers are not verified here. Firefox is not supported by this manifest.

### Install and update with npm

In a dedicated folder, run `npm init -y` and then `npm install browser-assistant`. The package includes the compiled Chrome extension and the local Python backend.

1. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `node_modules/browser-assistant/extension` inside your folder.
2. Create and activate a Python 3.11+ virtual environment in your folder. Install the backend dependencies with `python -m pip install --require-hashes -r node_modules/browser-assistant/server/requirements.lock.txt`.
3. Copy `node_modules/browser-assistant/server/.env.example` to `.env` in your folder. Set `HISTORY_DB_PATH=./scan_history.db` in that copy and configure a provider as described below. Keep this file and the database beside `node_modules` so they persist across upgrades.
4. From your folder, start the backend with `python -m uvicorn --app-dir node_modules/browser-assistant/server --env-file .env --host 127.0.0.1 --port 8000 main:app`. Check `http://127.0.0.1:8000/health`.

If you're moving from a ZIP install, copy your existing `server/.env` and `server/scan_history.db`, if present, into the new folder to keep your provider settings and scan history.

To upgrade, stop the backend and run `npm install browser-assistant@latest` from the same folder. Rerun the Python dependency install, restart the backend, and click **Reload** on the extension card in `chrome://extensions`. Refresh any open tabs where you use the extension.

### Install from GitHub

Download the backend ZIP or clone this repository, then open a terminal in the extracted backend folder or repository root. Versioned extension, backend, and source ZIPs with SHA-256 checksums are available on the [GitHub Releases page](https://github.com/JaswanthCodeHub/browser-assistant/releases).

### Windows PowerShell

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --require-hashes -r server\requirements.lock.txt
Copy-Item server\.env.example server\.env
# Edit server\.env as described below, then:
Set-Location server
..\.venv\Scripts\python.exe main.py
```

### macOS / Linux

```bash
python3.11 -m venv .venv
.venv/bin/python -m pip install --require-hashes -r server/requirements.lock.txt
cp server/.env.example server/.env
# Edit server/.env as described below, then:
cd server
../.venv/bin/python main.py
```

Python 3.12 or 3.14 can replace 3.11. Pillow 13 security fixes require Python 3.11+, so Python 3.10 is no longer in the secure installation matrix. Existing users on 3.11+ keep their runtime. These commands avoid shell activation requirements. Do not overwrite an existing `.env` or environment when updating a local installation.

### Configure a provider

For cloud inference, set `GROQ_API_KEY` in your `.env` to your own key from [Groq Console](https://console.groq.com/). Text and vision model IDs are configurable; provider availability and account access can change. The example matches implementation defaults, not a guarantee that a model is available to your account.

For local text inference, install [Ollama](https://github.com/ollama/ollama), run `ollama pull llama3`, and ensure its service is running. Leave all Groq key fields empty to keep text inference on Ollama; when a Groq key is present, Groq is tried first. Set `OLLAMA_MODEL` to an installed model name. Vision scans require Groq and have no Ollama fallback. See [configuration and troubleshooting](docs/SETUP.md).

### Install and try the extension

1. Extract the extension ZIP from Releases. If using a clone or the source ZIP, run `npm ci` and `npm run build` from its root to prepare the `extension` folder.
2. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the prepared folder containing `manifest.json`.
3. Open `http://127.0.0.1:8000/health`. A JSON `status: "ok"` confirms the backend is running; it does not test model access.
4. Open `http://127.0.0.1:8000/practice`, then use the floating panel's Text Scan. Review the answer before trying automation with Start.
5. After changing extension files, reload it in the extensions page and refresh the practice tab.

The toolbar popup reports backend status. In-page shortcuts are backtick (open), `]` (close), `\` (vision scan), and `[` (minimal mode). They are hardcoded page listeners, not configurable Chrome extension commands.

## Data and permissions

The backend binds to `127.0.0.1:8000` by default and has **no authentication**. Keep it local. Its address is fixed in the extension.

The manifest requests `activeTab`, `tabs`, `scripting`, and `clipboardWrite`, plus access to all URLs and localhost. Content scripts run on matching pages; scripting bridges supported page editors, tabs support capture and messaging, and clipboard access supports code copying. These are broad permissions; install only if you accept page access.

Text scans send extracted text and the current URL to the backend. Groq receives model prompts containing question text; vision scans capture the entire visible tab, compress the image, and send it to Groq. Sensitive content visible in a tab may therefore leave your machine. There is no screenshot redaction step. The application does not explicitly save raw screenshots to disk; request data exists in memory, and providers have their own retention policies.

Successful scans are saved by the extension through `/history`: URL, timestamp, scan type, provider, language, and answer JSON are kept in `server/scan_history.db`, capped at 100 entries. Clear History deletes rows, not a forensic secure erase. Stop the backend and remove the database and its `-wal`/`-shm` companions for file-level removal; backups may still contain data. Panel position uses the page's localStorage, and automation resume state uses its sessionStorage. Clear site data to remove those settings. Minimal/stealth controls change presentation; they do not guarantee invisibility or privacy.

## Development and Docker

From the repository root:

```bash
npm ci
npm test
python scripts/check_repo.py
```

Edit the TypeScript sources in `extension/src/`. Run `npm run build` to regenerate the JavaScript used by Chrome before reloading the unpacked extension. `npm test` builds and type-checks the extension before running its tests.

Use your environment's Python for the last command. Backend checks and Docker instructions are in [CONTRIBUTING.md](CONTRIBUTING.md) and [SETUP.md](docs/SETUP.md). `server/requirements.lock.txt` pins the full dependency graph with package hashes; `requirements.txt` records the direct dependencies. Use the lockfile for installation. The [repair report](docs/REPAIR_REPORT.md) distinguishes automated checks from unverified live integrations.

## Get involved

Small, focused contributions are welcome. Start with the [contribution guide](CONTRIBUTING.md) and [roadmap](docs/ROADMAP.md). Read the [code of conduct](CODE_OF_CONDUCT.md) and [security policy](SECURITY.md) before reporting problems.

[API](docs/API.md) · [Architecture](docs/ARCHITECTURE.md) · [Changelog](CHANGELOG.md) · [Launch checklist](docs/LAUNCH.md)

Licensed under the [MIT license](LICENSE). The existing attribution is preserved; the repository owner must confirm rights to publish before launch.
