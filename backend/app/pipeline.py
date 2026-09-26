"""Pipeline orchestration: intake → extract → read images → rules → assess → locate & verify → decide → persist."""

import json
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import assess, db, decide, documents, locate, rules
from .config import DATASET_DIR, MODEL, SEED_DIR, UPLOAD_DIR, has_api_key
from .llm import LLMError

log = logging.getLogger(__name__)
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="pipeline")
_lock = threading.Lock()


class PipelineError(RuntimeError):
    pass


def resolve_path(stored: str | None) -> Path | None:
    """Documents are stored as 'dataset:<file>' or 'upload:<case>/<file>' so the database is portable."""
    if not stored:
        return None
    kind, _, rel = stored.partition(":")
    return (DATASET_DIR / "documents" / rel) if kind == "dataset" else (UPLOAD_DIR / rel)


def _stage(job_id: int | None, stage: str) -> None:
    if job_id:
        db.update_job(job_id, stage=stage)


def run(case_id: str, job_id: int | None = None) -> dict:
    """Run the full pipeline for one case synchronously and store a new workup version."""
    case = db.get_case(case_id)
    if not case:
        raise PipelineError(f"Unknown case {case_id}")
    rule = rules.get_rule(case["scheme"], case["reason_code"])
    if not rule:
        raise PipelineError(f"No rules on file for {case['scheme'].title()} {case['reason_code']}: manual review needed.")
    if not has_api_key():
        raise PipelineError("ANTHROPIC_API_KEY is not set, so the case cannot be analysed.")

    rows = db.list_documents(case_id)
    rows.sort(key=lambda r: documents.mime_for(r["filename"]).startswith("image/"))  # PDFs first, images after
    docs = []
    _stage(job_id, "extracting")
    for row in rows:
        if documents.mime_for(row["filename"]).startswith("image/"):
            _stage(job_id, "reading_images")
        path = resolve_path(row["path"])
        extracted = documents.extract(path, row["doc_key"]) if path else {"kind": "missing", "pages": [],
                                                                           "error": "File not found"}
        docs.append({"doc_key": row["doc_key"], "filename": row["filename"], "is_new": bool(row["is_new"]),
                     **extracted})
    docs.sort(key=lambda d: int(d["doc_key"][1:]))

    _stage(job_id, "checking_rules")
    _stage(job_id, "assessing")
    assessment = assess.assess(case, rule, docs)

    _stage(job_id, "locating")
    txn_text = assess._transaction_page(case)
    located: dict[str, list[dict]] = {}
    for r in assessment.requirements:  # first entry wins if the model repeats a requirement
        if r.requirement_id not in located:
            located[r.requirement_id] = [locate.locate(c.model_dump(), docs, txn_text) for c in r.citations]

    workup = decide.build_workup(case, rule, docs, assessment, located)
    workup["model"] = MODEL
    version = db.add_workup(case_id, workup)
    db.clear_new_flags(case_id)
    db.log(case_id, f"Analysis v{version} completed")
    return {**workup, "version": version}


def _run_job(case_id: str, job_id: int, kind: str) -> None:
    try:
        run(case_id, job_id)
        db.update_job(job_id, stage="done", status="done")
        db.set_status(case_id, "ready")
    except (PipelineError, LLMError) as e:
        log.warning("job %s failed: %s", job_id, e)
        db.update_job(job_id, stage="failed", status="failed", error=str(e))
        db.set_status(case_id, "failed" if kind == "analyse" else db.get_case(case_id)["status"])
        db.log(case_id, f"Analysis failed: {e}")
    except Exception as e:  # unexpected: keep the job visible with a readable error
        log.exception("job %s crashed", job_id)
        db.update_job(job_id, stage="failed", status="failed", error=f"Unexpected error: {e}")
        if kind == "analyse":
            db.set_status(case_id, "failed")


def enqueue(case_id: str, kind: str = "analyse") -> int:
    """Start a background job. kind: 'analyse' (new case) or 'reanalyse' (new evidence)."""
    job_id = db.create_job(case_id, kind)
    if kind == "analyse":
        db.set_status(case_id, "processing")
    _executor.submit(_run_job, case_id, job_id, kind)
    return job_id


# ------------------------------------------------------------------ seeding


def seed(queue_missing: bool = True, import_workups: bool = True) -> None:
    """First start: import the provided cases and their pre-computed workups (no API key needed).

    Cases without a pre-computed workup are queued for analysis when an API key is available."""
    with _lock:
        if db.count_cases():
            return
        cases_file = DATASET_DIR / "cases.json"
        if not cases_file.exists():
            log.warning("No dataset at %s", cases_file)
            return
        cases = json.loads(cases_file.read_text(encoding="utf-8"))
        pending = []
        for case in cases:
            db.upsert_case(case, "ready")
            for i, name in enumerate(case.get("merchant_evidence_documents", []), start=1):
                path = DATASET_DIR / "documents" / name
                db.add_document(case["case_id"], f"D{i}", name, f"dataset:{name}", documents.mime_for(name),
                                documents.sha256_of(path) if path.exists() else None)
            seed_file = SEED_DIR / "workups" / f"{case['case_id']}.json"
            if import_workups and seed_file.exists():
                db.add_workup(case["case_id"], json.loads(seed_file.read_text(encoding="utf-8")))
                db.log(case["case_id"], "Imported with pre-computed analysis v1")
            else:
                pending.append(case["case_id"])
            db.log(case["case_id"], "Case received")
        for case_id in pending:
            if not queue_missing:
                continue
            if has_api_key():
                enqueue(case_id)
            else:
                db.set_status(case_id, "failed")
                db.log(case_id, "Not analysed: no pre-computed workup and no API key")
        log.info("Seeded %d cases (%d queued for analysis)", len(cases), len(pending))


def export_seed(case_id: str) -> Path:
    """Write the latest workup to seed/ so it ships with the repo."""
    workup = db.get_workup(case_id)
    if not workup:
        raise PipelineError(f"No workup for {case_id}")
    out = SEED_DIR / "workups" / f"{case_id}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    workup = {k: v for k, v in workup.items() if k not in ("version", "created_at")}
    out.write_text(json.dumps(workup, indent=1, ensure_ascii=False), encoding="utf-8")
    return out
