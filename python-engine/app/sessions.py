# -*- coding: utf-8 -*-
"""app.sessions — sesi trading forex (UTC) & status market.

Jam sesi (perkiraan, UTC):
    - Sydney  : 21:00 - 06:00 (wrap tengah malam)
    - Tokyo   : 00:00 - 09:00
    - London  : 08:00 - 17:00
    - New York: 13:00 - 22:00

Market FX buka Minggu 22:00 UTC sampai Jumat 22:00 UTC.
"""

from datetime import datetime, timezone

#: {nama_sesi: (jam_buka_utc, jam_tutup_utc)} — jam tutup < jam buka = wrap.
SESSIONS: dict[str, tuple[int, int]] = {
    "sydney": (21, 6),
    "tokyo": (0, 9),
    "london": (8, 17),
    "newyork": (13, 22),
}


def _now(now_utc: datetime | None) -> datetime:
    """Pastikan datetime aware-UTC."""
    if now_utc is None:
        return datetime.now(timezone.utc)
    if now_utc.tzinfo is None:
        return now_utc.replace(tzinfo=timezone.utc)
    return now_utc


def _hour_float(dt: datetime) -> float:
    """Jam desimal UTC, mis. 13:30 → 13.5."""
    return dt.hour + dt.minute / 60.0 + dt.second / 3600.0


def _is_active(open_utc: int, close_utc: int, hour: float) -> bool:
    """Cek jam berada dalam sesi (dukung wrap tengah malam)."""
    if open_utc == close_utc:
        return False
    if open_utc < close_utc:
        return open_utc <= hour < close_utc
    return hour >= open_utc or hour < close_utc  # contoh: Sydney 21 → 06


def active_sessions(now_utc: datetime | None = None) -> list[str]:
    """Daftar nama sesi yang sedang aktif sekarang (UTC)."""
    hour = _hour_float(_now(now_utc))
    return [name for name, (o, c) in SESSIONS.items() if _is_active(o, c, hour)]


def is_market_open(now_utc: datetime | None = None) -> bool:
    """Market FX buka? (Minggu 22:00 UTC – Jumat 22:00 UTC)."""
    dt = _now(now_utc)
    hour = _hour_float(dt)
    weekday = dt.weekday()  # Senin=0 ... Minggu=6
    if weekday == 5:        # Sabtu — selalu tutup
        return False
    if weekday == 6:        # Minggu — buka mulai 22:00 UTC
        return hour >= 22.0
    if weekday == 4:        # Jumat — tutup 22:00 UTC
        return hour < 22.0
    return True


def session_progress(name: str, now_utc: datetime | None = None) -> float:
    """Progres sesi 0..1 (0 = baru buka, 1 = tutup).

    Args:
        name: nama sesi (``sydney``/``tokyo``/``london``/``newyork``).
        now_utc: datetime UTC opsional.

    Returns:
        0.0 bila sesi tidak dikenal / sedang tidak aktif.
    """
    span = SESSIONS.get(str(name).lower())
    if span is None:
        return 0.0
    open_utc, close_utc = span
    hour = _hour_float(_now(now_utc))
    if not _is_active(open_utc, close_utc, hour):
        return 0.0
    length = (close_utc - open_utc) if open_utc < close_utc else (24 - open_utc + close_utc)
    elapsed = (hour - open_utc) if hour >= open_utc else (hour + 24 - open_utc)
    if elapsed <= 0:
        return 0.0
    return min(1.0, elapsed / length)


__all__ = ["SESSIONS", "active_sessions", "is_market_open", "session_progress"]
