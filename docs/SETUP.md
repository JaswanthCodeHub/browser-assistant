# Configuration and troubleshooting

The backend explicitly loads `server/.env`; process environment variables take precedence. Never share your populated `.env`. Install using `python -m pip install --require-hashes -r server/requirements.lock.txt` from the project root. Existing `.env` files and history are retained when updating source files.

| Variable | Default / behavior |
| --- | --- |
| GROQ_API_KEY, GROQ_API_KEY_2, GROQ_API_KEY_3 | Empty means no Groq; additional keys are tried on rate limits, not periodically rotated for security |
| GROQ_TEXT_MODEL | openai/gpt-oss-120b; fallback openai/gpt-oss-20b, then Ollama |
| GROQ_VISION_MODEL | qwen/qwen3.8-27b; must support images and be available on your account |
| GROQ_VISION_FALLBACK_MODELS | Optional comma-separated vision model IDs available on your account; no speculative default |
| OLLAMA_MODEL | llama3; install separately |
| OLLAMA_HOST | Ollama SDK default; normally http://127.0.0.1:11434 |
| CODE_DEFAULT_LANGUAGE | python; also cpp, java, javascript, c, csharp, go, rust, kotlin, php, sql |
| FAST_SCAN_MODE | true; false enables additional normal MCQ review |
| VISION_MAX_TOKENS | 1200; positive integer |
| SERVER_HOST | 127.0.0.1; container overrides to 0.0.0.0 internally |
| SERVER_ALLOWED_HOSTS | Optional additional hostnames; loopback names are allowed by default |
| HISTORY_DB_PATH | Empty preserves `server/scan_history.db`; an optional existing writable path supports explicit deployment storage |

The extension always uses port 8000. `/health` reports configuration, not successful provider authentication or Ollama reachability.

The five-image feature is preserved. The current Qwen vision API accepts three
images per request: four/five unique images are read in ordered batches, then all
evidence and the original question are synthesized into a final answer. A failed
or incomplete batch prevents a partial answer. Duplicate pictures retain a logical
position mapping without duplicate processing. Images must decode as supported
rasters; SVG illustrations are rasterized by the extension. The combined base64
payload limit is 27,000,000 characters and decoded images are capped at 50 megapixels.
Vision processing has a five-minute overall deadline. One/three-image requests
keep their direct path. A new extension detects an older backend before sending
four/five-image chart requests; restart the updated backend to enable batching.

Llama 3.3 remains an enterprise model in Groq's current catalog. Existing explicit
model settings are retained; fresh installs default to GPT-OSS. Model availability
and quotas depend on your account. No API-key values appear in health responses.
Local browser requests reject untrusted web origins and unexpected Host headers;
this is not authentication against other software running on the same computer.

## Docker

Install Docker Engine/Desktop with Compose. Copy `server/.env.example` to `server/.env` and configure it first. From the repository root, on PowerShell or a POSIX shell:

```bash
docker compose config --quiet
docker compose up --build -d
```

Open `http://127.0.0.1:8000/health` and `/practice`; install the unpacked extension as in the README. The practice fixture is included in the image. The port is published only on host loopback. Ollama runs on the host, reached through `host.docker.internal`; on Linux, the host Ollama service must be reachable from the Docker bridge. Avoid opening Ollama to untrusted networks.

```bash
docker compose down
```

History lives inside the container and is lost when the container is removed or recreated. No persistent volume is configured. The `.env` is supplied at runtime and excluded from image build context. `docker compose config` without `--quiet` can print resolved secrets.

## Troubleshooting

- **Offline popup:** start the backend in `server/`; check port 8000 and `/health`. Another process may occupy the port.
- **No panel:** use an ordinary HTTP/HTTPS page, reload the extension and refresh the page. Chrome internal pages and the Chrome Web Store restrict extensions.
- **Text model fails:** check the key/model in your own provider console. For Ollama, check `ollama list`, service reachability, and available memory. A local model is not bundled.
- **Vision fails:** use a Groq model with image support. No local vision fallback exists. Review visible tab contents before capture.
- **Editor or form cannot be detected:** use manual copying or a small reproducible fixture. Do not assume arbitrary websites are compatible.
- **Python installation fails:** use Python 3.11+, required by the security-fixed Pillow 13 dependency. The test matrix covers 3.11, 3.12 and 3.14. Report errors without credentials.
- **History fails:** ensure the server folder is writable. Save failures need not prevent answers from being displayed.

Cloud provider tests require your own credentials and may incur costs. Never include keys, private question content, URLs with tokens, or unredacted screenshots in reports.
