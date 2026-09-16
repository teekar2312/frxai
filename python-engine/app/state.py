# -*- coding: utf-8 -*-
"""app.state — state bersama engine (thread-safe, singleton).

Semua komponen (loop engine, executor, API server) membaca/menulis state
melalui instance :class:`AppState` yang sama. Struktur data internal
memakai key camelCase agar bisa diteruskan langsung ke dashboard.
"""

import copy
import threading
from datetime import datetime, timezone
from typing import Any, Callable, TypeVar

#: Versi engine (tampil di status dashboard).
ENGINE_VERSION: str = "1.0.0"

T = TypeVar("T")

_HISTORY_LIMIT: int = 500        # riwayat posisi tertutup di memori
_ALERTS_LIMIT: int = 200         # riwayat alert terpicu di memori
_NEWS_LIMIT: int = 150           # berita + kalender di memori


def iso_now() -> str:
    """Timestamp UTC sekarang dalam format ISO-8601."""
    return datetime.now(timezone.utc).isoformat()


def iso_from_epoch(epoch_seconds: float) -> str:
    """Konversi epoch (detik, epoch MT5) ke ISO-8601 UTC."""
    try:
        if not epoch_seconds or epoch_seconds <= 0:
            return iso_now()
        return datetime.fromtimestamp(float(epoch_seconds), tz=timezone.utc).isoformat()
    except (OverflowError, OSError, ValueError):
        return iso_now()


class AppState:
    """State engine yang aman diakses dari banyak thread.

    Field publik:
        account: info akun terakhir (camelCase, dari MT5).
        prices: ``{pair: PriceTick}`` harga terakhir.
        positions: posisi terbuka (camelCase).
        history: posisi tertutup (terbaru di depan).
        news / calendar: berita & kalender ekonomi terakhir.
        status: connected, ai_trading, last_tick, market_open,
            active_sessions, last_ai_decision, daily_blocked,
            auto_trades, manual_trades, latency_ms.
        alerts_triggered: alert harga yang terpicu (terbaru di depan).
        daily_start_balance: balance awal hari (UTC) — acuan daily P/L.
        started_at: waktu engine dimulai.
    """

    def __init__(self) -> None:
        self._lock = threading.RLock()

        self.account: dict[str, Any] = {
            "balance": 0.0,
            "equity": 0.0,
            "margin": 0.0,
            "freeMargin": 0.0,
            "marginLevel": 0.0,
            "floatingPnl": 0.0,
            "currency": "USD",
            "leverage": 500,
            "server": "",
            "login": "",
            "name": "",
            "realAccount": True,
        }
        self.prices: dict[str, dict[str, Any]] = {}
        self.positions: list[dict[str, Any]] = []
        self.history: list[dict[str, Any]] = []
        self.news: list[dict[str, Any]] = []
        self.calendar: list[dict[str, Any]] = []
        self.status: dict[str, Any] = {
            "connected": False,
            "ai_trading": False,
            "last_tick": None,
            "market_open": False,
            "active_sessions": [],
            "last_ai_decision": None,
            "daily_blocked": "NONE",   # NONE | LIMIT | TARGET
            "auto_trades": 0,
            "manual_trades": 0,
            "latency_ms": 0.0,
        }
        self.alerts_triggered: list[dict[str, Any]] = []
        self.daily_start_balance: float = 0.0
        self.started_at: datetime = datetime.now(timezone.utc)

    # ------------------------------------------------------------------
    # Amanan thread
    # ------------------------------------------------------------------

    def update(self, fn: Callable[["AppState"], T]) -> T:
        """Jalankan ``fn(self)`` di dalam lock — mutasi atomik."""
        with self._lock:
            return fn(self)

    def snapshot(self) -> dict[str, Any]:
        """Deep-copy seluruh state (aman dibaca dari thread API)."""
        with self._lock:
            return {
                "account": copy.deepcopy(self.account),
                "prices": copy.deepcopy(self.prices),
                "positions": copy.deepcopy(self.positions),
                "history": copy.deepcopy(self.history),
                "news": copy.deepcopy(self.news),
                "calendar": copy.deepcopy(self.calendar),
                "status": copy.deepcopy(self.status),
                "alerts_triggered": copy.deepcopy(self.alerts_triggered),
                "daily_start_balance": self.daily_start_balance,
                "started_at": self.started_at,
            }

    # ------------------------------------------------------------------
    # Helper domain
    # ------------------------------------------------------------------

    def daily_pnl_pct(self) -> float:
        """P/L harian dalam persen terhadap balance awal hari (UTC)."""
        with self._lock:
            start = float(self.daily_start_balance or 0.0)
            equity = float(self.account.get("equity") or 0.0)
            if start <= 0.0:
                return 0.0
            return (equity - start) / start * 100.0

    def open_position_count(self) -> int:
        """Jumlah posisi terbuka."""
        with self._lock:
            return len(self.positions)

    def positions_for(self, symbol: str) -> list[dict[str, Any]]:
        """Posisi terbuka untuk satu pair (deep-copy)."""
        sym = str(symbol).upper()
        with self._lock:
            return copy.deepcopy([p for p in self.positions if str(p.get("pair", "")).upper() == sym])

    def record_alert(self, alert: dict[str, Any]) -> None:
        """Catat alert yang baru terpicu (terbaru di depan, dibatasi)."""
        with self._lock:
            self.alerts_triggered.insert(0, copy.deepcopy(alert))
            del self.alerts_triggered[_ALERTS_LIMIT:]

    def record_history(self, entries: list[dict[str, Any]]) -> None:
        """Tambah posisi tertutup ke riwayat (terbaru di depan, dibatasi)."""
        with self._lock:
            self.history = copy.deepcopy(entries) + self.history
            del self.history[_HISTORY_LIMIT:]

    def set_news(self, items: list[dict[str, Any]] | None) -> None:
        """Ganti daftar berita (dipanggil news_loop tiap 60 detik)."""
        with self._lock:
            self.news = copy.deepcopy((items or [])[:_NEWS_LIMIT])

    def set_calendar(self, items: list[dict[str, Any]] | None) -> None:
        """Ganti daftar event kalender ekonomi."""
        with self._lock:
            self.calendar = copy.deepcopy((items or [])[:_NEWS_LIMIT])


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_instance: AppState | None = None
_instance_lock = threading.Lock()


def get_state() -> AppState:
    """Ambil (atau buat) instance state global engine."""
    global _instance
    with _instance_lock:
        if _instance is None:
            _instance = AppState()
        return _instance


def reset_state() -> AppState:
    """Reset state global (untuk testing / restart bersih)."""
    global _instance
    with _instance_lock:
        _instance = AppState()
        return _instance


__all__ = [
    "AppState",
    "get_state",
    "reset_state",
    "ENGINE_VERSION",
    "iso_now",
    "iso_from_epoch",
]
