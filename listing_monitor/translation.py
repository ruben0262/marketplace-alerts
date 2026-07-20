from __future__ import annotations

import logging
import time
import unicodedata

from .config import AppConfig, TranslationConfig
from .http_client import HttpClient
from .models import Listing

LOGGER = logging.getLogger(__name__)


def _normalize_phrase(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value.casefold())
    without_accents = "".join(
        character for character in decomposed if not unicodedata.combining(character)
    )
    return " ".join(without_accents.replace("-", " ").split())


CONDITION_TRANSLATIONS = {
    _normalize_phrase(source): target
    for source, target in {
        "Neuf avec étiquette": "New with tags",
        "Neuf sans étiquette": "New without tags",
        "Très bon état": "Very good",
        "Bon état": "Good",
        "Satisfaisant": "Satisfactory",
        "Neu mit Etikett": "New with tags",
        "Neu ohne Etikett": "New without tags",
        "Sehr gut": "Very good",
        "Gut": "Good",
        "Zufriedenstellend": "Satisfactory",
        "Nuevo con etiquetas": "New with tags",
        "Nuevo sin etiquetas": "New without tags",
        "Muy bueno": "Very good",
        "Bueno": "Good",
        "Satisfactorio": "Satisfactory",
        "Nuovo con cartellino": "New with tags",
        "Nuovo senza cartellino": "New without tags",
        "Ottime condizioni": "Very good",
        "Buone condizioni": "Good",
        "Discrete condizioni": "Satisfactory",
        "Nieuw met prijskaartje": "New with tags",
        "Nieuw zonder prijskaartje": "New without tags",
        "Zeer goed": "Very good",
        "Goed": "Good",
        "Redelijk": "Satisfactory",
    }.items()
}


def translate_condition(value: str) -> str:
    """Translate known marketplace condition labels without an external API."""
    return CONDITION_TRANSLATIONS.get(_normalize_phrase(value), value)


class TranslationService:
    """Optional DeepL translation with local condition normalization and caching."""

    def __init__(self, config: TranslationConfig, app: AppConfig, user_agent: str) -> None:
        self.config = config
        self.http = HttpClient(
            timeout=app.request_timeout_seconds,
            retries=app.request_retries,
            user_agent=user_agent,
        )
        self._cache: dict[str, str] = {}
        self._unavailable_until = 0.0
        self._missing_key_logged = False

    async def close(self) -> None:
        await self.http.close()

    async def translate_listing(self, listing: Listing) -> None:
        condition = listing.attributes.get("Condition")
        if condition:
            translated_condition = translate_condition(condition)
            listing.attributes["Condition"] = translated_condition
            if translated_condition != condition:
                # Do not pay to translate a condition already handled by the local map.
                self._cache[translated_condition] = translated_condition

        if not self.config.enabled:
            return
        if not self.config.api_key:
            if not self._missing_key_logged:
                LOGGER.warning(
                    "Full text translation is enabled but DEEPL_API_KEY is missing; "
                    "only built-in condition translations are active"
                )
                self._missing_key_logged = True
            return
        if self._unavailable_until > time.monotonic():
            return

        fields: list[tuple[str, str | None]] = [
            ("title", listing.title),
            ("description", listing.description or None),
        ]
        for attribute in ("Condition", "Color", "Secondary color"):
            fields.append((f"attribute:{attribute}", listing.attributes.get(attribute)))

        pending: list[str] = []
        for _, value in fields:
            if value and value not in self._cache and value not in pending:
                pending.append(value)
        if pending:
            try:
                payload = await self.http.request_json(
                    "POST",
                    self.config.api_url,
                    headers={
                        "Authorization": f"DeepL-Auth-Key {self.config.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={"text": pending, "target_lang": self.config.target_language},
                )
                translations = payload.get("translations", [])
                if not isinstance(translations, list) or len(translations) != len(pending):
                    raise ValueError("DeepL returned an unexpected number of translations")
                for original, translated in zip(pending, translations, strict=True):
                    if not isinstance(translated, dict) or not translated.get("text"):
                        raise ValueError("DeepL returned an invalid translation")
                    self._cache[original] = str(translated["text"])
            except Exception as exc:
                self._unavailable_until = time.monotonic() + self.config.failure_cooldown_seconds
                LOGGER.warning(
                    "Translation unavailable (%s); keeping original text for %d seconds",
                    type(exc).__name__,
                    self.config.failure_cooldown_seconds,
                )
                return

        for field, value in fields:
            if not value:
                continue
            translated = self._cache.get(value, value)
            if field == "title":
                listing.title = translated
            elif field == "description":
                listing.description = translated
            else:
                listing.attributes[field.removeprefix("attribute:")] = translated
