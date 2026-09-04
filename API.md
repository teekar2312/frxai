# API Documentation

> Dokumentasi lengkap 58 API endpoints FINEX AI Trader

---

## Daftar Isi

- [Overview](#overview)
- [Account](#account)
- [AI Decision Engine](#ai-decision-engine)
- [Alerts](#alerts)
- [Analysis](#analysis)
- [Audit](#audit)
- [Backtest](#backtest)
- [Execution](#execution)
- [Indicators](#indicators)
- [Logs](#logs)
- [Money Management](#money-management)
- [MT5 Connection](#mt5-connection)
- [News & Sentiment](#news--sentiment)
- [Reports](#reports)
- [Risk Management](#risk-management)
- [Sessions](#sessions)
- [Stocks](#stocks)
- [Strategies](#strategies)
- [System](#system)
- [Trades](#trades)
- [Error Responses](#error-responses)

---

## Overview

**Base URL:** `http://localhost:3000/api`

**Response Format:** Semua endpoint mengembalikan format uniform:

```json
{
  "success": true,
  "data": { ... }
}
```

**Error Format:**

```json
{
  "success": false,
  "error": "Deskripsi error"
}
```

**HTTP Status Codes:**

| Code | Arti |
|------|------|
| 200 | Success |
| 201 | Created |
| 404 | Not found |
| 409 | Conflict (duplicate) |
| 422 | Validation / business rule error |
| 500 | Internal server error |

---

## Account

### GET `/api/account`

Ringkasan akun trading lengkap.

**Response:**

```json
{
  "success": true,
  "data": {
    "broker": "FINEX Indonesia",
    "accountType": "Real",
    "balance": 10000,
    "equity": 10250,
    "marginUsed": 1500,
    "freeMargin": 8750,
    "marginLevel": 683,
    "leverage": 25,
    "spread": 0.5,
    "commission": 1,
    "dailyPnl": 250,
    "dailyPnlPercent": 2.5,
    "openPositions": 3,
    "totalTradesToday": 8,
    "winRate": 62.5,
    "winRateToday": 62.5,
    "hasRealData": true,
    "totalTrades": 150,
    "currency": "USD",
    "accountNumber": "12345"
  }
}
```

---

### GET `/api/account/equity-curve`

Data equity curve untuk chart.

**Query Parameters:**

| Param | Type | Default | Deskripsi |
|-------|------|---------|-----------|
| `range` | string | `"1M"` | `1D`, `1W`, `1M`, `3M` |

**Response:**

```json
{
  "success": true,
  "data": [
    { "date": "2025-01-01", "balance": 10000, "equity": 10000 },
    { "date": "2025-01-02", "balance": 10150, "equity": 10180 }
  ]
}
```

---

## AI Decision Engine

### POST `/api/ai/decide`

Membuat keputusan trading AI (single atau batch).

**Request Body (Single):**

```json
{
  "symbol": "BBCA",
  "timeframe": "H1"
}
```

**Request Body (Batch):**

```json
{
  "symbols": ["BBCA", "BBRI", "TLKM"],
  "timeframe": "H1"
}
```

**Query Parameters:**

| Param | Type | Default | Deskripsi |
|-------|------|---------|-----------|
| `useLearning` | string | `"false"` | Set `"true"` untuk menggunakan self-learning weights |

**Response:**

```json
{
  "success": true,
  "data": {
    "symbol": "BBCA",
    "decision": "BUY",
    "confidence": 78.5,
    "reasoning": "Strong bullish momentum with RSI at 45, MACD bullish crossover, positive sentiment score (+32), daily loss within limits.",
    "factors": {
      "technical": { "score": 75, "weight": 0.5 },
      "news": { "score": 60, "weight": 0.25 },
      "sentiment": { "score": 32, "weight": 0.25 },
      "risk": { "dailyLossPct": 0.5, "drawdownPct": 2.1 }
    },
    "signalSources": ["EMA_CROSSOVER", "RSI_OVERSOLD"],
    "riskScore": 15,
    "sentimentScore": 32,
    "volatilityRegime": "NORMAL",
    "strategyUsed": "EMA Crossover",
    "timeframe": "H1"
  },
  "meta": { "adaptiveLearning": false }
}
```

---

### GET `/api/ai/decide`

Riwayat keputusan AI.

**Query Parameters:**

| Param | Type | Default | Deskripsi |
|-------|------|---------|-----------|
| `symbol` | string | — | Filter berdasarkan simbol |
| `limit` | number | `20` | Jumlah record (max 100) |

---

### GET `/api/ai/accuracy`

Statistik akurasi keputusan AI.

**Query Parameters:**

| Param | Type | Default | Deskripsi |
|-------|------|---------|-----------|
| `days` | number | `7` | Periode analisis |
| `config` | string | `"false"` | Set `"true"` untuk include config |
| `learning` | string | `"false"` | Set `"true"` untuk include self-learning state |
| `strategies` | string | `"false"` | Set `"true"` untuk include strategy performance |

**Response:**

```json
{
  "success": true,
  "data": {
    "accuracy": {
      "overallAccuracy": 68.5,
      "totalDecisions": 120,
      "correctDecisions": 82,
      "byDecision": {
        "BUY": { "total": 45, "correct": 32, "accuracy": 71.1 },
        "SELL": { "total": 30, "correct": 20, "accuracy": 66.7 },
        "HOLD": { "total": 35, "correct": 25, "accuracy": 71.4 },
        "SKIP": { "total": 10, "correct": 5, "accuracy": 50.0 }
      }
    }
  }
}
```

---

### PUT `/api/ai/accuracy`

Update konfigurasi AI Decision Engine.

**Request Body:**

```json
{
  "minConfidenceBuy": 70,
  "minConfidenceSell": 70,
  "sentimentWeight": 0.3,
  "technicalWeight": 0.45,
  "newsWeight": 0.25
}
```

---

### POST `/api/ai/accuracy`

Trigger self-learning feedback loop.

**Query Parameters:**

| Param | Type | Default | Deskripsi |
|-------|------|---------|-----------|
| `days` | number | `30` | Periode analisis feedback |

---

## Alerts

### GET `/api/alerts`

Daftar price alerts.

**Query Parameters:**

| Param | Type | Default | Deskripsi |
|-------|------|---------|-----------|
| `active` | string | `"true"` | Filter status active |
| `symbol` | string | — | Filter berdasarkan simbol |
| `limit` | number | `100` | Jumlah maks (max 500) |

---

### POST `/api/alerts`

Buat price alert baru.

**Request Body:**

```json
{
  "symbol": "BBCA",
  "condition": "ABOVE",
  "price": 9850,
  "message": "BBCA break resistance 9850"
}
```

**Conditions:** `ABOVE`, `BELOW`, `CROSS_UP`, `CROSS_DOWN`

---

### PATCH `/api/alerts/:id`

Update price alert.

**Request Body (partial):**

```json
{
  "active": false,
  "condition": "BELOW",
  "price": 9500
}
```

---

### DELETE `/api/alerts/:id`

Hapus price alert.

---

## Analysis

### GET `/api/analysis`

Daftar analisis AI.

**Query Parameters:**

| Param | Type | Default | Deskripsi |
|-------|------|---------|-----------|
| `symbol` | string | — | Filter simbol |
| `limit` | number | `10` | Jumlah (max 50) |

---

### POST `/api/analysis`

Generate analisis AI baru.

**Request Body:**

```json
{
  "symbol": "BBCA",
  "timeframe": "H1"
}
```

---

## Audit

### GET `/api/audit`

Status compliance audit lengkap.

**Response:**

```json
{
  "success": true,
  "data": {
    "auditPhase": 6,
    "totalIssuesFound": 0,
    "totalIssuesFixed": 43,
    "compliance": {
      "mt5Connection": "PASS",
      "riskManagement": "PASS",
      "moneyManagement": "PASS",
      "sessionManager": "PASS",
      "indicatorPool": "PASS",
      "tradeExecution": "PASS",
      "newsApi": "PASS",
      "sentimentFilter": "PASS",
      "aiDecisionEngine": "PASS"
    },
    "systemHealth": { ... },
    "riskEvents": [],
    "recentSessionEvents": []
  }
}
```

---

## Backtest

### GET `/api/backtest`

Daftar hasil backtest terakhir.

---

### POST `/api/backtest`

Jalankan backtest strategi.

**Request Body:**

```json
{
  "symbol": "BBCA",
  "strategy": "EMA_CROSSOVER",
  "timeframe": "H1",
  "startDate": "2025-01-01",
  "endDate": "2025-03-01",
  "initialCapital": 10000,
  "config": {
    "riskPerTrade": 1,
    "slAtrMult": 2,
    "tpAtrMult": 3,
    "slippagePips": 0.5
  },
  "name": "BBCA EMA Cross Jan-Mar 2025"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "...",
    "totalTrades": 45,
    "winRate": 62.2,
    "totalPnl": 1250,
    "maxDrawdown": 3.2,
    "sharpeRatio": 1.85,
    "profitFactor": 1.9,
    "equityCurve": [...],
    "simulatedTrades": [...]
  }
}
```

---

### DELETE `/api/backtest?id=:id`

Hapus hasil backtest.

---

## Execution

### POST `/api/execution/price-update`

Process price update melalui pipeline lengkap: trailing stops → SL/TP triggers → partial close → price alerts.

**Request Body:**

```json
{
  "prices": {
    "BBCA": 9750,
    "BBRI": 5420,
    "TLKM": 3850
  }
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "tradesUpdated": 3,
    "trailingAdjustments": 1,
    "slTpClosed": 0,
    "partialCloses": 0,
    "alertsTriggered": 0
  }
}
```

---

### GET `/api/execution/partial-close`

Hitung level partial close untuk trade.

**Query Parameters:**

| Param | Type | Required | Deskripsi |
|-------|------|----------|-----------|
| `tradeId` | string | Ya | ID trade |

---

### POST `/api/execution/partial-close`

Eksekusi partial close pada trade.

**Request Body:**

```json
{
  "tradeId": "clxxxx...",
  "closePercentage": 50,
  "reason": "Take partial profit at +2%"
}
```

---

### POST `/api/execution/emergency-close`

Tutup semua posisi secara darurat (margin call / connection loss).

**Request Body (optional):**

```json
{
  "reason": "Margin call level reached"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "totalTrades": 5,
    "closedCount": 4,
    "alreadyClosedCount": 1,
    "totalPnl": -320.5,
    "trades": [...]
  }
}
```

---

### POST `/api/execution/trailing-stop`

Trigger manual trailing stop evaluation.

**Request Body:**

```json
{
  "tradeId": "clxxxx...",
  "currentPrice": 9800,
  "trailingSteps": [
    { "triggerPct": 1.0, "newTrailingPct": 0.8 },
    { "triggerPct": 2.0, "newTrailingPct": 0.5 }
  ]
}
```

---

## Indicators

### GET `/api/indicators/compute`

Hitung indikator teknikal spesifik.

**Query Parameters:**

| Param | Type | Default | Deskripsi |
|-------|------|---------|-----------|
| `symbol` | string | `"BBCA"` | Simbol saham IDX |
| `timeframe` | string | `"H1"` | Timeframe candle |
| `indicators` | string | All | Comma-separated: `SMA,EMA,RSI,MACD,ATR,BOLLINGER,STOCHASTIC,ADX,VWAP,PIVOT_POINTS` |
| `refresh` | string | `"false"` | Set `"true"` untuk bypass cache |

**Response:**

```json
{
  "success": true,
  "data": {
    "symbol": "BBCA",
    "timeframe": "H1",
    "candleCount": 100,
    "latestClose": 9750,
    "indicators": {
      "RSI": {
        "calculated": true,
        "error": null,
        "values": { "rsi": 55.3 },
        "timestamp": "2025-01-15T10:30:00Z"
      },
      "MACD": { ... },
      "EMA": { ... }
    },
    "metadata": {
      "computedAt": "2025-01-15T10:30:00Z",
      "cacheHits": 3,
      "cacheMisses": 1
    }
  }
}
```

---

### POST `/api/indicators/compute`

Capture full indicator snapshot untuk dokumentasi trade entry.

**Request Body:**

```json
{
  "symbol": "BBCA",
  "timeframe": "H1"
}
```

---

## Logs

### GET `/api/logs`

Fetch trading logs dengan filter dan statistik.

**Query Parameters:**

| Param | Type | Default | Deskripsi |
|-------|------|---------|-----------|
| `limit` | number | `50` | Jumlah (1-200) |
| `level` | string | — | `DEBUG`, `INFO`, `WARN`, `ERROR`, `CRITICAL`, `FATAL` |
| `category` | string | — | `MT5_CONNECTION`, `TRADE_EXECUTION`, `RISK_MANAGEMENT`, dll. |
| `symbol` | string | — | Filter simbol |
| `startDate` | string | — | Filter dari tanggal (ISO) |
| `endDate` | string | — | Filter sampai tanggal (ISO) |
| `analytics` | string | `"false"` | Set `"true"` untuk include analytics |

---

### POST `/api/logs`

Buat log entry baru.

**Request Body:**

```json
{
  "message": "Manual trade opened",
  "level": "INFO",
  "category": "TRADE_EXECUTION",
  "symbol": "BBCA",
  "tradeId": "clxxxx...",
  "details": "Buy 1 lot at 9750",
  "metadata": { "direction": "BUY", "lotSize": 1 }
}
```

---

### GET `/api/logs/export`

Export trading logs sebagai file download.

**Query Parameters:**

| Param | Type | Default | Deskripsi |
|-------|------|---------|-----------|
| `level` | string | — | Filter level |
| `category` | string | — | Filter kategori |
| `startDate` | string | 7 hari lalu | Filter dari tanggal |
| `endDate` | string | Sekarang | Filter sampai tanggal |
| `format` | string | `"json"` | `json` atau `csv` |
| `limit` | number | `10000` | Jumlah maks (max 50000) |

**Response:** Binary file download dengan `Content-Disposition: attachment`.

---

## Money Management

### GET `/api/money-management`

Multi-action endpoint untuk data money management.

**Query Parameters:**

| Param | Type | Required | Deskripsi |
|-------|------|----------|-----------|
| `action` | string | — | `daily-performance`, `risk-of-ruin`, `drawdown-recovery`, `scaling-factor`, `exchange-rate-risk`, `history` |

---

### POST `/api/money-management`

**Action: `calculate-size`** — Hitung position size optimal.

**Request Body:**

```json
{
  "action": "calculate-size",
  "symbol": "BBCA",
  "direction": "BUY",
  "entryPrice": 9750,
  "sl": 9600,
  "equity": 10250,
  "method": "FIXED_FRACTIONAL"
}
```

**Methods:** `FIXED_FRACTIONAL`, `KELLY`, `FIXED_DOLLAR`, `ANTI_MARTINGALE`

**Response:**

```json
{
  "success": true,
  "data": {
    "suggestedLotSize": 2,
    "riskAmount": 50,
    "riskPercent": 0.49,
    "method": "FIXED_FRACTIONAL",
    "pipRisk": 150,
    "contractValue": 19500,
    "marginRequired": 780,
    "reasoning": "Risk 0.49% of equity ($50) with 150 pips SL",
    "commissionCost": 2,
    "netRiskAfterCommission": 52,
    "scalingFactor": 1.0,
    "volatilityRegimeMultiplier": 1.0,
    "reserveCheckApplied": true,
    "deployedMarginCheckApplied": false
  }
}
```

**Action: `risk-of-ruin`** — Hitung risk of ruin.

---

### GET `/api/money-management/win-rate`

Hitung penyesuaian sizing berdasarkan win rate.

---

### GET `/api/money-management/halt-status`

Status pre-trade halt (consecutive loss, equity curve, session risk, market hours).

---

## MT5 Connection

### GET `/api/mt5/status`

Status koneksi MT5 lengkap.

**Response:**

```json
{
  "success": true,
  "data": {
    "status": "CONNECTED",
    "broker": "FINEX Indonesia",
    "server": "FINEX-Server",
    "accountNumber": "12345",
    "latencyMs": 45,
    "uptimeSeconds": 7200,
    "reconnectCount": 0,
    "isMarketOpen": true,
    "tradingPhase": "OPEN",
    "consecutiveHeartbeatFailures": 0,
    "recentLogs": [],
    "stats": { ... }
  }
}
```

---

### POST `/api/mt5/connect`

**Connect ke MT5 broker:**

```json
{
  "login": "12345",
  "password": "your_password",
  "server": "FINEX-Server"
}
```

**Disconnect dari MT5 broker:**

```json
{
  "action": "disconnect"
}
```

---

## News & Sentiment

### GET `/api/news`

Daftar berita tersimpan.

**Query Parameters:**

| Param | Type | Default | Deskripsi |
|-------|------|---------|-----------|
| `limit` | number | `20` | Jumlah (max 100) |
| `category` | string | — | Filter kategori |
| `symbol` | string | — | Cari dalam JSON symbols array |

---

### GET `/api/news/fetch`

Statistik news dan deteksi breaking news.

---

### POST `/api/news/fetch`

Fetch berita dari Finnhub/Marketaux.

**Request Body (optional):**

```json
{
  "symbols": ["BBCA", "BBRI"],
  "maxArticles": 20,
  "provider": "FINNHUB",
  "forceRefresh": false
}
```

---

### POST `/api/news/sentiment`

Re-score sentimen berita menggunakan NLP lexicon.

**Request Body (optional):**

```json
{
  "unscoredOnly": true
}
```

---

### GET `/api/sentiment/snapshot`

Multi-mode sentiment endpoint.

**Query Parameters:**

| Param | Type | Default | Deskripsi |
|-------|------|---------|-----------|
| `symbol` | string | — | Per-symbol sentiment |
| `market` | string | `"false"` | Set `"true"` untuk market-wide sentiment |
| `trend` | string | — | Simbol untuk sentiment trend |
| `hours` | number | `24` | Jam untuk trend analysis |
| `stats` | string | `"false"` | Set `"true"` untuk aggregate stats |

---

### POST `/api/sentiment/filter`

Cek apakah trade harus diblokir atau di-adjust berdasarkan sentimen.

**Request Body:**

```json
{
  "symbol": "BBCA",
  "direction": "BUY"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "shouldBlock": false,
    "regime": "NEUTRAL",
    "sizeAdjustment": 1.0,
    "symbolScore": 15.5,
    "reasoning": "Neutral sentiment regime, no size adjustment needed"
  }
}
```

---

## Reports

### GET `/api/reports/performance`

Laporan performa lengkap.

**Query Parameters:**

| Param | Type | Default | Deskripsi |
|-------|------|---------|-----------|
| `period` | string | `"30d"` | `7d`, `30d`, `90d`, `1y` |
| `groupBy` | string | — | `symbol`, `strategy`, `session` |
| `startDate` | string | — | Override start date (ISO) |
| `endDate` | string | — | Override end date (ISO) |

**Response:**

```json
{
  "success": true,
  "data": {
    "period": { "startDate": "2025-01-01", "endDate": "2025-01-30" },
    "overall": {
      "totalTrades": 120,
      "winRate": 62.5,
      "totalPnl": 3250,
      "avgPnl": 27.08,
      "profitFactor": 1.85,
      "maxDrawdown": 3.2,
      "avgWin": 85.5,
      "avgLoss": -42.3,
      "totalCommission": 120,
      "totalSlippage": 15
    },
    "byGroup": [...],
    "dailyPnl": [...]
  }
}
```

---

## Risk Management

### GET `/api/risk`

Snapshot risiko lengkap.

---

### GET `/api/risk/gap-risk`

Assessment risiko overnight gap.

**Query Parameters:**

| Param | Type | Required | Deskripsi |
|-------|------|----------|-----------|
| `symbol` | string | Ya | Simbol saham |
| `direction` | string | Ya | `BUY` atau `SELL` |
| `entryPrice` | number | Ya | Harga entry |
| `volatility` | number | Tidak | Volatilitas override |

---

### POST `/api/risk/auto-resolve`

Auto-resolve risk events yang sudah stale.

**Request Body (optional):**

```json
{
  "maxAgeMinutes": 60
}
```

---

### GET `/api/risk-events`

Daftar risk events dengan statistik.

**Query Parameters:**

| Param | Type | Default | Deskripsi |
|-------|------|---------|-----------|
| `limit` | number | `20` | Jumlah (1-100) |
| `severity` | string | — | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` |
| `resolved` | string | — | `"true"` atau `"false"` |

---

### PATCH `/api/risk-events`

Resolve atau unresolve risk event.

**Request Body:**

```json
{
  "id": "clxxxx...",
  "resolved": true
}
```

---

## Sessions

### GET `/api/sessions`

State sesi trading lengkap (IDX + Forex).

**Query Parameters:**

| Param | Type | Default | Deskripsi |
|-------|------|---------|-----------|
| `include` | string | — | `performance`, `events`, `all` |

---

### GET `/api/sessions/performance`

Performa sesi hari ini dan risk budget.

---

## Stocks

### GET `/api/stocks`

Watchlist 20 saham IDX.

**Query Parameters:**

| Param | Type | Default | Deskripsi |
|-------|------|---------|-----------|
| `symbol` | string | — | Fuzzy search |
| `sector` | string | — | Exact match sektor |

---

## Strategies

### GET `/api/strategies`

Hitung sinyal semua 7 strategi.

**Query Parameters:**

| Param | Type | Default | Deskripsi |
|-------|------|---------|-----------|
| `symbol` | string | `"BBCA"` | Simbol saham IDX |
| `timeframe` | string | `"H1"` | Timeframe candle |
| `refresh` | string | `"false"` | Bypass cache |

---

## System

### GET `/api/system/trading-enabled`

Cek status auto-trading toggle.

---

### PUT `/api/system/trading-enabled`

Toggle auto-trading on/off.

**Request Body:**

```json
{
  "enabled": true
}
```

---

## Trades

### GET `/api/trades`

Daftar semua trade yang sedang open.

---

### POST `/api/trades`

Buka trade baru (dengan pre-trade risk check).

**Request Body:**

```json
{
  "symbol": "BBCA",
  "direction": "BUY",
  "lotSize": 1,
  "entryPrice": 9750,
  "sl": 9600,
  "tp": 10000,
  "trailingStop": true,
  "trailingDist": 100,
  "strategy": "EMA Crossover",
  "timeframe": "H1",
  "marketCond": "TRENDING",
  "aiConfidence": 78.5
}
```

**Response (201):**

```json
{
  "success": true,
  "data": { "id": "clxxxx...", "status": "OPEN", ... },
  "riskCheck": { "passed": true, "warnings": [] },
  "moneyManagement": {
    "suggestedLotSize": 1,
    "effectiveLotSize": 1,
    "method": "FIXED_FRACTIONAL",
    "riskAmount": 50,
    "marginRequired": 390,
    "commissionCost": 1,
    "scalingFactor": 1.0,
    "reasoning": "..."
  }
}
```

**Response (422 — Risk Rejected):**

```json
{
  "success": false,
  "error": "Risk check failed: daily loss limit reached (2.5% > 2.0%)"
}
```

---

### PATCH `/api/trades/:id`

**Close trade:**

```json
{
  "status": "CLOSED",
  "closePrice": 9900,
  "reason": "Manual close - target reached"
}
```

**Update trade fields:**

```json
{
  "sl": 9650,
  "tp": 10100,
  "trailingStop": true,
  "trailingDist": 80,
  "currentPrice": 9850
}
```

---

### DELETE `/api/trades/:id`

Hapus trade.

---

### GET `/api/trades/history`

Riwayat trade yang sudah ditutup.

**Query Parameters:**

| Param | Type | Default | Deskripsi |
|-------|------|---------|-----------|
| `symbol` | string | — | Filter simbol |
| `strategy` | string | — | Filter strategi |
| `outcome` | string | `"all"` | `all`, `win`, `loss` |
| `page` | number | `1` | Halaman |
| `limit` | number | `20` | Per halaman (1-100) |
| `startDate` | string | — | Filter dari tanggal |
| `endDate` | string | — | Filter sampai tanggal |
| `sort` | string | `"closeTime"` | `closeTime`, `pnl`, `pnlPercent` |
| `order` | string | `"desc"` | `asc` atau `desc` |

**Response:**

```json
{
  "success": true,
  "data": [...],
  "total": 150,
  "page": 1,
  "limit": 20,
  "aggregates": {
    "totalPnl": 3250,
    "winRate": 62.5,
    "avgPnl": 21.67,
    "totalCommission": 150,
    "totalSlippage": 18.5
  }
}
```

---

## Error Responses

Semua error mengikuti format uniform:

```json
{
  "success": false,
  "error": "Deskripsi error yang spesifik"
}
```

| HTTP Code | Tipe Error | Contoh |
|-----------|-------------|--------|
| 400 | Bad Request | Missing required field |
| 404 | Not Found | Trade/Alert not found |
| 409 | Conflict | Duplicate alert |
| 422 | Validation | Risk check failed, invalid params |
| 500 | Server Error | Database error, MT5 connection failed |

---

## v2.0 — Hardening Endpoints (Monitoring, Config, Notifications)

### Health & Metrics

#### `GET /api/health`
Liveness & readiness probe. **Exempt dari rate limiting.**

| Param | Nilai | Deskripsi |
|-------|-------|-----------|
| `type` | `liveness` (default) / `readiness` | Kedalaman pemeriksaan |

Response `200` (HEALTHY/DEGRADED) atau `503` (UNHEALTHY):
```json
{
  "success": true,
  "data": {
    "status": "HEALTHY", "type": "readiness", "version": "2.0.0",
    "uptimeSeconds": 3600, "latencyMs": 12, "timestamp": "…",
    "checks": {
      "database": { "ok": true, "latencyMs": 3 },
      "mt5Bridge": { "ok": true, "latencyMs": 8, "detail": "bridge reachable" },
      "memory": { "ok": true, "detail": "rss=1333MB heap=166MB" },
      "disk": { "ok": true },
      "environment": { "ok": true, "detail": "optional credentials missing: …" }
    }
  }
}
```
Readiness dipersist ke `HealthCheckLog` (retensi 24 jam).

#### `GET /api/metrics`
| Param | Nilai | Deskripsi |
|-------|-------|-----------|
| `format` | `json` (default) / `prometheus` | Format eksposisi |
| `snapshot` | `true` | Paksa persist snapshot ke `MetricsSnapshot` |

JSON: counter/gauge/histogram (p50/p95/p99) + stats rate limiter. Prometheus: text exposition (`# HELP`, `# TYPE`, label escapes).

### Rate Limiting (semua `/api/*`)

Header respons: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `X-RateLimit-Tier`, `X-Request-Id`.
Response `429`:
```json
{ "success": false, "error": { "code": "RATE_LIMITED", "message": "Rate limit exceeded (AI): max 10 requests per window. Retry after 45s.", "tier": "AI", "limit": 10, "retryAfterSec": 45, "resetAt": "…" } }
```
Tier default per window: READ 100, WRITE 20, AI 10, DRAFT 5 — env: `RATE_LIMIT_*`.

### Configuration

#### `GET /api/config?scope=trading|risk|bridge|rateLimit|logging|notifications|backtest|monitoring`
Entri dengan nilai efektif + asal layer (`runtime` > `database` > `env` > `default`).

#### `PATCH /api/config`
Body `{ "key": "trading.leverage", "value": 30 }` → override runtime (persisted ke SystemConfig + AuditTrail). Key immutable ditolak; validasi per-definisi.

#### `DELETE /api/config?key=trading.leverage`
Reset override → kembali ke layer bawah.

### Notifications

#### `GET /api/notifications?channel=&status=&eventType=&limit=`
Log notifikasi terbaru + statistik (total/sent/failed/pending).

#### `GET /api/notifications/config`
State channel Telegram/Discord (kredensial dimasking) — envConfigured, enabled, minSeverity, events, consecutiveErrors, lastError.

#### `PUT /api/notifications/config`
Body `{ "channel": "TELEGRAM", "enabled": true, "chatId": "12345", "minSeverity": "WARN", "events": ["RISK_EVENT","TRADE_CLOSED"] }`.

#### `POST /api/notifications/test`
Kirim event TEST ke semua channel aktif → hasil per-channel (`SENT`/`FAILED`/`SKIPPED`).

### Backtest v2

#### `POST /api/backtest`
Strategi v2: `SMA Crossover`, `EMA Crossover`, `RSI Mean Reversion`, `MACD Momentum`, `Bollinger Breakout`, `Donchian Breakout`.
Label lama tetap diterima (mapping otomatis). Bila candle historis tidak mencukupi, engine menjalankan simulasi NYATA atas candle sintetis deterministik (`dataSource: "synthetic"`, berlabel di UI).

Response tambahan: `sortinoRatio`, `calmarRatio`, `expectancy`, `grossProfit/Loss`, `maxConsecWins/Losses`, `commissionTotal`, `maxDrawdownAbs`, `finalEquityCurve`, `simulatedTrades[]` (ledger lengkap per transaksi dengan `equityAfter`/`drawdownAfter`), `v2Metrics`, `dataSource`, `engine`, `engineVersion`.
