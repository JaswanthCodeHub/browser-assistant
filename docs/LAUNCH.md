# GitHub launch checklist

Suggested description: Chrome extension and local FastAPI backend for AI-assisted learning and authorized browser automation, with Groq and Ollama.

Suggested topics: chrome-extension, manifest-v3, fastapi, python, javascript, groq, ollama, browser-automation, learning-tools.

## Owner decisions and blockers

- Confirm the GitHub owner/repository name and a real private security and conduct reporting contact.
- Confirm rights to publish the source and existing MIT attribution, which has been preserved unchanged.
- Confirm the unrelated organization-specific QuizHub files are excluded; they remain local and ignored.
- Keep old QA_REPORT.md local: it describes a different version and is not current validation evidence.
- Verify provider model availability and do manual Chrome QA on the synthetic practice fixture. No real screenshots or demos are supplied yet.

## Publication steps (owner runs after review)

1. Review `git status --short --untracked-files=all` and `git status --short --ignored`; confirm no private artifacts would enter the initial commit. Git was initialized on main; no remote, commit, tag, or push was created by this preparation.
2. Run the contributor checks and inspect the extension, backend and complete-source archives. Inspect the staged diff after `git add .`, then create the initial commit locally.
3. Create an empty GitHub repository under your chosen owner. Choose visibility deliberately; a private first review is useful if ownership or exclusions remain uncertain. Set description and topics above.
4. Add the real remote using `git remote add origin <the URL GitHub shows>`; verify `git remote -v`, then explicitly authorize/run `git push -u origin main`.
5. Enable Issues and create labels if desired. Discussions are optional; add routing links only after enabling them and knowing the real URL.
6. Enable private vulnerability reporting in repository Security settings and configure a private conduct-reporting channel. Update SECURITY.md and CODE_OF_CONDUCT.md with verified details.
7. Keep default Actions token permissions read-only. Require approval for outside contributors' workflows; do not send secrets/write tokens to fork PRs. CI uses pull_request, not pull_request_target.
8. After the first CI run, protect main with a ruleset requiring PR review and the actual emitted checks: Extension checks, Python 3.11, Python 3.12, Python 3.14, Docker smoke. Availability depends on account plan and visibility. Verify exact names in the run before selecting required checks.
9. Review dependency alerts and Dependabot updates. Add verified CODEOWNERS only when responsibility is agreed.
10. Review the release notes and archives, then push the version tag matching the current manifest. The release workflow runs the checks and publishes the archives and checksums when they pass.

## References and patterns applied

- [GitHub Actions secure use](https://docs.github.com/en/actions/reference/security/secure-use): least privilege and untrusted contribution boundaries.
- [Private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/report-privately): account-side reporting setup.
- [Page Assist](https://github.com/n4ze3m/page-assist) and its [contribution guide](https://github.com/n4ze3m/page-assist/blob/main/CONTRIBUTING.md): explicit unpacked installation and separate contribution entry points.
- [Browser Use](https://github.com/browser-use/browser-use): concrete first-run sequence and clear configuration prerequisites. Its branding, assets, and compatibility claims were not copied.
- [Ollama contribution guide](https://github.com/ollama/ollama/blob/main/CONTRIBUTING.md) and [releases](https://github.com/ollama/ollama/releases): focused changes, runnable checks, and identifiable release artifacts.

Research inspected repository onboarding, contribution paths, issue navigation/forms where available, and releases. Some Browser Use contribution/issue-template pages failed to load; no conclusions depend on their unavailable content. No sponsor, ownership, release-history, or response-time claims were borrowed.
