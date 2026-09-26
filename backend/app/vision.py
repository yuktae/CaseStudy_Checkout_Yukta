"""Vision agent: Claude reads an evidence image (screenshot, photo, scanned page) and transcribes it."""

import base64

from . import llm
from .config import VISION_EFFORT
from .models import VisionReading

SYSTEM = (
    "You transcribe merchant evidence images for a chargeback disputes team. "
    "Copy every piece of visible text exactly as written, line by line, in reading order. "
    "Do not correct, summarise or infer text that is not visible. "
    "Then describe what the image shows in one or two sentences, including any visual limits "
    "that matter as evidence (for example 'front view only', 'no signature visible', 'cropped')."
)


def read_image(image_bytes: bytes, mime: str) -> VisionReading:
    content = [
        {"type": "image", "source": {"type": "base64", "media_type": mime,
                                     "data": base64.standard_b64encode(image_bytes).decode("utf-8")}},
        {"type": "text", "text": "Transcribe and describe this evidence image."},
    ]
    return llm.parse(system=SYSTEM, content=content, output_format=VisionReading,
                     effort=VISION_EFFORT, max_tokens=4000)
