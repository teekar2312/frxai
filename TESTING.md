# Panduan Testing — FRxAI

> Suite unit test menggunakan **bun test** (built-in, tanpa dependensi tambahan).
> Status: **401 test / 0 fail / 5.400+ assertions** (v2.0.1: +34 test api-errors).

## Menjalankan

```bash
bun test                    # seluruh suite
bun test tests/retry.test.ts   # satu file
bun test --coverage         # dengan laporan coverage per file
bun test --watch            # mode watch saat development
bun run lint                # ESLint (0 error required)
```

## Struktur

```
tests/
├── env-validation.test.ts    # 20 test — Zod runtime validation, prod strict, cross-field
├── retry.test.ts             # 26 test — backoff, transient classifier, exhaustion, abort
├── rate-limit.test.ts        # 20 test — sliding window, tier/IP isolation, 429 + headers
├── circuit-breaker.test.ts   # 21 test — state machine, half-open, snapshot/restore age-aware
├── notifier-format.test.ts   # 19 test — formatter Telegram/Discord (pure), escape, cap
├── app-config.test.ts        # 25 test — 4-layer, mutasi, validasi, listener (persist:false)
├── metrics.test.ts           # 20 test — counter/gauge/histogram, percentile, Prometheus, request tracking
├── api-errors.test.ts        # 34 test — klasifikasi error (Zod/Prisma/CB/retry/market-closed), recovery hints, header
├── backtest-engine.test.ts   # 69 test — 7 indikator streaming, generator sintetis, 6 strategi,
│                             #   SL/TP intrabar, END_OF_DATA, akuntansi, determinisme, metrics
├── indicator-pool.test.ts    # 52 test — 10 indikator klasik + pool cache + mock generator
├── money-management.test.ts  # 23 test — risk-of-ruin, drawdown recovery, progressive factor
├── session-manager.test.ts   # 39 test — fase IDX WIB (mock clock), rules, sizing, quality
├── sentiment-filter.test.ts  # 25 test — analyzeText EN+ID, negator/intensifier, regime
└── logging-rotation.test.ts  # 14 test — retention setter, level, weekend market awareness
```

## Coverage (modul v2 — hasil audit prioritas)

| Modul | Fungsi | Baris |
|-------|--------|-------|
| `src/lib/backtest-engine.ts` | 100% | 100% |
| `src/lib/env-validation.ts` | 100% | 100% |
| `src/lib/retry.ts` | 100% | 100% |
| `src/lib/rate-limit.ts` | 93% | 92% |
| `src/lib/indicator-pool.ts` | 80% | 91% |
| `src/lib/metrics.ts` | 88% | 84% |
| `src/lib/app-config.ts` | 42% | 81% |

> Catatan: bagian DB/Prisma (persist layer app-config, snapshot metrics) dan
> transport network (Telegram/Discord HTTP, bridge fetch) sengaja tidak diuji
> unit — jalur tersebut terverifikasi via API end-to-end (health/metrics/
> notifications/backtest) dan smoke test browser.
> Modul lama yang terikat DB berat (risk-engine, sentiment-filter persistence,
> money-management persistence) diuji pada fungsi murninya; sisanya diluar
> cakupan unit test (lihat laporan worklog Task 5-a/5-b).

## Konvensi

- Import via path relatif: `import … from '../src/lib/retry'`
- State global dibersihkan di `beforeEach` (`resetEnvCache()`, `resetRateLimitStore()`,
  `resetMetricsRegistry()`, `resetConfigValue(…, { persist: false })`)
- `process.env` yang diubah wajib di-snapshot/restore (lihat env-validation.test.ts)
- Waktu di-mock dengan `setSystemTime` dan wajib di-restore (session-manager.test.ts)
- Jitter/backoff selalu `jitterRatio: 0` + `baseDelayMs: 1` agar deterministik & cepat
- Temuan bug didokumentasikan sebagai test dengan flag `BUG` — setelah diperbaiki,
  test di-update ke perilaku benar (lihat git history RSI flat, Ema.ready, ma-ribbon)
