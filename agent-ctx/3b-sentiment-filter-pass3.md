# Task 3b: sentiment-filter-pass3

## Status: Completed

## Summary
Applied 4 precision fixes to `src/lib/sentiment-filter.ts`:

1. **Article limit (FIX 1)**: Added `take: 200` to all 3 `findMany` queries in `computeSymbolSentiment` and `computeMarketSentiment` to prevent unbounded DB result sets.

2. **Graduated size adjustment (FIX 2)**: Replaced binary 0.5/1.0 size adjustment in `filterTrade()` with 3-tier graduated system (0.3/0.5/0.7) based on sentiment strength. Threshold lowered from -40/>40 to -20/>20.

3. **Regime awareness (FIX 3)**: Added BULLISH/BEARISH market regime-based size adjustments after the low-confidence warning block, with final `clamp(0.1, 1.0)`.

4. **Skip scoreArticle for already-scored articles (FIX 4)**: Moved `scoreArticle()` inside the unscored conditional in both `computeSymbolSentiment` and `computeMarketSentiment`. Word counts only populated from newly-scored articles.

## Verification
- `bun run lint` passed with no errors
- All existing exports and function signatures preserved
- All section structure and comments maintained