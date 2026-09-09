# Indikator Pool — 30 Indikator Scalping

Dokumen ini menjelaskan 30 indikator teknikal yang tersedia di dashboard, dikategorikan dan dikonfigurasi untuk strategi scalping FINEX Indonesia.

---

## Daftar Isi

- [Kategori Indikator](#kategori-indikator)
- [Trend Indicators](#trend-indicators)
- [Momentum Indicators](#momentum-indicators)
- [Volatility Indicators](#volatility-indicators)
- [Channel Indicators](#channel-indicators)
- [Volume Indicators](#volume-indicators)
- [Strategi Scalping](#strategi-scalping)
- [AI Auto-Select Indikator](#ai-auto-select-indikator)
- [Konfigurasi Parameter](#konfigurasi-parameter)

---

## Kategori Indikator

| Kategori | Jumlah | Warna | Fungsi |
|---|---|---|---|
| Trend | 8 | Emerald | Identifikasi arah tren dominan |
| Momentum | 9 | Amber | Ukur kekuatan & kecepatan pergerakan |
| Volatility | 5 | Rose | Ukur rentang fluktuasi harga |
| Channel | 2 | Sky | Identifikasi support/resistance dinamis |
| Volume | 5 | Violet | Konfirmasi tekanan beli/jual |

---

## Trend Indicators

### 1. EMA (Exponential Moving Average)
- **Default params:** `fast: 9`, `slow: 21`
- **Scalping hint:** Fast/slow crossover pada M1-M5 untuk bias scalping. EMA lebih responsif daripada SMA.
- **Sinyal:** EMA fast cross above slow = BUY; cross below = SELL.
- **Konfigurasi:** Atur periode sesuai volatilitas pair (XAUUSD cenderung butuh periode lebih panjang).

### 2. SMA (Simple Moving Average)
- **Default params:** `fast: 10`, `slow: 20`
- **Scalping hint:** Filter tren smoothed, pairing dengan momentum. Kurang responsif tapi lebih stabil.
- **Sinyal:** Sama dengan EMA, tapi sinyal lebih lambat.

### 3. VWAP (Volume Weighted Average Price)
- **Default params:** `band: 1.5`
- **Scalping hint:** Fair value intraday; revert dari band. VWAP reset setiap hari.
- **Sinyal:** Harga di atas VWAP = bias bullish; di bawah = bearish. Touch band = mean reversion.

### 4. Supertrend
- **Default params:** `atr: 10`, `multiplier: 3`
- **Scalping hint:** Trailing trend flip; ATR ketat untuk scalping. Memberi sinyal jelas dengan dot hijau/merah.
- **Sinyal:** Flip hijau = BUY; flip merah = SELL. Gunakan sebagai trailing stop dinamis.

### 5. Parabolic SAR
- **Default params:** `step: 0.02`, `max: 0.2`
- **Scalping hint:** Trailing stop dots; exit saat flip. Cocok untuk trending market.
- **Sinyal:** Dot di bawah harga = uptrend (BUY); dot di atas = downtrend (SELL).

### 6. Ichimoku Cloud
- **Default params:** `conversion: 9`, `base: 26`, `span: 52`
- **Scalping hint:** Cloud bias + Tenkan/Kijun cross. Filter tren kuat.
- **Sinyal:** Harga di atas cloud = bullish; di bawah = bearish. Tenkan cross Kijun = konfirmasi.

### 7. Hull Moving Average (HMA)
- **Default params:** `period: 16`
- **Scalping hint:** MA low-lag; color flips untuk scalping. Lebih responsif dari EMA.
- **Sinyal:** HMA naik = BUY; HMA turun = SELL.

### 8. Linear Regression Channel
- **Default params:** `period: 50`, `dev: 2`
- **Scalping hint:** Mean-revert di tepi channel. Identifikasi outlier.
- **Sinyal:** Touch upper band = SELL; touch lower band = BUY.

---

## Momentum Indicators

### 9. RSI (Relative Strength Index)
- **Default params:** `period: 14`, `ob: 70`, `os: 30`
- **Scalping hint:** OB/OS di M1-M5; divergence untuk reversal.
- **Sinyal:** RSI > 70 = overbought (SELL); < 30 = oversold (BUY). Divergence = sinyal kuat.

### 10. Stochastic Oscillator
- **Default params:** `k: 14`, `d: 3`, `smooth: 3`
- **Scalping hint:** %K/%D cross di zona OB/OS.
- **Sinyal:** Cross %K above %D di < 20 = BUY; cross below di > 80 = SELL.

### 11. MACD (Moving Average Convergence Divergence)
- **Default params:** `fast: 12`, `slow: 26`, `signal: 9`
- **Scalping hint:** Histogram momentum shift.
- **Sinyal:** MACD line cross above signal = BUY; below = SELL. Histogram expanding = momentum kuat.

### 12. CCI (Commodity Channel Index)
- **Default params:** `period: 20`
- **Scalping hint:** Ekstrem +/-100 untuk reversal scalping.
- **Sinyal:** CCI > +100 = overbought (SELL); < -100 = oversold (BUY).

### 13. Momentum Indicator
- **Default params:** `period: 10`
- **Scalping hint:** Konfirmasi rate of change.
- **Sinyal:** Momentum > 0 = bullish; < 0 = bearish.

### 14. Williams %R
- **Default params:** `period: 14`
- **Scalping hint:** Ekstrem -20/-80 untuk fade scalping.
- **Sinyal:** > -20 = overbought (SELL); < -80 = oversold (BUY).

### 15. TSI (True Strength Index)
- **Default params:** `r: 25`, `s: 13`
- **Scalping hint:** Momentum smoothed; divergence trade.
- **Sinyal:** TSI cross above signal line = BUY; below = SELL.

### 16. ROC (Rate of Change)
- **Default params:** `period: 9`
- **Scalping hint:** Burst momentum cepat untuk entry.
- **Sinyal:** ROC > 0 = bullish momentum; < 0 = bearish.

### 17. Schaff Trend Cycle (STC)
- **Default params:** `cycle: 10`, `fast: 23`, `slow: 50`
- **Scalping hint:** Cycle turn di 25/75 untuk scalping. Menggabungkan MACD + stochastic.
- **Sinyal:** Cross above 25 = BUY; cross below 75 = SELL.

### 18. Ultimate Oscillator
- **Default params:** `c1: 7`, `c2: 14`, `c3: 28`
- **Scalping hint:** Multi-period OB/OS divergence.
- **Sinyal:** > 70 = overbought (SELL); < 30 = oversold (BUY). Divergence = konfirmasi.

---

## Volatility Indicators

### 19. Bollinger Bands
- **Default params:** `period: 20`, `dev: 2`
- **Scalping hint:** Squeeze breakout; band fade.
- **Sinyal:** Touch upper band = SELL; lower band = BUY. Squeeze (band menyempit) = breakout imminent.

### 20. ATR (Average True Range)
- **Default params:** `period: 14`
- **Scalping hint:** Dynamic SL sizing untuk scalping. Ukur volatilitas untuk set SL pips.
- **Penggunaan:** SL = entry - (ATR * multiplier). Multiplier 1.5-2 untuk scalping.

### 21. Standard Deviation
- **Default params:** `period: 20`
- **Scalping hint:** Filter regime volatilitas.
- **Sinyal:** StdDev tinggi = volatilitas tinggi (lebar SL); rendah = volatilitas rendah.

### 22. Chaikin Volatility
- **Default params:** `period: 10`, `roc: 10`
- **Scalping hint:** Alert ekspansi volatilitas.
- **Sinyal:** Naik tajam = volatilitas membesar (potensi breakout).

### 23. Volatility Ratio
- **Default params:** `period: 14`
- **Scalping hint:** Gauge probabilitas breakout.
- **Sinyal:** Ratio > 1 = volatilitas membesar; < 1 = mengecil.

---

## Channel Indicators

### 24. Keltner Channel
- **Default params:** `period: 20`, `multiplier: 1.5`
- **Scalping hint:** ATR channel; trend ride di dalam.
- **Sinyal:** Touch upper = SELL; lower = BUY. Breakout = tren kuat.

### 25. Donchian Channel
- **Default params:** `period: 20`
- **Scalping hint:** Breakout high/low untuk scalping.
- **Sinyal:** Close above upper = BUY breakout; below lower = SELL breakout.

---

## Volume Indicators

### 26. OBV (On Balance Volume)
- **Default params:** (none)
- **Scalping hint:** Volume konfirmasi tren; divergence warning.
- **Sinyal:** OBV naik = akumulasi (bullish); turun = distribusi (bearish).

### 27. Money Flow Index (MFI)
- **Default params:** `period: 14`
- **Scalping hint:** Volume-weighted OB/OS.
- **Sinyal:** > 80 = overbought (SELL); < 20 = oversold (BUY).

### 28. Tick Volume
- **Default params:** (none)
- **Scalping hint:** Proxy aktivitas tick untuk entry. Di MT5, tick volume = number of price changes.
- **Penggunaan:** Spike volume = konfirmasi move. Volume rendah = hindari trading.

### 29. Volume Profile
- **Default params:** `bins: 24`
- **Scalping hint:** POC (Point of Control) & value area scalping.
- **Sinyal:** Harga revert ke POC. Value area high/low = support/resistance.

### 30. Accumulation Distribution
- **Default params:** (none)
- **Scalping hint:** Flow pressure; divergence trade.
- **Sinyal:** Naik = akumulasi (bullish); turun = distribusi (bearish).

---

## Strategi Scalping

### Setup Optimal (Rekomendasi Dashboard)

**Pair:** EURUSD, GBPUSD (spread terkecil)
**Timeframe:** M5 (utama), M15 (konfirmasi tren)
**Sesi:** London + New York overlap (12:00-16:00 UTC) — likuiditas tertinggi

**Indikator aktif (manual atau AI auto-select):**
1. EMA (9, 21) — bias tren
2. RSI (14) — momentum & OB/OS
3. ATR (14) — dynamic SL sizing
4. Supertrend — trailing stop
5. Bollinger Bands — squeeze breakout

### Sinyal Entry Scalping

**BUY setup:**
- EMA 9 di atas EMA 21 (tren naik)
- RSI di antara 40-60 (ruang untuk naik, tidak OB)
- Harga bounce dari lower Bollinger Band atau Supertrend hijau
- ATR > 5 pips (volatilitas cukup)

**SELL setup:**
- EMA 9 di bawah EMA 21 (tren turun)
- RSI di antara 40-60 (ruang untuk turun)
- Harga reject dari upper Bollinger Band atau Supertrend merah
- ATR > 5 pips

### Exit Strategy

- **Stop Loss:** 5-15 pips (gunakan ATR * 1.5)
- **Take Profit:** SL * 1.5 (R:R 1:1.5)
- **Trailing Stop:** Aktifkan Supertrend atau Parabolic SAR
- **Exit dini:** Jika RSI divergence atau pattern reversal

### Aturan Anti-Scalping

- **Hindari news berdampak tinggi** (NFP, CPI, Fed rate decision) — spread melebar
- **Hindari sesi Sydney** (likuiditas rendah, spread besar)
- **Maksimal 3 posisi** terbuka bersamaan
- **Daily loss limit 3%** — stop trading jika tercapai (Anti-MC)

---

## AI Auto-Select Indikator

Toggle **"AI Auto-Select Indikator"** di header Indicators Lab memungkinkan AI memilih subset indikator optimal berdasarkan:

1. **Regime pasar** (trending vs ranging vs volatile)
2. **Pair** (XAUUSD butuh indikator volatilitas lebih)
3. **Sesi trading** (overlap London-NY butuh momentum indicators)
4. **Timeframe** (M1 butuh indikator fast, H1 butuh slow)

AI menganalisa kombinasi indikator yang aktif dan menyesuaikan parameter untuk maximisasi sinyal yang akurat. Hasil analisa AI disimpan untuk self-learning.

---

## Konfigurasi Parameter

Setiap indikator memiliki parameter yang dapat diatur di UI Indicators Lab:

1. **Enable/Disable** — Switch on/off per indikator
2. **Auto mode** — Toggle AI auto-adjust parameter
3. **Params** — Input numerik untuk setiap parameter (periode, multiplier, dll.)

Perubahan parameter langsung disimpan ke DB (`IndicatorConfig` table) via `PUT /api/indicators`.

### Tips Tuning Parameter

| Pair | EMA fast/slow | RSI period | ATR period | Bollinger dev |
|---|---|---|---|---|
| EURUSD | 9/21 | 14 | 14 | 2.0 |
| GBPUSD | 8/20 | 14 | 14 | 2.0 |
| USDJPY | 10/21 | 14 | 14 | 2.1 |
| XAUUSD | 12/26 | 21 | 14 | 2.5 |

XAUUSD (gold) lebih volatile — gunakan periode lebih panjang & deviasi lebih besar untuk filter noise.

---

## Referensi

- [Investopedia — Technical Indicators](https://www.investopedia.com/terms/t/technicalindicator.asp)
- [TradingView — Indicator Documentation](https://www.tradingview.com/support/studies-study-overview/)
- MetaTrader 5 Documentation — Built-in indicators
