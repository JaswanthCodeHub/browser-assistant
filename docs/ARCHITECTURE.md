# Architecture

The unpacked MV3 extension injects content scripts on matching webpages. `content.js` builds the panel, extracts text, controls runs, and renders answers. `automation-policy.js` resolves targets and adapters; a generic HTTP/HTTPS fallback means this is not an explicit-only allowlist. Coding detection and automation live in `coding-automation.js`.

The content script sends messages to `background.js`, which proxies allowlisted API paths to `127.0.0.1:8000` and captures the visible tab. `editor-bridge.js` provides page-context editor operations through Chrome scripting with sender checks. The popup checks backend health.

FastAPI in `server/main.py` validates request fields, builds prompts, tries Groq for text, and falls back to Ollama. Vision uses Groq only. `vision_images.py` validates rasters, maps duplicates and reads up to five pictures through three-image batches before final synthesis. Code generation includes syntax parsing and independent model review; neither establishes semantic correctness. Model requests can send page content outside the machine when cloud inference is configured.

After successful scans the extension separately posts history. SQLite keeps at most 100 entries with URLs and result strings. Raw screenshots are not explicitly persisted. Position and resume state use website localStorage/sessionStorage, not chrome.storage.

The backend binds to loopback unless SERVER_HOST is overridden. There is no token-based API authentication; `local_security.py` rejects unexpected Host headers and untrusted browser origins, without enabling broad CORS. Docker publishes only host loopback; its history is ephemeral without explicitly configured storage. SQLite connections commit/rollback and close per request, and synchronous history operations use FastAPI's threadpool. Secrets are runtime configuration and redacted from provider errors, never intended image content.

See [API.md](API.md) for the request contract and [SETUP.md](SETUP.md) for runtime configuration. Test fixtures exercise detection, automation, parsing, and mocked model pipelines; real browser/provider behavior still needs manual verification.
