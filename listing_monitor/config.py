from __future__ import annotations

import os
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path
from typing import Any

import yaml

from . import __version__
from .models import parse_decimal


class ConfigError(ValueError):
    pass


@dataclass(slots=True)
class AppConfig:
    poll_interval_seconds: float = 60
    request_timeout_seconds: float = 20
    request_retries: int = 3
    state_db: Path = Path("data/listings.sqlite3")
    send_existing_on_start: bool = False
    poll_jitter_seconds: float = 5


@dataclass(slots=True)
class TelegramConfig:
    bot_token: str
    chat_id: str
    max_images: int = 5
    disable_notification: bool = False


@dataclass(slots=True)
class EbayMarketplace:
    id: str
    delivery_country: str


@dataclass(slots=True)
class EbayConfig:
    enabled: bool = True
    client_id: str = ""
    client_secret: str = ""
    marketplaces: list[EbayMarketplace] = field(default_factory=list)
    pages_per_search: int = 2
    results_per_page: int = 50


@dataclass(slots=True)
class VintedSite:
    url: str
    name: str


@dataclass(slots=True)
class VintedConfig:
    enabled: bool = False
    sites: list[VintedSite] = field(default_factory=list)
    pages_per_search: int = 2
    results_per_page: int = 40
    fetch_item_details: bool = True
    cookies_dir: Path = Path("data/vinted-cookies")
    retry_cooldown_seconds: int = 900
    proxy: str = ""


@dataclass(slots=True)
class SearchConfig:
    name: str
    query: str
    sources: set[str] = field(default_factory=lambda: {"ebay", "vinted"})
    max_age_hours: float | None = 24
    min_price: Decimal | None = None
    max_price: Decimal | None = None
    required_brands: list[str] = field(default_factory=list)
    include_keywords: list[str] = field(default_factory=list)
    include_any_groups: list[list[str]] = field(default_factory=list)
    exclude_keywords: list[str] = field(default_factory=list)
    ebay_category_ids: list[str] = field(default_factory=list)
    vinted_catalog_ids: list[str] = field(default_factory=list)


@dataclass(slots=True)
class Config:
    app: AppConfig
    telegram: TelegramConfig
    ebay: EbayConfig
    vinted: VintedConfig
    searches: list[SearchConfig]
    user_agent: str


def _mapping(value: Any, location: str) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ConfigError(f"{location} must be a mapping")
    return value


def _positive_int(value: Any, location: str, *, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ConfigError(f"{location} must be an integer") from exc
    if not 1 <= parsed <= maximum:
        raise ConfigError(f"{location} must be between 1 and {maximum}")
    return parsed


def _string_list(value: Any, location: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ConfigError(f"{location} must be a list")
    result = [str(item).strip().casefold() for item in value if str(item).strip()]
    return result


def _keyword_groups(value: Any, location: str) -> list[list[str]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ConfigError(f"{location} must be a list of lists")
    groups: list[list[str]] = []
    for index, group in enumerate(value):
        parsed = _string_list(group, f"{location}[{index}]")
        if not parsed:
            raise ConfigError(f"{location}[{index}] cannot be empty")
        groups.append(parsed)
    return groups


def _normalize_proxy(value: str) -> str:
    """Return the proxy format expected by the Vinted client without exposing it."""
    proxy = value.strip()
    for prefix in ("http://", "https://"):
        if proxy.casefold().startswith(prefix):
            return proxy[len(prefix) :]
    return proxy


def load_config(path: Path) -> Config:
    if not path.exists():
        raise ConfigError(f"Configuration file not found: {path}")
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as exc:
        raise ConfigError(f"Invalid YAML in {path}: {exc}") from exc
    root = _mapping(raw, "config")
    app_raw = _mapping(root.get("app"), "app")
    telegram_raw = _mapping(root.get("telegram"), "telegram")
    sources_raw = _mapping(root.get("sources"), "sources")
    ebay_raw = _mapping(sources_raw.get("ebay"), "sources.ebay")
    vinted_raw = _mapping(sources_raw.get("vinted"), "sources.vinted")

    app = AppConfig(
        poll_interval_seconds=float(app_raw.get("poll_interval_seconds", 60)),
        request_timeout_seconds=float(app_raw.get("request_timeout_seconds", 20)),
        request_retries=_positive_int(
            app_raw.get("request_retries", 3), "app.request_retries", maximum=10
        ),
        state_db=Path(str(app_raw.get("state_db", "data/listings.sqlite3"))),
        send_existing_on_start=bool(app_raw.get("send_existing_on_start", False)),
        poll_jitter_seconds=float(app_raw.get("poll_jitter_seconds", 5)),
    )
    if app.poll_interval_seconds < 15:
        raise ConfigError("app.poll_interval_seconds must be at least 15 seconds")
    if app.request_timeout_seconds <= 0 or app.poll_jitter_seconds < 0:
        raise ConfigError("request timeout must be positive and jitter cannot be negative")

    bot_token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.getenv("TELEGRAM_CHAT_ID", "").strip()
    telegram = TelegramConfig(
        bot_token=bot_token,
        chat_id=chat_id,
        max_images=_positive_int(
            telegram_raw.get("max_images", 5), "telegram.max_images", maximum=10
        ),
        disable_notification=bool(telegram_raw.get("disable_notification", False)),
    )

    ebay_enabled = bool(ebay_raw.get("enabled", True))
    marketplaces: list[EbayMarketplace] = []
    for index, item in enumerate(ebay_raw.get("marketplaces", [])):
        entry = _mapping(item, f"sources.ebay.marketplaces[{index}]")
        marketplace_id = str(entry.get("id", "")).strip()
        country = str(entry.get("delivery_country", "")).strip().upper()
        if not marketplace_id or len(country) != 2:
            raise ConfigError(f"Invalid eBay marketplace at index {index}")
        marketplaces.append(EbayMarketplace(marketplace_id, country))
    ebay = EbayConfig(
        enabled=ebay_enabled,
        client_id=os.getenv("EBAY_CLIENT_ID", "").strip(),
        client_secret=os.getenv("EBAY_CLIENT_SECRET", "").strip(),
        marketplaces=marketplaces,
        pages_per_search=_positive_int(
            ebay_raw.get("pages_per_search", 2), "sources.ebay.pages_per_search", maximum=20
        ),
        results_per_page=_positive_int(
            ebay_raw.get("results_per_page", 50), "sources.ebay.results_per_page", maximum=200
        ),
    )

    sites: list[VintedSite] = []
    for index, item in enumerate(vinted_raw.get("sites", [])):
        entry = _mapping(item, f"sources.vinted.sites[{index}]")
        url = str(entry.get("url", "")).strip().rstrip("/")
        name = str(entry.get("name", url)).strip()
        if not url.startswith("https://"):
            raise ConfigError(f"Vinted site URL at index {index} must use https://")
        sites.append(VintedSite(url, name))
    vinted = VintedConfig(
        enabled=bool(vinted_raw.get("enabled", False)),
        sites=sites,
        pages_per_search=_positive_int(
            vinted_raw.get("pages_per_search", 2), "sources.vinted.pages_per_search", maximum=10
        ),
        results_per_page=_positive_int(
            vinted_raw.get("results_per_page", 40), "sources.vinted.results_per_page", maximum=96
        ),
        fetch_item_details=bool(vinted_raw.get("fetch_item_details", True)),
        cookies_dir=Path(str(vinted_raw.get("cookies_dir", "data/vinted-cookies"))),
        retry_cooldown_seconds=_positive_int(
            vinted_raw.get("retry_cooldown_seconds", 900),
            "sources.vinted.retry_cooldown_seconds",
            maximum=86400,
        ),
        proxy=_normalize_proxy(os.getenv("VINTED_PROXY", "")),
    )

    searches_raw = root.get("searches", [])
    if not isinstance(searches_raw, list) or not searches_raw:
        raise ConfigError("searches must contain at least one search")
    searches: list[SearchConfig] = []
    for index, item in enumerate(searches_raw):
        entry = _mapping(item, f"searches[{index}]")
        query = str(entry.get("query", "")).strip()
        name = str(entry.get("name", query)).strip()
        sources = {str(value).lower() for value in entry.get("sources", ["ebay", "vinted"])}
        if not query or not name:
            raise ConfigError(f"searches[{index}] requires name and query")
        unknown_sources = sources - {"ebay", "vinted"}
        if unknown_sources:
            raise ConfigError(f"searches[{index}] has unknown sources: {sorted(unknown_sources)}")
        age = entry.get("max_age_hours", 24)
        age_value = None if age is None else float(age)
        if age_value is not None and age_value <= 0:
            raise ConfigError(f"searches[{index}].max_age_hours must be positive or null")
        min_price = parse_decimal(entry.get("min_price"))
        max_price = parse_decimal(entry.get("max_price"))
        if min_price is not None and max_price is not None and min_price > max_price:
            raise ConfigError(f"searches[{index}] min_price cannot exceed max_price")
        searches.append(
            SearchConfig(
                name=name,
                query=query,
                sources=sources,
                max_age_hours=age_value,
                min_price=min_price,
                max_price=max_price,
                required_brands=_string_list(
                    entry.get("required_brands", []), f"searches[{index}].required_brands"
                ),
                include_keywords=_string_list(
                    entry.get("include_keywords", []), f"searches[{index}].include_keywords"
                ),
                include_any_groups=_keyword_groups(
                    entry.get("include_any_groups", []),
                    f"searches[{index}].include_any_groups",
                ),
                exclude_keywords=_string_list(
                    entry.get("exclude_keywords", []), f"searches[{index}].exclude_keywords"
                ),
                ebay_category_ids=[str(v) for v in entry.get("ebay_category_ids", [])],
                vinted_catalog_ids=[str(v) for v in entry.get("vinted_catalog_ids", [])],
            )
        )

    if ebay.enabled and (not ebay.client_id or not ebay.client_secret or not ebay.marketplaces):
        raise ConfigError("Enabled eBay source requires credentials and at least one marketplace")
    if vinted.enabled and not vinted.sites:
        raise ConfigError("Enabled Vinted source requires at least one site")
    if not ebay.enabled and not vinted.enabled:
        raise ConfigError("At least one source must be enabled")

    return Config(
        app=app,
        telegram=telegram,
        ebay=ebay,
        vinted=vinted,
        searches=searches,
        user_agent=(
            os.getenv("MONITOR_USER_AGENT", "").strip() or f"marketplace-alerts/{__version__}"
        ),
    )


def validate_delivery_config(config: Config) -> None:
    """Validate values needed only when Telegram delivery is enabled."""
    if not config.telegram.bot_token or not config.telegram.chat_id:
        raise ConfigError(
            "TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required unless using --dry-run"
        )
