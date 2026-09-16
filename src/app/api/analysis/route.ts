import { NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { getSimulator } from '@/lib/engine/simulator'
import { INDICATOR_IDS, PAIR_IDS, TIMEFRAME_IDS, getPairConfig, getProviderConfig } from '@/lib/constants'
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
// POST /api/analysis — AI market analysis (LLM live / local fallback)
// Body: { pair: string, timeframe?: string }
// ============================================================

const SIGNAL_DIRECTIONS: SignalDirection[] = ['STRONG_BUY', 'BUY', 'NEUTRAL', 'SELL', 'STRONG_SELL']
const CACHE_TTL_MS = 30_000
const LLM_TIMEOUT_MS = 90_000

// Module-level rate-limit protection (kept on globalThis so it survives HMR)
const g = globalThis as unknown as {
  __finexAnalysisInflight?: Map<string, Promise<AnalysisResult>>
  __finexAnalysisCache?: Map<string, { result: AnalysisResult; at: number }>
}
const inflight: Map<string, Promise<AnalysisResult>> = (g.__finexAnalysisInflight ??= new Map())
const resultCache: Map<string, { result: AnalysisResult; at: number }> = (g.__finexAnalysisCache ??= new Map())

// ------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------
const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))
const roundTo = (v: number, digits: number): number => Number(v.toFixed(digits))

function scoreToSignal(score: number): SignalDirection {
  if (score >= 50) return 'STRONG_BUY'
  if (score >= 20) return 'BUY'
  if (score <= -50) return 'STRONG_SELL'
  if (score <= -20) return 'SELL'
  return 'NEUTRAL'
}

const SIGNAL_LABEL_ID: Record<SignalDirection, string> = {
  STRONG_BUY: 'sinyal BELI kuat',
  BUY: 'sinyal BELI',
  NEUTRAL: 'netral — tunggu konfirmasi',
  SELL: 'sinyal JUAL',
  STRONG_SELL: 'sinyal JUAL kuat',
}

/** Indonesian labels for the NewsItem categories produced by the engine. */
const NEWS_CATEGORY_LABELS: Record<string, string> = {
  CENTRAL_BANK: 'Kebijakan Bank Sentral',
  ECONOMIC: 'Data Ekonomi (NFP/CPI/PPI/GDP/PMI)',
  GEOPOLITICS: 'Politik & Geopolitik',
  FISCAL: 'Kebijakan Fiskal',
  COMMODITY: 'Harga Komoditas',
  SENTIMENT: 'Sentimen Pasar',
  BREAKING: 'Breaking News',
}

const impactWeight = (impact: string): number => (impact === 'HIGH' ? 1.5 : impact === 'MEDIUM' ? 1 : 0.5)

// ------------------------------------------------------------
// Local (fallback) content generators — Bahasa Indonesia
// ------------------------------------------------------------
function buildLocalFundamentals(news: { headline: string; sentiment: number; impact: string; category: string | null }[]): FundamentalBlock[] {
  const sorted = [...news].sort((a, b) => impactWeight(b.impact) - impactWeight(a.impact))
  const blocks: FundamentalBlock[] = []
  for (const n of sorted) {
    if (blocks.length >= 5) break
    const sentiment: FundamentalBlock['sentiment'] = n.sentiment > 0.15 ? 'BULLISH' : n.sentiment < -0.15 ? 'BEARISH' : 'NEUTRAL'
    blocks.push({
      title: (n.category && NEWS_CATEGORY_LABELS[n.category]) || 'Berita Pasar',
      content: `${n.headline} (impact ${n.impact}, sentimen ${(n.sentiment * 100).toFixed(0)}%).`,
      sentiment,
    })
  }
  if (blocks.length === 0) {
    blocks.push({
      title: 'Sentimen Pasar',
      content: 'Tidak ada berita signifikan dalam 24 jam terakhir. Analisa didasarkan pada sinyal indikator teknikal dan struktur harga.',
      sentiment: 'NEUTRAL',
    })
  }
  return blocks
}

function buildLocalReasoning(
  pair: string,
  timeframe: string,
  readings: IndicatorReading[],
  score: number,
  newsSentiment: number,
  signal: SignalDirection,
): string {
  const buys = readings.filter((r) => r.signal === 'BUY')
  const sells = readings.filter((r) => r.signal === 'SELL')
  const neutrals = readings.length - buys.length - sells.length
  const topBuy = buys.slice(0, 3).map((r) => r.name).join(', ')
  const topSell = sells.slice(0, 3).map((r) => r.name).join(', ')
  const newsTxt = newsSentiment > 0.15 ? 'positif (bullish)' : newsSentiment < -0.15 ? 'negatif (bearish)' : 'cenderung netral'
  const parts: string[] = []
  parts.push(
    `Analisa lokal ${pair} timeframe ${timeframe}: ${buys.length} indikator memberi sinyal BUY, ${sells.length} SELL, ${neutrals} netral — skor voting berbobot ${score >= 0 ? '+' : ''}${score.toFixed(0)} dari rentang -100..100.`,
  )
  if (topBuy) parts.push(`Indikator pendukung naik: ${topBuy}.`)
  if (topSell) parts.push(`Indikator pendukung turun: ${topSell}.`)
  parts.push(`Sentimen berita 24 jam terakhir ${newsTxt} (indeks ${(newsSentiment * 100).toFixed(0)}%).`)
  parts.push(`Kesimpulan model lokal: ${SIGNAL_LABEL_ID[signal]}. Tetap patuhi money management FINEX (risk per trade, SL 5-15 pips, RR minimal 1:1.5).`)
  return parts.join(' ')
}

// ------------------------------------------------------------
// LLM layer (Z.AI via z-ai-web-dev-sdk — server only)
// ------------------------------------------------------------
interface LlmAnalysis {
  signal: SignalDirection | null
  confidence: number | null
  score: number | null
  reasoning: string | null
  fundamentals: FundamentalBlock[]
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('LLM timeout')), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

/** Parse the LLM reply robustly: strip markdown fences, extract the outermost JSON object. */
function parseLlmJson(text: string): LlmAnalysis | null {
  try {
    let raw = text.trim()
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start === -1 || end === -1 || end <= start) return null
    const obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>

    const rawSignal = typeof obj.signal === 'string' ? obj.signal.trim().toUpperCase() : ''
    const signal = SIGNAL_DIRECTIONS.includes(rawSignal as SignalDirection) ? (rawSignal as SignalDirection) : null
    const score =
      typeof obj.score === 'number' && Number.isFinite(obj.score) ? clamp(Math.round(obj.score), -100, 100) : null
    // Need at least a direction (explicit signal or a score to derive it from)
    if (!signal && score === null) return null

    const confidence =
      typeof obj.confidence === 'number' && Number.isFinite(obj.confidence)
        ? clamp(Math.round(obj.confidence), 0, 100)
        : null
    const reasoning = typeof obj.reasoning === 'string' && obj.reasoning.trim() ? obj.reasoning.trim() : null

    const fundamentals: FundamentalBlock[] = []
    if (Array.isArray(obj.fundamentals)) {
      for (const f of obj.fundamentals) {
        if (!f || typeof f !== 'object') continue
        const title = typeof (f as Record<string, unknown>).title === 'string' ? ((f as Record<string, unknown>).title as string).trim() : ''
        const content = typeof (f as Record<string, unknown>).content === 'string' ? ((f as Record<string, unknown>).content as string).trim() : ''
        const rawSentiment =
          typeof (f as Record<string, unknown>).sentiment === 'string'
            ? ((f as Record<string, unknown>).sentiment as string).trim().toUpperCase()
            : ''
        const sentiment: FundamentalBlock['sentiment'] =
          rawSentiment === 'BULLISH' || rawSentiment === 'BEARISH' ? rawSentiment : 'NEUTRAL'
        if (title && content) fundamentals.push({ title: title.slice(0, 120), content: content.slice(0, 600), sentiment })
        if (fundamentals.length >= 7) break
      }
    }

    return { signal, confidence, score, reasoning, fundamentals }
  } catch {
    return null
  }
}

async function callZaiLlm(userPrompt: string): Promise<LlmAnalysis | null> {
  try {
    const zai = await ZAI.create()
    const completion = (await withTimeout(
      zai.chat.completions.create({
        messages: [
          {
            role: 'assistant',
            content:
              'You are an expert forex analyst for FINEX Indonesia (leverage 1:500). Respond with STRICT JSON only, no markdown fences.',
          },
          { role: 'user', content: userPrompt },
        ],
        thinking: { type: 'disabled' },
      }),
      LLM_TIMEOUT_MS,
    )) as { choices?: Array<{ message?: { content?: string } }> }
    const text = completion?.choices?.[0]?.message?.content
    if (!text) return null
    return parseLlmJson(text)
  } catch {
    return null
  }
}

function buildLlmPrompt(input: {
  pair: string
  timeframe: string
  bid: number
  ask: number
  digits: number
  readings: IndicatorReading[]
  newsSentiment: number
  headlines: { headline: string; sentiment: number; impact: string }[]
  mlScore: number
}): string {
  const indicatorLines = input.readings
    .map((r) => `- ${r.id} (${r.name}, ${r.category}) | ${r.signal} | ${r.value}`)
    .join('\n')
  const headlineLines = input.headlines
    .map((h, i) => `${i + 1}. [${h.impact}] ${h.headline} (sentiment ${(h.sentiment * 100).toFixed(0)}%)`)
    .join('\n')

  return [
    `Analyze ${input.pair} on timeframe ${input.timeframe} for a FINEX Indonesia account (leverage 1:500).`,
    `Current price: bid ${input.bid.toFixed(input.digits)} / ask ${input.ask.toFixed(input.digits)}.`,
    '',
    'Technical indicator readings (id | signal | value):',
    indicatorLines || '- (no indicator readings)',
    '',
    `News sentiment last 24h (-1..1): ${input.newsSentiment.toFixed(2)}`,
    'Top headlines:',
    headlineLines || '- (no recent news)',
    '',
    `ML local score (weighted indicator voting, -100..100): ${input.mlScore}`,
    '',
    'Respond with STRICT JSON only (no markdown fences, no extra text) in exactly this shape:',
    '{"signal":"STRONG_BUY|BUY|NEUTRAL|SELL|STRONG_SELL","confidence":0-100,"score":-100..100,"reasoning":"2-4 sentences analysis in Bahasa Indonesia","fundamentals":[{"title":"category title","content":"1-2 sentences in Bahasa Indonesia","sentiment":"BULLISH|BEARISH|NEUTRAL"}]}',
    '',
    'Rules for "fundamentals": pick the 4-7 MOST RELEVANT of these 13 categories for this pair:',
    'Central Bank Policy, NFP, CPI, PPI, GDP, Unemployment Rate, Retail Sales, PMI, Politics/Geopolitics, Fiscal Policy, Commodity Prices, Market Sentiment, Breaking News.',
    'Use the provided news + indicator data as basis. "reasoning" and every "content" MUST be in Bahasa Indonesia.',
  ].join('\n')
}

// ------------------------------------------------------------
// POST handler
// ------------------------------------------------------------
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { pair?: unknown; timeframe?: unknown } | null
    const pairRaw = typeof body?.pair === 'string' ? body.pair.trim().toUpperCase() : ''
    if (!pairRaw || !(PAIR_IDS as string[]).includes(pairRaw)) {
      return NextResponse.json({ error: `Invalid pair — must be one of ${PAIR_IDS.join(', ')}` }, { status: 400 })
    }
    const pair = pairRaw as Pair

    const sim = getSimulator()
    const settings = await sim.getSettings()

    // Resolve timeframe: body override (validated) → first configured timeframe
    const bodyTf = typeof body?.timeframe === 'string' ? body.timeframe.trim().toUpperCase() : ''
    if (bodyTf && !TIMEFRAME_IDS.includes(bodyTf as Timeframe)) {
      return NextResponse.json({ error: `Invalid timeframe — must be one of ${TIMEFRAME_IDS.join(', ')}` }, { status: 400 })
    }
    const timeframe = (bodyTf || settings.timeframes[0] || 'M15') as Timeframe

    // Cache: return the last result for this pair+tf within 30s
    const cacheKey = `${pair}:${timeframe}`
    const cached = resultCache.get(cacheKey)
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return NextResponse.json(cached.result)
    }

    // In-flight dedupe: concurrent duplicate calls share one analysis run
    const running = inflight.get(cacheKey)
    if (running) {
      return NextResponse.json(await running)
    }

    const task = runAnalysis(pair, timeframe).finally(() => inflight.delete(cacheKey))
    inflight.set(cacheKey, task)
    const result = await task
    resultCache.set(cacheKey, { result, at: Date.now() })
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'analysis failed' }, { status: 500 })
  }
}

// ------------------------------------------------------------
// Core analysis (never throws LLM errors — falls back to local)
// ------------------------------------------------------------
async function runAnalysis(pair: Pair, timeframe: Timeframe): Promise<AnalysisResult> {
  const sim = getSimulator()
  const settings = await sim.getSettings()
  const cfg = getPairConfig(pair)

  // --- Indicators: manual selection, or top-12 by learned weight (AI mode)
  let indicatorIds = settings.indicators
  if (settings.indicatorMode === 'ai') {
    const top = await db.modelStat.findMany({ orderBy: { weight: 'desc' }, take: 12 })
    const ids = top.map((r) => r.indicator).filter((id) => INDICATOR_IDS.includes(id))
    if (ids.length > 0) indicatorIds = ids
  }

  // --- Market data
  const readings = await sim.getIndicatorReadings(pair, timeframe, indicatorIds)
  const tick = sim.getPrices().find((p) => p.pair === pair)
  const bid = tick?.bid ?? cfg.basePrice
  const ask = tick?.ask ?? cfg.basePrice

  // --- News (last 24h, newest first)
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const news = await db.newsItem.findMany({
    where: { publishedAt: { gte: since } },
    orderBy: { publishedAt: 'desc' },
    take: 15,
  })
  let wSum = 0
  let sSum = 0
  for (const n of news) {
    const w = impactWeight(n.impact)
    wSum += w
    sSum += w * n.sentiment
  }
  const newsSentiment = wSum > 0 ? roundTo(clamp(sSum / wSum, -1, 1), 3) : 0

  // --- Local ML layer (weighted indicator voting + ModelStat aggregate)
  const localScore = clamp(sim.computeSignals(pair, timeframe, indicatorIds).score, -100, 100)
  const stats = await db.modelStat.findMany()
  const samples = stats.reduce((s, r) => s + r.samples, 0)
  const wins = stats.reduce((s, r) => s + r.wins, 0)
  const probability = clamp(50 + localScore / 2, 1, 99)
  const mlPrediction: MlPrediction = {
    probability: roundTo(probability, 1),
    label: probability >= 55 ? 'BUY' : probability <= 45 ? 'SELL' : 'NEUTRAL',
    samples,
    accuracy: roundTo(wins / Math.max(1, samples), 4),
    modelVersion: 1,
  }

  const provider = settings.aiProvider
  const localFundamentals = buildLocalFundamentals(news)
  const localSignal = scoreToSignal(localScore)
  const localReasoning = buildLocalReasoning(pair, timeframe, readings, localScore, newsSentiment, localSignal)

  // --- LLM layer (Z.AI only, live)
  let live = false
  let signal = localSignal
  let score = localScore
  let reasoning = localReasoning
  let fundamentals = localFundamentals
  let providerLabel = `${getProviderConfig(provider).name} (local fallback)`

  if (provider === 'zai') {
    providerLabel = 'Z.AI (GLM-4.6)'
    const topHeadlines = [...news]
      .sort((a, b) => impactWeight(b.impact) - impactWeight(a.impact))
      .slice(0, 5)
      .map((n) => ({ headline: n.headline, sentiment: n.sentiment, impact: n.impact }))
    const prompt = buildLlmPrompt({
      pair,
      timeframe,
      bid,
      ask,
      digits: cfg.digits,
      readings,
      newsSentiment,
      headlines: topHeadlines,
      mlScore: localScore,
    })
    const llm = await callZaiLlm(prompt)
    if (llm) {
      live = true
      // Blend the LLM score with the local indicator score (50/50)
      const llmScore = llm.score ?? localScore
      score = clamp(Math.round(0.5 * llmScore + 0.5 * localScore), -100, 100)
      signal = llm.signal ?? scoreToSignal(score)
      reasoning = llm.reasoning ?? localReasoning
      if (llm.fundamentals.length > 0) fundamentals = llm.fundamentals
    } else {
      // graceful fallback: local result, live=false
      await sim.log('WARN', 'AI', `Analysis ${pair} ${timeframe}: LLM Z.AI gagal/tidak valid — fallback ke model lokal`)
    }
  }

  // --- Trade plan (entry / SL / TP) from the current price
  const isBuy = signal === 'STRONG_BUY' || signal === 'BUY'
  const isSell = signal === 'SELL' || signal === 'STRONG_SELL'
  const entry = roundTo(isSell ? bid : ask, cfg.digits)
  let stopLoss = 0
  let takeProfit = 0
  let stopLossPips = 0
  let takeProfitPips = 0
  if (isBuy || isSell) {
    stopLossPips = clamp(Math.round(settings.stopLossPips), 5, 15)
    takeProfitPips = Math.max(1, Math.round(stopLossPips * settings.takeProfitRatio))
    if (isBuy) {
      stopLoss = roundTo(entry - stopLossPips * cfg.pipSize, cfg.digits)
      takeProfit = roundTo(entry + takeProfitPips * cfg.pipSize, cfg.digits)
    } else {
      stopLoss = roundTo(entry + stopLossPips * cfg.pipSize, cfg.digits)
      takeProfit = roundTo(entry - takeProfitPips * cfg.pipSize, cfg.digits)
    }
  }
  const confidence = clamp(Math.round(Math.abs(score)), 5, 95)

  const result: AnalysisResult = {
    pair,
    timeframe,
    provider,
    providerLabel,
    live,
    signal,
    confidence,
    score,
    entry,
    stopLoss,
    takeProfit,
    stopLossPips,
    takeProfitPips,
    reasoning,
    fundamentals,
    indicators: readings,
    newsSentiment,
    mlPrediction,
    createdAt: new Date().toISOString(),
  }

  // --- Persist + log
  await db.analysisRecord.create({
    data: {
      pair,
      timeframe,
      provider,
      signal,
      confidence: result.confidence,
      entry,
      stopLoss,
      takeProfit,
      score,
      reasoning,
      fundamentalsJson: JSON.stringify(fundamentals),
      indicatorsJson: JSON.stringify(readings),
      newsSentiment,
      source: live ? 'ZAI' : 'DEMO',
    },
  })
  await sim.log(
    'INFO',
    'AI',
    `Analysis ${pair} ${timeframe}: ${signal} (score ${score >= 0 ? '+' : ''}${score}, ${live ? 'LLM live' : 'local fallback'})`,
  )

  return result
}
