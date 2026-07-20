from __future__ import annotations

import asyncio
import logging
import random
import re
from typing import Any

import httpx

LOGGER = logging.getLogger(__name__)
TELEGRAM_TOKEN_PATTERN = re.compile(r"(https://api\.telegram\.org/bot)[^/\s\"']+", re.IGNORECASE)
URL_CREDENTIALS_PATTERN = re.compile(r"(https?://)[^/@\s\"']+@", re.IGNORECASE)


def redact_sensitive_text(value: str) -> str:
    """Remove credentials commonly embedded in request URLs before logging."""
    redacted = TELEGRAM_TOKEN_PATTERN.sub(r"\1<redacted>", value)
    return URL_CREDENTIALS_PATTERN.sub(r"\1<redacted>@", redacted)


def retry_after_seconds(response: httpx.Response) -> float | None:
    """Read a numeric retry delay from a standard header or Telegram response body."""
    candidates: list[Any] = [response.headers.get("Retry-After")]
    try:
        payload = response.json()
    except ValueError:
        payload = None
    if isinstance(payload, dict):
        parameters = payload.get("parameters")
        if isinstance(parameters, dict):
            candidates.append(parameters.get("retry_after"))
    for candidate in candidates:
        try:
            delay = float(candidate)
        except (TypeError, ValueError):
            continue
        if delay >= 0:
            return delay
    return None


class HttpClient:
    """Small async JSON client with bounded retries for transient failures."""

    def __init__(self, *, timeout: float, retries: int, user_agent: str) -> None:
        self.retries = retries
        self.client = httpx.AsyncClient(
            timeout=timeout,
            follow_redirects=True,
            headers={"User-Agent": user_agent, "Accept": "application/json"},
        )

    async def close(self) -> None:
        await self.client.aclose()

    async def request_json(self, method: str, url: str, **kwargs: Any) -> dict[str, Any]:
        for attempt in range(1, self.retries + 1):
            try:
                response = await self.client.request(method, url, **kwargs)
                response.raise_for_status()
                payload = response.json()
                if not isinstance(payload, dict):
                    raise ValueError(f"Expected JSON object from {url}")
                return payload
            except httpx.HTTPStatusError as exc:
                status = exc.response.status_code
                if status != 429 and status < 500:
                    raise
                if attempt == self.retries:
                    raise
                required_delay = retry_after_seconds(exc.response) if status == 429 else None
                delay = max(required_delay or 0, min(2 ** (attempt - 1), 8))
                delay += random.uniform(0, 0.5)
                LOGGER.warning(
                    "Request failed (%s); retrying in %.1fs",
                    redact_sensitive_text(str(exc)),
                    delay,
                )
                await asyncio.sleep(delay)
            except (httpx.RequestError, ValueError) as exc:
                if attempt == self.retries:
                    raise
                delay = min(2 ** (attempt - 1), 8) + random.uniform(0, 0.5)
                LOGGER.warning(
                    "Request failed (%s); retrying in %.1fs",
                    redact_sensitive_text(str(exc)),
                    delay,
                )
                await asyncio.sleep(delay)
        raise RuntimeError("unreachable")
