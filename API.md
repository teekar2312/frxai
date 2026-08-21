FINEX Indonesia API Documentation. This document describes all REST and WebSocket endpoints for the FINEX trading platform, including market data, trading operations, analysis, configuration, authentication, MT5 integration, and administration.

---

## Base URL

| Environment | URL |
|---|---|
| Production | `https://app.finex.id` |
| Development | `http://localhost:3000` |

---

## Authentication

**Web UI** uses NextAuth.js with JWT session cookies. **API mutations** require `API_SECRET_KEY` via `Authorization: Bearer <key>` or `X-API-Key: <key>`. Key comparison is timing-safe. Missing or invalid credentials return `401` in production.

---

## Rate Limiting

Endpoints are rate-limited per minute. On `429`, the response includes a `Retry-After` header (seconds) and body:
```json
{ "error": "Too many requests", "retryAfterMs": 42000 }
```

## Error Format

All errors: `{ "error": "<message>" }`.

## HTTP Status Codes

| Code | Meaning |
|---|---|
| 200 | Success |
| 201 | Created |
| 400 | Bad request / validation failure |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not found |
| 429 | Rate limit exceeded |
| 500 | Internal server error |

---

## Common Data Types

**ForexPair**: `'EURUSD' | 'USDJPY' | 'GBPUSD' | 'XAUUSD'`

**QuoteData**: `{ pair, bid, ask, mid, spread, change, changePercent, high, low, timestamp }`

**TradingSignal**: `{ id, pair, direction, strategy, entryPrice, stopLoss, takeProfit, lotSize, confidence, marketCondition, riskLevel, recommendation, indicators, reasoning, timestamp }`

**MarketCondition**: `'trending' | 'range_bound' | 'high_volatility' | 'low_volatility'`

---

## Market Data

### GET /api/finnhub
Fetches forex quotes. **Rate limit**: 12 req/min. **Auth**: None.
```json
{ "quotes": { "EURUSD": { "pair": "EURUSD", "bid": 1.0842, "ask": 1.0844, "mid": 1.0843, "spread": 0.0002, "change": 0.0001, "changePercent": 0.0092, "high": 1.086, "low": 1.0825, "timestamp": "..." } }, "mode": "live", "priceSource": "finnhub" }
```

### GET /api/news
Fetches forex news from MARKETAUX. **Rate limit**: 3 req/min. **Auth**: None.

| Param | Type | Required | Description |
|---|---|---|
| pair | string | No | Filter by currency pair (e.g. `EURUSD`) |

Returns: `{ "articles": NewsArticle[] }`

### GET /api/health
Application health check. **Auth**: None (public). Returns `{ status: 'healthy'|'degraded'|'unhealthy', version, uptime, checks: { database, ai_providers } }`.

### GET /api/market-condition
Returns detected market condition for all tracked pairs. Returns `Record<ForexPair, MarketCondition>`.

### GET /api/economic-calendar
Retrieves upcoming economic events.

| Param | Type | Required | Description |
|---|---|---|
| days | number | No | Days ahead to fetch |

Returns: `EconomicEvent[]` with fields: event, currency, date, impact, previous, forecast.

### GET /api/correlation
Returns price correlation matrix. Returns: `{ "pairs": string[], "matrix": number[][] }`.

---

## Trading

### GET /api/positions
Lists positions. **Auth**: Session.

| Param | Type | Required | Description |
|---|---|---|
| status | string | No | `open` or `closed` |

### POST /api/positions
Opens a position. **Auth**: API Secret Key. **Rate limit**: 10 req/min. Returns position with PnL applied to balance on close.

| Field | Type | Required | Description |
|---|---|---|
| pair | ForexPair | Yes | Currency pair |
| direction | string | Yes | `BUY` or `SELL` |
| lotSize | number | Yes | Trade size in lots |
| entryPrice | number | Yes | Entry price |
| stopLoss | number | No | Stop-loss price |
| takeProfit | number | No | Take-profit price |
| strategy | string | No | Strategy identifier |
| aiConfidence | number | No | AI confidence 0-1 |

Safety checks enforced: maxPositions, dailyRisk, avoidNewsTrading, spread threshold. Returns `400` on failure.

### PUT /api/positions
Closes a position. **Auth**: API Secret Key. Sets `closeReason: 'manual'`, updates balance, sends email notification.

| Field | Type | Required | Description |
|---|---|---|
| id | string | Yes | Position ID |
| closePrice | number | No | Close price (defaults to market) |

### GET /api/pending-orders
Lists pending orders. **Auth**: Session.

### POST /api/pending-orders
Creates a pending order. **Auth**: API Secret Key. Same safety checks as position opening.

| Field | Type | Required | Description |
|---|---|---|
| pair | ForexPair | Yes | Currency pair |
| direction | string | Yes | `BUY` or `SELL` |
| orderType | string | Yes | `LIMIT`, `STOP`, or `STOP_LIMIT` |
| lotSize | number | Yes | Lot size |
| price | number | Yes | Trigger price |
| stopLoss | number | No | Stop-loss |
| takeProfit | number | No | Take-profit |
| expiresAt | string | No | ISO 8601 expiry |

### DELETE /api/pending-orders?id=<id>
Cancels a pending order. **Auth**: API Secret Key.

### GET /api/alerts
Lists price alerts. **Auth**: Session.

### POST /api/alerts
Creates a price alert. **Auth**: Session.

| Field | Type | Required | Description |
|---|---|---|
| pair | ForexPair | Yes | Currency pair |
| condition | string | Yes | `above` or `below` |
| targetPrice | number | Yes | Price threshold |
| note | string | No | Free-text note |
| emailNotify | boolean | No | Email on trigger (default: false) |

### PUT /api/alerts
Toggles alert active state. **Auth**: Session.

| Field | Type | Required | Description |
|---|---|---|
| id | string | Yes | Alert ID |
| isActive | boolean | Yes | Desired state |

### POST /api/auto-execute
Triggers auto-trading engine. Internal scheduler calls every 30s. Manual calls require `config.autoTrading=true`. **Auth**: API Secret Key.

### POST /api/trailing-stop/process
Processes trailing stops for open positions. **Auth**: API Secret Key.

---

## Analysis

### GET /api/analysis
AI analysis for a pair. **Auth**: Session. **Rate limit**: 5 req/min.

| Param | Type | Required | Description |
|---|---|---|
| pair | ForexPair | Yes | Currency pair |

### POST /api/analysis/mtf
Multi-timeframe analysis. Saves combined recommendation. **Auth**: Session.

| Field | Type | Required | Description |
|---|---|---|
| pair | ForexPair | Yes | Currency pair |
| timeframes | string[] | Yes | e.g. `["M15", "H1", "H4", "D1"]` |

### GET /api/indicators
Calculates a single indicator. **Auth**: Session. **Rate limit**: 10 req/min. Supports 30+ indicators (rsi, macd, ema, sma, bollinger, etc.).

| Param | Type | Required | Description |
|---|---|---|
| pair | ForexPair | Yes | Currency pair |
| indicator | string | Yes | Indicator name |

### POST /api/indicators
Bulk indicator calculation. **Auth**: Session.

| Field | Type | Required | Description |
|---|---|---|
| pair | ForexPair | Yes | Currency pair |
| indicators | string[] | Yes | List of indicator names |

### POST /api/backtest
Runs a strategy backtest. **Auth**: Session. Returns `BacktestResult` with trade history, equity curve, and metrics.

| Field | Type | Required | Description |
|---|---|---|
| pair | ForexPair | Yes | Currency pair |
| strategy | string | Yes | Strategy identifier |
| timeframe | string | Yes | Candlestick timeframe |
| startDate | string | Yes | ISO 8601 start date |
| endDate | string | Yes | ISO 8601 end date |
| initialBalance | number | Yes | Starting balance |
| lotSize | number | Yes | Lot size per trade |
| stopLoss | number | No | Stop-loss in pips |
| takeProfit | number | No | Take-profit in pips |

---

## Configuration

### GET /api/config
Gets trading configuration. Auto-created with defaults on first call. **Auth**: Session.

### PUT /api/config
Updates trading configuration. Accepts partial fields. **Auth**: Session.

### GET /api/ai-providers
Lists available AI providers and their models. **Auth**: Session.

### GET /api/watchlist
Gets watchlist pairs. **Auth**: Session.

### PUT /api/watchlist
Sets watchlist. **Auth**: Session.

| Field | Type | Required | Description |
|---|---|---|
| pairs | string[] | Yes | Currency pair list |

---

## Notifications

### GET /api/notifications
Paginated notifications. **Auth**: Session.

| Param | Type | Required | Description |
|---|---|---|
| page | number | No | Page number (default: 1) |
| limit | number | No | Items per page (default: 20) |

### GET /api/notifications/unread-count
Returns unread notification count. **Auth**: None (public GET).

---

## Activity and Transactions

### GET /api/logs
Activity log entries. **Auth**: Session.

| Param | Type | Required | Description |
|---|---|---|
| category | string | No | e.g. `trading` |
| limit | number | No | Max entries (default: 50) |

### POST /api/logs
Creates a log entry. Also receives client error reports from the error boundary. **Auth**: Session.

### GET /api/transactions
Deposit/withdrawal history. **Auth**: Session.

### POST /api/transactions
Creates a deposit/withdrawal. Updates `accountBalance`. **Auth**: Session.

| Field | Type | Required | Description |
|---|---|---|
| type | string | Yes | `deposit` or `withdrawal` |
| amount | number | Yes | Transaction amount |
| description | string | No | Optional description |

### GET /api/trade-analytics
Trade statistics. **Auth**: Session. Returns `{ totalTrades, winRate, totalPnl, avgWin, avgLoss, sharpeRatio, profitFactor, maxDrawdown, equityCurve[], recentPositions[] }`.

### GET /api/export?format=csv
Exports trade data as CSV. **Auth**: Session. Returns `Content-Type: text/csv`.

### GET /api/risk
Risk metrics for a prospective trade. **Auth**: Session.

| Param | Type | Required | Description |
|---|---|---|
| pair | ForexPair | Yes | Currency pair |
| direction | string | Yes | `BUY` or `SELL` |

Returns: `{ lotSize, pipValue, marginRequired, riskAmount, riskPercent, slPips, tpPips }`.

---

## Signals

### GET /api/signals/shared
Lists shared trading signals. **Auth**: Session.

### POST /api/signals/shared
Shares a signal. **Auth**: Session.

| Field | Type | Required | Description |
|---|---|---|
| pair | ForexPair | Yes | Currency pair |
| direction | string | Yes | `BUY` or `SELL` |
| entryPrice | number | Yes | Suggested entry |
| stopLoss | number | No | Stop-loss |
| takeProfit | number | No | Take-profit |
| confidence | number | No | Confidence 0-1 |
| reasoning | string | No | Trade reasoning |
| strategy | string | No | Strategy used |

### GET /api/signals/shared/[id]/comments
Gets comments for a signal. **Auth**: Session.

### POST /api/signals/shared/[id]/comments
Adds a comment. **Auth**: Session. Body: `{ "content": "<text>" }`.

---

## Authentication

### POST /api/auth/[...nextauth]
NextAuth credentials login.

| Field | Type | Required | Description |
|---|---|---|
| email | string | Yes | User email |
| password | string | Yes | Password |
| twoFactorCode | string | No | TOTP code (if 2FA enabled) |

### POST /api/auth/register
Registers a new user. **Rate limit**: 10 req/min (auth bucket). Requires `ALLOW_REGISTRATION=true`.

| Field | Type | Required | Description |
|---|---|---|
| email | string | Yes | User email |
| password | string | Yes | Password |
| name | string | No | Display name |

### POST /api/auth/forgot-password
Requests password reset email. **Rate limit**: 10 req/min. Body: `{ "email": "<string>" }`.

### POST /api/auth/reset-password
Resets password. **Rate limit**: 10 req/min. Body: `{ "token": "<string>", "newPassword": "<string>" }`.

### GET /api/auth/2fa/status
Gets 2FA status for current user. **Auth**: Session.

### POST /api/auth/2fa/setup
Generates TOTP secret and QR code. Does not enable 2FA until verified. **Auth**: Session. Returns: `{ "secret": "...", "qrCode": "data:image/png;base64,...", "backupCodes": [...] }`.

### POST /api/auth/2fa/verify
Verifies TOTP code and enables 2FA. **Auth**: Session. Body: `{ "code": "<6-digit>" }`.

### POST /api/auth/2fa/disable
Disables 2FA after verifying current code. **Auth**: Session. Body: `{ "code": "<6-digit>" }`.

---

## MT5 Integration

All MT5 endpoints require an active bridge connection.

### GET /api/mt5/connection
MT5 bridge connection status. **Auth**: Session.

### GET /api/mt5/account
MT5 account info (balance, equity, margin, free margin). **Auth**: Session.

### GET /api/mt5/prices
Real-time prices from MT5 bridge. **Auth**: Session.

### POST /api/mt5/orders
Submits order to MT5. **Auth**: API Secret Key.

### GET /api/mt5/positions
Open positions from MT5. **Auth**: Session.

### POST /api/mt5/trailing-stop
Applies trailing stop on MT5. **Auth**: API Secret Key.

---

## Administration

All admin endpoints require an authenticated session with an administrator role.

### GET /api/admin/users
Lists all users. **Auth**: Session (admin).

### PUT /api/admin/users
Updates a user (activate/deactivate, change role). **Auth**: Session (admin).

| Field | Type | Required | Description |
|---|---|---|
| id | string | Yes | User ID |
| isActive | boolean | No | Account active state |
| role | string | No | New role |

### DELETE /api/admin/users?id=<id>
Deletes a user. **Auth**: Session (admin).

---

## WebSocket

### WS /?XTransformPort=3005

Real-time price streaming via native WebSocket (not Socket.IO). Clients must implement auto-reconnect with exponential backoff.

**Connection**: `ws://localhost:3000/?XTransformPort=3005` (dev) or `wss://app.finex.id/?XTransformPort=3005` (prod).

**Message format**:
```json
{
  "type": "prices",
  "data": {
    "EURUSD": { "bid": 1.0842, "ask": 1.0844, "mid": 1.0843, "spread": 0.0002, "timestamp": "2025-01-15T10:30:00.000Z" }
  }
}
```

The `data` object maps currency pairs to their latest bid, ask, mid, spread, and timestamp. Updates are pushed at the upstream data source frequency.