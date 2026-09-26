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


def build_workup(case: dict, rule: dict, docs: list[dict], assessment: Assessment,
                 located: dict[str, list[dict]]) -> dict:
    by_id: dict = {}
    for r in assessment.requirements:  # first entry wins if the model repeats a requirement
        by_id.setdefault(r.requirement_id, r)
    cb_date = _parse_date(case["chargeback_date"])
    service_dates = [d for d in assessment.key_dates if d.label in ("delivery", "service")]

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
            dates = [d for d in (_parse_date(k.date) for k in service_dates) if d]
            if dates and cb_date:
                latest = max(dates)
                ok = latest <= cb_date
                req["date_check"] = {"ok": ok, "detail": f"{latest:%d %b %Y} vs chargeback {cb_date:%d %b %Y}"}
                if not ok and req["verdict"] == "satisfied":
                    req["verdict"] = "missing"
                    req["downgraded"] = "Delivery or service date is after the chargeback date."
            elif req["verdict"] == "satisfied":
                req["date_check"] = {"ok": None, "detail": "No delivery or service date could be extracted."}
        req["vision_only"] = bool(doc_cites) and all(c["source"] == "vision" for c in doc_cites if c["verified"])
        requirements.append(req)

    applicable = [r for r in requirements if r["verdict"] != "not_applicable"]
    code_action = _code_action(rule["logic"], requirements)
    ai_action = assessment.recommended_action
    needs_judgement = code_action != ai_action

    # ------------------------------------------------------------ confidence
    # Confidence is about the recommended action. Reasons lower it; notes are shown but do not.
    reasons, notes = [], []
    partials = [r for r in applicable if r["verdict"] == "partial"]
    if partials and code_action == "accept_liability":
        reasons.append(f"{len(partials)} requirement{'s' if len(partials) > 1 else ''} partly met: "
                       "the case may be closer than it looks")
    if any(r["vision_only"] and r["verdict"] in ("satisfied", "partial") for r in requirements):
        reasons.append("Key evidence read from an image")
    unverified = [c for r in requirements for c in r["citations"] if not c["verified"]]
    if unverified:
        reasons.append(f"{len(unverified)} quote{'s' if len(unverified) > 1 else ''} could not be verified")
    conflicts = [f for f in assessment.flags if f.kind == "conflict"]
    if conflicts:
        reasons.append("Evidence conflicts with the claim or the transaction data")
    if needs_judgement:
        reasons.append("Rule check and AI recommendation disagree")
    inconsistencies = [f for f in assessment.flags if f.kind == "inconsistency"]
    if inconsistencies:
        notes.append(f"{len(inconsistencies)} data inconsistenc{'ies' if len(inconsistencies) > 1 else 'y'} to check")
    score = max(0, 3 - len(reasons))
    confidence = {"level": LEVELS.get(score, "Low"), "score": score,
                  "reasons": reasons or ["Every requirement the decision relies on is backed by verified evidence"],
                  "notes": notes}

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
        "key_dates": [k.model_dump() for k in assessment.key_dates],
        "decision": {"action": code_action, "code_action": code_action, "ai_action": ai_action,
                     "needs_judgement": needs_judgement, "confidence": confidence},
        "justification": assessment.justification,
        "rationale": assessment.rationale,
        "merchant_requests": requests,
    })
