import { describe, test, expect } from 'bun:test'
import { mapBridgeOrderResponse } from '@/lib/mt5/connection-manager'

// The bridge (mini-services/mt5-bridge handleOrder) responds:
// { success: true, data: { ticket, symbol, direction, lotSize, openPrice,
//   slippage, commission, openTime, comment, retcode, ... } }
// The historical bug: executeOrderWithRetry read orderId/fillPrice/fillLot
// from the envelope ROOT — all undefined — so Trade.mt5Ticket was never
// persisted and /api/execution/modify always 400'd with "no MT5 ticket".

describe('mapBridgeOrderResponse — bridge /order envelope mapping', () => {
  const bridgeSuccess = {
    success: true,
    data: {
      ticket: 500123,
      symbol: 'BBCA',
      direction: 'BUY',
      lotSize: 0.5,
      openPrice: 9875.5,
      slippage: 2.5,
      commission: 0.5,
      openTime: '2026-09-04T00:00:00.000Z',
      comment: 'FINEX-EMA-M15',
      retcode: 10009,
      retcodeDescription: 'done',
    },
  }

  test('maps ticket → ticket + orderId (string form)', () => {
    const out = mapBridgeOrderResponse(bridgeSuccess)
    expect(out.ticket).toBe(500123)
    expect(out.orderId).toBe('500123')
  })

  test('maps openPrice → fillPrice (real fill, not requested price)', () => {
    expect(mapBridgeOrderResponse(bridgeSuccess).fillPrice).toBe(9875.5)
  })

  test('maps lotSize → fillLot', () => {
    expect(mapBridgeOrderResponse(bridgeSuccess).fillLot).toBe(0.5)
  })

  test('root-level orderId/fillPrice/fillLot (the old wrong read) are NOT mapped', () => {
    const legacyShape = { success: true, orderId: 'X', fillPrice: 1, fillLot: 2 }
    const out = mapBridgeOrderResponse(legacyShape)
    expect(out.ticket).toBeUndefined()
    expect(out.orderId).toBeUndefined()
    expect(out.fillPrice).toBeUndefined()
    expect(out.fillLot).toBeUndefined()
  })

  test('null json → empty mapping', () => {
    expect(mapBridgeOrderResponse(null)).toEqual({})
  })

  test('undefined json → empty mapping', () => {
    expect(mapBridgeOrderResponse(undefined)).toEqual({})
  })

  test('data: null → empty mapping', () => {
    expect(mapBridgeOrderResponse({ success: true, data: null })).toEqual({})
  })

  test('missing data key → empty mapping', () => {
    expect(mapBridgeOrderResponse({ success: true })).toEqual({})
  })

  test('non-finite ticket (NaN/Infinity) dropped', () => {
    expect(mapBridgeOrderResponse({ success: true, data: { ticket: Number.NaN } }).ticket).toBeUndefined()
    expect(mapBridgeOrderResponse({ success: true, data: { ticket: Number.POSITIVE_INFINITY } }).ticket).toBeUndefined()
  })

  test('string ticket is NOT mapped (type-safe)', () => {
    const out = mapBridgeOrderResponse({ success: true, data: { ticket: '500123' } })
    expect(out.ticket).toBeUndefined()
    expect(out.orderId).toBeUndefined()
  })

  test('partial fill data maps only present fields', () => {
    const out = mapBridgeOrderResponse({ success: true, data: { ticket: 7, openPrice: 100 } })
    expect(out.ticket).toBe(7)
    expect(out.orderId).toBe('7')
    expect(out.fillPrice).toBe(100)
    expect(out.fillLot).toBeUndefined()
  })

  test('ticket 0 is treated as invalid (broker tickets are positive)', () => {
    expect(mapBridgeOrderResponse({ success: true, data: { ticket: 0 } }).ticket).toBeUndefined()
  })

  test('error envelope { success:false, message, mt5Code } → empty mapping (error handled elsewhere)', () => {
    const out = mapBridgeOrderResponse({ success: false, code: 400, message: 'Not enough margin', mt5Code: 10019 })
    expect(out).toEqual({})
  })
})
