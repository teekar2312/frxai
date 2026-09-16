# -*- coding: utf-8 -*-
"""app.mt5_client — jembatan MetaTrader 5 (Windows) untuk FINEX Indonesia.

Tanggung jawab modul ini:
    * Koneksi + **auto-launch terminal MT5** (cari ``terminal64.exe`` di
      path config, folder instalasi umum, lalu registry Windows).
    * Harga tick, candle historis, posisi terbuka.
    * Order market (BUY/SELL) dengan SL/TP dalam pip, retry requote x3.
    * Modify SL/TP, close posisi, ringkasan deal history.

Semua panggilan ``mt5.*`` dibungkus try/except — kegagalan IPC terminal
tidak boleh membuat engine crash. Kelas :class:`MT5Client` hanya bisa
dipakai di Windows (paket pip ``MetaTrader5``); di luar Windows semua
metode gagal dengan :class:`MT5Error` yang jelas.
"""

import math
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, TypeVar

import pandas as pd

from .config import Config
from .logger import get_logger
from .state import iso_from_epoch

try:  # pragma: no cover - hanya ada di Windows
    import MetaTrader5 as mt5
    MT5_AVAILABLE = True
except ImportError:  # noqa: BLE001
    mt5 = None  # type: ignore[assignment]
    MT5_AVAILABLE = False

try:  # pragma: no cover - hanya ada di Windows
    import winreg
except ImportError:  # noqa: BLE001
    winreg = None  # type: ignore[assignment]


class MT5Error(Exception):
    """Error operasi MT5 (pesan bahasa Indonesia, siap tampil ke user)."""


T = TypeVar("T")

#: Deviasi harga maksimum (point) untuk market order.
DEVIATION: int = 20
#: Maksimal percobaan reconnect dalam satu operasi.
MAX_RECONNECT: int = 3

#: Fallback pip value (USD per pip per 1.0 lot) bila symbol_info kosong.
PIP_VALUE_FALLBACK: dict[str, float] = {
    "EURUSD": 10.0,
    "GBPUSD": 10.0,
    "AUDUSD": 10.0,
    "NZDUSD": 10.0,
    "USDJPY": 6.5,
    "EURJPY": 6.5,
    "GBPJPY": 6.5,
    "AUDJPY": 6.5,
    "CADJPY": 6.5,
    "CHFJPY": 6.5,
    "USDCHF": 11.2,
    "EURCHF": 11.2,
    "GBPCHF": 11.2,
    "USDCAD": 7.3,
    "EURGBP": 12.7,
    "EURAUD": 6.5,
    "XAUUSD": 10.0,
    "XAGUSD": 50.0,
}
#: Fallback point size per pair.
POINT_FALLBACK: dict[str, float] = {
    "EURUSD": 0.00001,
    "GBPUSD": 0.00001,
    "AUDUSD": 0.00001,
    "NZDUSD": 0.00001,
    "USDCHF": 0.00001,
    "USDCAD": 0.00001,
    "EURGBP": 0.00001,
    "EURCHF": 0.00001,
    "EURAUD": 0.00001,
    "GBPCHF": 0.00001,
    "USDJPY": 0.001,
    "EURJPY": 0.001,
    "GBPJPY": 0.001,
    "AUDJPY": 0.001,
    "CADJPY": 0.001,
    "CHFJPY": 0.001,
    "XAUUSD": 0.01,
    "XAGUSD": 0.001,
}
#: Fallback jumlah digit harga.
DIGITS_FALLBACK: dict[str, int] = {
    "EURUSD": 5,
    "GBPUSD": 5,
    "AUDUSD": 5,
    "NZDUSD": 5,
    "USDCHF": 5,
    "USDCAD": 5,
    "EURGBP": 5,
    "EURCHF": 5,
    "EURAUD": 5,
    "GBPCHF": 5,
    "USDJPY": 3,
    "EURJPY": 3,
    "GBPJPY": 3,
    "AUDJPY": 3,
    "CADJPY": 3,
    "CHFJPY": 3,
    "XAUUSD": 2,
    "XAGUSD": 3,
}

#: Retcode yang layak dicoba ulang (requote / harga berubah).
_RETRY_RETCODES: set[int] = {10004, 10020, 10021}  # REQUOTE, PRICE_CHANGED, PRICE_OFF
_RET_DONE: int = 10009                               # TRADE_RETCODE_DONE

#: Konstanta deal (aman dipakai walau paket mt5 tidak ada).
_DEAL_ENTRY_IN: int = 0
_DEAL_ENTRY_OUT: int = 1
_DEAL_REASON_SL: int = 4
_DEAL_REASON_TP: int = 5
_DEAL_REASON_SO: int = 6
_POSITION_TYPE_BUY: int = 0

#: Peta timeframe string → konstanta MT5 (dibuat setelah mt5 terpasang).
_TIMEFRAME_MAP: dict[str, int] | None = None


def _timeframe_const(name: str) -> int | None:
    """Konstanta timeframe MT5 dari string (M1..MN)."""
    global _TIMEFRAME_MAP
    if mt5 is None:
        return None
    if _TIMEFRAME_MAP is None:
        _TIMEFRAME_MAP = {
            "M1": mt5.TIMEFRAME_M1,
            "M5": mt5.TIMEFRAME_M5,
            "M15": mt5.TIMEFRAME_M15,
            "M30": mt5.TIMEFRAME_M30,
            "H1": mt5.TIMEFRAME_H1,
            "H4": mt5.TIMEFRAME_H4,
            "D1": mt5.TIMEFRAME_D1,
            "W1": mt5.TIMEFRAME_W1,
            "MN": mt5.TIMEFRAME_MN1,
        }
    return _TIMEFRAME_MAP.get(str(name).upper())


def _iso(ts: float | None) -> str:
    """Epoch detik → ISO UTC (aman untuk 0/None)."""
    try:
        if not ts or ts <= 0:
            return datetime.now(timezone.utc).isoformat()
        return datetime.fromtimestamp(float(ts), tz=timezone.utc).isoformat()
    except (OverflowError, OSError, ValueError):
        return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Registry helpers (pencarian terminal64.exe)
# ---------------------------------------------------------------------------

def _reg_read_values(key: "winreg.HKEYType") -> dict[str, Any]:
    """Baca semua value sebuah registry key."""
    out: dict[str, Any] = {}
    if winreg is None:
        return out
    index = 0
    while True:
        try:
            name, value, _kind = winreg.EnumValue(key, index)
        except OSError:
            break
        out[name] = value
        index += 1
    return out


def _reg_count_subkeys(key: "winreg.HKEYType") -> int:
    """Jumlah subkey."""
    if winreg is None:
        return 0
    try:
        info = winreg.QueryInfoKey(key)
        return int(info[0])
    except OSError:
        return 0


def _as_terminal_path(raw: Any) -> str | None:
    """Cek sebuah value registry — kembalikan path terminal64.exe bila valid."""
    if not isinstance(raw, str) or not raw:
        return None
    candidate = raw.strip().strip('"').split(",")[0].strip()
    if not candidate.lower().endswith("terminal64.exe"):
        return None
    try:
        if Path(candidate).is_file():
            return candidate
    except OSError:
        return None
    return None


# ---------------------------------------------------------------------------
# MT5Client
# ---------------------------------------------------------------------------

class MT5Client:
    """Klien MetaTrader 5 dengan auto-launch terminal + retry order.

    Args:
        config: konfigurasi engine (section ``mt5`` dipakai di sini).
    """

    def __init__(self, config: Config) -> None:
        self.config = config
        self.log = get_logger("mt5")
        self._connected: bool = False
        self._meta_cache: dict[str, dict[str, Any]] = {}

    # ------------------------------------------------------------------
    # Koneksi & auto-launch
    # ------------------------------------------------------------------

    def connect(self) -> bool:
        """Sambungkan penuh: pastikan terminal jalan + login + akun terbaca."""
        if mt5 is None:
            self.log.error("Paket MetaTrader5 tidak terpasang — engine hanya bisa jalan di Windows.")
            return False
        if self._check_alive():
            self._connected = True
            return True
        ok = self.ensure_mt5_running()
        self._connected = ok
        if ok:
            acc = self._safe(lambda: mt5.account_info())
            if acc is not None:
                self.log.info(
                    f"MT5 siap — akun {acc.login} ({acc.server}), "
                    f"leverage 1:{acc.leverage}, balance {acc.balance:.2f} {acc.currency}"
                )
        return ok

    def ensure_mt5_running(self) -> bool:
        """Pastikan terminal MT5 berjalan dan tersambung (auto-launch).

        Alur:
            1. ``mt5.initialize()`` langsung — terminal mungkin sudah jalan
               (dan login sudah aktif → langsung sukses).
            2. Gagal → cari ``terminal64.exe``: path config → folder instalasi
               umum → registry Windows (HKLM/HKCU ``SOFTWARE\\MetaQuotes\\Terminal``,
               plus entri Uninstall).
            3. Jalankan terminal via ``subprocess.Popen`` (dengan ``/portable``
               bila dikonfigurasi), lalu polling ``initialize`` tiap 3 detik
               sampai ``timeout_seconds``.
        """
        if mt5 is None:
            self.log.error("Paket MetaTrader5 tidak terpasang — engine hanya bisa jalan di Windows.")
            return False

        # 1) terminal sudah jalan / login aktif?
        if self._initialize():
            return True

        # 2) cari executable terminal
        self.log.info("Terminal MT5 belum tersambung — mencari terminal64.exe ...")
        path = self._find_terminal_path()
        if path is None:
            self.log.error(
                "terminal64.exe tidak ditemukan. Isi MT5_PATH di file .env dengan "
                "path lengkap terminal Anda, contoh: C:\\Program Files\\MetaTrader 5\\terminal64.exe"
            )
            return False

        # 3) jalankan terminal
        self.log.info(f"Menjalankan terminal MT5: {path}")
        try:
            args = [path]
            if self.config.mt5.portable:
                args.append("/portable")
            proc = subprocess.Popen(args, cwd=str(Path(path).parent))  # noqa: S603 - path sudah divalidasi ada
            self.log.info(f"Proses terminal dimulai (PID {proc.pid}) — menunggu koneksi...")
        except OSError as exc:
            self.log.error(f"Gagal menjalankan terminal: {exc}")
            return False

        timeout = max(15, int(self.config.mt5.timeout_seconds))
        deadline = time.monotonic() + timeout
        attempt = 1
        while time.monotonic() < deadline:
            time.sleep(3.0)
            self.log.info(f"Menyambung ke terminal (percobaan #{attempt}) ...")
            attempt += 1
            if self._initialize():
                return True
        self.log.error(
            f"Terminal tidak merespons dalam {timeout} detik. Pastikan MT5_LOGIN/MT5_PASSWORD/"
            f"MT5_SERVER benar dan tombol 'Algo Trading' di terminal aktif."
        )
        return False

    def _initialize(self) -> bool:
        """Satu percobaan initialize (+login bila perlu). True = siap dipakai."""
        if mt5 is None:
            return False
        login = int(self.config.mt5.login or 0)
        password = self.config.mt5.password or ""
        server = self.config.mt5.server or ""

        kwargs: dict[str, Any] = {}
        if login and password:
            kwargs = {"login": login, "password": password, "server": server}
        try:
            ok = mt5.initialize(**kwargs) if kwargs else mt5.initialize()
        except Exception as exc:  # noqa: BLE001 - IPC error macam-macam
            self.log.debug(f"mt5.initialize exception: {exc!r}")
            return False
        if not ok:
            self.log.debug(f"mt5.initialize gagal: {self._safe(lambda: mt5.last_error())}")
            return False

        info = self._safe(lambda: mt5.account_info())
        if info is None:
            # Terminal jalan tetapi belum ada akun aktif → login eksplisit.
            if login and password:
                if not self._login():
                    return False
                info = self._safe(lambda: mt5.account_info())
                if info is None:
                    return False
            else:
                self.log.debug("Terminal jalan namun belum login (MT5_LOGIN/MT5_PASSWORD kosong).")
                return False
        elif login and info.login != login:
            # Akun lain sedang aktif → login ke akun konfigurasi.
            if password:
                self.log.info(f"Akun aktif {info.login} berbeda dari MT5_LOGIN {login} — login ulang...")
                if not self._login():
                    return False
            else:
                self.log.warning(
                    f"Akun aktif {info.login} berbeda dari MT5_LOGIN {login} "
                    f"(password kosong — lanjut memakai akun aktif)."
                )
        self._connected = True
        return True

    def _login(self) -> bool:
        """Login ke akun konfigurasi (terminal sudah initialize)."""
        if mt5 is None:
            return False
        login = int(self.config.mt5.login or 0)
        password = self.config.mt5.password or ""
        server = self.config.mt5.server or ""
        try:
            ok = mt5.login(login=login, password=password, server=server)
        except Exception as exc:  # noqa: BLE001
            self.log.debug(f"mt5.login exception: {exc!r}")
            return False
        if not ok:
            self.log.warning(f"mt5.login gagal: {self._safe(lambda: mt5.last_error())}")
            return False
        return True

    def _check_alive(self) -> bool:
        """Terminal + akun masih hidup? (terminal_info & account_info tidak None)."""
        if mt5 is None:
            return False
        term = self._safe(lambda: mt5.terminal_info())
        if term is None:
            return False
        acc = self._safe(lambda: mt5.account_info())
        return acc is not None

    def _ensure_connected(self) -> bool:
        """Pastikan koneksi hidup; reconnect maksimal 3x (log tiap percobaan)."""
        if mt5 is None:
            return False
        if self._check_alive():
            return True
        for attempt in range(1, MAX_RECONNECT + 1):
            self.log.warning(f"Koneksi MT5 terputus — reconnect (percobaan {attempt}/{MAX_RECONNECT}) ...")
            if self._initialize():
                return True
            time.sleep(1.0)
        self._connected = False
        return False

    def _find_terminal_path(self) -> str | None:
        """Cari path terminal64.exe: config → folder umum → registry."""
        # 1) path dari config / .env
        configured = (self.config.mt5.path or "").strip()
        if configured:
            p = Path(configured)
            try:
                if p.is_file():
                    return str(p)
                if p.is_dir() and (p / "terminal64.exe").is_file():
                    return str(p / "terminal64.exe")
            except OSError:
                pass

        # 2) lokasi instalasi umum
        candidates: list[Path] = [
            Path(r"C:\Program Files\MetaTrader 5\terminal64.exe"),
            Path(r"C:\Program Files (x86)\MetaTrader 5\terminal64.exe"),
        ]
        for base in (
            Path(r"C:\Program Files\MetaTrader 5"),
            Path(r"C:\Program Files (x86)\MetaTrader 5"),
            Path(r"C:\Program Files"),
            Path(r"C:\Program Files (x86)"),
        ):
            try:
                candidates.extend(sorted(base.glob("MetaTrader 5*/terminal64.exe")))
                candidates.extend(sorted(base.glob("MetaTrader*/terminal64.exe")))
            except OSError:
                continue
        for cand in candidates:
            try:
                if cand.is_file():
                    self.log.info(f"Terminal ditemukan: {cand}")
                    return str(cand)
            except OSError:
                continue

        # 3) registry Windows
        return self._find_terminal_in_registry()

    def _find_terminal_in_registry(self) -> str | None:
        """Cari terminal64.exe lewat registry (MetaQuotes + entri Uninstall)."""
        if winreg is None:
            return None
        roots: list[tuple[int, str]] = [
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\MetaQuotes\Terminal"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\MetaQuotes\Terminal"),
            (winreg.HKEY_CURRENT_USER, r"SOFTWARE\MetaQuotes\Terminal"),
            (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\MetaQuotes"),
            (winreg.HKEY_CURRENT_USER, r"SOFTWARE\MetaQuotes"),
        ]
        for hive, subpath in roots:
            try:
                key = winreg.OpenKey(hive, subpath)
            except OSError:
                continue
            with key:
                found = self._scan_registry_key(key)
                if found:
                    self.log.info(f"Terminal ditemukan via registry: {found}")
                    return found

        # Fallback terakhir: entri uninstall aplikasi.
        for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
            try:
                key = winreg.OpenKey(hive, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall")
            except OSError:
                continue
            with key:
                for i in range(_reg_count_subkeys(key)):
                    try:
                        sub = winreg.OpenKey(key, winreg.EnumKey(key, i))
                    except OSError:
                        continue
                    with sub:
                        values = _reg_read_values(sub)
                        name = str(values.get("DisplayName", ""))
                        if "metatrader" not in name.lower() and "metaquotes" not in name.lower():
                            continue
                        for value_name in ("InstallLocation", "DisplayIcon"):
                            raw = str(values.get(value_name, ""))
                            path = raw.strip().strip('"').split(",")[0].strip()
                            if not path:
                                continue
                            try:
                                if path.lower().endswith("terminal64.exe") and Path(path).is_file():
                                    self.log.info(f"Terminal ditemukan via uninstall entry: {path}")
                                    return path
                                if Path(path).is_dir() and (Path(path) / "terminal64.exe").is_file():
                                    found = str(Path(path) / "terminal64.exe")
                                    self.log.info(f"Terminal ditemukan via uninstall entry: {found}")
                                    return found
                            except OSError:
                                continue
        return None

    def _scan_registry_key(self, key: "winreg.HKEYType", depth: int = 0) -> str | None:
        """Telusuri value + subkey (rekursif terbatas) mencari path terminal."""
        if winreg is None or depth > 3:
            return None
        for raw in _reg_read_values(key).values():
            found = _as_terminal_path(raw)
            if found:
                return found
        for i in range(_reg_count_subkeys(key)):
            try:
                sub = winreg.OpenKey(key, winreg.EnumKey(key, i))
            except OSError:
                continue
            with sub:
                found = self._scan_registry_key(sub, depth + 1)
                if found:
                    return found
        return None

    # ------------------------------------------------------------------
    # Wrapper aman
    # ------------------------------------------------------------------

    def _safe(self, fn: Callable[[], T]) -> T | None:
        """Bungkus panggilan mt5.* — exception ditelan + dilog, return None."""
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001 - IPC terminal bisa error apa saja
            self.log.warning(f"Panggilan MT5 gagal: {type(exc).__name__}: {exc}")
            return None

    # ------------------------------------------------------------------
    # Info symbol (cache)
    # ------------------------------------------------------------------

    def _symbol_meta(self, symbol: str) -> dict[str, Any]:
        """Properti statis symbol (point/digits/volume/filling) dengan fallback."""
        sym = str(symbol).upper()
        cached = self._meta_cache.get(sym)
        if cached is not None:
            return cached
        info = self._safe(lambda: mt5.symbol_info(sym)) if mt5 is not None else None
        if info is None:
            # Belum tersambung → pakai fallback TANPA cache (coba lagi nanti).
            return {
                "point": POINT_FALLBACK.get(sym, 0.0001),
                "digits": DIGITS_FALLBACK.get(sym, 5),
                "tick_value": 0.0,
                "tick_size": 0.0,
                "vol_min": 0.01,
                "vol_max": 50.0,
                "vol_step": 0.01,
                "stops_level": 0,
                "filling": 0,
            }
        meta: dict[str, Any] = {
            "point": float(getattr(info, "point", 0.0) or 0.0),
            "digits": int(getattr(info, "digits", 5) or 5),
            "tick_value": float(getattr(info, "trade_tick_value", 0.0) or 0.0),
            "tick_size": float(getattr(info, "trade_tick_size", 0.0) or 0.0),
            "vol_min": float(getattr(info, "volume_min", 0.01) or 0.01),
            "vol_max": float(getattr(info, "volume_max", 50.0) or 50.0),
            "vol_step": float(getattr(info, "volume_step", 0.01) or 0.01),
            "stops_level": int(getattr(info, "trade_stops_level", 0) or 0),
            "filling": int(getattr(info, "filling_mode", 0) or 0),
        }
        if meta["point"] <= 0.0:
            meta["point"] = POINT_FALLBACK.get(sym, 0.0001)
        self._meta_cache[sym] = meta
        return meta

    def _ensure_symbol(self, symbol: str) -> Any:
        """Pastikan symbol terpilih di Market Watch (symbol_select bila perlu)."""
        if mt5 is None:
            return None
        info = self._safe(lambda: mt5.symbol_info(symbol))
        if info is not None and getattr(info, "visible", False):
            return info
        ok = self._safe(lambda: mt5.symbol_select(symbol, True))
        if not ok:
            self.log.warning(f"Symbol {symbol} tidak dapat dipilih — cek nama symbol di broker.")
            return None
        return self._safe(lambda: mt5.symbol_info(symbol))

    def pip_size(self, symbol: str) -> float:
        """Ukuran 1 pip dalam harga (EURUSD 0.0001, USDJPY 0.01, XAUUSD 0.1)."""
        meta = self._symbol_meta(symbol)
        sym = str(symbol).upper()
        point = float(meta.get("point") or 0.0) or POINT_FALLBACK.get(sym, 0.0001)
        digits = int(meta.get("digits") or 5)
        if digits in (1, 2, 3, 5):
            # 5/3 digit forex klasik dan 2/1 digit logam: pip = 10 x point.
            return round(point * 10.0, 10)
        return point  # 4 digit / lainnya: pip = point

    def pip_value(self, symbol: str) -> float:
        """Nilai 1 pip per 1.0 lot (USD, akun USD) — pakai tick value broker.

        Fallback bila symbol_info tidak tersedia: EURUSD/GBPUSD 10,
        USDJPY 6.5, XAUUSD 10.
        """
        sym = str(symbol).upper()
        meta = self._symbol_meta(sym)
        tick_value = float(meta.get("tick_value") or 0.0)
        tick_size = float(meta.get("tick_size") or 0.0)
        if tick_value > 0.0 and tick_size > 0.0:
            value = tick_value * (self.pip_size(sym) / tick_size)
            if value > 0.0:
                return value
        return PIP_VALUE_FALLBACK.get(sym, 10.0)

    def digits(self, symbol: str) -> int:
        """Jumlah digit harga symbol (untuk pembulatan SL/TP)."""
        meta = self._symbol_meta(symbol)
        return int(meta.get("digits") or DIGITS_FALLBACK.get(str(symbol).upper(), 5))

    def normalize_volume(self, symbol: str, volume: float) -> float:
        """Bulatkan volume ke step broker + clamp min/max (FINEX 0.01–50)."""
        meta = self._symbol_meta(symbol)
        step = float(meta.get("vol_step") or 0.01) or 0.01
        vmin = float(meta.get("vol_min") or 0.01) or 0.01
        vmax = float(meta.get("vol_max") or 50.0) or 50.0
        try:
            vol = float(volume)
        except (TypeError, ValueError):
            return vmin
        vol = max(vmin, min(vmax, vol))
        vol = math.floor(vol / step + 1e-9) * step
        vol = max(vmin, min(vmax, round(vol, 2)))
        return round(vol, 2)

    def _filling_mode(self, symbol: str) -> int:
        """Mode filling yang didukung symbol (IOC → FOK → RETURN)."""
        if mt5 is None:
            return 0
        filling = int(self._symbol_meta(symbol).get("filling") or 0)
        if filling & 2:  # SYMBOL_FILLING_IOC
            return mt5.ORDER_FILLING_IOC
        if filling & 1:  # SYMBOL_FILLING_FOK
            return mt5.ORDER_FILLING_FOK
        return int(getattr(mt5, "ORDER_FILLING_RETURN", 2))

    # ------------------------------------------------------------------
    # Data pasar
    # ------------------------------------------------------------------

    def get_account(self) -> dict[str, Any] | None:
        """Info akun (camelCase) atau None bila tidak tersambung."""
        if mt5 is None or not self._ensure_connected():
            return None
        info = self._safe(lambda: mt5.account_info())
        if info is None:
            return None
        real_account = True
        try:
            real_account = int(info.trade_mode) == int(mt5.ACCOUNT_TRADE_MODE_REAL)
        except Exception:  # noqa: BLE001
            pass
        return {
            "login": str(info.login),
            "name": str(getattr(info, "name", "") or ""),
            "server": str(info.server),
            "currency": str(info.currency),
            "leverage": int(info.leverage),
            "balance": float(info.balance),
            "equity": float(info.equity),
            "margin": float(info.margin),
            "freeMargin": float(info.margin_free),
            "marginLevel": float(info.margin_level or 0.0),
            "floatingPnl": float(info.profit),
            "realAccount": bool(real_account),
        }

    def get_prices(self, symbols: list[str]) -> dict[str, dict[str, Any]]:
        """Harga tick terakhir untuk beberapa symbol.

        Returns:
            ``{symbol: {pair, bid, ask, spread (pip), time (ISO), digits,
            point, tradeTickValue}}`` — symbol gagal dilewati.
        """
        out: dict[str, dict[str, Any]] = {}
        if mt5 is None or not self._ensure_connected():
            return out
        for symbol in symbols:
            sym = str(symbol).upper()
            try:
                self._ensure_symbol(sym)
                tick = self._safe(lambda s=sym: mt5.symbol_info_tick(s))
                if tick is None or (tick.bid == 0.0 and tick.ask == 0.0):
                    continue
                meta = self._symbol_meta(sym)
                pip = self.pip_size(sym)
                spread_pips = (float(tick.ask) - float(tick.bid)) / pip if pip > 0 else 0.0
                out[sym] = {
                    "pair": sym,
                    "bid": float(tick.bid),
                    "ask": float(tick.ask),
                    "spread": round(spread_pips, 2),
                    "time": _iso(getattr(tick, "time", 0.0)),
                    "digits": int(meta["digits"]),
                    "point": float(meta["point"]),
                    "tradeTickValue": float(meta.get("tick_value") or 0.0),
                }
            except Exception as exc:  # noqa: BLE001
                self.log.warning(f"Gagal mengambil harga {sym}: {exc!r}")
        return out

    def get_candles(self, symbol: str, timeframe: str, count: int = 300) -> pd.DataFrame | None:
        """Candle historis via ``copy_rates_from_pos``.

        Returns:
            DataFrame kolom ``time`` (datetime UTC), ``open``, ``high``,
            ``low``, ``close``, ``tick_volume`` — atau None bila kosong.
        """
        if mt5 is None or not self._ensure_connected():
            return None
        tf_const = _timeframe_const(timeframe)
        if tf_const is None:
            raise MT5Error(f"Timeframe tidak dikenal: {timeframe} (valid: M1..MN)")
        sym = str(symbol).upper()
        self._ensure_symbol(sym)
        limit = max(1, min(int(count), 5000))
        rates = self._safe(lambda: mt5.copy_rates_from_pos(sym, tf_const, 0, limit))
        if rates is None or len(rates) == 0:
            return None
        try:
            df = pd.DataFrame(rates)
            df = df[["time", "open", "high", "low", "close", "tick_volume"]].copy()
            df["time"] = pd.to_datetime(df["time"], unit="s", utc=True)
            for col in ("open", "high", "low", "close", "tick_volume"):
                df[col] = df[col].astype(float)
            return df.reset_index(drop=True)
        except Exception as exc:  # noqa: BLE001
            raise MT5Error(f"Gagal mengolah data candle {sym}: {exc}") from exc

    def get_open_positions(self) -> list[dict[str, Any]]:
        """Semua posisi terbuka akun (camelCase).

        Keys: ticket, pair, side (BUY/SELL), volume, openPrice, currentPrice,
        stopLoss, takeProfit, profit, swap, comment, magic, openTime (epoch).
        """
        if mt5 is None or not self._ensure_connected():
            return []
        positions = self._safe(lambda: mt5.positions_get())
        if not positions:
            return []
        out: list[dict[str, Any]] = []
        for p in positions:
            try:
                out.append({
                    "ticket": int(p.ticket),
                    "pair": str(p.symbol).upper(),
                    "side": "BUY" if int(p.type) == _POSITION_TYPE_BUY else "SELL",
                    "volume": float(p.volume),
                    "openPrice": float(p.price_open),
                    "currentPrice": float(p.price_current),
                    "stopLoss": float(p.sl) if p.sl else None,
                    "takeProfit": float(p.tp) if p.tp else None,
                    "profit": float(p.profit),
                    "swap": float(p.swap),
                    "comment": str(p.comment or ""),
                    "magic": int(p.magic),
                    "openTime": int(p.time),
                })
            except Exception as exc:  # noqa: BLE001
                self.log.warning(f"Posisi {getattr(p, 'ticket', '?')} gagal dipetakan: {exc!r}")
        return out

    # ------------------------------------------------------------------
    # Eksekusi order
    # ------------------------------------------------------------------

    def market_order(
        self,
        symbol: str,
        side: str,
        volume: float,
        sl_pips: float,
        tp_pips: float,
        comment: str = "",
        magic: int = 0,
    ) -> dict[str, Any]:
        """Kirim order market BUY/SELL dengan SL/TP dalam pip.

        SL/TP dihitung dari harga eksekusi (ask untuk BUY, bid untuk SELL)
        lalu dibulatkan ke digits symbol. Retcode requote/price-off diulang
        maksimal 3x dengan refresh harga.

        Raises:
            MT5Error: bila order ditolak broker / koneksi gagal.
        """
        if mt5 is None or not self._ensure_connected():
            raise MT5Error("Tidak tersambung ke MT5 — order tidak bisa dikirim.")

        sym = str(symbol).upper()
        side = str(side).upper()
        if side not in ("BUY", "SELL"):
            raise MT5Error(f"Side tidak valid: {side} (harus BUY atau SELL).")
        if self._ensure_symbol(sym) is None:
            raise MT5Error(f"Symbol {sym} tidak tersedia di broker.")

        meta = self._symbol_meta(sym)
        tick = self._safe(lambda: mt5.symbol_info_tick(sym))
        if tick is None or (tick.bid == 0.0 and tick.ask == 0.0):
            raise MT5Error(f"Harga {sym} tidak tersedia (market mungkin tutup).")

        volume = self.normalize_volume(sym, volume)
        pip = self.pip_size(sym)
        digits = int(meta["digits"])
        stops_level = float(meta.get("stops_level") or 0) * float(meta["point"])

        def compute_stops(price: float) -> tuple[float, float]:
            """SL/TP absolut dari harga acuan, hormati stops level broker."""
            sl = 0.0
            tp = 0.0
            if sl_pips and float(sl_pips) > 0:
                distance = max(float(sl_pips) * pip, stops_level)
                sl = price - distance if side == "BUY" else price + distance
            if tp_pips and float(tp_pips) > 0:
                distance = max(float(tp_pips) * pip, stops_level)
                tp = price + distance if side == "BUY" else price - distance
            return round(sl, digits) or 0.0, round(tp, digits) or 0.0

        request: dict[str, Any] = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": sym,
            "volume": float(volume),
            "type": mt5.ORDER_TYPE_BUY if side == "BUY" else mt5.ORDER_TYPE_SELL,
            "price": float(tick.ask if side == "BUY" else tick.bid),
            "sl": 0.0,
            "tp": 0.0,
            "deviation": DEVIATION,
            "magic": int(magic),
            "comment": str(comment or "")[:31],  # batas komentar MT5 ±31 karakter
            "type_time": int(getattr(mt5, "ORDER_TIME_GTC", 0)),
            "type_filling": self._filling_mode(sym),
        }

        last_retcode: int | None = None
        last_comment = ""
        for attempt in range(1, 4):
            request["sl"], request["tp"] = compute_stops(float(request["price"]))
            result = self._safe(lambda: mt5.order_send(request))
            if result is None:
                err = self._safe(lambda: mt5.last_error())
                if attempt < 3 and self._initialize():
                    continue  # koneksi pulih → coba lagi
                raise MT5Error(f"order_send {sym} {side} gagal: {err}")
            last_retcode = int(result.retcode)
            last_comment = str(result.comment)
            if last_retcode == _RET_DONE:
                return self._order_result(result, sym, side, request)
            if last_retcode in _RETRY_RETCODES:
                # requote / harga berubah → refresh harga lalu ulang
                tick2 = self._safe(lambda: mt5.symbol_info_tick(sym))
                if tick2 is not None:
                    request["price"] = float(tick2.ask if side == "BUY" else tick2.bid)
                self.log.warning(
                    f"Requote {sym} {side} (retcode {last_retcode}) — ulang {attempt}/3 ..."
                )
                continue
            break  # retcode fatal → keluar

        raise MT5Error(
            f"Order {sym} {side} {volume} lot ditolak broker: "
            f"retcode={last_retcode} {last_comment}".strip()
        )

    def _order_result(
        self, result: Any, symbol: str, side: str, request: dict[str, Any],
    ) -> dict[str, Any]:
        """Map OrderSendResult → dict camelCase."""
        price = float(getattr(result, "price", 0.0) or 0.0) or float(request["price"])
        return {
            "retcode": int(result.retcode),
            "deal": int(getattr(result, "deal", 0) or 0),
            "order": int(getattr(result, "order", 0) or 0),
            "positionTicket": int(getattr(result, "order", 0) or 0),
            "price": price,
            "volume": float(getattr(result, "volume", 0.0) or request["volume"]),
            "sl": float(request.get("sl") or 0.0),
            "tp": float(request.get("tp") or 0.0),
            "comment": str(getattr(result, "comment", "") or ""),
            "symbol": symbol,
            "side": side,
        }

    def modify_position(self, ticket: int, sl: float | None, tp: float | None) -> bool:
        """Ubah SL/TP posisi (TRADE_ACTION_SLTP). False bila ditolak."""
        if mt5 is None or not self._ensure_connected():
            self.log.warning("modify_position: tidak tersambung ke MT5.")
            return False
        ticket = int(ticket)
        positions = self._safe(lambda: mt5.positions_get(ticket=ticket))
        if not positions:
            self.log.warning(f"modify_position: posisi #{ticket} tidak ditemukan.")
            return False
        request: dict[str, Any] = {
            "action": mt5.TRADE_ACTION_SLTP,
            "symbol": positions[0].symbol,
            "position": ticket,
            "sl": float(sl) if sl else 0.0,
            "tp": float(tp) if tp else 0.0,
        }
        result = self._safe(lambda: mt5.order_send(request))
        if result is not None and int(result.retcode) == _RET_DONE:
            return True
        retcode = int(result.retcode) if result is not None else None
        detail = str(getattr(result, "comment", "")) if result is not None else ""
        self.log.warning(f"modify_position #{ticket} gagal: retcode={retcode} {detail}".strip())
        return False

    def close_position(self, ticket: int, deviation: int = DEVIATION) -> dict[str, Any]:
        """Tutup posisi dengan order berlawanan (``position`` = ticket).

        Raises:
            MT5Error: bila posisi hilang / broker menolak.
        """
        if mt5 is None or not self._ensure_connected():
            raise MT5Error("Tidak tersambung ke MT5 — close tidak bisa dikirim.")
        ticket = int(ticket)
        positions = self._safe(lambda: mt5.positions_get(ticket=ticket))
        if not positions:
            raise MT5Error(f"Posisi #{ticket} tidak ditemukan (mungkin sudah tertutup).")
        pos = positions[0]
        sym = str(pos.symbol)
        is_buy = int(pos.type) == _POSITION_TYPE_BUY

        def build_request() -> dict[str, Any]:
            tick = self._safe(lambda: mt5.symbol_info_tick(sym))
            if tick is None or (tick.bid == 0.0 and tick.ask == 0.0):
                raise MT5Error(f"Harga {sym} tidak tersedia untuk close.")
            price = float(tick.bid if is_buy else tick.ask)
            return {
                "action": mt5.TRADE_ACTION_DEAL,
                "symbol": sym,
                "volume": float(pos.volume),
                "type": mt5.ORDER_TYPE_SELL if is_buy else mt5.ORDER_TYPE_BUY,
                "position": ticket,
                "price": price,
                "deviation": int(deviation),
                "magic": int(pos.magic),
                "comment": "close",
                "type_time": int(getattr(mt5, "ORDER_TIME_GTC", 0)),
                "type_filling": self._filling_mode(sym),
            }

        request = build_request()
        last_retcode: int | None = None
        last_comment = ""
        for attempt in range(1, 4):
            result = self._safe(lambda: mt5.order_send(request))
            if result is None:
                if attempt < 3 and self._initialize():
                    continue
                raise MT5Error(
                    f"order_send close #{ticket} gagal: {self._safe(lambda: mt5.last_error())}"
                )
            last_retcode = int(result.retcode)
            last_comment = str(result.comment)
            if last_retcode == _RET_DONE:
                price = float(getattr(result, "price", 0.0) or 0.0) or float(request["price"])
                return {
                    "retcode": last_retcode,
                    "ticket": ticket,
                    "pair": str(pos.symbol).upper(),
                    "volume": float(getattr(result, "volume", 0.0) or pos.volume),
                    "price": price,
                    "comment": last_comment,
                }
            if last_retcode in _RETRY_RETCODES:
                try:
                    request = build_request()  # refresh harga
                except MT5Error:
                    break
                self.log.warning(f"Requote close #{ticket} (retcode {last_retcode}) — ulang {attempt}/3 ...")
                continue
            break

        raise MT5Error(
            f"Close #{ticket} ditolak broker: retcode={last_retcode} {last_comment}".strip()
        )

    # ------------------------------------------------------------------
    # History deal (untuk deteksi posisi tertutup)
    # ------------------------------------------------------------------

    def get_deals_for_position(self, ticket: int) -> list[Any]:
        """Semua deal milik satu posisi (entry + exit)."""
        if mt5 is None or not self._ensure_connected():
            return []
        deals = self._safe(lambda: mt5.history_deals_get(position=int(ticket)))
        if not deals:
            return []
        return list(deals)

    def summarize_deals(self, deals: list[Any]) -> dict[str, Any]:
        """Ringkasan deal satu posisi: waktu/entry-exit, profit, komisi, alasan.

        Returns:
            Dict ``entryTime``, ``closeTime`` (epoch), ``closePrice``,
            ``profit``, ``commission``, ``swap``, ``reasonCode``.
        """
        summary: dict[str, Any] = {
            "entryTime": 0.0,
            "closeTime": 0.0,
            "closePrice": None,
            "profit": 0.0,
            "commission": 0.0,
            "swap": 0.0,
            "reasonCode": None,
        }
        for deal in deals or []:
            try:
                entry_type = int(getattr(deal, "entry", -1))
                summary["profit"] += float(getattr(deal, "profit", 0.0) or 0.0)
                summary["commission"] += (
                    float(getattr(deal, "commission", 0.0) or 0.0)
                    + float(getattr(deal, "fee", 0.0) or 0.0)
                )
                summary["swap"] += float(getattr(deal, "swap", 0.0) or 0.0)
                if entry_type == _DEAL_ENTRY_IN and not summary["entryTime"]:
                    summary["entryTime"] = float(getattr(deal, "time", 0.0) or 0.0)
                if entry_type == _DEAL_ENTRY_OUT:
                    summary["closeTime"] = float(getattr(deal, "time", 0.0) or 0.0)
                    summary["closePrice"] = float(getattr(deal, "price", 0.0) or 0.0)
                    summary["reasonCode"] = int(getattr(deal, "reason", -1))
            except Exception:  # noqa: BLE001 - satu deal rusak jangan batalkan semua
                continue
        return summary

    # Konstanta alasan close (di-expose agar executor tak perlu import mt5).
    @staticmethod
    def reason_sl() -> int:
        """Retcode deal: tertutup oleh Stop Loss."""
        return _DEAL_REASON_SL

    @staticmethod
    def reason_tp() -> int:
        """Retcode deal: tertutup oleh Take Profit."""
        return _DEAL_REASON_TP

    @staticmethod
    def reason_so() -> int:
        """Retcode deal: tertutup oleh Stop Out broker."""
        return _DEAL_REASON_SO

    # ------------------------------------------------------------------
    # Shutdown
    # ------------------------------------------------------------------

    def shutdown(self) -> None:
        """Tutup koneksi IPC ke terminal (terminal tetap berjalan)."""
        if mt5 is None:
            return
        try:
            mt5.shutdown()
        except Exception as exc:  # noqa: BLE001
            self.log.debug(f"mt5.shutdown: {exc!r}")
        self._connected = False
        self.log.info("Koneksi MT5 ditutup.")


__all__ = ["MT5Client", "MT5Error", "MT5_AVAILABLE", "DEVIATION"]
