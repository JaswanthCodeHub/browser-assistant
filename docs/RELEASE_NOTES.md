# Browser Assistant 2.8.3

- Vision verification now checks the requested chart series, legend, and calculation. A malformed response or disagreement gets one extra independent solve, and results require two matching answers.
- Vision rate limits now show the provider cooldown. Short waits can retry while the same question remains open.
- Restart the backend after upgrading so the new verification logic takes effect.

- Install the compiled Chrome extension and local Python backend with `npm install browser-assistant`. See the [npm setup and upgrade instructions](https://github.com/JaswanthCodeHub/browser-assistant/blob/main/README.md#install-and-update-with-npm).
- Future GitHub release tags publish matching versions to npm after the release checks pass.

The extension and backend ZIPs with SHA-256 checksums are also available. Follow the [GitHub installation instructions](https://github.com/JaswanthCodeHub/browser-assistant/blob/main/README.md#install-from-github).

See the [changelog](https://github.com/JaswanthCodeHub/browser-assistant/blob/main/CHANGELOG.md) for earlier changes.
