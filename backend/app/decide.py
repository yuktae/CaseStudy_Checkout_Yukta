"""Decision step (pure code): turn the verified assessment into the final workup.

- Downgrades requirements whose cited evidence could not be verified.
- Checks delivery/service dates against the chargeback date.
- Computes the recommended action from the rule logic, compares it with the model's own recommendation,
  and scores confidence with explicit reasons.
- Builds the alerts shown to the analyst.
"""

from datetime import date

from .models import Assessment
from .text import tidy

DOWNGRADE = {"satisfied": "partial", "partial": "missing"}
LEVELS = {3: "High", 2: "Medium"}


def _parse_date(s: str) -> date | None:
    try:
        return date.fromisoformat(s[:10])
    except (TypeError, ValueError):
        return None


def _code_action(logic: str, reqs: list[dict]) -> str:
    applicable = [r for r in reqs if r["verdict"] != "not_applicable"]
    satisfied = [r for r in applicable if r["verdict"] == "satisfied"]
    gaps = [r for r in applicable if r["verdict"] in ("partial", "missing")]
    fixable = [r for r in gaps if r["fixable"]]

    if logic == "AUTO_ACCEPT":
        return "represent" if reqs and reqs[0]["verdict"] == "satisfied" else "accept_liability"
    if logic == "ALL":
        if applicable and not gaps:
            return "represent"
        return "request_more_evidence" if gaps and len(fixable) == len(gaps) else "accept_liability"
    need = 2 if logic == "ANY_TWO" else 1  # ANY_ONE and EITHER
    if len(satisfied) >= need:
        return "represent"
    if len(satisfied) + len(fixable) >= need:
        return "request_more_evidence"
    return "accept_liability"


def score_confidence(requirements: list[dict], logic: str, action: str, n_conflicts: int, n_inconsistencies: int,
                     needs_judgement: bool) -> dict:
    """Confidence in the recommended action.

    It starts at 3 points (High) and each check below that fails costs one point: 3 is High, 2 is Medium, 0 or 1
    is Low. Notes are shown to the analyst but never cost a point. Every check is returned, passed or not, so the
    UI can show exactly how the label was reached.
    """
    applicable = [r for r in requirements if r["verdict"] != "not_applicable"]
    partials = [r for r in applicable if r["verdict"] == "partial"]
    unverified = sum(1 for r in requirements for c in r["citations"] if not c["verified"])
    relied_on = [r for r in requirements if r["verdict"] in ("satisfied", "partial")]
    image_only = any(r["vision_only"] for r in relied_on)
    hard_to_read = any(r.get("hard_to_read") for r in relied_on)
    accepting = action == "accept_liability"

    def plural(n: int, word: str) -> str:
        return f"{n} {word}{'s' if n > 1 else ''}"

    checks = []  # (check, passed, reason shown when it fails)
    if accepting and logic != "AUTO_ACCEPT":
        checks.append(("No requirement is partly met, so accepting isn't borderline", not partials,
                       f"{plural(len(partials), 'requirement')} partly met: the case may be closer than it looks"))
    checks += [
        ("Key evidence comes from document text, not only from an image", not image_only,
         "Key evidence read from an image"),
        ("Images the evidence relies on are fully legible", not hard_to_read,
         "An image the evidence relies on is partly illegible"),
        ("Every quoted passage was found in the documents", not unverified,
         f"{plural(unverified, 'quote')} could not be verified"),
        # A merchant claim that the data contradicts can only support accepting, so it only counts otherwise.
        ("No conflict in the evidence", not n_conflicts or accepting,
         "Evidence conflicts with the claim or the transaction data"),
        ("The rule check and the AI recommendation agree", not needs_judgement,
         "Rule check and AI recommendation disagree"),
    ]
    reasons = [reason for _, ok, reason in checks if not ok]
    notes = []
    if n_conflicts and accepting:
        notes.append("Conflicting evidence flagged; it does not make accepting riskier")
    if n_inconsistencies:
        notes.append(f"{n_inconsistencies} data inconsistenc{'ies' if n_inconsistencies > 1 else 'y'} to check")
    score = max(0, 3 - len(reasons))
    return {"level": LEVELS.get(score, "Low"), "score": score,
            "reasons": reasons or ["Every requirement the decision relies on is backed by verified evidence"],
            "notes": notes,
            "checks": [{"label": label, "passed": ok} for label, ok, _ in checks]}


def explain_confidence(workup: dict) -> dict:
    """Recompute confidence (with its checks) from a stored workup, so older analyses show the breakdown too."""
    kinds = [a["type"] for a in workup["alerts"]]
    d = workup["decision"]
    d["confidence"] = score_confidence(workup["requirements"], workup["rule"]["logic"], d["code_action"],
                                       kinds.count("conflict"), kinds.count("inconsistency"), d["needs_judgement"])
    return workup


def build_workup(case: dict, rule: dict, docs: list[dict], assessment: Assessment,
                 located: dict[str, list[dict]], key_dates: list[dict] | None = None) -> dict:
    """key_dates: the model's dates, each with "verified" set once its quote was found on the cited page."""
    by_id: dict = {}
    for r in assessment.requirements:  # first entry wins if the model repeats a requirement
        by_id.setdefault(r.requirement_id, r)
    cb_date = _parse_date(case["chargeback_date"])
    if key_dates is None:
        key_dates = [{**k.model_dump(), "verified": False} for k in assessment.key_dates]
    # Only dates whose quote was found in the documents count, so a stray date cannot flip a verdict.
    service_dates = [(day, k["page_id"]) for k in key_dates
                     if k["label"] in ("delivery", "service") and k["verified"] and (day := _parse_date(k["date"]))]
    legibility = {(d["doc_key"], p["page_no"]): (p.get("vision") or {}).get("legibility")
                  for d in docs for p in d["pages"] if p["method"] == "vision"}

    requirements = []
    for spec in rule["requirements"]:
        a = by_id.get(spec["id"])
        req = {"id": spec["id"], "title": spec["title"], "text": spec["text"],
               "verdict": a.verdict if a else "missing", "ai_verdict": a.verdict if a else "missing",
               "finding": a.finding if a else "The assessment did not cover this requirement.",
               "gap": a.gap if a else "Not assessed.", "fixable": a.fixable if a else True,
               "citations": located.get(spec["id"], []), "downgraded": None, "date_check": None}

        doc_cites = [c for c in req["citations"] if c["source"] != "txn"]
        if req["verdict"] in DOWNGRADE:
            if req["citations"] and not any(c["verified"] for c in req["citations"]):
                req["verdict"] = DOWNGRADE[req["verdict"]]
                req["downgraded"] = "The quoted evidence could not be found in the documents."
            elif not req["citations"]:
                req["verdict"] = DOWNGRADE[req["verdict"]]
                req["downgraded"] = "No evidence was cited for this verdict."

        if spec.get("date_check") and req["verdict"] != "not_applicable":
            if service_dates and cb_date:
                latest, page = max(service_dates)
                ok = latest <= cb_date
                req["date_check"] = {"ok": ok, "detail": f"{latest:%d %b %Y} ({page}) vs chargeback {cb_date:%d %b %Y}"}
                if not ok and req["verdict"] == "satisfied":
                    req["verdict"] = "missing"
                    req["downgraded"] = "Delivery or service date is after the chargeback date."
            elif req["verdict"] == "satisfied":
                req["date_check"] = {"ok": None, "detail": "No delivery or service date could be verified in the documents."}
        req["vision_only"] = bool(doc_cites) and all(c["source"] == "vision" for c in doc_cites if c["verified"])
        req["hard_to_read"] = any(legibility.get((c["doc_key"], c["page_no"])) in ("partial", "poor")
                                  for c in doc_cites if c["verified"])
        requirements.append(req)

    applicable = [r for r in requirements if r["verdict"] != "not_applicable"]
    code_action = _code_action(rule["logic"], requirements)
    ai_action = assessment.recommended_action
    needs_judgement = code_action != ai_action

    conflicts = [f for f in assessment.flags if f.kind == "conflict"]
    inconsistencies = [f for f in assessment.flags if f.kind == "inconsistency"]
    unverified = [c for r in requirements for c in r["citations"] if not c["verified"]]
    confidence = score_confidence(requirements, rule["logic"], code_action, len(conflicts), len(inconsistencies),
                                  needs_judgement)

    # ------------------------------------------------------------- documents
    doc_views = []
    assessed_docs = {d.document_id: d for d in assessment.documents}
    for d in docs:
        a = assessed_docs.get(d["doc_key"])
        doc_views.append({
            "doc_key": d["doc_key"], "filename": d["filename"], "kind": d["kind"], "error": d.get("error"),
            "is_new": d.get("is_new", False),
            "label": a.content_label if a else d["filename"],
            "relevance": "unreadable" if d.get("error") else (a.relevance if a else "used"),
            "reason": d.get("error") or (a.reason if a else ""),
            "pages": [{"page_no": p["page_no"], "width": p["width"], "height": p["height"], "method": p["method"]}
                      for p in d["pages"]],
            "method": "vision" if any(p["method"] == "vision" for p in d["pages"]) else "text",
        })

    # ---------------------------------------------------------------- alerts
    alerts = []
    if rule["logic"] == "AUTO_ACCEPT":
        alerts.append({"type": "auto_rule", "severity": "info",
                       "text": f"{rule['scheme'].title()} {rule['code']} generally cannot be represented. "
                               "The evidence is shown but does not change the outcome unless it proves miscoding."})
    for f in conflicts:
        alerts.append({"type": "conflict", "severity": "warn", "text": f.text})
    for f in inconsistencies:
        alerts.append({"type": "inconsistency", "severity": "info", "text": f.text})
    if needs_judgement:
        alerts.append({"type": "judgement", "severity": "warn",
                       "text": "The rule check and the AI recommendation disagree. Review both before deciding."})
    pages_by_doc = {d["doc_key"]: len(d["pages"]) for d in docs}
    labels = {d["doc_key"]: d["label"] for d in doc_views}
    deep: dict[tuple, list[str]] = {}  # (doc, page) -> requirement ids, so one alert per location
    for r in requirements:
        for c in r["citations"]:
            if c["verified"] and c["page_no"] and pages_by_doc.get(c["doc_key"], 0) >= 5 and c["page_no"] >= 3:
                ids = deep.setdefault((c["doc_key"], c["page_no"]), [])
                if r["id"] not in ids:
                    ids.append(r["id"])
    for (doc_key, page_no), ids in deep.items():
        alerts.append({"type": "deep_page", "severity": "info",
                       "text": f"Evidence for {', '.join(ids)} is on page {page_no} of {pages_by_doc[doc_key]} in "
                               f"{labels.get(doc_key, doc_key)}.",
                       "target": {"requirement": ids[0]}})
    vision_ids = [r["id"] for r in requirements if r["vision_only"] and r["verdict"] in ("satisfied", "partial")]
    if vision_ids:
        alerts.append({"type": "vision", "severity": "info",
                       "text": f"Evidence for {', '.join(vision_ids)} was read from an image. Check the highlight.",
                       "target": {"requirement": vision_ids[0]}})
    if unverified:
        alerts.append({"type": "unverified", "severity": "warn",
                       "text": f"{len(unverified)} quoted passage{'s' if len(unverified) > 1 else ''} could not be "
                               "found in the documents and were not counted as evidence."})
    for d in doc_views:
        if d["error"]:
            alerts.append({"type": "missing_file", "severity": "warn", "text": f"{d['filename']}: {d['error']}",
                           "target": {"doc": d["doc_key"]}})
    if not docs:
        alerts.append({"type": "no_documents", "severity": "warn", "text": "The merchant uploaded no evidence documents."})

    requests = list(assessment.merchant_requests)
    if code_action == "request_more_evidence" and not requests:
        # Never leave the analyst with an empty ask-list: fall back to the fixable gaps.
        requests = [f"{r['title']}: {r['gap']}" for r in applicable
                    if r["verdict"] in ("partial", "missing") and r["fixable"] and r["gap"]]

    return tidy({
        "case_id": case["case_id"],
        "rule": {k: rule[k] for k in ("key", "scheme", "code", "title", "category", "logic", "logic_label")}
                | {"note": rule.get("note")},
        "summary": {"allegation": assessment.allegation, "to_defend": assessment.to_defend},
        "requirements": requirements,
        "score": {"satisfied": sum(r["verdict"] == "satisfied" for r in applicable), "applicable": len(applicable)},
        "documents": doc_views,
        "alerts": alerts,
        "key_dates": key_dates,
        "decision": {"action": code_action, "code_action": code_action, "ai_action": ai_action,
                     "needs_judgement": needs_judgement, "confidence": confidence},
        "justification": assessment.justification,
        "rationale": assessment.rationale,
        "merchant_requests": requests,
    })
