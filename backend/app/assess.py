"""Assessment agent: one structured Claude call per case, over the rules, the case data and every document page."""

import hashlib
import json

from . import llm
from .config import ASSESS_EFFORT, CACHE_DIR, MODEL
from .models import Assessment

SYSTEM = """You are a senior chargeback analyst preparing a representment workup for a colleague who makes the final call. \
Your job is to lay out the rule, the evidence and the gap so they can decide in about 90 seconds and trust what they see.

How to assess:
- Assess every requirement listed for the reason code exactly once, in order, using its exact requirement_id. Judge each one only against the \
compelling-evidence wording given; do not import outside scheme rules.
- Verdicts: "satisfied" when the evidence clearly meets the requirement; "partial" when it meets part of it or leaves a \
material doubt; "missing" when nothing provided meets it; "not_applicable" when the requirement cannot apply to this \
transaction (for example a services-only requirement on a physical goods order).
- A policy or promise is not proof that something happened. Terms saying "we email customers before renewal" do not \
show that an email was sent to this cardholder.
- Match evidence to this transaction by transaction ID, order ID, names, dates and amounts. Documents can contain rows for \
other customers on the same route or with similar values; only cite the row or passage that belongs to this transaction.
- Merchants often upload documents that look relevant but do not meet any requirement. Mark those documents \
"not_relevant" and say why, rather than stretching them to fit a requirement.
- Judge documents by their content, never by their filename; filenames can be wrong. Give each document a short \
content_label (at most 6 words, e.g. "Royal Mail proof of delivery") describing what it actually is.
- Apply the simplified requirement wording as written. Merchant-generated operational records (booking systems, \
access logs, manifests, front desk logs) are valid evidence when they identify this transaction, because the rules \
list them as acceptable. If such a record is thin, say so in the finding, but only lower the verdict when the \
requirement's wording is not met.
- Transaction metadata (AVS, CVV, 3DS, IP, device) is evidence too. Cite it with page_id "TXN".
- Flags are for things the analyst must not miss, so keep them few (usually zero to two). Record a "conflict" when \
specific facts contradict each other or a fact the cardholder raises is not answered by the evidence (for example the \
cardholder says the delivery address is not theirs). The basic disagreement between the cardholder's claim and the \
merchant's evidence is the dispute itself, not a conflict. Record an "inconsistency" for data that does not line up, \
such as time zones, dates, amounts or IDs that differ between sources. Comments on document quality belong in the \
finding or gap, not in flags.
- A gap is fixable when the merchant could plausibly supply the missing evidence (logs, records, photos). It is not \
fixable when the facts cannot change, such as a failed AVS check or a missing 3DS authentication.

Citations:
- Every satisfied or partial verdict needs at least one citation. Quote verbatim from the page text exactly as given \
(copy characters, do not paraphrase or fix typos), keep each quote short (about 30 words at most) and cite the page_id \
where it appears. The quotes are matched against the source to highlight them for the analyst, so a paraphrase is useless.
- Cite the most specific passage: the line that proves the point, not a heading.
- Pages read from images contain the transcribed text followed by an [Image description]. Quote the transcribed text; \
use the description as context for your finding, not as a quote.

Dates:
- Do not compare dates yourself. Report delivery or service dates you find in key_dates as YYYY-MM-DD with the page_id; \
the date checks are done in code.

Writing:
- allegation: what the issuer is alleging, in plain English. to_defend: what the scheme requires to defend it.
- rationale: 3 to 5 short points the analyst can file after light editing, one sentence per point, each on its own \
line, without numbering or bullet characters. Cover the claim, the decisive evidence with specifics (dates, IDs, \
amounts), and the conclusion. No hedging filler.
- Write plainly: use commas or full stops, never em or en dashes.
- justification: one line explaining the recommended action.
- recommended_action: "represent" when the requirements are met under the code's logic; "request_more_evidence" when \
there is a gap the merchant could fix; "accept_liability" when the case cannot be defended.
- merchant_requests: required (two to five items) whenever recommended_action is request_more_evidence, otherwise \
empty. Each item must be specific and actionable (what record, for which order or date range), never generic like \
"more evidence"."""


def _logic_explainer(rule: dict) -> str:
    return {
        "ALL": "All applicable requirements must be satisfied.",
        "ANY_TWO": "Any two of the requirements must be satisfied.",
        "ANY_ONE": "Any one of the requirements is enough.",
        "EITHER": "Either one of the alternative requirements is enough.",
        "AUTO_ACCEPT": "This code generally cannot be represented; " + rule.get("note", ""),
    }[rule["logic"]]


def _transaction_page(case: dict) -> str:
    lines = []
    for k, v in case["transaction"].items():
        if isinstance(v, dict):
            v = f"{v['value']} {v['currency']}"
        lines.append(f"{k}: {v}")
    return "\n".join(lines)


def build_content(case: dict, rule: dict, docs: list[dict]) -> list[dict]:
    rule_block = {
        "scheme": rule["scheme"], "reason_code": rule["code"], "title": rule["title"],
        "logic": _logic_explainer(rule),
        "requirements": [{"requirement_id": r["id"], "requirement": r["text"]} for r in rule["requirements"]],
    }
    case_block = {k: case[k] for k in ("case_id", "scheme", "reason_code", "chargeback_date", "chargeback_amount",
                                       "issuer_narrative")}
    parts = [
        f"<reason_code_rules>\n{json.dumps(rule_block, indent=1)}\n</reason_code_rules>",
        f"<case>\n{json.dumps(case_block, indent=1)}\n</case>",
        f'<page id="TXN" source="transaction metadata">\n{_transaction_page(case)}\n</page>',
    ]
    if not docs:
        parts.append("<documents>The merchant uploaded no evidence documents.</documents>")
    for d in docs:
        header = f'<document id="{d["doc_key"]}" filename="{d["filename"]}" pages="{len(d["pages"])}"'
        if d.get("error"):
            parts.append(f'{header} status="unreadable">{d["error"]}</document>')
            continue
        pages = []
        for p in d["pages"]:
            src = ' source="image, transcribed by vision model"' if p["method"] == "vision" else ""
            pages.append(f'<page id="{p["page_id"]}"{src}>\n{p["text"].strip()}\n</page>')
        parts.append(f"{header}>\n" + "\n".join(pages) + "\n</document>")
    parts.append("Produce the representment workup for this case.")
    return [{"type": "text", "text": "\n\n".join(parts)}]


def assess(case: dict, rule: dict, docs: list[dict]) -> Assessment:
    content = build_content(case, rule, docs)
    key = hashlib.sha256(json.dumps([MODEL, ASSESS_EFFORT, SYSTEM, content]).encode()).hexdigest()[:24]
    cache_file = CACHE_DIR / "assess" / f"{key}.json"
    if cache_file.exists():
        return Assessment.model_validate_json(cache_file.read_text(encoding="utf-8"))
    system = [{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}]
    result = llm.parse(system=system, content=content, output_format=Assessment, effort=ASSESS_EFFORT)
    cache_file.write_text(result.model_dump_json(indent=1), encoding="utf-8")
    return result
