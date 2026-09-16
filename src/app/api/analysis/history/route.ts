import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getPairConfig, getProviderConfig } from '@/lib/constants'
import type {
  AiProviderId,
  AnalysisResult,
  FundamentalBlock,
  IndicatorReading,
  MlPrediction,
  Pair,
  SignalDirection,
  Timeframe,
} from '@/lib/types'

export const dynamic = 'force-dynamic'

// ============================================================
// GET /api/analysis/history?limit=20 — recent AI analysis records
// mapped back to the full AnalysisResult shape.
// ============================================================

function parseJsonArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const limitParam = Number.parseInt(searchParams.get('limit') ?? '20', 10)
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 20

    const rows = await db.analysisRecord.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    const results: AnalysisResult[] = rows.map((row) => {
      const provider = row.provider as AiProviderId
      const cfg = getProviderConfig(provider)
      const live = row.source === 'ZAI'
      const pairCfg = getPairConfig(row.pair)

      const fundamentals = parseJsonArray<FundamentalBlock>(row.fundamentalsJson)
      const indicators = parseJsonArray<IndicatorReading>(row.indicatorsJson)

      const entry = row.entry ?? 0
      const stopLoss = row.stopLoss ?? 0
      const takeProfit = row.takeProfit ?? 0
      // Recover the pip distances from the persisted price levels when possible
      const stopLossPips =
        entry > 0 && stopLoss > 0 ? Math.round((Math.abs(entry - stopLoss) / pairCfg.pipSize) * 10) / 10 : 0
      const takeProfitPips =
        entry > 0 && takeProfit > 0 ? Math.round((Math.abs(entry - takeProfit) / pairCfg.pipSize) * 10) / 10 : 0

      const mlPrediction: MlPrediction = {
        probability: 0,
        label: 'NEUTRAL',
        samples: 0,
        accuracy: 0,
        modelVersion: 0,
      }

      return {
        pair: row.pair as Pair,
        timeframe: row.timeframe as Timeframe,
        provider,
        providerLabel: cfg.id === 'zai' ? `${cfg.name} (${cfg.model})` : `${cfg.name} (local fallback)`,
        live,
        signal: row.signal as SignalDirection,
        confidence: Math.round(row.confidence),
        score: Math.round(row.score),
        entry,
        stopLoss,
        takeProfit,
        stopLossPips,
        takeProfitPips,
        reasoning: row.reasoning,
        fundamentals,
        indicators,
        newsSentiment: row.newsSentiment,
        mlPrediction,
        createdAt: row.createdAt.toISOString(),
      }
    })

    return NextResponse.json(results)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed to load analysis history' }, { status: 500 })
  }
}
