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
