# -*- coding: utf-8 -*-
"""app.strategy — mesin keputusan trading (teknikal + ML + AI provider).

Dua pintu masuk dengan bentuk hasil yang SAMA (camelCase untuk dashboard):

    * :func:`quick_analysis` — heuristik murni, tanpa jaringan (cepat).
      Voting berbobot indikator (bobot hasil belajar dari ML) → normalisasi
      −100..100 → digabung prediksi ML (60% teknikal / 40% ML).
    * :func:`analyze`       — seperti quick_analysis + panggilan AI provider
      (prompt fundamental + ringkasan indikator, jawaban JSON) → blend 50/50.
      Gagal → fallback hasil quick_analysis dengan ``live=False``.

Bentuk hasil (AnalysisResult dashboard):
    {pair, timeframe, signal, confidence, score, entry, stopLoss, takeProfit,
     stopLossPips, takeProfitPips, reasoning, fundamentals, indicators,
     newsSentiment, ml, provider, providerLabel, live, createdAt}
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import numpy as np
import pandas as pd

try:
    from .ai_providers import PROVIDERS, ai_chat
    from .fundamental import build_fundamental_prompt, parse_ai_json
    from .indicators import (
        DEFAULT_IDS,
        INDICATOR_IDS,
        INDICATOR_META,
        compute_indicators,
        signal_number,
    )
    from .ml_model import MLModel
except ImportError:  # pragma: no cover
    from app.ai_providers import PROVIDERS, ai_chat  # type: ignore
    from app.fundamental import build_fundamental_prompt, parse_ai_json  # type: ignore
    from app.indicators import (  # type: ignore
        DEFAULT_IDS,
        INDICATOR_IDS,
        INDICATOR_META,
        compute_indicators,
        signal_number,
    )
    from app.ml_model import MLModel  # type: ignore


def _get_logger() -> logging.Logger:
    """Ambil logger aplikasi (fallback aman bila app.logger belum tersedia)."""
    for loader in ("relative", "absolute"):
        try:
            if loader == "relative":
                from .logger import get_logger  # type: ignore
            else:
                from app.logger import get_logger  # type: ignore
            try:
                return get_logger("strategy")  # type: ignore[call-arg]
            except TypeError:
                return get_logger()  # type: ignore[call-arg]
        except Exception:
            continue
    lg = logging.getLogger("finex.strategy")
    if not lg.handlers:
        h = logging.StreamHandler()
        h.setFormatter(logging.Formatter("[%(asctime)s] %(levelname)s %(name)s: %(message)s"))
        lg.addHandler(h)
        lg.setLevel(logging.INFO)
    return lg


log = _get_logger()

#: Ukuran 1 pip per pair (kontrak FINEX).
PIP_SIZES: dict[str, float] = {
    "EURUSD": 0.0001,
    "GBPUSD": 0.0001,
    "AUDUSD": 0.0001,
    "NZDUSD": 0.0001,
    "USDCHF": 0.0001,
    "USDCAD": 0.0001,
    "EURGBP": 0.0001,
    "EURCHF": 0.0001,
    "EURAUD": 0.0001,
    "GBPCHF": 0.0001,
    "USDJPY": 0.01,
    "EURJPY": 0.01,
    "GBPJPY": 0.01,
    "AUDJPY": 0.01,
    "CADJPY": 0.01,
    "CHFJPY": 0.01,
    "XAUUSD": 0.1,
    "XAGUSD": 0.01,
}
_DEFAULT_PIP = 0.0001

#: Jumlah digit harga per pair (untuk pembulatan entry/SL/TP).
DIGITS: dict[str, int] = {
    "EURUSD": 5,
    "GBPUSD": 5,
    "AUDUSD": 5,
    "NZDUSD": 5,
    "USDCHF": 5,
    "USDCAD": 5,
    "EURGBP": 5,
    "EURCHF": 5,
    "EURAUD": 5,
    "GBPCHF": 5,
    "USDJPY": 3,
    "EURJPY": 3,
    "GBPJPY": 3,
    "AUDJPY": 3,
    "CADJPY": 3,
    "CHFJPY": 3,
    "XAUUSD": 2,
    "XAGUSD": 3,
}

#: Rentang SL yang diizinkan (pips) sesuai money management FINEX.
_SL_MIN, _SL_MAX = 5, 15

#: Bobot blend quick_analysis: 60% skor teknikal, 40% probabilitas ML.
_TECH_WEIGHT, _ML_WEIGHT = 0.6, 0.4
#: Bobot blend analyze: 50% heuristik lokal, 50% skor AI.
_LOCAL_WEIGHT, _AI_WEIGHT = 0.5, 0.5

#: Ambang sinyal pada skor -100..100.
_THRESHOLD_STRONG = 60
_THRESHOLD_PLAIN = 25

_SIGNAL_SCORES: dict[str, float] = {
    "STRONG_BUY": 90.0,
    "BUY": 45.0,
    "NEUTRAL": 0.0,
    "SELL": -45.0,
    "STRONG_SELL": -90.0,
}

_SIGNAL_TEXT_ID: dict[str, str] = {
    "STRONG_BUY": "STRONG BUY — sinyal beli kuat",
    "BUY": "BUY — sinyal beli",
    "NEUTRAL": "NEUTRAL — tunggu konfirmasi",
    "SELL": "SELL — sinyal jual",
    "STRONG_SELL": "STRONG SELL — sinyal jual kuat",
}


# ---------------------------------------------------------------------------
# Helper akses config / state (defensif — boleh None / atribut kurang)
# ---------------------------------------------------------------------------


def _cfg(config: Any, section: str, attr: str, default: Any) -> Any:
    """Baca config.<section>.<attr> dengan default bila tidak ada."""
    if config is None:
        return default
    sec = getattr(config, section, None)
    if sec is None:
        return default
    try:
        val = getattr(sec, attr, default)
    except Exception:  # noqa: BLE001
        return default
    return default if val is None else val


def _indicator_names(config: Any) -> list[str]:
    """Daftar id indikator dari config (mode ai → semua 30, else list/default)."""
    mode = str(_cfg(config, "indicators", "mode", "manual") or "manual").lower()
    if mode == "ai":
        return list(INDICATOR_IDS)
    raw = _cfg(config, "indicators", "list", None)
    if isinstance(raw, (list, tuple)) and raw:
        ids = [str(x).strip().lower() for x in raw if str(x).strip()]
        ids = [i for i in ids if i in INDICATOR_META]
        if ids:
            return ids
    return list(DEFAULT_IDS)


def _state_news(state: Any) -> list[dict]:
    """Berita dari state (akses defensif)."""
    if state is None:
        return []
    news = getattr(state, "news", None)
    if isinstance(news, list):
        return [n for n in news if isinstance(n, dict) and n.get("headline")][:30]
    return []


def _state_calendar(state: Any) -> list[dict]:
    """Kalender ekonomi dari state (akses defensif)."""
    if state is None:
        return []
    cal = getattr(state, "calendar", None)
    if isinstance(cal, list):
        return [e for e in cal if isinstance(e, dict)][:30]
    return []


def _news_sentiment(state: Any, pair: str | None = None) -> float:
    """Rata-rata sentimen berita terkini (−1..1, defensif).

    Bila ``pair`` diisi, berita yang ditandai pair tersebut diprioritaskan;
    fallback ke seluruh berita bila tag spesifik kurang dari 3 item.
    """
    news = _state_news(state)
    if not news:
        return 0.0
    if pair:
        p = str(pair).upper()
        tagged = [
            n
            for n in news[:40]
            if any(str(s).upper() == p for s in (n.get("pairs") or []) if isinstance(s, str))
        ]
        if len(tagged) >= 3:
            news = tagged
    vals: list[float] = []
    for n in news[:20]:
        try:
            v = float(n.get("sentiment") or 0.0)
            if np.isfinite(v):
                vals.append(max(-1.0, min(1.0, v)))
        except (TypeError, ValueError):
            continue
    if not vals:
        return 0.0
    return round(sum(vals) / len(vals), 4)


def _provider_id(config: Any) -> str:
    """Id provider AI dari config (divalidasi terhadap registry)."""
    pid = str(_cfg(config, "ai", "provider", "zai") or "zai").strip().lower()
    return pid if pid in PROVIDERS else "zai"


def _provider_label(provider: str) -> str:
    return str(PROVIDERS.get(provider, {}).get("name", provider.upper()))


def _score_to_signal(score: float) -> str:
    """Ambang sinyal: |skor|≥60 STRONG, ≥25 plain, else NEUTRAL."""
    if score >= _THRESHOLD_STRONG:
        return "STRONG_BUY"
    if score >= _THRESHOLD_PLAIN:
        return "BUY"
    if score <= -_THRESHOLD_STRONG:
        return "STRONG_SELL"
    if score <= -_THRESHOLD_PLAIN:
        return "SELL"
    return "NEUTRAL"


def _sl_pips(config: Any, atr_value: float, symbol: str) -> int:
    """SL dalam pips: config (5–15) atau turunan ATR (clamp 5–15)."""
    raw = _cfg(config, "risk", "stop_loss_pips", 10)
    try:
        sl = int(round(float(raw)))
    except (TypeError, ValueError):
        sl = 10
    if _SL_MIN <= sl <= _SL_MAX:
        return sl
    # fallback: SL berbasis ATR (ATR14 dalam harga → pips) di-clamp 5..15
    pip = PIP_SIZES.get(str(symbol).upper(), _DEFAULT_PIP)
    try:
        atr_pips = float(atr_value) / pip if pip > 0 else 10.0
    except (TypeError, ValueError):
        atr_pips = 10.0
    if not np.isfinite(atr_pips) or atr_pips <= 0:
        return 10
    return int(max(_SL_MIN, min(_SL_MAX, round(atr_pips))))


def _levels(symbol: str, entry: float, side: str, sl_pips: float, tp_pips: float) -> tuple[float, float]:
    """Hitung harga SL/TP dari arah posisi."""
    pip = PIP_SIZES.get(str(symbol).upper(), _DEFAULT_PIP)
    digits = DIGITS.get(str(symbol).upper(), 5)
    if side == "SELL":
        sl = entry + sl_pips * pip
        tp = entry - tp_pips * pip
    else:
        sl = entry - sl_pips * pip
        tp = entry + tp_pips * pip
    return round(sl, digits), round(tp, digits)


def _heuristic_fundamentals(state: Any, symbol: str) -> list[dict]:
    """Blok fundamental dari berita state (tanpa jaringan)."""
    blocks: list[dict] = []
    for n in _state_news(state)[:3]:
        try:
            s = float(n.get("sentiment") or 0.0)
        except (TypeError, ValueError):
            s = 0.0
        label = "BULLISH" if s > 0.15 else "BEARISH" if s < -0.15 else "NEUTRAL"
        blocks.append(
            {
                "title": str(n.get("headline") or "Berita pasar")[:90],
                "content": str(n.get("summary") or n.get("headline") or "")[:240],
                "sentiment": label,
            }
        )
    if not blocks:
        blocks.append(
            {
                "title": "Fundamental",
                "content": f"Belum ada data berita terkini untuk {symbol}; "
                "analisa mengandalkan sisi teknikal.",
                "sentiment": "NEUTRAL",
            }
        )
    return blocks


def _top_contributors(entries: list[dict], k: int = 3) -> list[dict]:
    """Indikator penyumbang sinyal terbesar (|bobot × arah|)."""
    voters = [e for e in entries if e["signal"] != "NEUTRAL"]
    voters.sort(key=lambda e: abs(e["weight"]), reverse=True)
    return voters[:k]


# ---------------------------------------------------------------------------
# quick_analysis — heuristik lokal, tanpa jaringan
# ---------------------------------------------------------------------------


def quick_analysis(
    symbol: str,
    timeframe: str,
    df: pd.DataFrame,
    config: Any,
    ml: MLModel | None,
    state: Any,
) -> dict:
    """Analisa cepat berbasis voting indikator berbobot + prediksi ML.

    Args:
        symbol:    pair, mis. "EURUSD".
        timeframe: timeframe string, mis. "M15".
        df:        DataFrame candle (time, open, high, low, close, tick_volume).
        config:    objek konfigurasi engine (bisa None).
        ml:        instance :class:`~app.ml_model.MLModel` (bisa None).
        state:     objek state engine (news/calendar, akses defensif).

    Returns:
        Dict bentuk AnalysisResult (lihat modul docstring) — ``live=False``.
    """
    sym = str(symbol or "").upper()
    names = _indicator_names(config)
    # "atr" selalu dihitung untuk penentuan SL berbasis volatilitas
    calc_names = list(dict.fromkeys(names + ["atr"]))
    results = compute_indicators(df, calc_names)

    weights: dict[str, float] = (
        ml.indicator_weights() if ml is not None else {i: 1.0 for i in INDICATOR_IDS}
    )
    entries: list[dict] = []
    acc = 0.0
    total_w = 0.0
    for nid in names:
        r = results.get(nid)
        if r is None:
            continue
        w = float(weights.get(nid, 1.0))
        s = signal_number(r)
        acc += w * s
        total_w += w
        meta = INDICATOR_META.get(nid, {"name": nid.upper(), "category": "—"})
        entries.append(
            {
                "id": nid,
                "name": meta["name"],
                "category": meta["category"],
                "value": r.display,
                "signal": r.signal,
                "weight": round(w, 2),
            }
        )
    tech_score = float(np.clip(100.0 * acc / total_w, -100.0, 100.0)) if total_w > 0 else 0.0

    # ML
    features = ml.features(df) if ml is not None else np.zeros(38)
    prob, ml_label = ml.predict(features) if ml is not None else (0.5, "NEUTRAL")
    ml_stats = ml.stats() if ml is not None else {
        "samples": 0, "wins": 0, "losses": 0, "accuracy": 0.0, "model_version": 1,
    }
    ml_score = (float(prob) - 0.5) * 200.0
    score = float(np.clip(_TECH_WEIGHT * tech_score + _ML_WEIGHT * ml_score, -100.0, 100.0))

    signal = _score_to_signal(score)
    confidence = int(min(100.0, round(abs(score))))

    # Level harga
    entry = 0.0
    data_ok = False
    try:
        if df is not None and len(df) > 0 and "close" in df.columns:
            entry = float(pd.to_numeric(df["close"], errors="coerce").iloc[-1])
            data_ok = np.isfinite(entry) and entry > 0
    except Exception:  # noqa: BLE001
        data_ok = False
    if not data_ok:
        entry = 0.0

    atr_val = results.get("atr").value if results.get("atr") is not None else 0.0
    sl_pips = _sl_pips(config, float(atr_val or 0.0), sym)
    try:
        tp_ratio = float(_cfg(config, "risk", "take_profit_ratio", 1.5) or 1.5)
    except (TypeError, ValueError):
        tp_ratio = 1.5
    tp_ratio = max(0.5, min(5.0, tp_ratio))
    tp_pips = round(sl_pips * tp_ratio, 1)

    side = "BUY" if score >= 0 else "SELL"
    digits = DIGITS.get(sym, 5)
    entry_r = round(entry, digits)
    sl_price, tp_price = _levels(sym, entry_r, side, sl_pips, tp_pips)

    news_sent = _news_sentiment(state, sym)
    fundamentals = _heuristic_fundamentals(state, sym)

    # ---- Reasoning (Bahasa Indonesia) ------------------------------------
    parts: list[str] = []
    if not data_ok or (df is None or len(df) < 60):
        parts.append("Data candle kurang dari 60 bar — sinyal belum dapat diandalkan.")
    parts.append(
        f"Voting {len(entries)} indikator teknikal (bobot hasil pembelajaran) "
        f"menghasilkan skor {tech_score:+.0f}/100."
    )
    top = _top_contributors(entries)
    if top:
        kontrib = ", ".join(
            f"{e['name']} ({e['signal']}, bobot {e['weight']:.2f})" for e in top
        )
        parts.append(f"Kontributor utama: {kontrib}.")
    else:
        parts.append("Belum ada konfluensi sinyal yang jelas antar indikator.")
    parts.append(
        f"Model ML memperkirakan probabilitas harga naik {prob * 100:.0f}% "
        f"({ml_label}, {ml_stats['samples']} sampel belajar, akurasi "
        f"{ml_stats['accuracy'] * 100:.0f}%)."
    )
    n_news = len(_state_news(state))
    parts.append(
        f"Sentimen berita {news_sent:+.2f} (dari {n_news} berita terkini)."
    )
    parts.append(
        f"Kesimpulan: {_SIGNAL_TEXT_ID[signal]} dengan keyakinan {confidence}% "
        f"(blend {_TECH_WEIGHT * 100:.0f}% teknikal + {_ML_WEIGHT * 100:.0f}% ML)."
    )
    reasoning = " ".join(parts)

    ml_dict = {
        "probability": round(float(prob), 4),
        "label": ml_label,
        "samples": int(ml_stats.get("samples", 0)),
        "accuracy": round(float(ml_stats.get("accuracy", 0.0)), 4),
        "modelVersion": int(ml_stats.get("model_version", 1)),
    }

    provider = _provider_id(config)
    return {
        "pair": sym,
        "timeframe": str(timeframe or "M15"),
        "signal": signal,
        "confidence": confidence,
        "score": int(round(score)),
        "entry": entry_r,
        "stopLoss": sl_price,
        "takeProfit": tp_price,
        "stopLossPips": int(sl_pips),
        "takeProfitPips": float(tp_pips),
        "reasoning": reasoning,
        "fundamentals": fundamentals,
        "indicators": entries,
        "newsSentiment": news_sent,
        "ml": ml_dict,
        "mlPrediction": dict(ml_dict),  # alias untuk dashboard
        "provider": provider,
        "providerLabel": _provider_label(provider),
        "live": False,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------------------
# analyze — + panggilan AI provider
# ---------------------------------------------------------------------------


def _indicator_prompt(result: dict) -> str:
    """Ringkasan indikator (untuk prompt AI)."""
    lines = []
    for e in result.get("indicators", []):
        lines.append(
            f"- {e.get('name')} [{e.get('category')}] = {e.get('value')} → "
            f"{e.get('signal')} (bobot {e.get('weight')})"
        )
    return "\n".join(lines) if lines else "- (tidak ada indikator)"


def _validate_ai_fundamentals(raw: Any) -> list[dict]:
    """Validasi & bentuk blok fundamental dari jawaban AI."""
    out: list[dict] = []
    if not isinstance(raw, list):
        return out
    for f in raw[:6]:
        if not isinstance(f, dict):
            continue
        sentiment = str(f.get("sentiment") or "NEUTRAL").upper()
        if sentiment not in ("BULLISH", "BEARISH", "NEUTRAL"):
            sentiment = "NEUTRAL"
        out.append(
            {
                "title": str(f.get("title") or "Fundamental")[:100],
                "content": str(f.get("content") or "")[:400],
                "sentiment": sentiment,
            }
        )
    return out


async def analyze(
    symbol: str,
    timeframe: str,
    df: pd.DataFrame,
    config: Any,
    ml: MLModel | None,
    state: Any,
) -> dict:
    """Analisa penuh: heuristik lokal + AI provider (blend 50/50).

    Gagal memanggil AI → hasil quick_analysis dengan ``live=False`` dan
    catatan di reasoning (engine tidak pernah crash).
    """
    result = quick_analysis(symbol, timeframe, df, config, ml, state)
    provider = result["provider"]

    try:
        news_items = _state_news(state)
        calendar = _state_calendar(state)
        prompt = build_fundamental_prompt(symbol, news_items, calendar)
        prompt += "\n\nRINGKASAN TEKNIKAL (indikator berbobot, evaluasi bar terakhir):\n"
        prompt += _indicator_prompt(result)
        prompt += (
            f"\nSkor teknikal lokal: {result['score']:+d}/100 "
            f"(sinyal heuristik: {result['signal']}).\n"
            f"Probabilitas ML harga naik: {result['ml']['probability'] * 100:.0f}% "
            f"({result['ml']['samples']} sampel belajar).\n"
            f"Sentimen berita terkini: {result['newsSentiment']:+.2f}.\n"
        )
        prompt += (
            "\nGabungkan analisa fundamental di atas dengan ringkasan teknikal ini, "
            "lalu jawab HANYA dengan JSON valid berformat: "
            '{"signal": "STRONG_BUY|BUY|NEUTRAL|SELL|STRONG_SELL", "confidence": <0-100>, '
            '"reasoning": "<narasi Bahasa Indonesia 2-5 kalimat>", '
            '"fundamentals": [{"title", "content", "sentiment": "BULLISH|BEARISH|NEUTRAL"}]}'
        )
        system = (
            "Kamu adalah analis trading forex & gold profesional senior dengan pengalaman "
            "15 tahun di pasar ritel Indonesia. Kamu disiplin manajemen risiko dan selalu "
            "menjawab dalam format JSON yang diminta."
        )
        text = await ai_chat(provider, system, prompt, config, timeout=45.0)
        data = parse_ai_json(text)

        ai_signal = str(data.get("signal") or "NEUTRAL").upper()
        if ai_signal not in _SIGNAL_SCORES:
            ai_signal = "NEUTRAL"
        try:
            ai_conf = float(data.get("confidence"))
        except (TypeError, ValueError):
            ai_conf = 50.0
        ai_conf = max(0.0, min(100.0, ai_conf))
        ai_score = _SIGNAL_SCORES[ai_signal] * (ai_conf / 100.0)

        local_score = float(result["score"])
        final = float(np.clip(_LOCAL_WEIGHT * local_score + _AI_WEIGHT * ai_score, -100.0, 100.0))
        final_signal = _score_to_signal(final)
        final_conf = int(min(100.0, round(abs(final))))

        side = "BUY" if final >= 0 else "SELL"
        sl_price, tp_price = _levels(
            symbol, float(result["entry"]), side,
            float(result["stopLossPips"]), float(result["takeProfitPips"]),
        )

        ai_reasoning = str(data.get("reasoning") or "").strip()
        fundamentals = _validate_ai_fundamentals(data.get("fundamentals"))
        if not ai_reasoning:
            ai_reasoning = result["reasoning"]
        if not fundamentals:
            fundamentals = result["fundamentals"]

        result.update(
            {
                "signal": final_signal,
                "confidence": final_conf,
                "score": int(round(final)),
                "stopLoss": sl_price,
                "takeProfit": tp_price,
                "reasoning": ai_reasoning,
                "fundamentals": fundamentals,
                "live": True,
            }
        )
        log.info(
            f"Analisa AI '{provider}' {symbol} {timeframe}: lokal {local_score:+.0f} + "
            f"AI {ai_score:+.0f} → {final_signal} ({final_conf}%)"
        )
        return result
    except Exception as exc:  # noqa: BLE001 — fallback analisa lokal
        log.warning(f"Analisa AI gagal untuk {symbol} ({provider}): {exc} — fallback lokal")
        result["live"] = False
        note = f"⚠️ Provider AI tidak merespons ({exc}) — hasil di atas murni analisa lokal."
        result["reasoning"] = f"{result['reasoning']} {note}"
        return result


__all__ = ["quick_analysis", "analyze", "PIP_SIZES", "DIGITS"]
