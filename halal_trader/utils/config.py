"""Central configuration loaded from environment variables."""

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)


@dataclass
class Config:
    api_key: str = field(default_factory=lambda: os.getenv("BINANCE_API_KEY", ""))
    api_secret: str = field(default_factory=lambda: os.getenv("BINANCE_API_SECRET", ""))
    trade_mode: str = field(default_factory=lambda: os.getenv("TRADE_MODE", "paper"))
    quote_currency: str = field(default_factory=lambda: os.getenv("QUOTE_CURRENCY", "USDT"))
    max_position_pct: float = field(default_factory=lambda: float(os.getenv("MAX_POSITION_PCT", "5.0")))
    max_total_positions: int = field(default_factory=lambda: int(os.getenv("MAX_TOTAL_POSITIONS", "10")))
    stop_loss_pct: float = field(default_factory=lambda: float(os.getenv("STOP_LOSS_PCT", "3.0")))
    take_profit_pct: float = field(default_factory=lambda: float(os.getenv("TAKE_PROFIT_PCT", "8.0")))
    scan_interval_minutes: int = field(default_factory=lambda: int(os.getenv("SCAN_INTERVAL_MINUTES", "15")))
    news_api_key: str = field(default_factory=lambda: os.getenv("NEWS_API_KEY", ""))

    @property
    def is_paper(self) -> bool:
        return self.trade_mode.lower() == "paper"
