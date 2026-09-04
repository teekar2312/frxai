/**
 * FRxAI — Layered Configuration Management
 * ==========================================
 * Single source of truth for runtime configuration with a 4-layer
 * precedence hierarchy (highest wins):
 *
 *   4. Runtime overrides  (setConfigValue / API PATCH)  — in-memory + persisted
 *   3. Database layer     (SystemConfig table, hot-reloaded)
 *   2. Environment layer  (validated .env, see env-validation.ts)
 *   1. Code defaults      (DEFAULTS below)
 *
 * Plus layered namespace grouping for the UI, a typed accessor,
 * change subscriptions, and audit trail integration.
 */

import { db } from './db'
import { env } from './env-validation'
import logger, { LogCategory } from './trading-logger'

// ============================================
// TYPES
// ============================================

export type ConfigScope = 'trading' | 'risk' | 'notifications' | 'logging' | 'bridge' | 'rateLimit' | 'backtest' | 'monitoring'

export interface ConfigDefinition<T = unknown> {
  key: string
  scope: ConfigScope
  description: string
  /** Layer-1 default. */
  default: T
  /** Env var feeding layer 2 (validated). */
  envVar?: string
  /** Runtime change allowed? */
  mutable: boolean
  /** Validation for runtime sets (lightweight). */
  validate?: (value: unknown) => boolean
}

export interface ConfigLayerSource {
  layer: 'default' | 'env' | 'database' | 'runtime'
  value: unknown
  updatedAt?: Date
}

export interface ConfigEntry {
  definition: ConfigDefinition
  effective: unknown
  sources: ConfigLayerSource[]
}

export type ConfigChangeListener = (key: string, oldValue: unknown, newValue: unknown, layer: ConfigLayerSource['layer']) => void

// ============================================
// DEFINITIONS (single registry)
// ============================================

export const CONFIG_DEFINITIONS: ConfigDefinition[] = [
  // --- trading ---
  { key: 'trading.baseBalance', scope: 'trading', description: 'Base account balance (USD)', default: 10_000, envVar: 'BASE_BALANCE', mutable: true, validate: (v) => typeof v === 'number' && v > 0 },
  { key: 'trading.leverage', scope: 'trading', description: 'Account leverage (1:N)', default: 25, mutable: true, validate: (v) => typeof v === 'number' && v >= 1 && v <= 500 },
  { key: 'trading.commissionPerLot', scope: 'trading', description: 'Commission per lot (USD)', default: 1, mutable: true, validate: (v) => typeof v === 'number' && v >= 0 },
  { key: 'trading.sessionRiskLimitPct', scope: 'trading', description: 'Max loss per session (% equity)', default: 1.0, envVar: 'SESSION_RISK_LIMIT_PCT', mutable: true, validate: (v) => typeof v === 'number' && v > 0 && v <= 100 },
  // --- bridge ---
  { key: 'bridge.url', scope: 'bridge', description: 'MT5 bridge base URL', default: 'http://localhost:3001', envVar: 'MT5_BRIDGE_URL', mutable: false },
  { key: 'bridge.timeoutMs', scope: 'bridge', description: 'Per-request bridge timeout', default: 15_000, envVar: 'BRIDGE_TIMEOUT_MS', mutable: true, validate: (v) => typeof v === 'number' && v >= 1000 },
  { key: 'bridge.maxRetries', scope: 'bridge', description: 'Transient-failure retries per bridge call', default: 3, envVar: 'BRIDGE_MAX_RETRIES', mutable: true, validate: (v) => typeof v === 'number' && v >= 0 && v <= 10 },
  { key: 'bridge.retryBaseDelayMs', scope: 'bridge', description: 'Retry backoff base delay', default: 500, envVar: 'BRIDGE_RETRY_BASE_DELAY_MS', mutable: true, validate: (v) => typeof v === 'number' && v >= 50 },
  { key: 'bridge.retryMaxDelayMs', scope: 'bridge', description: 'Retry backoff upper bound', default: 8_000, envVar: 'BRIDGE_RETRY_MAX_DELAY_MS', mutable: true, validate: (v) => typeof v === 'number' && v >= 100 },
  // --- circuit breaker ---
  { key: 'bridge.cbFailureThreshold', scope: 'bridge', description: 'Circuit breaker failure threshold', default: 5, envVar: 'CB_FAILURE_THRESHOLD', mutable: true, validate: (v) => typeof v === 'number' && v >= 1 },
  { key: 'bridge.cbRecoveryTimeoutMs', scope: 'bridge', description: 'Circuit breaker recovery timeout', default: 30_000, envVar: 'CB_RECOVERY_TIMEOUT_MS', mutable: true, validate: (v) => typeof v === 'number' && v >= 1000 },
  { key: 'bridge.cbPersistEnabled', scope: 'bridge', description: 'Persist circuit breaker state across restarts', default: true, envVar: 'CB_PERSIST_ENABLED', mutable: true, validate: (v) => typeof v === 'boolean' },
  // --- rate limit ---
  { key: 'rateLimit.enabled', scope: 'rateLimit', description: 'Enable API rate limiting', default: true, envVar: 'RATE_LIMIT_ENABLED', mutable: true, validate: (v) => typeof v === 'boolean' },
  { key: 'rateLimit.windowMs', scope: 'rateLimit', description: 'Sliding window length (ms)', default: 60_000, envVar: 'RATE_LIMIT_WINDOW_MS', mutable: true, validate: (v) => typeof v === 'number' && v >= 1000 },
  { key: 'rateLimit.maxRequests', scope: 'rateLimit', description: 'Max reads per window per IP', default: 100, envVar: 'RATE_LIMIT_MAX_REQUESTS', mutable: true, validate: (v) => typeof v === 'number' && v > 0 },
  { key: 'rateLimit.writeMaxRequests', scope: 'rateLimit', description: 'Max writes per window per IP', default: 20, envVar: 'RATE_LIMIT_WRITE_MAX_REQUESTS', mutable: true, validate: (v) => typeof v === 'number' && v > 0 },
  { key: 'rateLimit.aiMaxRequests', scope: 'rateLimit', description: 'Max AI calls per window per IP', default: 10, envVar: 'RATE_LIMIT_AI_MAX_REQUESTS', mutable: true, validate: (v) => typeof v === 'number' && v > 0 },
  { key: 'rateLimit.draftMaxRequests', scope: 'rateLimit', description: 'Max backtest/POST-heavy ops per window per IP', default: 5, envVar: 'RATE_LIMIT_DRAFT_MAX_REQUESTS', mutable: true, validate: (v) => typeof v === 'number' && v > 0 },
  // --- logging ---
  { key: 'logging.level', scope: 'logging', description: 'Minimum log level', default: 'DEBUG', envVar: 'LOG_LEVEL', mutable: true, validate: (v) => ['DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL', 'FATAL'].includes(String(v)) },
  { key: 'logging.retentionDays', scope: 'logging', description: 'TradingLog retention (days)', default: 30, envVar: 'LOG_RETENTION_DAYS', mutable: true, validate: (v) => typeof v === 'number' && v >= 1 },
  { key: 'logging.mt5RetentionDays', scope: 'logging', description: 'Mt5ConnectionLog retention (days)', default: 7, envVar: 'MT5_LOG_RETENTION_DAYS', mutable: true, validate: (v) => typeof v === 'number' && v >= 1 },
  { key: 'logging.newsRetentionDays', scope: 'logging', description: 'NewsFetchLog retention (days)', default: 14, envVar: 'NEWS_LOG_RETENTION_DAYS', mutable: true, validate: (v) => typeof v === 'number' && v >= 1 },
  { key: 'logging.cleanupIntervalHours', scope: 'logging', description: 'Rotation cycle (hours)', default: 6, envVar: 'LOG_CLEANUP_INTERVAL_HOURS', mutable: true, validate: (v) => typeof v === 'number' && v >= 1 },
  { key: 'logging.dedupWindowMs', scope: 'logging', description: 'Error dedup window (ms)', default: 60_000, envVar: 'LOG_DEDUP_WINDOW_MS', mutable: true, validate: (v) => typeof v === 'number' && v >= 1000 },
  // --- notifications ---
  { key: 'notifications.enabled', scope: 'notifications', description: 'Master notification switch', default: undefined, envVar: 'NOTIFY_ENABLED', mutable: true, validate: (v) => typeof v === 'boolean' },
  { key: 'notifications.minSeverity', scope: 'notifications', description: 'Minimum severity to dispatch', default: 'WARN', envVar: 'NOTIFY_MIN_SEVERITY', mutable: true, validate: (v) => ['INFO', 'WARN', 'ERROR', 'CRITICAL'].includes(String(v)) },
  { key: 'notifications.ratePerMin', scope: 'notifications', description: 'Telegram/Discord msgs per minute', default: 20, envVar: 'NOTIFY_RATE_PER_MIN', mutable: true, validate: (v) => typeof v === 'number' && v > 0 },
  { key: 'notifications.ratePerHour', scope: 'notifications', description: 'Messages per hour cap', default: 100, envVar: 'NOTIFY_RATE_PER_HOUR', mutable: true, validate: (v) => typeof v === 'number' && v > 0 },
  // --- backtest ---
  { key: 'backtest.maxCandles', scope: 'backtest', description: 'Max candles per backtest run', default: 50_000, envVar: 'BACKTEST_MAX_CANDLES', mutable: true, validate: (v) => typeof v === 'number' && v >= 100 },
  { key: 'backtest.maxTradesPersist', scope: 'backtest', description: 'Max per-trade rows persisted per run', default: 1_000, envVar: 'BACKTEST_MAX_TRADES_PERSIST', mutable: true, validate: (v) => typeof v === 'number' && v >= 10 },
  // --- monitoring ---
  { key: 'monitoring.metricsEnabled', scope: 'monitoring', description: 'Collect in-memory metrics', default: true, envVar: 'METRICS_ENABLED', mutable: true, validate: (v) => typeof v === 'boolean' },
  { key: 'monitoring.metricsSnapshotIntervalMs', scope: 'monitoring', description: 'Metrics DB snapshot interval', default: 300_000, envVar: 'METRICS_SNAPSHOT_INTERVAL_MS', mutable: true, validate: (v) => typeof v === 'number' && v >= 10_000 },
]

const DEFINITION_MAP = new Map(CONFIG_DEFINITIONS.map((d) => [d.key, d]))

// ============================================
// STATE
// ============================================

const DB_NAMESPACE = 'app_config'

interface StoredLayerValue {
  value: unknown
  updatedAt: string
}

let envLayer: Map<string, unknown> | null = null
const dbLayer = new Map<string, StoredLayerValue>()
const runtimeLayer = new Map<string, StoredLayerValue>()
const listeners = new Set<ConfigChangeListener>()
let dbLoadedAt: Date | null = null
let dbLoadPromise: Promise<void> | null = null
const DB_TTL_MS = 30_000 // hot-reload window

// ============================================
// LAYER 2: ENV
// ============================================

/** Read validated env into the env layer (once). */
function loadEnvLayer(): Map<string, unknown> {
  if (envLayer) return envLayer
  const e = env()
  const map = new Map<string, unknown>()
  const envAssign: Record<string, unknown> = {
    BASE_BALANCE: e.BASE_BALANCE,
    SESSION_RISK_LIMIT_PCT: e.SESSION_RISK_LIMIT_PCT,
    MT5_BRIDGE_URL: e.MT5_BRIDGE_URL,
    BRIDGE_TIMEOUT_MS: e.BRIDGE_TIMEOUT_MS,
    BRIDGE_MAX_RETRIES: e.BRIDGE_MAX_RETRIES,
    BRIDGE_RETRY_BASE_DELAY_MS: e.BRIDGE_RETRY_BASE_DELAY_MS,
    BRIDGE_RETRY_MAX_DELAY_MS: e.BRIDGE_RETRY_MAX_DELAY_MS,
    CB_FAILURE_THRESHOLD: e.CB_FAILURE_THRESHOLD,
    CB_RECOVERY_TIMEOUT_MS: e.CB_RECOVERY_TIMEOUT_MS,
    CB_PERSIST_ENABLED: e.CB_PERSIST_ENABLED,
    RATE_LIMIT_ENABLED: e.RATE_LIMIT_ENABLED,
    RATE_LIMIT_WINDOW_MS: e.RATE_LIMIT_WINDOW_MS,
    RATE_LIMIT_MAX_REQUESTS: e.RATE_LIMIT_MAX_REQUESTS,
    RATE_LIMIT_WRITE_MAX_REQUESTS: e.RATE_LIMIT_WRITE_MAX_REQUESTS,
    RATE_LIMIT_AI_MAX_REQUESTS: e.RATE_LIMIT_AI_MAX_REQUESTS,
    RATE_LIMIT_DRAFT_MAX_REQUESTS: e.RATE_LIMIT_DRAFT_MAX_REQUESTS,
    LOG_LEVEL: e.LOG_LEVEL,
    LOG_RETENTION_DAYS: e.LOG_RETENTION_DAYS,
    MT5_LOG_RETENTION_DAYS: e.MT5_LOG_RETENTION_DAYS,
    NEWS_LOG_RETENTION_DAYS: e.NEWS_LOG_RETENTION_DAYS,
    LOG_CLEANUP_INTERVAL_HOURS: e.LOG_CLEANUP_INTERVAL_HOURS,
    LOG_DEDUP_WINDOW_MS: e.LOG_DEDUP_WINDOW_MS,
    NOTIFY_ENABLED: e.NOTIFY_ENABLED,
    NOTIFY_MIN_SEVERITY: e.NOTIFY_MIN_SEVERITY,
    NOTIFY_RATE_PER_MIN: e.NOTIFY_RATE_PER_MIN,
    NOTIFY_RATE_PER_HOUR: e.NOTIFY_RATE_PER_HOUR,
    BACKTEST_MAX_CANDLES: e.BACKTEST_MAX_CANDLES,
    BACKTEST_MAX_TRADES_PERSIST: e.BACKTEST_MAX_TRADES_PERSIST,
    METRICS_ENABLED: e.METRICS_ENABLED,
    METRICS_SNAPSHOT_INTERVAL_MS: e.METRICS_SNAPSHOT_INTERVAL_MS,
  }
  for (const d of CONFIG_DEFINITIONS) {
    if (d.envVar && envAssign[d.envVar] !== undefined) {
      map.set(d.key, envAssign[d.envVar])
    }
  }
  envLayer = map
  return map
}

// ============================================
// LAYER 3: DATABASE (SystemConfig KV)
// ============================================

/** Load (or hot-reload) persisted config from SystemConfig. */
export async function loadDatabaseLayer(force = false): Promise<void> {
  if (!force && dbLoadedAt && Date.now() - dbLoadedAt.getTime() < DB_TTL_MS) return
  if (dbLoadPromise && !force) return dbLoadPromise
  dbLoadPromise = (async () => {
    try {
      const rows = await db.systemConfig.findMany({ where: { key: { startsWith: `${DB_NAMESPACE}:` } } })
      dbLayer.clear()
      for (const row of rows) {
        try {
          const parsed = JSON.parse(row.value) as { value: unknown; updatedAt: string }
          dbLayer.set(row.key.slice(DB_NAMESPACE.length + 1), parsed)
        } catch {
          // legacy plain value
          dbLayer.set(row.key.slice(DB_NAMESPACE.length + 1), { value: row.value, updatedAt: row.updatedAt.toISOString() })
        }
      }
      dbLoadedAt = new Date()
    } catch (err) {
      logger.warn('SYSTEM' as LogCategory, 'app-config: failed to load database layer', {
        details: err instanceof Error ? err.message : String(err),
      })
    } finally {
      dbLoadPromise = null
    }
  })()
  return dbLoadPromise
}

/** Persist a single key to the database layer. */
async function persistToDb(key: string, value: unknown): Promise<void> {
  try {
    await db.systemConfig.upsert({
      where: { key: `${DB_NAMESPACE}:${key}` },
      create: { key: `${DB_NAMESPACE}:${key}`, value: JSON.stringify({ value, updatedAt: new Date().toISOString() }) },
      update: { value: JSON.stringify({ value, updatedAt: new Date().toISOString() }) },
    })
  } catch (err) {
    logger.error('SYSTEM' as LogCategory, `app-config: failed to persist "${key}"`, {
      details: err instanceof Error ? err.message : String(err),
    })
  }
}

// ============================================
// ACCESSORS
// ============================================

/** Get the effective value of a config key (all 4 layers resolved). */
export function getConfig<T = unknown>(key: string): T {
  const def = DEFINITION_MAP.get(key)
  if (!def) throw new Error(`Unknown config key: ${key}`)
  const rt = runtimeLayer.get(key)
  if (rt !== undefined) return rt.value as T
  const dbl = dbLayer.get(key)
  if (dbl !== undefined) return dbl.value as T
  const envVal = loadEnvLayer().get(key)
  if (envVal !== undefined && envVal !== null) return envVal as T
  if (def.default === undefined) {
    // undefined default (e.g. NOTIFY_ENABLED auto) → derive
    return deriveAutoDefault(key) as T
  }
  return def.default as T
}

/** Typed shortcuts for hot paths. */
export const config = {
  baseBalance: () => getConfig<number>('trading.baseBalance'),
  leverage: () => getConfig<number>('trading.leverage'),
  commissionPerLot: () => getConfig<number>('trading.commissionPerLot'),
  bridgeUrl: () => getConfig<string>('bridge.url'),
  bridgeTimeoutMs: () => getConfig<number>('bridge.timeoutMs'),
  bridgeMaxRetries: () => getConfig<number>('bridge.maxRetries'),
  cbPersistEnabled: () => getConfig<boolean>('bridge.cbPersistEnabled'),
  rateLimitEnabled: () => getConfig<boolean>('rateLimit.enabled'),
  logRetentionDays: () => getConfig<number>('logging.retentionDays'),
}

/** Values that default dynamically when no layer provides them. */
function deriveAutoDefault(key: string): unknown {
  if (key === 'notifications.enabled') {
    // Auto-enable when either Telegram or Discord credentials exist
    return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) || Boolean(process.env.DISCORD_WEBHOOK_URL)
  }
  return undefined
}

// ============================================
// MUTATION (runtime + optional DB persistence)
// ============================================

export interface SetConfigResult {
  ok: boolean
  key: string
  oldValue: unknown
  newValue: unknown
  error?: string
}

/**
 * Set a runtime override. Immutable keys and failed validations are rejected.
 * Optionally persisted into the database layer (survives restarts).
 */
export async function setConfigValue(key: string, value: unknown, opts?: { persist?: boolean; source?: string }): Promise<SetConfigResult> {
  const def = DEFINITION_MAP.get(key)
  if (!def) return { ok: false, key, oldValue: undefined, newValue: value, error: 'Unknown config key' }
  if (!def.mutable) return { ok: false, key, oldValue: getConfig(key), newValue: value, error: `Config key "${key}" is immutable` }
  if (def.validate && !def.validate(value)) {
    return { ok: false, key, oldValue: getConfig(key), newValue: value, error: `Value failed validation for "${key}"` }
  }

  const oldValue = getConfig(key)
  const stamped: StoredLayerValue = { value, updatedAt: new Date().toISOString() }
  runtimeLayer.set(key, stamped)

  if (opts?.persist !== false) {
    await persistToDb(key, value)
  }

  for (const l of listeners) {
    try {
      l(key, oldValue, value, 'runtime')
    } catch { /* listener errors never break config */ }
  }

  logger.info('SYSTEM' as LogCategory, `Config "${key}" changed`, {
    metadata: { key, oldValue: String(oldValue), newValue: String(value), persisted: opts?.persist !== false, source: opts?.source ?? 'api' },
  } as never)

  return { ok: true, key, oldValue, newValue: value }
}

/** Remove a runtime override — falls back to lower layers. */
export async function resetConfigValue(key: string, opts?: { persist?: boolean }): Promise<SetConfigResult> {
  const def = DEFINITION_MAP.get(key)
  if (!def) return { ok: false, key, oldValue: undefined, newValue: undefined, error: 'Unknown config key' }
  const oldValue = getConfig(key)
  runtimeLayer.delete(key)
  dbLayer.delete(key)
  if (opts?.persist !== false) {
    try {
      await db.systemConfig.deleteMany({ where: { key: `${DB_NAMESPACE}:${key}` } })
    } catch { /* best effort */ }
  }
  const newValue = getConfig(key)
  for (const l of listeners) {
    try { l(key, oldValue, newValue, 'default') } catch { /* ignore */ }
  }
  return { ok: true, key, oldValue, newValue }
}

// ============================================
// INTROSPECTION
// ============================================

/** Full resolution report for one key (debug/UI). */
export function describeConfig(key: string): ConfigEntry | null {
  const def = DEFINITION_MAP.get(key)
  if (!def) return null
  const sources: ConfigLayerSource[] = []
  const rt = runtimeLayer.get(key)
  const dbl = dbLayer.get(key)
  const envVal = loadEnvLayer().get(key)
  if (rt) sources.push({ layer: 'runtime', value: rt.value, updatedAt: new Date(rt.updatedAt) })
  if (dbl) sources.push({ layer: 'database', value: dbl.value, updatedAt: new Date(dbl.updatedAt) })
  if (envVal !== undefined && envVal !== null) sources.push({ layer: 'env', value: envVal })
  sources.push({ layer: 'default', value: def.default })
  return { definition: def, effective: getConfig(key), sources }
}

/** List all entries, optionally filtered by scope. */
export function describeAllConfigs(scope?: ConfigScope): ConfigEntry[] {
  return CONFIG_DEFINITIONS.filter((d) => !scope || d.scope === scope).map((d) => describeConfig(d.key)!)
}

/** Subscribe to changes. Returns an unsubscribe function. */
export function onConfigChange(listener: ConfigChangeListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Force-refresh DB layer on next access (used by tests & admin). */
export function invalidateConfigCache(): void {
  dbLoadedAt = null
}

// Backwards-compatible alias for callers that expect async init
export const initConfig = loadDatabaseLayer
