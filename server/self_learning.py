"""Opt-in, feedback-driven local memory for Browser Assistant.

This module never modifies prompts, model weights, existing scan history, or
automation behavior. It only records explicit, user-approved feedback and
retrieves previously verified lessons. Disabled by default.
"""
import hashlib
import os
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

router = APIRouter(prefix="/learning", tags=["optional self-learning"])

MAX_LESSONS = 500
PRIVATE_PATTERNS = (
    re.compile(r"\b(?:gsk_|sk-)[A-Za-z0-9_-]+\b", re.I),
    re.compile(r"\bBearer\s+[^\s]+", re.I),
    re.compile(r"(?i)(?:password|api[_ -]?key|access[_ -]?token|secret)\s*[:=]\s*\S+"),
)


def enabled() -> bool:
    return os.getenv("SELF_LEARNING_ENABLED", "false").strip().lower() in {
        "1", "true", "on", "yes"
    }


def database_path() -> Path:
    return Path(os.getenv("LEARNING_DB_PATH") or
                Path(__file__).with_name("self_learning.db"))


def require_enabled() -> None:
    if not enabled():
        raise HTTPException(403, "Self-learning is disabled. Set SELF_LEARNING_ENABLED=true to opt in.")


@contextmanager
def connection():
    db = None
    try:
        db = sqlite3.connect(database_path(), timeout=5)
        db.row_factory = sqlite3.Row
        with db:
            db.execute("""CREATE TABLE IF NOT EXISTS learned_lessons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                task_type TEXT NOT NULL,
                site TEXT NOT NULL,
                problem_hash TEXT NOT NULL,
                lesson TEXT NOT NULL,
                verified INTEGER NOT NULL CHECK(verified = 1)
            )""")
            db.execute("""CREATE INDEX IF NOT EXISTS idx_learned_lessons_lookup
                          ON learned_lessons(task_type, site, problem_hash)""")
            yield db
    except sqlite3.Error as exc:
        raise HTTPException(503, "Learning storage is unavailable.") from exc
    finally:
        if db is not None:
            db.close()


def normalize(value: str) -> str:
    return " ".join(value.lower().split())


def fingerprint(problem: str) -> str:
    return hashlib.sha256(normalize(problem).encode("utf-8")).hexdigest()


def site_for(url: str) -> str:
    parts = urlsplit(url)
    if parts.scheme not in {"http", "https"} or not parts.hostname or parts.username or parts.password:
        raise ValueError("Provide a valid HTTP(S) URL without embedded credentials.")
    return parts.hostname.lower()


def redact_private(text: str) -> str:
    value = text
    for pattern in PRIVATE_PATTERNS:
        value = pattern.sub("[redacted]", value)
    return value


class Lesson(BaseModel):
    task_type: str = Field(min_length=1, max_length=40, pattern=r"^[a-zA-Z0-9_ -]+$")
    url: str = Field(min_length=1, max_length=2048)
    problem: str = Field(min_length=5, max_length=8000)
    lesson: str = Field(min_length=5, max_length=2000)
    verified: bool = False
    consent: bool = False

    @field_validator("url")
    @classmethod
    def valid_url(cls, value):
        site_for(value)
        return value


@router.get("/status")
def learning_status():
    return {"enabled": enabled(), "mode": "explicit-feedback-memory",
            "model_training": False, "automatic_behavior_changes": False}


@router.post("/lessons", status_code=201)
def record_lesson(payload: Lesson):
    require_enabled()
    if not payload.consent or not payload.verified:
        raise HTTPException(422, "Explicit consent and verified feedback are required.")
    lesson = redact_private(payload.lesson.strip())
    if not lesson or lesson == "[redacted]":
        raise HTTPException(422, "No safe learning content to store.")
    now = datetime.now(timezone.utc).isoformat()
    with connection() as db:
        cursor = db.execute(
            """INSERT INTO learned_lessons
            (created_at, task_type, site, problem_hash, lesson, verified)
            VALUES (?, ?, ?, ?, ?, 1)""",
            (now, payload.task_type.strip().lower(), site_for(payload.url),
             fingerprint(payload.problem), lesson),
        )
        db.execute(
            """DELETE FROM learned_lessons WHERE id NOT IN (
                SELECT id FROM learned_lessons ORDER BY id DESC LIMIT ?
            )""", (MAX_LESSONS,)
        )
    return {"id": cursor.lastrowid, "created_at": now, "stored": True}


@router.get("/lessons")
def retrieve_lessons(task_type: str = Query(min_length=1, max_length=40),
                     url: str = Query(max_length=2048),
                     problem: str = Query(min_length=5, max_length=8000),
                     limit: int = Query(default=5, ge=1, le=20)):
    require_enabled()
    try:
        site = site_for(url)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    with connection() as db:
        rows = db.execute(
            """SELECT id, created_at, task_type, site, lesson
               FROM learned_lessons WHERE task_type=? AND site=? AND problem_hash=?
               ORDER BY id DESC LIMIT ?""",
            (task_type.strip().lower(), site, fingerprint(problem), limit),
        ).fetchall()
    return {"items": [dict(row) for row in rows]}


@router.delete("/lessons", status_code=204)
def erase_lessons():
    require_enabled()
    with connection() as db:
        db.execute("DELETE FROM learned_lessons")
