# -*- coding: utf-8 -*-
"""app.emailer — notifikasi email SMTP (tidak pernah raise).

* :func:`send_email`   — kirim email teks biasa via ``smtplib.SMTP_SSL``
  (kredensial dari env SMTP_HOST/PORT/USER/PASSWORD, penerima EMAIL_TO
  atau config.email). Gagal → ``False`` + log, TIDAK raise.
* :func:`notify_event` — kirim email berdasar template Bahasa Indonesia
  untuk event: trade_open, trade_close, alert, error, daily_report,
  daily_limit. Menghormati ``config.email.enabled`` + daftar events.
"""

from __future__ import annotations

import logging
import os
import smtplib
from email.message import EmailMessage
from typing import Any

#: Event notifikasi yang dikenal (selaras EVENTS_NOTIF dashboard).
KNOWN_EVENTS = ("trade_open", "trade_close", "alert", "error", "daily_report", "daily_limit")

#: Default event yang aktif bila config tidak menyebutkan.
_DEFAULT_EVENTS = ["trade_open", "trade_close", "alert", "error", "daily_report"]


def _get_logger() -> logging.Logger:
    """Ambil logger aplikasi (fallback aman bila app.logger belum tersedia)."""
    for loader in ("relative", "absolute"):
        try:
            if loader == "relative":
                from .logger import get_logger  # type: ignore
            else:
                from app.logger import get_logger  # type: ignore
            try:
                return get_logger("emailer")  # type: ignore[call-arg]
            except TypeError:
                return get_logger()  # type: ignore[call-arg]
        except Exception:
            continue
    lg = logging.getLogger("finex.emailer")
    if not lg.handlers:
        h = logging.StreamHandler()
        h.setFormatter(logging.Formatter("[%(asctime)s] %(levelname)s %(name)s: %(message)s"))
        lg.addHandler(h)
        lg.setLevel(logging.INFO)
    return lg


log = _get_logger()

_SMTP_TIMEOUT = 15.0


# ---------------------------------------------------------------------------
# Resolusi konfigurasi (env + config, defensif)
# ---------------------------------------------------------------------------


def _email_settings(config: Any = None) -> dict:
    """Gabungkan pengaturan email dari config dan environment.

    Priority: config.email.* (enabled/to/events, atau varian camelCase
    ``emailEnabled/emailTo/emailEvents`` di objek config) → environment
    (SMTP_HOST/PORT/USER/PASSWORD, EMAIL_TO).
    """
    enabled: bool | None = None
    to: str | None = None
    events: list[str] | None = None
    host: str | None = None
    port: int | None = None
    user: str | None = None
    password: str | None = None

    if config is not None:
        sec = getattr(config, "email", None)
        if sec is not None:
            enabled = getattr(sec, "enabled", None)
            if enabled is None:
                enabled = getattr(sec, "emailEnabled", None)
            to = getattr(sec, "to", None) or getattr(sec, "emailTo", None)
            events = getattr(sec, "events", None) or getattr(sec, "emailEvents", None)
            host = getattr(sec, "host", None) or None
            user = getattr(sec, "user", None) or None
            password = getattr(sec, "password", None) or None
            try:
                port = int(getattr(sec, "port", 0) or 0) or None
            except (TypeError, ValueError):
                port = None
        else:
            enabled = getattr(config, "emailEnabled", None)
            to = getattr(config, "emailTo", None)
            events = getattr(config, "emailEvents", None)

    if not host:
        host = os.getenv("SMTP_HOST", "").strip()
    if port is None:
        try:
            port = int(os.getenv("SMTP_PORT", "465") or 465)
        except ValueError:
            port = 465
    if not user:
        user = os.getenv("SMTP_USER", "").strip()
    if not password:
        password = os.getenv("SMTP_PASSWORD", "")
    if to is None:
        to = os.getenv("EMAIL_TO", "").strip()
    to = str(to or "").strip()
    if enabled is None:
        enabled = bool(host and to)
    if not isinstance(events, (list, tuple)) or not events:
        events = list(_DEFAULT_EVENTS)

    return {
        "enabled": bool(enabled),
        "host": host,
        "port": port,
        "user": user,
        "password": password,
        "to": to,
        "events": [str(e) for e in events],
    }


# ---------------------------------------------------------------------------
# Pengiriman
# ---------------------------------------------------------------------------


def send_email(subject: str, body: str, config: Any = None) -> bool:
    """Kirim email teks biasa via SMTP_SSL. SELALU return bool, tidak raise.

    Args:
        subject: subjek email.
        body:    isi email (plain text).
        config:  objek konfigurasi engine (opsional; SMTP dari env).

    Returns:
        ``True`` bila terkirim, ``False`` bila gagal/konfigurasi kurang.
    """
    try:
        st = _email_settings(config)
        if not st["host"]:
            log.warning("Kirim email dilewati: SMTP_HOST belum diisi di .env")
            return False
        if not st["to"]:
            log.warning("Kirim email dilewati: penerima (EMAIL_TO / config.email.to) kosong")
            return False

        msg = EmailMessage()
        msg["Subject"] = str(subject or "(tanpa subjek)")
        sender = st["user"] or "finex-ai@localhost"
        msg["From"] = sender
        msg["To"] = st["to"]
        msg.set_content(str(body or ""))

        with smtplib.SMTP_SSL(st["host"], st["port"], timeout=_SMTP_TIMEOUT) as smtp:
            if st["user"] and st["password"]:
                smtp.login(st["user"], st["password"])
            smtp.send_message(msg)
        log.info(f"Email terkirim ke {st['to']}: {subject}")
        return True
    except Exception as exc:  # noqa: BLE001 — emailer tidak boleh raise
        log.error(f"Gagal mengirim email '{subject}': {exc}")
        return False


# ---------------------------------------------------------------------------
# Template per event (Bahasa Indonesia)
# ---------------------------------------------------------------------------


def _fmt_num(v: Any, default: str = "—") -> str:
    try:
        return f"{float(v):,.2f}"
    except (TypeError, ValueError):
        return str(v) if v is not None else default


def _template(event: str, ctx: dict) -> tuple[str, str]:
    """Bangun (subject, body) untuk event — selalu aman terhadap ctx apa pun."""
    ctx = ctx if isinstance(ctx, dict) else {}
    pair = str(ctx.get("pair") or "-")
    side = str(ctx.get("side") or "")
    now = str(ctx.get("time") or "")

    if event == "trade_open":
        subject = f"[FINEX] Posisi dibuka: {side} {pair}"
        body = (
            "POSISI BARU DIBUKA\n"
            "------------------\n"
            f"Pair      : {pair}\n"
            f"Arah      : {side}\n"
            f"Volume    : {ctx.get('volume', '-')}\n"
            f"Harga entry: {ctx.get('entry', '-')}\n"
            f"Stop loss : {ctx.get('stopLoss', '-')} ({ctx.get('stopLossPips', '-')} pips)\n"
            f"Take profit: {ctx.get('takeProfit', '-')} ({ctx.get('takeProfitPips', '-')} pips)\n"
            f"Sumber    : {ctx.get('source', 'AI')}\n"
            f"Waktu     : {now}\n"
        )
        if ctx.get("reasoning"):
            body += f"\nAlasan: {ctx['reasoning']}\n"
    elif event == "trade_close":
        profit = ctx.get("profit")
        try:
            p = float(profit)
            hasil = f"PROFIT +${p:,.2f}" if p >= 0 else f"LOSS -${abs(p):,.2f}"
        except (TypeError, ValueError):
            hasil = str(profit)
        subject = f"[FINEX] Posisi ditutup: {pair} — {hasil}"
        body = (
            "POSISI DITUTUP\n"
            "--------------\n"
            f"Pair       : {pair}\n"
            f"Arah       : {side}\n"
            f"Volume     : {ctx.get('volume', '-')}\n"
            f"Entry      : {ctx.get('entry', '-')}\n"
            f"Close      : {ctx.get('close', ctx.get('exit', '-'))}\n"
            f"Pips       : {ctx.get('pips', '-')}\n"
            f"Hasil      : {hasil}\n"
            f"Alasan tutup: {ctx.get('reason', '-')}\n"
            f"Saldo      : {_fmt_num(ctx.get('balance'))}\n"
            f"Waktu      : {now}\n"
        )
    elif event == "alert":
        subject = f"[FINEX] Alert terpicu: {pair} {str(ctx.get('condition') or '').upper()} {ctx.get('price', '-')}"
        body = (
            "ALERT HARGA TERPICU\n"
            "-------------------\n"
            f"Pair      : {pair}\n"
            f"Kondisi   : {str(ctx.get('condition') or '').upper()} {ctx.get('price', '-')}\n"
            f"Harga saat ini: bid {ctx.get('bid', '-')} / ask {ctx.get('ask', '-')}\n"
            f"Catatan   : {ctx.get('note') or '-'}\n"
            f"Waktu     : {now}\n"
        )
    elif event == "error":
        subject = f"[FINEX] Error engine: {str(ctx.get('message') or 'unknown')[:60]}"
        body = (
            "ERROR ENGINE\n"
            "------------\n"
            f"Pesan  : {ctx.get('message', '-')}\n"
            f"Detail : {ctx.get('details') or '-'}\n"
            f"Waktu  : {now}\n"
        )
    elif event == "daily_report":
        daily = ctx.get("dailyPnl")
        try:
            d = float(daily)
            hasil = f"+${d:,.2f}" if d >= 0 else f"-${abs(d):,.2f}"
        except (TypeError, ValueError):
            hasil = str(daily)
        subject = f"[FINEX] Laporan harian — PnL {hasil}"
        body = (
            "LAPORAN HARIAN\n"
            "--------------\n"
            f"Saldo akhir : {_fmt_num(ctx.get('balance'))}\n"
            f"Equity      : {_fmt_num(ctx.get('equity'))}\n"
            f"PnL harian  : {hasil} ({ctx.get('dailyPnlPct', '-')}%)\n"
            f"Total trade : {ctx.get('trades', '-')}\n"
            f"Win/Loss    : {ctx.get('wins', '-')}/{ctx.get('losses', '-')}\n"
            f"Waktu       : {now}\n"
        )
    elif event == "daily_limit":
        kind = str(ctx.get("type") or "LIMIT").upper()
        subject = f"[FINEX] {'Target harian tercapai' if kind == 'TARGET' else 'Daily limit tercapai'}"
        body = (
            "BATAS HARIAN TERCAPAI\n"
            "---------------------\n"
            f"Jenis    : {kind}\n"
            f"PnL harian: {ctx.get('dailyPnlPct', '-')}%\n"
            f"Saldo    : {_fmt_num(ctx.get('balance'))}\n"
            "Trading otomatis dijeda sampai besok (perlindungan anti-MC).\n"
            f"Waktu    : {now}\n"
        )
    else:
        subject = f"[FINEX] Notifikasi: {event}"
        body = f"Event: {event}\nDetail: {ctx}\nWaktu: {now}\n"
    return subject, body


def notify_event(event: str, ctx: dict, config: Any = None) -> bool:
    """Kirim notifikasi event (menghormati config.email.enabled + events).

    Args:
        event: salah satu dari ``trade_open, trade_close, alert, error,
               daily_report, daily_limit`` (event lain tetap dikirim bila
               terdaftar di config).
        ctx:   konteks event (pair, side, profit, ...).
        config: objek konfigurasi engine (opsional).

    Returns:
        ``True`` bila email terkirim; ``False`` bila dinonaktifkan / gagal.
    """
    try:
        st = _email_settings(config)
        if not st["enabled"]:
            log.debug(f"Notifikasi '{event}' dilewati: email nonaktif")
            return False
        if st["events"] and event not in st["events"]:
            log.debug(f"Notifikasi '{event}' dilewati: tidak ada di daftar events")
            return False
        subject, body = _template(event, ctx if isinstance(ctx, dict) else {})
        return send_email(subject, body, config)
    except Exception as exc:  # noqa: BLE001 — emailer tidak boleh raise
        log.error(f"notify_event('{event}') gagal: {exc}")
        return False


__all__ = ["send_email", "notify_event", "KNOWN_EVENTS"]
