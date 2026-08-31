# Task 5: news-api-improver — Completed

## Changes Made to `/home/z/my-project/src/lib/news-api.ts`

### Fix 1: Concurrent Finnhub Fetching
- Replaced sequential `for (const symbol of symbols)` loop (lines 856-903) with `Promise.allSettled()`
- Each symbol fetch is now an independent async function
- Results collected from fulfilled promises; errors logged per-symbol

### Fix 2: Batch Article Saves with createMany
- Replaced individual `db.newsArticle.create()` calls in `saveArticles()` with `db.newsArticle.createMany({ data: [...] })`
- Increased batch size from 20 to 50 for createMany
- Falls back to individual creates if createMany fails
- Kept the existing title-based dedup check with chunked IN queries

### Fix 3: In-Memory Rate Limiter
- Added `InMemoryRateLimitEntry` interface and `inMemoryRateLimits` Map
- Added `syncRateLimitFromDb()` — loads from DB on first call or when stale (>60s)
- Added `syncRateLimitToDb()` — persists to DB periodically (every 30s, fire-and-forget)
- `checkRateLimit()` now checks in-memory first (0 DB queries for normal case)
- DB queries reduced from 3 per call to 0 (normal) / 1 (periodic sync)

### Fix 4: Expanded Indonesian Breaking News Keywords
- Added 32 Indonesian keywords to `BREAKING_KEYWORDS` array
- Includes: suspensi, pembekuan, penghentian, pelarangan, kenaikan suku bunga, gempa bumi, tsunami, korupsi, kpk, pemilu, reshuffle, etc.

### Fix 5: NewsFetchLog Cleanup Mechanism
- Added `cleanupFetchLogs(keepLastDays: number = 30): Promise<number>` export
- Uses `db.newsFetchLog.deleteMany({ where: { createdAt: { lt: cutoff } } })`
- Placed in new SECTION 13, Seed moved to SECTION 14

### Fix 6: Finnhub Response Field Validation
- After casting to `FinnhubArticle[]`, filters with `validArticles` check
- Validates `headline` is a non-empty string and `datetime` is a number
- Invalid articles silently skipped before normalization

## Verification
- ESLint passes with zero errors
- All existing exports preserved
- No function signatures changed
