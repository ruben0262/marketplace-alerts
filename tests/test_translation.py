from unittest.mock import AsyncMock

import pytest

from listing_monitor.config import AppConfig, TranslationConfig
from listing_monitor.models import Listing
from listing_monitor.translation import TranslationService, translate_condition


def test_common_marketplace_conditions_translate_offline():
    assert translate_condition("Très bon état") == "Very good"
    assert translate_condition("Neu mit Etikett") == "New with tags"
    assert translate_condition("Zeer goed") == "Very good"
    assert translate_condition("Muito bom") == "Very good"
    assert translate_condition("Unknown condition") == "Unknown condition"


@pytest.mark.asyncio
async def test_deepl_translates_listing_text_and_caches_results():
    service = TranslationService(
        TranslationConfig(enabled=True, api_key="test-key"),
        AppConfig(request_retries=1),
        "test",
    )
    service.http.request_json = AsyncMock(
        return_value={
            "translations": [
                {"text": "Sweat suit"},
                {"text": "Black boxing outfit"},
                {"text": "Black"},
            ]
        }
    )
    listing = Listing(
        "vinted",
        "www.vinted.fr",
        "123",
        "Tenue de sudation",
        "https://www.vinted.fr/items/123",
        description="Tenue de boxe noire",
        attributes={"Condition": "Très bon état", "Color": "Noir"},
    )

    await service.translate_listing(listing)

    assert listing.title == "Sweat suit"
    assert listing.description == "Black boxing outfit"
    assert listing.attributes["Condition"] == "Very good"
    assert listing.attributes["Color"] == "Black"
    await service.close()
