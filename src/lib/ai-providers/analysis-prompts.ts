// ============================================
// Analysis prompt templates for different tasks
// ============================================

import type { AiMessage } from './types'

/**
 * Build prompt for market analysis of a specific symbol.
 */
export function buildMarketAnalysisPrompt(params: {
  symbol: string
  price: number
  change: number
  technicalSummary: string
  recentNews: string
  sentimentSummary: string
  sector?: string
}): AiMessage[] {
  const { symbol, price, change, technicalSummary, recentNews, sentimentSummary, sector } = params

  const userContent = `Analisis saham ${symbol}${sector ? ` (Sektor: ${sector})` : ''}:

**Harga saat ini:** Rp ${price.toLocaleString('id-ID')}
**Perubahan hari ini:** ${change >= 0 ? '+' : ''}${change.toFixed(2)}%

**Ringkasan Teknikal:**
${technicalSummary}

**Berita Terkini:**
${recentNews || 'Tidak ada berita terkini.'}

**Sentimen Pasar:**
${sentimentSummary}

Berdasarkan data di atas, berikan analisis dalam format JSON berikut (dan HANYA JSON, tanpa penjelasan tambahan):
{
  "marketCondition": "TRENDING_UP" | "TRENDING_DOWN" | "RANGE_BOUND" | "HIGH_VOLATILITY" | "LOW_VOLATILITY",
  "trendDirection": "BULLISH" | "BEARISH" | "NEUTRAL",
  "confidence": <0-100>,
  "action": "BUY" | "SELL" | "HOLD" | "SKIP",
  "reasoning": "<penjelasan singkat 2-3 kalimat dalam Bahasa Indonesia>",
  "keyFactors": [
    { "name": "<nama faktor>", "impact": "POSITIVE" | "NEGATIVE" | "NEUTRAL", "score": <-100 to 100>, "detail": "<detail>" }
  ],
  "riskAssessment": "<penilaian risiko singkat>",
  "sentimentBias": "POSITIVE" | "NEGATIVE" | "NEUTRAL"
}`

  return [
    {
      role: 'system',
      content: 'Kamu adalah analis pasar saham profesional spesialis bursa Indonesia (IDX). Kamu menguasai analisis teknikal, fundamental, dan sentimen pasar. Selalu respons dalam format JSON yang diminta. Gunakan Bahasa Indonesia untuk reasoning dan detail.',
    },
    { role: 'user', content: userContent },
  ]
}

/**
 * Build prompt for sentiment analysis of a text/article.
 */
export function buildSentimentAnalysisPrompt(params: {
  text: string
  symbol?: string
  context?: string
}): AiMessage[] {
  const { text, symbol, context } = params

  const userContent = `Analisis sentimen dari teks berikut${symbol ? ` terkait saham ${symbol}` : ''}:

**Konteks:** ${context || 'Pasar saham Indonesia'}

**Teks:**
${text.slice(0, 3000)}

Berikan analisis dalam format JSON (HANYA JSON):
{
  "score": <-100 to 100>,
  "label": "STRONG_BUY" | "BUY" | "NEUTRAL" | "SELL" | "STRONG_SELL",
  "confidence": <0-100>,
  "keyPhrases": ["<frasa kunci positif/negatif>", ...],
  "summary": "<ringkasan sentimen 1-2 kalimat dalam Bahasa Indonesia>"
}`

  return [
    {
      role: 'system',
      content: 'Kamu adalah ahli NLP dan analisis sentimen finansial. Analisis teks berita/artikel terkait pasar saham Indonesia. Berikan skor sentimen -100 (sangat negatif) hingga +100 (sangat positif). Gunakan Bahasa Indonesia.',
    },
    { role: 'user', content: userContent },
  ]
}

/**
 * Build prompt for news article summarization.
 */
export function buildNewsSummaryPrompt(params: {
  title: string
  content: string
  source?: string
}): AiMessage[] {
  const { title, content, source } = params

  const userContent = `Ringkas artikel berita berikut:

**Judul:** ${title}
**Sumber:** ${source || 'Tidak diketahui'}

**Konten:**
${content.slice(0, 4000)}

Berikan ringkasan dalam format JSON (HANYA JSON):
{
  "summary": "<ringkasan 2-3 kalimat dalam Bahasa Indonesia>",
  "sentiment": "POSITIVE" | "NEGATIVE" | "NEUTRAL",
  "impact": "HIGH" | "MEDIUM" | "LOW",
  "keyEntities": ["<entitas yang disebut>", ...],
  "symbols": ["<ticker saham IDX yang relevan>", ...]
}`

  return [
    {
      role: 'system',
      content: 'Kamu adalah jurnalis ekonomi profesional yang ahli dalam merangkum berita pasar saham Indonesia. Identifikasi sentimen, dampak, entitas kunci, dan ticker saham yang relevan (format: BBBB seperti BBCA, TLKM, dll). Gunakan Bahasa Indonesia.',
    },
    { role: 'user', content: userContent },
  ]
}

/**
 * Build prompt for strategy suggestion based on market data.
 */
export function buildStrategySuggestionPrompt(params: {
  symbol: string
  marketCondition: string
  indicators: string
  recentPerformance: string
}): AiMessage[] {
  const { symbol, marketCondition, indicators, recentPerformance } = params

  const userContent = `Berdasarkan data pasar berikut, sarankan strategi trading terbaik:

**Saham:** ${symbol}
**Kondisi Pasar:** ${marketCondition}
**Indikator Teknikal:**
${indicators}

**Performa Terkini:**
${recentPerformance}

Berikan saran dalam Bahasa Indonesia (2-4 kalimat). Fokus pada:
1. Strategi yang paling sesuai saat ini
2. Timeframe yang direkomendasikan
3. Tingkat risiko dan kunci perhatian

Format JSON (HANYA JSON):
{
  "recommendedStrategy": "<nama strategi>",
  "timeframe": "<timeframe>",
  "riskLevel": "LOW" | "MEDIUM" | "HIGH",
  "reasoning": "<penjelasan>",
  "entryConditions": "<syarat masuk posisi>",
  "exitConditions": "<syarat keluar posisi>"
}`

  return [
    {
      role: 'system',
      content: 'Kamu adalah strategis trading profesional spesialis pasar Indonesia. Gunakan analisis teknikal dan pemahaman pasar lokal untuk memberikan saran yang actionable. Gunakan Bahasa Indonesia.',
    },
    { role: 'user', content: userContent },
  ]
}

/**
 * Build prompt for multi-symbol portfolio analysis.
 */
export function buildPortfolioAnalysisPrompt(params: {
  symbols: Array<{ symbol: string; price: number; change: number; sector?: string }>
  marketOverview: string
  riskAlerts: string
}): AiMessage[] {
  const { symbols, marketOverview, riskAlerts } = params

  const symbolTable = symbols
    .map(s => `- ${s.symbol} (Rp ${s.price.toLocaleString('id-ID')}, ${s.change >= 0 ? '+' : ''}${s.change.toFixed(2)}%${s.sector ? `, ${s.sector}` : ''})`)
    .join('\n')

  const userContent = `Analisis portfolio berikut dan berikan rekomendasi:

**Saham dalam Portfolio:**
${symbolTable}

**Ringkasan Pasar:**
${marketOverview}

**Peringatan Risiko:**
${riskAlerts || 'Tidak ada peringatan risiko.'}

Berikan analisis dalam Bahasa Indonesia. Format JSON (HANYA JSON):
{
  "overallSentiment": "BULLISH" | "BEARISH" | "NEUTRAL",
  "confidence": <0-100>,
  "topPicks": ["<ticker1>", "<ticker2>"],
  "avoidList": ["<ticker>"],
  "reasoning": "<penjelasan>",
  "riskWarning": "<peringatan risiko jika ada>"
}`

  return [
    {
      role: 'system',
      content: 'Kamu adalah analis portfolio profesional untuk pasar saham Indonesia. Berikan rekomendasi yang seimbang antara potensi keuntungan dan manajemen risiko. Gunakan Bahasa Indonesia.',
    },
    { role: 'user', content: userContent },
  ]
}
