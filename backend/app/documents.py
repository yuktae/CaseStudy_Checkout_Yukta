"""Document processing: turn every evidence file into pages with text + word positions.

- PDF pages with a text layer: PyMuPDF text and word boxes (exact, free, instant).
- Scanned PDF pages and standalone images: RapidOCR for text line boxes (used to place highlights)
  + the vision model for reading and understanding the image (used as the text the assessment sees).
- Images embedded inside text PDFs: OCR only, mapped onto the page coordinates.

Results are cached per file hash so each document is processed once.
"""

import hashlib
import io
import json
import logging
from functools import lru_cache
from pathlib import Path

import pymupdf
from PIL import Image

from . import vision
from .config import CACHE_DIR, has_api_key

log = logging.getLogger(__name__)

EXTRACT_VERSION = "3"
IMAGE_MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}
SCANNED_PAGE_MIN_CHARS = 20
EMBEDDED_IMAGE_MIN_AREA = 0.04  # share of the page


def mime_for(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    return "application/pdf" if ext == ".pdf" else IMAGE_MIME.get(ext, "application/octet-stream")


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@lru_cache(maxsize=1)
def _ocr_engine():
    from rapidocr_onnxruntime import RapidOCR
    return RapidOCR()


def _ocr_tokens(image_bytes: bytes, scale_x: float = 1.0, scale_y: float = 1.0,
                offset_x: float = 0.0, offset_y: float = 0.0) -> list[list]:
    """OCR an image; return word tokens [text, x0, y0, x1, y1] in the target coordinate space.

    RapidOCR gives one box per text line; words get a share of the line box proportional to their length.
    """
    result, _ = _ocr_engine()(image_bytes)
    tokens = []
    for box, text, _conf in result or []:
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        words = text.split()
        total = sum(len(w) for w in words) + max(len(words) - 1, 0)
        cursor = x0
        for w in words:
            width = (x1 - x0) * (len(w) / total) if total else 0
            tokens.append([w,
                           offset_x + cursor * scale_x, offset_y + y0 * scale_y,
                           offset_x + (cursor + width) * scale_x, offset_y + y1 * scale_y])
            cursor += width + ((x1 - x0) / total if total else 0)
    return tokens


def _tokens_text(tokens: list[list]) -> str:
    """Rebuild readable text from OCR tokens, one line per visual row."""
    lines, current, last_y = [], [], None
    for t in sorted(tokens, key=lambda t: (round(t[2] / 8), t[1])):
        if last_y is not None and abs(t[2] - last_y) > 8:
            lines.append(" ".join(current)); current = []
        current.append(t[0]); last_y = t[2]
    if current:
        lines.append(" ".join(current))
    return "\n".join(lines)


def _vision_page(page_id: str, image_bytes: bytes, mime: str, width: float, height: float,
                 tokens: list[list]) -> dict:
    reading = vision.read_image(image_bytes, mime) if has_api_key() else None
    ocr_text = _tokens_text(tokens)
    if reading:
        text = f"{reading.transcription}\n[Image description: {reading.description}]"
        v = reading.model_dump()
    else:
        text = ocr_text
        v = {"transcription": ocr_text, "description": "", "legibility": "clear" if tokens else "poor"}
    return {"page_id": page_id, "width": width, "height": height, "method": "vision",
            "text": text, "tokens": tokens, "vision": v}


def _extract_pdf(path: Path, doc_key: str) -> list[dict]:
    pages = []
    with pymupdf.open(path) as pdf:
        for i, page in enumerate(pdf, start=1):
            page_id = f"{doc_key}-p{i}"
            w, h = page.rect.width, page.rect.height
            text = page.get_text()
            if len(text.strip()) < SCANNED_PAGE_MIN_CHARS:
                # Scanned page: render and treat like an image.
                pix = page.get_pixmap(dpi=144)
                png = pix.tobytes("png")
                tokens = _ocr_tokens(png, scale_x=w / pix.width, scale_y=h / pix.height)
                pages.append({**_vision_page(page_id, png, "image/png", w, h, tokens), "page_no": i})
                continue
            tokens = [[wd[4], wd[0], wd[1], wd[2], wd[3]] for wd in page.get_text("words")]
            # Images embedded in a text page: OCR them so their text can be cited and highlighted too.
            for img in page.get_images(full=True):
                for rect in page.get_image_rects(img[0]):
                    if rect.width * rect.height < EMBEDDED_IMAGE_MIN_AREA * w * h:
                        continue
                    pix = page.get_pixmap(clip=rect, dpi=144)
                    img_tokens = _ocr_tokens(pix.tobytes("png"), scale_x=rect.width / pix.width,
                                             scale_y=rect.height / pix.height, offset_x=rect.x0, offset_y=rect.y0)
                    if img_tokens:
                        tokens.extend(img_tokens)
                        text += "\n[Text inside embedded image]\n" + _tokens_text(img_tokens)
            pages.append({"page_id": page_id, "page_no": i, "width": w, "height": h, "method": "text",
                          "text": text, "tokens": tokens, "vision": None})
    return pages


def _extract_image(path: Path, doc_key: str, mime: str) -> list[dict]:
    data = path.read_bytes()
    with Image.open(io.BytesIO(data)) as im:
        w, h = im.size
    tokens = _ocr_tokens(data)
    return [{**_vision_page(f"{doc_key}-p1", data, mime, w, h, tokens), "page_no": 1}]


def extract(path: Path, doc_key: str) -> dict:
    """Extract a document into pages. Returns {"kind", "pages", "error"}."""
    mime = mime_for(path.name)
    if not path.exists():
        return {"kind": "missing", "pages": [], "error": "File not found"}
    sha = sha256_of(path)
    variant = "v" if has_api_key() else "o"
    cache_file = CACHE_DIR / "extract" / f"{sha}-{EXTRACT_VERSION}{variant}.json"
    if cache_file.exists():
        cached = json.loads(cache_file.read_text(encoding="utf-8"))
    else:
        try:
            if mime == "application/pdf":
                cached = {"kind": "pdf", "pages": _extract_pdf(path, "DOC"), "error": None}
            elif mime.startswith("image/"):
                cached = {"kind": "image", "pages": _extract_image(path, "DOC", mime), "error": None}
            else:
                cached = {"kind": "unsupported", "pages": [], "error": "Unsupported file type"}
        except Exception as e:  # corrupted or unreadable file
            log.exception("extraction failed for %s", path)
            cached = {"kind": "unreadable", "pages": [], "error": f"Could not read file: {e}"}
        cache_file.write_text(json.dumps(cached), encoding="utf-8")
    # Page ids are case-specific (D1, D2...), the cache is not: re-key on the way out.
    for p in cached["pages"]:
        p["page_id"] = f"{doc_key}-p{p['page_no']}"
    return cached
