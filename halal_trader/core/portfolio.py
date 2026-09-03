"""Portfolio manager with risk controls.

Tracks open positions, enforces stop-loss / take-profit, and limits
per-position and total exposure.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path

from halal_trader.utils.config import Config, DATA_DIR
from halal_trader.utils.logger import get_logger

log = get_logger(__name__)

POSITIONS_FILE = DATA_DIR / "positions.json"


@dataclass
class Position:
    symbol: str
    entry_price: float
    quantity: float
    quote_spent: float
    entry_ts: float
    features: dict = field(default_factory=dict)

    @property
    def age_hours(self) -> float:
        return (time.time() - self.entry_ts) / 3600


class Portfolio:
    def __init__(self, config: Config):
        self.config = config
        self.positions: dict[str, Position] = {}
        self._load()

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def _load(self) -> None:
        if POSITIONS_FILE.exists():
            with open(POSITIONS_FILE) as f:
                data = json.load(f)
            for sym, d in data.items():
                self.positions[sym] = Position(**d)
            log.info("Loaded %d open positions", len(self.positions))

    def _save(self) -> None:
        data = {sym: asdict(p) for sym, p in self.positions.items()}
        with open(POSITIONS_FILE, "w") as f:
            json.dump(data, f, indent=2)

    # ------------------------------------------------------------------
    # Position management
    # ------------------------------------------------------------------

    def can_open(self, total_balance: float) -> bool:
        return len(self.positions) < self.config.max_total_positions

    def position_size(self, total_balance: float) -> float:
        return total_balance * (self.config.max_position_pct / 100)

    def open_position(self, symbol: str, entry_price: float,
                      quantity: float, quote_spent: float,
                      features: dict | None = None) -> Position:
        pos = Position(
            symbol=symbol,
            entry_price=entry_price,
            quantity=quantity,
            quote_spent=quote_spent,
            entry_ts=time.time(),
            features=features or {},
        )
        self.positions[symbol] = pos
        self._save()
        log.info("Opened position %s @ %.4f (qty=%.6f)", symbol, entry_price, quantity)
        return pos

    def close_position(self, symbol: str) -> Position | None:
        pos = self.positions.pop(symbol, None)
        if pos:
            self._save()
            log.info("Closed position %s", symbol)
        return pos

    def check_exit(self, symbol: str, current_price: float) -> str | None:
        """Return 'stop_loss', 'take_profit', or None."""
        pos = self.positions.get(symbol)
        if not pos:
            return None
        pnl_pct = (current_price - pos.entry_price) / pos.entry_price * 100
        if pnl_pct <= -self.config.stop_loss_pct:
            return "stop_loss"
        if pnl_pct >= self.config.take_profit_pct:
            return "take_profit"
        return None

    def unrealised_pnl(self, symbol: str, current_price: float) -> float:
        pos = self.positions.get(symbol)
        if not pos:
            return 0.0
        return (current_price - pos.entry_price) / pos.entry_price * 100
