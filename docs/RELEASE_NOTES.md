# Browser Assistant 2.8.6

- Text and Vision scans calculate supported 2×2 inverse and matrix multiplication dimension questions from complete page text. Automation can use the result when exactly one displayed option matches.

- A question that cannot be verified no longer ends the run. On supported CCBP practice pages, an available Skip control defers the question and automation continues. On pages without a supported Skip control, review and advance manually to resume the same run.
- The progress counter shows deferred questions separately from completed answers.

- Text and Vision verification recognize equivalent LaTeX and bracket notation for numeric matrices. A different sign, cell order, or option label still fails verification.
- An incomplete independent Text Scan verification gets one retry using the original question and options.

- Vision verification now checks the requested chart series, legend, and calculation. A malformed response or disagreement gets one extra independent solve, and results require two matching answers.
- Vision rate limits now show the provider cooldown. Short waits can retry while the same question remains open.
- Restart the backend after upgrading so the new verification logic takes effect.

- Install the compiled Chrome extension and local Python backend with `npm install browser-assistant`. See the [npm setup and upgrade instructions](https://github.com/JaswanthCodeHub/browser-assistant/blob/main/README.md#install-and-update-with-npm).
- Future GitHub release tags publish matching versions to npm after the release checks pass.

The extension and backend ZIPs with SHA-256 checksums are also available. Follow the [GitHub installation instructions](https://github.com/JaswanthCodeHub/browser-assistant/blob/main/README.md#install-from-github).

See the [changelog](https://github.com/JaswanthCodeHub/browser-assistant/blob/main/CHANGELOG.md) for earlier changes.
