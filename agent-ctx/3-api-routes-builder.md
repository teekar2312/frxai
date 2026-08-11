# Task 3: API Routes Builder

## Files Created (11 API routes)

### 1. `/src/app/api/finnhub/route.ts`
- **GET**: Fetches forex quotes for all 4 pairs (EURUSD, USDJPY, GBPUSD, XAUUSD) from Finnhub API
- **GET ?type=candles&symbol=...&resolution=...&count=...**: Fetches historical candle data
- Normalizes Finnhub response to `QuoteData`/`CandleData` types
- Implements retry logic with exponential backoff for rate limiting
- 250ms delay between requests to respect rate limits

### 2. `/src/app/api/news/route.ts`
- **GET**: Fetches news from MARKETAUX API with forex-relevant filters
- Supports `?pair=EURUSD` filtering
- Auto-determines impact (high/medium/low) and sentiment (positive/negative/neutral)
- Matches news to specific forex pairs using keyword analysis
- Caches articles to database for deduplication

### 3. `/src/app/api/analysis/route.ts`
- **POST**: Uses z-ai-web-dev-sdk `createLLM({ model: 'gpt-4o-mini' })` for AI analysis
- Takes {pair, marketData, news} and generates comprehensive trading recommendation
- Detailed prompt covering: central bank policy, economic data, geopolitics, commodity prices, market sentiment
- Returns: marketCondition, recommendation, confidence, reasoning, bestStrategy, riskLevel, entry/SL/TP
- Stores analysis in DB, logs activity, 30-minute expiry

### 4. `/src/app/api/indicators/route.ts`
- **POST**: Takes {pair, candles, timeframe} and calculates ALL 30+ indicators
- Moving Averages: EMA (5,9,13,21,50,100), SMA (20,50,200), HMA, VWAP
- Oscillators: RSI, Stochastic, MACD, Williams %R, CCI, MFI, TSI, ROC, Momentum, Ultimate Oscillator, Schaff Trend Cycle
- Volatility: ATR, Bollinger Bands, Keltner Channel, Donchian Channel, StdDev, Chaikin Volatility, Volatility Ratio
- Trend: Supertrend, Parabolic SAR, Ichimoku Cloud
- Volume: OBV, Accumulation Distribution, Tick Volume, Volume Profile
- Special: Pivot Points, Linear Regression Channel
- Includes signal summary (bullish/bearish/neutral) per indicator

### 5. `/src/app/api/positions/route.ts`
- **GET**: Returns all positions
- **POST**: Creates position with automatic lot size calculation based on risk
- **PUT**: Supports actions: close, modify (SL/TP), update_price, trailing_stop
- **DELETE**: Cancels open position
- Validates against FINEX constraints (max positions, lot size limits)
- Calculates PnL on close, logs all activity, simulates email notifications

### 6. `/src/app/api/alerts/route.ts`
- **GET**: Returns all alerts, automatically checks active alerts against live prices from Finnhub
- **POST**: Creates alert with conditions: above, below, crosses_above, crosses_below
- **PUT**: Toggle active, update fields, reset triggered alerts
- **DELETE**: Removes alert
- Live price checking on GET with current price caching
- Simulates email notifications on trigger

### 7. `/src/app/api/backtest/route.ts`
- **POST**: Full backtesting engine
- Fetches historical candles from Finnhub (batched for large date ranges)
- Implements 7 strategy signal generators: MA_RIBBON, EMA_CROSSOVER, MOMENTUM_SCALPING, PIVOT_POINT, RMI_TREND_SYNC, LINEAR_REGRESSION, EMA_RSI_FILTER
- Uses actual indicator functions from `@/lib/indicators`
- Simulates trades with SL/TP, reverse signal exits
- Calculates: win rate, PnL, max drawdown, Sharpe ratio, profit factor, avg win/loss, consecutive wins/losses
- Stores results in DB, returns full trade list and equity curve

### 8. `/src/app/api/logs/route.ts`
- **GET**: Paginated log retrieval with filters (level, category, pair, date range)
- **POST**: Creates log entry with validation
- **DELETE**: Supports clear by date, keep last N, or clear all
- Auto-logs errors on GET failure

### 9. `/src/app/api/risk/route.ts`
- **POST**: Calculates optimal lot size using FINEX Indonesia specs
- Uses PAIR_PIP_VALUES for pair-specific calculations
- Returns: lot size, pip value, potential loss/profit, risk:reward ratio, remaining daily risk
- Includes margin calculation, warnings for edge cases
- Validates daily risk limits and position limits

### 10. `/src/app/api/config/route.ts`
- **GET**: Returns trading config, auto-creates default if none exists
- **PUT**: Updates config with validation (risk %, leverage options, position limits)
- Logs config changes
- Uses FINEX_CONFIG for sensible defaults

### 11. `/src/app/api/market-condition/route.ts`
- **POST**: Takes {candles} and uses `detectMarketCondition` from `@/lib/indicators`
- Returns: trending, range_bound, high_volatility, or low_volatility

## Architecture Decisions
- All routes use `NextResponse.json()` for responses
- All routes have comprehensive try/catch with proper HTTP status codes
- All routes import `db` from `@/lib/db` (singleton Prisma client)
- LLM usage via `createLLM` from `z-ai-web-dev-sdk` (backend only)
- Rate limit handling with retry logic for Finnhub
- Email notifications simulated via `console.log`
- Activity logging for all significant operations
