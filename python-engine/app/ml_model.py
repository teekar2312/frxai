# -*- coding: utf-8 -*-
"""app.ml_model — model machine learning self-learning (online SGDClassifier).

Alur:
    1. :meth:`MLModel.features`  — membangun vektor fitur berukuran tetap
       dari DataFrame candle: 30 sinyal indikator (±1), return ternormalisasi
       (1/5/20 bar), rasio volatilitas, RSI ternormalisasi, body candle,
       posisi dalam range 20 bar, dan rasio volume. Bebas NaN (diisi 0).
    2. :meth:`MLModel.predict`  — probabilitas harga naik + label
       BUY/SELL/NEUTRAL. Belum terlatih → (0.5, "NEUTRAL").
    3. :meth:`MLModel.record_result` — ONLINE LEARNING: setiap trade
       selesai dikirim ke sini, model di-``partial_fit`` (log-loss SGD)
       dengan penyeimbangan kelas, lalu bobot per-indikator diperbarui
       (win +0.08 / loss −0.06, clamp 0.2–3.0) — meniru semantik
       ModelStat di dashboard.
    4. Persistensi: ``model.joblib`` (joblib) + ``weights.json`` (JSON).

Model bersifat *advisory*: engine tetap menggabungkan hasil ML dengan
analisa teknikal & AI provider.
"""

from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

try:  # imprt relatif saat dipakai sebagai paket `app`
    from .indicators import INDICATOR_IDS, indicator_series
except ImportError:  # pragma: no cover - fallback absolut
    from app.indicators import INDICATOR_IDS, indicator_series  # type: ignore

try:
    import joblib
except Exception:  # pragma: no cover - joblib wajib ada di requirements
    joblib = None  # type: ignore


def _get_logger() -> logging.Logger:
    """Ambil logger aplikasi (fallback aman bila app.logger belum tersedia)."""
    for loader in ("relative", "absolute"):
        try:
            if loader == "relative":
                from .logger import get_logger  # type: ignore
            else:
                from app.logger import get_logger  # type: ignore
            try:
                return get_logger("ml")  # type: ignore[call-arg]
            except TypeError:
                return get_logger()  # type: ignore[call-arg]
        except Exception:
            continue
    lg = logging.getLogger("finex.ml")
    if not lg.handlers:
        h = logging.StreamHandler()
        h.setFormatter(logging.Formatter("[%(asctime)s] %(levelname)s %(name)s: %(message)s"))
        lg.addHandler(h)
        lg.setLevel(logging.INFO)
    return lg


log = _get_logger()

#: Panjang vektor fitur (30 sinyal indikator + 8 fitur pasar).
FEATURE_LEN = 38

FEATURE_NAMES: list[str] = [f"sig_{i}" for i in INDICATOR_IDS] + [
    "ret_1", "ret_5", "ret_20", "vol_ratio", "rsi_norm",
    "body", "pos20", "vol_spike",
]

#: Batas bobot indikator hasil belajar.
WEIGHT_MIN, WEIGHT_MAX = 0.2, 3.0
#: Langkah pembaruan bobot (semantik dashboard ModelStat).
WEIGHT_WIN_STEP, WEIGHT_LOSS_STEP = 0.08, -0.06


class MLModel:
    """SGDClassifier(log_loss) dengan online learning + bobot indikator.

    Args:
        model_dir: direktori persistensi (default ``models``).
    """

    def __init__(self, model_dir: str = "models") -> None:
        self.model_dir = Path(model_dir)
        self.model_path = self.model_dir / "model.joblib"
        self.weights_path = self.model_dir / "weights.json"
        self._lock = threading.RLock()

        self._model = None            # SGDClassifier (lazy)
        self._classes_ready = False   # partial_fit pertama sudah dengan classes=[0,1]
        self._samples = 0
        self._wins = 0
        self._losses = 0
        self._model_version = 1
        self._buf_win: list[np.ndarray] = []    # buffer kelas 1 (menang)
        self._buf_loss: list[np.ndarray] = []   # buffer kelas 0 (kalah)

        #: bobot per indikator (default 1.0)
        self._weights: dict[str, float] = {i: 1.0 for i in INDICATOR_IDS}
        #: tally per indikator {wins, losses}
        self._tally: dict[str, dict[str, int]] = {
            i: {"wins": 0, "losses": 0} for i in INDICATOR_IDS
        }

        try:
            self.model_dir.mkdir(parents=True, exist_ok=True)
        except Exception as exc:  # noqa: BLE001
            log.warning(f"Tidak bisa membuat direktori model {self.model_dir}: {exc}")

        self._init_model()
        self.load()

    # ------------------------------------------------------------------
    # Inisialisasi & persistensi
    # ------------------------------------------------------------------

    def _init_model(self) -> None:
        """Buat SGDClassifier baru (dipanggil ulang saat partial_fit pertama)."""
        try:
            from sklearn.linear_model import SGDClassifier

            self._model = SGDClassifier(
                loss="log_loss",
                warm_start=True,
                random_state=42,
                tol=1e-4,
            )
            self._classes_ready = False
        except Exception as exc:  # noqa: BLE001
            log.error(f"scikit-learn tidak tersedia, ML dimatikan: {exc}")
            self._model = None
            self._classes_ready = False

    def save(self) -> None:
        """Simpan model (joblib) + bobot indikator (JSON) — thread-safe."""
        with self._lock:
            try:
                if joblib is not None:
                    joblib.dump(
                        {
                            "model": self._model,
                            "classes_ready": self._classes_ready,
                            "samples": self._samples,
                            "wins": self._wins,
                            "losses": self._losses,
                            "model_version": self._model_version,
                            "feature_len": FEATURE_LEN,
                            "saved_at": datetime.now(timezone.utc).isoformat(),
                        },
                        self.model_path,
                    )
                payload = {
                    "weights": {k: round(float(v), 4) for k, v in self._weights.items()},
                    "tally": self._tally,
                    "samples": self._samples,
                    "wins": self._wins,
                    "losses": self._losses,
                    "model_version": self._model_version,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
                tmp = self.weights_path.with_suffix(".json.tmp")
                tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
                tmp.replace(self.weights_path)
            except Exception as exc:  # noqa: BLE001
                log.warning(f"Gagal menyimpan model ML: {exc}")

    def load(self) -> None:
        """Muat model + bobot bila file persistensi ada (tidak raise)."""
        with self._lock:
            if joblib is not None and self.model_path.exists():
                try:
                    data = joblib.load(self.model_path)
                    if isinstance(data, dict):
                        self._model = data.get("model", self._model)
                        self._classes_ready = bool(data.get("classes_ready", False))
                        self._samples = int(data.get("samples", 0))
                        self._wins = int(data.get("wins", 0))
                        self._losses = int(data.get("losses", 0))
                        self._model_version = int(data.get("model_version", 1))
                        if self._model is None:
                            self._init_model()
                    log.info(
                        f"Model ML dimuat: {self._samples} sampel, versi {self._model_version}"
                    )
                except Exception as exc:  # noqa: BLE001
                    log.warning(f"Gagal memuat model.joblib: {exc}")
            if self.weights_path.exists():
                try:
                    data = json.loads(self.weights_path.read_text(encoding="utf-8"))
                    weights = data.get("weights", {})
                    for k, v in weights.items():
                        if k in self._weights:
                            self._weights[k] = float(min(max(float(v), WEIGHT_MIN), WEIGHT_MAX))
                    tally = data.get("tally", {})
                    for k, tv in tally.items():
                        if k in self._tally and isinstance(tv, dict):
                            self._tally[k]["wins"] = int(tv.get("wins", 0))
                            self._tally[k]["losses"] = int(tv.get("losses", 0))
                except Exception as exc:  # noqa: BLE001
                    log.warning(f"Gagal memuat weights.json: {exc}")

    # ------------------------------------------------------------------
    # Fitur
    # ------------------------------------------------------------------

    @staticmethod
    def _safe_div(a: float, b: float, default: float = 0.0) -> float:
        try:
            if not np.isfinite(b) or b == 0:
                return default
            r = a / b
            return r if np.isfinite(r) else default
        except Exception:  # noqa: BLE001
            return default

    def features(self, df: pd.DataFrame) -> np.ndarray:
        """Bangun vektor fitur 1×N (N=38) dari DataFrame candle.

        Struktur (tetap, tanpa NaN):
            [0..29]  sinyal 30 indikator (-1/0/+1)
            [30..32] return ternormalisasi 1/5/20 bar (≈ -1..1)
            [33]     rasio volatilitas ATR14/price ternormalisasi
            [34]     RSI14/50 - 1
            [35]     body candle (-1..1)
            [36]     posisi close dalam range 20 bar (-1..1)
            [37]     lonjakan volume vs SMA20 (≈ -1..1)
        """
        try:
            if df is None or len(df) < 60:
                return np.zeros(FEATURE_LEN, dtype=float)
            series = indicator_series(df, INDICATOR_IDS)
            sigs = [int(res.signals[-1]) if len(res.signals) else 0 for res in series.values()]
            # nilai pendukung dari deret internal
            rsi = _last_or(series["rsi"].values) if "rsi" in series else 50.0
            atr = _last_or(series["atr"].values) if "atr" in series else 0.0

            c = pd.to_numeric(df["close"], errors="coerce").to_numpy(dtype=float)
            o = pd.to_numeric(df["open"], errors="coerce").to_numpy(dtype=float)
            h = pd.to_numeric(df["high"], errors="coerce").to_numpy(dtype=float)
            l = pd.to_numeric(df["low"], errors="coerce").to_numpy(dtype=float)
            if "tick_volume" in df.columns:
                v = pd.to_numeric(df["tick_volume"], errors="coerce").to_numpy(dtype=float)
            elif "volume" in df.columns:
                v = pd.to_numeric(df["volume"], errors="coerce").to_numpy(dtype=float)
            else:
                v = np.ones(len(df))
            v = np.where(np.isfinite(v) & (v > 0), v, 1.0)

            last = c[-1]
            if not np.isfinite(last) or last <= 0:
                return np.zeros(FEATURE_LEN, dtype=float)

            def ret(k: int) -> float:
                if len(c) <= k or not np.isfinite(c[-1 - k]) or c[-1 - k] <= 0:
                    return 0.0
                return float(np.clip((c[-1] / c[-1 - k] - 1.0) * 1000.0 / (5.0 * np.sqrt(k)), -1.0, 1.0))

            # volatilitas: ATR14 relatif thd harga (≈0..1)
            vol_ratio = float(np.clip(self._safe_div(atr, last) * 10000.0 / 20.0, 0.0, 1.0))
            rsi_norm = float(np.clip((rsi / 50.0) - 1.0, -1.0, 1.0)) if np.isfinite(rsi) else 0.0
            rng = h[-1] - l[-1]
            body = float(np.clip(self._safe_div(c[-1] - o[-1], rng), -1.0, 1.0)) if rng > 0 else 0.0
            win = min(len(c), 20)
            hh = np.nanmax(h[-win:])
            ll = np.nanmin(l[-win:])
            pos20 = (
                float(np.clip(2.0 * self._safe_div(c[-1] - ll, hh - ll) - 1.0, -1.0, 1.0))
                if np.isfinite(hh) and np.isfinite(ll) and hh > ll
                else 0.0
            )
            avg_v = float(np.nanmean(v[-win:])) if len(v) >= win else float(np.nanmean(v))
            vol_spike = (
                float(np.clip(self._safe_div(v[-1], avg_v) - 1.0, -1.0, 1.0))
                if avg_v > 0
                else 0.0
            )

            vec = np.array(
                sigs + [ret(1), ret(5), ret(20), vol_ratio, rsi_norm, body, pos20, vol_spike],
                dtype=float,
            )
            vec = np.nan_to_num(vec, nan=0.0, posinf=0.0, neginf=0.0)
            return np.clip(vec, -5.0, 5.0)
        except Exception as exc:  # noqa: BLE001
            log.warning(f"Gagal membangun fitur ML: {exc}")
            return np.zeros(FEATURE_LEN, dtype=float)

    def _coerce(self, features: np.ndarray) -> np.ndarray:
        """Pastikan bentuk fitur valid (1-D, panjang FEATURE_LEN, tanpa NaN)."""
        x = np.asarray(features, dtype=float).ravel()
        if len(x) < FEATURE_LEN:
            x = np.pad(x, (0, FEATURE_LEN - len(x)))
        elif len(x) > FEATURE_LEN:
            x = x[:FEATURE_LEN]
        return np.nan_to_num(x, nan=0.0, posinf=0.0, neginf=0.0)

    # ------------------------------------------------------------------
    # Inferensi
    # ------------------------------------------------------------------

    def predict(self, features: np.ndarray) -> tuple[float, str]:
        """Prediksi probabilitas harga naik + label BUY/SELL/NEUTRAL.

        Belum terlatih → ``(0.5, "NEUTRAL")``.
        """
        try:
            with self._lock:
                if self._model is None or not self._classes_ready:
                    return (0.5, "NEUTRAL")
                x = self._coerce(features)
                proba = self._model.predict_proba([x])[0]
                classes = list(self._model.classes_)
                p_up = float(proba[classes.index(1)]) if 1 in classes else 0.5
            if not np.isfinite(p_up):
                p_up = 0.5
            label = "BUY" if p_up >= 0.6 else "SELL" if p_up <= 0.4 else "NEUTRAL"
            return (min(max(p_up, 0.0), 1.0), label)
        except Exception as exc:  # noqa: BLE001
            log.warning(f"Prediksi ML gagal: {exc}")
            return (0.5, "NEUTRAL")

    # ------------------------------------------------------------------
    # Online learning
    # ------------------------------------------------------------------

    def record_result(self, features: np.ndarray, win: bool) -> None:
        """Catat hasil trade → partial_fit SGD + perbarui bobot indikator.

        Args:
            features: vektor fitur saat trade dibuka (dari :meth:`features`).
            win: ``True`` bila trade profit.
        """
        try:
            x = self._coerce(features)
            y = 1 if win else 0
            with self._lock:
                if self._model is None:
                    self._init_model()
                if self._model is not None:
                    if not self._classes_ready:
                        self._model.partial_fit([x], [y], classes=[0, 1])
                        self._classes_ready = True
                    else:
                        self._model.partial_fit([x], [y])
                    # penyeimbangan kelas: replay sampel kelas minoritas
                    buf = self._buf_win if win else self._buf_loss
                    other = self._buf_loss if win else self._buf_win
                    buf.append(x)
                    if len(buf) > 200:
                        buf.pop(0)
                    if len(other) > 0 and abs(len(self._buf_win) - len(self._buf_loss)) >= 3:
                        for sx in other[-3:]:
                            self._model.partial_fit([sx], [0 if win else 1])
                self._samples += 1
                if win:
                    self._wins += 1
                else:
                    self._losses += 1
                self._model_version += 1
                # perbarui bobot indikator dari 30 sinyal pertama
                for k, ind in enumerate(INDICATOR_IDS):
                    s = x[k]
                    if s > 0 or s < 0:  # hanya indikator yang bersuara
                        if win:
                            self._weights[ind] = min(
                                self._weights[ind] + WEIGHT_WIN_STEP, WEIGHT_MAX
                            )
                            self._tally[ind]["wins"] += 1
                        else:
                            self._weights[ind] = max(
                                self._weights[ind] + WEIGHT_LOSS_STEP, WEIGHT_MIN
                            )
                            self._tally[ind]["losses"] += 1
            self.save()
        except Exception as exc:  # noqa: BLE001
            log.warning(f"record_result ML gagal: {exc}")

    def indicator_weights(self) -> dict[str, float]:
        """Bobot terpelajar per id indikator (default 1.0, clamp 0.2–3.0)."""
        with self._lock:
            return {k: round(float(v), 4) for k, v in self._weights.items()}

    def stats(self) -> dict:
        """Statistik model untuk dashboard/API."""
        with self._lock:
            total = self._wins + self._losses
            accuracy = round(self._wins / total, 4) if total > 0 else 0.0
            return {
                "samples": self._samples,
                "wins": self._wins,
                "losses": self._losses,
                "accuracy": accuracy,
                "model_version": self._model_version,
                "trained": bool(self._classes_ready),
            }

    def model_stats(self) -> list[dict]:
        """Statistik per indikator (semantik ModelStat dashboard)."""
        with self._lock:
            out = []
            for ind in INDICATOR_IDS:
                t = self._tally[ind]
                n = t["wins"] + t["losses"]
                out.append(
                    {
                        "indicator": ind,
                        "weight": round(self._weights[ind], 4),
                        "wins": t["wins"],
                        "losses": t["losses"],
                        "samples": n,
                        "winRate": round(t["wins"] / n, 4) if n > 0 else 0.0,
                    }
                )
            return out


def _last_or(a: np.ndarray, default: float = 0.0) -> float:
    """Nilai finite terakhir dari array (default bila kosong)."""
    try:
        if a is None or len(a) == 0:
            return default
        finite = np.isfinite(a)
        if not finite.any():
            return default
        return float(a[np.where(finite)[0][-1]])
    except Exception:  # noqa: BLE001
        return default


__all__ = ["MLModel", "FEATURE_LEN", "FEATURE_NAMES"]
