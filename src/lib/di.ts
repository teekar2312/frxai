/**
 * Lightweight service locator (dependency-injection seam) for the two
 * singleton services every module reaches for: the Prisma client and
 * the trading logger.
 *
 * Why: production code imports { db } / { logger } directly, which is
 * fine at runtime but makes unit-testing modules that touch the DB or
 * logging pipeline impossible without a real SQLite file. Routing
 * access through getDb()/getLogger() keeps production behavior
 * identical (same singletons, zero overhead) while giving tests an
 * injection point via setService()/withServices().
 *
 * Usage (production — unchanged behavior):
 *   import { getDb } from '@/lib/di'
 *   const trades = await getDb().trade.findMany(...)
 *
 * Usage (tests):
 *   withServices({ db: fakeDb }, () => { ... code under test ... })
 */

import type { PrismaClient } from '@prisma/client'
import { db as defaultDb } from './db'
import { logger as defaultLogger } from './trading-logger'

export type DbService = PrismaClient
export type LoggerService = typeof defaultLogger

export interface ServiceMap {
  db: DbService
  logger: LoggerService
}

// Explicit override slots (avoids Partial<ServiceMap> indexed-access
// variance issues — each slot has its exact concrete type).
let dbOverride: DbService | undefined
let loggerOverride: LoggerService | undefined

/** Resolve the Prisma client (the shared singleton unless overridden in tests). */
export function getDb(): DbService {
  return dbOverride ?? defaultDb
}

/** Resolve the trading logger (the shared singleton unless overridden in tests). */
export function getLogger(): LoggerService {
  return loggerOverride ?? defaultLogger
}

type ServiceKey = keyof ServiceMap

function readOverride<K extends ServiceKey>(key: K): ServiceMap[K] | undefined {
  return key === 'db'
    ? (dbOverride as ServiceMap[K] | undefined)
    : (loggerOverride as ServiceMap[K] | undefined)
}

function writeOverride<K extends ServiceKey>(
  key: K,
  impl: ServiceMap[K] | undefined,
): void {
  if (key === 'db') dbOverride = impl as DbService | undefined
  else loggerOverride = impl as LoggerService | undefined
}

/**
 * Override a service — primarily for tests. Production code should
 * never need this. Overrides persist until resetServices()/scope end.
 */
export function setService<K extends ServiceKey>(
  key: K,
  impl: ServiceMap[K],
): void {
  writeOverride(key, impl)
}

/** Clear all overrides (test teardown). */
export function resetServices(): void {
  dbOverride = undefined
  loggerOverride = undefined
}

/**
 * Run `fn` with a set of service overrides active, restoring the
 * previous state afterwards — even if `fn` throws. Safe to nest:
 * the inner call restores to the outer's state, not to the defaults.
 *
 * Async-aware: when `fn` returns a promise, the overrides stay active
 * for the full async duration (until the promise settles) and are
 * restored in a `finally` on the promise — not when the promise object
 * is merely returned.
 */
export function withServices<T>(
  services: Partial<ServiceMap>,
  fn: () => T,
): T {
  const keys = Object.keys(services) as Array<ServiceKey>
  const previous = new Map<ServiceKey, ServiceMap[ServiceKey] | undefined>()
  for (const key of keys) {
    previous.set(key, readOverride(key))
    writeOverride(key, services[key] as ServiceMap[typeof key])
  }
  const restore = (): void => {
    for (const key of keys) {
      writeOverride(key, previous.get(key) as ServiceMap[typeof key] | undefined)
    }
  }
  let result: T
  try {
    result = fn()
  } catch (err) {
    restore()
    throw err
  }
  if (result instanceof Promise) {
    // Keep overrides active until the async body settles.
    return result.finally(restore) as unknown as T
  }
  restore()
  return result
}
