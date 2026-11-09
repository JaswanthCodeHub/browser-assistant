# API reference

Default base: `http://127.0.0.1:8000`. Interactive schemas: `/docs`; machine-readable schema: `/openapi.json`. No authentication or CORS middleware is configured; the extension proxies requests through its background worker. Do not expose the API publicly.

| Method | Route | Behavior |
| --- | --- | --- |
| GET | /health | Configuration and process health, not provider connectivity |
| GET | /practice | Bundled HTML fixture |
| POST | /solve | Text inference: Groq first, then Ollama fallback |
| POST | /solve-vision | Visible screenshot inference through Groq only |
| GET | /extension-release | Current workspace extension version, read from disk |
| POST | /journal | Syllabus-based five-section journal generation |
| GET | /history | `{ "items": [...] }`, newest first; limit default 20, range 1–100 |
| POST | /history | Validate and store an answer; 201 with id and created_at |
| DELETE | /history | Delete rows; 204 with no body |

`/health` returns `status`, `groq_configured`, `groq_api_keys`, `groq_active_key`, `ollama_model`, `groq_text_model`, `groq_vision_model`, and `code_default_language`. A configured key has not necessarily been authenticated.

Text requests require `text` and `url`; vision requests require `image` (base64 data URL) and `url`. Both accept `practice_type` (default `auto`) and optional `language`. Use `auto`, `mcq`, `math`, or `code` as the caller intent; the schema does not enum-validate practice_type. Image strings are limited to 27,000,000 characters.

```json
{"text":"Which is even? A) 3 B) 4","url":"http://127.0.0.1:8000/practice","practice_type":"mcq"}
```

Solve responses contain `results` as a **JSON-encoded string**, `provider` (may include model/review information), and `language`. Parse `results` separately; result fields vary by MCQ/code pipeline. No numeric confidence or processing_time is promised.

Coding requests can supply `starter_code` and `review_before_submit: true`. The supplied
class/function interface is checked before returning a solution. C++ parameter names
may differ (for example, `arr` and `nums`), while class/function names, return and
parameter types, references, member qualifiers, and access must match. A failed
interface check includes both required and generated declarations; the correction
request repeats the original starter code. Generated bodies are never rewritten
just to rename parameters. Independent review still runs before a reviewed result
can reach the editor.

History POST requires `scan_type` (`text` or `vision`), `url`, `provider`, and usable `results` as a JSON string; `language` is optional. URL/provider are trimmed and limited to 2048 characters; results to 50,000. GET items contain id, created_at, scan_type, url, provider, results, and language. The database keeps the latest 100 records. Solve routes do not automatically store history: the extension submits a separate request after a successful scan.

FastAPI validation uses 422 with a detail array. Provider failures may return 502 with structured detail; request-processing failures can return 500. See the live schema and implementation for route-specific responses. Key rotation accepts separate `GROQ_API_KEY`, `_2`, and `_3` variables, not `GROQ_API_KEYS`.

Vision retains `image` plus zero to four `images`, `text`, `url`, `practice_type`
and optional `language`. Four/five unique images use ordered evidence batches and
final synthesis; no answer is returned on a partial batch failure. Bad raster data
or excessive combined payload returns 422; missing vision configuration returns
503; the overall deadline returns 504. Errors retain `detail` with credentials
redacted. Health adds `vision_max_images: 5`, `vision_images_per_request: 3` and
`vision_batching: true`. History storage failures return a non-sensitive 503.
