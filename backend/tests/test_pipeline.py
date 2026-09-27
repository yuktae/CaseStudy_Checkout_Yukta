"""Pipeline tests that run without an API key: the two LLM calls are replaced with fixed outputs,
so these exercise extraction, locate & verify, the decision rules and the API end to end."""

import os
import tempfile

os.environ["STORAGE_DIR"] = tempfile.mkdtemp(prefix="exhibit-test-")
os.environ["SEED_DIR"] = os.path.join(os.environ["STORAGE_DIR"], "no-seed")
os.environ["ANTHROPIC_API_KEY"] = "test-key"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import assess, db, decide, main, pipeline, rules, vision  # noqa: E402
from app.models import (Assessment, Citation, DocumentAssessment, Flag, KeyDate,  # noqa: E402
                        RequirementAssessment, VisionReading)


def req(rid, verdict, cites=(), fixable=True, gap=""):
    return RequirementAssessment(requirement_id=rid, verdict=verdict, finding=f"{rid} finding",
                                 citations=[Citation(page_id=p, quote=q) for p, q in cites], gap=gap, fixable=fixable)


def fake_assessment(case, rule, docs):
    cid = case["case_id"]
    common = dict(allegation="a", to_defend="d", justification="j", rationale="r", merchant_requests=[])
    if cid == "CB-2025-0007":
        return Assessment(**common, requirements=[
            req("R1", "satisfied", [("D1-p8", "Consignment TF-9051 (Stentor Bros, ref txn_7745MN): Collected from LS1 4DT")]),
            req("R2", "satisfied", [("D1-p2", "DELIVERED 22 Apr 17:14")]),  # wrong page on purpose
            req("R3", "satisfied", [("D1-p8", "delivered to LS9 8AA at 17:14 the same day")]),
            req("R1", "missing", gap="stray duplicate entry"),  # the model sometimes repeats a requirement
        ], documents=[DocumentAssessment(document_id="D1", content_label="Weekly manifest", relevance="used", reason="")],
            flags=[], key_dates=[KeyDate(label="delivery", date="2025-04-22", page_id="D1-p8")],
            recommended_action="represent")
    if cid == "CB-2025-0008":
        return Assessment(**common, requirements=[
            req("R1", "satisfied", [("D1-p1", "Subscriptions auto-renew")]),
            req("R2", "partial", [("D1-p1", "Renewal reminder sent to member on 13 April 2025")]),  # invented
            req("R3", "missing"), req("R4", "missing"),
        ], documents=[DocumentAssessment(document_id="D1", content_label="Terms", relevance="used", reason="")],
            flags=[], key_dates=[], recommended_action="request_more_evidence")
    if cid == "CB-2025-0002":
        return Assessment(**common, requirements=[
            req("R1", "partial", [("D1-p1", "Left in safe place: 'front porch'")]),
            req("R2", "not_applicable"),
            req("R3", "satisfied", [("D1-p1", "Delivered: 10 April 2025, 15:22")]),
            req("R4", "partial", [("D2-p1", "Note: this address was entered by the customer at checkout.")]),
        ], documents=[], flags=[Flag(kind="conflict", text="Cardholder says the address is not theirs.")],
            key_dates=[KeyDate(label="delivery", date="2025-04-10", page_id="D1-p1")],
            recommended_action="accept_liability")
    if cid == "CB-2025-0001":
        return Assessment(**common, requirements=[
            req("R1", "satisfied", [("D1-p1", "DELIVERED — signed by WHITFORD")]),
            req("R2", "not_applicable"),
            req("R3", "satisfied", [("D1-p1", "24 Mar 2025 11:47")]),
            req("R4", "satisfied", [("D2-p1", "Shipping address: 22 Cavendish Court, London SW4 7QR")]),
        ], documents=[], flags=[], key_dates=[KeyDate(label="delivery", date="2025-05-24", page_id="D1-p1")],  # after CB
            recommended_action="represent")
    if cid == "CB-2025-0004":
        return Assessment(**common, requirements=[
            req("R1", "missing", fixable=False), req("R2", "missing", fixable=False),
            req("R3", "missing", fixable=False), req("R4", "not_applicable"),
        ], documents=[], flags=[Flag(kind="conflict", text="The report says legitimate; AVS and CVV failed.")],
            key_dates=[], recommended_action="accept_liability")
    raise AssertionError(f"no fixture for {cid}")


@pytest.fixture(scope="module")
def client():
    assess.assess = fake_assessment
    vision.read_image = lambda b, m: VisionReading(transcription="", description="test", legibility="clear")
    db.init()
    pipeline.seed = lambda: None
    with TestClient(main.app) as c:
        # Import the dataset directly (seeding would queue background jobs).
        import json
        from app.config import DATASET_DIR
        from app import documents
        for case in json.loads((DATASET_DIR / "cases.json").read_text(encoding="utf-8")):
            db.upsert_case(case, "ready")
            for i, n in enumerate(case["merchant_evidence_documents"], 1):
                db.add_document(case["case_id"], f"D{i}", n, f"dataset:{n}", documents.mime_for(n), None)
        yield c


def test_deep_page_evidence_and_wrong_page_correction(client):
    w = pipeline.run("CB-2025-0007")
    r1, r2, r3 = w["requirements"]
    assert r1["verdict"] == "satisfied", "a repeated requirement must not overwrite the first entry"
    assert r1["citations"][0]["page_no"] == 8 and r1["citations"][0]["verified"]
    assert r2["citations"][0]["relocated"] and r2["citations"][0]["page_no"] == 8
    assert r2["date_check"]["ok"] is True
    assert w["decision"]["action"] == "represent" and w["decision"]["confidence"]["level"] == "High"
    assert any(a["type"] == "deep_page" for a in w["alerts"])


def test_invented_quote_is_unverified_and_downgraded(client):
    w = pipeline.run("CB-2025-0008")
    r2 = w["requirements"][1]
    assert r2["citations"][0]["verified"] is False
    assert r2["verdict"] == "missing" and r2["downgraded"]
    assert w["decision"]["action"] == "request_more_evidence"
    assert any(a["type"] == "unverified" for a in w["alerts"])


def test_disagreement_flags_needs_judgement(client):
    w = pipeline.run("CB-2025-0002")
    d = w["decision"]
    assert d["code_action"] == "request_more_evidence" and d["ai_action"] == "accept_liability"
    assert d["needs_judgement"] and d["confidence"]["level"] == "Low"
    assert w["requirements"][0]["vision_only"]


def test_date_after_chargeback_is_caught(client):
    w = pipeline.run("CB-2025-0001")
    r3 = w["requirements"][2]
    assert r3["date_check"]["ok"] is False and r3["verdict"] == "missing"


def test_api_review_and_complete(client):
    pipeline.run("CB-2025-0007")
    cases = client.get("/api/cases").json()
    assert len(cases) == 10
    d = client.get("/api/cases/CB-2025-0007").json()
    assert d["workup"]["requirements"][0]["citations"][0]["rects"]
    assert any(s["key"] == "three_ds" for s in d["signals"])
    v = d["workup"]["version"]
    r = client.put("/api/cases/CB-2025-0007/review", json={"version": v, "rationale": {"value": "Edited", "base": "r"}})
    assert r.json()["summary"]["status"] == "in_review"
    r = client.post("/api/cases/CB-2025-0007/complete", json={"version": v, "final_action": "represent"})
    assert r.json()["summary"]["status"] == "completed"
    assert client.get("/api/cases/CB-2025-0007/documents/D1/file").status_code == 200


def test_conflict_does_not_lower_confidence_in_accept(client):
    w = pipeline.run("CB-2025-0004")
    c = w["decision"]["confidence"]
    assert w["decision"]["action"] == "accept_liability" and c["level"] == "High"
    assert c["notes"] and any(a["type"] == "conflict" for a in w["alerts"])


@pytest.mark.parametrize("avs,cvv,expected", [
    ("Y", "M", ("Match", "Match")),
    ("A", "N", ("Partial, postcode mismatch", "No match")),
    (None, None, ("Not checked", "Not checked")),
])
def test_avs_cvv_codes(avs, cvv, expected):
    case = {"case_id": "X", "transaction": {"avs_result": avs, "cvv_result": cvv}}
    s = {x["key"]: x["value"] for x in rules.signals(case)}
    assert (s["avs"], s["cvv"]) == expected
