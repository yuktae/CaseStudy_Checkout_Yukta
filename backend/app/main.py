"""FastAPI app: JSON API for the analyst UI, plus the built frontend served from the same origin."""

import json
import logging
import mimetypes
import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal, Optional

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ValidationError

from . import db, decide, documents, pipeline, rules
from .text import tidy
from .config import DEMO_ACCESS_CODE, MAX_FILE_MB, MAX_FILES, MODEL, STATIC_DIR, SEED_ON_START, UPLOAD_DIR, has_api_key
from .models import CaseIn

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

ALLOWED_EXT = {".pdf", ".png", ".jpg", ".jpeg", ".webp"}
MAX_DOCS_PER_CASE = 20  # new cases start with up to MAX_FILES; analysts can add more evidence later


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db.init()
    if SEED_ON_START:
        pipeline.seed()
    yield


app = FastAPI(title="Exhibit", lifespan=lifespan)


def _check_code(code: str | None) -> None:
    if DEMO_ACCESS_CODE and code != DEMO_ACCESS_CODE:
        raise HTTPException(403, "A valid access code is required for this action.")


# ------------------------------------------------------------------ views


def _effective(case: dict, workup: dict | None, review: dict | None) -> dict:
    """What the analyst currently sees: AI output with their overrides applied."""
    if not workup:
        return {"action": None, "confidence": None, "needs_judgement": False, "flags": []}
    review = review or {}
    action = review.get("final_action") or review.get("action") or workup["decision"]["action"]
    flags = sorted({a["type"] for a in workup["alerts"]
                    if a["type"] in ("conflict", "vision", "deep_page", "unverified", "judgement", "missing_file")})
    return {"action": action, "confidence": workup["decision"]["confidence"]["level"],
            "needs_judgement": workup["decision"]["needs_judgement"], "flags": flags}


def _summary(case: dict, all_cases: list[dict]) -> dict:
    workup = db.get_workup(case["case_id"])
    review = db.get_review(case["case_id"])
    t = case["transaction"]
    return {
        "case_id": case["case_id"], "status": case["status"], "unread": case["unread"],
        "scheme": case["scheme"], "reason_code": case["reason_code"],
        "reason_label": (rules.get_rule(case["scheme"], case["reason_code"]) or {}).get("title",
                                                                                       case.get("reason_code_label")),
        "category": rules.category(case["scheme"], case["reason_code"]),
        "merchant": t["merchant_name"], "amount": case["chargeback_amount"],
        "chargeback_date": case["chargeback_date"], "created_at": case["created_at"],
        "updated_at": case["updated_at"],
        "doc_count": len(db.list_documents(case["case_id"])),
        "linked": len(rules.linked_cases(case, all_cases)),
        **_effective(case, workup, review),
    }


def _explain(workup: dict | None) -> dict | None:
    """Add what the analyst needs to read a workup: the reason code's definition and how confidence was reached."""
    if not workup:
        return workup
    rule = rules.get_rule(workup["rule"]["scheme"], workup["rule"]["code"]) or {}
    workup["rule"]["definition"] = rule.get("allegation")
    return decide.explain_confidence(workup)


def _detail(case_id: str, version: int | None = None) -> dict:
    case = db.get_case(case_id)
    if not case:
        raise HTTPException(404, "Case not found")
    all_cases = db.list_cases()
    workup = _explain(tidy(db.get_workup(case_id, version)))
    latest = db.list_versions(case_id)
    previous = None
    if workup and workup["version"] > 1:
        prev = db.get_workup(case_id, workup["version"] - 1)
        previous = {"version": prev["version"], "action": prev["decision"]["action"],
                    "verdicts": {r["id"]: r["verdict"] for r in prev["requirements"]}}
    rows = db.list_documents(case_id)
    analysed = {d["doc_key"] for d in (workup or {}).get("documents", [])}
    pending_docs = [{"doc_key": r["doc_key"], "filename": r["filename"], "is_new": True,
                     "kind": "image" if documents.mime_for(r["filename"]).startswith("image/") else "pdf"}
                    for r in rows if r["doc_key"] not in analysed or r["is_new"]]
    removed = sorted(analysed - {r["doc_key"] for r in rows})
    active_jobs = [j for j in db.list_jobs(active_only=True) if j["case_id"] == case_id]
    return {
        "case": case,
        "summary": _summary(case, all_cases),
        "signals": rules.signals(case, all_cases),
        "linked": rules.linked_cases(case, all_cases),
        "workup": workup,
        "previous": previous,
        "versions": latest,
        "review": db.get_review(case_id),
        "pending_documents": pending_docs,
        "removed_documents": removed,
        "activity": db.list_activity(case_id),
        "job": active_jobs[0] if active_jobs else None,
    }


# -------------------------------------------------------------------- API


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/meta")
def meta():
    return {"model": MODEL, "has_api_key": has_api_key(), "max_files": MAX_FILES, "max_file_mb": MAX_FILE_MB,
            "access_code_required": bool(DEMO_ACCESS_CODE)}


@app.get("/api/reason-codes")
def reason_codes():
    return rules.reason_code_catalog()


@app.get("/api/cases")
def list_cases():
    all_cases = db.list_cases()
    return [_summary(c, all_cases) for c in all_cases]


@app.get("/api/cases/{case_id}")
def get_case(case_id: str, version: Optional[int] = None):
    detail = _detail(case_id, version)
    db.mark_read(case_id)
    return detail


class VerdictOverride(BaseModel):
    verdict: Literal["satisfied", "partial", "missing", "not_applicable"]
    note: str = ""


class TextEdit(BaseModel):
    value: str
    base: str = ""  # the AI text the analyst edited, to detect later AI changes


class ListEdit(BaseModel):
    value: list[str]
    base: list[str] = []


class Review(BaseModel):
    version: int
    verdict_overrides: dict[str, VerdictOverride] = {}
    relevance_overrides: dict[str, Literal["used", "not_relevant"]] = {}
    action: Optional[Literal["represent", "accept_liability", "request_more_evidence"]] = None
    action_reason: str = ""
    rationale: Optional[TextEdit] = None
    justification: Optional[TextEdit] = None
    merchant_requests: Optional[ListEdit] = None


@app.put("/api/cases/{case_id}/review")
def save_review(case_id: str, review: Review):
    case = db.get_case(case_id)
    if not case:
        raise HTTPException(404, "Case not found")
    db.save_review(case_id, review.model_dump())
    if case["status"] in ("ready", "completed", "awaiting_merchant"):
        db.set_status(case_id, "in_review")
    db.log(case_id, "Review saved")
    return _detail(case_id)


class Completion(Review):
    final_action: Literal["represent", "accept_liability", "request_more_evidence"]


ACTION_TEXT = {"represent": "Representment filed", "accept_liability": "Liability accepted",
               "request_more_evidence": "Evidence requested from merchant"}


@app.post("/api/cases/{case_id}/complete")
def complete(case_id: str, body: Completion):
    if not db.get_case(case_id):
        raise HTTPException(404, "Case not found")
    db.save_review(case_id, body.model_dump(), completed=True)
    status = "awaiting_merchant" if body.final_action == "request_more_evidence" else "completed"
    db.set_status(case_id, status)
    db.log(case_id, ACTION_TEXT[body.final_action])
    return _detail(case_id)


@app.post("/api/cases/{case_id}/reopen")
def reopen(case_id: str):
    if not db.get_case(case_id):
        raise HTTPException(404, "Case not found")
    db.clear_completion(case_id)
    db.set_status(case_id, "in_review")
    db.log(case_id, "Case reopened")
    return _detail(case_id)


def _safe_name(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", Path(name).name)[:120] or "file"


async def _store_files(case_id: str, files: list[UploadFile], start: int) -> list[str]:
    stored = []
    for i, f in enumerate(files, start=start):
        name = _safe_name(f.filename or f"file{i}")
        if Path(name).suffix.lower() not in ALLOWED_EXT:
            raise HTTPException(400, f"{name}: only PDF, PNG, JPG and WEBP files are accepted.")
        data = await f.read()
        if len(data) > MAX_FILE_MB * 1024 * 1024:
            raise HTTPException(400, f"{name} is larger than {MAX_FILE_MB} MB.")
        target = UPLOAD_DIR / case_id / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        db.add_document(case_id, f"D{i}", name, f"upload:{case_id}/{name}", documents.mime_for(name),
                        documents.sha256_of(target), is_new=start > 1)
        stored.append(name)
    return stored


@app.post("/api/cases")
async def create_case(case: str = Form(...), files: list[UploadFile] = File(default=[]),
                      x_access_code: str | None = Header(default=None)):
    _check_code(x_access_code)
    try:
        payload = CaseIn.model_validate(json.loads(case))
    except (ValidationError, json.JSONDecodeError) as e:
        raise HTTPException(422, f"Invalid case: {e}")
    if db.get_case(payload.case_id):
        raise HTTPException(409, f"Case {payload.case_id} already exists.")
    if len(files) > MAX_FILES:
        raise HTTPException(400, f"At most {MAX_FILES} evidence files per case.")
    data = payload.model_dump()
    data["merchant_evidence_documents"] = [_safe_name(f.filename or "") for f in files]
    db.upsert_case(data, "processing")
    await _store_files(payload.case_id, files, start=1)
    db.log(payload.case_id, "Case received")
    job_id = pipeline.enqueue(payload.case_id, "analyse")
    return {"case_id": payload.case_id, "job_id": job_id}


@app.post("/api/cases/{case_id}/documents")
async def add_documents(case_id: str, files: list[UploadFile] = File(...),
                        x_access_code: str | None = Header(default=None)):
    _check_code(x_access_code)
    if not db.get_case(case_id):
        raise HTTPException(404, "Case not found")
    existing = db.list_documents(case_id, include_deleted=True)
    if len(db.list_documents(case_id)) + len(files) > MAX_DOCS_PER_CASE:
        raise HTTPException(400, f"At most {MAX_DOCS_PER_CASE} evidence files per case.")
    names = await _store_files(case_id, files, start=len(existing) + 1)
    db.log(case_id, f"Evidence added: {', '.join(names)}")
    return _detail(case_id)


@app.delete("/api/cases/{case_id}/documents/{doc_key}")
def remove_document(case_id: str, doc_key: str):
    doc = db.get_document(case_id, doc_key)
    if not doc:
        raise HTTPException(404, "Document not found")
    db.delete_document(case_id, doc_key)
    db.log(case_id, f"Evidence removed: {doc['filename']}")
    return _detail(case_id)


@app.post("/api/cases/{case_id}/reanalyse")
def reanalyse(case_id: str, x_access_code: str | None = Header(default=None)):
    _check_code(x_access_code)
    if not db.get_case(case_id):
        raise HTTPException(404, "Case not found")
    if not has_api_key():
        raise HTTPException(400, "ANTHROPIC_API_KEY is not set on the server, so the case cannot be re-analysed.")
    job_id = pipeline.enqueue(case_id, "reanalyse")
    db.log(case_id, "Re-analysis started")
    return {"job_id": job_id}


@app.get("/api/jobs")
def jobs(active: bool = False):
    out = []
    for j in db.list_jobs(active_only=active):
        case = db.get_case(j["case_id"])
        out.append({**j, "merchant": case["transaction"]["merchant_name"] if case else ""})
    return out


@app.get("/api/cases/{case_id}/documents/{doc_key}/file")
def document_file(case_id: str, doc_key: str):
    doc = db.get_document(case_id, doc_key)
    path = pipeline.resolve_path(doc["path"]) if doc else None
    if not path or not path.exists():
        raise HTTPException(404, "File not found")
    return FileResponse(path, media_type=doc["mime"], filename=doc["filename"],
                        content_disposition_type="inline")


# --------------------------------------------------------- frontend (SPA)

# Windows can map .mjs to text/plain in the registry, which stops the browser loading the PDF worker.
mimetypes.add_type("text/javascript", ".mjs")

if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        target = (STATIC_DIR / path).resolve()
        if path and target.is_file() and target.is_relative_to(STATIC_DIR.resolve()):
            return FileResponse(target)
        return FileResponse(STATIC_DIR / "index.html")
