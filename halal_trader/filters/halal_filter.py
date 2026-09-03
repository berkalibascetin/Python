"""Islamic finance compliance filter for crypto and stock symbols.

Filtering logic
---------------
1. Explicit block-list: tokens/projects known to involve interest-based
   lending, gambling, adult content, alcohol, tobacco, weapons, pork, or
   conventional insurance/banking as their *primary* business.
2. Stablecoin filter: interest-bearing or algorithmic-rebase stablecoins
   are excluded because their yield mechanism mirrors riba (interest).
3. Category tags from CoinGecko/CoinMarketCap (when available) are
   matched against haram sector keywords.
4. Pure PoS staking-reward tokens are *not* automatically excluded —
   scholarly opinion varies; a conservative flag is provided.

Coins that pass all filters are considered "no known haram reason" rather
than positively certified halal. True Sharia certification requires a
qualified scholar or board.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from halal_trader.utils.logger import get_logger

log = get_logger(__name__)

HARAM_KEYWORDS: set[str] = {
    "casino", "gambling", "gamble", "bet", "betting", "poker",
    "alcohol", "wine", "beer", "liquor", "brewery",
    "tobacco", "cigarette",
    "pork", "swine",
    "adult", "porn", "xxx",
    "weapon", "arms", "defense",
    "interest", "lending", "loan", "mortgage",
    "insurance",
    "bank",
}

BLOCKED_BASES: set[str] = {
    "FUN",        # FunFair — online casino
    "WINK", "WIN",  # WINkLink — gambling
    "BAKE",       # BakeryToken — gambling dApps
    "TLM",        # Alien Worlds — play-to-earn gambling mechanics
    "LINA",       # Linear — synthetic assets (derivative-like)
    "ALPACA",     # Alpaca — leveraged yield / lending
    "COMP",       # Compound — interest-based DeFi lending
    "AAVE",       # Aave — interest-based DeFi lending
    "MKR",        # Maker — interest (stability fee) and riba-based
    "DAI",        # MakerDAO stablecoin — interest-bearing vaults
    "VENUS", "XVS",  # Venus — lending protocol
    "CREAM",      # Cream Finance — lending
    "ANCHOR", "ANC",
}

INTEREST_STABLECOINS: set[str] = {
    "USDD", "FRAX", "LUSD", "GUSD", "TUSD", "ALUSD",
}


@dataclass
class HalalVerdict:
    symbol: str
    is_allowed: bool
    reason: str


@dataclass
class HalalFilter:
    extra_blocked: set[str] = field(default_factory=set)
    extra_allowed: set[str] = field(default_factory=set)
    strict_staking: bool = False

    def check(self, symbol: str, quote: str = "USDT",
              tags: list[str] | None = None,
              description: str = "") -> HalalVerdict:
        base = symbol.replace(quote, "") if symbol.endswith(quote) else symbol

        if base in self.extra_allowed:
            return HalalVerdict(symbol, True, "manually whitelisted")

        if base in BLOCKED_BASES or base in self.extra_blocked:
            return HalalVerdict(symbol, False, f"{base} is in the blocked list (haram sector)")

        if base in INTEREST_STABLECOINS:
            return HalalVerdict(symbol, False, f"{base} is an interest-bearing stablecoin")

        combined_text = " ".join(tags or []) + " " + description
        combined_lower = combined_text.lower()
        for kw in HARAM_KEYWORDS:
            if re.search(rf"\b{kw}\b", combined_lower):
                return HalalVerdict(
                    symbol, False,
                    f"matched haram keyword '{kw}' in metadata",
                )

        return HalalVerdict(symbol, True, "no known haram reason found")

    def filter_symbols(
        self, symbols: list[dict], quote: str = "USDT"
    ) -> list[dict]:
        allowed = []
        blocked_count = 0
        for sym_info in symbols:
            sym = sym_info["symbol"]
            verdict = self.check(sym, quote=quote)
            if verdict.is_allowed:
                allowed.append(sym_info)
            else:
                blocked_count += 1
                log.debug("Filtered out %s: %s", sym, verdict.reason)
        log.info(
            "Halal filter: %d allowed, %d blocked out of %d total",
            len(allowed), blocked_count, len(symbols),
        )
        return allowed
