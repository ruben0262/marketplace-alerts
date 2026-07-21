from pathlib import Path

import pytest

from listing_monitor.config import ConfigError, load_config, validate_delivery_config


MINIMAL_CONFIG = """
app:
  poll_interval_seconds: 60
telegram: {}
sources:
  ebay:
    enabled: false
  vinted:
    enabled: true
    sites:
      - url: https://www.vinted.test
        name: Test Vinted
searches:
  - name: Test search
    query: example
    sources: [vinted]
"""


def test_dry_run_configuration_does_not_require_delivery_credentials(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)
    path = tmp_path / "config.yaml"
    path.write_text(MINIMAL_CONFIG, encoding="utf-8")
    config = load_config(path)
    assert config.telegram.bot_token == ""
    assert config.telegram.min_send_interval_seconds == 1.1
    assert config.app.state_file == Path("data/listings.json")
    assert config.app.legacy_state_db == Path("data/listings.sqlite3")
    with pytest.raises(ConfigError, match="TELEGRAM_BOT_TOKEN"):
        validate_delivery_config(config)


def test_default_user_agent_uses_package_name(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("MONITOR_USER_AGENT", raising=False)
    path = tmp_path / "config.yaml"
    path.write_text(MINIMAL_CONFIG, encoding="utf-8")
    config = load_config(path)
    assert config.user_agent.startswith("marketplace-alerts/")


def test_vinted_proxy_is_loaded_from_env_without_scheme(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("VINTED_PROXY", "https://user:secret@proxy.test:8080")
    path = tmp_path / "config.yaml"
    path.write_text(MINIMAL_CONFIG, encoding="utf-8")
    config = load_config(path)
    assert config.vinted.proxy == "user:secret@proxy.test:8080"
    assert config.vinted.cookies_dir == Path("data/vinted-cookies")
    assert config.vinted.retry_cooldown_seconds == 900


def test_vinted_request_spacing_defaults_to_one_second(tmp_path: Path):
    path = tmp_path / "config.yaml"
    path.write_text(MINIMAL_CONFIG, encoding="utf-8")
    config = load_config(path)
    assert config.vinted.request_spacing_seconds == 1.0


def test_vinted_request_spacing_rejects_negative(tmp_path: Path):
    path = tmp_path / "config.yaml"
    path.write_text(
        MINIMAL_CONFIG.replace(
            "        name: Test Vinted",
            "        name: Test Vinted\n    request_spacing_seconds: -1",
        ),
        encoding="utf-8",
    )
    with pytest.raises(ConfigError, match="request_spacing_seconds"):
        load_config(path)


def test_old_state_db_setting_maps_to_json_and_keeps_migration_source(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.delenv("DEEPL_API_KEY", raising=False)
    path = tmp_path / "config.yaml"
    path.write_text(
        MINIMAL_CONFIG.replace(
            "poll_interval_seconds: 60",
            "poll_interval_seconds: 60\n  state_db: data/legacy.sqlite3",
        ),
        encoding="utf-8",
    )
    config = load_config(path)
    assert config.app.state_file == Path("data/legacy.json")
    assert config.app.legacy_state_db == Path("data/legacy.sqlite3")


def test_ebay_price_filter_requires_marketplace_currency(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("EBAY_CLIENT_ID", "production-app-id")
    monkeypatch.setenv("EBAY_CLIENT_SECRET", "production-cert-id")
    path = tmp_path / "config.yaml"
    path.write_text(
        """
app:
  poll_interval_seconds: 60
telegram: {}
sources:
  ebay:
    enabled: true
    marketplaces:
      - id: EBAY_GB
        delivery_country: GB
  vinted:
    enabled: false
searches:
  - name: Price search
    query: example
    sources: [ebay]
    max_price: 100
""",
        encoding="utf-8",
    )

    with pytest.raises(ConfigError, match="EBAY_GB"):
        load_config(path)
