# -*- coding: utf-8 -*-
"""app.alerts — manajemen alert harga (persistensi JSON atomik, thread-safe).

Satu alert:
    {id (uuid4 hex), pair, condition ("ABOVE"|"BELOW"), price, status
     ("ACTIVE"|"TRIGGERED"|"CANCELLED"), note, createdAt, triggeredAt}

Semantik trigger (:meth:`AlertManager.check`):
    ABOVE → ask >= price ; BELOW → bid <= price.
    Hanya alert ACTIVE yang dicek; yang terpicu berubah status jadi
    TRIGGERED + ``triggeredAt`` diisi, lalu seluruh daftar dipersistenkan
    (tulis file tmp + os.replace — atomic-ish).
"""

from __future__ import annotations

import json
import logging
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

#: Kondisi & status yang dikenal.
CONDITIONS = ("ABOVE", "BELOW")
STATUSES = ("ACTIVE", "TRIGGERED", "CANCELLED")


def _get_logger() -> logging.Logger:
    """Ambil logger aplikasi (fallback aman bila app.logger belum tersedia)."""
    for loader in ("relative", "absolute"):
        try:
            if loader == "relative":
                from .logger import get_logger  # type: ignore
            else:
                from app.logger import get_logger  # type: ignore
            try:
                return get_logger("alerts")  # type: ignore[call-arg]
            except TypeError:
                return get_logger()  # type: ignore[call-arg]
        except Exception:
            continue
    lg = logging.getLogger("finex.alerts")
    if not lg.handlers:
        h = logging.StreamHandler()
        h.setFormatter(logging.Formatter("[%(asctime)s] %(levelname)s %(name)s: %(message)s"))
        lg.addHandler(h)
        lg.setLevel(logging.INFO)
    return lg


log = _get_logger()


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class AlertManager:
    """Penyimpanan & pemeriksa alert harga (thread-safe, JSON persisten).

    Args:
        path: lokasi file persistensi (default ``data/alerts.json``).
    """

    def __init__(self, path: str = "data/alerts.json") -> None:
        self._path = Path(path)
        self._lock = threading.RLock()
        self._alerts: list[dict] = []
        self._load()

    # ------------------------------------------------------------------
    # Persistensi
    # ------------------------------------------------------------------

    def _load(self) -> None:
        """Muat alert dari file JSON (format lama/list diterima, tak raise)."""
        try:
            if not self._path.exists():
                self._alerts = []
                return
            data = json.loads(self._path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                rows = data.get("alerts", [])
            elif isinstance(data, list):
                rows = data
            else:
                rows = []
            self._alerts = [r for r in rows if isinstance(r, dict) and r.get("id")]
        except Exception as exc:  # noqa: BLE001
            log.warning(f"Gagal memuat {self._path}: {exc}")
            self._alerts = []

    def _save(self) -> None:
        """Simpan atomik: tulis file .tmp lalu os.replace."""
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self._path.with_suffix(self._path.suffix + ".tmp")
            tmp.write_text(
                json.dumps({"alerts": self._alerts, "updatedAt": _iso_now()}, indent=2),
                encoding="utf-8",
            )
            os.replace(tmp, self._path)
        except Exception as exc:  # noqa: BLE001
            log.error(f"Gagal menyimpan alert ke {self._path}: {exc}")

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------

    def add(self, pair: str, condition: str, price: float, note: str = "") -> dict:
        """Tambah alert baru (status ACTIVE) dan persistenkan.

        Args:
            pair:      simbol pair, mis. "EURUSD".
            condition: "ABOVE" (ask >= price) atau "BELOW" (bid <= price).
            price:     harga pemicu.
            note:      catatan opsional.

        Returns:
            Dict alert yang baru dibuat.
        """
        cond = str(condition or "").strip().upper()
        if cond not in CONDITIONS:
            raise ValueError(f"Kondisi tidak valid: {condition!r} (harus ABOVE/BELOW)")
        try:
            px = float(price)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Harga tidak valid: {price!r}") from exc
        if px <= 0:
            raise ValueError("Harga harus > 0")
        alert = {
            "id": uuid.uuid4().hex,
            "pair": str(pair or "").strip().upper(),
            "condition": cond,
            "price": px,
            "status": "ACTIVE",
            "note": str(note or "")[:200],
            "createdAt": _iso_now(),
            "triggeredAt": None,
        }
        with self._lock:
            self._alerts.append(alert)
            self._save()
        log.info(f"Alert dibuat: {alert['pair']} {cond} {px}")
        return dict(alert)

    def remove(self, alert_id: str) -> bool:
        """Hapus alert permanen. Return True bila ketemu."""
        with self._lock:
            before = len(self._alerts)
            self._alerts = [a for a in self._alerts if a.get("id") != alert_id]
            removed = len(self._alerts) < before
            if removed:
                self._save()
        return removed

    def cancel(self, alert_id: str) -> dict | None:
        """Batalkan alert (status → CANCELLED). Return alert atau None."""
        with self._lock:
            for a in self._alerts:
                if a.get("id") == alert_id:
                    if a.get("status") == "ACTIVE":
                        a["status"] = "CANCELLED"
                        self._save()
                        log.info(f"Alert dibatalkan: {alert_id}")
                    return dict(a)
        return None

    def list(self, status: str | None = None) -> list[dict]:
        """Daftar alert (terbaru dulu), opsional difilter status."""
        with self._lock:
            rows = [dict(a) for a in self._alerts]
        if status:
            st = str(status).strip().upper()
            rows = [a for a in rows if a.get("status") == st]
        rows.sort(key=lambda a: str(a.get("createdAt") or ""), reverse=True)
        return rows

    # ------------------------------------------------------------------
    # Pemeriksaan harga
    # ------------------------------------------------------------------

    def check(self, prices: dict[str, dict]) -> list[dict]:
        """Cek alert ACTIVE terhadap harga terbaru → tandai TRIGGERED.

        Args:
            prices: map pair → dict harga, minimal ``{"bid": float, "ask": float}``
                    (kunci tambahan diabaikan; nilai non-numerik dilewati).

        Returns:
            List alert yang BARU terpicu pada pemanggilan ini.
        """
        if not isinstance(prices, dict):
            return []
        triggered: list[dict] = []
        with self._lock:
            for a in self._alerts:
                if a.get("status") != "ACTIVE":
                    continue
                tick = prices.get(a.get("pair"))
                if not isinstance(tick, dict):
                    continue
                try:
                    bid = float(tick.get("bid"))
                    ask = float(tick.get("ask"))
                except (TypeError, ValueError):
                    continue
                hit = False
                if a.get("condition") == "ABOVE" and _finite(ask) and ask >= float(a.get("price", 0)):
                    hit = True
                elif a.get("condition") == "BELOW" and _finite(bid) and bid <= float(a.get("price", 0)):
                    hit = True
                if hit:
                    a["status"] = "TRIGGERED"
                    a["triggeredAt"] = _iso_now()
                    triggered.append(dict(a))
            if triggered:
                self._save()
        for a in triggered:
            log.info(
                f"Alert TERPICU: {a['pair']} {a['condition']} {a['price']}"
            )
        return triggered


def _finite(v: Any) -> bool:
    try:
        return v == v and v not in (float("inf"), float("-inf"))
    except Exception:  # noqa: BLE001
        return False


__all__ = ["AlertManager", "CONDITIONS", "STATUSES"]
