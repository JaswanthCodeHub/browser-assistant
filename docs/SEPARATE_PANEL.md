# Separate Panel Window

Extract the extension ZIP into its own folder. In Chrome, open `chrome://extensions`, turn on **Developer mode**, then select **Load unpacked** and choose the extracted folder containing `manifest.json`. Use a separate Chrome profile or turn off the other Browser Assistant instance in this profile while you try this edition. Refresh any existing webpages so the new panel can load.

1. Open the web tab you want to use. Open Browser Assistant from the Chrome toolbar and choose **Open separate panel for this tab**.
2. The new window controls that tab. Its header shows the tab title and any available journal countdown. The selected webpage's floating controls are hidden while the separate window is open.
3. To switch targets, open the toolbar on the new tab and choose the separate panel again. Chrome reuses the existing assistant window. Keep the selected tab active in its own browser window when using Vision Scan.
4. Choose **Return to floating panel** to restore the in-page controls. Closing the separate window also restores the floating panel and keeps **Resume separate panel for this tab** available from the toolbar after a Chrome restart.

Text Scan, Vision Scan, modes, history, code copying, and QA Control use the selected tab's existing assistant session. Alt+A toggles automation, Alt+Shift+J invokes the journal shortcut, and backslash invokes Vision Scan. In the separate window, the left bracket toggles compact view, the backtick expands it, and the right bracket returns to the floating panel.

## OBS Window Capture on Windows

1. Open the separate assistant window and leave the intended page selected in its own Chrome window.
2. In OBS, add a **Window Capture** source. In **Window**, choose the Chrome window titled for the webpage. Keep other sources that could show the desktop out of the scene.
3. Check the preview, then make a short test recording. Bring the assistant to the foreground, drag it over part of the selected Chrome window, and run a harmless Text Scan. Play the clip back and confirm the page and audio are as intended and the separate assistant stays outside the recording.
4. Repeat the preview check after changing the selected window, tab, or OBS source. Full-display recording can include both windows when they are on the recorded display.

See the [OBS Window Capture guide](https://obsproject.com/kb/window-capture-sources). An OBS recording and playback check requires manual verification on the recording computer.

## Recording a Chrome tab

1. Open the separate panel for the tab you intend to record.
2. In your recorder's Chrome sharing dialog, choose **Chrome Tab** and select the webpage. Verify the tab name in the preview.
3. Interact with the separate panel while making a short test clip. Play it back and verify the captured video contains the selected tab content. Check again if you retarget the panel or change the shared surface.

A user-selected Chrome tab recording requires manual verification. The browser can include website content, controls, and popups that are part of the selected surface. Follow the website's rules for using extensions and recording. See the [screen sharing API guide](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia).

## Source changes

| File | Change |
| --- | --- |
| `extension/src/content.ts` | Keeps one floating panel per document, clamps the panel on size changes, and shares its controls and journal countdown with the separate window. |
| `extension/styles.css` | Keeps the v2.9.1 panel style and adds narrow-viewport sizing and the separate window layout. |
| `extension/detached-panel.html`, `extension/src/detached-panel.ts` | Show the selected tab, mirror the assistant controls, and support keyboard navigation, shortcuts, and returning to the floating panel. |
| `extension/popup.html`, `extension/src/popup.ts` | Add the toolbar button that opens, resumes, or retargets the separate window. |
| `extension/src/background.ts`, `extension/src/detached-panel-background.ts`, `extension/src/assistant.d.ts` | Route controls to the chosen tab, reuse one window, remember the mode, and verify which tab a Vision screenshot comes from. |
| `extension/automation-shortcut.test.cts`, `extension/journal-automation.test.cts`, `extension/maintenance.test.cts`, `extension/vision-accuracy.test.cts` | Update existing test fixtures and cover countdown rendering and canceled drags. |
| `scripts/test_separate_panel.cjs`, `package.json`, `package-lock.json` | Add a Chromium regression test, its command and dependency, and the new runtime files. |
| `scripts/package_release.py` | Include the new window, tests, and guide in the appropriate ZIP archives. |
| `README.md`, `docs/RELEASE_NOTES.md`, `docs/SEPARATE_PANEL.md` | Describe the local edition, setup, and recording preview checks. |

Run `npm ci` and `npm test` for the extension suite. For the browser regression, run `npx playwright install chromium` and `npm run test:browser`. The browser test uses local webpages and a simulated backend.
