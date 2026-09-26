"""SQLite persistence. JSON columns keep the schema small; one connection per call keeps it thread-safe."""

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

from .config import DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS cases (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    status TEXT NOT NULL,
    unread INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id TEXT NOT NULL,
    doc_key TEXT NOT NULL,
    filename TEXT NOT NULL,
    path TEXT,
    mime TEXT,
    sha256 TEXT,
    is_new INTEGER NOT NULL DEFAULT 0,
    deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    stage TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT
);
CREATE TABLE IF NOT EXISTS workups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reviews (
    case_id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    saved_at TEXT,
    completed_at TEXT
);
CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@contextmanager
def connect():
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init() -> None:
    with connect() as c:
        c.executescript(SCHEMA)


# ------------------------------------------------------------------ cases


def upsert_case(case: dict, status: str) -> None:
    ts = now()
    with connect() as c:
        c.execute(
            """INSERT INTO cases (id, data, status, unread, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)
               ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at""",
            (case["case_id"], json.dumps(case), status, ts, ts),
        )


def get_case(case_id: str) -> dict | None:
    with connect() as c:
        row = c.execute("SELECT * FROM cases WHERE id = ?", (case_id,)).fetchone()
    if not row:
        return None
    return {**json.loads(row["data"]), "status": row["status"], "unread": bool(row["unread"]),
            "created_at": row["created_at"], "updated_at": row["updated_at"]}


def list_cases() -> list[dict]:
    with connect() as c:
        rows = c.execute("SELECT * FROM cases ORDER BY created_at, id").fetchall()
    return [{**json.loads(r["data"]), "status": r["status"], "unread": bool(r["unread"]),
             "created_at": r["created_at"], "updated_at": r["updated_at"]} for r in rows]


def set_status(case_id: str, status: str) -> None:
    with connect() as c:
        c.execute("UPDATE cases SET status = ?, updated_at = ? WHERE id = ?", (status, now(), case_id))


def mark_read(case_id: str) -> None:
    with connect() as c:
        c.execute("UPDATE cases SET unread = 0 WHERE id = ?", (case_id,))


def count_cases() -> int:
    with connect() as c:
        return c.execute("SELECT COUNT(*) FROM cases").fetchone()[0]


# -------------------------------------------------------------- documents


def add_document(case_id: str, doc_key: str, filename: str, path: str | None, mime: str | None,
                 sha256: str | None, is_new: bool = False) -> None:
    with connect() as c:
        c.execute(
            "INSERT INTO documents (case_id, doc_key, filename, path, mime, sha256, is_new, created_at) VALUES (?,?,?,?,?,?,?,?)",
            (case_id, doc_key, filename, path, mime, sha256, int(is_new), now()),
        )


def list_documents(case_id: str, include_deleted: bool = False) -> list[dict]:
    q = "SELECT * FROM documents WHERE case_id = ?" + ("" if include_deleted else " AND deleted = 0") + " ORDER BY id"
    with connect() as c:
        return [dict(r) for r in c.execute(q, (case_id,)).fetchall()]


def get_document(case_id: str, doc_key: str) -> dict | None:
    with connect() as c:
        row = c.execute("SELECT * FROM documents WHERE case_id = ? AND doc_key = ?", (case_id, doc_key)).fetchone()
    return dict(row) if row else None


def delete_document(case_id: str, doc_key: str) -> None:
    with connect() as c:
        c.execute("UPDATE documents SET deleted = 1 WHERE case_id = ? AND doc_key = ?", (case_id, doc_key))


def clear_new_flags(case_id: str) -> None:
    with connect() as c:
        c.execute("UPDATE documents SET is_new = 0 WHERE case_id = ?", (case_id,))


# ------------------------------------------------------------------ jobs


def create_job(case_id: str, kind: str) -> int:
    with connect() as c:
        cur = c.execute(
            "INSERT INTO jobs (case_id, kind, stage, status, started_at) VALUES (?, ?, 'queued', 'running', ?)",
            (case_id, kind, now()),
        )
        return cur.lastrowid


def update_job(job_id: int, stage: str | None = None, status: str | None = None, error: str | None = None) -> None:
    sets, args = [], []
    if stage:
        sets.append("stage = ?"); args.append(stage)
    if status:
        sets.append("status = ?"); args.append(status)
        if status in ("done", "failed"):
            sets.append("finished_at = ?"); args.append(now())
    if error is not None:
        sets.append("error = ?"); args.append(error)
    with connect() as c:
        c.execute(f"UPDATE jobs SET {', '.join(sets)} WHERE id = ?", (*args, job_id))


def list_jobs(active_only: bool = False, limit: int = 20) -> list[dict]:
    q = "SELECT * FROM jobs" + (" WHERE status = 'running'" if active_only else "") + " ORDER BY id DESC LIMIT ?"
    with connect() as c:
        return [dict(r) for r in c.execute(q, (limit,)).fetchall()]


# --------------------------------------------------------------- workups


def add_workup(case_id: str, data: dict) -> int:
    with connect() as c:
        version = (c.execute("SELECT MAX(version) FROM workups WHERE case_id = ?", (case_id,)).fetchone()[0] or 0) + 1
        data = {**data, "version": version}
        c.execute("INSERT INTO workups (case_id, version, data, created_at) VALUES (?, ?, ?, ?)",
                  (case_id, version, json.dumps(data), now()))
    return version


def get_workup(case_id: str, version: int | None = None) -> dict | None:
    with connect() as c:
        if version is None:
            row = c.execute("SELECT * FROM workups WHERE case_id = ? ORDER BY version DESC LIMIT 1", (case_id,)).fetchone()
        else:
            row = c.execute("SELECT * FROM workups WHERE case_id = ? AND version = ?", (case_id, version)).fetchone()
    return {**json.loads(row["data"]), "created_at": row["created_at"]} if row else None


def list_versions(case_id: str) -> list[dict]:
    with connect() as c:
        rows = c.execute("SELECT version, created_at FROM workups WHERE case_id = ? ORDER BY version", (case_id,)).fetchall()
    return [dict(r) for r in rows]


# --------------------------------------------------------------- reviews


def get_review(case_id: str) -> dict | None:
    with connect() as c:
        row = c.execute("SELECT * FROM reviews WHERE case_id = ?", (case_id,)).fetchone()
    if not row:
        return None
    return {**json.loads(row["data"]), "saved_at": row["saved_at"], "completed_at": row["completed_at"]}


def save_review(case_id: str, data: dict, completed: bool = False) -> None:
    ts = now()
    with connect() as c:
        c.execute(
            """INSERT INTO reviews (case_id, data, saved_at, completed_at) VALUES (?, ?, ?, ?)
               ON CONFLICT(case_id) DO UPDATE SET data = excluded.data, saved_at = excluded.saved_at,
               completed_at = COALESCE(excluded.completed_at, reviews.completed_at)""",
            (case_id, json.dumps(data), ts, ts if completed else None),
        )


def clear_completion(case_id: str) -> None:
    with connect() as c:
        c.execute("UPDATE reviews SET completed_at = NULL WHERE case_id = ?", (case_id,))


# -------------------------------------------------------------- activity


def log(case_id: str, text: str) -> None:
    with connect() as c:
        c.execute("INSERT INTO activity (case_id, text, created_at) VALUES (?, ?, ?)", (case_id, text, now()))


def list_activity(case_id: str) -> list[dict]:
    with connect() as c:
        rows = c.execute("SELECT text, created_at FROM activity WHERE case_id = ? ORDER BY id DESC", (case_id,)).fetchall()
    return [dict(r) for r in rows]
