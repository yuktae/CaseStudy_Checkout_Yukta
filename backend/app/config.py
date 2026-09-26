"""Runtime configuration, read from environment variables (and .env when present)."""

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")


def _bool(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


MODEL = os.getenv("MODEL", "claude-opus-5")
ASSESS_EFFORT = os.getenv("ASSESS_EFFORT", "high")
VISION_EFFORT = os.getenv("VISION_EFFORT", "medium")

# Provided materials (cases.json + documents/). Swappable when the official pack arrives.
DATASET_DIR = Path(os.getenv("DATASET_DIR", ROOT / "data"))
# Runtime state: SQLite database, uploaded files, extraction/assessment caches.
STORAGE_DIR = Path(os.getenv("STORAGE_DIR", ROOT / "storage"))
# Pre-computed workups committed to the repo so the demo runs without an API key.
SEED_DIR = Path(os.getenv("SEED_DIR", ROOT / "seed"))
STATIC_DIR = Path(os.getenv("STATIC_DIR", ROOT / "frontend" / "dist"))

SEED_ON_START = _bool("SEED_ON_START", True)
MAX_FILES = int(os.getenv("MAX_FILES", "4"))
MAX_FILE_MB = int(os.getenv("MAX_FILE_MB", "20"))
DEMO_ACCESS_CODE = os.getenv("DEMO_ACCESS_CODE", "")

DB_PATH = STORAGE_DIR / "exhibit.db"
UPLOAD_DIR = STORAGE_DIR / "uploads"
CACHE_DIR = STORAGE_DIR / "cache"

for d in (STORAGE_DIR, UPLOAD_DIR, CACHE_DIR / "extract", CACHE_DIR / "assess"):
    d.mkdir(parents=True, exist_ok=True)


def has_api_key() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN"))
