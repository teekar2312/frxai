# -*- coding: utf-8 -*-
"""app.indicators — 30 indikator teknikal murni pandas/numpy (TANPA TA-Lib).

Kontrak DataFrame input (baris terlama → terbaru):
    kolom: ``time, open, high, low, close, tick_volume``
    (kolom ``time`` tidak wajib dipakai oleh indikator; ``tick_volume``
    opsional — akan digantikan nilai 1.0 bila tidak ada).

API publik:
    * :class:`IndicatorResult`   — value, signal ("BUY"/"SELL"/"NEUTRAL"), display.
    * :func:`compute_indicators` — evaluasi indikator pada bar TERAKHIR.
    * :func:`indicator_series`   — hasil lengkap per bar (nilai + sinyal).
    * :func:`indicator_signal_series` — deret sinyal per bar (untuk backtest;
      bebas lookahead: nilai di bar *i* hanya memakai data ≤ *i*).
    * :data:`INDICATOR_IDS`      — 30 id indikator.
    * :data:`INDICATOR_META`     — id → {name, category} (selaras dashboard).
    * :func:`signal_number`      — BUY=1, SELL=-1, NEUTRAL=0.

Aturan sinyal (sengaja sederhana & konsisten antar modul):
    ema         EMA12>EMA26 & close>EMA12 → BUY (kebalikannya SELL)
    sma         close vs SMA20
    hma         kemiringan HMA21 (3 bar terakhir)
    supertrend  arah ATR(10)×3 flip
    psar        SAR di bawah harga → BUY
    ichimoku    tenkan9>kijun26 & close> tengah cloud
    linreg      kemiringan regresi linear 50 bar
    macd        histogram>0 & naik → BUY
    rsi         <30 BUY, >70 SELL
    stoch       %K<20 BUY, >80 SELL
    cci         <-100 BUY, >100 SELL
    momentum    tanda MOM10
    williamsr   <-80 BUY, >-20 SELL
    tsi         tanda TSI(25,13)
    roc         tanda ROC12
    stc         <25 BUY, >75 SELL
    uo          <30 BUY, >70 SELL
    bollinger   close<lower BUY / >upper SELL (mean-reversion)
    atr         NEUTRAL (display volatilitas)
    keltner     close vs EMA20±1.5×ATR10 (mean-reversion)
    donchian    close dekat high-20 → BUY breakout (dekat low-20 → SELL)
    stddev      NEUTRAL (display)
    chaikin     NEUTRAL (display)
    volratio    TR/ATR14>1.5 → ikuti arah candle terakhir
    vwap        close vs VWAP (rolling 100 bar)
    obv         kemiringan OBV 20 bar
    mfi         <20 BUY, >80 SELL
    tickvol     lonjakan volume >2× rata-rata → arah candle terakhir
    volumeprofile close vs POC (10 bucket, 100 bar)
    ad          kemiringan Accumulation/Distribution 20 bar

Pengaman: <60 bar → semua NEUTRAL; tidak ada pembagian nol; semua kalkulasi
dibungkus try/except supaya modul analisa tidak pernah menjatuhkan engine.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Metadata 30 indikator — selaras dengan src/lib/constants.ts (dashboard)
# ---------------------------------------------------------------------------

INDICATOR_META: dict[str, dict[str, str]] = {
    # Trend (7)
    "ema": {"name": "EMA", "category": "Trend"},
    "sma": {"name": "SMA", "category": "Trend"},
    "hma": {"name": "Hull MA", "category": "Trend"},
    "supertrend": {"name": "Supertrend", "category": "Trend"},
    "psar": {"name": "Parabolic SAR", "category": "Trend"},
    "ichimoku": {"name": "Ichimoku Cloud", "category": "Trend"},
    "linreg": {"name": "Linear Reg. Channel", "category": "Trend"},
    # Momentum (10)
    "macd": {"name": "MACD", "category": "Momentum"},
    "rsi": {"name": "RSI", "category": "Momentum"},
    "stoch": {"name": "Stochastic", "category": "Momentum"},
    "cci": {"name": "CCI", "category": "Momentum"},
    "momentum": {"name": "Momentum", "category": "Momentum"},
    "williamsr": {"name": "Williams %R", "category": "Momentum"},
    "tsi": {"name": "True Strength Index", "category": "Momentum"},
    "roc": {"name": "Rate of Change", "category": "Momentum"},
    "stc": {"name": "Schaff Trend Cycle", "category": "Momentum"},
    "uo": {"name": "Ultimate Oscillator", "category": "Momentum"},
    # Volatility (7)
    "bollinger": {"name": "Bollinger Bands", "category": "Volatility"},
    "atr": {"name": "ATR", "category": "Volatility"},
    "keltner": {"name": "Keltner Channel", "category": "Volatility"},
    "donchian": {"name": "Donchian Channel", "category": "Volatility"},
    "stddev": {"name": "Standard Deviation", "category": "Volatility"},
    "chaikin": {"name": "Chaikin Volatility", "category": "Volatility"},
    "volratio": {"name": "Volatility Ratio", "category": "Volatility"},
    # Volume (6)
    "vwap": {"name": "VWAP", "category": "Volume"},
    "obv": {"name": "On Balance Volume", "category": "Volume"},
    "mfi": {"name": "Money Flow Index", "category": "Volume"},
    "tickvol": {"name": "Tick Volume", "category": "Volume"},
    "volumeprofile": {"name": "Volume Profile", "category": "Volume"},
    "ad": {"name": "Accumulation/Dist", "category": "Volume"},
}

INDICATOR_IDS: list[str] = list(INDICATOR_META)

#: Set default (~20) saat ``names=None`` — sama dengan DEFAULT_SETTINGS dashboard.
DEFAULT_IDS: list[str] = [
    "ema", "rsi", "macd", "atr", "bollinger", "supertrend", "stoch", "vwap",
    "obv", "cci", "williamsr", "momentum", "psar", "sma", "donchian", "mfi",
    "roc", "stddev", "ad", "tickvol",
]

_SIGNAL_NAMES = {1: "BUY", 0: "NEUTRAL", -1: "SELL"}

#: Jumlah bar minimum agar indikator dievaluasi (di bawah ini semua NEUTRAL).
MIN_BARS = 60


# ---------------------------------------------------------------------------
# Wadah hasil
# ---------------------------------------------------------------------------


@dataclass
class IndicatorResult:
    """Hasil evaluasi satu indikator pada bar terakhir."""

    value: float        # nilai numerik utama
    signal: str         # "BUY" | "SELL" | "NEUTRAL"
    display: str        # teks ringkas untuk dashboard


@dataclass
class _SeriesOut:
    """Hasil kalkulasi internal: deret nilai + deret sinyal per bar."""

    values: np.ndarray   # float per bar (NaN saat warm-up)
    signals: np.ndarray  # int8 per bar: -1/0/+1
    display: str         # display untuk bar terakhir


def signal_number(r: IndicatorResult) -> int:
    """Konversi sinyal indikator menjadi angka: BUY=1, SELL=-1, NEUTRAL=0."""
    s = getattr(r, "signal", "NEUTRAL")
    if s == "BUY":
        return 1
    if s == "SELL":
        return -1
    return 0


# ---------------------------------------------------------------------------
# Helper numerik (semua kausal — hanya pakai data ≤ i)
# ---------------------------------------------------------------------------

_OHLCV = tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]


def _prepare(df: pd.DataFrame) -> _OHLCV:
    """Ambil kolom OHLCV sebagai array float (defensif)."""
    def col(name: str) -> np.ndarray:
        if name in df.columns:
            return pd.to_numeric(df[name], errors="coerce").to_numpy(dtype=float)
        return np.full(len(df), np.nan)

    o, h, l, c = col("open"), col("high"), col("low"), col("close")
    if "tick_volume" in df.columns:
        v = pd.to_numeric(df["tick_volume"], errors="coerce").to_numpy(dtype=float)
    elif "volume" in df.columns:
        v = pd.to_numeric(df["volume"], errors="coerce").to_numpy(dtype=float)
    else:
        v = np.ones(len(df))
    v = np.where(np.isfinite(v) & (v > 0), v, 1.0)
    return o, h, l, c, v


def _has_ohlc(df: pd.DataFrame) -> bool:
    if df is None or len(df) == 0:
        return False
    cols = set(df.columns)
    return {"open", "high", "low", "close"}.issubset(cols)


def _sma(a: np.ndarray, n: int) -> np.ndarray:
    return pd.Series(a).rolling(n, min_periods=n).mean().to_numpy(dtype=float)


def _ema(a: np.ndarray, n: int) -> np.ndarray:
    return (
        pd.Series(a)
        .ewm(span=n, adjust=False, min_periods=n, ignore_na=True)
        .mean()
        .to_numpy(dtype=float)
    )


def _rma(a: np.ndarray, n: int) -> np.ndarray:
    """Smoothing Wilder (RMA) — standar RSI/ATR."""
    return (
        pd.Series(a)
        .ewm(alpha=1.0 / n, adjust=False, min_periods=n, ignore_na=True)
        .mean()
        .to_numpy(dtype=float)
    )


def _rmax(a: np.ndarray, n: int) -> np.ndarray:
    return pd.Series(a).rolling(n, min_periods=n).max().to_numpy(dtype=float)


def _rmin(a: np.ndarray, n: int) -> np.ndarray:
    return pd.Series(a).rolling(n, min_periods=n).min().to_numpy(dtype=float)


def _rsum(a: np.ndarray, n: int) -> np.ndarray:
    return pd.Series(a).rolling(n, min_periods=n).sum().to_numpy(dtype=float)


def _rstd(a: np.ndarray, n: int) -> np.ndarray:
    return pd.Series(a).rolling(n, min_periods=n).std(ddof=0).to_numpy(dtype=float)


def _np_shift(a: np.ndarray, k: int) -> np.ndarray:
    """Geser array ke bawah sebanyak k bar (bagian awal jadi NaN)."""
    out = np.full(len(a), np.nan, dtype=float)
    if k < len(a):
        out[k:] = a[: len(a) - k]
    return out


def _roll_slope(a: np.ndarray, n: int) -> np.ndarray:
    """Kemiringan regresi linear trailing-n per bar (via konvolusi — cepat).

    slope_i = Σ (t−t̄)(y−ȳ) / Σ (t−t̄)² untuk jendela [i−n+1 .. i].
    """
    y = np.asarray(a, dtype=float)
    out = np.full(len(y), np.nan)
    if len(y) < n or n < 2:
        return out
    t = np.arange(n, dtype=float)
    tc = t - t.mean()
    denom = float((tc**2).sum())
    if denom <= 0:
        return out
    num = np.convolve(y, tc[::-1], mode="valid")
    out[n - 1:] = num / denom
    return out


def _wma(a: np.ndarray, n: int) -> np.ndarray:
    """Weighted Moving Average linear (untuk Hull MA) via konvolusi."""
    y = np.asarray(a, dtype=float)
    out = np.full(len(y), np.nan)
    if len(y) < n or n < 1:
        return out
    w = np.arange(1, n + 1, dtype=float)
    out[n - 1:] = np.convolve(y, w[::-1], mode="valid") / w.sum()
    return out


def _true_range(h: np.ndarray, l: np.ndarray, c: np.ndarray) -> np.ndarray:
    pc = _np_shift(c, 1)
    pcs = np.where(np.isnan(pc), c, pc)
    return np.maximum(h, pcs) - np.minimum(l, pcs)


def _sig(buy: np.ndarray, sell: np.ndarray) -> np.ndarray:
    """Gabungkan kondisi buy/sell menjadi deret sinyal int8 (NaN→False→0)."""
    b = np.asarray(buy, dtype=bool)
    s = np.asarray(sell, dtype=bool)
    b = b & ~s
    return np.where(b, 1, np.where(s, -1, 0)).astype(np.int8)


def _last_valid(a: np.ndarray) -> float:
    """Nilai finite terakhir dari deret (0.0 bila tidak ada)."""
    if a is None or len(a) == 0:
        return 0.0
    finite = np.isfinite(a)
    if not finite.any():
        return 0.0
    return float(a[np.where(finite)[0][-1]])


def _fmt(v: float) -> str:
    """Format angka harga dengan jumlah desimal adaptif."""
    if v is None or not np.isfinite(v):
        return "—"
    a = abs(v)
    if a >= 100:
        return f"{v:.2f}"
    if a >= 10:
        return f"{v:.3f}"
    if a >= 1:
        return f"{v:.4f}"
    return f"{v:.5f}"


def _diff1(c: np.ndarray) -> np.ndarray:
    """Selisih close bar ini vs bar sebelumnya (bar pertama = 0)."""
    d = np.zeros(len(c), dtype=float)
    if len(c) > 1:
        d[1:] = c[1:] - c[:-1]
    return d


def _stoch_of(x: np.ndarray, n: int) -> np.ndarray:
    """Stochastic dari sebuah deret (dipakai Schaff Trend Cycle)."""
    lo = _rmin(x, n)
    hi = _rmax(x, n)
    rng = hi - lo
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(np.isfinite(rng) & (rng > 0), (x - lo) / rng, 0.5)


# ---------------------------------------------------------------------------
# Kalkulator inti — algoritma iteratif (O(n), tetap cepat untuk 5000 bar)
# ---------------------------------------------------------------------------


def _supertrend_bands(
    h: np.ndarray, l: np.ndarray, c: np.ndarray, atr: np.ndarray, mult: float
) -> tuple[np.ndarray, np.ndarray]:
    """Supertrend klasik (band final + arah); input ATR sudah dihitung."""
    n = len(c)
    ub = (h + l) / 2.0 + mult * atr
    lb = (h + l) / 2.0 - mult * atr
    fub = np.copy(ub)
    flb = np.copy(lb)
    for i in range(1, n):
        if np.isfinite(ub[i]):
            fub[i] = ub[i] if (ub[i] < fub[i - 1] or c[i - 1] > fub[i - 1]) else fub[i - 1]
        if np.isfinite(lb[i]):
            flb[i] = lb[i] if (lb[i] > flb[i - 1] or c[i - 1] < flb[i - 1]) else flb[i - 1]
    dirn = np.ones(n, dtype=np.int8)
    line = np.full(n, np.nan)
    for i in range(1, n):
        if dirn[i - 1] == 1:
            dirn[i] = -1 if (np.isfinite(flb[i]) and c[i] < flb[i]) else 1
        else:
            dirn[i] = 1 if (np.isfinite(fub[i]) and c[i] > fub[i]) else -1
        line[i] = flb[i] if dirn[i] == 1 else fub[i]
    return line, dirn


def _psar(
    h: np.ndarray, l: np.ndarray, af0: float = 0.02, step: float = 0.02, af_max: float = 0.2
) -> tuple[np.ndarray, np.ndarray]:
    """Parabolic SAR standar (iteratif)."""
    n = len(h)
    sar = np.full(n, np.nan)
    dirn = np.zeros(n, dtype=np.int8)
    if n == 0:
        return sar, dirn
    bull = True
    ep = h[0]
    sar_val = l[0]
    af = af0
    sar[0] = sar_val
    dirn[0] = 1
    for i in range(1, n):
        prev = sar_val
        sar_val = prev + af * (ep - prev)
        if bull:
            low_ref = l[i - 2] if i >= 2 else l[i - 1]
            sar_val = min(sar_val, l[i - 1], low_ref)
            if h[i] > ep:
                ep = h[i]
                af = min(af + step, af_max)
            if l[i] < sar_val:  # flip ke bearish
                bull = False
                sar_val = ep
                ep = l[i]
                af = af0
        else:
            high_ref = h[i - 2] if i >= 2 else h[i - 1]
            sar_val = max(sar_val, h[i - 1], high_ref)
            if l[i] < ep:
                ep = l[i]
                af = min(af + step, af_max)
            if h[i] > sar_val:  # flip ke bullish
                bull = True
                sar_val = ep
                ep = h[i]
                af = af0
        sar[i] = sar_val
        dirn[i] = 1 if bull else -1
    return sar, dirn


def _rsi_arr(c: np.ndarray, n: int = 14) -> np.ndarray:
    d = _diff1(c)
    up = np.where(d > 0, d, 0.0)
    dn = np.where(d < 0, -d, 0.0)
    au = _rma(up, n)
    ad = _rma(dn, n)
    out = np.full(len(c), np.nan)
    with np.errstate(invalid="ignore", divide="ignore"):
        valid = np.isfinite(au) & np.isfinite(ad) & (ad > 0)
        out[valid] = 100.0 - 100.0 / (1.0 + au[valid] / ad[valid])
        pure_up = np.isfinite(au) & (ad == 0) & (au > 0)
        out[pure_up] = 100.0
    return out


def _poc_series(tp: np.ndarray, v: np.ndarray, window: int = 100, buckets: int = 10) -> np.ndarray:
    """Point of Control (POC) rolling: 10 bucket harga × volume 100 bar."""
    n = len(tp)
    poc = np.full(n, np.nan)
    if n < window:
        return poc
    for i in range(window - 1, n):
        j = i - window + 1
        tw = tp[j : i + 1]
        vw = v[j : i + 1]
        m = np.isfinite(tw) & np.isfinite(vw)
        if int(m.sum()) < 20:
            continue
        tw2 = tw[m]
        vw2 = vw[m]
        lo = float(tw2.min())
        hi = float(tw2.max())
        if hi <= lo:
            poc[i] = tw2[-1]
            continue
        idx = np.clip(((tw2 - lo) / (hi - lo) * buckets).astype(int), 0, buckets - 1)
        wsum = np.bincount(idx, weights=vw2, minlength=buckets)
        poc[i] = lo + (int(np.argmax(wsum)) + 0.5) * (hi - lo) / buckets
    return poc


# ---------------------------------------------------------------------------
# Kalkulator per indikator — masing-masing mengembalikan _SeriesOut
# ---------------------------------------------------------------------------


def _calc_ema(t: _OHLCV) -> _SeriesOut:
    _o, _h, _l, c, _v = t
    e12 = _ema(c, 12)
    e26 = _ema(c, 26)
    buy = (e12 > e26) & (c > e12)
    sell = (e12 < e26) & (c < e12)
    disp = f"EMA12 {_fmt(_last_valid(e12))} · EMA26 {_fmt(_last_valid(e26))}"
    return _SeriesOut(e12, _sig(buy, sell), disp)


def _calc_sma(t: _OHLCV) -> _SeriesOut:
    _o, _h, _l, c, _v = t
    s20 = _sma(c, 20)
    buy = c > s20
    sell = c < s20
    disp = f"SMA20 {_fmt(_last_valid(s20))}"
    return _SeriesOut(s20, _sig(buy, sell), disp)


def _calc_hma(t: _OHLCV) -> _SeriesOut:
    _o, _h, _l, c, _v = t
    half = _wma(c, 10)
    full = _wma(c, 21)
    raw = 2.0 * half - full
    sqrt_n = max(2, int(round(np.sqrt(21))))
    hma = _wma(raw, sqrt_n)
    slope = hma - _np_shift(hma, 3)
    buy = slope > 0
    sell = slope < 0
    sl_last = _last_valid(slope)
    arah = "naik" if sl_last > 0 else "turun" if sl_last < 0 else "datar"
    disp = f"HMA21 {_fmt(_last_valid(hma))} ({arah})"
    return _SeriesOut(hma, _sig(buy, sell), disp)


def _calc_supertrend(t: _OHLCV) -> _SeriesOut:
    _o, h, l, c, _v = t
    atr10 = _rma(_true_range(h, l, c), 10)
    line, dirn = _supertrend_bands(h, l, c, atr10, 3.0)
    d = int(dirn[-1]) if len(dirn) else 0
    disp = f"{'BULLISH' if d > 0 else 'BEARISH'} @ {_fmt(_last_valid(line))}"
    return _SeriesOut(line, dirn.astype(np.int8), disp)


def _calc_psar(t: _OHLCV) -> _SeriesOut:
    _o, h, l, c, _v = t
    sar, dirn = _psar(h, l)
    d = int(dirn[-1]) if len(dirn) else 0
    disp = f"SAR {_fmt(_last_valid(sar))} ({'di bawah harga' if d > 0 else 'di atas harga'})"
    return _SeriesOut(sar, dirn, disp)


def _calc_ichimoku(t: _OHLCV) -> _SeriesOut:
    _o, h, l, c, _v = t
    tk = (_rmax(h, 9) + _rmin(l, 9)) / 2.0
    kj = (_rmax(h, 26) + _rmin(l, 26)) / 2.0
    span_a = _np_shift((tk + kj) / 2.0, 26)
    span_b = _np_shift((_rmax(h, 52) + _rmin(l, 52)) / 2.0, 26)
    mid = (span_a + span_b) / 2.0
    buy = (tk > kj) & (c > mid)
    sell = (tk < kj) & (c < mid)
    c_last = _last_valid(c)
    mid_last = _last_valid(mid)
    pos = "atas cloud" if c_last > mid_last else "bawah cloud" if c_last < mid_last else "netral"
    disp = f"TK {_fmt(_last_valid(tk))} · KJ {_fmt(_last_valid(kj))} · {pos}"
    return _SeriesOut(tk - kj, _sig(buy, sell), disp)


def _calc_linreg(t: _OHLCV) -> _SeriesOut:
    _o, _h, _l, c, _v = t
    slope = _roll_slope(c, 50)
    buy = slope > 0
    sell = slope < 0
    disp = f"slope {_fmt(_last_valid(slope))}/bar"
    return _SeriesOut(slope, _sig(buy, sell), disp)


def _calc_macd(t: _OHLCV) -> _SeriesOut:
    _o, _h, _l, c, _v = t
    macd = _ema(c, 12) - _ema(c, 26)
    sig_line = _ema(macd, 9)
    hist = macd - sig_line
    prev = _np_shift(hist, 1)
    buy = (hist > 0) & (hist > prev)
    sell = (hist < 0) & (hist < prev)
    disp = f"hist {_last_valid(hist):+.5g}"
    return _SeriesOut(hist, _sig(buy, sell), disp)


def _calc_rsi(t: _OHLCV) -> _SeriesOut:
    _o, _h, _l, c, _v = t
    rsi = _rsi_arr(c, 14)
    buy = rsi < 30
    sell = rsi > 70
    disp = f"{_last_valid(rsi):.1f}"
    return _SeriesOut(rsi, _sig(buy, sell), disp)


def _calc_stoch(t: _OHLCV) -> _SeriesOut:
    _o, h, l, c, _v = t
    ll = _rmin(l, 14)
    hh = _rmax(h, 14)
    rng = hh - ll
    with np.errstate(invalid="ignore", divide="ignore"):
        k = np.where(np.isfinite(rng) & (rng > 0), 100.0 * (c - ll) / rng, 50.0)
    d = _sma(k, 3)
    buy = k < 20
    sell = k > 80
    disp = f"%K {_last_valid(k):.1f} · %D {_last_valid(d):.1f}"
    return _SeriesOut(k, _sig(buy, sell), disp)


def _calc_cci(t: _OHLCV) -> _SeriesOut:
    _o, h, l, c, _v = t
    tp = (h + l + c) / 3.0
    ma = _sma(tp, 20)
    md = (
        pd.Series(tp)
        .rolling(20, min_periods=20)
        .apply(lambda x: float(np.mean(np.abs(x - np.mean(x)))), raw=True)
        .to_numpy(dtype=float)
    )
    with np.errstate(invalid="ignore", divide="ignore"):
        cci = np.where(np.isfinite(md) & (md > 0), (tp - ma) / (0.015 * md), 0.0)
    buy = cci < -100
    sell = cci > 100
    disp = f"{_last_valid(cci):+.0f}"
    return _SeriesOut(cci, _sig(buy, sell), disp)


def _calc_momentum(t: _OHLCV) -> _SeriesOut:
    _o, _h, _l, c, _v = t
    mom = c - _np_shift(c, 10)
    buy = mom > 0
    sell = mom < 0
    disp = f"MOM10 {_last_valid(mom):+.5g}"
    return _SeriesOut(mom, _sig(buy, sell), disp)


def _calc_williamsr(t: _OHLCV) -> _SeriesOut:
    _o, h, l, c, _v = t
    hh = _rmax(h, 14)
    ll = _rmin(l, 14)
    rng = hh - ll
    with np.errstate(invalid="ignore", divide="ignore"):
        wr = np.where(np.isfinite(rng) & (rng > 0), -100.0 * (hh - c) / rng, -50.0)
    buy = wr < -80
    sell = wr > -20
    disp = f"{_last_valid(wr):.1f}"
    return _SeriesOut(wr, _sig(buy, sell), disp)


def _calc_tsi(t: _OHLCV) -> _SeriesOut:
    _o, _h, _l, c, _v = t
    m = _diff1(c)
    num = _ema(_ema(m, 25), 13)
    den = _ema(_ema(np.abs(m), 25), 13)
    with np.errstate(invalid="ignore", divide="ignore"):
        tsi = np.where(np.isfinite(den) & (den > 0), 100.0 * num / den, 0.0)
    buy = tsi > 0
    sell = tsi < 0
    disp = f"TSI {_last_valid(tsi):+.1f}"
    return _SeriesOut(tsi, _sig(buy, sell), disp)


def _calc_roc(t: _OHLCV) -> _SeriesOut:
    _o, _h, _l, c, _v = t
    prev = _np_shift(c, 12)
    with np.errstate(invalid="ignore", divide="ignore"):
        roc = np.where(np.isfinite(prev) & (prev > 0), 100.0 * (c / prev - 1.0), 0.0)
    buy = roc > 0
    sell = roc < 0
    disp = f"ROC12 {_last_valid(roc):+.2f}%"
    return _SeriesOut(roc, _sig(buy, sell), disp)


def _calc_stc(t: _OHLCV) -> _SeriesOut:
    _o, _h, _l, c, _v = t
    m1 = _ema(c, 23) - _ema(c, 50)
    st1 = _stoch_of(m1, 10)
    k1 = _ema(st1, 3)
    d1 = _ema(k1, 3)
    st2 = _stoch_of(d1, 10)
    stc = 100.0 * _ema(st2, 3)
    buy = stc < 25
    sell = stc > 75
    disp = f"STC {_last_valid(stc):.0f}"
    return _SeriesOut(stc, _sig(buy, sell), disp)


def _calc_uo(t: _OHLCV) -> _SeriesOut:
    _o, h, l, c, _v = t
    pc = _np_shift(c, 1)
    pcs = np.where(np.isnan(pc), c, pc)
    bp = c - np.minimum(l, pcs)
    tr = np.maximum(h, pcs) - np.minimum(l, pcs)
    with np.errstate(invalid="ignore", divide="ignore"):
        a7 = np.where(_rsum(tr, 7) > 0, _rsum(bp, 7) / _rsum(tr, 7), np.nan)
        a14 = np.where(_rsum(tr, 14) > 0, _rsum(bp, 14) / _rsum(tr, 14), np.nan)
        a28 = np.where(_rsum(tr, 28) > 0, _rsum(bp, 28) / _rsum(tr, 28), np.nan)
        uo = np.where(
            np.isfinite(a7) & np.isfinite(a14) & np.isfinite(a28),
            100.0 * (4.0 * a7 + 2.0 * a14 + a28) / 7.0,
            50.0,
        )
    buy = uo < 30
    sell = uo > 70
    disp = f"UO {_last_valid(uo):.1f}"
    return _SeriesOut(uo, _sig(buy, sell), disp)


def _calc_bollinger(t: _OHLCV) -> _SeriesOut:
    _o, _h, _l, c, _v = t
    mid = _sma(c, 20)
    sd = _rstd(c, 20)
    upper = mid + 2.0 * sd
    lower = mid - 2.0 * sd
    with np.errstate(invalid="ignore", divide="ignore"):
        z = np.where(np.isfinite(sd) & (sd > 0), (c - mid) / sd, 0.0)
    buy = np.isfinite(lower) & (c < lower)          # mean-reversion: oversold
    sell = np.isfinite(upper) & (c > upper)         # mean-reversion: overbought
    disp = f"z {_last_valid(z):+.1f}σ"
    return _SeriesOut(z, _sig(buy, sell), disp)


def _calc_atr(t: _OHLCV) -> _SeriesOut:
    _o, h, l, c, _v = t
    atr = _rma(_true_range(h, l, c), 14)
    disp = f"ATR14 {_fmt(_last_valid(atr))}"
    return _SeriesOut(atr, np.zeros(len(c), dtype=np.int8), disp)


def _calc_keltner(t: _OHLCV) -> _SeriesOut:
    _o, h, l, c, _v = t
    mid = _ema(c, 20)
    atr10 = _rma(_true_range(h, l, c), 10)
    upper = mid + 1.5 * atr10
    lower = mid - 1.5 * atr10
    with np.errstate(invalid="ignore", divide="ignore"):
        k = np.where(np.isfinite(atr10) & (atr10 > 0), (c - mid) / atr10, 0.0)
    buy = np.isfinite(lower) & (c < lower)          # mean-reversion
    sell = np.isfinite(upper) & (c > upper)
    disp = f"{_last_valid(k):+.1f}×ATR10 dari EMA20"
    return _SeriesOut(k, _sig(buy, sell), disp)


def _calc_donchian(t: _OHLCV) -> _SeriesOut:
    _o, h, l, c, _v = t
    hh = _rmax(h, 20)
    ll = _rmin(l, 20)
    rng = hh - ll
    with np.errstate(invalid="ignore", divide="ignore"):
        pos = np.where(np.isfinite(rng) & (rng > 0), 100.0 * (c - ll) / rng, 50.0)
    buy = np.isfinite(rng) & (rng > 0) & ((hh - c) <= 0.2 * rng)   # dekat high → breakout BUY
    sell = np.isfinite(rng) & (rng > 0) & ((c - ll) <= 0.2 * rng)  # dekat low → breakout SELL
    disp = f"posisi {_last_valid(pos):.0f}% channel-20"
    return _SeriesOut(pos, _sig(buy, sell), disp)


def _calc_stddev(t: _OHLCV) -> _SeriesOut:
    _o, _h, _l, c, _v = t
    sd = _rstd(c, 20)
    disp = f"σ20 {_fmt(_last_valid(sd))}"
    return _SeriesOut(sd, np.zeros(len(c), dtype=np.int8), disp)


def _calc_chaikin(t: _OHLCV) -> _SeriesOut:
    _o, h, l, _c, _v = t
    hl = h - l
    e = _ema(hl, 10)
    e10 = _np_shift(e, 10)
    with np.errstate(invalid="ignore", divide="ignore"):
        ch = np.where(np.isfinite(e10) & (e10 > 0), 100.0 * (e - e10) / e10, 0.0)
    disp = f"Chaikin {_last_valid(ch):+.1f}%"
    return _SeriesOut(ch, np.zeros(len(h), dtype=np.int8), disp)


def _calc_volratio(t: _OHLCV) -> _SeriesOut:
    o, h, l, c, _v = t
    tr = _true_range(h, l, c)
    atr14 = _rma(tr, 14)
    with np.errstate(invalid="ignore", divide="ignore"):
        ratio = np.where(np.isfinite(atr14) & (atr14 > 0), tr / atr14, 0.0)
    spike = ratio > 1.5
    up_candle = c > o
    dn_candle = c < o
    buy = spike & up_candle
    sell = spike & dn_candle
    disp = f"TR/ATR14 {_last_valid(ratio):.2f}"
    return _SeriesOut(ratio, _sig(buy, sell), disp)


def _calc_vwap(t: _OHLCV) -> _SeriesOut:
    _o, h, l, c, v = t
    tp = (h + l + c) / 3.0
    num = pd.Series(tp * v).rolling(100, min_periods=20).sum().to_numpy(dtype=float)
    den = pd.Series(v).rolling(100, min_periods=20).sum().to_numpy(dtype=float)
    with np.errstate(invalid="ignore", divide="ignore"):
        vw = np.where(np.isfinite(den) & (den > 0), num / den, np.nan)
    buy = np.isfinite(vw) & (c > vw)
    sell = np.isfinite(vw) & (c < vw)
    c_last = _last_valid(c)
    vw_last = _last_valid(vw)
    pos = "premium" if c_last > vw_last else "diskon" if c_last < vw_last else "netral"
    disp = f"VWAP {_fmt(vw_last)} ({pos})"
    return _SeriesOut(vw, _sig(buy, sell), disp)


def _calc_obv(t: _OHLCV) -> _SeriesOut:
    _o, _h, _l, c, v = t
    dc = np.sign(_diff1(c))
    obv = np.cumsum(dc * v)
    slope = _roll_slope(obv, 20)
    avgv = _sma(v, 20)
    with np.errstate(invalid="ignore", divide="ignore"):
        norm = np.where(np.isfinite(avgv) & (avgv > 0), slope / (avgv * 20.0), 0.0)
    norm = np.clip(np.nan_to_num(norm, nan=0.0), -1.0, 1.0)
    buy = norm > 0
    sell = norm < 0
    n_last = _last_valid(norm)
    arah = "naik" if n_last > 0 else "turun" if n_last < 0 else "datar"
    disp = f"OBV {arah} (slope {n_last:+.2f})"
    return _SeriesOut(norm, _sig(buy, sell), disp)


def _calc_mfi(t: _OHLCV) -> _SeriesOut:
    _o, h, l, c, v = t
    tp = (h + l + c) / 3.0
    mf = tp * v
    pd_tp = _np_shift(tp, 1)
    pos = np.where(tp > pd_tp, mf, 0.0)
    neg = np.where(tp < pd_tp, mf, 0.0)
    ps = _rsum(pos, 14)
    ns = _rsum(neg, 14)
    with np.errstate(invalid="ignore", divide="ignore"):
        mfi = np.where(
            np.isfinite(ns) & (ns > 0),
            100.0 - 100.0 / (1.0 + ps / ns),
            np.where(np.isfinite(ps) & (ps > 0), 100.0, 50.0),
        )
    buy = mfi < 20
    sell = mfi > 80
    disp = f"MFI {_last_valid(mfi):.0f}"
    return _SeriesOut(mfi, _sig(buy, sell), disp)


def _calc_tickvol(t: _OHLCV) -> _SeriesOut:
    o, _h, _l, c, v = t
    avg = _sma(v, 20)
    with np.errstate(invalid="ignore", divide="ignore"):
        ratio = np.where(np.isfinite(avg) & (avg > 0), v / avg, 0.0)
    spike = ratio >= 2.0
    buy = spike & (c > o)
    sell = spike & (c < o)
    disp = f"{_last_valid(ratio):.1f}× volume rata-rata"
    return _SeriesOut(ratio, _sig(buy, sell), disp)


def _calc_volumeprofile(t: _OHLCV) -> _SeriesOut:
    _o, h, l, c, v = t
    tp = (h + l + c) / 3.0
    poc = _poc_series(tp, v, window=100, buckets=10)
    buy = np.isfinite(poc) & (c > poc)
    sell = np.isfinite(poc) & (c < poc)
    c_last = _last_valid(c)
    poc_last = _last_valid(poc)
    pos = "di atas POC" if c_last > poc_last else "di bawah POC" if c_last < poc_last else "di POC"
    disp = f"POC {_fmt(poc_last)} ({pos})"
    return _SeriesOut(poc, _sig(buy, sell), disp)


def _calc_ad(t: _OHLCV) -> _SeriesOut:
    _o, h, l, c, v = t
    rng = h - l
    with np.errstate(invalid="ignore", divide="ignore"):
        clv = np.where(np.isfinite(rng) & (rng > 0), ((c - l) - (h - c)) / rng, 0.0)
    adl = np.cumsum(clv * v)
    slope = _roll_slope(adl, 20)
    avgv = _sma(v, 20)
    with np.errstate(invalid="ignore", divide="ignore"):
        norm = np.where(np.isfinite(avgv) & (avgv > 0), slope / (avgv * 20.0), 0.0)
    norm = np.clip(np.nan_to_num(norm, nan=0.0), -1.0, 1.0)
    buy = norm > 0
    sell = norm < 0
    n_last = _last_valid(norm)
    arah = "akumulasi" if n_last > 0 else "distribusi" if n_last < 0 else "datar"
    disp = f"A/D {arah} ({n_last:+.2f})"
    return _SeriesOut(norm, _sig(buy, sell), disp)


_CALCULATORS: dict[str, Callable[[_OHLCV], _SeriesOut]] = {
    "ema": _calc_ema,
    "sma": _calc_sma,
    "hma": _calc_hma,
    "supertrend": _calc_supertrend,
    "psar": _calc_psar,
    "ichimoku": _calc_ichimoku,
    "linreg": _calc_linreg,
    "macd": _calc_macd,
    "rsi": _calc_rsi,
    "stoch": _calc_stoch,
    "cci": _calc_cci,
    "momentum": _calc_momentum,
    "williamsr": _calc_williamsr,
    "tsi": _calc_tsi,
    "roc": _calc_roc,
    "stc": _calc_stc,
    "uo": _calc_uo,
    "bollinger": _calc_bollinger,
    "atr": _calc_atr,
    "keltner": _calc_keltner,
    "donchian": _calc_donchian,
    "stddev": _calc_stddev,
    "chaikin": _calc_chaikin,
    "volratio": _calc_volratio,
    "vwap": _calc_vwap,
    "obv": _calc_obv,
    "mfi": _calc_mfi,
    "tickvol": _calc_tickvol,
    "volumeprofile": _calc_volumeprofile,
    "ad": _calc_ad,
}


# ---------------------------------------------------------------------------
# API publik
# ---------------------------------------------------------------------------


def _normalize_names(names: list[str] | None) -> list[str]:
    """Normalisasi daftar id indikator (lowercase, dedupe, buang kosong)."""
    if not names:
        return list(DEFAULT_IDS)
    out: list[str] = []
    for n in names:
        nid = str(n).strip().lower()
        if nid and nid not in out:
            out.append(nid)
    return out or list(DEFAULT_IDS)


def indicator_series(df: pd.DataFrame, names: list[str] | None = None) -> dict[str, _SeriesOut]:
    """Hitung deret lengkap (nilai + sinyal per bar) untuk indikator terpilih.

    Semua deret bersifat kausal (bebas lookahead) sehingga aman dipakai
    oleh backtester walk-forward.
    """
    out: dict[str, _SeriesOut] = {}
    n = len(df) if df is not None else 0
    ids = _normalize_names(names)
    if n < MIN_BARS or not _has_ohlc(df):
        for nid in ids:
            out[nid] = _SeriesOut(
                np.zeros(n, dtype=float),
                np.zeros(n, dtype=np.int8),
                "data kurang (<60 candle)",
            )
        return out
    t = _prepare(df)
    for nid in ids:
        calc = _CALCULATORS.get(nid)
        if calc is None:
            out[nid] = _SeriesOut(np.zeros(n, dtype=float), np.zeros(n, dtype=np.int8), "indikator tidak dikenal")
            continue
        try:
            res = calc(t)
            if len(res.values) != n or len(res.signals) != n:
                res = _SeriesOut(np.zeros(n, dtype=float), np.zeros(n, dtype=np.int8), "panjang deret tidak valid")
        except Exception:  # noqa: BLE001 — indikator tidak boleh menjatuhkan engine
            res = _SeriesOut(np.zeros(n, dtype=float), np.zeros(n, dtype=np.int8), "gagal dihitung")
        out[nid] = res
    return out


def indicator_signal_series(df: pd.DataFrame, names: list[str] | None = None) -> dict[str, np.ndarray]:
    """Deret sinyal (-1/0/+1) per bar untuk indikator terpilih (untuk backtest)."""
    series = indicator_series(df, names)
    return {nid: np.asarray(res.signals, dtype=np.int8) for nid, res in series.items()}


def compute_indicators(df: pd.DataFrame, names: list[str] | None = None) -> dict[str, IndicatorResult]:
    """Evaluasi indikator pada bar TERAKHIR.

    Args:
        df:   DataFrame kolom ``time, open, high, low, close, tick_volume``
              (baris terlama → terbaru).
        names: daftar id indikator; ``None`` → set default (~20).

    Returns:
        dict id → :class:`IndicatorResult`. Bar < 60 → semua NEUTRAL.
    """
    ids = _normalize_names(names)
    n = len(df) if df is not None else 0
    if n < MIN_BARS or not _has_ohlc(df):
        return {nid: IndicatorResult(0.0, "NEUTRAL", "data kurang (<60 candle)") for nid in ids}
    series = indicator_series(df, ids)
    out: dict[str, IndicatorResult] = {}
    for nid in ids:
        try:
            res = series[nid]
            sig_val = int(res.signals[-1]) if len(res.signals) else 0
            out[nid] = IndicatorResult(
                value=round(_last_valid(res.values), 10),
                signal=_SIGNAL_NAMES.get(sig_val, "NEUTRAL"),
                display=res.display,
            )
        except Exception:  # noqa: BLE001
            out[nid] = IndicatorResult(0.0, "NEUTRAL", "gagal dievaluasi")
    return out


__all__ = [
    "IndicatorResult",
    "compute_indicators",
    "indicator_series",
    "indicator_signal_series",
    "signal_number",
    "INDICATOR_IDS",
    "INDICATOR_META",
    "DEFAULT_IDS",
    "MIN_BARS",
]
