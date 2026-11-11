# Browser Assistant 2.9.3

- The floating panel, popup, journal controls, countdown, and practice quiz use a layered glass theme with blue and teal lighting.
- Solid primary buttons, recessed fields, and visible keyboard focus make controls easier to distinguish.
- Text stays opaque across scan results, history, status messages, and disabled controls.

## Browser Assistant 2.9.2

- Text Scan reconnects when the backend starts after the page loads.
- The local practice quiz sends each option letter once so valid answers match their displayed options.
- Vision Scan includes illustrations inside recognized answer buttons.
- Concurrent Groq requests preserve their backup-key order.
- Missing journal files affect journal generation while other backend routes stay available.
- The Windows setup instructions use one Python environment for dependency installation and backend startup.

## Browser Assistant 2.9.1

## Separate panel edition

This local edition adds an optional browser window for the assistant controls, explicit tab binding, and viewport clamping when the floating panel changes size. See [Separate Panel Window](SEPARATE_PANEL.md) for setup and recording preview steps.

This rollback restores the Browser Assistant v2.8.26 implementation after the v2.9.0 release. Update the extension and backend together.

# Browser Assistant 2.8.26

- Remove the n8n WhatsApp journal reminder and its setup form. The upgrade clears previously saved webhook settings.

- Press **Alt+A** to start, pause or resume automation. The previous **Alt+Shift+A** remains supported, including when a code editor has focus.

- CCBP Online IDE automation opens `app.js` and pastes the reviewed solution in the editor. Grading starts only after the saved file matches the pasted code and passes a syntax check. If the editor blocks the paste or the save cannot be confirmed, the extension reports the issue for review.

- Add repository instructions for pushing, tagging, and verifying a GitHub Release for every completed update.

- Read rendered numeric matrix rows and verify RREF pivot-count choices locally, including matrices with zero rows. Update the Chrome extension and restart the local backend to use both changes.

- See other active journal countdowns while writing the current journal. The toolbar shows the soonest timer and the popup lists all active timers.

- View the last active journal's estimated time remaining at the bottom left of other websites where Chrome allows Browser Assistant to run.

- The draft screen can restore the last observed countdown after an immediate reload. A temporary zero while the portal clock loads leaves the saved countdown available.

- Pin Browser Assistant in Chrome to see the journal's approximate time remaining across tabs. Open the icon for the countdown in minutes and seconds.

- Show draft recovery instructions when Aurora displays its unsaved-draft notice. Refresh the countdown from the portal clock when it reappears.

- The Guidelines page restores the last observed countdown for that journal after a reload. Elsewhere on Aurora, QA Control displays the last journal countdown.

- View the last journal countdown in QA Control on Aurora's Assessments page.

- Keep the journal countdown available after a reload. Open the Browser Assistant toolbar popup from any tab to see the last journal's estimated time remaining.

- Removed Lab Report from the extension and local backend.
- Verify the supported Row Parallelism question using the input and weight dimensions.

- Single-choice Text Scan and QA Control compare answers using the displayed option list. One additional blind solve can resolve a disagreement when two answers identify the same choice.

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
