# Manajemen Risiko — FXQuant AI

Dokumen ini menjelaskan aturan money management, kalkulator lot size, dan kontrol risiko yang diimplementasikan di dashboard untuk trading dengan broker FINEX Indonesia.

---

## Daftar Isi

- [Filosofi Risk Management](#filosofi-risk-management)
- [Aturan Utama](#aturan-utama)
- [Kalkulator Lot Size](#kalkulator-lot-size)
- [Daily Risk Limit (Anti-MC)](#daily-risk-limit-anti-mc)
- [Spesifikasi Broker FINEX](#spesifikasi-broker-finex)
- [Implementasi di Dashboard](#implementasi-di-dashboard)
- [Contoh Skenario](#contoh-skenario)
- [Best Practices](#best-practices)

---

## Filosofi Risk Management

> "Aturan pertama trading: lindungi modal Anda. Profit adalah konsekuensi dari manajemen risiko yang baik."

Dashboard ini mengimplementasikan disiplin risk management ketat untuk scalping forex dengan leverage tinggi (1:500). Tujuannya: **memastikan Anda survive di pasar untuk trading jangka panjang**, bukan untung besar sekali lalu margin call.

---

## Aturan Utama

### 1. Risk per Trade: 0.5%–1%

**Definisi:** Maksimal kerugian per posisi adalah 0.5%–1% dari total balance.

**Implementasi:** Diatur via slider di Risk Management section (default 1%).

**Rumus:**
```
Risk$ = Balance × (RiskPerTrade% / 100)
```

**Contoh:** Balance $10,000, risk 1% → max loss per trade = $100.

### 2. Stop Loss: 5–15 pips

**Definisi:** Stop loss absolut dalam pips, disesuaikan untuk scalping.

**Implementasi:** Slider range dengan min/max (default 5-15 pips). Untuk XAUUSD (gold), 1 pip = $0.1, sehingga SL 15 pips = $1.5 pergerakan harga.

**Pemilihan SL:**
- **5-8 pips:** Scalping agresif M1, pair majors (EURUSD, GBPUSD)
- **8-12 pips:** Scalping standar M5
- **12-15 pips:** Scalping konservatif M15 atau pair volatile (XAUUSD)

**Tips:** Gunakan ATR (Average True Range) sebagai panduan. SL = ATR × 1.5 untuk adaptif.

### 3. Risk : Reward Ratio = 1 : 1.5

**Definisi:** Target profit minimal 1.5× stop loss.

**Implementasi:** Slider 1.0–3.0 (default 1.5). TP pips = SL pips × R:R ratio.

**Rumus:**
```
TP pips = SL pips × RR Ratio
```

**Contoh:** SL 10 pips, R:R 1.5 → TP 15 pips.

**Mengapa 1:1.5?** Dengan win rate 50%, Anda tetap profit:
- 10 trades: 5 win × 15 pips = +75 pips; 5 loss × 10 pips = -50 pips → net +25 pips

### 4. Lot Size: Otomatis dari Risk & SL

**Definisi:** Lot size dihitung otomatis berdasarkan risk $ dan SL pips.

**Rumus:**
```
Lot = Risk$ / (SL pips × Pip Value per Lot)
```

**Pip Value per Lot:**
- EURUSD, GBPUSD, USDJPY: $10 per pip per 1.0 lot
- XAUUSD: $1 per pip per 1.0 lot (karena 1 pip = $0.1)

**Contoh:** Balance $10,000, risk 1% ($100), SL 10 pips, EURUSD:
```
Lot = $100 / (10 pips × $10) = 1.0 lot
```

**Implementasi:** Kalkulator Lot Size di Risk Management section menghitung otomatis. Order form di Trading Terminal juga menampilkan risk $ yang dihitung.

### 5. Maksimal Open Position: 1–3

**Definisi:** Batas posisi terbuka bersamaan.

**Implementasi:** Slider 1–5 (default 3). Broker FINEX memungkinkan hingga 200, tapi dashboard membatasi untuk kontrol risiko.

**Logika:** Dengan 3 posisi × 1% risk = 3% total exposure (sesuai daily limit).

### 6. Daily Risk Limit (Anti-MC): 2%–3%

**Definisi:** Total kerugian harian maksimal sebelum trading dihentikan otomatis.

**Implementasi:** Slider 1%–5% (default 3%). Progress bar menampilkan penggunaan harian.

**Aturan:** Jika `dailyLossUsed >= dailyLossLimit`, endpoint `/api/trade/place` menolak order baru dengan error:
```
Daily risk limit 3% tercapai (Anti-MC). Trading dihentikan hari ini.
```

**Reset:** `dailyLossUsed` reset setiap hari (di produksi, bridge reset di midnight server time).

### 7. Hindari News Besar Saat Scalping

**Definisi:** Jangan open posisi saat news berdampak tinggi (NFP, CPI, Fed rate).

**Implementasi:** Toggle "Avoid High-Impact News" (default ON). Saat aktif, AI mempertimbangkan kalender ekonomi dalam analisa.

**News high-impact yang dihindari:**
- Non-Farm Payroll (NFP) — Jumat pertama setiap bulan
- CPI / PPI — bulanan
- GDP — kuartalan
- Fed Rate Decision — 8× per tahun
- ECB / BoJ / BoE rate decision

### 8. Target Harian Realistis: 1%–3%

**Definisi:** Target profit harian yang realistis untuk scalping.

**Implementasi:** Slider 1%–5% (default 2%).

**Tips:** Jangan serakah. Jika target tercapai, pertimbangkan stop trading untuk hari itu. Konsistensi > heroics.

---

## Kalkulator Lot Size

Panel **"Kalkulator Lot Size"** di Risk Management section menghitung lot optimal:

**Input:**
- Balance (default dari account balance)
- Pair (EURUSD, USDJPY, GBPUSD, XAUUSD)
- Risk % (0.5–2%)
- Stop Loss pips (5–15)

**Output:**
- **Lot Size** (hasil utama, ditampilkan prominent)
- **Risk $** = Balance × Risk%
- **Potential Loss** = Risk $ (jika SL hit)
- **Potential Profit** = Risk $ × R:R ratio (jika TP hit)

**Contoh perhitungan:**

| Balance | Pair | Risk% | SL pips | Lot | Risk$ | Profit@1.5RR |
|---|---|---|---|---|---|---|
| $10,000 | EURUSD | 1% | 10 | 1.00 | $100 | $150 |
| $10,000 | GBPUSD | 0.5% | 8 | 0.63 | $50 | $75 |
| $5,000 | USDJPY | 1% | 12 | 0.42 | $50 | $75 |
| $10,000 | XAUUSD | 1% | 15 | 6.67 | $100 | $150 |

**Catatan XAUUSD:** Pip value berbeda ($1 per pip per lot, bukan $10). SL 15 pips pada XAUUSD = $1.5 pergerakan harga. Lot size biasanya lebih besar.

---

## Daily Risk Limit (Anti-MC)

### Mekanisme Anti-MC

```
Setiap trade closed dengan loss:
  dailyLossUsed += (|loss| / balance) × 100

Sebelum open trade baru:
  if dailyLossUsed >= dailyLossLimit:
    REJECT order ("Daily risk limit tercapai — Anti-MC")
    Log WARN: "Trade rejected: daily loss limit reached"
```

### Progress Bar

Panel **"Aturan Anti-MC"** menampilkan:
- Progress bar `dailyLossUsed / dailyLossLimit × 100%`
- Warna: hijau (< 50%), amber (50-80%), rose (> 80%)
- Status: "Aman" / "Hati-hati" / "Stop Trading"

### Spesifikasi Broker FINEX

| Level | Threshold | Tindakan |
|---|---|---|
| Margin Call | 50% | Warning, tidak bisa open posisi baru |
| Stop Out | 20% | Posisi paling loss auto-close oleh broker |

Dashboard menampilkan referensi ini di Risk Management section.

---

## Spesifikasi Broker FINEX

| Parameter | Nilai | Dampak pada Trading |
|---|---|---|
| Leverage | 1:500 | Margin kecil per lot, bisa open posisi besar |
| Spread | dari 0.5 pip | Biaya per trade, penting untuk scalping |
| Komisi | $1 per lot | Tambahan biaya, hitung ke net P&L |
| Min Volume | 0.01 lot | Bisa mulai dengan risiko kecil |
| Max Volume / Order | 50 lot | Batas maksimum per order |
| Max Open Positions | 200 | Dashboard batasi ke 3 untuk risiko |
| Margin Call | 50% | Equity = 50% margin required |
| Stop Out | 20% | Equity = 20% margin, auto-close |

### Perhitungan Margin

```
Margin = (Lot × Contract Size × Price) / Leverage

EURUSD, 1.0 lot, price 1.0855, leverage 1:500:
Margin = (1.0 × 100,000 × 1.0855) / 500 = $217.10

XAUUSD, 1.0 lot, price 2338.5, leverage 1:500:
Margin = (1.0 × 100 × 2338.5) / 500 = $467.70
```

**Catatan:** Contract size XAUUSD = 100 oz (bukan 100,000).

---

## Implementasi di Dashboard

### Risk Management Section

Konfigurasi disimpan di DB (`Configuration` table, key="risk") dan di-load ke Zustand store.

**Controls:**
1. Risk per Trade slider (0.5–2%, step 0.1)
2. Stop Loss Range (min 3–10, max 10–20 pips)
3. Risk:Reward Ratio slider (1.0–3.0, step 0.1)
4. Max Open Positions slider (1–10)
5. Daily Loss Limit slider (1–5%)
6. Daily Target slider (1–5%)
7. Avoid High-Impact News toggle
8. AI Auto Risk toggle (AI adjust parameter otomatis)

Setiap perubahan → `PUT /api/config/risk` → toast "Risiko diperbarui".

### Order Form (Trading Terminal)

Saat user input SL pips, dashboard menghitung real-time:
- Risk $ = Balance × RiskPerTrade%
- Reward $ = Risk $ × R:R ratio
- R:R display (1:1.5)

### Server-side Enforcement

`POST /api/trade/place` memvalidasi:
1. **Max open positions:** `count(OPEN trades) >= maxOpenPositions` → reject
2. **Daily loss limit:** `dailyLossUsed >= dailyLossLimit` → reject (Anti-MC)

Error response (400):
```json
{
  "error": "Maksimal 3 posisi terbuka tercapai"
}
```
atau
```json
{
  "error": "Daily risk limit 3% tercapai (Anti-MC). Trading dihentikan hari ini."
}
```

---

## Contoh Skenario

### Skenario 1: Scalping EURUSD Standar

- Balance: $10,000
- Risk per trade: 1% → Risk$ = $100
- SL: 10 pips
- R:R: 1:1.5 → TP: 15 pips
- Lot: $100 / (10 × $10) = **1.0 lot**
- Margin: ($217.10)
- Potential loss: -$100 (SL hit)
- Potential profit: +$150 (TP hit)

### Skenario 2: Scalping XAUUSD Konservatif

- Balance: $10,000
- Risk per trade: 0.5% → Risk$ = $50
- SL: 12 pips ($1.2 move pada gold)
- R:R: 1:1.5 → TP: 18 pips ($1.8 move)
- Lot: $50 / (12 × $1) = **4.17 lot**
- Margin: ~$1,948
- Potential loss: -$50
- Potential profit: +$75

### Skenario 3: Anti-MC Triggered

- Balance: $10,000
- Daily loss limit: 3% → $300
- Trade 1 loss: -$100 → dailyLossUsed = 1%
- Trade 2 loss: -$100 → dailyLossUsed = 2%
- Trade 3 loss: -$100 → dailyLossUsed = 3%
- Trade 4 attempt: **REJECTED** ("Daily risk limit 3% tercapai — Anti-MC")
- Trading dihentikan untuk hari itu

---

## Best Practices

### DO (Lakukan)
- **Selalu set SL** sebelum atau saat open posisi
- **Mulai dengan akun demo** minimal 1 bulan
- **Gunakan risk 0.5%** saat baru mulai live
- **Backtest strategi** sebelum live trading
- **Stop trading** saat daily target tercapai (1-3%)
- **Catat setiap trade** di journal untuk evaluasi
- **Monitor sesi trading** — hanya scalping saat London/NY aktif

### DON'T (Hindari)
- **Jangan trade tanpa SL** — akan margin call cepat atau lambat
- **Jangan risk > 2%** per trade — terlalu agresif
- **Jangan open > 3 posisi** bersamaan
- **Jangan trade saat news high-impact** (spread melebar, SL slip)
- **Jangan revenge trade** setelah loss — emosi = musuh
- **Jangan trade di sesi Sydney** (likuiditas rendah, spread besar)
- **Jangan gunakan akun real** sebelum profitable di demo 3 bulan berturut-turut

### Daily Routine Scalping
1. **Pre-market (08:00 WIB):** Cek kalender ekonomi, identifikasi news high-impact
2. **London open (14:00 WIB):** Mulai monitor, tunggu setup
3. **London-NY overlap (18:00-22:00 WIB):** Prime time scalping, maksimal 3 posisi
4. **Post-market (22:00 WIB):** Close semua posisi, evaluasi harian, reset untuk besok

---

## Referensi

- [FINEX Indonesia — Spesifikasi Trading](https://finex.co.id)
- [BabyPips — Risk Management](https://www.babypips.com/learn/forex/risk-management)
- [Investopedia — Position Sizing](https://www.investopedia.com/terms/p/position_sizing.asp)
- Van Tharp — "Trade Your Way to Financial Freedom" (buku position sizing klasik)
