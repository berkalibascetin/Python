#!/usr/bin/env python3
"""CLI entry point for the Halal Trader bot."""

import argparse
import sys
import time

import schedule

from halal_trader.core.bot import HalalBot
from halal_trader.utils.config import Config
from halal_trader.utils.logger import get_logger

log = get_logger("halal_trader")


def cmd_scan(bot: HalalBot) -> None:
    """Run a single scan cycle."""
    summary = bot.scan_and_trade()
    print(f"\nScan Summary: {summary}")


def cmd_status(bot: HalalBot) -> None:
    """Show open positions and balance."""
    balance = bot.exchange.get_balance(bot.config.quote_currency)
    print(f"\n{'='*60}")
    print(f"  Balance: {balance:.2f} {bot.config.quote_currency}")
    print(f"  Mode:    {bot.config.trade_mode}")
    print(f"  Open:    {len(bot.portfolio.positions)} positions")
    print(f"{'='*60}")
    for sym, pos in bot.portfolio.positions.items():
        try:
            price = bot.exchange.get_price(sym)
            pnl = (price - pos.entry_price) / pos.entry_price * 100
            print(f"  {sym:<12} entry={pos.entry_price:.4f}  now={price:.4f}  PnL={pnl:+.2f}%")
        except Exception:
            print(f"  {sym:<12} entry={pos.entry_price:.4f}  (price unavailable)")
    print()


def cmd_loop(bot: HalalBot) -> None:
    """Run continuously on a schedule."""
    interval = bot.config.scan_interval_minutes
    log.info("Starting continuous loop every %d minutes (Ctrl+C to stop)", interval)

    bot.scan_and_trade()
    schedule.every(interval).minutes.do(bot.scan_and_trade)

    try:
        while True:
            schedule.run_pending()
            time.sleep(10)
    except KeyboardInterrupt:
        log.info("Bot stopped by user")


def cmd_filter_test(bot: HalalBot) -> None:
    """Show how many symbols pass the halal filter."""
    all_syms = bot.exchange.get_all_spot_symbols()
    halal = bot.halal.filter_symbols(all_syms, bot.config.quote_currency)
    print(f"\nTotal USDT spot symbols: {len(all_syms)}")
    print(f"After halal filter:     {len(halal)}")
    print(f"Blocked:                {len(all_syms) - len(halal)}")
    print("\nFirst 20 allowed symbols:")
    for s in halal[:20]:
        print(f"  {s['symbol']}")
    print()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Halal Trader — Binance spot bot (no leverage, Islamic-finance filtered)",
    )
    parser.add_argument(
        "command",
        choices=["scan", "status", "loop", "filter-test"],
        help="scan: one cycle | status: show portfolio | loop: continuous | filter-test: show halal filter",
    )
    parser.add_argument("--mode", choices=["paper", "live"], default=None)
    args = parser.parse_args()

    config = Config()
    if args.mode:
        config.trade_mode = args.mode

    bot = HalalBot(config)

    {"scan": cmd_scan, "status": cmd_status, "loop": cmd_loop, "filter-test": cmd_filter_test}[args.command](bot)


if __name__ == "__main__":
    main()
