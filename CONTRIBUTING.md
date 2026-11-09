# Contributing

Welcome! Documentation corrections, reproducible bug reports, accessibility improvements, and focused code changes all help. Follow the [README](README.md) first-run steps and [code of conduct](CODE_OF_CONDUCT.md).

## Development checks

Use Node.js 22.18+ and Python 3.11+. From the root, `npm ci` then `npm test` builds the Chrome scripts and runs the DOM detection and coding automation tests. Run `python scripts/check_repo.py` using the virtual environment Python to check manifest references, compiled script syntax, Python syntax, and local Markdown file links.

Run backend tests from `server/`, with empty Groq environment variables and no populated `.env` in your test checkout:

```powershell
# Windows, from repository root
Set-Location server
..\.venv\Scripts\python.exe test_clean.py
..\.venv\Scripts\python.exe -m unittest discover -p 'test_*.py' -v
```

```bash
# macOS/Linux, from repository root
cd server
../.venv/bin/python test_clean.py
../.venv/bin/python -m unittest discover -p 'test_*.py' -v
```

The first suite is an executable assertion script, not a pytest suite; the second uses unittest and mocked providers. They require runtime dependencies, but no paid AI access. CI executes both and fails on unsuccessful checks. Live provider checks are optional and should use non-sensitive fixtures. Test browser changes on `/practice`, record browser/version and what was tried; automated tests do not replace browser QA.

From the root, `python scripts/smoke_backend.py` starts an isolated temporary HTTP
server with mocked AI and a disposable database. It checks text, 1/3/5-image
requests, persistence and origin protection without changing the production server
or sending paid provider requests.

## Where things live

- `extension/src/content.ts` handles the panel, scanning, history, and automation runs.
- `extension/src/automation-policy.ts` handles target resolution and MCQ adapters, including the generic website fallback.
- `extension/src/coding-automation.ts` and `extension/src/editor-bridge.ts` handle detection and editor integration.
- `extension/src/background.ts` handles screenshot capture and local API requests.
- `server/main.py`: FastAPI, model pipelines, validation, SQLite.
- `server/practice_quiz.html`: local demonstration fixture.
- `docs/`, `.github/`, `scripts/`: onboarding, CI, packaging, checks.

## Propose a change

Use the bug/feature forms for non-sensitive reports. Include a minimal fixture, expected/actual behavior, environment, and reproducible steps. Redact logs and screenshots. For vulnerabilities use [SECURITY.md](SECURITY.md).

Keep each PR focused; explain the user problem, behavior change, checks run, and limitations. Include screenshots only for visible changes and use the local practice page. Add meaningful regression coverage for behavior fixes. Avoid unrelated formatting, dependency churn, real website credentials, or local history files. Do not silently widen permissions or automation capabilities.

Reviewers should verify reproducibility, scope, data handling, failure behavior, and tests; ask for evidence when a feature claim exceeds coverage. No response-time commitment is made. Discuss large changes before implementation. Starter ideas are in the [roadmap](docs/ROADMAP.md); these are suggestions, not existing GitHub issues.

## Release work

`python scripts/package_release.py --validate-only` checks every release input without
creating a ZIP. After checks pass, the command without that option creates extension,
backend and complete-source archives plus SHA-256 files in `dist/v<version>/`.
The source archive includes regression tests. Set the same version in `package.json`,
`package-lock.json`, `extension/manifest.json`, and `server/main.py`. Use
`npm version <version> --no-git-tag-version` to update both npm metadata files.
After merging the release commit to `main`, push its `v<version>` tag. The release
workflow runs the checks, uploads the ZIPs to GitHub Releases, and publishes the
same version as `browser-assistant` on npm and `@jaswanthcodehub/browser-assistant`
on GitHub Packages. `npm pack --dry-run` lists the files in the npm package.
To retry publishing an existing tag, run the Release workflow manually from
`main` with that tag while the extension and backend still match it.

The npm package uses [Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)
with GitHub owner `JaswanthCodeHub`, repository `browser-assistant`, workflow
`release.yml`, and permission to publish. Leave the environment field blank.
An npm maintainer must publish the first version while signed in and configure
the trusted publisher before pushing the next release tag.

Confirm publication rights, account settings, browser QA, and archive contents
using [LAUNCH.md](docs/LAUNCH.md).
