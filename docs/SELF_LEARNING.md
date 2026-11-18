# Optional Self-Learning Memory (experimental)

This is a standalone, opt-in *feedback memory*, not automatic model retraining.
It cannot silently change code, prompts, model configurations, scan results or browser
automation. Existing routes, history databases, shortcuts and UI remain unchanged.

## Enable

In your **local** server environment, set:

```env
SELF_LEARNING_ENABLED=true
# Optional: by default uses server/self_learning.db
LEARNING_DB_PATH=
```

Restart the backend. With the default setting (`false`), writes and
retrieval are blocked, and no learning database is created.

## Endpoints

- `GET /learning/status` — see opt-in state and supported mode.
- `POST /learning/lessons` — store a *verified* lesson with *explicit user consent*.
- `GET /learning/lessons?task_type=coding&url=https://example.org&problem=...`
  — retrieve exact normalized problem matches on the same hostname and task type.
- `DELETE /learning/lessons` — delete learned lessons, without deleting existing scan or automation history.

Example payload for `POST /learning/lessons`:

```json
{
  "task_type": "coding",
  "url": "https://example.org/task",
  "problem": "How do I reverse a Python list?",
  "lesson": "Use list.reverse() when an in-place change is intended.",
  "verified": true,
  "consent": true
}
```

The system hashes the supplied problem instead of storing its raw text and
stores only the hostname (not the full URL). Secrets in the lesson field are
redacted on a best-effort basis; do not submit confidential information.
Avoid running this local API on a public network. Its existing host/origin
guards are not user authentication.

**No integration into /solve or /solve-vision is enabled yet.** Deliberately
retrieve and review lessons first. Later, opt-in prompt suggestions can be added
behind tests and user approval without affecting baseline solve behavior.

Run `python -m unittest server/test_self_learning.py` with the server directory
on `PYTHONPATH`, or `cd server && python -m unittest test_self_learning.py`.
