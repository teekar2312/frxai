# Task 2-a: Trailing Stop Improver

## Task
6 CRUCIAL improvements to the Auto Trailing Stop module in trade-execution-engine.ts

## Files Modified
- `prisma/schema.prisma` — Added 5 new fields to Trade model
- `src/lib/trade-execution-engine.ts` — Rewrote trailing stop engine with 6 improvements
- `src/app/api/execution/trailing-stop/route.ts` — Updated API route for new params

## 6 Improvements Applied

### Fix 1: Tick-size Rounding
- `roundToTickSize()` function uses `validateSymbol()` from mt5-connection
- BUY SL rounds DOWN, SELL SL rounds UP to nearest valid tick
- Prevents broker rejections from non-standard prices on IDX

### Fix 2: Break-even Floor
- BUY SL floored at entryPrice, SELL SL capped at entryPrice
- `breakEvenApplied` DB flag tracks when floor is active
- Re-checked after tick rounding

### Fix 3: Cooldown Throttle
- `trailingCooldownSec` field (default 5s) on Trade model
- `adjustTrailingStop` checks `lastSlAdjust` and skips if cooldown active
- Returns `cooldownBlocked: true` for telemetry

### Fix 4: Trading Phase Awareness
- `isTrailingAllowedForPhase()` only allows OPEN and PRE_OPEN
- `getTradingPhase()` called once per batch for efficiency
- PRE_CLOSE, CLOSED, AFTER_HOURS all block trailing adjustments

### Fix 5: Max Adjustments Cap
- `trailingAdjustments` counter on Trade, default cap 50
- Returns `maxAdjustmentsHit: true` when cap reached

### Fix 6: Tiered Trailing Steps
- `TrailingStep` interface: `{ profitR: number, trailDist: number }`
- `getEffectiveTrailingDist()` finds tightest step for current profit level
- Stored as JSON in `trailingSteps` field

## Verification
- ESLint: zero errors
- All existing exports backward compatible
