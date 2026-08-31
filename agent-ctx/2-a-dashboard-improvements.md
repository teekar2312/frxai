# Task 2-a: Dashboard Module — 3 CRUCIAL Improvements

**Status**: Completed
**Files modified/created**: 7

## Summary

### Improvement 1: EquityChart Real Data
- Created `src/app/api/account/equity-curve/route.ts` — queries DailyPerformance, accepts range param
- Rewrote `src/components/trading/EquityChart.tsx` — removed all mock code, uses real API, shows empty state

### Improvement 2: AccountSummary Smart Polling
- Fixed `src/app/api/account/route.ts` — reads DailyPerformance for balance, removed hardcoded 10000
- Fixed `src/components/trading/AccountSummary.tsx` — 10s/60s smart polling, margin level card replaces leverage

### Improvement 3: Toast Notifications
- Updated `src/app/layout.tsx` — switched from shadcn/ui toaster to sonner Toaster
- Created `src/lib/notification-hooks.ts` — useLiveNotifications hook polls risk events
- Updated `src/app/page.tsx` — calls useLiveNotifications in TradingDashboard

## Verification
- `bun run lint` — zero errors
- Work record appended to `/home/z/my-project/worklog.md`
