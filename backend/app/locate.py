"""Locate & verify: find each quote the model cited in the extracted text and turn it into highlight rectangles.

Matching works on a normalised character stream (lower-case, no whitespace, unified dashes/quotes), so it
survives line breaks, OCR that drops spaces, and typographic differences. Exact match first, then fuzzy.
A quote that cannot be found is marked unverified; the decision step downgrades evidence that rests on it.
"""

import re

from rapidfuzz import fuzz

FUZZY_THRESHOLD = 90
_DASHES = dict.fromkeys(map(ord, "‐‑‒–—―−"), "-")
_QUOTES = {ord("‘"): "'", ord("’"): "'", ord("ʼ"): "'", ord("“"): '"', ord("”"): '"'}


def _norm(text: str) -> str:
    return re.sub(r"\s+", "", text.translate(_DASHES).translate(_QUOTES).lower())


def _stream(tokens: list[list]) -> tuple[str, list[int]]:
    chars, owners = [], []
    for i, tok in enumerate(tokens):
        for ch in _norm(tok[0]):
            chars.append(ch)
            owners.append(i)
    return "".join(chars), owners


def _find(quote_n: str, stream: str) -> tuple[str, int, int] | None:
    if len(quote_n) < 3 or not stream:
        return None
    idx = stream.find(quote_n)
    if idx >= 0:
        return "exact", idx, idx + len(quote_n)
    if len(quote_n) >= 8:
        al = fuzz.partial_ratio_alignment(quote_n, stream)
        if al and al.score >= FUZZY_THRESHOLD:
            return "fuzzy", al.dest_start, al.dest_end
    return None


def _rects(tokens: list[list], token_ids: list[int], width: float, height: float) -> list[list[float]]:
    """Merge the matched word boxes into one rectangle per visual line, normalised to 0..1 of the page."""
    lines: list[list[float]] = []
    for i in sorted(set(token_ids), key=lambda i: (tokens[i][2], tokens[i][1])):
        _, x0, y0, x1, y1 = tokens[i]
        for ln in lines:
            if abs(ln[1] - y0) < (y1 - y0) * 0.6:
                ln[0], ln[1], ln[2], ln[3] = min(ln[0], x0), min(ln[1], y0), max(ln[2], x1), max(ln[3], y1)
                break
        else:
            lines.append([x0, y0, x1, y1])
    pad = 1.5
    return [[round(max(0, (x0 - pad) / width), 5), round(max(0, (y0 - pad) / height), 5),
             round(min(1, (x1 + pad) / width), 5), round(min(1, (y1 + pad) / height), 5)] for x0, y0, x1, y1 in lines]


def _match_page(quote: str, page: dict) -> dict | None:
    parts = [p for p in re.split(r"\.\.\.|…", quote) if len(_norm(p)) >= 3] or [quote]
    stream, owners = _stream(page["tokens"])
    token_ids, kinds = [], []
    for part in parts:
        hit = _find(_norm(part), stream)
        if not hit:
            return None
        kind, start, end = hit
        kinds.append(kind)
        token_ids.extend(owners[start:end])
    return {"match": "exact" if all(k == "exact" for k in kinds) else "fuzzy",
            "rects": _rects(page["tokens"], token_ids, page["width"], page["height"])}


def locate(citation: dict, docs: list[dict], txn_text: str) -> dict:
    """Resolve one citation {page_id, quote} against the extracted documents."""
    page_id, quote = citation["page_id"], citation["quote"]
    base = {"page_id": page_id, "quote": quote, "doc_key": None, "page_no": None, "verified": False,
            "match": "none", "rects": [], "source": "text", "relocated": False}

    if page_id.upper() == "TXN":
        ok = _norm(quote) in _norm(txn_text) or any(
            _norm(part) in _norm(txn_text) for part in re.split(r"[;,]", quote) if len(_norm(part)) >= 3)
        return {**base, "page_id": "TXN", "source": "txn", "verified": ok, "match": "exact" if ok else "none"}

    pages = [(d, p) for d in docs for p in d["pages"]]
    cited = [(d, p) for d, p in pages if p["page_id"] == page_id]
    same_doc = [(d, p) for d, p in pages if cited and d["doc_key"] == cited[0][0]["doc_key"] and p["page_id"] != page_id]
    others = [(d, p) for d, p in pages if (d, p) not in cited and (d, p) not in same_doc]

    for d, p in cited + same_doc + others:
        hit = _match_page(quote, p)
        if hit:
            return {**base, **hit, "page_id": p["page_id"], "doc_key": d["doc_key"], "page_no": p["page_no"],
                    "verified": True, "source": p["method"], "relocated": p["page_id"] != page_id}

    # Vision pages: the quote may come from the vision model's transcription (text OCR could not place) or from its
    # description of the image. Both are verified against what the vision model produced and placed approximately.
    for d, p in cited:
        if p["method"] != "vision":
            continue
        vision = p.get("vision") or {}
        for field, match in (("transcription", "approximate"), ("description", "description")):
            if _find(_norm(quote), _norm(vision.get(field, ""))):
                return {**base, "doc_key": d["doc_key"], "page_no": p["page_no"], "verified": True,
                        "match": match, "rects": [[0.0, 0.0, 1.0, 1.0]], "source": "vision"}

    if cited:
        d, p = cited[0]
        base.update(doc_key=d["doc_key"], page_no=p["page_no"], source=p["method"])
    return base
