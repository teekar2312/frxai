# -*- coding: utf-8 -*-
"""app.ai_providers — 8 penyedia AI via httpx async (tanpa SDK).

Provider (id → endpoint):
    zai        OpenAI-compatible  https://api.z.ai/api/paas/v4/chat/completions
    groq       OpenAI-compatible  https://api.groq.com/openai/v1/chat/completions
    tinyfish   OpenAI-compatible  {TINYFISH_BASE_URL}/v1/chat/completions
    openai     OpenAI-compatible  https://api.openai.com/v1/chat/completions
    openrouter OpenAI-compatible  https://openrouter.ai/api/v1/chat/completions
    tokenplus  OpenAI-compatible  {TOKENPLUS_BASE_URL}/chat/completions
    google     Gemini REST        .../models/{model}:generateContent?key=...
    local      Ollama             {OLLAMA_BASE_URL}/api/chat

Semua kunci API diambil dari environment (file ``.env``):
    ZAI_API_KEY, GROQ_API_KEY, TINYFISH_API_KEY, TINYFISH_BASE_URL,
    OPENAI_API_KEY, GOOGLE_API_KEY, OPENROUTER_API_KEY,
    TOKENPLUS_API_KEY, TOKENPLUS_BASE_URL, OLLAMA_BASE_URL.
    Override model per provider: ``{PROVIDER}_MODEL`` (mis. TINYFISH_MODEL).

API publik:
    * :data:`PROVIDERS`         — registry id → info.
    * :func:`ai_chat`           — panggil LLM, kembalikan teks jawaban.
    * :func:`get_provider_status` — status kunci API untuk dashboard.
    * :class:`AIProviderError`  — exception dengan pesan Indonesia yang actionable.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

import httpx


def _get_logger() -> logging.Logger:
    """Ambil logger aplikasi (fallback aman bila app.logger belum tersedia)."""
    for loader in ("relative", "absolute"):
        try:
            if loader == "relative":
                from .logger import get_logger  # type: ignore
            else:
                from app.logger import get_logger  # type: ignore
            try:
                return get_logger("ai")  # type: ignore[call-arg]
            except TypeError:
                return get_logger()  # type: ignore[call-arg]
        except Exception:
            continue
    lg = logging.getLogger("finex.ai")
    if not lg.handlers:
        h = logging.StreamHandler()
        h.setFormatter(logging.Formatter("[%(asctime)s] %(levelname)s %(name)s: %(message)s"))
        lg.addHandler(h)
        lg.setLevel(logging.INFO)
    return lg


log = _get_logger()

#: Timeout default (detik) per percobaan HTTP.
DEFAULT_TIMEOUT = 60.0
#: Jumlah percobaan total (1 awal + 2 retry) dengan backoff.
MAX_ATTEMPTS = 3
_BACKOFFS = [1.0, 2.5]


class AIProviderError(RuntimeError):
    """Kegagalan provider AI dengan pesan Indonesia yang actionable."""

    def __init__(self, message: str, provider: str | None = None) -> None:
        super().__init__(message)
        self.provider = provider


class _TransientError(Exception):
    """Kesalahan jaringan/HTTP sementara — layak di-retry."""


# ---------------------------------------------------------------------------
# Registry provider
# ---------------------------------------------------------------------------

PROVIDERS: dict[str, dict[str, Any]] = {
    "zai": {
        "name": "Z.AI",
        "default_model": "glm-4.6",
        "env_key": "ZAI_API_KEY",
        "base_url": "https://api.z.ai/api/paas/v4",
        "path": "/chat/completions",
        "style": "openai",
        "hint": "ZAI_API_KEY belum diisi di .env — daftar di https://z.ai (BigModel), "
        "salin API key lalu isi ZAI_API_KEY=... di file .env dan restart engine.",
    },
    "groq": {
        "name": "Groq AI",
        "default_model": "llama-3.3-70b-versatile",
        "env_key": "GROQ_API_KEY",
        "base_url": "https://api.groq.com/openai/v1",
        "path": "/chat/completions",
        "style": "openai",
        "hint": "GROQ_API_KEY belum diisi di .env — ambil gratis di "
        "https://console.groq.com/keys lalu isi GROQ_API_KEY=... di .env.",
    },
    "tinyfish": {
        "name": "Tinyfish AI",
        "default_model": "tinyfish-1",
        "env_key": "TINYFISH_API_KEY",
        "base_url": os.getenv("TINYFISH_BASE_URL", "https://api.tinyfish.ai").rstrip("/"),
        "path": "/v1/chat/completions",
        "style": "openai",
        "hint": "TINYFISH_API_KEY belum diisi di .env — ambil di dashboard Tinyfish; "
        "jika endpoint kustom, isi juga TINYFISH_BASE_URL di .env.",
    },
    "openai": {
        "name": "OpenAI",
        "default_model": "gpt-4o",
        "env_key": "OPENAI_API_KEY",
        "base_url": "https://api.openai.com/v1",
        "path": "/chat/completions",
        "style": "openai",
        "hint": "OPENAI_API_KEY belum diisi di .env — buat di "
        "https://platform.openai.com/api-keys lalu isi OPENAI_API_KEY=... di .env.",
    },
    "google": {
        "name": "Google AI Studio",
        "default_model": "gemini-2.0-flash",
        "env_key": "GOOGLE_API_KEY",
        "base_url": "https://generativelanguage.googleapis.com/v1beta",
        "path": "",
        "style": "gemini",
        "hint": "GOOGLE_API_KEY belum diisi di .env — buat gratis di "
        "https://aistudio.google.com/app/apikey lalu isi GOOGLE_API_KEY=... di .env.",
    },
    "openrouter": {
        "name": "OpenRouter AI",
        "default_model": "openrouter/auto",
        "env_key": "OPENROUTER_API_KEY",
        "base_url": "https://openrouter.ai/api/v1",
        "path": "/chat/completions",
        "style": "openai",
        "hint": "OPENROUTER_API_KEY belum diisi di .env — ambil di "
        "https://openrouter.ai/keys lalu isi OPENROUTER_API_KEY=... di .env.",
    },
    "tokenplus": {
        "name": "Tokenplus AI",
        "default_model": "tokenplus-pro",
        "env_key": "TOKENPLUS_API_KEY",
        "base_url": os.getenv("TOKENPLUS_BASE_URL", "https://api.tokenplus.ai/v1").rstrip("/"),
        "path": "/chat/completions",
        "style": "openai",
        "hint": "TOKENPLUS_API_KEY belum diisi di .env — ambil di dashboard Tokenplus; "
        "endpoint kustom bisa diatur lewat TOKENPLUS_BASE_URL di .env.",
    },
    "local": {
        "name": "Local AI",
        "default_model": "qwen2.5:14b",
        "env_key": "OLLAMA_BASE_URL",
        "base_url": os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/"),
        "path": "/api/chat",
        "style": "ollama",
        "hint": "Ollama tidak dapat dihubungi — install dari https://ollama.com, "
        "jalankan `ollama serve`, lalu `ollama pull <model>`.",
    },
}

#: Nama variabel env override model per provider.
_MODEL_ENV: dict[str, str] = {
    "tinyfish": "TINYFISH_MODEL",
    "tokenplus": "TOKENPLUS_MODEL",
    "local": "OLLAMA_MODEL",
}


def _resolve_model(provider_id: str, info: dict[str, Any], config: Any = None) -> str:
    """Prioritas model: config.ai.model → env {PROVIDER}_MODEL → default."""
    model = ""
    if config is not None:
        ai = getattr(config, "ai", None)
        if ai is not None:
            try:
                model = str(getattr(ai, "model", "") or "")
            except Exception:  # noqa: BLE001
                model = ""
    if not model:
        env_name = _MODEL_ENV.get(provider_id, f"{provider_id.upper()}_MODEL")
        model = os.getenv(env_name, "")
    return model or str(info["default_model"])


def _api_key(provider_id: str, info: dict[str, Any]) -> str:
    """Ambil kunci API dari env (kosong untuk provider lokal)."""
    if info["style"] == "ollama":
        return ""
    return (os.getenv(str(info["env_key"]), "") or "").strip()


# ---------------------------------------------------------------------------
# Panggilan per gaya API
# ---------------------------------------------------------------------------


async def _call_openai_style(
    provider_id: str, info: dict[str, Any], model: str, system: str, user: str,
    api_key: str, timeout: float,
) -> str:
    url = str(info["base_url"]).rstrip("/") + str(info["path"])
    headers: dict[str, str] = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    if provider_id == "openrouter":
        headers["HTTP-Referer"] = "https://finex.local"
        headers["X-Title"] = "FINEX AI Trading System"
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.2,
        "max_tokens": 1500,
    }
    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout)) as client:
        resp = await client.post(url, headers=headers, json=payload)
    _raise_for_status(resp, provider_id)
    data = resp.json()
    choices = data.get("choices") or []
    if not choices:
        raise _TransientError(f"respons tanpa 'choices': {str(data)[:200]}")
    content = (choices[0].get("message") or {}).get("content")
    if isinstance(content, list):  # beberapa provider mengembalikan array part
        content = "".join(str(p.get("text", "")) for p in content if isinstance(p, dict))
    text = (content or "").strip()
    if not text:
        raise _TransientError("respons kosong dari provider")
    return text


async def _call_gemini(
    provider_id: str, info: dict[str, Any], model: str, system: str, user: str,
    api_key: str, timeout: float,
) -> str:
    url = f"{str(info['base_url']).rstrip('/')}/models/{model}:generateContent"
    payload = {
        "system_instruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 2048},
    }
    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout)) as client:
        resp = await client.post(url, params={"key": api_key}, json=payload)
    _raise_for_status(resp, provider_id)
    data = resp.json()
    candidates = data.get("candidates") or []
    if not candidates:
        raise _TransientError(f"respons Gemini tanpa kandidat: {str(data)[:200]}")
    parts = (candidates[0].get("content") or {}).get("parts") or []
    text = "".join(str(p.get("text", "")) for p in parts if isinstance(p, dict)).strip()
    if not text:
        raise _TransientError("respons Gemini kosong")
    return text


async def _call_ollama(
    provider_id: str, info: dict[str, Any], model: str, system: str, user: str,
    api_key: str, timeout: float,
) -> str:
    url = f"{str(info['base_url']).rstrip('/')}/api/chat"
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "stream": False,
        "options": {"temperature": 0.2},
    }
    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout)) as client:
        resp = await client.post(url, json=payload)
    _raise_for_status(resp, provider_id)
    data = resp.json()
    text = str((data.get("message") or {}).get("content") or "").strip()
    if not text:
        raise _TransientError("respons Ollama kosong")
    return text


_CALLERS = {
    "openai": _call_openai_style,
    "gemini": _call_gemini,
    "ollama": _call_ollama,
}


def _raise_for_status(resp: httpx.Response, provider_id: str) -> None:
    """Konversi status HTTP ke exception (401/403 fatal, lainnya transient)."""
    if resp.status_code < 400:
        return
    info = PROVIDERS.get(provider_id, {})
    name = info.get("name", provider_id)
    body = resp.text[:200].replace("\n", " ")
    if resp.status_code in (401, 403):
        raise AIProviderError(
            f"Autentikasi gagal ke {name} (HTTP {resp.status_code}). "
            f"Periksa {info.get('env_key')} di file .env. Body: {body}",
            provider_id,
        )
    raise _TransientError(f"HTTP {resp.status_code} dari {name}: {body}")


# ---------------------------------------------------------------------------
# API publik
# ---------------------------------------------------------------------------


async def ai_chat(
    provider: str,
    system: str,
    user: str,
    config: Any = None,
    timeout: float = DEFAULT_TIMEOUT,
) -> str:
    """Kirim prompt ke penyedia AI dan kembalikan teks jawabannya.

    Args:
        provider: id provider (lihat :data:`PROVIDERS`).
        system:   instruksi system prompt.
        user:     isi prompt user.
        config:   objek konfigurasi engine (opsional; ``config.ai.model``).
        timeout:  timeout HTTP per percobaan (detik).

    Returns:
        Teks jawaban dari model.

    Raises:
        AIProviderError: kunci tidak ada / autentikasi gagal / gagal total
        setelah 3 percobaan. Pesan berisi petunjuk perbaikan Bahasa Indonesia.
    """
    pid = str(provider or "").strip().lower()
    info = PROVIDERS.get(pid)
    if info is None:
        raise AIProviderError(
            f"Provider AI tidak dikenal: '{provider}'. Pilihan yang valid: "
            f"{', '.join(sorted(PROVIDERS))}.",
            pid,
        )
    model = _resolve_model(pid, info, config)
    api_key = _api_key(pid, info)
    if info["style"] != "ollama" and not api_key:
        raise AIProviderError(f"{info['hint']} (provider: {pid})", pid)

    caller = _CALLERS[str(info["style"])]
    last_exc: Exception | None = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            text = await caller(pid, info, model, system, user, api_key, timeout)
            log.info(f"AI '{pid}' ({model}) merespons ({len(text)} karakter, percobaan {attempt})")
            return text
        except AIProviderError:
            raise  # fatal (mis. 401) — tidak di-retry
        except Exception as exc:  # noqa: BLE001 - jaringan/HTTP/parse
            last_exc = exc
            if attempt < MAX_ATTEMPTS:
                delay = _BACKOFFS[min(attempt - 1, len(_BACKOFFS) - 1)]
                log.warning(f"AI '{pid}' gagal (percobaan {attempt}): {exc} — retry {delay}s")
                await asyncio.sleep(delay)
    raise AIProviderError(
        f"Gagal memanggil {info['name']} ({model}) setelah {MAX_ATTEMPTS} percobaan: {last_exc}. "
        f"Periksa koneksi internet, nilai {info['env_key']} di .env, dan status layanan provider.",
        pid,
    )


def get_provider_status() -> list[dict]:
    """Status konfigurasi kunci API per provider (untuk dashboard).

    Returns:
        List of ``{id, name, model, configured, envKey, style, baseUrl}``.
    """
    out: list[dict] = []
    for pid, info in PROVIDERS.items():
        if info["style"] == "ollama":
            configured = True  # tidak butuh API key
        else:
            configured = bool(_api_key(pid, info))
        out.append(
            {
                "id": pid,
                "name": info["name"],
                "model": _resolve_model(pid, info, None),
                "configured": configured,
                "envKey": info["env_key"],
                "style": info["style"],
                "baseUrl": info["base_url"],
            }
        )
    return out


__all__ = ["PROVIDERS", "ai_chat", "get_provider_status", "AIProviderError"]
