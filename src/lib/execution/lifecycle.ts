/*
 * Trade Execution Engine — PART 2/10: lifecycle.ts
 * Pure-movement split from src/lib/trade-execution-engine.ts (facade preserves
 * the public API; import paths remain @/lib/trade-execution-engine).
 *
 * Contains (original lines 123-293):
 *   - TRADE LIFECYCLE EVENTS (TradeEventBus + singleton tradeEventBus)
 *   - v2: NOTIFICATION HOOKS (registerNotificationHook, registered once at
 *     module load — same top-level side effect as the original monolith)
 */

import logger from '@/lib/trading-logger'

// ============================================
// TRADE LIFECYCLE EVENTS
// ============================================

/** Callback signature for trade lifecycle event listeners. */
export type TradeEventCallback = (event: TradeLifecycleEvent) => void | Promise<void>

/** Structured event emitted whenever a trade undergoes a lifecycle change. */
export interface TradeLifecycleEvent {
  tradeId: string
  symbol: string
  event: string
  fromStatus: string
  toStatus: string
  reason?: string
  pnl?: number
  metadata?: Record<string, unknown>
  timestamp: Date
}

/** Well-known lifecycle event names. */
export const TRADE_EVENTS = {
  TRADE_OPENED: 'TRADE_OPENED',
  TRADE_CLOSED: 'TRADE_CLOSED',
  SL_TRIGGERED: 'SL_TRIGGERED',
  TP_TRIGGERED: 'TP_TRIGGERED',
  TRAILING_STOP_ADJUSTED: 'TRAILING_STOP_ADJUSTED',
  PARTIAL_CLOSE_EXECUTED: 'PARTIAL_CLOSE_EXECUTED',
  TRADE_REJECTED: 'TRADE_REJECTED',
  TRADE_CANCELLED: 'TRADE_CANCELLED',
  MARGIN_CALL_CLOSE: 'MARGIN_CALL_CLOSE',
  EMERGENCY_CLOSE_ALL: 'EMERGENCY_CLOSE_ALL',
} as const

/**
 * EventBus for trade lifecycle events.
 * Supports named event listeners with unsubscribe capability.
 */
export class TradeEventBus {
  private listeners: Map<string, TradeEventCallback[]> = new Map()

  /**
   * Subscribe to a named event. Returns an unsubscribe function.
   */
  on(event: string, callback: TradeEventCallback): () => void {
    const existing = this.listeners.get(event) ?? []
    existing.push(callback)
    this.listeners.set(event, existing)

    // Return unsubscribe function
    return () => {
      const current = this.listeners.get(event)
      if (current) {
        this.listeners.set(
          event,
          current.filter((cb) => cb !== callback),
        )
      }
    }
  }

  /**
   * Emit an event to all registered listeners.
   * Listeners are invoked in registration order; async listeners are awaited.
   */
  async emit(event: TradeLifecycleEvent): Promise<void> {
    const callbacks = this.listeners.get(event.event) ?? []
    // Also notify wildcard listeners
    const wildcardCallbacks = this.listeners.get('*') ?? []
    const allCallbacks = [...callbacks, ...wildcardCallbacks]

    for (const cb of allCallbacks) {
      try {
        await cb(event)
      } catch (err) {
        logger.error('TRADE_EXECUTION', `Event listener error for ${event.event}`, {
          tradeId: event.tradeId,
          symbol: event.symbol,
          details: err instanceof Error ? err.message : String(err),
          metadata: { eventName: event.event, fromStatus: event.fromStatus, toStatus: event.toStatus },
        })
      }
    }
  }

  /** Remove all listeners. Useful for testing or shutdown. */
  removeAllListeners(): void {
    this.listeners.clear()
  }
}

/** Singleton event bus instance for trade lifecycle events. */
export const tradeEventBus = new TradeEventBus()

// ============================================
// v2: NOTIFICATION HOOKS (Telegram / Discord)
// ============================================

/**
 * Wildcard trade-lifecycle subscriber → notification dispatcher.
 * Registered once (idempotent). All dispatch failures are swallowed by
 * the notifier itself — notifications are strictly non-critical.
 */
let notificationHookRegistered = false
export function registerNotificationHook(): void {
  if (notificationHookRegistered) return
  notificationHookRegistered = true

  tradeEventBus.on('*', async (event) => {
    try {
      // Lazy import avoids module-load cycles (notifier → app-config → logger)
      const { notifyAsync } = await import('@/lib/notifier')

      switch (event.event) {
        case TRADE_EVENTS.TRADE_OPENED: {
          const m = (event.metadata ?? {}) as Record<string, unknown>
          notifyAsync({
            eventType: 'TRADE_OPENED',
            title: `Trade opened: ${event.symbol}`,
            body: `${event.symbol} ${String(m.direction ?? '')} opened via ${event.reason ?? 'signal'}.`,
            severity: 'INFO',
            fields: {
              trade_id: event.tradeId,
              direction: String(m.direction ?? 'n/a'),
              lot_size: Number(m.lotSize ?? 0),
              entry_price: Number(m.entryPrice ?? 0),
              strategy: String(m.strategy ?? 'n/a'),
            },
          })
          break
        }
        case TRADE_EVENTS.TRADE_CLOSED:
        case TRADE_EVENTS.SL_TRIGGERED:
        case TRADE_EVENTS.TP_TRIGGERED: {
          const pnl = Number(event.pnl ?? 0)
          notifyAsync({
            eventType: 'TRADE_CLOSED',
            title: `${event.symbol} closed — ${event.reason}`,
            body: `Trade closed via ${event.reason}. P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`,
            severity: pnl < 0 ? 'WARN' : 'INFO',
            fields: {
              trade_id: event.tradeId,
              symbol: event.symbol,
              reason: event.reason ?? 'n/a',
              pnl_usd: pnl.toFixed(2),
              pnl_pct: Number(event.pnlPercent ?? 0).toFixed(2),
            },
          })
          break
        }
        case TRADE_EVENTS.MARGIN_CALL_CLOSE:
        case TRADE_EVENTS.EMERGENCY_CLOSE_ALL: {
          notifyAsync({
            eventType: 'RISK_EVENT',
            title: `Risk action: ${event.event}`,
            body: `Protective action executed — ${event.reason}.`,
            severity: 'CRITICAL',
            fields: { trade_id: event.tradeId, symbol: event.symbol, action: event.event, reason: event.reason ?? 'n/a' },
          })
          break
        }
        default:
          break
      }
    } catch {
      // Notification hook must never break trade execution
    }
  })
}

registerNotificationHook()
