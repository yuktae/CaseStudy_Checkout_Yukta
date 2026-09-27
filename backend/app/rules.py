"""Scheme rules (from rules.yaml), transaction signal chips and linked-case detection. Pure code, no LLM."""

from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

import yaml

RULES_PATH = Path(__file__).with_name("rules.yaml")

LOGIC_LABELS = {
    "ALL": "All required",
    "ANY_TWO": "Any two required",
    "ANY_ONE": "Any one required",
    "EITHER": "Either branch",
    "AUTO_ACCEPT": "Not representable",
}


# Days an acquirer has to respond, counted from the chargeback date. Illustrative only: the simplified rules in the
# exercise leave out time limits, and real windows depend on the scheme, the reason code and the dispute stage.
RESPONSE_DAYS = {"visa": 30, "mastercard": 45}


def respond_by(case: dict) -> str | None:
    try:
        raised = date.fromisoformat(case["chargeback_date"][:10])
    except (KeyError, ValueError):
        return None
    return (raised + timedelta(days=RESPONSE_DAYS.get(case["scheme"].lower(), 30))).isoformat()


@lru_cache
def all_rules() -> dict:
    with open(RULES_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


def rule_key(scheme: str, code: str) -> str:
    return f"{scheme.lower()}:{code}"


def get_rule(scheme: str, code: str) -> dict | None:
    rule = all_rules().get(rule_key(scheme, code))
    if rule is None:
        return None
    return {**rule, "key": rule_key(scheme, code), "scheme": scheme.lower(), "code": code,
            "logic_label": LOGIC_LABELS[rule["logic"]]}


def reason_code_catalog() -> list[dict]:
    out = []
    for key, rule in all_rules().items():
        scheme, code = key.split(":")
        out.append({"scheme": scheme, "code": code, "title": rule["title"], "category": rule["category"],
                    "logic": rule["logic"]})
    return out


def category(scheme: str, code: str) -> str:
    rule = get_rule(scheme, code)
    return rule["category"] if rule else "Unknown"


# ------------------------------------------------------------ signal chips


def signals(case: dict, all_cases: list[dict] | None = None) -> list[dict]:
    t = case["transaction"]
    out = []

    # Dataset coding: Y full match, A address matches but postcode does not, N no match, null not checked.
    avs = (t.get("avs_result") or "").upper()
    out.append({"key": "avs", "label": "AVS", **{
        "Y": {"value": "Match", "status": "pass"},
        "N": {"value": "No match", "status": "fail"},
        "A": {"value": "Partial, postcode mismatch", "status": "warn"},
    }.get(avs, {"value": "Not checked", "status": "neutral"})})

    cvv = (t.get("cvv_result") or "").upper()
    out.append({"key": "cvv", "label": "CVV", **{
        "M": {"value": "Match", "status": "pass"},
        "N": {"value": "No match", "status": "fail"},
    }.get(cvv, {"value": "Not checked", "status": "neutral"})})

    tds = (t.get("three_ds_status") or "not_attempted").lower()
    out.append({"key": "three_ds", "label": "3DS", **{
        "authenticated": {"value": "Authenticated", "status": "pass"},
        "frictionless": {"value": "Frictionless", "status": "pass"},
        "attempted": {"value": "Attempted only", "status": "warn"},
        "not_attempted": {"value": "Not attempted", "status": "fail"},
    }.get(tds, {"value": tds, "status": "neutral"})})

    billing, shipping = t.get("billing_address_postcode"), t.get("shipping_address_postcode")
    if not shipping:
        addr = {"value": "No shipping", "status": "neutral"}
    elif billing and billing.replace(" ", "").upper() == shipping.replace(" ", "").upper():
        addr = {"value": "Billing = shipping", "status": "pass"}
    else:
        addr = {"value": "Billing ≠ shipping", "status": "warn", "detail": f"{billing} vs {shipping}"}
    out.append({"key": "address", "label": "Address", **addr})

    out.append({"key": "bin", "label": "BIN", "value": t.get("card_bin_country") or "Unknown", "status": "neutral"})

    fp = t.get("device_fingerprint")
    if not fp:
        dev = {"value": "Unknown", "status": "neutral"}
    elif "new" in fp or "unseen" in fp:
        dev = {"value": "New device", "status": "warn"}
    else:
        seen = sum(1 for c in (all_cases or []) if c["case_id"] != case["case_id"]
                   and c["transaction"].get("device_fingerprint") == fp)
        dev = {"value": f"Seen in {seen} other case{'s' if seen != 1 else ''}" if seen else "Known device",
               "status": "neutral", "detail": fp}
    out.append({"key": "device", "label": "Device", **dev})

    out.append({"key": "ip", "label": "IP", "value": t.get("ip_address") or "Unknown", "status": "neutral"})
    return out


def linked_cases(case: dict, all_cases: list[dict]) -> list[dict]:
    """Other cases sharing a device fingerprint, IP address or billing postcode."""
    t = case["transaction"]
    keys = {
        "device": t.get("device_fingerprint"),
        "IP address": t.get("ip_address"),
        "billing postcode": t.get("billing_address_postcode"),
    }
    out = []
    for other in all_cases:
        if other["case_id"] == case["case_id"]:
            continue
        ot = other["transaction"]
        shared = []
        if keys["device"] and "unseen" not in keys["device"] and ot.get("device_fingerprint") == keys["device"]:
            shared.append("device")
        if keys["IP address"] and ot.get("ip_address") == keys["IP address"]:
            shared.append("IP address")
        if keys["billing postcode"] and ot.get("billing_address_postcode") == keys["billing postcode"]:
            shared.append("billing postcode")
        if shared:
            out.append({"case_id": other["case_id"], "merchant": ot["merchant_name"], "shared": shared})
    return out
