# Release Browser Assistant updates

Treat each completed project update as a release. Follow the release steps in [CONTRIBUTING.md](CONTRIBUTING.md) before handing the update back to the user.

1. Pick a new version and keep the extension manifest, backend, npm metadata, changelog, and release notes in sync.
2. Run the relevant tests and validate the release archives. Stage only files intended for publication. Keep credentials, local output, and unrelated changes out of the commit.
3. Push the tested release commit to `main` and push a matching `v<version>` tag on that commit. The tag triggers the existing Release workflow.
4. Wait for the workflow, verify the published GitHub Release and its downloadable assets, and give the user the release link. If publishing fails, resolve the failure where possible and report the verified status.

Read-only questions and work the user explicitly asks to keep local do not create a release.
