import { NextRequest, NextResponse } from 'next/server'
import { executeTrade } from '@/lib/trade-execution-engine'
import { preTradeCheck } from '@/lib/risk-engine'
import { validateSymbol, isMarketOpen, getPricesFromBridge } from '@/lib/mt5-connection'
import { captureIndicatorSnapshot, fetchCandles } from '@/lib/indicator-pool'
import { withTradeExecutionLock } from '@/lib/execution-lock'
import { apiErrorResponse } from '@/lib/api-errors'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { symbol, direction, lotSize, price, sl, tp, strategy, timeframe, skipRiskCheck } = body

    if (!symbol || !direction || !lotSize) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: symbol, direction, lotSize' },
        { status: 400 },
      )
    }

    if (direction !== 'BUY' && direction !== 'SELL') {
      return NextResponse.json(
        { success: false, error: 'direction must be BUY or SELL' },
        { status: 400 },
      )
    }

    const mapping = validateSymbol(symbol)
    if (!mapping) {
      return NextResponse.json(
        { success: false, error: `Unknown symbol: ${symbol}` },
        { status: 400 },
      )
    }

    if (!isMarketOpen()) {
      return NextResponse.json(
        { success: false, error: 'Market is currently closed' },
        { status: 400 },
      )
    }

    let executionPrice = price || 0
    if (executionPrice <= 0) {
      try {
        const prices = await getPricesFromBridge()
        const symbolPrice = prices[symbol]
        if (symbolPrice) {
          executionPrice = direction === 'BUY' ? symbolPrice.ask : symbolPrice.bid
        }
      } catch (_e) { /* fall through */ }

      if (executionPrice <= 0) {
        return NextResponse.json(
          { success: false, error: 'Could not determine execution price.' },
          { status: 400 },
        )
      }
    }

    let indicatorSnapshot: string | undefined
    try {
      const effectiveTimeframe = timeframe || 'M15'
      const candles = await fetchCandles(symbol, effectiveTimeframe, 100)
      if (candles.length >= 30) {
        indicatorSnapshot = captureIndicatorSnapshot(symbol, candles)
      }
    } catch (_e) { /* non-critical */ }

    // Risk check + trade creation run inside the global execution lock so
    // concurrent submissions cannot both pass risk validation before the
    // first trade is written (check-then-act race — see execution-lock.ts).
    const outcome = await withTradeExecutionLock(async () => {
      if (!skipRiskCheck) {
        const riskCheck = await preTradeCheck({
          symbol,
          direction,
          lotSize,
          entryPrice: executionPrice,
          sl: sl ?? null,
          tp: tp ?? null,
          strategy: strategy ?? null,
        })

        if (!riskCheck.approved) {
          return { kind: 'rejected' as const, riskCheck }
        }
      }

      const result = await executeTrade({
        symbol,
        direction,
        lotSize,
        price: executionPrice,
        sl: sl ?? undefined,
        tp: tp ?? undefined,
        strategy: strategy ?? undefined,
        timeframe: timeframe ?? undefined,
        aiConfidence: undefined,
        indicatorSnapshot,
        comment: `MANUAL-${strategy ?? 'USER'}-${Date.now()}`,
      })
      return { kind: 'executed' as const, result }
    })

    if (outcome.kind === 'rejected') {
      const riskCheck = outcome.riskCheck
      return NextResponse.json({
        success: false,
        error: `Risk check failed: ${riskCheck.reason}`,
        riskCheck: {
          approved: false,
          reason: riskCheck.reason,
          suggestedLotSize: riskCheck.suggestedLotSize,
          warnings: riskCheck.warnings,
        },
      }, { status: 400 })
    }

    const result = outcome.result

    if (result.success) {
      return NextResponse.json({
        success: true,
        data: {
          tradeId: result.trade?.id,
          symbol,
          direction,
          lotSize,
          fillPrice: result.trade?.entryPrice,
          orderId: result.orderResult?.orderId,
          attempts: result.orderResult?.attempts,
          latencyMs: result.orderResult?.totalLatencyMs,
        },
      })
    }

    return NextResponse.json({
      success: false,
      error: result.error || 'Trade execution failed',
      mt5ErrorCode: result.orderResult?.mt5ErrorCode,
      mt5ErrorDesc: result.orderResult?.mt5ErrorDesc,
      attempts: result.orderResult?.attempts,
    }, { status: 400 })
  } catch (err) {
    return apiErrorResponse(err, { route: 'POST /api/trades/execute' })
  }
}
