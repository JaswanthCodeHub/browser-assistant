# Browser Assistant 2.9.16

- The Docker image includes the backend launcher required by its startup command.

## Browser Assistant 2.9.15

- Alt+A starts supported automation directly, including Aurora Reflective Journal. When there is one identifiable ongoing journal, the shortcut opens it from Assessments with the floating panel closed.

## Browser Assistant 2.9.14

- Alt+A starts Batch Coding directly on the CCBP Coding Problem Set and leaves a closed floating panel closed.

## Browser Assistant 2.9.13

- On the CCBP course instructions page, Alt+A uses the visible Start Practice button and continues when the questions load. The shortcut does not open a confirmation dialog or the floating panel.

## Browser Assistant 2.9.12

- Alt+A starts MCQ automation directly on CCBP practice and practice review pages. The shortcut leaves the panel closed if it was closed.

## Browser Assistant 2.9.11

- A Chrome extension loaded from the local workspace automatically reloads after a completed build. Active runs finish first, and the webpage stays open.
- The panel displays its loaded build in the header and identifies a different running backend version.
- Drag-and-drop shows a backend restart message when the running server predates ordering verification.
- Starting the local backend with the existing Python command now watches completed builds. It keeps the terminal open and drains active requests before restarting the server worker.
- Pseudocode questions on review routes use the full snippet. Recognized linked-list constructor, merge-branch, and loop-count questions are checked against the code locally.

## Browser Assistant 2.9.10

- The six-step sorted linked-list merge exercise uses a local rule and maps each step to its displayed number.
- Other ordering exercises retry a disagreement and verify that the result contains each displayed step once.
- Restart the backend after updating to enable the new ordering verification.

## Browser Assistant 2.9.9

- Phrase sets are detected when the portal renders directions separately and puts keywords in individual inline elements.
- MCQ solving uses the visible prompt associated with the current options and excludes unrelated coding question wrappers.
- Big-O answers match their displayed options when only backticks or operator spacing differ.

## Browser Assistant 2.9.8

- Continue through numbered reading comprehension, person matching, and sentence gaps with one Submit per passage.
- Fill sentence transformations after verifying the answer uses two to five words and includes the given word.
- Restart the matching backend after updating the extension to enable phrase verification.

## Browser Assistant 2.9.7

- Reading sets with one-word text boxes now continue in the same run as multiple-choice reading sets.
- The extension verifies each word using the shared passage and checks every field before clicking Submit.
- Update and restart the backend along with the extension to enable one-word verification.

## Browser Assistant 2.9.6

- Reading sets with a shared passage and Submit button now match each numbered blank to its own options.
- The extension verifies the complete set before selecting answers. It checks the selections together before submitting and waits for the next passage.
- Install the matching extension and backend versions together to enable linked-answer verification.

## Browser Assistant 2.9.5

- Text scans accept a primary answer when independent verification returns unparseable responses. Linked reading sets in 2.9.6 require agreement on each blank.

## Browser Assistant 2.9.4

- **Alt+A direct automation:** starts, pauses, and resumes the supported run without changing the visibility, position, size, or selected tab of the floating or separate panel. The shortcut is ignored while typing in inputs, textareas, and supported code editors.
- **Automation history:** records direct run type, page, timestamps, totals, completed count, failed count, and final status in a dedicated SQLite table. Scan history remains separate.
- **Linked blanks:** a reading passage or form containing multiple answer groups and one Submit button is handled as individual verified answers, then submitted only after every group has been selected.

## Browser Assistant 2.9.3

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
