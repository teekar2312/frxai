# Task 6: sentiment-filter-improver

## Task
Implement 5 crucial improvements in `/home/z/my-project/src/lib/sentiment-filter.ts`

## Changes Made

### Fix 1: In-Memory Sentiment Cache
- Added `sentimentCache` Map with 5-minute TTL (shorter than 30-min DB stale threshold)
- Added `getCachedSentiment()` and `setCachedSentiment()` helpers with max-50 eviction
- Modified `filterTrade()` to check in-memory cache before hitting DB for both symbol and MARKET snapshots
- After `computeSymbolSentiment()` and `computeMarketSentiment()` save to DB, populate the cache
- Also cache fallback snapshots on DB failure to prevent immediate recomputation

### Fix 2: Word Tracking for Already-Scored Articles
- In `computeSymbolSentiment()`: always call `scoreArticle()` to extract top words, even for articles with existing scores. Only persist score if `sentimentScore === 0`.
- In `computeMarketSentiment()`: same pattern applied
- Removed unused `allTopPositive`/`allTopNegative` array declarations
- Fixed pre-existing scoping bug: moved `marketTopPositive`/`marketTopNegative` computation outside try-catch in `computeMarketSentiment()`

### Fix 3: Exponential Decay for Recency Weighting
- Added `RECENCY_HALF_LIFE_HOURS = 6` constant in new CONSTANTS section
- Replaced `1 / ageHours` with `Math.pow(0.5, ageHours / RECENCY_HALF_LIFE_HOURS)` in both `computeSymbolSentiment()` and `computeMarketSentiment()`
- Results: 1h=0.89, 2h=0.79, 6h=0.50, 12h=0.25, 24h=0.06 (much smoother than previous 1/age)

### Fix 4: Smoother Sentiment Trend Analysis
- Rewrote `getSentimentTrend()` to use up to 10 snapshots (was 2)
- Changed `orderBy` to `asc` for time-series ordering
- Computes weighted linear regression slope (more recent snapshots weighted higher)
- Direction threshold adjusted: `avgSlope > 3` for IMPROVING, `< -3` for DECLINING (was diff > 5 / < -5)

### Fix 5: getSentimentStats Pagination
- Added `take: 200` to `allSnapshots` query in `getSentimentStats()` to bound DB result size
- Sufficient for regime distribution and average confidence calculations

## Verification
- ESLint passes with zero errors
- Dev server compiles successfully
- All existing exports preserved
- No function signatures changed