# -*- coding: utf-8 -*-
"""app.news — pengambil berita (Finnhub + MarketAux), analisa sentimen AI,
dan generator kalender ekonomi deterministik.

Sumber:
    * Finnhub   — GET https://finnhub.io/api/v1/news?category=forex&token=...
    * MarketAux — GET https://api.marketaux.com/api/news/all?...

Semua HTTP via ``httpx.AsyncClient`` (timeout 15 detik) dan dibungkus
try/except → mengembalikan ``[]`` saat gagal (engine harus tetap hidup
meski kunci API tidak diisi). Log via ``app.logger.get_logger``.

Kalender ekonomi (:func:`economic_calendar`) adalah generator deterministik
heuristik untuk event berulang — BUKAN data kalender sungguhan:

    * NFP & Unemployment Rate → Jumat pertama, 13:30 UTC (USD, HIGH)
    * CPI                     → tgl 12, 13:30 UTC (USD, HIGH)
    * PPI                     → tgl 15, 13:30 UTC (USD, MEDIUM)
    * Retail Sales            → tgl 16, 13:30 UTC (USD, MEDIUM)
    * ISM PMI                 → tgl 3, 15:00 UTC (USD, MEDIUM)
    * GDP (kuartalan)         → tgl 27 bulan Jan/Apr/Jul/Okt, 13:30 UTC (USD, HIGH)
    * FOMC (8×/thn)           → Rabu ke-3 bulan 1,3,5,6,7,9,11,12, 19:00 UTC (USD, HIGH)
    * ECB (8×/thn)            → Kamis ke-2 bulan 1,3,4,6,7,9,10,12, 12:45 UTC (EUR, HIGH)
    * BoJ (8×/thn)            → Rabu ke-3 bulan 1,3,4,6,7,9,10,12, 03:00 UTC (JPY, HIGH)
    * BoE (8×/thn)            → Kamis ke-3 bulan 2,3,5,6,8,9,11,12, 12:00 UTC (GBP, HIGH)
    * RBA (bulanan)           → Selasa ke-1 (kecuali Januari), 04:30 UTC (AUD, HIGH)

Nilai forecast/previous dibangkitkan pseudo-acak dengan seed deterministik
per event (stabil antar-run).
"""

from __future__ import annotations

import asyncio
import logging
import os
import random
import re
from datetime import date, datetime, time, timedelta, timezone
from typing import Any

import httpx

try:
    from .ai_providers import ai_chat
except ImportError:  # pragma: no cover
    from app.ai_providers import ai_chat  # type: ignore

try:
    from .config import KNOWN_PAIRS
except ImportError:  # pragma: no cover
    try:
        from app.config import KNOWN_PAIRS  # type: ignore
    except Exception:  # noqa: BLE001 — fallback statis
        KNOWN_PAIRS = (
            "EURUSD", "USDJPY", "GBPUSD", "USDCHF", "USDCAD", "AUDUSD", "NZDUSD",
            "EURJPY", "EURGBP", "EURCHF", "EURAUD", "GBPJPY", "GBPCHF",
            "AUDJPY", "CADJPY", "CHFJPY", "XAUUSD", "XAGUSD",
        )


def _get_logger() -> logging.Logger:
    """Ambil logger aplikasi (fallback aman bila app.logger belum tersedia)."""
    for loader in ("relative", "absolute"):
        try:
            if loader == "relative":
                from .logger import get_logger  # type: ignore
            else:
                from app.logger import get_logger  # type: ignore
            try:
                return get_logger("news")  # type: ignore[call-arg]
            except TypeError:
                return get_logger()  # type: ignore[call-arg]
        except Exception:
            continue
    lg = logging.getLogger("finex.news")
    if not lg.handlers:
        h = logging.StreamHandler()
        h.setFormatter(logging.Formatter("[%(asctime)s] %(levelname)s %(name)s: %(message)s"))
        lg.addHandler(h)
        lg.setLevel(logging.INFO)
    return lg


log = _get_logger()

_HTTP_TIMEOUT = 15.0
#: Batas maksimum berita gabungan yang disimpan.
MAX_NEWS = 60

FINNHUB_URL = "https://finnhub.io/api/v1/news"
MARKETAUX_URL = "https://api.marketaux.com/v1/news/all"

#: Simbol default untuk varian query MarketAux — seluruh 18 pair yang diperdagangkan.
_DEFAULT_SYMBOLS = (
    "EURUSD,USDJPY,GBPUSD,USDCHF,USDCAD,AUDUSD,NZDUSD,"
    "EURJPY,EURGBP,EURCHF,EURAUD,GBPJPY,GBPCHF,AUDJPY,CADJPY,CHFJPY,"
    "XAUUSD,XAGUSD"
)

# Kata kunci heuristik sentimen (fallback tanpa AI).
_POSITIVE_WORDS = {
    "hawkish", "strong", "stronger", "beat", "beats", "up", "rises", "rise",
    "rally", "rallies", "surge", "surges", "growth", "bullish", "upgrade",
    "upgrades", "record", "robust", "expand", "expands", "gain", "gains",
    "boost", "boosts", "optimism", "recovery", "jump", "jumps", "soar", "soars",
}
_NEGATIVE_WORDS = {
    "dovish", "weak", "weaker", "miss", "misses", "down", "falls", "fall",
    "decline", "declines", "slump", "slumps", "recession", "bearish",
    "downgrade", "downgrades", "crisis", "plunge", "plunges", "fear", "fears",
    "war", "tariff", "tariffs", "slowdown", "contraction", "loss", "losses",
    "selloff", "risk-off",
}


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


#: Kata → kode mata uang untuk deteksi pair dari teks berita.
_CURRENCY_WORDS: dict[str, str] = {
    "dollar": "USD", "greenback": "USD", "fed": "USD", "fomc": "USD",
    "u.s": "USD", "us": "USD",
    "euro": "EUR", "ecb": "EUR", "eurozone": "EUR", "euro zone": "EUR",
    "yen": "JPY", "boj": "JPY", "bank of japan": "JPY",
    "pound": "GBP", "sterling": "GBP", "boe": "GBP", "bank of england": "GBP",
    "britain": "GBP", "uk": "GBP",
    "franc": "CHF", "snb": "CHF", "swiss": "CHF",
    "loonie": "CAD", "boc": "CAD", "canada": "CAD", "canadian": "CAD",
    "aussie": "AUD", "rba": "AUD", "australia": "AUD", "australian": "AUD",
    "kiwi": "NZD", "rbnz": "NZD", "new zealand": "NZD",
    "gold": "XAU", "bullion": "XAU",
    "silver": "XAG",
}


def _detect_pairs(text: str, known: tuple[str, ...] | list[str]) -> list[str]:
    """Deteksi pair yang relevan dari headline/summary (kata kunci mata uang)."""
    t = f" {str(text).lower()} "
    ccys: set[str] = set()
    for word, ccy in _CURRENCY_WORDS.items():
        # Word-boundary regex — hindari false positive substring ("focus" ≠ "us").
        if re.search(rf"\b{re.escape(word)}\b", t):
            ccys.add(ccy)
    out: list[str] = []
    for sym in known:
        s = str(sym).upper()
        if s.endswith("USD") and s[:3] in ("XAU", "XAG"):
            base = s[:3]
            if base in ccys:
                out.append(s)
            continue
        base, quote = s[:3], s[3:]
        if base in ccys and quote in ccys:
            out.append(s)
    if not out and len(ccys) == 1:
        only = next(iter(ccys))
        out = [s for s in known if only in str(s).upper()][:4]
    return out[:6]


def _impact_from(text: str, sentiment: float) -> str:
    """Heuristik dampak dari kata kunci + kekuatan sentimen."""
    t = str(text).lower()
    high_words = (
        "breaks", "breaking", "crash", "crashes", "intervention",
        "rate decision", "nonfarm", "non-farm", "nfp", "cpi",
        "emergency", "escalation", "record",
    )
    if any(w in t for w in high_words):
        return "HIGH"
    if abs(sentiment) >= 0.35:
        return "HIGH"
    if abs(sentiment) >= 0.1:
        return "MEDIUM"
    return "LOW"


def _news_key(config: Any, env_name: str, attr: str) -> str:
    """Ambil kunci API berita: env dulu, lalu config.news.<attr>."""
    key = (os.getenv(env_name, "") or "").strip()
    if not key and config is not None:
        news_cfg = getattr(config, "news", None)
        if news_cfg is not None:
            try:
                key = str(getattr(news_cfg, attr, "") or "").strip()
            except Exception:  # noqa: BLE001
                key = ""
    return key


def _news_enabled(config: Any, attr: str) -> bool:
    """Cek flag berita di config.news (default aktif, akses defensif)."""
    if config is None:
        return True
    news_cfg = getattr(config, "news", None)
    if news_cfg is None:
        return True
    try:
        return bool(getattr(news_cfg, attr, True))
    except Exception:  # noqa: BLE001
        return True


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _dedupe_merge(items: list[dict]) -> list[dict]:
    """Gabungkan, dedupe berdasarkan headline, urutkan terbaru dulu, cap 60."""
    seen: set[str] = set()
    out: list[dict] = []
    for item in items:
        key = str(item.get("headline", "")).strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(item)
    out.sort(key=lambda x: str(x.get("publishedAt") or ""), reverse=True)
    return out[:MAX_NEWS]


# ---------------------------------------------------------------------------
# Finnhub
# ---------------------------------------------------------------------------


async def fetch_finnhub(config: Any = None) -> list[dict]:
    """Ambil berita forex dari Finnhub (single call, rate-limit friendly).

    Returns:
        List dict: ``{headline, summary, url, source, publishedAt, sentiment,
        impact, category, pairs}``. Kunci tidak ada / gagal → ``[]``.
    """
    if not _news_enabled(config, "finnhub_enabled"):
        return []
    key = _news_key(config, "FINNHUB_API_KEY", "finnhub_api_key")
    if not key:
        log.info("FINNHUB_API_KEY tidak diisi — sumber berita Finnhub dilewati")
        return []
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.get(FINNHUB_URL, params={"category": "forex", "token": key})
            resp.raise_for_status()
            raw = resp.json()
        if not isinstance(raw, list):
            log.warning(f"Finnhub mengembalikan format tidak terduga: {type(raw).__name__}")
            return []
        out: list[dict] = []
        for item in raw:
            if not isinstance(item, dict) or not item.get("headline"):
                continue
            try:
                dt = datetime.fromtimestamp(int(item.get("datetime", 0)), tz=timezone.utc)
                published = dt.isoformat()
            except (TypeError, ValueError, OSError):
                published = _iso_now()
            out.append(
                {
                    "headline": str(item["headline"])[:250],
                    "summary": str(item.get("summary") or "")[:300],
                    "url": item.get("url") or None,
                    "source": "FINNHUB",
                    "publishedAt": published,
                    "sentiment": _keyword_sentiment(
                        f"{item['headline']} {item.get('summary') or ''}"
                    ),
                    "impact": _impact_from(
                        f"{item['headline']} {item.get('summary') or ''}",
                        _keyword_sentiment(f"{item['headline']} {item.get('summary') or ''}"),
                    ),
                    "category": "MARKET",
                    "pairs": _detect_pairs(
                        f"{item['headline']} {item.get('summary') or ''}",
                        list(KNOWN_PAIRS),
                    ),
                }
            )
        log.info(f"Finnhub: {len(out)} berita forex")
        return out
    except Exception as exc:  # noqa: BLE001 — engine harus tetap hidup
        log.warning(f"Gagal mengambil berita Finnhub: {exc}")
        return []


# ---------------------------------------------------------------------------
# MarketAux
# ---------------------------------------------------------------------------


def _map_marketaux(item: dict) -> dict | None:
    """Petakan satu item MarketAux ke bentuk berita standar."""
    title = item.get("title") or item.get("headline")
    if not title:
        return None
    entities = item.get("entities") or []
    scores = []
    for ent in entities:
        if isinstance(ent, dict):
            try:
                s = float(ent.get("sentiment_score"))
            except (TypeError, ValueError):
                continue
            if -1.0 <= s <= 1.0:
                scores.append(s)
    sentiment = round(sum(scores) / len(scores), 4) if scores else 0.0
    return {
        "headline": str(title)[:250],
        "summary": str(item.get("description") or "")[:300],
        "url": item.get("url") or None,
        "source": "MARKETAUX",
        "publishedAt": str(item.get("published_at") or _iso_now()),
        "sentiment": sentiment,
        "impact": "HIGH" if abs(sentiment) >= 0.35 else "MEDIUM",
        "category": "MARKET",
        "pairs": [str(e.get("symbol")) for e in entities if isinstance(e, dict) and e.get("symbol")][:6],
    }


async def _marketaux_get(client: httpx.AsyncClient, params: dict[str, Any]) -> list[dict]:
    resp = await client.get(MARKETAUX_URL, params=params)
    resp.raise_for_status()
    data = resp.json()
    rows = data.get("data") if isinstance(data, dict) else None
    out: list[dict] = []
    if isinstance(rows, list):
        for item in rows:
            mapped = _map_marketaux(item) if isinstance(item, dict) else None
            if mapped:
                out.append(mapped)
    return out


async def fetch_marketaux(config: Any = None) -> list[dict]:
    """Ambil berita dari MarketAux (varian symbols → fallback tanpa symbols).

    Returns:
        List dict bentuk standar; kunci tidak ada / gagal → ``[]``.
    """
    if not _news_enabled(config, "marketaux_enabled"):
        return []
    key = _news_key(config, "MARKETAUX_API_KEY", "marketaux_api_key")
    if not key:
        log.info("MARKETAUX_API_KEY tidak diisi — sumber berita MarketAux dilewati")
        return []
    symbols = _DEFAULT_SYMBOLS
    if config is not None:
        try:
            cfg_symbols = getattr(getattr(config, "news", None), "symbols", None)
            if isinstance(cfg_symbols, (list, tuple)) and cfg_symbols:
                symbols = ",".join(str(s) for s in cfg_symbols)
            elif isinstance(cfg_symbols, str) and cfg_symbols.strip():
                symbols = cfg_symbols.strip()
        except Exception:  # noqa: BLE001
            pass
    base_params: dict[str, Any] = {
        "filter_entities": "true",
        "language": "en",
        "api_token": key,
        "limit": 50,
    }
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            # 1) percobaan dengan symbols
            try:
                items = await _marketaux_get(client, {**base_params, "symbols": symbols})
                if items:
                    log.info(f"MarketAux: {len(items)} berita (symbols={symbols})")
                    return items
            except Exception as exc:  # noqa: BLE001
                log.debug(f"MarketAux query symbols gagal: {exc}")
            # 2) fallback tanpa symbols (berita pasar umum)
            items = await _marketaux_get(client, base_params)
            log.info(f"MarketAux: {len(items)} berita (tanpa symbols)")
            return items
    except Exception as exc:  # noqa: BLE001
        log.warning(f"Gagal mengambil berita MarketAux: {exc}")
        return []


# ---------------------------------------------------------------------------
# Gabungan
# ---------------------------------------------------------------------------


async def fetch_all(config: Any = None) -> list[dict]:
    """Ambil & gabungkan berita Finnhub + MarketAux (dedupe, sort desc, cap 60)."""
    try:
        results = await asyncio.gather(
            fetch_finnhub(config),
            fetch_marketaux(config),
            return_exceptions=True,
        )
    except Exception as exc:  # noqa: BLE001
        log.warning(f"fetch_all news gagal: {exc}")
        return []
    merged: list[dict] = []
    for res in results:
        if isinstance(res, Exception):
            log.warning(f"Sumber berita error: {res}")
        elif isinstance(res, list):
            merged.extend(res)
    merged = _dedupe_merge(merged)
    log.info(f"Total berita gabungan: {len(merged)}")
    return merged


# ---------------------------------------------------------------------------
# Sentimen
# ---------------------------------------------------------------------------


def _keyword_sentiment(headline: str) -> float:
    """Heuristik kata kunci: hawkish/strong/beat/up → +, dovish/weak/miss/down → −."""
    text = str(headline).lower()
    pos = sum(1 for w in _POSITIVE_WORDS if w in text)
    neg = sum(1 for w in _NEGATIVE_WORDS if w in text)
    score = (pos - neg) / 2.0
    return round(max(-1.0, min(1.0, score)), 4)


async def analyze_sentiment(
    headlines: list[str], provider: str, config: Any = None
) -> list[float]:
    """Skor sentimen (-1..1) per headline: coba AI, fallback heuristik kata kunci.

    Args:
        headlines: daftar headline berita.
        provider:  id provider AI (lihat ``app.ai_providers.PROVIDERS``).
        config:    objek konfigurasi engine (opsional).

    Returns:
        List float sepanjang ``headlines`` (gagal total → heuristik).
    """
    if not headlines:
        return []
    scores: list[float] | None = None
    try:
        numbered = "\n".join(f"{i}. {h}" for i, h in enumerate(headlines[:30], start=1))
        system = (
            "Kamu adalah mesin analisa sentimen berita keuangan. Nilai dampak tiap headline "
            "terhadap instrumen/pair yang disebut atau pasar secara umum: -1.0 (sangat bearish) "
            "sampai 1.0 (sangat bullish). Jawab HANYA dengan array JSON angka "
            f"sebanyak {min(len(headlines), 30)} elemen, tanpa teks lain."
        )
        user = f"Headline berikut:\n{numbered}\n\nJawaban (array JSON angka):"
        text = await ai_chat(provider, system, user, config, timeout=30.0)
        import json as _json

        start, end = text.find("["), text.rfind("]")
        if start != -1 and end > start:
            arr = _json.loads(text[start : end + 1])
            if isinstance(arr, list):
                vals: list[float] = []
                for x in arr:
                    try:
                        v = float(x)
                    except (TypeError, ValueError):
                        v = 0.0
                    vals.append(max(-1.0, min(1.0, v)))
                # samakan panjang dengan headlines
                if len(vals) < len(headlines):
                    vals += [0.0] * (len(headlines) - len(vals))
                scores = vals[: len(headlines)]
    except Exception as exc:  # noqa: BLE001 — fallback heuristik
        log.info(f"Analisa sentimen AI gagal ({exc}) — pakai heuristik kata kunci")
    if scores is None:
        scores = [_keyword_sentiment(h) for h in headlines]
    return scores


# ---------------------------------------------------------------------------
# Kalender ekonomi (deterministik, heuristik — jelas terdokumentasi)
# ---------------------------------------------------------------------------

_MON, _TUE, _WED, _THU, _FRI = 0, 1, 2, 3, 4

_FOMC_MONTHS = {1, 3, 5, 6, 7, 9, 11, 12}
_ECB_MONTHS = {1, 3, 4, 6, 7, 9, 10, 12}
_BOJ_MONTHS = {1, 3, 4, 6, 7, 9, 10, 12}
_BOE_MONTHS = {2, 3, 5, 6, 8, 9, 11, 12}
_GDP_MONTHS = {1, 4, 7, 10}


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    """Tanggal weekday ke-n dalam bulan (n=1 → pertama)."""
    d = date(year, month, 1)
    offset = (weekday - d.weekday()) % 7
    return d + timedelta(days=offset + 7 * (n - 1))


def _evt(
    kind: str, title: str, currency: str, impact: str, dt: datetime,
    fc: str, pv: str,
) -> dict:
    """Bentuk satu event kalender standar."""
    return {
        "id": f"{kind}-{dt:%Y%m%d%H%M}",
        "title": title,
        "currency": currency,
        "impact": impact,
        "time": dt.isoformat().replace("+00:00", "Z"),
        "actual": None,
        "forecast": fc,
        "previous": pv,
    }


def _rng_for(kind: str, day: date) -> random.Random:
    """RNG deterministik per (jenis event, tanggal)."""
    return random.Random(f"finex-{kind}-{day:%Y%m%d}")


def _events_for_date(d: date) -> list[tuple[datetime, dict]]:
    """Semua event besar yang jatuh pada tanggal ``d`` (heuristik terdokumentasi)."""
    y, m = d.year, d.month
    events: list[tuple[datetime, dict]] = []

    def at(h: int, minute: int = 0) -> datetime:
        return datetime.combine(d, time(h, minute), tzinfo=timezone.utc)

    # NFP + Unemployment Rate — Jumat pertama 13:30 UTC
    if d == _nth_weekday(y, m, _FRI, 1):
        rng = _rng_for("nfp", d)
        events.append(
            (
                at(13, 30),
                _evt("nfp", "Non-Farm Payrolls", "USD", "HIGH", at(13, 30),
                     f"{rng.randint(120, 320)}K", f"{rng.randint(120, 320)}K"),
            )
        )
        rng2 = _rng_for("unemp", d)
        events.append(
            (
                at(13, 30),
                _evt("unemp", "Unemployment Rate", "USD", "HIGH", at(13, 30),
                     f"{rng2.uniform(3.8, 4.6):.1f}%", f"{rng2.uniform(3.8, 4.6):.1f}%"),
            )
        )
    # CPI — pertengahan bulan (tgl 12) 13:30 UTC
    if d.day == 12:
        rng = _rng_for("cpi", d)
        events.append(
            (
                at(13, 30),
                _evt("cpi", "CPI y/y", "USD", "HIGH", at(13, 30),
                     f"{rng.uniform(2.4, 3.8):.1f}%", f"{rng.uniform(2.4, 3.8):.1f}%"),
            )
        )
    # PPI — tgl 15, 13:30 UTC
    if d.day == 15:
        rng = _rng_for("ppi", d)
        events.append(
            (
                at(13, 30),
                _evt("ppi", "PPI m/m", "USD", "MEDIUM", at(13, 30),
                     f"{rng.uniform(-0.1, 0.6):.1f}%", f"{rng.uniform(-0.1, 0.6):.1f}%"),
            )
        )
    # Retail Sales — tgl 16, 13:30 UTC
    if d.day == 16:
        rng = _rng_for("retail", d)
        events.append(
            (
                at(13, 30),
                _evt("retail", "Retail Sales m/m", "USD", "MEDIUM", at(13, 30),
                     f"{rng.uniform(-0.3, 0.8):.1f}%", f"{rng.uniform(-0.3, 0.8):.1f}%"),
            )
        )
    # ISM Manufacturing PMI — tgl 3, 15:00 UTC
    if d.day == 3:
        rng = _rng_for("pmi", d)
        events.append(
            (
                at(15, 0),
                _evt("pmi", "ISM Manufacturing PMI", "USD", "MEDIUM", at(15, 0),
                     f"{rng.uniform(47.0, 53.0):.1f}", f"{rng.uniform(47.0, 53.0):.1f}"),
            )
        )
    # GDP kuartalan — tgl 27 bulan Jan/Apr/Jul/Okt, 13:30 UTC
    if d.day == 27 and m in _GDP_MONTHS:
        rng = _rng_for("gdp", d)
        events.append(
            (
                at(13, 30),
                _evt("gdp", "GDP q/q (Advance)", "USD", "HIGH", at(13, 30),
                     f"{rng.uniform(1.2, 3.2):.1f}%", f"{rng.uniform(1.2, 3.2):.1f}%"),
            )
        )
    # FOMC — Rabu ke-3 bulan tertentu, 19:00 UTC (±8 rapat/tahun)
    if m in _FOMC_MONTHS and d == _nth_weekday(y, m, _WED, 3):
        rng = _rng_for("fomc", d)
        rate = f"{rng.uniform(4.25, 5.5):.2f}%"
        events.append(
            (
                at(19, 0),
                _evt("fomc", "FOMC Statement & Rate Decision", "USD", "HIGH", at(19, 0),
                     rate, f"{rng.uniform(4.25, 5.5):.2f}%"),
            )
        )
    # ECB — Kamis ke-2, 12:45 UTC
    if m in _ECB_MONTHS and d == _nth_weekday(y, m, _THU, 2):
        rng = _rng_for("ecb", d)
        events.append(
            (
                at(12, 45),
                _evt("ecb", "ECB Rate Decision", "EUR", "HIGH", at(12, 45),
                     f"{rng.uniform(2.75, 4.25):.2f}%", f"{rng.uniform(2.75, 4.25):.2f}%"),
            )
        )
    # BoJ — Rabu ke-3, 03:00 UTC (± tengah hari JST)
    if m in _BOJ_MONTHS and d == _nth_weekday(y, m, _WED, 3):
        rng = _rng_for("boj", d)
        events.append(
            (
                at(3, 0),
                _evt("boj", "BoJ Policy Rate", "JPY", "HIGH", at(3, 0),
                     f"{rng.uniform(0.0, 0.5):.2f}%", f"{rng.uniform(0.0, 0.5):.2f}%"),
            )
        )
    # BoE — Kamis ke-3, 12:00 UTC
    if m in _BOE_MONTHS and d == _nth_weekday(y, m, _THU, 3):
        rng = _rng_for("boe", d)
        events.append(
            (
                at(12, 0),
                _evt("boe", "BoE Bank Rate", "GBP", "HIGH", at(12, 0),
                     f"{rng.uniform(4.0, 5.25):.2f}%", f"{rng.uniform(4.0, 5.25):.2f}%"),
            )
        )
    # RBA — Selasa ke-1 (kecuali Januari), 04:30 UTC
    if m != 1 and d == _nth_weekday(y, m, _TUE, 1):
        rng = _rng_for("rba", d)
        events.append(
            (
                at(4, 30),
                _evt("rba", "RBA Cash Rate", "AUD", "HIGH", at(4, 30),
                     f"{rng.uniform(3.85, 4.75):.2f}%", f"{rng.uniform(3.85, 4.75):.2f}%"),
            )
        )
    return events


def economic_calendar(days: int = 3) -> list[dict]:
    """Kalender ekonomi event besar untuk ``days`` hari ke depan (deterministik).

    Args:
        days: jumlah hari ke depan yang discan (1–14, default 3).

    Returns:
        List ``{id, title, currency, impact, time (ISO UTC), actual: None,
        forecast, previous}`` terurut naik berdasarkan waktu.
    """
    try:
        days = max(1, min(int(days), 14))
    except (TypeError, ValueError):
        days = 3
    now = datetime.now(timezone.utc)
    events: list[tuple[datetime, dict]] = []
    for offset in range(0, days + 1):
        d = (now + timedelta(days=offset)).date()
        try:
            events.extend(_events_for_date(d))
        except Exception as exc:  # noqa: BLE001
            log.warning(f"Gagal membuat event kalender untuk {d}: {exc}")
    events = [(dt, e) for dt, e in events if dt >= now]
    events.sort(key=lambda x: x[0])
    return [e for _dt, e in events][:50]


__all__ = [
    "fetch_finnhub",
    "fetch_marketaux",
    "fetch_all",
    "analyze_sentiment",
    "economic_calendar",
]
