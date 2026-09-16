# -*- coding: utf-8 -*-
"""app.config — konfigurasi engine (YAML + override environment variable).

Sumber konfigurasi berlapis (prioritas tertinggi terakhir):
    1. Default di dataclass di bawah.
    2. File YAML (``config.yaml`` — salin dari ``config.example.yaml``).
    3. Environment variable (dibaca dari ``.env`` via python-dotenv):
       ``MT5_LOGIN``, ``MT5_PASSWORD``, ``MT5_SERVER``, ``MT5_PATH``,
       ``MT5_PORTABLE``, ``FINNHUB_API_KEY``, ``MARKETAUX_API_KEY``,
       ``SMTP_HOST``, ``SMTP_PORT``, ``SMTP_USER``, ``SMTP_PASSWORD``,
       ``EMAIL_TO``.

Nilai di luar rentang aman otomatis di-clamp + dicatat ke
``Config.warnings``. Pelanggaran struktural (mis. tidak ada pair terpilih)
menimbulkan :class:`ConfigError` dengan pesan bahasa Indonesia.

Catatan: ``from __future__ import annotations`` WAJIB — dataclass
:class:`IndicatorsConfig` memiliki field bernama ``list``; tanpa evaluasi
annotasi yang ditangguhkan, ekspresi ``list[str]` di body class akan
mensubscript objek ``Field`` (bukan builtin ``list``) dan crash saat import.
"""

from __future__ import annotations

import os
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path
from typing import Any, Callable

import yaml
from dotenv import load_dotenv


class ConfigError(Exception):
    """Error konfigurasi — pesan siap tampil ke user (bahasa Indonesia)."""


# ---------------------------------------------------------------------------
# Nilai valid (selaras dengan konstanta dashboard)
# ---------------------------------------------------------------------------

KNOWN_PAIRS: tuple[str, ...] = (
    # Majors
    "EURUSD", "USDJPY", "GBPUSD", "USDCHF", "USDCAD", "AUDUSD", "NZDUSD",
    # Crosses
    "EURJPY", "EURGBP", "EURCHF", "EURAUD", "GBPJPY", "GBPCHF", "AUDJPY", "CADJPY", "CHFJPY",
    # Metals
    "XAUUSD", "XAGUSD",
)
KNOWN_SESSIONS: tuple[str, ...] = ("sydney", "tokyo", "london", "newyork")
KNOWN_TIMEFRAMES: tuple[str, ...] = ("M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1", "MN")
KNOWN_PROVIDERS: tuple[str, ...] = (
    "zai", "groq", "tinyfish", "openai", "google", "openrouter", "tokenplus", "local",
)
KNOWN_MODES: tuple[str, ...] = ("manual", "ai")

#: 30 indikator teknikal (id selaras dashboard).
KNOWN_INDICATORS: tuple[str, ...] = (
    # Trend
    "ema", "sma", "hma", "supertrend", "psar", "ichimoku", "linreg",
    # Momentum
    "macd", "rsi", "stoch", "cci", "momentum", "williamsr", "tsi", "roc", "stc", "uo",
    # Volatility
    "bollinger", "atr", "keltner", "donchian", "stddev", "chaikin", "volratio",
    # Volume
    "vwap", "obv", "mfi", "tickvol", "volumeprofile", "ad",
)

KNOWN_EMAIL_EVENTS: tuple[str, ...] = (
    "trade_open", "trade_close", "alert", "error", "daily_report", "daily_limit",
)

DEFAULT_INDICATORS: list[str] = [
    "ema", "rsi", "macd", "atr", "bollinger", "supertrend", "stoch", "vwap",
    "obv", "cci", "williamsr", "momentum", "psar", "sma", "donchian", "mfi",
    "roc", "stddev", "ad", "tickvol",
]


# ---------------------------------------------------------------------------
# Struktur konfigurasi
# ---------------------------------------------------------------------------

@dataclass
class Mt5Config:
    """Koneksi MetaTrader 5 (kredensial diutamakan via .env)."""

    login: int = 0
    password: str = ""
    server: str = "FINEX-Live"
    path: str = "C:\\Program Files\\MetaTrader 5\\terminal64.exe"
    portable: bool = False
    timeout_seconds: int = 60


@dataclass
class TradingConfig:
    """Parameter trading: mode, pair, sesi, timeframe, magic number."""

    mode: str = "manual"
    pairs: list[str] = field(default_factory=lambda: list(KNOWN_PAIRS))
    pair_mode: str = "manual"
    sessions: list[str] = field(default_factory=lambda: list(KNOWN_SESSIONS))
    session_mode: str = "manual"
    timeframes: list[str] = field(default_factory=lambda: ["M15", "M30", "H1"])
    timeframe_mode: str = "manual"
    magic: int = 880042


@dataclass
class RiskConfig:
    """Manajemen risiko (rentang aman FINEX)."""

    mode: str = "manual"
    risk_per_trade: float = 0.75      # % dari equity per trade (0.5 - 1.0)
    stop_loss_pips: int = 10          # 5 - 15
    take_profit_ratio: float = 1.5    # R:R 1:1.5
    max_positions: int = 2            # 1 - 3
    daily_risk_limit: float = 2.5     # % loss harian (anti-MC), 2 - 3
    daily_target: float = 2.0         # % target harian, 1 - 3
    avoid_news: bool = True
    trailing_mode: str = "manual"
    trailing_stop_pips: int = 6


@dataclass
class AiConfig:
    """Provider AI (LLM) untuk analisa."""

    provider: str = "zai"
    model: str = ""


@dataclass
class IndicatorsConfig:
    """Indikator teknikal aktif.

    CATATAN: field ``list`` sengaja diletakkan TERAKHIR di dataclass ini
    karena nama field menimpa builtin ``list`` di dalam body class.
    """

    mode: str = "manual"
    list: list[str] = field(default_factory=lambda: list(DEFAULT_INDICATORS))


@dataclass
class NewsConfig:
    """Sumber berita + jeda anti-news."""

    finnhub_enabled: bool = True
    marketaux_enabled: bool = True
    avoid_minutes: int = 15
    finnhub_api_key: str = ""      # diisi otomatis dari env FINNHUB_API_KEY
    marketaux_api_key: str = ""    # diisi otomatis dari env MARKETAUX_API_KEY


@dataclass
class EmailConfig:
    """Notifikasi email (SMTP). Kredensial via .env."""

    enabled: bool = False
    events: list[str] = field(default_factory=lambda: list(KNOWN_EMAIL_EVENTS))
    host: str = "smtp.gmail.com"
    port: int = 465
    user: str = ""
    password: str = ""
    to: str = ""


@dataclass
class ApiConfig:
    """Server FastAPI engine."""

    host: str = "127.0.0.1"
    port: int = 8000


@dataclass
class BacktestConfig:
    """Parameter backtest CLI."""

    initial_balance: float = 10000.0


@dataclass
class Config:
    """Konfigurasi lengkap engine."""

    mt5: Mt5Config = field(default_factory=Mt5Config)
    trading: TradingConfig = field(default_factory=TradingConfig)
    risk: RiskConfig = field(default_factory=RiskConfig)
    ai: AiConfig = field(default_factory=AiConfig)
    indicators: IndicatorsConfig = field(default_factory=IndicatorsConfig)
    news: NewsConfig = field(default_factory=NewsConfig)
    email: EmailConfig = field(default_factory=EmailConfig)
    api: ApiConfig = field(default_factory=ApiConfig)
    backtest: BacktestConfig = field(default_factory=BacktestConfig)

    #: Mode simulasi (CLI --dry-run): order tidak dikirim ke broker.
    dry_run: bool = False
    #: Peringatan hasil validasi/clamp (tidak ditulis ke YAML).
    warnings: list[str] = field(default_factory=list, repr=False, compare=False)
    #: Path file asal (untuk write-back dari API settings).
    source_path: str | None = field(default=None, repr=False, compare=False)

    # ------------------------------------------------------------------
    # Loading
    # ------------------------------------------------------------------

    @classmethod
    def load(cls, path: str = "config.yaml") -> "Config":
        """Muat konfigurasi dari YAML (bila ada) + override env, lalu validasi.

        Raises:
            ConfigError: bila struktur tidak bisa dipakai (mis. tanpa pair).
        """
        load_dotenv(dotenv_path=str(Path(path).parent / ".env"), override=False)
        load_dotenv()  # .env di direktori kerja

        p = Path(path)
        data: dict[str, Any] = {}
        if p.is_file():
            try:
                loaded = yaml.safe_load(p.read_text(encoding="utf-8"))
            except yaml.YAMLError as exc:
                raise ConfigError(f"File {path} bukan YAML yang valid: {exc}") from exc
            if loaded is not None and not isinstance(loaded, dict):
                raise ConfigError(
                    f"Isi {path} harus berupa mapping (key: value), "
                    f"bukan {type(loaded).__name__}."
                )
            data = loaded or {}

        cfg = cls(source_path=str(p))
        _apply_sections(cfg, data)
        _apply_env(cfg)
        cfg.validate()
        if not p.is_file():
            cfg.warnings.append(
                f"File {path} tidak ditemukan — memakai nilai default "
                f"(salin config.example.yaml → config.yaml untuk kustomisasi)."
            )
        return cfg

    # ------------------------------------------------------------------
    # Validasi
    # ------------------------------------------------------------------

    def validate(self) -> None:
        """Normalisasi + clamp semua nilai; kumpulkan peringatan.

        Raises:
            ConfigError: bila konfigurasi tidak layak pakai.
        """
        t, r = self.trading, self.risk

        # --- mode-mode (manual | ai) ---
        for attr in ("mode", "pair_mode", "session_mode", "timeframe_mode"):
            val = str(getattr(t, attr)).lower()
            if val not in KNOWN_MODES:
                self._warn(f"trading.{attr} '{val}' tidak dikenal — dipaksa 'manual' (valid: manual|ai).")
                val = "manual"
            setattr(t, attr, val)
        for attr in ("mode", "trailing_mode"):
            val = str(getattr(r, attr)).lower()
            if val not in KNOWN_MODES:
                self._warn(f"risk.{attr} '{val}' tidak dikenal — dipaksa 'manual'.")
                val = "manual"
            setattr(r, attr, val)
        ind_mode = str(self.indicators.mode).lower()
        if ind_mode not in KNOWN_MODES:
            self._warn(f"indicators.mode '{ind_mode}' tidak dikenal — dipaksa 'manual'.")
            ind_mode = "manual"
        self.indicators.mode = ind_mode

        # --- daftar pilihan (min 1) ---
        t.pairs = self._filter_list(t.pairs, KNOWN_PAIRS, "pair", lambda x: str(x).upper())
        t.sessions = self._filter_list(t.sessions, KNOWN_SESSIONS, "sesi", lambda x: str(x).lower())
        t.timeframes = self._filter_list(t.timeframes, KNOWN_TIMEFRAMES, "timeframe", lambda x: str(x).upper())
        self.indicators.list = self._filter_list(
            self.indicators.list, KNOWN_INDICATORS, "indikator", lambda x: str(x).lower(),
        )

        # --- rentang risiko (clamp, bukan error) ---
        r.risk_per_trade = self._clamp(r.risk_per_trade, 0.5, 1.0, "risk.risk_per_trade", "%", 2)
        r.stop_loss_pips = int(self._clamp(r.stop_loss_pips, 5, 15, "risk.stop_loss_pips", "pips", 0))
        r.take_profit_ratio = self._clamp(r.take_profit_ratio, 1.0, 3.0, "risk.take_profit_ratio", "", 2)
        r.max_positions = int(self._clamp(r.max_positions, 1, 3, "risk.max_positions", "posisi", 0))
        r.daily_risk_limit = self._clamp(r.daily_risk_limit, 2.0, 3.0, "risk.daily_risk_limit", "%", 2)
        r.daily_target = self._clamp(r.daily_target, 1.0, 3.0, "risk.daily_target", "%", 2)
        r.trailing_stop_pips = int(self._clamp(r.trailing_stop_pips, 3, 30, "risk.trailing_stop_pips", "pips", 0))

        # --- angka lain ---
        self.mt5.timeout_seconds = int(self._clamp(
            self.mt5.timeout_seconds, 15, 600, "mt5.timeout_seconds", "detik", 0))
        try:
            magic = int(t.magic)
        except (TypeError, ValueError):
            magic = 0
        t.magic = magic if magic > 0 else 880042
        self.news.avoid_minutes = int(self._clamp(
            self.news.avoid_minutes, 0, 120, "news.avoid_minutes", "menit", 0))
        self.api.port = int(self._clamp(self.api.port, 1024, 65535, "api.port", "", 0))
        try:
            self.backtest.initial_balance = max(100.0, float(self.backtest.initial_balance or 10000.0))
        except (TypeError, ValueError):
            self.backtest.initial_balance = 10000.0

        # --- provider AI ---
        provider = str(self.ai.provider).lower()
        if provider not in KNOWN_PROVIDERS:
            self._warn(
                f"ai.provider '{provider}' tidak dikenal — dipaksa 'zai' "
                f"(valid: {', '.join(KNOWN_PROVIDERS)})."
            )
            provider = "zai"
        self.ai.provider = provider
        self.ai.model = str(self.ai.model or "").strip()

        # --- email ---
        self.email.events = self._filter_list(
            self.email.events, KNOWN_EMAIL_EVENTS, "event email", lambda x: str(x).lower(),
            required=False,
        )

    # ------------------------------------------------------------------
    # Helper internal validasi
    # ------------------------------------------------------------------

    def _warn(self, message: str) -> None:
        self.warnings.append(message)

    def _filter_list(
        self,
        raw: Any,
        valid: tuple[str, ...],
        label: str,
        normalize: Callable[[Any], str],
        required: bool = True,
    ) -> list[str]:
        """Normalisasi daftar string, buang nilai tak dikenal, jaga unik + urutan."""
        if not isinstance(raw, (list, tuple)):
            if required:
                raise ConfigError(f"Daftar {label} tidak valid (harus berupa list).")
            return []
        seen: list[str] = []
        dropped: list[str] = []
        for item in raw:
            value = normalize(item)
            if value in valid and value not in seen:
                seen.append(value)
            elif value not in valid:
                dropped.append(str(item))
        if dropped:
            self._warn(
                f"{label.capitalize()} tidak dikenal dibuang: {', '.join(dropped)} "
                f"(valid: {', '.join(valid)})."
            )
        if not seen and required:
            raise ConfigError(f"Minimal 1 {label} harus dipilih (valid: {', '.join(valid)}).")
        return seen

    def _clamp(self, value: Any, lo: float, hi: float, name: str, unit: str, digits: int) -> float:
        """Clamp angka ke rentang [lo, hi]; catat peringatan bila berubah."""
        try:
            val = float(value)
        except (TypeError, ValueError):
            self._warn(f"{name} '{value}' bukan angka — dipaksa {lo}{unit}.")
            return round(lo, digits)
        if val < lo:
            self._warn(f"{name} {val} di bawah batas — dipaksa {lo}{unit}.")
            return round(lo, digits)
        if val > hi:
            self._warn(f"{name} {val} di atas batas — dipaksa {hi}{unit}.")
            return round(hi, digits)
        return round(val, digits)

    # ------------------------------------------------------------------
    # Helper domain (dipakai engine/risk/api)
    # ------------------------------------------------------------------

    def allowed_pairs(self) -> list[str]:
        """Daftar pair yang boleh diperdagangkan (sudah tervalidasi)."""
        return list(self.trading.pairs)

    def allowed_sessions(self) -> list[str]:
        """Daftar sesi yang dipilih user."""
        return list(self.trading.sessions)

    def allowed_timeframes(self) -> list[str]:
        """Daftar timeframe terpilih."""
        return list(self.trading.timeframes)

    def allowed_indicators(self) -> list[str]:
        """Daftar id indikator aktif."""
        return list(self.indicators.list)

    def trading_allowed_sessions(self, now_utc: Any = None) -> list[str]:
        """Sesi yang DIPILIH user DAN sedang aktif sekarang (UTC).

        Args:
            now_utc: datetime aware-UTC opsional (default: sekarang).
        """
        from .sessions import active_sessions  # import lokal, hindari siklus saat import modul

        chosen = set(self.trading.sessions)
        return [s for s in active_sessions(now_utc) if s in chosen]

    # ------------------------------------------------------------------
    # Serialisasi
    # ------------------------------------------------------------------

    def to_dict(self) -> dict[str, Any]:
        """Dict YAML-safe tanpa field rahasia (login/password/api key/SMTP)."""
        data = asdict(self)
        data.pop("dry_run", None)
        data.pop("warnings", None)
        data.pop("source_path", None)
        mt5 = data.setdefault("mt5", {})
        mt5.pop("login", None)
        mt5.pop("password", None)
        news = data.setdefault("news", {})
        news.pop("finnhub_api_key", None)
        news.pop("marketaux_api_key", None)
        email = data.setdefault("email", {})
        email.pop("user", None)
        email.pop("password", None)
        return data

    def save(self, path: str | None = None) -> None:
        """Tulis konfigurasi kembali ke file YAML (tanpa kredensial)."""
        target = Path(path or self.source_path or "config.yaml")
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("w", encoding="utf-8") as fh:
            yaml.safe_dump(self.to_dict(), fh, allow_unicode=True, sort_keys=False, default_flow_style=False)
        self.source_path = str(target)


# ---------------------------------------------------------------------------
# Penerapan section YAML + environment variable
# ---------------------------------------------------------------------------

_SECTIONS: tuple[str, ...] = ("mt5", "trading", "risk", "ai", "indicators", "news", "email", "api", "backtest")


def _apply_sections(cfg: Config, data: dict[str, Any]) -> None:
    """Terapkan nilai YAML ke dataclass (section demi section)."""
    for section in _SECTIONS:
        part = data.get(section)
        if part is None:
            continue
        if not isinstance(part, dict):
            raise ConfigError(f"Section '{section}' di config.yaml harus berupa mapping.")
        target = getattr(cfg, section)
        known = {f.name for f in fields(target)}
        for key, value in part.items():
            if key in known:
                setattr(target, key, value)


def _env_str(name: str) -> str | None:
    """Baca env var, trim; kosong dianggap tidak diisi."""
    value = os.getenv(name)
    if value is None:
        return None
    value = value.strip()
    return value or None


def _apply_env(cfg: Config) -> None:
    """Override konfigurasi dari environment variable (.env)."""
    login = _env_str("MT5_LOGIN")
    if login is not None:
        try:
            cfg.mt5.login = int(login)
        except ValueError as exc:
            raise ConfigError(f"MT5_LOGIN harus berupa angka (nomor akun), bukan '{login}'.") from exc
    for env_name, attr in (("MT5_PASSWORD", "password"), ("MT5_SERVER", "server"), ("MT5_PATH", "path")):
        value = _env_str(env_name)
        if value is not None:
            setattr(cfg.mt5, attr, value)
    portable = _env_str("MT5_PORTABLE")
    if portable is not None:
        cfg.mt5.portable = portable.lower() in ("1", "true", "yes", "ya")

    cfg.news.finnhub_api_key = _env_str("FINNHUB_API_KEY") or cfg.news.finnhub_api_key
    cfg.news.marketaux_api_key = _env_str("MARKETAUX_API_KEY") or cfg.news.marketaux_api_key

    smtp_host = _env_str("SMTP_HOST")
    if smtp_host is not None:
        cfg.email.host = smtp_host
    smtp_port = _env_str("SMTP_PORT")
    if smtp_port is not None:
        try:
            cfg.email.port = int(smtp_port)
        except ValueError:
            cfg.warnings.append(f"SMTP_PORT '{smtp_port}' bukan angka — dipakai {cfg.email.port}.")
    for env_name, attr in (("SMTP_USER", "user"), ("SMTP_PASSWORD", "password"), ("EMAIL_TO", "to")):
        value = _env_str(env_name)
        if value is not None:
            setattr(cfg.email, attr, value)


__all__ = [
    "Config",
    "ConfigError",
    "Mt5Config",
    "TradingConfig",
    "RiskConfig",
    "AiConfig",
    "IndicatorsConfig",
    "NewsConfig",
    "EmailConfig",
    "ApiConfig",
    "BacktestConfig",
    "KNOWN_PAIRS",
    "KNOWN_SESSIONS",
    "KNOWN_TIMEFRAMES",
    "KNOWN_PROVIDERS",
    "KNOWN_INDICATORS",
]
