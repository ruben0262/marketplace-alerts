from __future__ import annotations

import argparse
import asyncio
import logging
from pathlib import Path

from dotenv import load_dotenv

from . import __version__
from .config import ConfigError, load_config, validate_delivery_config
from .marketplaces import EbayAdapter, VintedAdapter
from .monitor import Monitor
from .state import StateStore
from .telegram import TelegramPublisher


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Poll marketplace listings and send new matches to Telegram."
    )
    parser.add_argument("--config", type=Path, default=Path("config.yaml"))
    parser.add_argument("--env-file", type=Path, default=Path(".env"))
    parser.add_argument(
        "--check-config",
        action="store_true",
        help="Validate configuration without contacting marketplaces or Telegram",
    )
    parser.add_argument("--once", action="store_true", help="Run one polling cycle and exit")
    parser.add_argument(
        "--dry-run", action="store_true", help="Log unseen listings without publishing or saving"
    )
    parser.add_argument(
        "--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"]
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    return parser


async def _run(args: argparse.Namespace) -> None:
    load_dotenv(args.env_file)
    config = load_config(args.config)
    if args.check_config:
        enabled = [name for name in ("ebay", "vinted") if getattr(config, name).enabled]
        print(
            f"Configuration valid: {len(config.searches)} search(es), "
            f"enabled source(s): {', '.join(enabled)}"
        )
        return
    if not args.dry_run:
        validate_delivery_config(config)
    adapters = []
    if config.ebay.enabled:
        adapters.append(EbayAdapter(config.ebay, config.app, config.user_agent))
    if config.vinted.enabled:
        adapters.append(VintedAdapter(config.vinted, config.app, config.user_agent))
    publisher = TelegramPublisher(config.telegram, config.app, config.user_agent)
    monitor = Monitor(
        config,
        adapters,
        publisher,
        StateStore(config.app.state_db),
        dry_run=args.dry_run,
    )
    try:
        await monitor.run(once=args.once)
    finally:
        await monitor.close()


def main() -> None:
    args = build_parser().parse_args()
    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    try:
        asyncio.run(_run(args))
    except ConfigError as exc:
        raise SystemExit(f"Configuration error: {exc}") from exc
    except KeyboardInterrupt:
        logging.getLogger(__name__).info("Stopped")
