# -*- coding: utf-8 -*-
"""main.py — titik masuk FINEX AI Trading Engine (LIVE, MetaTrader 5).

Jalankan di PC Windows 11 (Python 3.14 x64 + terminal MetaTrader 5 +
akun real FINEX Indonesia)::

    python main.py

Apa yang dilakukan file ini:
    * Memuat konfigurasi (``config.yaml`` → fallback default; override via
      ``.env`` — lihat ``app.config``).
    * Menyiapkan logger (``app.logger``) + banner startup.
    * Membuat :class:`~app.state.AppState`, :class:`~app.mt5_client.MT5Client`
      (auto-launch terminal64.exe), :class:`~app.ml_model.MLModel`, dan
      :class:`~app.alerts.AlertManager`.
    * Menjalankan 5 thread daemon:
        - TICK       (~1s)   : harga 4 pair, akun, daily roll, status.
        - STRATEGY   (~15s)  : siklus AI (gate harian → sesi → news →
                               max posisi → kandidat → TF → indikator →
                               skor LLM+ML → lot → eksekusi).
        - POSITIONS  (~1s)   : refresh posisi, trailing stop, deteksi
                               posisi tertutup (SL/TP/MANUAL), stop-out watch.
        - NEWS       (5 mnt) : Finnhub + MarketAux + sentimen AI + kalender.
        - ALERTS     (~2s)   : pemicuan alert harga + email.
    * Menjalankan server FastAPI (uvicorn) di thread utama — kontrak
      ``GET /api/v1/poll`` kompatibel dengan ``EnginePollResponse``
      dashboard Next.js (diproxy ``/api/engine`` dengan timeout 2.5 detik,
      jadi handler poll TIDAK PERNAH memanggil MT5 — hanya membaca cache
      state).

Matikan dengan ``Ctrl+C`` — koneksi MT5 ditutup dengan rapi.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import hmac
import re
import sys
import threading
import time
from datetime import datetime, timezone
from typing import Any, Callable

import uvicorn
from fastapi import FastAPI, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.alerts import AlertManager
from app.ai_providers import (
    clear_runtime_keys,
    runtime_key_status,
    set_runtime_keys,
)
from app.config import (
    KNOWN_INDICATORS,
    KNOWN_MODES,
    KNOWN_PAIRS,
    KNOWN_PROVIDERS,
    KNOWN_SESSIONS,
    KNOWN_TIMEFRAMES,
    Config,
    ConfigError,
)
from app.emailer import notify_event
from app.indicators import compute_indicators
from app.logger import ENGINE_ROOT, LOG_FILE, get_logger
from app.ml_model import MLModel
from app.mt5_client import MT5_AVAILABLE, MT5Client, MT5Error
from app.news import analyze_sentiment, economic_calendar, fetch_all
from app.sessions import active_sessions, is_market_open
from app.state import (
    ENGINE_VERSION,
    AppState,
    get_state,
    iso_from_epoch,
    iso_now,
)
from app.strategy import analyze, quick_analysis

# ---------------------------------------------------------------------------
# Konstanta loop
# ---------------------------------------------------------------------------

TICK_INTERVAL: float = 1.0          # detik — harga + akun + status
STRATEGY_INTERVAL: float = 15.0     # detik — siklus keputusan AI
POSITION_INTERVAL: float = 1.0      # detik — manajemen posisi
NEWS_INTERVAL: float = 300.0        # detik — refresh berita (5 menit)
ALERTS_INTERVAL: float = 2.0        # detik — cek alert harga
RECONNECT_INTERVAL: float = 15.0    # detik — jeda retry koneksi MT5
STOP_OUT_LEVEL: float = 20.0        # % — margin level stop-out FINEX
AUTO_TRAIL_TRIGGER_PIPS: float = 6.0  # trailing mode 'ai' aktif saat profit > 6 pips
SCORE_THRESHOLD: int = 25           # ambang |skor| untuk entry AI
CANDLE_BARS: int = 300              # jumlah candle untuk analisa
TRAIL_MODIFY_MIN_PIPS: float = 1.0  # SL digeser minimal sejauh ini agar modify dikirim
SETTLE_MAX_ATTEMPTS: int = 5        # retry ambil deal history posisi tertutup
LOG_TAIL_LINES: int = 3000          # baris log yang dibaca endpoint /logs

#: Ambang profit-mode trailing otomatis mengikuti konfigurasi `risk.trailing_mode`.

_MAIN_LOG_LINE = re.compile(
    r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3})\s+"
    r"(DEBUG|INFO|WARNING|ERROR|CRITICAL)\s+\[([^\]]+)\]\s+(.*)$"
)

#: Peta nama logger → kategori log dashboard.
_CATEGORY_MAP: dict[str, str] = {
    "mt5": "ENGINE",
    "engine": "SYSTEM",
    "main": "SYSTEM",
    "strategy": "AI",
    "ai": "AI",
    "ml": "AI",
    "news": "NEWS",
    "alerts": "ALERT",
    "emailer": "EMAIL",
    "positions": "TRADING",
    "orders": "TRADING",
    "risk": "RISK",
    "backtest": "BACKTEST",
}


# ---------------------------------------------------------------------------
# Helper kecil
# ---------------------------------------------------------------------------


def _r2(value: Any) -> float:
    """Bulatkan ke 2 desimal (aman untuk None/str)."""
    try:
        return round(float(value or 0.0), 2)
    except (TypeError, ValueError):
        return 0.0


def _r4(value: Any) -> float:
    """Bulatkan ke 4 desimal (aman untuk None/str)."""
    try:
        return round(float(value or 0.0), 4)
    except (TypeError, ValueError):
        return 0.0


def _mask_login(login: Any) -> str:
    """Sembunyikan sebagian nomor akun untuk tampilan dashboard."""
    s = str(login or "").strip()
    if not s:
        return ""
    if len(s) <= 4:
        return "*" * len(s)
    return f"{s[:2]}{'*' * 4}{s[-2:]}"


def _parse_iso(value: Any) -> datetime | None:
    """Parse string ISO-8601 (dukung akhiran 'Z') → datetime aware-UTC."""
    if not value:
        return None
    try:
        text = str(value).strip().replace("Z", "+00:00")
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (TypeError, ValueError):
        return None


def _pips(side: str, open_price: float, price: float, pip: float) -> float:
    """Hitung selisih harga dalam pips sesuai arah posisi."""
    if pip <= 0 or open_price <= 0:
        return 0.0
    diff = (price - open_price) if side == "BUY" else (open_price - price)
    return round(diff / pip, 1)


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Argumen CLI engine."""
    parser = argparse.ArgumentParser(
        prog="finex-engine",
        description="FINEX AI Trading Engine (LIVE, MetaTrader 5, FINEX Indonesia).",
    )
    parser.add_argument(
        "--config",
        default=str(ENGINE_ROOT / "config.yaml"),
        help="path file konfigurasi YAML (default: config.yaml di folder engine)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="mode simulasi: order TIDAK dikirim ke broker (hanya dicatat)",
    )
    parser.add_argument(
        "--backtest",
        nargs=2,
        metavar=("PAIR", "TIMEFRAME"),
        help=(
            "jalankan backtest lalu keluar, tanpa start server "
            "(contoh: python main.py --backtest EURUSD H1) — butuh terminal MT5 "
            "untuk data candle"
        ),
    )
    parser.add_argument(
        "--bars",
        type=int,
        default=1000,
        help="jumlah candle untuk --backtest (default 1000, clamp 300..5000)",
    )
    parser.add_argument("--version", action="version", version=f"FINEX engine {ENGINE_VERSION}")
    return parser.parse_args(argv)


def load_config(path: str) -> Config:
    """Muat konfigurasi (YAML + .env); error struktural → fallback default.

    Args:
        path: path file ``config.yaml``.

    Returns:
        Instance :class:`~app.config.Config` yang sudah tervalidasi
        (peringatan clamp ditulis ke log, bukan fatal).
    """
    log = get_logger("main")
    try:
        cfg = Config.load(path)
    except ConfigError as exc:
        log.error(f"Konfigurasi tidak valid ({exc}) — engine lanjut dengan nilai default.")
        cfg = Config(source_path=path)
        cfg.warnings.append(f"Konfigurasi tidak valid: {exc}")
        try:
            cfg.validate()
        except ConfigError as exc2:  # pragma: no cover - default selalu lolos
            cfg.warnings.append(str(exc2))
    for warning in cfg.warnings:
        log.warning(f"[config] {warning}")
    return cfg


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------


class Engine:
    """Orkestrator utama: state, MT5, ML, alert, 5 thread loop, dan aksi order.

    Args:
        config: konfigurasi engine (sudah tervalidasi).
        state:  state bersama (default: singleton dari
                :func:`~app.state.get_state`).
    """

    def __init__(self, config: Config, state: AppState | None = None) -> None:
        self.config = config
        self.state = state or get_state()
        self.log = get_logger("engine")

        self.client = MT5Client(config)
        self.ml = MLModel(str(ENGINE_ROOT / "models"))
        self.alerts = AlertManager(str(ENGINE_ROOT / "data" / "alerts.json"))

        self._stop = threading.Event()
        self._threads: list[threading.Thread] = []
        self._cycle_lock = threading.Lock()      # anti-tumpang-tindih siklus AI
        self._last_logs: dict[str, float] = {}   # throttle log periode panjang

        # --- statistik harian (UTC) -------------------------------------
        self._day_key: str = ""
        self._day_open: dict[str, float] = {}
        self._day_high: dict[str, float] = {}
        self._day_low: dict[str, float] = {}
        self._day_seeded: set[str] = set()

        # --- pelacakan posisi --------------------------------------------
        self._known_tickets: dict[int, dict[str, Any]] = {}
        self._pending_settle: dict[int, dict[str, Any]] = {}
        self._ai_features: dict[int, Any] = {}     # ticket → vektor fitur ML
        self._trailing_manual: set[int] = set()    # ticket dengan trailing ON (mode manual)
        self._stopout_until: float = 0.0

        # --- koneksi -------------------------------------------------------
        self._last_connect_attempt: float = 0.0
        self._mt5_warned: bool = False

        # status awal
        self.state.update(lambda s: s.status.__setitem__(
            "ai_trading", config.trading.mode == "ai"))

    # ------------------------------------------------------------------
    # Siklus hidup thread
    # ------------------------------------------------------------------

    def start(self) -> None:
        """Jalankan semua thread daemon (tick, strategy, positions, news, alerts)."""
        loops: list[tuple[str, float, Callable[[], None]]] = [
            ("tick", TICK_INTERVAL, self._tick),
            ("strategy", STRATEGY_INTERVAL, self._strategy_cycle),
            ("positions", POSITION_INTERVAL, self._manage_positions),
            ("news", NEWS_INTERVAL, self._fetch_news),
            ("alerts", ALERTS_INTERVAL, self._check_alerts),
        ]
        for name, interval, fn in loops:
            thread = threading.Thread(
                target=self._loop_runner,
                args=(name, interval, fn),
                name=f"finex-{name}",
                daemon=True,
            )
            thread.start()
            self._threads.append(thread)
            self.log.info(f"Thread '{name}' dimulai (interval {interval:g}s)")

    def _loop_runner(self, name: str, interval: float, fn: Callable[[], None]) -> None:
        """Wrapper loop thread — exception apa pun tidak boleh mematikan engine."""
        while not self._stop.is_set():
            try:
                fn()
            except Exception as exc:  # noqa: BLE001 - thread harus tetap hidup
                self.log.error(
                    f"Thread '{name}' error: {type(exc).__name__}: {exc}",
                    exc_info=True,
                )
            self._stop.wait(interval)

    def shutdown(self) -> None:
        """Hentikan loop + tutup koneksi MT5 dengan rapi."""
        self._stop.set()
        try:
            self.client.shutdown()
        except Exception as exc:  # noqa: BLE001
            self.log.warning(f"shutdown MT5: {exc}")
        self.log.info("Engine berhenti.")

    # ------------------------------------------------------------------
    # Log ter-throttle (hindari spam log per-siklus)
    # ------------------------------------------------------------------

    def _throttled(self, key: str, message: str, level: str = "DEBUG", window: float = 120.0) -> None:
        """Log pesan maksimal satu kali per ``window`` detik untuk ``key``."""
        now = time.monotonic()
        if now - self._last_logs.get(key, 0.0) >= window:
            self._last_logs[key] = now
            logger = getattr(self.log, level.lower(), self.log.debug)
            logger(message)

    # ------------------------------------------------------------------
    # TICK LOOP — harga, akun, daily roll, status
    # ------------------------------------------------------------------

    def _tick(self) -> None:
        """Satu iterasi tick: koneksi, akun, harga 4 pair, status sesi."""
        if not MT5_AVAILABLE:
            if not self._mt5_warned:
                self._mt5_warned = True
                self.log.error(
                    "Paket MetaTrader5 tidak terpasang (hanya tersedia di Windows) — "
                    "engine berjalan tanpa MT5. Install dengan: pip install MetaTrader5"
                )
            self._refresh_status(False, 0.0)
            self._daily_roll_check()
            return

        connected = bool(self.state.status.get("connected"))
        if not connected:
            now_mono = time.monotonic()
            if now_mono - self._last_connect_attempt >= RECONNECT_INTERVAL:
                self._last_connect_attempt = now_mono
                try:
                    connected = self.client.connect()
                except Exception as exc:  # noqa: BLE001
                    self.log.error(f"Percobaan koneksi MT5 gagal: {exc}")
                    connected = False
                if connected:
                    self.log.info("MT5 tersambung kembali.")

        acc: dict[str, Any] | None = None
        prices: dict[str, dict[str, Any]] = {}
        latency = 0.0
        if connected:
            t0 = time.perf_counter()
            acc = self.client.get_account()
            prices = self.client.get_prices(list(KNOWN_PAIRS))
            latency = (time.perf_counter() - t0) * 1000.0

        connected = connected and (acc is not None or bool(prices))
        if acc is not None:
            self.state.update(lambda s: s.account.update(acc))
            # inisialisasi balance awal hari (boot pertama)
            if float(self.state.daily_start_balance or 0.0) <= 0.0:
                balance = float(acc.get("balance") or 0.0)
                if balance > 0.0:
                    self.state.update(lambda s: s.__setattr__("daily_start_balance", balance))
                    self.log.info(f"daily_start_balance diinisialisasi: {balance:.2f}")

        self._daily_roll_check()
        if prices:
            self._update_prices(prices)
        self._refresh_status(connected, latency)
        self._refresh_daily_gate()

    def _refresh_status(self, connected: bool, latency_ms: float) -> None:
        """Perbarui status sesi/market/tick di state (dari cache, tanpa MT5)."""
        now = datetime.now(timezone.utc)

        def apply(s: AppState) -> None:
            s.status["connected"] = connected
            s.status["market_open"] = is_market_open(now)
            s.status["active_sessions"] = active_sessions(now)
            s.status["last_tick"] = iso_now()
            s.status["latency_ms"] = round(latency_ms, 1)
            s.status["ai_trading"] = self.config.trading.mode == "ai"

        self.state.update(apply)

    # ------------------------------------------------------------------
    # Daily roll (UTC midnight)
    # ------------------------------------------------------------------

    def _daily_roll_check(self) -> None:
        """Deteksi pergantian hari UTC → reset statistik harian + laporan email."""
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if today == self._day_key:
            return
        first_boot = not self._day_key
        if not first_boot:
            self._send_daily_report()
        self._day_key = today
        self._day_open.clear()
        self._day_high.clear()
        self._day_low.clear()
        self._day_seeded.clear()
        balance = float(self.state.account.get("balance") or 0.0)
        if balance > 0.0:
            self.state.update(lambda s: s.__setattr__("daily_start_balance", balance))
        self.state.update(lambda s: s.status.__setitem__("daily_blocked", "NONE"))
        self.log.info(
            f"Daily roll {today} — statistik harian di-reset "
            f"(daily_start_balance={balance:.2f})."
        )

    def _send_daily_report(self) -> None:
        """Kirim laporan harian (email opsional) untuk hari yang baru berakhir."""
        snap = self.state.snapshot()
        acc = snap["account"]
        start = float(snap["daily_start_balance"] or 0.0)
        equity = float(acc.get("equity") or 0.0)
        balance = float(acc.get("balance") or 0.0)
        daily_pnl = equity - start
        daily_pct = (daily_pnl / start * 100.0) if start > 0 else 0.0

        prev_day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        trades = wins = losses = 0
        for trade in snap["history"]:
            if str(trade.get("closedAt") or "").startswith(prev_day):
                trades += 1
                if float(trade.get("profit") or 0.0) > 0:
                    wins += 1
                else:
                    losses += 1

        self.log.info(
            f"Laporan harian: PnL {daily_pnl:+.2f} USD ({daily_pct:+.2f}%), "
            f"{trades} trade (W{wins}/L{losses})."
        )
        notify_event(
            "daily_report",
            {
                "balance": balance,
                "equity": equity,
                "dailyPnl": daily_pnl,
                "dailyPnlPct": round(daily_pct, 2),
                "trades": trades,
                "wins": wins,
                "losses": losses,
                "time": iso_now(),
            },
            self.config,
        )

    def _refresh_daily_gate(self) -> None:
        """Hitung status anti-MC harian (LIMIT/TARGET) + email saat transisi."""
        cfg = self.config
        snap_start = float(self.state.daily_start_balance or 0.0)
        if snap_start <= 0.0:
            return
        pct = self.state.daily_pnl_pct()
        if pct <= -float(cfg.risk.daily_risk_limit):
            blocked = "LIMIT"
        elif pct >= float(cfg.risk.daily_target):
            blocked = "TARGET"
        else:
            blocked = "NONE"

        prev = str(self.state.status.get("daily_blocked") or "NONE")
        if blocked == prev:
            return
        self.state.update(lambda s: s.status.__setitem__("daily_blocked", blocked))
        if blocked == "NONE":
            self.log.info("Batas harian ter-reset — trading otomatis aktif kembali.")
            return

        balance = float(self.state.account.get("balance") or 0.0)
        self.log.warning(
            f"RISK: daily {blocked} tercapai (PnL harian {pct:+.2f}%, "
            f"batas loss {-cfg.risk.daily_risk_limit:+.2f}% / target "
            f"+{cfg.risk.daily_target:+.2f}%) — trading otomatis dijeda."
        )
        notify_event(
            "daily_limit",
            {
                "type": blocked,
                "dailyPnlPct": round(pct, 2),
                "balance": balance,
                "time": iso_now(),
            },
            self.config,
        )

    # ------------------------------------------------------------------
    # Harga → PriceTick (camelCase, bentuk dashboard)
    # ------------------------------------------------------------------

    def _update_prices(self, prices: dict[str, dict[str, Any]]) -> None:
        """Perbarui ``state.prices`` dengan bentuk ``PriceTick`` lengkap."""
        for sym, tick in prices.items():
            try:
                bid = float(tick.get("bid") or 0.0)
                ask = float(tick.get("ask") or 0.0)
                if bid <= 0.0 or ask <= 0.0:
                    continue
                mid = (bid + ask) / 2.0
                if sym not in self._day_seeded:
                    self._seed_day_stats(sym, mid)
                day_open = self._day_open.get(sym, mid)
                high = max(self._day_high.get(sym, mid), mid)
                low = min(self._day_low.get(sym, mid), mid)
                self._day_high[sym] = high
                self._day_low[sym] = low
                pip = self.client.pip_size(sym)
                digits = int(tick.get("digits") or 5)
                change_pips = (mid - day_open) / pip if pip > 0 else 0.0
                change_pct = (mid - day_open) / day_open * 100.0 if day_open > 0 else 0.0
                view = {
                    "pair": sym,
                    "bid": bid,
                    "ask": ask,
                    "spread": round(float(tick.get("spread") or 0.0), 2),
                    "changePct": round(change_pct, 3),
                    "changePips": round(change_pips, 1),
                    "dayHigh": round(high, digits),
                    "dayLow": round(low, digits),
                    "digits": digits,
                    "updatedAt": iso_now(),
                }
                self.state.update(lambda s, k=sym, v=view: s.prices.__setitem__(k, v))
            except Exception as exc:  # noqa: BLE001 - satu pair gagal ≠ engine mati
                self.log.warning(f"Gagal memetakan harga {sym}: {exc}")

    def _seed_day_stats(self, sym: str, mid: float) -> None:
        """Isi open/high/low harian dari candle D1 (fallback: harga sekarang)."""
        try:
            df = self.client.get_candles(sym, "D1", 2)
            if df is not None and len(df) > 0:
                last = df.iloc[-1]
                day_open = float(last["open"])
                if day_open > 0.0:
                    self._day_open[sym] = day_open
                    self._day_high[sym] = max(float(last["high"]), mid)
                    self._day_low[sym] = min(float(last["low"]), mid)
                    self._day_seeded.add(sym)
                    return
        except Exception:  # noqa: BLE001
            pass
        # fallback: harga pertama yang terlihat hari ini
        self._day_open[sym] = mid
        self._day_high[sym] = mid
        self._day_low[sym] = mid
        self._day_seeded.add(sym)

    # ------------------------------------------------------------------
    # STRATEGY LOOP — siklus keputusan AI
    # ------------------------------------------------------------------

    def _strategy_cycle(self) -> None:
        """Satu siklus keputusan AI (dipanggil tiap ~15 detik saat mode 'ai').

        Urutan gate (mengikuti spesifikasi worklog):
            1. daily limit/target (anti-MC)
            2. sesi trading aktif
            3. news HIGH impact ± ``avoid_minutes``
            4. jumlah maksimal posisi & pair yang sudah open
            5. kandidat pair (manual: pilihan user; ai: top-2 volatilitas)
            6. timeframe (manual: pilihan user; ai: aturan ATR)
            7. indikator + skor (quick_analysis → refine analyze/LLM)
            8. lot sizing berbasis risiko → eksekusi + log + email.
        """
        if not self.state.status.get("ai_trading"):
            return
        if not self.state.status.get("connected"):
            self._throttled("ai-disconnected", "Siklus AI dilewati: MT5 belum tersambung.", "DEBUG", 300)
            return
        if not self._cycle_lock.acquire(blocking=False):
            self.log.debug("Siklus AI sebelumnya masih berjalan — lewati.")
            return
        try:
            self._run_strategy_gates()
        finally:
            self._cycle_lock.release()

    def _set_decision(self, text: str) -> None:
        """Simpan keputusan AI terakhir ke status (untuk dashboard)."""
        self.state.update(lambda s: s.status.__setitem__("last_ai_decision", text))

    def _run_strategy_gates(self) -> None:
        cfg = self.config
        snap = self.state.snapshot()
        status = snap["status"]

        # --- 1) gate harian (anti-MC) -----------------------------------
        blocked = str(status.get("daily_blocked") or "NONE")
        if blocked != "NONE":
            self._throttled(
                "ai-daily",
                f"Siklus AI dilewati: daily {blocked} tercapai (anti-MC).",
                "INFO", 300,
            )
            self._set_decision(f"SKIP — daily {blocked} tercapai (anti-MC)")
            return

        # --- 2) gate sesi ------------------------------------------------
        if cfg.trading.session_mode == "manual":
            allowed = cfg.trading_allowed_sessions()
            if not allowed:
                self._throttled(
                    "ai-session",
                    "Siklus AI dilewati: tidak ada sesi terpilih yang sedang aktif.",
                    "DEBUG", 600,
                )
                self._set_decision("SKIP — sesi trading tidak aktif")
                return
        elif not active_sessions():
            self._set_decision("SKIP — pasar tutup (tidak ada sesi aktif)")
            return

        # --- 3) gate news -------------------------------------------------
        if cfg.risk.avoid_news:
            block = self._news_block_reason()
            if block:
                self._throttled(
                    "ai-news",
                    f"Siklus AI dilewati: {block}",
                    "INFO", 300,
                )
                self._set_decision(f"SKIP — {block}")
                return

        # --- 4) gate max posisi -------------------------------------------
        engine_positions = [
            p for p in snap["positions"]
            if int(p.get("magic") or 0) == int(cfg.trading.magic)
        ]
        if len(engine_positions) >= int(cfg.risk.max_positions):
            self._throttled(
                "ai-maxpos",
                f"Siklus AI dilewati: maksimal {cfg.risk.max_positions} posisi tercapai.",
                "DEBUG", 300,
            )
            self._set_decision(f"SKIP — maksimal {cfg.risk.max_positions} posisi")
            return
        open_pairs = {str(p.get("pair") or "").upper() for p in engine_positions}

        # --- 5) kandidat pair ----------------------------------------------
        if cfg.trading.pair_mode == "manual":
            candidates = [p for p in cfg.trading.pairs if p not in open_pairs]
        else:
            candidates = self._rank_candidates(snap["prices"], open_pairs)
        if not candidates:
            self._set_decision("SKIP — tidak ada kandidat pair")
            return

        # --- 6-7) TF + skor per kandidat (quick, tanpa jaringan) -----------
        best: dict[str, Any] | None = None
        for pair in candidates:
            timeframe = self._pick_timeframe(pair)
            if timeframe is None:
                continue
            df = self.client.get_candles(pair, timeframe, CANDLE_BARS)
            if df is None or len(df) < 60:
                continue
            result = quick_analysis(pair, timeframe, df, cfg, self.ml, self.state)
            if best is None or abs(result["score"]) > abs(best["result"]["score"]):
                best = {"result": result, "df": df, "timeframe": timeframe}
        if best is None:
            self._throttled("ai-nodata", "Siklus AI: data candle tidak tersedia.", "DEBUG", 300)
            self._set_decision("SKIP — data candle tidak tersedia")
            return

        pair = best["result"]["pair"]
        timeframe = best["timeframe"]

        # refine dengan LLM provider (analyze sendiri sudah fallback lokal)
        try:
            final = asyncio.run(
                analyze(pair, timeframe, best["df"], cfg, self.ml, self.state)
            )
        except Exception as exc:  # noqa: BLE001 - fallback ke quick_analysis
            self.log.warning(f"analyze() gagal ({exc}) — pakai quick_analysis.")
            final = best["result"]

        score = int(final.get("score") or 0)

        # --- 8) gate sinyal lemah ------------------------------------------
        if abs(score) < SCORE_THRESHOLD:
            self._throttled(
                "ai-weak",
                f"AI skip {pair}: sinyal lemah (score {score:+d}).",
                "DEBUG", 300,
            )
            self._set_decision(f"SKIP — {pair} {timeframe} sinyal lemah (score {score:+d})")
            return

        side = "BUY" if score > 0 else "SELL"

        # --- 9) SL/TP ------------------------------------------------------
        if cfg.risk.mode == "ai":
            atr_result = compute_indicators(best["df"], ["atr"]).get("atr")
            atr_value = float(getattr(atr_result, "value", 0.0) or 0.0)
            pip = self.client.pip_size(pair)
            atr_pips = atr_value / pip if pip > 0 else 0.0
            sl_pips = int(max(5, min(15, round(atr_pips * 1.2) or 10)))
        else:
            sl_pips = int(final.get("stopLossPips") or cfg.risk.stop_loss_pips)
        sl_pips = int(max(1, min(100, sl_pips)))
        tp_pips = max(1, round(sl_pips * float(cfg.risk.take_profit_ratio)))

        # --- 10) lot sizing berbasis risiko ---------------------------------
        equity = float(snap["account"].get("equity") or 0.0)
        pip_value = self.client.pip_value(pair)
        risk_usd = equity * float(cfg.risk.risk_per_trade) / 100.0
        denom = sl_pips * pip_value
        if equity <= 0.0 or denom <= 0.0:
            self._set_decision(f"SKIP — equity/pip value tidak valid ({pair})")
            return
        volume = self.client.normalize_volume(pair, risk_usd / denom)
        if volume <= 0.0:
            self._set_decision(f"SKIP — lot terlalu kecil ({pair})")
            return

        # --- 11) eksekusi ----------------------------------------------------
        comment = f"AI|{cfg.ai.provider}|score={score}|tf={timeframe}"
        decision = (
            f"AI OPEN {pair} {side} {volume} lot (score {score:+d}, "
            f"{timeframe}, SL {sl_pips}p / TP {tp_pips}p)"
        )
        if cfg.dry_run:
            self.log.info(f"[DRY-RUN] {decision} — order TIDAK dikirim ke broker.")
            self._set_decision(f"{decision} [DRY-RUN]")
            return
        try:
            result = self.client.market_order(
                pair, side, volume, sl_pips, tp_pips, comment, int(cfg.trading.magic),
            )
        except MT5Error as exc:
            self.log.error(f"Order AI gagal {pair} {side}: {exc}")
            self._set_decision(f"ERROR — order {pair} {side} ditolak: {exc}")
            notify_event("error", {"message": f"Order AI gagal: {exc}", "time": iso_now()}, cfg)
            return

        ticket = int(result.get("positionTicket") or 0)
        # simpan fitur ML untuk pembelajaran saat posisi tertutup
        try:
            self._ai_features[ticket] = self.ml.features(best["df"])
        except Exception as exc:  # noqa: BLE001
            self.log.warning(f"Gagal menyimpan fitur ML utk #{ticket}: {exc}")

        self.log.info(
            f"AI OPEN #{ticket} {side} {pair} {volume} lot @ {result.get('price')} "
            f"(score {score:+d}, tf {timeframe}, SL {sl_pips}p, TP {tp_pips}p, "
            f"provider {cfg.ai.provider})"
        )
        self._set_decision(decision)
        notify_event(
            "trade_open",
            {
                "pair": pair,
                "side": side,
                "volume": volume,
                "entry": result.get("price"),
                "stopLoss": result.get("sl"),
                "takeProfit": result.get("tp"),
                "stopLossPips": sl_pips,
                "takeProfitPips": tp_pips,
                "source": f"AI ({cfg.ai.provider}, score {score:+d}, {timeframe})",
                "reasoning": str(final.get("reasoning") or "")[:500],
                "time": iso_now(),
            },
            cfg,
        )

    def _news_block_reason(self) -> str | None:
        """Alasan news gate: event kalender HIGH ± ``avoid_minutes`` menit.

        Tambahan: berita BREAKING/sentimen kuat yang terbit < ``avoid_minutes``
        menit lalu juga memblokir siklus (proteksi kejutan pasar).
        """
        minutes = int(self.config.news.avoid_minutes or 0)
        if minutes <= 0:
            return None
        now = datetime.now(timezone.utc)
        window = minutes * 60.0

        snap = self.state.snapshot()
        for event in snap["calendar"]:
            if str(event.get("impact") or "").upper() != "HIGH":
                continue
            event_time = _parse_iso(event.get("time"))
            if event_time is None:
                continue
            if abs((event_time - now).total_seconds()) <= window:
                title = str(event.get("title") or "event ekonomi")
                return f"news HIGH impact ±{minutes}m: {title}"

        for item in snap["news"]:
            if str(item.get("impact") or "").upper() != "HIGH":
                continue
            published = _parse_iso(item.get("publishedAt"))
            if published is None:
                continue
            age = (now - published).total_seconds()
            if 0 <= age <= window:
                sentiment = abs(float(item.get("sentiment") or 0.0))
                category = str(item.get("category") or "").upper()
                if "BREAKING" in category or sentiment >= 0.6:
                    return f"berita HIGH impact baru: {str(item.get('headline'))[:80]}"
        return None

    def _rank_candidates(
        self, prices: dict[str, dict[str, Any]], exclude: set[str]
    ) -> list[str]:
        """Ranking kandidat pair mode AI: |change%| dominan + spread rapat.

        Mengikuti semangat demo engine: pair paling bergerak (peluang) dengan
        spread tidak lebar diutamakan; ambil 2 teratas.
        """
        scored: list[tuple[str, float]] = []
        for pair, tick in prices.items():
            if pair in exclude:
                continue
            change = abs(float(tick.get("changePct") or 0.0))
            spread = float(tick.get("spread") or 0.0)
            scored.append((pair, change - 0.05 * spread))
        scored.sort(key=lambda x: -x[1])
        return [pair for pair, _ in scored[:2]]

    def _pick_timeframe(self, pair: str) -> str | None:
        """Pilih timeframe analisa.

        Mode manual → ``timeframes[0]``. Mode AI → aturan ATR demo engine:
        ``ATR14(M15) pips > 1.5 × vol per menit`` (diaproksimasi ATR14 M1)
        → pasar ekspansif → ``M5``, selain itu ``M15``.
        """
        cfg = self.config
        if cfg.trading.timeframe_mode == "manual":
            return cfg.trading.timeframes[0] if cfg.trading.timeframes else "M15"
        try:
            m15 = self.client.get_candles(pair, "M15", 100)
            m1 = self.client.get_candles(pair, "M1", 100)
            if m15 is None or m1 is None or len(m15) < 60 or len(m1) < 60:
                return "M15"
            pip = self.client.pip_size(pair)
            if pip <= 0:
                return "M15"
            atr15 = compute_indicators(m15, ["atr"]).get("atr")
            atr1 = compute_indicators(m1, ["atr"]).get("atr")
            value15 = float(getattr(atr15, "value", 0.0) or 0.0)
            value1 = float(getattr(atr1, "value", 0.0) or 0.0)
            if value1 <= 0.0:
                return "M15"
            return "M5" if (value15 / pip) > 1.5 * (value1 / pip) else "M15"
        except Exception as exc:  # noqa: BLE001
            self.log.warning(f"Gagal memilih timeframe AI utk {pair}: {exc}")
            return "M15"

    # ------------------------------------------------------------------
    # POSITION LOOP — manajemen posisi
    # ------------------------------------------------------------------

    def _manage_positions(self) -> None:
        """Satu iterasi manajemen posisi (posisi engine = magic number sama)."""
        if not self.state.status.get("connected"):
            return
        cfg = self.config
        magic = int(cfg.trading.magic)

        raw = self.client.get_open_positions()
        engine_positions = [p for p in raw if int(p.get("magic") or 0) == magic]
        current = {int(p["ticket"]): p for p in engine_positions}

        # --- 1) posisi yang hilang → settle (deal history) -----------------
        for ticket, prev in list(self._known_tickets.items()):
            if ticket not in current:
                self._pending_settle[ticket] = {"pos": prev, "attempts": 0}
        for ticket in list(self._pending_settle.keys()):
            info = self._pending_settle[ticket]
            if ticket in current:  # tidak mungkin utk posisi, tapi jaga-jaga
                self._pending_settle.pop(ticket, None)
                continue
            info["attempts"] = int(info.get("attempts") or 0) + 1
            force = info["attempts"] >= SETTLE_MAX_ATTEMPTS
            if self._settle_closed(ticket, info["pos"], force=force) or force:
                self._pending_settle.pop(ticket, None)

        # --- 2) posisi baru → counter + log ---------------------------------
        for ticket, pos in current.items():
            if ticket in self._known_tickets:
                continue
            source = "AI" if str(pos.get("comment") or "").startswith("AI") else "MANUAL"
            key = "auto_trades" if source == "AI" else "manual_trades"

            def bump(s: AppState, k: str = key) -> None:
                s.status[k] = int(s.status.get(k) or 0) + 1

            self.state.update(bump)
            self.log.info(
                f"Posisi baru {source} #{ticket} {pos.get('side')} {pos.get('pair')} "
                f"{pos.get('volume')} lot @ {pos.get('openPrice')}"
            )
        self._known_tickets = current

        # --- 3) PositionView → state ----------------------------------------
        views = [self._to_position_view(p) for p in engine_positions]
        views.sort(key=lambda v: str(v.get("openedAt") or ""), reverse=True)
        self.state.update(lambda s: s.__setattr__("positions", views))

        # --- 4) trailing stop -------------------------------------------------
        self._apply_trailing(engine_positions)

        # --- 5) margin stop-out watch ------------------------------------------
        self._margin_watch(engine_positions)

    def _to_position_view(self, pos: dict[str, Any]) -> dict[str, Any]:
        """Peta posisi MT5 (snake_case) → ``PositionView`` dashboard (camelCase)."""
        cfg = self.config
        pair = str(pos.get("pair") or "")
        side = str(pos.get("side") or "BUY")
        pip = self.client.pip_size(pair)
        open_price = float(pos.get("openPrice") or 0.0)
        current_price = float(pos.get("currentPrice") or 0.0)
        volume = float(pos.get("volume") or 0.0)
        profit_pips = _pips(side, open_price, current_price, pip)
        comment = str(pos.get("comment") or "")
        ticket = int(pos.get("ticket") or 0)
        trailing_on = (
            ticket in self._trailing_manual
            if cfg.risk.trailing_mode == "manual"
            else profit_pips > AUTO_TRAIL_TRIGGER_PIPS
        )
        return {
            "id": str(ticket),
            "ticket": str(ticket),
            "pair": pair,
            "side": side,
            "volume": volume,
            "openPrice": open_price,
            "currentPrice": current_price,
            "stopLoss": float(pos["stopLoss"]) if pos.get("stopLoss") else None,
            "takeProfit": float(pos["takeProfit"]) if pos.get("takeProfit") else None,
            "trailing": bool(trailing_on),
            "trailingPips": int(cfg.risk.trailing_stop_pips),
            "profit": round(float(pos.get("profit") or 0.0) + float(pos.get("swap") or 0.0), 2),
            "pips": profit_pips,
            # estimasi komisi FINEX: $1/lot/sisi (dicatat penuh saat posisi tertutup)
            "commission": round(volume * 2.0, 2),
            "source": "AI" if comment.startswith("AI") else "MANUAL",
            "openedAt": iso_from_epoch(pos.get("openTime") or 0),
            "comment": comment or None,
            "magic": str(pos.get("magic") or ""),
        }

    def _settle_closed(self, ticket: int, prev: dict[str, Any], force: bool = False) -> bool:
        """Rekonstruksi posisi tertutup dari deal history → riwayat + email + ML.

        Args:
            ticket: ticket posisi MT5.
            prev:   snapshot posisi terakhir yang diketahui engine.
            force:  ``True`` → settle best-effort walau deal history belum ada.

        Returns:
            ``True`` bila settlement selesai (berhasil atau dipaksa).
        """
        deals = self.client.get_deals_for_position(ticket)
        summary = self.client.summarize_deals(deals)
        close_time = float(summary.get("closeTime") or 0.0)
        if close_time <= 0.0 and not force:
            return False  # deal history belum siap → coba lagi iterasi berikutnya

        pair = str(prev.get("pair") or "")
        side = str(prev.get("side") or "BUY")
        pip = self.client.pip_size(pair)
        open_price = float(prev.get("openPrice") or 0.0)
        close_price = float(summary.get("closePrice") or prev.get("currentPrice") or 0.0)
        open_epoch = float(prev.get("openTime") or summary.get("entryTime") or close_time)
        profit = float(summary.get("profit") or 0.0) + float(summary.get("swap") or 0.0)
        commission = abs(float(summary.get("commission") or 0.0))
        comment = str(prev.get("comment") or "")
        source = "AI" if comment.startswith("AI") else "MANUAL"

        reason_code = summary.get("reasonCode")
        if reason_code == self.client.reason_sl():
            reason = "SL"
        elif reason_code == self.client.reason_tp():
            reason = "TP"
        elif reason_code == self.client.reason_so():
            reason = "STOP_OUT"
        else:
            reason = "MANUAL"

        trade = {
            "id": str(ticket),
            "ticket": str(ticket),
            "pair": pair,
            "side": side,
            "volume": float(prev.get("volume") or 0.0),
            "openPrice": open_price,
            "closePrice": close_price,
            "profit": round(profit, 2),
            "pips": _pips(side, open_price, close_price, pip),
            "commission": round(commission, 2),
            "reason": reason,
            "source": source,
            "openedAt": iso_from_epoch(open_epoch),
            "closedAt": iso_from_epoch(close_time),
            "durationSec": max(0, int(close_time - open_epoch)) if close_time else 0,
        }
        self.state.record_history([trade])
        self.log.info(
            f"Posisi ditutup #{ticket} {pair} {reason} → P/L {profit:+.2f} USD "
            f"({trade['pips']:+.1f} pips, source {source})"
        )
        if close_time <= 0.0:
            self.log.warning(
                f"Deal history #{ticket} tidak tersedia setelah {SETTLE_MAX_ATTEMPTS}x "
                f"percobaan — P/L dicatat best-effort."
            )
        notify_event(
            "trade_close",
            {
                "pair": pair,
                "side": side,
                "volume": trade["volume"],
                "entry": open_price,
                "close": close_price,
                "pips": trade["pips"],
                "profit": round(profit, 2),
                "reason": reason,
                "balance": float(self.state.account.get("balance") or 0.0),
                "time": iso_from_epoch(close_time) if close_time else iso_now(),
            },
            self.config,
        )

        # self-learning ML untuk trade AI (fitur disimpan saat order dibuka)
        features = self._ai_features.pop(ticket, None)
        if features is not None:
            win = profit > 0.0
            self.ml.record_result(features, win)
            self.log.info(
                f"Model ML diperbarui dari trade #{ticket}: "
                f"{'WIN' if win else 'LOSS'} (bobot indikator disesuaikan)."
            )
        return True

    def _apply_trailing(self, positions: list[dict[str, Any]]) -> None:
        """Terapkan trailing stop — SL hanya boleh BERGERAK MENUJU harga.

        Mode ``manual``: hanya ticket yang diaktifkan lewat API modify
        (``trailing: true``). Mode ``ai``: otomatis ON saat profit
        > 6 pips (ambang konstanta ``AUTO_TRAIL_TRIGGER_PIPS``).
        """
        cfg = self.config
        mode = str(cfg.risk.trailing_mode or "manual")
        distance_pips = float(cfg.risk.trailing_stop_pips or 6)
        prices = self.state.update(lambda s: dict(s.prices))

        for pos in positions:
            try:
                ticket = int(pos["ticket"])
                pair = str(pos["pair"])
                side = str(pos["side"])
                tick = prices.get(pair)
                if not tick:
                    continue
                pip = self.client.pip_size(pair)
                if pip <= 0:
                    continue
                profit_pips = _pips(side, float(pos.get("openPrice") or 0.0),
                                    float(pos.get("currentPrice") or 0.0), pip)
                if mode == "manual":
                    if ticket not in self._trailing_manual:
                        continue
                elif profit_pips <= AUTO_TRAIL_TRIGGER_PIPS:
                    continue

                distance = distance_pips * pip
                current_sl = float(pos.get("stopLoss") or 0.0)
                digits = self.client.digits(pair)
                if side == "BUY":
                    new_sl = round(float(tick["bid"]) - distance, digits)
                    improves = current_sl <= 0.0 or (new_sl - current_sl) >= TRAIL_MODIFY_MIN_PIPS * pip
                else:
                    new_sl = round(float(tick["ask"]) + distance, digits)
                    improves = current_sl <= 0.0 or (current_sl - new_sl) >= TRAIL_MODIFY_MIN_PIPS * pip
                if not improves or new_sl <= 0.0:
                    continue
                tp = float(pos.get("takeProfit") or 0.0)
                if self.client.modify_position(ticket, new_sl, tp):
                    self.log.info(
                        f"Trailing #{ticket} {pair}: SL → {new_sl} "
                        f"(+{profit_pips:.1f} pips, jarak {distance_pips:.0f}p)"
                    )
            except Exception as exc:  # noqa: BLE001 - satu posisi gagal ≠ engine mati
                self.log.warning(f"Trailing gagal utk #{pos.get('ticket')}: {exc}")

    def _margin_watch(self, positions: list[dict[str, Any]]) -> None:
        """Pantau margin level < 20% → tutup posisi terburuk + email error."""
        acc = self.state.update(lambda s: dict(s.account))
        margin = float(acc.get("margin") or 0.0)
        level = float(acc.get("marginLevel") or 0.0)
        if margin <= 0.0 or level <= 0.0 or level >= STOP_OUT_LEVEL:
            return
        if not positions:
            return
        if time.monotonic() < self._stopout_until:
            return
        worst = min(positions, key=lambda p: float(p.get("profit") or 0.0))
        ticket = int(worst["ticket"])
        self.log.error(
            f"RISK: Margin level {level:.1f}% < {STOP_OUT_LEVEL:.0f}% — "
            f"menutup posisi terburuk #{ticket} {worst.get('pair')} "
            f"(P/L {float(worst.get('profit') or 0.0):+.2f})."
        )
        try:
            self.client.close_position(ticket)
            notify_event(
                "error",
                {
                    "message": (
                        f"STOP OUT: margin level {level:.1f}% — posisi #{ticket} "
                        f"{worst.get('pair')} ditutup paksa oleh engine."
                    ),
                    "details": f"Margin {margin:.2f}, level {level:.1f}%",
                    "time": iso_now(),
                },
                self.config,
            )
        except MT5Error as exc:
            self.log.error(f"Gagal menutup posisi saat stop-out watch: {exc}")
        self._stopout_until = time.monotonic() + 10.0

    # ------------------------------------------------------------------
    # NEWS LOOP — Finnhub + MarketAux + kalender ekonomi
    # ------------------------------------------------------------------

    def _fetch_news(self) -> None:
        """Ambil berita (jika ada API key), klasifikasi sentimen AI, + kalender."""
        cfg = self.config
        try:
            items = asyncio.run(fetch_all(cfg))
            if items:
                headlines = [str(i.get("headline") or "") for i in items]
                try:
                    scores = asyncio.run(
                        analyze_sentiment(headlines, cfg.ai.provider, cfg)
                    )
                except Exception as exc:  # noqa: BLE001 - fallback heuristik internal
                    self.log.debug(f"analyze_sentiment gagal: {exc}")
                    scores = []
                for index, item in enumerate(items):
                    if index < len(scores):
                        item["sentiment"] = round(float(scores[index]), 4)
                    raw_id = f"{item.get('headline')}|{item.get('publishedAt')}"
                    item["id"] = hashlib.md5(raw_id.encode("utf-8")).hexdigest()[:16]
                self.state.set_news(items)
                self.log.info(f"Berita diperbarui: {len(items)} item "
                              f"(sumber Finnhub/MarketAux, sentimen AI).")
        except Exception as exc:  # noqa: BLE001
            self.log.warning(f"Fetch berita gagal: {exc}")

        try:
            events = economic_calendar(days=3)
            now = datetime.now(timezone.utc)
            for event in events:
                event_time = _parse_iso(event.get("time"))
                delta = (event_time - now).total_seconds() / 60.0 if event_time else 0.0
                event["minutesUntil"] = int(round(delta))
            self.state.set_calendar(events)
            self.log.info(f"Kalender ekonomi diperbarui: {len(events)} event (3 hari ke depan).")
        except Exception as exc:  # noqa: BLE001
            self.log.warning(f"Kalender ekonomi gagal diperbarui: {exc}")

    # ------------------------------------------------------------------
    # ALERTS LOOP — cek alert harga
    # ------------------------------------------------------------------

    def _check_alerts(self) -> None:
        """Cek alert harga terhadap harga terbaru → log + email."""
        prices = self.state.update(lambda s: dict(s.prices))
        if not prices:
            return
        try:
            triggered = self.alerts.check(prices)
        except Exception as exc:  # noqa: BLE001
            self.log.warning(f"Cek alert gagal: {exc}")
            return
        for alert in triggered:
            tick = prices.get(alert.get("pair")) or {}
            self.state.record_alert(alert)
            self.log.info(
                f"Alert TERPICU: {alert.get('pair')} {alert.get('condition')} "
                f"{alert.get('price')} (bid {tick.get('bid')} / ask {tick.get('ask')})"
            )
            notify_event(
                "alert",
                {
                    "pair": alert.get("pair"),
                    "condition": alert.get("condition"),
                    "price": alert.get("price"),
                    "bid": tick.get("bid"),
                    "ask": tick.get("ask"),
                    "note": alert.get("note"),
                    "time": iso_now(),
                },
                self.config,
            )

    # ------------------------------------------------------------------
    # API actions (dipanggil endpoint FastAPI — validasi → ValueError 400)
    # ------------------------------------------------------------------

    def api_open_order(self, body: dict[str, Any]) -> dict[str, Any]:
        """Buka posisi manual (validasi sama seperti demo: max posisi, lot clamp)."""
        cfg = self.config
        pair = str(body.get("pair") or "").upper()
        if pair not in KNOWN_PAIRS:
            raise ValueError(f"Pair tidak valid: {pair} (valid: {', '.join(KNOWN_PAIRS)}).")
        side = str(body.get("side") or "").upper()
        if side not in ("BUY", "SELL"):
            raise ValueError("Side harus BUY atau SELL.")
        if self.state.open_position_count() >= int(cfg.risk.max_positions):
            raise ValueError(f"Maksimal {cfg.risk.max_positions} posisi tercapai.")

        sl_pips = body.get("stopLossPips")
        sl_pips = float(sl_pips) if sl_pips else float(cfg.risk.stop_loss_pips)
        if not 1.0 <= sl_pips <= 100.0:
            raise ValueError("stopLossPips harus 1-100.")
        tp_raw = body.get("takeProfitPips")
        tp_pips = float(tp_raw) if tp_raw else round(sl_pips * float(cfg.risk.take_profit_ratio), 1)
        if not 1.0 <= tp_pips <= 500.0:
            raise ValueError("takeProfitPips harus 1-500.")

        if bool(body.get("riskBased")):
            equity = float(self.state.account.get("equity") or 0.0)
            pip_value = self.client.pip_value(pair)
            denom = sl_pips * pip_value
            if equity <= 0.0 or denom <= 0.0:
                raise ValueError("Tidak bisa menghitung lot berbasis risiko (equity/pip value kosong).")
            volume = equity * float(cfg.risk.risk_per_trade) / 100.0 / denom
        else:
            raw_volume = body.get("volume")
            if raw_volume is None:
                raise ValueError("volume wajib diisi (atau gunakan riskBased=true).")
            try:
                volume = float(raw_volume)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"Volume tidak valid: {raw_volume!r}") from exc
            if volume <= 0.0:
                raise ValueError("Volume harus > 0.")
        volume = self.client.normalize_volume(pair, volume)
        if volume <= 0.0:
            raise ValueError("Volume di bawah minimum broker (0.01).")

        source = str(body.get("source") or "MANUAL").upper()
        comment = str(body.get("comment") or source)[:31]

        if cfg.dry_run:
            self.log.info(
                f"[DRY-RUN] Order manual dilewati: {side} {pair} {volume} lot "
                f"SL {sl_pips}p / TP {tp_pips}p."
            )
            return {"success": True, "dryRun": True, "pair": pair, "side": side, "volume": volume}

        result = self.client.market_order(pair, side, volume, sl_pips, tp_pips, comment, int(cfg.trading.magic))
        ticket = int(result.get("positionTicket") or 0)
        self.log.info(
            f"Order manual #{ticket} {side} {pair} {volume} lot @ {result.get('price')} "
            f"(SL {sl_pips}p, TP {tp_pips}p)"
        )
        notify_event(
            "trade_open",
            {
                "pair": pair,
                "side": side,
                "volume": volume,
                "entry": result.get("price"),
                "stopLoss": result.get("sl"),
                "takeProfit": result.get("tp"),
                "stopLossPips": sl_pips,
                "takeProfitPips": tp_pips,
                "source": "MANUAL (via dashboard)",
                "time": iso_now(),
            },
            cfg,
        )
        return {
            "success": True,
            "retcode": int(result.get("retcode") or 0),
            "id": str(ticket),
            "ticket": str(ticket),
            "pair": pair,
            "side": side,
            "volume": volume,
            "openPrice": float(result.get("price") or 0.0),
            "currentPrice": float(result.get("price") or 0.0),
            "stopLoss": float(result.get("sl") or 0.0) or None,
            "takeProfit": float(result.get("tp") or 0.0) or None,
            "trailing": False,
            "trailingPips": int(cfg.risk.trailing_stop_pips),
            "profit": 0.0,
            "pips": 0.0,
            "commission": round(volume * 2.0, 2),
            "source": "MANUAL",
            "openedAt": iso_now(),
            "comment": comment,
            "magic": str(cfg.trading.magic),
        }

    def api_close_order(self, body: dict[str, Any]) -> dict[str, Any]:
        """Tutup satu posisi manual (settlement dicatat position loop)."""
        ticket = self._ticket_from_body(body)
        if self.config.dry_run:
            self.log.info(f"[DRY-RUN] Close #{ticket} dilewati.")
            return {"success": True, "dryRun": True, "closed": 1}
        self.client.close_position(ticket)
        self.log.info(f"Posisi #{ticket} ditutup manual (via dashboard).")
        return {"success": True, "closed": 1}

    def api_close_all(self) -> dict[str, Any]:
        """Tutup semua posisi engine (magic number sama)."""
        if self.config.dry_run:
            self.log.info("[DRY-RUN] closeAll dilewati.")
            return {"success": True, "dryRun": True, "closed": 0}
        snap = self.state.snapshot()
        closed = 0
        for view in snap["positions"]:
            try:
                self.client.close_position(int(view["ticket"]))
                closed += 1
            except MT5Error as exc:
                self.log.error(f"closeAll: gagal menutup #{view.get('ticket')}: {exc}")
        self.log.info(f"closeAll: {closed} posisi ditutup manual (via dashboard).")
        return {"success": True, "closed": closed}

    def api_modify_order(self, body: dict[str, Any]) -> dict[str, Any]:
        """Ubah SL/TP absolut dan/atau flag trailing posisi."""
        ticket = self._ticket_from_body(body)
        snap = self.state.snapshot()
        view = next(
            (p for p in snap["positions"] if str(p.get("ticket")) == str(ticket)), None,
        )
        if view is None:
            raise ValueError(f"Posisi #{ticket} tidak ditemukan (mungkin sudah tertutup).")

        has_sl = "stopLoss" in body
        has_tp = "takeProfit" in body
        trailing = body.get("trailing")
        if not (has_sl or has_tp or trailing is not None):
            raise ValueError("Tidak ada perubahan (stopLoss/takeProfit/trailing).")

        if trailing is not None:
            if bool(trailing):
                self._trailing_manual.add(ticket)
            else:
                self._trailing_manual.discard(ticket)
            self.log.info(f"Trailing #{ticket} {'ON' if trailing else 'OFF'} (mode manual).")

        sl: float | None = view.get("stopLoss")
        tp: float | None = view.get("takeProfit")
        if has_sl:
            sl = float(body["stopLoss"]) if body.get("stopLoss") is not None else None
        if has_tp:
            tp = float(body["takeProfit"]) if body.get("takeProfit") is not None else None
        if has_sl or has_tp:
            if not self.client.modify_position(ticket, sl, tp):
                raise MT5Error(f"Modify posisi #{ticket} ditolak broker.")
            self.log.info(f"Modify #{ticket}: SL={sl} TP={tp}.")
        return {"success": True}

    def _ticket_from_body(self, body: dict[str, Any]) -> int:
        """Ambil ticket (positionId) dari body order — ValueError bila invalid."""
        raw = body.get("positionId") or body.get("ticket") or body.get("position")
        try:
            ticket = int(str(raw).strip())
        except (TypeError, ValueError) as exc:
            raise ValueError(f"positionId tidak valid: {raw!r}") from exc
        if ticket <= 0:
            raise ValueError("positionId harus > 0.")
        return ticket

    def api_candles(self, pair: str, timeframe: str, limit: int) -> list[dict[str, Any]]:
        """Ambil candle historis → ``Candle[]`` (epoch ms)."""
        df = self.client.get_candles(pair, timeframe, limit)
        if df is None or len(df) == 0:
            return []
        digits = self.client.digits(pair)
        out: list[dict[str, Any]] = []
        for record in df.to_dict("records"):
            ts = record.get("time")
            try:
                time_ms = int(ts.value // 1_000_000) if ts is not None else 0  # ns → ms
            except (AttributeError, TypeError, ValueError):
                time_ms = 0
            out.append({
                "time": time_ms,
                "open": round(float(record["open"]), digits),
                "high": round(float(record["high"]), digits),
                "low": round(float(record["low"]), digits),
                "close": round(float(record["close"]), digits),
                "volume": float(record.get("tick_volume") or 0.0),
            })
        return out

    # ------------------------------------------------------------------
    # Settings runtime
    # ------------------------------------------------------------------

    def settings_summary(self) -> dict[str, Any]:
        """Ringkasan konfigurasi efektif (tanpa rahasia)."""
        cfg = self.config
        return {
            "tradingMode": cfg.trading.mode,
            "pairMode": cfg.trading.pair_mode,
            "pairs": cfg.trading.pairs,
            "sessionMode": cfg.trading.session_mode,
            "sessions": cfg.trading.sessions,
            "timeframeMode": cfg.trading.timeframe_mode,
            "timeframes": cfg.trading.timeframes,
            "aiProvider": cfg.ai.provider,
            "aiModel": cfg.ai.model,
            "indicatorMode": cfg.indicators.mode,
            "indicators": cfg.indicators.list,
            "riskMode": cfg.risk.mode,
            "riskPerTrade": cfg.risk.risk_per_trade,
            "stopLossPips": cfg.risk.stop_loss_pips,
            "takeProfitRatio": cfg.risk.take_profit_ratio,
            "maxPositions": cfg.risk.max_positions,
            "dailyRiskLimit": cfg.risk.daily_risk_limit,
            "dailyTarget": cfg.risk.daily_target,
            "avoidNews": cfg.risk.avoid_news,
            "trailingMode": cfg.risk.trailing_mode,
            "trailingStopPips": cfg.risk.trailing_stop_pips,
            "newsAvoidMinutes": cfg.news.avoid_minutes,
            "emailEnabled": cfg.email.enabled,
            "emailEvents": cfg.email.events,
            "magic": cfg.trading.magic,
            "dryRun": cfg.dry_run,
            "api": {"host": cfg.api.host, "port": cfg.api.port},
            "mt5": {"server": cfg.mt5.server, "login": _mask_login(cfg.mt5.login or self.state.account.get("login"))},
            "warnings": list(cfg.warnings),
        }

    def api_patch_settings(self, body: dict[str, Any]) -> dict[str, Any]:
        """Patch konfigurasi runtime (mode, seleksi, risiko) + persist ke YAML.

        Raises:
            ValueError: bila ada nilai tidak valid (→ HTTP 400).
        """
        cfg = self.config
        errors: list[str] = []

        mode_targets: dict[str, tuple[Any, str]] = {
            "tradingMode": (cfg.trading, "mode"),
            "pairMode": (cfg.trading, "pair_mode"),
            "sessionMode": (cfg.trading, "session_mode"),
            "timeframeMode": (cfg.trading, "timeframe_mode"),
            "indicatorMode": (cfg.indicators, "mode"),
            "riskMode": (cfg.risk, "mode"),
            "trailingMode": (cfg.risk, "trailing_mode"),
        }
        for key, (section, attr) in mode_targets.items():
            if key in body:
                value = str(body.get(key) or "").lower()
                if value not in KNOWN_MODES:
                    errors.append(f"{key} harus {'/'.join(KNOWN_MODES)}.")
                else:
                    setattr(section, attr, value)

        list_targets: dict[str, tuple[Any, str, tuple[str, ...], Callable[[Any], str]]] = {
            "pairs": (cfg.trading, "pairs", KNOWN_PAIRS, lambda x: str(x).upper()),
            "sessions": (cfg.trading, "sessions", KNOWN_SESSIONS, lambda x: str(x).lower()),
            "timeframes": (cfg.trading, "timeframes", KNOWN_TIMEFRAMES, lambda x: str(x).upper()),
            "indicators": (cfg.indicators, "list", KNOWN_INDICATORS, lambda x: str(x).lower()),
            "emailEvents": (cfg.email, "events", tuple(cfg.email.events or ()), lambda x: str(x).lower()),
        }
        for key, (section, attr, valid, normalize) in list_targets.items():
            if key in body:
                raw = body.get(key)
                if not isinstance(raw, list) or not raw:
                    errors.append(f"{key} harus berupa list dan minimal 1 item.")
                    continue
                values: list[str] = []
                for item in raw:
                    value = normalize(item)
                    if value in valid and value not in values:
                        values.append(value)
                if not values:
                    errors.append(f"{key}: tidak ada nilai yang valid (valid: {', '.join(valid)}).")
                else:
                    setattr(section, attr, values)

        if "aiProvider" in body:
            provider = str(body.get("aiProvider") or "").lower()
            if provider not in KNOWN_PROVIDERS:
                errors.append(f"aiProvider tidak valid (valid: {', '.join(KNOWN_PROVIDERS)}).")
            else:
                cfg.ai.provider = provider
        if "aiModel" in body:
            cfg.ai.model = str(body.get("aiModel") or "").strip()

        scalar_targets: dict[str, tuple[Any, str, Callable[[Any], Any]]] = {
            "riskPerTrade": (cfg.risk, "risk_per_trade", float),
            "stopLossPips": (cfg.risk, "stop_loss_pips", lambda v: int(float(v))),
            "takeProfitRatio": (cfg.risk, "take_profit_ratio", float),
            "maxPositions": (cfg.risk, "max_positions", lambda v: int(float(v))),
            "dailyRiskLimit": (cfg.risk, "daily_risk_limit", float),
            "dailyTarget": (cfg.risk, "daily_target", float),
            "trailingStopPips": (cfg.risk, "trailing_stop_pips", lambda v: int(float(v))),
            "newsAvoidMinutes": (cfg.news, "avoid_minutes", lambda v: int(float(v))),
        }
        for key, (section, attr, cast) in scalar_targets.items():
            if key not in body:
                continue
            try:
                setattr(section, attr, cast(body.get(key)))
            except (TypeError, ValueError):
                errors.append(f"{key} bukan angka yang valid.")

        if "avoidNews" in body:
            cfg.risk.avoid_news = bool(body.get("avoidNews"))
        if "emailEnabled" in body:
            cfg.email.enabled = bool(body.get("emailEnabled"))

        if errors:
            raise ValueError("; ".join(errors))

        cfg.validate()
        try:
            cfg.save()
        except Exception as exc:  # noqa: BLE001 - persist gagal ≠ fatal
            self.log.warning(f"Gagal menyimpan config.yaml: {exc}")
        self.state.update(lambda s: s.status.__setitem__(
            "ai_trading", cfg.trading.mode == "ai"))
        changed = sorted(k for k in body if k in {
            *mode_targets, *list_targets, *scalar_targets,
            "aiProvider", "aiModel", "avoidNews", "emailEnabled",
        })
        self.log.info(f"Settings diperbarui via API: {', '.join(changed) or '(tanpa perubahan)'}")
        return {"ok": True, "changed": changed, "settings": self.settings_summary()}

    # ------------------------------------------------------------------
    # Log reader (endpoint /api/v1/logs)
    # ------------------------------------------------------------------

    def read_logs(
        self,
        level: str | None = None,
        category: str | None = None,
        query: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """Baca ekor ``logs/engine.log`` → ``LogEntryView[]`` (terbaru dulu)."""
        entries: list[dict[str, Any]] = []
        try:
            if not LOG_FILE.exists():
                return entries
            with LOG_FILE.open("r", encoding="utf-8", errors="replace") as handle:
                lines = handle.readlines()[-LOG_TAIL_LINES:]
        except OSError as exc:
            self.log.warning(f"Gagal membaca log: {exc}")
            return entries

        level_filter = (level or "").strip().upper()
        category_filter = (category or "").strip().upper()
        query_lower = (query or "").lower()

        for line in reversed(lines):
            match = _MAIN_LOG_LINE.match(line.strip())
            if not match:
                continue
            raw_time, raw_level, logger_name, message = match.groups()
            entry_level = raw_level.upper()
            if entry_level == "WARNING":
                entry_level = "WARN"
            elif entry_level == "CRITICAL":
                entry_level = "ERROR"
            if entry_level not in ("INFO", "WARN", "ERROR", "DEBUG"):
                entry_level = "INFO"
            short = logger_name.split(".")[-1] if "." in logger_name else logger_name
            entry_category = _CATEGORY_MAP.get(short, short.upper() or "SYSTEM")
            if level_filter and entry_level != level_filter:
                continue
            if category_filter and entry_category != category_filter:
                continue
            if query_lower and query_lower not in message.lower():
                continue
            try:
                local_dt = datetime.strptime(raw_time, "%Y-%m-%d %H:%M:%S,%f")
                created = local_dt.astimezone(timezone.utc).isoformat()
            except ValueError:
                created = iso_now()
            entries.append({
                "id": f"l{len(entries)}",
                "level": entry_level,
                "category": entry_category,
                "message": message,
                "details": None,
                "createdAt": created,
            })
            if len(entries) >= limit:
                break
        return entries


# ---------------------------------------------------------------------------
# FastAPI server
# ---------------------------------------------------------------------------

api = FastAPI(
    title="FINEX AI Trading Engine",
    description="Engine trading LIVE (MetaTrader 5, FINEX Indonesia) — polling dashboard.",
    version=ENGINE_VERSION,
)

_ENGINE: Engine | None = None

#: Origin CORS yang diizinkan — list bersama yang diisi ulang dari config
#: (``api.allowed_origins``) oleh :func:`set_engine` sebelum uvicorn menerima
#: request pertama (CORSMiddleware memegang referensi list yang sama).
_CORS_ORIGINS: list[str] = ["http://localhost:3000"]

#: Waktu modul API dimuat — untuk ``uptime_s`` endpoint publik ``/health``.
_API_STARTED: float = time.time()


@api.middleware("http")
async def _engine_key_auth(request: Request, call_next: Callable) -> Any:
    """Guard autentikasi header ``X-Engine-Key`` untuk SEMUA path ``/api/*``.

    Aktif hanya bila ``api.api_key`` diisi (config.yaml atau env
    ``ENGINE_API_KEY``); perbandingan memakai ``hmac.compare_digest``
    (konstan-waktu, anti timing attack). Path di luar ``/api/`` — termasuk
    ``/health`` untuk uptime monitoring — tidak diminta kunci. Preflight
    CORS (OPTIONS) dijawab middleware CORS yang lebih luar sehingga tidak
    pernah sampai ke guard ini.
    """
    expected = _ENGINE.config.api.api_key if _ENGINE is not None else ""
    if expected and request.url.path.startswith("/api/"):
        provided = request.headers.get("x-engine-key", "")
        if not hmac.compare_digest(provided.encode("utf-8"), expected.encode("utf-8")):
            return JSONResponse(
                status_code=401,
                content={"detail": "invalid or missing engine key"},
            )
    return await call_next(request)


# Ditambahkan SETELAH guard di atas agar CORSMiddleware menjadi lapisan
# TERLUAR: preflight OPTIONS dijawab CORS (tanpa kunci), request sebenarnya
# tetap dicek X-Engine-Key oleh guard.
api.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


def set_engine(engine: Engine) -> None:
    """Pasang instance engine global (dipanggil ``main()`` sebelum uvicorn)."""
    global _ENGINE
    _ENGINE = engine
    # Terapkan origin CORS dari config (mutasi in-place — CORSMiddleware
    # memegang referensi list ``_CORS_ORIGINS`` yang sama).
    _CORS_ORIGINS[:] = [str(o) for o in engine.config.api.allowed_origins]
    if not engine.config.api.api_key:
        get_logger("main").warning(
            "ENGINE API key TIDAK diatur — endpoint /api/* terbuka tanpa autentikasi."
        )


def get_engine() -> Engine:
    """Ambil instance engine global (503 bila belum siap)."""
    if _ENGINE is None:
        raise RuntimeError("Engine belum diinisialisasi.")
    return _ENGINE


def _error(message: str, status: int = 400) -> JSONResponse:
    """Respons error standar (bentuk sama seperti demo: ``{error}``)."""
    return JSONResponse(status_code=status, content={"error": message})


@api.get("/")
def root() -> dict[str, Any]:
    """Info singkat engine."""
    engine = get_engine()
    connected = bool(engine.state.status.get("connected"))
    uptime = (datetime.now(timezone.utc) - engine.state.started_at).total_seconds()
    return {
        "name": "FINEX AI Trading Engine",
        "version": ENGINE_VERSION,
        "mode": "LIVE",
        "mt5Connected": connected,
        "uptimeSec": round(uptime, 1),
        "docs": "/docs",
        "poll": "/api/v1/poll",
    }


@api.get("/health")
def health_public() -> dict[str, Any]:
    """Health publik untuk uptime monitoring — TANPA autentikasi.

    Sengaja berada di luar prefix ``/api/`` sehingga lolos guard
    ``X-Engine-Key``. Tidak menyentuh state engine sama sekali sehingga
    selalu cepat dan tidak bisa gagal karena MT5/engine belum siap.
    """
    return {
        "status": "ok",
        "version": ENGINE_VERSION,
        "uptime_s": round(time.time() - _API_STARTED, 1),
    }


@api.get("/api/v1/poll")
def poll() -> dict[str, Any]:
    """Polling utama dashboard (``EnginePollResponse``) — 100% dari cache state.

    TIDAK memanggil MT5 sama sekali sehingga dijamin < 2.5 detik
    (proxy Next.js memakai timeout 2.5s).
    """
    engine = get_engine()
    cfg = engine.config
    snap = engine.state.snapshot()
    status = snap["status"]
    account = snap["account"]

    started_iso = snap["started_at"].isoformat()
    equity = float(account.get("equity") or 0.0)
    start_balance = float(snap["daily_start_balance"] or 0.0)
    daily_pnl = equity - start_balance
    daily_pct = engine.state.daily_pnl_pct()
    prices = [
        snap["prices"][pair]
        for pair in KNOWN_PAIRS
        if pair in snap["prices"]
    ]

    return {
        "status": {
            "mode": "LIVE",
            "connected": bool(status.get("connected")),
            "aiTrading": bool(status.get("ai_trading")),
            "autoTradeCount": int(status.get("auto_trades") or 0),
            "manualTradeCount": int(status.get("manual_trades") or 0),
            "lastTickAt": str(status.get("last_tick") or started_iso),
            "marketOpen": bool(status.get("market_open")),
            "activeSessions": list(status.get("active_sessions") or []),
            "latencyMs": _r2(status.get("latency_ms")),
            "version": ENGINE_VERSION,
            "lastAiDecision": status.get("last_ai_decision"),
            "dailyBlocked": str(status.get("daily_blocked") or "NONE"),
        },
        "account": {
            "balance": _r2(account.get("balance")),
            "equity": _r2(account.get("equity")),
            "margin": _r2(account.get("margin")),
            "freeMargin": _r2(account.get("freeMargin")),
            "marginLevel": _r2(account.get("marginLevel")),
            "floatingPnl": _r2(account.get("floatingPnl")),
            "dailyPnl": _r2(daily_pnl),
            "dailyPnlPct": _r4(daily_pct),
            "dailyStartBalance": _r2(start_balance),
            "dailyTargetPct": float(cfg.risk.daily_target),
            "dailyLimitPct": float(cfg.risk.daily_risk_limit),
            "currency": str(account.get("currency") or "USD"),
            "leverage": int(account.get("leverage") or 500),
            "server": str(account.get("server") or cfg.mt5.server),
            "login": _mask_login(account.get("login") or cfg.mt5.login),
            "mode": "LIVE",
        },
        "prices": prices,
        "openPositions": len(snap["positions"]),
        "dailyPnlPct": _r4(daily_pct),
    }


@api.get("/api/v1/health")
def health() -> dict[str, Any]:
    """Health check ringan."""
    engine = get_engine()
    connected = bool(engine.state.status.get("connected"))
    uptime = (datetime.now(timezone.utc) - engine.state.started_at).total_seconds()
    return {
        "ok": True,
        "mt5": connected,
        "version": ENGINE_VERSION,
        "uptime": round(uptime, 1),
        "aiTrading": bool(engine.state.status.get("ai_trading")),
    }


@api.get("/api/v1/positions")
def positions() -> list[dict[str, Any]]:
    """Daftar posisi terbuka milik engine (``PositionView[]``)."""
    engine = get_engine()
    return engine.state.snapshot()["positions"]


@api.get("/api/v1/history")
def history(limit: int = Query(default=50, ge=1, le=200)) -> list[dict[str, Any]]:
    """Riwayat posisi tertutup (``ClosedTrade[]``, terbaru dulu)."""
    engine = get_engine()
    return engine.state.snapshot()["history"][:limit]


@api.post("/api/v1/orders")
async def orders(request: Request) -> JSONResponse:
    """Trading manual: ``open`` / ``close`` / ``closeAll`` / ``modify``."""
    engine = get_engine()
    try:
        body = await request.json()
    except Exception as exc:  # noqa: BLE001 - body bukan JSON
        return _error(f"Body bukan JSON valid: {exc}")
    if not isinstance(body, dict):
        return _error("Body harus berupa objek JSON.")
    action = str(body.get("action") or "").lower()

    try:
        if action == "open":
            result = await run_in_threadpool(engine.api_open_order, body)
            return JSONResponse(status_code=200, content=result)
        if action == "close":
            result = await run_in_threadpool(engine.api_close_order, body)
            return JSONResponse(status_code=200, content=result)
        if action == "closeall":
            result = await run_in_threadpool(engine.api_close_all)
            return JSONResponse(status_code=200, content=result)
        if action == "modify":
            result = await run_in_threadpool(engine.api_modify_order, body)
            return JSONResponse(status_code=200, content=result)
        return _error(f"Action tidak dikenal: {action} (valid: open|close|closeAll|modify).")
    except ValueError as exc:
        return _error(str(exc))
    except MT5Error as exc:
        return _error(str(exc))


@api.get("/api/v1/candles")
async def candles(
    pair: str = Query(...),
    tf: str = Query(...),
    limit: int = Query(default=200, ge=1, le=1000),
) -> JSONResponse:
    """Candle historis → ``Candle[]`` (panggilan MT5 langsung)."""
    engine = get_engine()
    pair_up = pair.strip().upper()
    tf_up = tf.strip().upper()
    if pair_up not in KNOWN_PAIRS:
        return _error(f"Pair tidak valid: {pair} (valid: {', '.join(KNOWN_PAIRS)}).")
    if tf_up not in KNOWN_TIMEFRAMES:
        return _error(f"Timeframe tidak valid: {tf} (valid: {', '.join(KNOWN_TIMEFRAMES)}).")
    try:
        rows = await run_in_threadpool(engine.api_candles, pair_up, tf_up, limit)
        return JSONResponse(status_code=200, content=rows)
    except MT5Error as exc:
        return _error(str(exc), status=503)


@api.get("/api/v1/news")
def news_items() -> list[dict[str, Any]]:
    """Berita terbaru (``NewsItemView[]``)."""
    engine = get_engine()
    return engine.state.snapshot()["news"]


@api.get("/api/v1/calendar")
def calendar_events() -> list[dict[str, Any]]:
    """Kalender ekonomi (``CalendarEvent[]``)."""
    engine = get_engine()
    return engine.state.snapshot()["calendar"]


@api.get("/api/v1/settings")
def get_settings() -> dict[str, Any]:
    """Konfigurasi runtime efektif (tanpa kredensial)."""
    return get_engine().settings_summary()


@api.post("/api/v1/settings")
async def patch_settings(request: Request) -> JSONResponse:
    """Patch konfigurasi runtime (mode, seleksi, parameter risiko)."""
    engine = get_engine()
    try:
        body = await request.json()
    except Exception as exc:  # noqa: BLE001
        return _error(f"Body bukan JSON valid: {exc}")
    if not isinstance(body, dict):
        return _error("Body harus berupa objek JSON.")
    try:
        result = await run_in_threadpool(engine.api_patch_settings, body)
        return JSONResponse(status_code=200, content=result)
    except ValueError as exc:
        return _error(str(exc))


@api.get("/api/v1/ai-keys")
def get_ai_keys() -> dict[str, Any]:
    """Status runtime key override dari dashboard (TANPA secret).

    Dipakai dashboard untuk deteksi drift / verifikasi pasca-restart engine.
    Response: ``{syncedAt: iso | null, providers: {id: {hasKey, baseUrl, model}}}``.
    """
    return runtime_key_status()


@api.put("/api/v1/ai-keys")
async def put_ai_keys(request: Request) -> JSONResponse:
    """Terima kredensial AI dari dashboard (runtime override, hanya memori).

    Body: ``{providers: {id: {apiKey?, baseUrl?, model?}}, syncedAt?}`` —
    mengganti seluruh set override (provider yang tidak disertakan dikembalikan
    ke resolusi ``.env`` engine). Nilai kunci TIDAK PERNAH di-log atau
    ditulis ke disk; endpoint ini dilindungi guard ``X-Engine-Key``
    (middleware ``/api/*``) sama seperti endpoint engine lainnya.
    """
    try:
        body = await request.json()
    except Exception as exc:  # noqa: BLE001
        return _error(f"Body bukan JSON valid: {exc}")
    if not isinstance(body, dict):
        return _error("Body harus berupa objek JSON.")
    try:
        result = await run_in_threadpool(set_runtime_keys, body)
    except ValueError as exc:
        return _error(str(exc))
    return JSONResponse(status_code=200, content={"ok": True, **result})


@api.delete("/api/v1/ai-keys")
def delete_ai_keys() -> dict[str, Any]:
    """Kosongkan seluruh runtime key override (kembali ke ``.env`` engine)."""
    clear_runtime_keys()
    return {"ok": True}


@api.get("/api/v1/alerts")
def get_alerts(status: str | None = Query(default=None)) -> list[dict[str, Any]]:
    """Daftar alert harga (``AlertView[]``)."""
    return get_engine().alerts.list(status)


@api.post("/api/v1/alerts")
async def add_alert(request: Request) -> JSONResponse:
    """Tambah alert harga: ``{pair, condition: ABOVE|BELOW, price, note}``."""
    engine = get_engine()
    try:
        body = await request.json()
    except Exception as exc:  # noqa: BLE001
        return _error(f"Body bukan JSON valid: {exc}")
    if not isinstance(body, dict):
        return _error("Body harus berupa objek JSON.")
    pair = str(body.get("pair") or "").upper()
    if pair not in KNOWN_PAIRS:
        return _error(f"Pair tidak valid: {pair} (valid: {', '.join(KNOWN_PAIRS)}).")
    try:
        alert = await run_in_threadpool(
            engine.alerts.add,
            pair,
            str(body.get("condition") or ""),
            body.get("price"),
            str(body.get("note") or ""),
        )
        return JSONResponse(status_code=200, content=alert)
    except ValueError as exc:
        return _error(str(exc))


@api.get("/api/v1/logs")
def get_logs(
    level: str | None = Query(default=None),
    category: str | None = Query(default=None),
    q: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
) -> list[dict[str, Any]]:
    """Log engine (``LogEntryView[]``, terbaru dulu) — parser format app.logger."""
    return get_engine().read_logs(level, category, q, limit)


# ---------------------------------------------------------------------------
# Banner + main
# ---------------------------------------------------------------------------


def _print_banner(config: Config) -> None:
    """Cetak banner startup ke console (+ satu baris log INFO)."""
    provider_status = ""
    try:
        from app.ai_providers import get_provider_status

        configured = [p["id"] for p in get_provider_status() if p.get("configured")]
        provider_status = f"{config.ai.provider}" + (
            f" (terkonfigurasi: {', '.join(configured)})" if configured else " (BELUM ada API key)"
        )
    except Exception:  # noqa: BLE001
        provider_status = config.ai.provider

    line = "=" * 66
    print(line)
    print(f"  FINEX AI TRADING ENGINE v{ENGINE_VERSION}  —  LIVE / FINEX Indonesia")
    print(line)
    print(f"  Python      : {sys.version.split()[0]}  ({sys.platform})")
    print(f"  Paket MT5   : {'tersedia' if MT5_AVAILABLE else 'TIDAK tersedia (butuh Windows!)'}")
    print(f"  Konfigurasi : {config.source_path or 'config.yaml'} "
          f"({len(config.warnings)} peringatan)")
    print(f"  Mode trading: {config.trading.mode}   |  Provider AI: {provider_status}")
    print(f"  Pair aktif  : {', '.join(config.trading.pairs)}")
    print(f"  API engine  : http://{config.api.host}:{config.api.port}"
          f"  (docs: /docs, poll: /api/v1/poll)")
    print(f"  Auth API    : {'X-Engine-Key AKTIF' if config.api.api_key else 'TIDAK diatur — /api/* terbuka!'}")
    print(f"  File log    : {LOG_FILE}")
    if config.dry_run:
        print("  *** DRY-RUN AKTIF — order TIDAK dikirim ke broker ***")
    print(line)
    get_logger("main").info(
        f"Engine v{ENGINE_VERSION} dimulai — mode {config.trading.mode}, "
        f"API http://{config.api.host}:{config.api.port}, MT5 "
        f"{'siap' if MT5_AVAILABLE else 'tidak tersedia'}."
    )


def _run_cli_backtest(config: Config, pair: str, timeframe: str, bars: int) -> None:
    """Backtest offline via CLI: fetch candle MT5 → run_backtest → print ringkasan.

    Dipakai oleh ``python main.py --backtest PAIR TIMEFRAME [--bars N]``.
    """
    from app.backtest import run_backtest
    from app.config import KNOWN_PAIRS

    sym = str(pair).upper()
    if sym not in KNOWN_PAIRS:
        valid = ", ".join(KNOWN_PAIRS)
        print(f"ERROR: pair '{sym}' tidak dikenal. Valid: {valid}")
        return
    tf = str(timeframe).upper()
    n_bars = max(300, min(5000, int(bars)))

    client = MT5Client(config)
    if not client.connect():
        print("ERROR: tidak dapat terhubung ke MetaTrader 5 — pastikan terminal berjalan.")
        return
    try:
        df = client.get_candles(sym, tf, n_bars)
        if df is None or len(df) < 300:
            print(f"ERROR: data candle tidak cukup ({0 if df is None else len(df)} bar, min 300).")
            return
        indicators = list(config.indicators.list) or [
            "ema", "rsi", "macd", "atr", "bollinger", "supertrend", "stoch",
        ]
        result = run_backtest(
            df,
            indicators,
            risk_per_trade=float(config.risk.risk_per_trade),
            stop_loss_pips=int(config.risk.stop_loss_pips),
            take_profit_ratio=float(config.risk.take_profit_ratio),
            initial_balance=10000.0,
            pip_size=client.pip_size(sym),
            pip_value=client.pip_value(sym),
        )
        print(
            f"\n===== BACKTEST {sym} {tf} ({len(df)} bar, {len(indicators)} indikator) ====="
        )
        for key in (
            "totalTrades", "wins", "losses", "winRate", "netProfit",
            "netProfitPct", "profitFactor", "maxDrawdownPct",
            "avgTrade", "expectancy", "sharpe",
        ):
            val = result.get(key)
            if val is not None:
                print(f"  {key:<18}: {val}")
        print("=====================================================\n")
    finally:
        try:
            client.shutdown()
        except Exception:  # noqa: BLE001
            pass


def main(argv: list[str] | None = None) -> None:
    """Entrypoint engine: konfigurasi → thread loop → server FastAPI."""
    args = _parse_args(argv)
    config = load_config(args.config)
    if args.dry_run:
        config.dry_run = True

    if args.backtest:
        _run_cli_backtest(config, args.backtest[0], args.backtest[1], args.bars)
        return

    _print_banner(config)

    engine = Engine(config)
    set_engine(engine)
    engine.start()

    host, port = config.api.host, int(config.api.port)
    get_logger("main").info(
        f"Server engine mendengarkan di http://{host}:{port} — buka dashboard "
        f"lalu set Engine Mode LIVE dengan engineUrl http://localhost:{port}."
    )
    try:
        uvicorn.run(api, host=host, port=port, log_config=None, access_log=False)
    except KeyboardInterrupt:
        print("\nCtrl+C diterima — mematikan engine...")
    finally:
        engine.shutdown()


if __name__ == "__main__":
    main()
