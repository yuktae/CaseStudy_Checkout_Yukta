"""House style for model-written prose: no long dashes, and the rationale as one point per line.

Applied when a workup is built and again when it is served, so older stored workups follow the same style.
Verbatim quotes are never touched: they must match the documents exactly.
"""

import re

_SENTENCE_END = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9£€$\"'(])")


def plain(text: str) -> str:
    """Replace em and en dashes used as punctuation with commas; keep hyphens in ranges."""
    if not text:
        return text
    text = re.sub(r"\s*[—―]\s*", ", ", text)  # em dash
    text = re.sub(r"\s+–\s+", ", ", text)  # spaced en dash
    text = text.replace("–", "-")  # en dash inside ranges, e.g. 1–7
    text = re.sub(r",\s*,", ",", text)
    return re.sub(r"\s+,", ",", text).strip()


def points(text: str) -> str:
    """Rationale as one sentence per line (the UI shows it as a numbered list)."""
    if not text:
        return text
    lines = [ln.strip(" -•\t") for ln in text.splitlines() if ln.strip()]
    if len(lines) == 1:
        lines = [s.strip() for s in _SENTENCE_END.split(lines[0]) if s.strip()]
    return "\n".join(re.sub(r"^\d+[.)]\s*", "", plain(ln)) for ln in lines)


def tidy(workup: dict) -> dict:
    """Apply the house style to every prose field of a workup (in place) and return it."""
    if not workup:
        return workup
    s = workup.get("summary", {})
    for k in ("allegation", "to_defend"):
        if k in s:
            s[k] = plain(s[k])
    for r in workup.get("requirements", []):
        r["finding"] = plain(r.get("finding", ""))
        r["gap"] = plain(r.get("gap", ""))
    for d in workup.get("documents", []):
        d["reason"] = plain(d.get("reason", "") or "")
    for a in workup.get("alerts", []):
        a["text"] = plain(a["text"])
    workup["justification"] = plain(workup.get("justification", ""))
    workup["rationale"] = points(workup.get("rationale", ""))
    workup["merchant_requests"] = [plain(x) for x in workup.get("merchant_requests", [])]
    return workup
