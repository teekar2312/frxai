# -*- coding: utf-8 -*-
"""app.fundamental — pembangun prompt analisa fundamental + parser JSON AI.

Bagian dari modul analisa: prompt fundamental (Bahasa Indonesia) dibangun
dari berita terkini + kalender ekonomi, lalu dikirim ke provider AI.
Jawaban AI diparse kembali menjadi dict via :func:`parse_ai_json`.
"""

from __future__ import annotations

import json
import re
from typing import Any

#: Maksimum berita & event kalender yang disisipkan ke prompt (hemat token).
MAX_NEWS_IN_PROMPT = 12
MAX_CALENDAR_IN_PROMPT = 10


def _sentiment_label(value: Any) -> str:
    """Ubah skor sentimen numerik menjadi label BULLISH/BEARISH/NEUTRAL."""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return "NEUTRAL"
    if v > 0.15:
        return "BULLISH"
    if v < -0.15:
        return "BEARISH"
    return "NEUTRAL"


def _pair_context(pair: str) -> str:
    """Catatan konteks khusus per pair."""
    p = str(pair or "").upper()
    notes = {
        "XAUUSD": "Pair ini adalah EMAS — perhatikan khusus: harga emas, yields obligasi AS, "
        "dan permintaan safe-haven.",
        "XAGUSD": "Pair ini adalah PERAK — perhatikan khusus: harga perak, demand industri "
        "(panel surya, elektronik), dan korelasinya dengan emas.",
        "USDJPY": "Perhatikan khusus kebijakan Bank of Japan (BoJ) dan perbedaan suku bunga Fed–BoJ.",
        "EURUSD": "Perhatikan khusus kebijakan ECB dan data ekonomi Eurozone vs AS.",
        "GBPUSD": "Perhatikan khusus kebijakan Bank of England (BoE) dan data ekonomi Inggris.",
        "AUDUSD": "Perhatikan khusus data ekonomi Australia, harga bijih besi, dan kebijakan RBA.",
        "NZDUSD": "Perhatikan khusus data ekonomi Selandia Baru, harga susu/dairy, dan kebijakan RBNZ.",
        "USDCHF": "Perhatikan khusus SNB dan status CHF sebagai safe-haven.",
        "USDCAD": "Perhatikan khusus harga minyak mentah WTI dan kebijakan BoC.",
        "EURJPY": "Cross EUR/JPY — pantau kebijakan ECB vs BoJ dan sentimen risk-on/off.",
        "GBPJPY": "Cross GBP/JPY — volatilitas tinggi; pantau BoE vs BoJ dan risk sentiment.",
    }
    return notes.get(p, "")


def build_fundamental_prompt(
    pair: str, news_items: list[dict], calendar: list[dict]
) -> str:
    """Bangun prompt analisa fundamental (Bahasa Indonesia) untuk AI.

    Args:
        pair:        simbol pair, mis. "EURUSD" / "XAUUSD".
        news_items:  list berita (dict dengan headline/summary/sentiment/...).
        calendar:    list event kalender ekonomi (dict dengan title/time/impact/...).

    Returns:
        String prompt berisi instruksi analisa fundamental + data aktual
        (berita & kalender) + format jawaban JSON yang diharapkan.
    """
    p = str(pair or "").upper()
    lines: list[str] = []
    lines.append(
        f"Lakukan analisa fundamental yang menyeluruh untuk pair {p} "
        "(konteks trading di broker FINEX Indonesia)."
    )
    ctx = _pair_context(p)
    if ctx:
        lines.append(f"Catatan khusus: {ctx}")
    lines.append("")
    lines.append("Cakup minimal 7 aspek berikut:")
    lines.append(
        "1. Kebijakan bank sentral — The Fed (AS), ECB (Eurozone), BoE (Inggris), "
        "BoJ (Jepang), serta RBA (Australia, penting untuk sesi Sydney): arah suku bunga, "
        "nada hawkish/dovish, dan kebijakan moneter terkini."
    )
    lines.append(
        "2. Data ekonomi utama — NFP (Non-Farm Payrolls), CPI (inflasi), PPI, GDP, "
        "unemployment rate, retail sales, dan PMI."
    )
    lines.append(
        "3. Kondisi politik & geopolitik — pemilu, konflik bersenjata, ketegangan dagang, sanksi."
    )
    lines.append("4. Kebijakan fiskal & kondisi ekonomi — belanja pemerintah, utang, stimulus.")
    lines.append("5. Harga komoditas — emas (sangat penting untuk XAUUSD) dan minyak mentah.")
    lines.append("6. Sentimen pasar — risk-on/risk-off, kekuatan dolar AS, aliran modal.")
    lines.append("7. Breaking news — berita pasar terbaru yang berdampak pada pair ini.")
    lines.append("")

    # ---- Berita terkini -------------------------------------------------
    lines.append("BERITA TERKINI (headline + ringkasan + skor sentimen -1..1):")
    news = [n for n in (news_items or []) if isinstance(n, dict) and n.get("headline")]
    if news:
        for i, n in enumerate(news[:MAX_NEWS_IN_PROMPT], start=1):
            headline = str(n.get("headline", ""))[:200]
            summary = str(n.get("summary") or "")[:180]
            try:
                sent = float(n.get("sentiment") or 0.0)
            except (TypeError, ValueError):
                sent = 0.0
            src = str(n.get("source") or "NEWS")
            line = f"{i}. [{src}] {headline}"
            if summary:
                line += f" — {summary}"
            lines.append(f"{line} (sentimen: {sent:+.2f})")
    else:
        lines.append("(tidak ada berita tersedia — gunakan pengetahuan umum terkini)")
    lines.append("")

    # ---- Kalender ekonomi -----------------------------------------------
    lines.append("KALENDER EKONOMI MENDATANG:")
    events = [e for e in (calendar or []) if isinstance(e, dict)]
    if events:
        for e in events[:MAX_CALENDAR_IN_PROMPT]:
            title = str(e.get("title") or "Event")[:80]
            cur = str(e.get("currency") or "")
            impact = str(e.get("impact") or "MEDIUM").upper()
            when = str(e.get("time") or "?")
            fc = e.get("forecast")
            pv = e.get("previous")
            extra = ""
            if fc or pv:
                extra = f" — forecast: {fc or 'n/a'}, previous: {pv or 'n/a'}"
            lines.append(f"- {title} ({cur}, {impact}) @ {when}{extra}")
    else:
        lines.append("(tidak ada event kalender tersedia)")
    lines.append("")

    lines.append("Jawab HANYA dengan satu objek JSON valid (tanpa teks lain, tanpa code fence):")
    lines.append(
        '{"signal": "STRONG_BUY" | "BUY" | "NEUTRAL" | "SELL" | "STRONG_SELL", '
        '"confidence": <angka 0-100>, '
        '"reasoning": "<narasi singkat dalam Bahasa Indonesia>", '
        '"fundamentals": [{"title": "<judul aspek>", "content": "<1-3 kalimat analisa>", '
        '"sentiment": "BULLISH" | "BEARISH" | "NEUTRAL"}]}'
    )
    return "\n".join(lines)


def parse_ai_json(text: str) -> dict:
    """Ekstrak objek JSON dari teks jawaban LLM.

    Menangani: code fence ```json ... ```, teks di sekitar JSON, dan
    koma buntut (trailing comma). 

    Args:
        text: jawaban mentah dari provider AI.

    Returns:
        Dict hasil parse.

    Raises:
        ValueError: bila teks tidak mengandung JSON objek yang valid.
    """
    if text is None or not str(text).strip():
        raise ValueError("Respons AI kosong")

    cleaned = str(text).strip()

    # 1) buang code fence ```json ... ``` atau ``` ... ```
    fence = re.search(r"```(?:json)?\s*(.*?)```", cleaned, re.DOTALL | re.IGNORECASE)
    if fence:
        cleaned = fence.group(1).strip()

    # 2) coba parse langsung
    obj: Any = None
    try:
        obj = json.loads(cleaned)
    except json.JSONDecodeError:
        # 3) ambil substring dari '{' pertama hingga '}' terakhir
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start == -1 or end <= start:
            raise ValueError(f"Respons AI tidak berisi objek JSON: {cleaned[:160]!r}")
        fragment = cleaned[start : end + 1]
        try:
            obj = json.loads(fragment)
        except json.JSONDecodeError:
            # 4) perbaiki koma buntut lalu coba lagi
            fixed = re.sub(r",\s*([}\]])", r"\1", fragment)
            try:
                obj = json.loads(fixed)
            except json.JSONDecodeError as exc:
                raise ValueError(f"JSON dari AI tidak valid: {exc}") from exc

    if isinstance(obj, dict):
        return obj
    if isinstance(obj, list) and obj and isinstance(obj[0], dict):
        return obj[0]
    raise ValueError("Respons AI bukan objek JSON (mungkin array/kosong)")


__all__ = ["build_fundamental_prompt", "parse_ai_json"]
