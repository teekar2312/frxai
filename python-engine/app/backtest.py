# -*- coding: utf-8 -*-
"""app.backtest — backtester walk-forward berbasis skor indikator berbobot.

Desain:
    * Sinyal dihitung VEKTORIAL untuk seluruh DataFrame sekali jalan — semua
      deret indikator bersifat kausal (rolling/ewm/konvolusi hanya memakai
      data ≤ i) sehingga TIDAK ADA lookahead, namun tetap cepat
      (5000 bar < 10 detik).
    * Walk-forward per bar mulai ``START_BAR=150`` (warm-up indikator
      terpanjang ~100 bar): skor ≥ threshold → BUY, ≤ −threshold → SELL,
      satu posisi dalam satu waktu per pass.
    * Exit SL/TP dicek per bar high/low (konservatif: SL diecek lebih dulu
      bila keduanya tersentuh di bar yang sama).
    * Lot = sizing berbasis risiko dari saldo berjalan; komisi $1/lot/sisi
      (total $2/lot round-trip).

Hasil (dict, kunci selaras BacktestDetail dashboard):
    netProfit, netProfitPct, totalTrades, wins, losses, winRate,
    profitFactor, maxDrawdown, maxDrawdownPct, avgTrade, bestTrade,
    worstTrade, expectancy, sharpe, initialBalance, finalBalance,
    equityCurve [{time, equity, drawdown}], trades
    [{n, side, entryTime, exitTime, entry, exit, pips, profit, reason, balance}]
    + metadata (bars, indicators, riskPerTrade, ...).
"""

from __future__ import annotations

import logging
import time as _time
from typing import Any

import numpy as np
import pandas as pd

try:
    from .indicators import DEFAULT_IDS, INDICATOR_META, indicator_signal_series
except ImportError:  # pragma: no cover
    from app.indicators import DEFAULT_IDS, INDICATOR_META, indicator_signal_series  # type: ignore


def _get_logger() -> logging.Logger:
    """Ambil logger aplikasi (fallback aman bila app.logger belum tersedia)."""
    for loader in ("relative", "absolute"):
        try:
            if loader == "relative":
                from .logger import get_logger  # type: ignore
            else:
                from app.logger import get_logger  # type: ignore
            try:
                return get_logger("backtest")  # type: ignore[call-arg]
            except TypeError:
                return get_logger()  # type: ignore[call-arg]
        except Exception:
            continue
    lg = logging.getLogger("finex.backtest")
    if not lg.handlers:
        h = logging.StreamHandler()
        h.setFormatter(logging.Formatter("[%(asctime)s] %(levelname)s %(name)s: %(message)s"))
        lg.addHandler(h)
        lg.setLevel(logging.INFO)
    return lg


log = _get_logger()

#: Jumlah bar minimum untuk backtest yang berarti.
MIN_BARS = 300
#: Bar mulai walk-forward (warm-up indikator terpanjang ≈ 100 bar).
START_BAR = 150
#: Batas titik equity curve pada output (payload ringan).
MAX_CURVE_POINTS = 800
#: Komisi per lot per sisi (USD) — profil broker FINEX.
COMMISSION_PER_LOT_PER_SIDE = 1.0
#: Batas lot broker.
LOT_MIN, LOT_MAX = 0.01, 50.0


def _times_ms(df: pd.DataFrame) -> np.ndarray:
    """Deret waktu epoch-milidetik dari kolom/index time (fallback aman)."""
    n = len(df)
    base = np.arange(n, dtype=np.int64) * 60_000
    try:
        if "time" in df.columns:
            s = df["time"]
            if np.issubdtype(s.dtype, np.datetime64):
                return s.astype("datetime64[ms]").astype(np.int64).to_numpy()
            arr = pd.to_numeric(s, errors="coerce").to_numpy(dtype=float)
            arr = np.nan_to_num(arr, nan=0.0)
            if np.nanmedian(arr) > 0:
                # deteksi satuan: detik (< 1e11) vs milidetik
                if np.nanmedian(arr) < 1e11:
                    arr = arr * 1000.0
                return arr.astype(np.int64)
        idx = df.index
        if isinstance(idx, pd.DatetimeIndex):
            return idx.asi8 // 1_000_000  # ns → ms
    except Exception:  # noqa: BLE001
        pass
    return base


def _empty_result(
    df: pd.DataFrame | None, indicators: list[str], initial_balance: float, note: str
) -> dict:
    """Hasil kosong (aman untuk dashboard) saat data tidak memadai."""
    n = len(df) if df is not None else 0
    t0 = int(_times_ms(df)[0]) if n > 0 else int(_time.time() * 1000)
    return {
        "netProfit": 0.0,
        "netProfitPct": 0.0,
        "totalTrades": 0,
        "wins": 0,
        "losses": 0,
        "winRate": 0.0,
        "profitFactor": 0.0,
        "maxDrawdown": 0.0,
        "maxDrawdownPct": 0.0,
        "avgTrade": 0.0,
        "bestTrade": 0.0,
        "worstTrade": 0.0,
        "expectancy": 0.0,
        "sharpe": 0.0,
        "initialBalance": round(float(initial_balance), 2),
        "finalBalance": round(float(initial_balance), 2),
        "equityCurve": [{"time": t0, "equity": round(float(initial_balance), 2), "drawdown": 0.0}],
        "trades": [],
        "bars": int(n),
        "indicators": list(indicators),
        "note": note,
    }


def run_backtest(
    df: pd.DataFrame,
    indicators: list[str],
    risk_per_trade: float = 0.75,
    stop_loss_pips: int = 10,
    take_profit_ratio: float = 1.5,
    initial_balance: float = 10000.0,
    pip_size: float = 0.0001,
    pip_value: float = 10.0,
    score_threshold: int = 25,
) -> dict:
    """Jalankan backtest walk-forward.

    Args:
        df:              DataFrame candle ``time, open, high, low, close, tick_volume``
                         (baris terlama → terbaru; min 300 bar).
        indicators:      daftar id indikator untuk skor.
        risk_per_trade:  risiko per trade dalam persen saldo (mis. 0.75).
        stop_loss_pips:  stop loss dalam pips.
        take_profit_ratio: TP = SL × rasio (mis. 1.5 → RR 1:1.5).
        initial_balance: saldo awal (USD).
        pip_size:        ukuran 1 pip dalam harga (0.0001 / 0.01 / 0.1).
        pip_value:       nilai USD per pip per 1.0 lot.
        score_threshold: ambang |skor| untuk entry (0–100).

    Returns:
        Dict ringkasan + equity curve + daftar trade (lihat modul docstring).
    """
    t_start = _time.perf_counter()

    # ---- Validasi input ---------------------------------------------------
    names = [str(i).strip().lower() for i in (indicators or []) if str(i).strip()]
    names = [n for n in names if n in INDICATOR_META] or list(DEFAULT_IDS)
    if df is None or len(df) < MIN_BARS:
        return _empty_result(
            df, names, initial_balance,
            f"Data tidak cukup untuk backtest (butuh minimal {MIN_BARS} bar, "
            f"tersedia {0 if df is None else len(df)}).",
        )

    try:
        o = pd.to_numeric(df["open"], errors="coerce").to_numpy(dtype=float)
        h = pd.to_numeric(df["high"], errors="coerce").to_numpy(dtype=float)
        l = pd.to_numeric(df["low"], errors="coerce").to_numpy(dtype=float)
        c = pd.to_numeric(df["close"], errors="coerce").to_numpy(dtype=float)
    except Exception as exc:  # noqa: BLE001
        return _empty_result(df, names, initial_balance, f"Kolom OHLC tidak valid: {exc}")

    # buang bar dengan harga tidak finite di ujung depan (warm-up)
    valid = np.isfinite(o) & np.isfinite(h) & np.isfinite(l) & np.isfinite(c)
    if int(valid.sum()) < MIN_BARS:
        return _empty_result(
            df, names, initial_balance,
            f"Terlalu banyak bar dengan harga tidak valid ({int(valid.sum())} bar bersih).",
        )
    times = _times_ms(df)

    try:
        risk_pct = float(risk_per_trade)
        sl_pips = float(stop_loss_pips)
        tp_ratio = float(take_profit_ratio)
        balance0 = float(initial_balance)
        pip_sz = float(pip_size) if float(pip_size) > 0 else 0.0001
        pip_val = float(pip_value) if float(pip_value) > 0 else 10.0
        threshold = float(score_threshold)
    except (TypeError, ValueError):
        return _empty_result(df, names, initial_balance, "Parameter backtest tidak valid.")

    sl_pips = max(0.5, min(500.0, sl_pips))
    tp_ratio = max(0.1, min(10.0, tp_ratio))
    risk_pct = max(0.01, min(10.0, risk_pct))
    threshold = max(1.0, min(100.0, threshold))
    tp_pips = sl_pips * tp_ratio

    # ---- Deret sinyal (vektorial, kausal — tanpa lookahead) ---------------
    try:
        sig_map = indicator_signal_series(df, names)
    except Exception as exc:  # noqa: BLE001
        return _empty_result(df, names, initial_balance, f"Gagal menghitung indikator: {exc}")

    k = len(names)
    sig_matrix = np.vstack([np.nan_to_num(np.asarray(sig_map.get(n), dtype=float), nan=0.0) for n in names])
    score = 100.0 * sig_matrix.sum(axis=0) / k  # −100..100

    # ---- Walk-forward ------------------------------------------------------
    n = len(c)
    start = min(START_BAR, max(1, n - 2))
    balance = balance0
    equity = np.full(n, balance0, dtype=float)
    trades: list[dict] = []
    trade_returns: list[float] = []

    pos_side = 0        # 0 flat, +1 long, -1 short
    entry_i = 0
    entry_px = 0.0
    lot = 0.0
    sl_px = 0.0
    tp_px = 0.0

    def close_position(exit_i: int, exit_px: float, reason: str) -> None:
        """Tutup posisi & catat trade (nonlocal via list/dict di scope luar)."""
        nonlocal balance, pos_side
        side_sign = 1 if pos_side > 0 else -1
        pips = (exit_px - entry_px) / pip_sz * side_sign
        commission = 2.0 * COMMISSION_PER_LOT_PER_SIDE * lot
        profit = pips * pip_val * lot - commission
        balance_before = balance
        balance = balance + profit
        trades.append(
            {
                "n": len(trades) + 1,
                "side": "BUY" if pos_side > 0 else "SELL",
                "entryTime": int(times[entry_i]),
                "exitTime": int(times[exit_i]),
                "entry": round(float(entry_px), 5),
                "exit": round(float(exit_px), 5),
                "pips": round(float(pips), 1),
                "profit": round(float(profit), 2),
                "reason": reason,
                "balance": round(float(balance), 2),
            }
        )
        trade_returns.append(profit / balance_before if balance_before > 0 else 0.0)
        pos_side = 0

    for i in range(start, n):
        # kelola posisi terbuka (SL dicek lebih dulu — konservatif)
        if pos_side != 0 and i > entry_i:
            if pos_side > 0:
                if l[i] <= sl_px:
                    close_position(i, sl_px, "SL")
                elif h[i] >= tp_px:
                    close_position(i, tp_px, "TP")
            else:
                if h[i] >= sl_px:
                    close_position(i, sl_px, "SL")
                elif l[i] <= tp_px:
                    close_position(i, tp_px, "TP")

        # buka posisi baru
        if pos_side == 0 and i < n - 1 and abs(score[i]) >= threshold and balance > 0:
            risk_usd = balance * risk_pct / 100.0
            denom = sl_pips * pip_val
            raw_lot = risk_usd / denom if denom > 0 else LOT_MIN
            lot = max(LOT_MIN, min(LOT_MAX, round(raw_lot, 2)))
            pos_side = 1 if score[i] > 0 else -1
            entry_i = i
            entry_px = c[i]
            if pos_side > 0:
                sl_px = entry_px - sl_pips * pip_sz
                tp_px = entry_px + tp_pips * pip_sz
            else:
                sl_px = entry_px + sl_pips * pip_sz
                tp_px = entry_px - tp_pips * pip_sz

        # equity per bar (saldo + floating)
        if pos_side != 0:
            floating = (c[i] - entry_px) / pip_sz * pip_val * lot * (1 if pos_side > 0 else -1)
            equity[i] = balance + floating
        else:
            equity[i] = balance

    # tutup posisi yang masih terbuka di akhir data
    if pos_side != 0:
        close_position(n - 1, c[n - 1], "EOD")
        equity[n - 1] = balance

    # ---- Equity curve + drawdown ------------------------------------------
    peak = -np.inf
    max_dd = 0.0
    max_dd_pct = 0.0
    dd_series = np.zeros(n, dtype=float)
    for i in range(n):
        eq = equity[i]
        if eq > peak:
            peak = eq
        dd = peak - eq
        dd_series[i] = (dd / peak * 100.0) if peak > 0 else 0.0
        if dd > max_dd:
            max_dd = dd
        if peak > 0:
            max_dd_pct = max(max_dd_pct, dd / peak * 100.0)

    step = max(1, n // MAX_CURVE_POINTS)
    idxs = list(range(0, n, step))
    if idxs[-1] != n - 1:
        idxs.append(n - 1)
    equity_curve = [
        {"time": int(times[i]), "equity": round(float(equity[i]), 2), "drawdown": round(float(dd_series[i]), 2)}
        for i in idxs
    ]

    # ---- Statistik ----------------------------------------------------------
    profits = np.array([t["profit"] for t in trades], dtype=float) if trades else np.array([], dtype=float)
    total = len(trades)
    wins = int((profits > 0).sum())
    losses = int((profits <= 0).sum())
    gross_profit = float(profits[profits > 0].sum()) if total else 0.0
    gross_loss = float(profits[profits < 0].sum()) if total else 0.0
    if gross_loss < 0:
        pf = gross_profit / abs(gross_loss)
    else:
        pf = 999.99 if gross_profit > 0 else 0.0
    win_rate = (wins / total * 100.0) if total else 0.0
    avg_trade = float(profits.mean()) if total else 0.0
    best_trade = float(profits.max()) if total else 0.0
    worst_trade = float(profits.min()) if total else 0.0
    if total >= 2:
        r = np.array(trade_returns, dtype=float)
        std = float(r.std(ddof=1))
        sharpe = float(r.mean() / std) if std > 0 else 0.0
    else:
        sharpe = 0.0
    net_profit = balance - balance0
    net_pct = (net_profit / balance0 * 100.0) if balance0 > 0 else 0.0

    elapsed = _time.perf_counter() - t_start
    log.info(
        f"Backtest selesai: {total} trade, net {net_profit:+.2f} USD, "
        f"win rate {win_rate:.1f}%, {n} bar dalam {elapsed:.2f}s"
    )

    return {
        "netProfit": round(float(net_profit), 2),
        "netProfitPct": round(float(net_pct), 2),
        "totalTrades": total,
        "wins": wins,
        "losses": losses,
        "winRate": round(win_rate, 1),
        "profitFactor": round(pf, 2),
        "maxDrawdown": round(float(max_dd), 2),
        "maxDrawdownPct": round(float(max_dd_pct), 2),
        "avgTrade": round(avg_trade, 2),
        "bestTrade": round(best_trade, 2),
        "worstTrade": round(worst_trade, 2),
        "expectancy": round(avg_trade, 2),  # ekspektasi per trade = rata-rata profit
        "sharpe": round(sharpe, 2),
        "initialBalance": round(balance0, 2),
        "finalBalance": round(float(balance), 2),
        "equityCurve": equity_curve,
        "trades": trades,
        # metadata tambahan (untuk BacktestSummary/Detail di API)
        "bars": int(n),
        "indicators": names,
        "riskPerTrade": risk_pct,
        "stopLossPips": int(round(sl_pips)),
        "takeProfitRatio": round(tp_ratio, 2),
        "scoreThreshold": int(round(threshold)),
        "elapsedSec": round(elapsed, 3),
    }


__all__ = ["run_backtest", "MIN_BARS"]
