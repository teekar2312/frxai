import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { preTradeCheck } from "@/lib/risk-engine"
import { calculatePositionSize, updateDailyPerformance } from "@/lib/money-management"
import logger from "@/lib/trading-logger"

export async function GET() {
  try {
    const trades = await db.trade.findMany({
      where: { status: "OPEN" },
      orderBy: { createdAt: "desc" },
    })
    return NextResponse.json({ success: true, data: trades })
  } catch (error) {
    logger.error("TRADE_EXECUTION", "Error fetching trades", {
      details: error instanceof Error ? error.stack : undefined,
    })
    return NextResponse.json(
      { success: false, error: "Failed to fetch trades" },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      symbol,
      direction,
      lotSize,
      entryPrice,
      currentPrice,
      sl,
      tp,
      trailingStop,
      trailingDist,
      strategy,
      timeframe,
      marketCond,
      aiConfidence,
      leverage,
      skipRiskCheck, // For manual override (still logged)
    } = body

    // ---- Basic Validation ----
    if (!symbol || !direction || lotSize == null || entryPrice == null) {
      return NextResponse.json(
        { success: false, error: "Missing required fields: symbol, direction, lotSize, entryPrice" },
        { status: 400 }
      )
    }

    if (!["BUY", "SELL"].includes(direction)) {
      return NextResponse.json(
        { success: false, error: "direction must be BUY or SELL" },
        { status: 400 }
      )
    }

    // ---- Pre-Trade Risk Check ----
    const riskCheck = await preTradeCheck({
      symbol,
      direction,
      lotSize,
      entryPrice,
      sl: sl ?? null,
      tp: tp ?? null,
      strategy: strategy ?? null,
      aiConfidence: aiConfidence ?? null,
    })

    if (!riskCheck.approved && !skipRiskCheck) {
      logger.warn("RISK_MANAGEMENT", `Trade rejected by risk engine: ${riskCheck.reason}`, {
        symbol,
        metadata: {
          direction,
          lotSize,
          entryPrice,
          sl,
          riskCheck,
        },
      })

      // Create a rejected trade record for audit trail
      await db.trade.create({
        data: {
          symbol,
          direction,
          lotSize,
          entryPrice: currentPrice || entryPrice,
          currentPrice: currentPrice || entryPrice,
          sl: sl ?? null,
          tp: tp ?? null,
          trailingStop: trailingStop ?? false,
          trailingDist: trailingDist ?? null,
          strategy: strategy ?? null,
          timeframe: timeframe ?? null,
          marketCond: marketCond ?? null,
          aiConfidence: aiConfidence ?? null,
          leverage: leverage || 25,
          status: "REJECTED",
          rejectReason: riskCheck.reason,
          commission: 0,
          margin: 0,
        },
      })

      return NextResponse.json({
        success: false,
        error: riskCheck.reason || "Trade rejected by risk management",
        riskCheck,
      }, { status: 422 })
    }

    // ---- Money Management: Calculate position size ----
    const BASE_BALANCE = 10000
    const allClosed = await db.trade.findMany({ where: { status: "CLOSED" } })
    const totalClosedPnl = allClosed.reduce((s, t) => s + t.pnl, 0)
    const equity = BASE_BALANCE + totalClosedPnl

    const sizing = await calculatePositionSize({
      symbol,
      direction: direction as "BUY" | "SELL",
      entryPrice,
      sl: sl ?? null,
      equity,
    })

    // Use the risk-checked lot size (which may be reduced)
    const finalLotSize = skipRiskCheck ? lotSize : Math.min(lotSize, riskCheck.suggestedLotSize, sizing.suggestedLotSize)

    // ---- Create Trade ----
    const lev = leverage || 25
    const price = currentPrice || entryPrice
    const commission = finalLotSize * 1 // $1 per lot
    const contractValue = price * finalLotSize * 100000
    const margin = contractValue / lev

    const trade = await db.trade.create({
      data: {
        symbol,
        direction,
        lotSize: finalLotSize,
        entryPrice,
        currentPrice: price,
        sl: sl ?? null,
        tp: tp ?? null,
        trailingStop: trailingStop ?? false,
        trailingDist: trailingDist ?? null,
        strategy: strategy ?? null,
        timeframe: timeframe ?? null,
        marketCond: marketCond ?? null,
        aiConfidence: aiConfidence ?? null,
        leverage: lev,
        commission,
        margin,
        pnl: 0,
        pnlPercent: 0,
      },
    })

    // ---- Update Daily Performance ----
    await updateDailyPerformance({ type: "OPEN" })

    // ---- Log trade ----
    logger.info("TRADE_EXECUTION", `Trade opened: ${direction} ${symbol} ${finalLotSize} lot @ ${entryPrice}`, {
      tradeId: trade.id,
      symbol,
      metadata: {
        direction,
        lotSize: finalLotSize,
        entryPrice,
        sl,
        tp,
        strategy,
        riskCheck: { riskAmount: riskCheck.riskAmount, riskPercent: riskCheck.riskPercent },
        moneyManagement: { suggestedLot: sizing.suggestedLotSize, method: sizing.method, reasoning: sizing.reasoning },
        warnings: riskCheck.warnings,
      },
    })

    return NextResponse.json({
      success: true,
      data: trade,
      riskCheck,
      moneyManagement: {
        suggestedLotSize: sizing.suggestedLotSize,
        method: sizing.method,
        riskAmount: sizing.riskAmount,
        marginRequired: sizing.marginRequired,
        reasoning: sizing.reasoning,
      },
    }, { status: 201 })
  } catch (error) {
    logger.error("TRADE_EXECUTION", "Error creating trade", {
      details: error instanceof Error ? error.stack : undefined,
    })
    return NextResponse.json(
      { success: false, error: "Failed to create trade" },
      { status: 500 }
    )
  }
}
