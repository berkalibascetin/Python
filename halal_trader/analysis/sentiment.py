"""News and social-media sentiment analysis.

Gathers headlines from free RSS feeds (CoinDesk, CoinTelegraph, Google News)
and optionally NewsAPI, then scores them with TextBlob polarity.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import feedparser
from textblob import TextBlob

from halal_trader.utils.logger import get_logger

log = get_logger(__name__)

RSS_FEEDS = [
    "https://www.coindesk.com/arc/outboundfeeds/rss/",
    "https://cointelegraph.com/rss",
    "https://news.google.com/rss/search?q=crypto+market&hl=en",
]


@dataclass
class SentimentResult:
    symbol: str
    polarity: float       # -1 … +1
    headline_count: int
    top_headlines: list[str]


def _fetch_headlines(keyword: str, max_per_feed: int = 20) -> list[str]:
    headlines: list[str] = []
    for url in RSS_FEEDS:
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries[:max_per_feed]:
                title = entry.get("title", "")
                if keyword.lower() in title.lower():
                    headlines.append(title)
        except Exception:
            continue
    return headlines


def _score_text(text: str) -> float:
    return TextBlob(text).sentiment.polarity


def analyse_sentiment(symbol: str, keyword: str | None = None) -> SentimentResult:
    """Fetch recent headlines and return aggregate sentiment for *keyword*."""
    kw = keyword or symbol.replace("USDT", "").replace("BTC", "")
    headlines = _fetch_headlines(kw)

    if not headlines:
        return SentimentResult(symbol, 0.0, 0, [])

    scores = [_score_text(h) for h in headlines]
    avg = sum(scores) / len(scores) if scores else 0.0

    top = sorted(zip(scores, headlines), key=lambda x: abs(x[0]), reverse=True)
    top_headlines = [h for _, h in top[:5]]

    log.info("Sentiment for %s: %.3f (%d headlines)", symbol, avg, len(headlines))
    return SentimentResult(
        symbol=symbol,
        polarity=avg,
        headline_count=len(headlines),
        top_headlines=top_headlines,
    )
