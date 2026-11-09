# Architecture

The MV3 extension loads on supported hosts. The toolbar can grant access to an active tab on another website for manual scans. `automation-policy.js` resolves adapters and checks their permissions. Browser Assistant keeps short-lived, one-use navigation checkpoints in extension-owned session storage, scoped to the originating tab and destination.

`background.js` proxies allowlisted loopback API routes and checks the active tab before and after screenshots. Illustration extraction and the crop and redaction preview live in `question-visuals.js`. `editor-bridge.js` handles editor reads and approved writes on supported pages. The popup manages pairing, provider diagnostics and the history preference.

FastAPI validates requests and requires a local pairing token for inference, history and provider diagnostics. `inference_jobs.py` runs two inference jobs at a time, accepts cancellation and applies a five-minute deadline. Results are held briefly in memory. Legacy synchronous inference routes remain available with pairing.

Groq provides text and vision. Ollama can serve text locally. `vision_images.py` validates and deduplicates rasters. It batches four or five images before final synthesis. The code pipeline checks syntax, starter interfaces and independent model review.

SQLite retains up to 100 entries when history is enabled. The server omits query strings and fragments from new history entries. Compose keeps the database and pairing token in a named volume.

See [API](API.md) for request contracts, [setup](SETUP.md) for pairing, and [contributing](../CONTRIBUTING.md) for running the fixtures in Chromium.
