from __future__ import annotations

import asyncio
import logging
import random
from typing import Any

import httpx

LOGGER = logging.getLogger(__name__)


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
                if response.status_code == 429 or response.status_code >= 500:
                    response.raise_for_status()
                response.raise_for_status()
                payload = response.json()
                if not isinstance(payload, dict):
                    raise ValueError(f"Expected JSON object from {url}")
                return payload
            except (httpx.HTTPError, ValueError) as exc:
                if attempt == self.retries:
                    raise
                delay = min(2 ** (attempt - 1), 8) + random.uniform(0, 0.5)
                LOGGER.warning("Request failed (%s); retrying in %.1fs", exc, delay)
                await asyncio.sleep(delay)
        raise RuntimeError("unreachable")
