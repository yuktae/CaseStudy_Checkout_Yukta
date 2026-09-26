"""Thin wrapper around the Anthropic SDK: structured output + server-side refusal fallback."""

import logging
from functools import lru_cache
from typing import TypeVar

import anthropic
from pydantic import BaseModel

from .config import MODEL

log = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)

FALLBACK_BETA = "server-side-fallback-2026-07-01"


class LLMError(RuntimeError):
    pass


@lru_cache(maxsize=1)
def client() -> anthropic.Anthropic:
    return anthropic.Anthropic(max_retries=3)


def parse(*, system: list[dict] | str, content: list[dict], output_format: type[T],
          effort: str = "high", max_tokens: int = 16000) -> T:
    """One structured call. Declined requests are re-run server-side on Anthropic's recommended fallback model."""
    try:
        response = client().beta.messages.parse(
            model=MODEL,
            max_tokens=max_tokens,
            betas=[FALLBACK_BETA],
            fallbacks="default",
            output_config={"effort": effort},
            system=system,
            messages=[{"role": "user", "content": content}],
            output_format=output_format,
        )
    except anthropic.AuthenticationError as e:
        raise LLMError("Anthropic API key is missing or invalid.") from e
    except anthropic.RateLimitError as e:
        raise LLMError("Anthropic rate limit reached. Retry in a minute.") from e
    except anthropic.BadRequestError as e:
        raise LLMError(f"Request rejected by the API: {e.message}") from e
    except anthropic.APIStatusError as e:
        raise LLMError(f"Anthropic API error ({e.status_code}).") from e
    except anthropic.APIConnectionError as e:
        raise LLMError("Could not reach the Anthropic API.") from e

    if response.stop_reason == "refusal":
        raise LLMError("The model declined to process this case.")
    if response.stop_reason == "max_tokens":
        raise LLMError("The model response was cut off (max_tokens).")
    if response.parsed_output is None:
        raise LLMError("The model did not return valid structured output.")
    log.info("LLM call ok: model=%s in=%s out=%s", response.model,
             response.usage.input_tokens, response.usage.output_tokens)
    return response.parsed_output
