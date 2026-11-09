# Browser Assistant 2.9.0

Update the extension and backend together. Restart the backend and reload the extension. Run `python main.py --show-pairing-token` from the backend directory, then paste the value into **Local server token** in the Browser Assistant toolbar popup and click **Pair**. See [setup](SETUP.md) for npm and Docker installations.

- Automation starts from a user action on supported pages. Navigation checkpoints are held by the extension and consumed once.
- Open the assistant on other websites from the toolbar. When a tab screenshot is needed, review the preview and redact private areas before sending it.
- History is opt-in. New history entries omit URL query strings and fragments.
- **Prepare journal draft** uses your class notes to create five editable sections. The portal handles the original-work declaration, official timer and submission.
- Review code before applying it. Embedded editors also ask before grading. The Online IDE checks the saved file and JavaScript syntax and leaves grading to you.
- Inference supports cancellation and a deadline. Provider diagnostics report reachability without running inference.
- The Docker service runs as a non-root user and keeps its data in a named volume. CI checks the unpacked extension in Chromium.

Live provider performance and portal layout compatibility vary. A model agreement label records agreement, and a syntax check establishes that code parses.
