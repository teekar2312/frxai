# -*- coding: utf-8 -*-
"""app.logger — logger engine (file rotating + console).

Format log (dipakai juga parser endpoint ``GET /api/v1/logs``)::

    2025-01-01 12:00:00,123 INFO [finex.mt5] pesan...

Semua logger hidup di bawah parent ``finex`` sehingga handler cukup
dipasang sekali. File log: ``logs/engine.log`` (5 MB x 5 rotasi),
dibuat otomatis relatif terhadap folder engine — tidak bergantung CWD.
"""

import logging
import os
import sys
import traceback
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

#: Root folder engine (satu tingkat di atas paket ``app``).
ENGINE_ROOT: Path = Path(__file__).resolve().parent.parent

LOG_DIR: Path = ENGINE_ROOT / "logs"
LOG_FILE: Path = LOG_DIR / "engine.log"
MAX_BYTES: int = 5 * 1024 * 1024      # 5 MB
BACKUP_COUNT: int = 5                  # engine.log.1 .. engine.log.5
LOG_FORMAT: str = "%(asctime)s %(levelname)s [%(name)s] %(message)s"
ROOT_NAME: str = "finex"

_ready: bool = False


def _setup() -> None:
    """Pasang handler sekali (idempoten, thread-safe cukup via GIL)."""
    global _ready
    if _ready:
        return
    _ready = True

    LOG_DIR.mkdir(parents=True, exist_ok=True)

    # Windows: pastikan console UTF-8 agar pesan tidak bikin UnicodeError.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
    except Exception:  # noqa: BLE001 - stream mungkin sudah diganti pihak lain
        pass

    level_name = os.getenv("FINEX_LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)

    root = logging.getLogger(ROOT_NAME)
    root.setLevel(level)
    root.propagate = False
    if not root.handlers:
        formatter = logging.Formatter(LOG_FORMAT)

        file_handler = RotatingFileHandler(
            LOG_FILE, maxBytes=MAX_BYTES, backupCount=BACKUP_COUNT, encoding="utf-8",
        )
        file_handler.setFormatter(formatter)
        root.addHandler(file_handler)

        stream_handler = logging.StreamHandler(sys.stdout)
        stream_handler.setFormatter(formatter)
        root.addHandler(stream_handler)


def get_logger(name: str) -> logging.Logger:
    """Ambil logger engine bernama ``name`` (contoh: ``"mt5"``, ``"engine"``).

    Logger dikembalikan sebagai ``finex.<name>`` agar satu parent, satu
    handler, satu file log.
    """
    _setup()
    clean = str(name).replace("/", ".").strip(".")
    if clean.startswith(ROOT_NAME):
        return logging.getLogger(clean)
    return logging.getLogger(f"{ROOT_NAME}.{clean}")


def log_error(logger: logging.Logger, exc: BaseException, context: str = "") -> dict[str, Any]:
    """Log exception lengkap dengan traceback, kembalikan dict untuk API.

    Args:
        logger: logger tujuan (dari :func:`get_logger`).
        exc: exception yang tertangkap.
        context: konteks singkat, mis. ``"loop decision"``.

    Returns:
        Dict berisi ``error``, ``type``, ``context``, ``traceback``, ``at``
        (siap dikirim sebagai JSON ke dashboard).
    """
    prefix = f"{context} — " if context else ""
    logger.error(f"{prefix}{type(exc).__name__}: {exc}", exc_info=True)
    return {
        "error": str(exc),
        "type": type(exc).__name__,
        "context": context,
        "traceback": traceback.format_exc(),
        "at": datetime.now(timezone.utc).isoformat(),
    }


__all__ = ["get_logger", "log_error", "LOG_FILE", "LOG_DIR", "ENGINE_ROOT"]
