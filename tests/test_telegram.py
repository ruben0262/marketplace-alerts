from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest.mock import AsyncMock

import httpx
import pytest

from listing_monitor.config import AppConfig, TelegramConfig
from listing_monitor.http_client import HttpClient, redact_sensitive_text
from listing_monitor.models import Listing
from listing_monitor.telegram import TelegramPublisher, format_caption, format_relative_age


def test_caption_escapes_html_and_respects_limit():
    item = Listing(
        "ebay",
        "EBAY_GB",
        "1",
        "Jacket <rare>",
        "https://example.test/item?a=1&b=2",
        price=Decimal("25"),
        currency="GBP",
        description="A & B " * 500,
        search_name="test",
        attributes={"Condition": "Very good"},
    )
    caption = format_caption(item)
    assert "&lt;rare&gt;" in caption
    # No links anywhere in the body; the product link is an inline button instead.
    assert "href=" not in caption
    assert "<a " not in caption
    assert "example.test" not in caption
    assert "<b>Condition:</b> Very good" in caption
    assert "<b>Marketplace:</b> EBAY_GB" in caption
    assert len(caption) <= 1024


def test_relative_listing_age_uses_readable_units():
    now = datetime(2026, 7, 20, 12, 0, tzinfo=UTC)
    assert format_relative_age(now - timedelta(minutes=12), now=now) == "12 minutes ago"
    assert format_relative_age(now - timedelta(hours=3), now=now) == "3 hours ago"
    assert format_relative_age(now - timedelta(days=2), now=now) == "2 days ago"
    assert format_relative_age(now - timedelta(days=14), now=now) == "2 weeks ago"


def test_log_redaction_hides_embedded_credentials():
    message = (
        "POST https://api.telegram.org/bot123456:synthetic-secret/sendPhoto "
        "through http://proxy-user:proxy-secret@proxy.test:8080"
    )
    redacted = redact_sensitive_text(message)
    assert "synthetic-secret" not in redacted
    assert "proxy-secret" not in redacted
    assert "bot<redacted>/sendPhoto" in redacted
    assert "http://<redacted>@proxy.test:8080" in redacted


@pytest.mark.asyncio
async def test_http_client_honors_telegram_retry_after(monkeypatch: pytest.MonkeyPatch):
    request = httpx.Request("POST", "https://api.telegram.org/bot-token/sendPhoto")
    responses = [
        httpx.Response(
            429,
            request=request,
            json={"ok": False, "parameters": {"retry_after": 4}},
        ),
        httpx.Response(200, request=request, json={"ok": True}),
    ]
    client = HttpClient(timeout=5, retries=2, user_agent="test")
    sleep_delays = []

    async def fake_request(*args, **kwargs):
        return responses.pop(0)

    async def fake_sleep(delay):
        sleep_delays.append(delay)

    monkeypatch.setattr(client.client, "request", fake_request)
    monkeypatch.setattr("listing_monitor.http_client.asyncio.sleep", fake_sleep)
    result = await client.request_json("POST", str(request.url))
    assert result == {"ok": True}
    assert 4 <= sleep_delays[0] <= 4.5
    await client.close()


@pytest.mark.asyncio
async def test_send_photo_attaches_visit_product_button_without_links():
    publisher = TelegramPublisher(
        TelegramConfig("token", "chat"),
        AppConfig(request_retries=1),
        "test",
    )
    publisher._request = AsyncMock()
    listing = Listing(
        "vinted",
        "www.vinted.test",
        "42",
        "Example hoodie",
        "https://www.vinted.test/items/42-example",
        image_urls=["https://images.test/42.jpg"],
    )

    await publisher.send(listing)

    method, payload = publisher._request.await_args.args
    assert method == "sendPhoto"
    assert payload["reply_markup"]["inline_keyboard"] == [
        [{"text": "Visit product", "url": "https://www.vinted.test/items/42-example"}]
    ]
    assert "href=" not in payload["caption"]
    await publisher.close()


@pytest.mark.asyncio
async def test_send_text_used_when_no_images_still_has_button():
    publisher = TelegramPublisher(
        TelegramConfig("token", "chat"),
        AppConfig(request_retries=1),
        "test",
    )
    publisher._request = AsyncMock()
    listing = Listing(
        "ebay",
        "EBAY_GB",
        "7",
        "Example tee",
        "https://example.test/item/7",
    )

    await publisher.send(listing)

    method, payload = publisher._request.await_args.args
    assert method == "sendMessage"
    assert payload["reply_markup"]["inline_keyboard"][0][0]["text"] == "Visit product"
    await publisher.close()


@pytest.mark.asyncio
async def test_telegram_rate_limit_does_not_trigger_text_fallback():
    publisher = TelegramPublisher(
        TelegramConfig("token", "chat"),
        AppConfig(request_retries=1),
        "test",
    )
    listing = Listing(
        "vinted",
        "www.vinted.test",
        "42",
        "Example hoodie",
        "https://www.vinted.test/items/42-example",
        image_urls=["https://images.test/42.jpg"],
    )
    response = httpx.Response(
        429,
        request=httpx.Request("POST", "https://api.telegram.org/bot-token/sendPhoto"),
        json={"ok": False, "parameters": {"retry_after": 3}},
    )
    error = httpx.HTTPStatusError("rate limited", request=response.request, response=response)
    publisher._send_photo = AsyncMock(side_effect=error)
    publisher._send_text = AsyncMock()

    with pytest.raises(httpx.HTTPStatusError):
        await publisher.send(listing)

    publisher._send_text.assert_not_awaited()
    await publisher.close()
