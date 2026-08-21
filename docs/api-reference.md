# FINEX Indonesia - API Reference

Base URL: `/api`
All endpoints return JSON. Mutation endpoints (POST/PUT/DELETE) require `Authorization: Bearer <API_SECRET_KEY>` header.

---

## Authentication

All routes are protected by API key authentication. Include the header:

```
Authorization: Bearer <your-api-secret-key>
```

GET requests also accept `X-API-Key: <key>` header. The API secret key is set via the `API_SECRET_KEY` environment variable.

Rate limiting applies: 60 requests/minute for general endpoints, 20 requests/minute for mutations.

---

## Endpoint Reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/finnhub?symbol=XAUUSD` | Real-time forex quote from Finnhub |
| GET | `/api/news?pair=EURUSD` | Fetch recent forex news |
| POST | `/api/analysis` | AI-powered market analysis |
| GET | `/api/analysis?pair=EURUSD` | List recent AI analyses |
| POST | `/api/analysis/mtf` | Multi-timeframe AI analysis |
| GET | `/api/indicators?pair=EURUSD&indicator=RSI` | Compute technical indicators |
| GET | `/api/positions` | List all trading positions |
| POST | `/api/positions` | Open a new position |
| DELETE | `/api/positions/[id]` | Close a position |
| GET | `/api/pending-orders` | List pending orders |
| POST | `/api/pending-orders` | Create a pending order |
| DELETE | `/api/pending-orders/[id]` | Cancel a pending order |
| POST | `/api/risk` | Calculate position size / risk metrics |
| GET | `/api/alerts` | List price alerts |
| POST | `/api/alerts` | Create a price alert |
| DELETE | `/api/alerts/[id]` | Delete a price alert |
| GET | `/api/config` | Get trading configuration |
| PUT | `/api/config` | Update trading configuration |
| GET | `/api/economic-calendar?date=2025-01-15` | Get economic events for date range |
| GET | `/api/market-condition?pair=EURUSD` | Get current market condition |
| POST | `/api/backtest` | Run a strategy backtest |
| GET | `/api/logs?limit=50` | View activity/trading logs |
| GET | `/api/trade-analytics` | Trading performance analytics |
| GET | `/api/correlation` | Pair correlation matrix |
| GET | `/api/watchlist` | Get watched pairs |
| POST | `/api/auto-execute` | Auto-execute AI trading signal |
| GET | `/api/transactions` | List deposit/withdrawal transactions |
| POST | `/api/transactions` | Create deposit or withdrawal |
| GET | `/api/notifications` | List notifications |
| GET | `/api/notifications/unread-count` | Get unread notification count |
| GET | `/api/signals/shared` | Get shared trading signals |
| POST | `/api/signals/shared` | Share a trading signal |
| GET | `/api/signals/shared/[id]/comments` | Get signal comments |
| POST | `/api/signals/shared/[id]/comments` | Add comment to signal |
| GET | `/api/export?format=csv&type=positions` | Export data as CSV |
| GET | `/api/ai-providers` | List available AI providers |
| GET | `/api/admin/users` | List users (admin only) |
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/forgot-password` | Request password reset |
| POST | `/api/auth/reset-password` | Reset password with token |
| POST | `/api/auth/2fa/setup` | Setup 2FA |
| POST | `/api/auth/2fa/verify` | Verify 2FA code |
| POST | `/api/auth/2fa/disable` | Disable 2FA |
| GET/POST | `/api/mt5/connection` | MT5 bridge connection status |
| GET | `/api/mt5/account` | MT5 account info |
| GET | `/api/mt5/positions` | MT5 live positions |
| GET | `/api/mt5/prices` | MT5 live prices |
| POST | `/api/mt5/orders` | Place MT5 order |
| POST | `/api/mt5/trailing-stop` | Set MT5 trailing stop |
| POST | `/api/trailing-stop/process` | Process automatic trailing stops |

---

## Detailed Endpoints

### POST `/api/risk` - Risk Calculation

Calculate optimal lot size and risk metrics for a trade.

**Request:**
```json
{
  "accountBalance": 10000,
  "pair": "EURUSD",
  "stopLossPips": 20,
  "riskPercentage": 0.75
}
```

**Response (200):**
```json
{
  "success": true,
  "risk": {
    "lotSize": 0.38,
    "pipValue": 10,
    "riskAmount": 75,
    "potentialLoss": 76,
    "potentialProfit": 114,
    "marginRequired": 380
  },
  "details": {
    "canTrade": true,
    "maxPositions": 3,
    "currentPositions": 0,
    "dailyRiskUsed": 0,
    "dailyRiskLimit": 250
  }
}
```

**Valid pairs:** `EURUSD`, `GBPUSD`, `USDJPY`, `XAUUSD`

---

### GET `/api/positions` - List Positions

**Response (200):**
```json
{
  "positions": [
    {
      "id": "clxxx",
      "pair": "EURUSD",
      "direction": "BUY",
      "lotSize": 0.1,
      "entryPrice": 1.0850,
      "currentPrice": 1.0875,
      "stopLoss": 1.0830,
      "takeProfit": 1.0920,
      "pnl": 25.0,
      "pnlPips": 25,
      "status": "open",
      "openedAt": "2025-01-15T10:30:00.000Z"
    }
  ]
}
```

### POST `/api/positions` - Open Position

**Request:**
```json
{
  "pair": "EURUSD",
  "direction": "BUY",
  "lotSize": 0.1,
  "entryPrice": 1.0850,
  "stopLoss": 1.0830,
  "takeProfit": 1.0920,
  "strategy": "EMA_CROSSOVER"
}
```

---

### POST `/api/analysis` - AI Market Analysis

**Request:**
```json
{
  "pair": "EURUSD",
  "timeframe": "H1",
  "generateSignals": true,
  "currentPrice": 1.0850
}
```

**Response (200):**
```json
{
  "success": true,
  "analysis": {
    "pair": "EURUSD",
    "marketCondition": "trending",
    "recommendation": "BUY",
    "confidence": 0.72,
    "reasoning": "Strong bullish momentum with EMA crossover...",
    "newsImpact": "Positive sentiment from EU data...",
    "riskLevel": "medium",
    "entryPrice": 1.0850,
    "stopLoss": 1.0820,
    "takeProfit": 1.0910,
    "bestStrategy": "EMA_CROSSOVER",
    "indicators": [
      {"name": "RSI", "value": 62.5, "signal": "bullish"}
    ]
  },
  "signals": [{ ... }],
  "aiProvider": "zai",
  "aiModel": "default",
  "timestamp": 1736934600000
}
```

**Valid pairs:** `EURUSD`, `USDJPY`, `GBPUSD`, `XAUUSD`

---

### GET `/api/finnhub` - Real-time Quote

**Query params:** `symbol` (e.g., `OANDA:EUR_USD` or `XAUUSD`)

**Response (200):**
```json
{
  "pair": "EURUSD",
  "bid": 1.0848,
  "ask": 1.0850,
  "mid": 1.0849,
  "spread": 0.0002,
  "timestamp": 1736934600000
}
```

---

### POST `/api/auto-execute` - Auto-Execute Signal

**Request:**
```json
{
  "pair": "EURUSD",
  "direction": "BUY",
  "entryPrice": 1.0850,
  "stopLoss": 1.0820,
  "takeProfit": 1.0910,
  "lotSize": 0.1,
  "strategy": "EMA_CROSSOVER",
  "confidence": 0.75
}
```

**Response (200):**
```json
{
  "success": true,
  "position": { "id": "clxxx", ... },
  "message": "Position opened successfully"
}
```

---

### GET `/api/market-condition` - Market Condition Detection

**Query params:** `pair` (e.g., `EURUSD`, `USDJPY`, `GBPUSD`, `XAUUSD`)

Returns the detected market condition (trending, range_bound, high_volatility, low_volatility) with supporting indicators.

> **Note:** This endpoint can be used standalone for custom charting tools, external dashboards, or automated trading bots that need independent market regime detection without running a full AI analysis.

---

### GET `/api/transactions` - Transaction History

**Query params:** `type` (deposit/withdrawal/adjustment), `limit`, `offset`

**Response (200):**
```json
{
  "transactions": [
    {
      "id": "clxxx",
      "type": "deposit",
      "amount": 5000,
      "currency": "USD",
      "balanceBefore": 10000,
      "balanceAfter": 15000,
      "description": "Monthly deposit",
      "createdAt": "2025-01-15T10:00:00.000Z"
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0
}
```
