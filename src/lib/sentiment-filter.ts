/**
 * Sentiment Filter Module - FINEX Indonesia Trading System (Phase 6)
 * =================================================================
 * NLP-like sentiment scoring, regime detection, and trade signal filtering.
 * 
 * Provides:
 *  1. Built-in sentiment lexicon (~150 words, EN + ID)
 *  2. Text-level sentiment analysis with intensifier/negator handling
 *  3. Article scoring (title + content weighted)
 *  4. Symbol-level and market-wide sentiment computation
 *  5. Regime detection (BULLISH, BEARISH, NEUTRAL, EXTREME_FEAR, EXTREME_GREED)
 *  6. Sentiment trend analysis
 *  7. Trade filtering for risk-engine integration
 *  8. Sentiment statistics and keyword seeding
 */

import { db } from "./db"
import logger from "./trading-logger"

// ============================================================================
// TYPES
// ============================================================================

export type SentimentRegime =
  | "BULLISH"
  | "BEARISH"
  | "NEUTRAL"
  | "EXTREME_FEAR"
  | "EXTREME_GREED"

export type KeywordCategory =
  | "POSITIVE"
  | "NEGATIVE"
  | "INTENSIFIER"
  | "NEGATOR"
  | "FINANCIAL_POSITIVE"
  | "FINANCIAL_NEGATIVE"

export type SentimentLabel = "POSITIVE" | "NEGATIVE" | "NEUTRAL"

export interface SentimentScore {
  label: SentimentLabel
  score: number          // -100 to +100
  magnitude: number      // 0-100, how strong the sentiment is
  wordBreakdown: {
    positive: number
    negative: number
    neutral: number
  }
  topPositive: string[]
  topNegative: string[]
}

export interface SentimentFilterResult {
  shouldBlock: boolean
  blockReason?: string
  sizeAdjustment: number   // 0-1, multiplier (e.g. 0.5 = reduce size 50%)
  regime: SentimentRegime
  symbolScore: number
  marketScore: number
  confidence: number
  warnings: string[]
}

export interface SentimentTrend {
  current: number
  previous: number
  direction: "IMPROVING" | "DECLINING" | "STABLE"
  changeRate: number
  regime: SentimentRegime
}

export interface SentimentStats {
  totalSnapshots: number
  latestMarket: {
    overallScore: number
    regime: SentimentRegime
    confidence: number
    timestamp: Date
  } | null
  topBullish: string[]
  topBearish: string[]
  avgConfidence: number
  regimeDistribution: Record<SentimentRegime, number>
}

interface LexiconEntry {
  category: KeywordCategory
  weight: number
  language: string
}

// ============================================================================
// BUILT-IN SENTIMENT LEXICON (~150 words)
// ============================================================================

export const SENTIMENT_LEXICON: Record<string, LexiconEntry> = {
  // ── POSITIVE (EN) ──
  growth:              { category: "POSITIVE", weight: 1.5, language: "EN" },
  profit:              { category: "POSITIVE", weight: 1.5, language: "EN" },
  surge:               { category: "POSITIVE", weight: 2.0, language: "EN" },
  rally:               { category: "POSITIVE", weight: 2.0, language: "EN" },
  bull:                { category: "POSITIVE", weight: 1.5, language: "EN" },
  gain:                { category: "POSITIVE", weight: 1.5, language: "EN" },
  strong:              { category: "POSITIVE", weight: 1.2, language: "EN" },
  upgrade:             { category: "POSITIVE", weight: 1.8, language: "EN" },
  beat:                { category: "POSITIVE", weight: 1.3, language: "EN" },
  exceed:              { category: "POSITIVE", weight: 1.3, language: "EN" },
  outperform:          { category: "POSITIVE", weight: 1.8, language: "EN" },
  recovery:            { category: "POSITIVE", weight: 1.5, language: "EN" },
  boom:                { category: "POSITIVE", weight: 2.0, language: "EN" },
  optimistic:          { category: "POSITIVE", weight: 1.5, language: "EN" },
  expansion:           { category: "POSITIVE", weight: 1.3, language: "EN" },
  record:              { category: "POSITIVE", weight: 1.5, language: "EN" },
  dividend:            { category: "POSITIVE", weight: 1.3, language: "EN" },
  buyback:             { category: "POSITIVE", weight: 1.5, language: "EN" },
  innovation:          { category: "POSITIVE", weight: 1.2, language: "EN" },
  efficient:           { category: "POSITIVE", weight: 1.1, language: "EN" },
  stable:              { category: "POSITIVE", weight: 1.0, language: "EN" },
  resilient:           { category: "POSITIVE", weight: 1.3, language: "EN" },
  robust:              { category: "POSITIVE", weight: 1.4, language: "EN" },
  healthy:             { category: "POSITIVE", weight: 1.2, language: "EN" },
  momentum:            { category: "POSITIVE", weight: 1.5, language: "EN" },
  support:             { category: "POSITIVE", weight: 1.0, language: "EN" },
  demand:              { category: "POSITIVE", weight: 1.2, language: "EN" },
  confidence:          { category: "POSITIVE", weight: 1.3, language: "EN" },
  positive:            { category: "POSITIVE", weight: 1.2, language: "EN" },
  opportunity:         { category: "POSITIVE", weight: 1.3, language: "EN" },
  breakthrough:         { category: "POSITIVE", weight: 1.8, language: "EN" },
  strengthen:          { category: "POSITIVE", weight: 1.3, language: "EN" },

  // ── NEGATIVE (EN) ──
  crash:               { category: "NEGATIVE", weight: 2.5, language: "EN" },
  drop:                { category: "NEGATIVE", weight: 1.3, language: "EN" },
  fall:                { category: "NEGATIVE", weight: 1.2, language: "EN" },
  decline:             { category: "NEGATIVE", weight: 1.5, language: "EN" },
  loss:                { category: "NEGATIVE", weight: 1.5, language: "EN" },
  bear:                { category: "NEGATIVE", weight: 1.5, language: "EN" },
  weak:                { category: "NEGATIVE", weight: 1.3, language: "EN" },
  downgrade:           { category: "NEGATIVE", weight: 1.8, language: "EN" },
  miss:                { category: "NEGATIVE", weight: 1.3, language: "EN" },
  underperform:         { category: "NEGATIVE", weight: 1.8, language: "EN" },
  recession:           { category: "NEGATIVE", weight: 2.0, language: "EN" },
  crisis:              { category: "NEGATIVE", weight: 2.5, language: "EN" },
  panic:               { category: "NEGATIVE", weight: 2.5, language: "EN" },
  fear:                { category: "NEGATIVE", weight: 2.0, language: "EN" },
  slump:               { category: "NEGATIVE", weight: 1.5, language: "EN" },
  debt:                { category: "NEGATIVE", weight: 1.2, language: "EN" },
  deficit:             { category: "NEGATIVE", weight: 1.3, language: "EN" },
  inflation:           { category: "NEGATIVE", weight: 1.5, language: "EN" },
  sanctions:           { category: "NEGATIVE", weight: 2.0, language: "EN" },
  ban:                 { category: "NEGATIVE", weight: 2.0, language: "EN" },
  risk:                { category: "NEGATIVE", weight: 1.0, language: "EN" },
  volatile:            { category: "NEGATIVE", weight: 1.5, language: "EN" },
  uncertainty:         { category: "NEGATIVE", weight: 1.5, language: "EN" },
  concern:             { category: "NEGATIVE", weight: 1.2, language: "EN" },
  warning:             { category: "NEGATIVE", weight: 1.3, language: "EN" },
  negative:            { category: "NEGATIVE", weight: 1.2, language: "EN" },
  threat:              { category: "NEGATIVE", weight: 1.8, language: "EN" },
  disruption:          { category: "NEGATIVE", weight: 1.5, language: "EN" },
  collapse:            { category: "NEGATIVE", weight: 2.5, language: "EN" },
  default:             { category: "NEGATIVE", weight: 2.0, language: "EN" },
  bankrupt:            { category: "NEGATIVE", weight: 2.5, language: "EN" },
  fraud:               { category: "NEGATIVE", weight: 2.0, language: "EN" },
  investigation:       { category: "NEGATIVE", weight: 1.5, language: "EN" },
  lawsuit:             { category: "NEGATIVE", weight: 1.5, language: "EN" },
  penalty:             { category: "NEGATIVE", weight: 1.5, language: "EN" },
  fine:                { category: "NEGATIVE", weight: 1.2, language: "EN" },

  // ── FINANCIAL_POSITIVE ──
  "earnings beat":     { category: "FINANCIAL_POSITIVE", weight: 2.0, language: "EN" },
  "revenue growth":    { category: "FINANCIAL_POSITIVE", weight: 1.8, language: "EN" },
  "margin expansion":  { category: "FINANCIAL_POSITIVE", weight: 1.8, language: "EN" },
  "dividend increase": { category: "FINANCIAL_POSITIVE", weight: 2.0, language: "EN" },
  "buyback program":   { category: "FINANCIAL_POSITIVE", weight: 1.8, language: "EN" },
  "credit upgrade":    { category: "FINANCIAL_POSITIVE", weight: 2.0, language: "EN" },
  "aaa rating":        { category: "FINANCIAL_POSITIVE", weight: 2.0, language: "EN" },
  "above expectations": { category: "FINANCIAL_POSITIVE", weight: 1.8, language: "EN" },
  "strong guidance":   { category: "FINANCIAL_POSITIVE", weight: 1.5, language: "EN" },
  "raised forecast":   { category: "FINANCIAL_POSITIVE", weight: 1.8, language: "EN" },

  // ── FINANCIAL_NEGATIVE ──
  "earnings miss":      { category: "FINANCIAL_NEGATIVE", weight: 2.0, language: "EN" },
  "revenue decline":    { category: "FINANCIAL_NEGATIVE", weight: 1.8, language: "EN" },
  "margin compression": { category: "FINANCIAL_NEGATIVE", weight: 1.8, language: "EN" },
  "dividend cut":       { category: "FINANCIAL_NEGATIVE", weight: 2.0, language: "EN" },
  "credit downgrade":   { category: "FINANCIAL_NEGATIVE", weight: 2.0, language: "EN" },
  "below expectations": { category: "FINANCIAL_NEGATIVE", weight: 1.8, language: "EN" },
  "weak guidance":      { category: "FINANCIAL_NEGATIVE", weight: 1.5, language: "EN" },
  "lowered forecast":   { category: "FINANCIAL_NEGATIVE", weight: 1.8, language: "EN" },
  "write-down":         { category: "FINANCIAL_NEGATIVE", weight: 2.0, language: "EN" },
  impairment:           { category: "FINANCIAL_NEGATIVE", weight: 2.0, language: "EN" },

  // ── INTENSIFIER ──
  very:                 { category: "INTENSIFIER", weight: 1.5, language: "EN" },
  extremely:            { category: "INTENSIFIER", weight: 2.0, language: "EN" },
  significantly:        { category: "INTENSIFIER", weight: 1.8, language: "EN" },
  massively:            { category: "INTENSIFIER", weight: 2.0, language: "EN" },
  sharply:              { category: "INTENSIFIER", weight: 1.8, language: "EN" },
  dramatically:          { category: "INTENSIFIER", weight: 2.0, language: "EN" },
  strongly:             { category: "INTENSIFIER", weight: 1.8, language: "EN" },
  deeply:               { category: "INTENSIFIER", weight: 1.5, language: "EN" },
  highly:               { category: "INTENSIFIER", weight: 1.5, language: "EN" },
  substantially:         { category: "INTENSIFIER", weight: 1.8, language: "EN" },

  // ── NEGATOR ──
  not:                  { category: "NEGATOR", weight: 1.0, language: "EN" },
  no:                   { category: "NEGATOR", weight: 1.0, language: "EN" },
  despite:              { category: "NEGATOR", weight: 1.0, language: "EN" },
  however:              { category: "NEGATOR", weight: 0.8, language: "EN" },
  but:                  { category: "NEGATOR", weight: 0.7, language: "EN" },
  although:             { category: "NEGATOR", weight: 0.8, language: "EN" },
  yet:                  { category: "NEGATOR", weight: 0.7, language: "EN" },
  nonetheless:          { category: "NEGATOR", weight: 0.8, language: "EN" },
  nevertheless:          { category: "NEGATOR", weight: 0.8, language: "EN" },

  // ── POSITIVE (ID - Indonesian) ──
  naik:                 { category: "POSITIVE", weight: 1.5, language: "ID" },
  tumbuh:               { category: "POSITIVE", weight: 1.5, language: "ID" },
  untung:               { category: "POSITIVE", weight: 1.5, language: "ID" },
  kuat:                 { category: "POSITIVE", weight: 1.3, language: "ID" },
  positif:              { category: "POSITIVE", weight: 1.2, language: "ID" },
  membaik:              { category: "POSITIVE", weight: 1.5, language: "ID" },
  optimis:              { category: "POSITIVE", weight: 1.5, language: "ID" },
  sehat:                { category: "POSITIVE", weight: 1.2, language: "ID" },
  stabil:               { category: "POSITIVE", weight: 1.0, language: "ID" },
  rebound:              { category: "POSITIVE", weight: 1.8, language: "ID" },
  pulih:                { category: "POSITIVE", weight: 1.5, language: "ID" },
  surplus:              { category: "POSITIVE", weight: 1.3, language: "ID" },
  melonjak:             { category: "POSITIVE", weight: 2.0, language: "ID" },
  menguat:              { category: "POSITIVE", weight: 1.5, language: "ID" },
  cerah:                { category: "POSITIVE", weight: 1.2, language: "ID" },
  prospektif:           { category: "POSITIVE", weight: 1.3, language: "ID" },

  // ── NEGATIVE (ID - Indonesian) ──
  turun:                { category: "NEGATIVE", weight: 1.3, language: "ID" },
  rugi:                 { category: "NEGATIVE", weight: 1.5, language: "ID" },
  lemah:                { category: "NEGATIVE", weight: 1.3, language: "ID" },
  negatif:              { category: "NEGATIVE", weight: 1.2, language: "ID" },
  memburuk:             { category: "NEGATIVE", weight: 1.5, language: "ID" },
  krisis:               { category: "NEGATIVE", weight: 2.5, language: "ID" },
  inflasi:              { category: "NEGATIVE", weight: 1.5, language: "ID" },
  defisit:              { category: "NEGATIVE", weight: 1.3, language: "ID" },
  "gagal bayar":        { category: "NEGATIVE", weight: 2.0, language: "ID" },
  anjlok:               { category: "NEGATIVE", weight: 2.0, language: "ID" },
  merosot:              { category: "NEGATIVE", weight: 1.5, language: "ID" },
  gagal:                { category: "NEGATIVE", weight: 1.5, language: "ID" },
  terpuruk:             { category: "NEGATIVE", weight: 1.8, language: "ID" },

  // ── FINANCIAL_POSITIVE (ID - Indonesian) ──
  "laba bersih":        { category: "FINANCIAL_POSITIVE", weight: 2.0, language: "ID" },
  "suku bunga turun":   { category: "FINANCIAL_POSITIVE", weight: 1.8, language: "ID" },
  "dividen tunai":      { category: "FINANCIAL_POSITIVE", weight: 1.8, language: "ID" },
  "ekspansi bisnis":    { category: "FINANCIAL_POSITIVE", weight: 1.5, language: "ID" },
  "rating naik":        { category: "FINANCIAL_POSITIVE", weight: 2.0, language: "ID" },

  // ── FINANCIAL_NEGATIVE (ID - Indonesian) ──
  "suku bunga naik":    { category: "FINANCIAL_NEGATIVE", weight: 1.8, language: "ID" },
  "laba turun":         { category: "FINANCIAL_NEGATIVE", weight: 1.8, language: "ID" },
  "rugi bersih":        { category: "FINANCIAL_NEGATIVE", weight: 2.0, language: "ID" },
  "pemutusan hubungan": { category: "FINANCIAL_NEGATIVE", weight: 2.0, language: "ID" },
  "skor kredit turun":  { category: "FINANCIAL_NEGATIVE", weight: 2.0, language: "ID" },
}

// ============================================================================
// STOP WORDS
// ============================================================================

const STOP_WORDS = new Set([
  // EN
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "dare", "ought",
  "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
  "as", "into", "through", "during", "before", "after", "above", "below",
  "between", "out", "off", "over", "under", "again", "further", "then",
  "once", "here", "there", "when", "where", "why", "how", "all", "each",
  "every", "both", "few", "more", "most", "other", "some", "such", "only",
  "own", "same", "so", "than", "too", "very", "just", "because", "if",
  "while", "about", "up", "down", "this", "that", "these", "those",
  "am", "it", "its", "he", "she", "they", "we", "you", "i", "me",
  "him", "her", "us", "them", "my", "your", "his", "our", "their",
  "what", "which", "who", "whom", "and", "or", "nor", "also",
  // ID
  "yang", "dan", "di", "ke", "dari", "dengan", "untuk", "pada", "adalah",
  "ini", "itu", "atau", "juga", "sudah", "belum", "akan", "dapat", "oleh",
  "sebuah", "suatu", "bagi", "serta", "maupun", "namun", "karena", "sejak",
  "hingga", "secara", "tetapi", "sedangkan", "agar", "supaya", "tanpa",
])

// ============================================================================
// MULTI-WORD PHRASES (sorted by length desc for greedy matching)
// ============================================================================

const MULTI_WORD_PHRASES = Object.keys(SENTIMENT_LEXICON)
  .filter((w) => w.includes(" "))
  .sort((a, b) => b.length - a.length)

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Tokenize text into lowercase words, filtering stop words.
 */
function tokenize(text: string): string[] {
  const lower = text.toLowerCase()
  const words = lower.split(/[^a-z0-9\u00C0-\u024F\u4e00-\u9fff]+/)
  return words.filter((w) => w.length > 1 && !STOP_WORDS.has(w))
}

/**
 * Check if a category is a positive sentiment type.
 */
function isPositiveCategory(cat: KeywordCategory): boolean {
  return cat === "POSITIVE" || cat === "FINANCIAL_POSITIVE"
}

/**
 * Check if a category is a negative sentiment type.
 */
function isNegativeCategory(cat: KeywordCategory): boolean {
  return cat === "NEGATIVE" || cat === "FINANCIAL_NEGATIVE"
}

/**
 * Clamp a number between min and max.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * Safely parse a JSON string field from Prisma.
 */
function parseJsonField<T>(field: string | null | undefined, fallback: T): T {
  if (!field) return fallback
  try {
    return JSON.parse(field) as T
  } catch {
    return fallback
  }
}

/**
 * Safely stringify a value to JSON for Prisma storage.
 */
function toJsonString(value: unknown): string {
  return JSON.stringify(value)
}

/**
 * Check if a Prisma JSON field (stored as string) contains a given symbol.
 */
function symbolInJsonSymbols(jsonSymbols: string | null, symbol: string): boolean {
  if (!jsonSymbols) return false
  try {
    const arr: unknown[] = JSON.parse(jsonSymbols)
    return arr.some((s) => {
      if (typeof s === "string") return s.toLowerCase() === symbol.toLowerCase()
      return false
    })
  } catch {
    return false
  }
}

// ============================================================================
// 3. CORE SCORING ENGINE
// ============================================================================

/**
 * Analyze text and return a sentiment score.
 *
 * Pipeline:
 *  1. Tokenize (lowercase, split, filter stop words)
 *  2. Match tokens against lexicon (including multi-word phrases)
 *  3. Apply INTENSIFIER (1.5x) and NEGATOR (flip polarity) modifiers
 *  4. Normalize to -100..+100 scale with magnitude
 *
 * @param text - The raw text to analyze
 * @returns SentimentScore with label, score, magnitude, and word breakdown
 */
export function analyzeText(text: string): SentimentScore {
  if (!text || text.trim().length === 0) {
    return {
      label: "NEUTRAL",
      score: 0,
      magnitude: 0,
      wordBreakdown: { positive: 0, negative: 0, neutral: 0 },
      topPositive: [],
      topNegative: [],
    }
  }

  // Pre-process: replace multi-word phrases with single tokens
  let processedText = text.toLowerCase()
  const phraseMap = new Map<string, string>()
  for (const phrase of MULTI_WORD_PHRASES) {
    const token = phrase.replace(/\s+/g, "_")
    // Use a regex to replace all occurrences
    const regex = new RegExp(phrase.replace(/\s+/g, "\\s+"), "gi")
    if (regex.test(processedText)) {
      phraseMap.set(token, phrase)
      processedText = processedText.replace(regex, ` ${token} `)
    }
  }

  // Tokenize the processed text
  const allTokens = processedText.split(/[^a-z0-9_\u00C0-\u024F\u4e00-\u9fff]+/)
  const tokens = allTokens.filter((w) => w.length > 1 && !STOP_WORDS.has(w))

  const totalWords = Math.max(tokens.length, 1)
  let positiveScore = 0
  let negativeScore = 0
  let matchedWords = 0
  const positiveWords: Array<{ word: string; weight: number }> = []
  const negativeWords: Array<{ word: string; weight: number }> = []

  // Process tokens with context-aware modifier handling
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]

    // Resolve multi-word phrase back to original
    const resolvedWord = phraseMap.get(token) ?? token.replace(/_/g, " ")
    const lookupKey = phraseMap.has(token) ? phraseMap.get(token)! : token

    const entry = SENTIMENT_LEXICON[lookupKey]
    if (!entry) continue

    // Check for preceding NEGATOR
    let negated = false
    if (i > 0) {
      const prevToken = tokens[i - 1]
      const prevEntry = SENTIMENT_LEXICON[prevToken] ?? SENTIMENT_LEXICON[phraseMap.get(prevToken) ?? ""]
      if (prevEntry && prevEntry.category === "NEGATOR") {
        negated = true
      }
    }

    // Check for preceding INTENSIFIER (look up to 2 tokens back)
    let intensifierMultiplier = 1.0
    for (let j = Math.max(0, i - 2); j < i; j++) {
      const prevToken = tokens[j]
      const prevEntry = SENTIMENT_LEXICON[prevToken] ?? SENTIMENT_LEXICON[phraseMap.get(prevToken) ?? ""]
      if (prevEntry && prevEntry.category === "INTENSIFIER") {
        intensifierMultiplier = Math.max(intensifierMultiplier, prevEntry.weight)
      }
    }

    // Skip INTENSIFIER and NEGATOR tokens from direct scoring
    if (entry.category === "INTENSIFIER" || entry.category === "NEGATOR") {
      continue
    }

    matchedWords++
    const effectiveWeight = entry.weight * intensifierMultiplier

    if (negated) {
      // Flip polarity: positive → negative, negative → positive
      if (isPositiveCategory(entry.category)) {
        negativeScore += effectiveWeight
        negativeWords.push({ word: resolvedWord, weight: effectiveWeight })
      } else if (isNegativeCategory(entry.category)) {
        positiveScore += effectiveWeight
        positiveWords.push({ word: resolvedWord, weight: effectiveWeight })
      }
    } else {
      if (isPositiveCategory(entry.category)) {
        positiveScore += effectiveWeight
        positiveWords.push({ word: resolvedWord, weight: effectiveWeight })
      } else if (isNegativeCategory(entry.category)) {
        negativeScore += effectiveWeight
        negativeWords.push({ word: resolvedWord, weight: effectiveWeight })
      }
    }
  }

  // Calculate magnitude (0-100, how much of the text is sentiment-bearing)
  const magnitude = clamp(Math.round((matchedWords / totalWords) * 100), 0, 100)

  // Calculate normalized score (-100 to +100)
  const totalSentiment = positiveScore + negativeScore
  const normalizedRaw = totalSentiment > 0
    ? ((positiveScore - negativeScore) / totalSentiment) * 100
    : 0
  const score = clamp(Math.round(normalizedRaw * (magnitude / 100)), -100, 100)

  // Determine label
  const label: SentimentLabel =
    score > 10 ? "POSITIVE" : score < -10 ? "NEGATIVE" : "NEUTRAL"

  // Top words (sorted by weight desc, take top 5)
  const topPositive = positiveWords
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5)
    .map((w) => w.word)

  const topNegative = negativeWords
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5)
    .map((w) => w.word)

  const neutralCount = Math.max(0, tokens.length - matchedWords)

  return {
    label,
    score,
    magnitude,
    wordBreakdown: {
      positive: Math.round(positiveScore * 100) / 100,
      negative: Math.round(negativeScore * 100) / 100,
      neutral: neutralCount,
    },
    topPositive,
    topNegative,
  }
}

// ============================================================================
// 4. ARTICLE SCORING
// ============================================================================

/**
 * Score a news article by combining title (2x weight) and content (1x weight).
 *
 * @param article - Object with title and optional content
 * @returns Combined SentimentScore
 */
export function scoreArticle(article: { title: string; content?: string | null }): SentimentScore {
  const titleScore = analyzeText(article.title)

  if (!article.content || article.content.trim().length === 0) {
    // No content available — use title score directly
    return {
      ...titleScore,
      score: clamp(titleScore.score, -100, 100),
    }
  }

  const contentScore = analyzeText(article.content)

  // Weighted average: title 2x, content 1x → (title*2 + content*1) / 3
  const combinedScore = clamp(
    Math.round((titleScore.score * 2 + contentScore.score * 1) / 3),
    -100,
    100
  )
  const combinedMagnitude = clamp(
    Math.round((titleScore.magnitude * 2 + contentScore.magnitude * 1) / 3),
    0,
    100
  )

  const label: SentimentLabel =
    combinedScore > 10 ? "POSITIVE" : combinedScore < -10 ? "NEGATIVE" : "NEUTRAL"

  // Merge top words, deduplicate, take top 5
  const allPositive = [...titleScore.topPositive, ...contentScore.topPositive]
  const allNegative = [...titleScore.topNegative, ...contentScore.topNegative]
  const uniquePositive = [...new Set(allPositive)].slice(0, 5)
  const uniqueNegative = [...new Set(allNegative)].slice(0, 5)

  return {
    label,
    score: combinedScore,
    magnitude: combinedMagnitude,
    wordBreakdown: {
      positive: Math.round((titleScore.wordBreakdown.positive + contentScore.wordBreakdown.positive) * 100) / 100,
      negative: Math.round((titleScore.wordBreakdown.negative + contentScore.wordBreakdown.negative) * 100) / 100,
      neutral: titleScore.wordBreakdown.neutral + contentScore.wordBreakdown.neutral,
    },
    topPositive: uniquePositive,
    topNegative: uniqueNegative,
  }
}

// ============================================================================
// 7. REGIME DETECTION
// ============================================================================

/**
 * Detect the sentiment regime based on score and confidence.
 *
 * Rules (checked in priority order):
 *  - EXTREME_GREED:  score > 80 && confidence > 70
 *  - EXTREME_FEAR:   score < -80 && confidence > 70
 *  - BULLISH:        score > 60 && confidence > 50
 *  - BEARISH:        score < -60 && confidence > 50
 *  - NEUTRAL:        everything else
 *
 * @param score - Sentiment score (-100 to +100)
 * @param confidence - Confidence level (0-100)
 * @returns Detected SentimentRegime
 */
export function detectRegime(score: number, confidence: number): SentimentRegime {
  // Check extreme conditions first (higher threshold)
  if (score > 80 && confidence > 70) return "EXTREME_GREED"
  if (score < -80 && confidence > 70) return "EXTREME_FEAR"
  // Then standard conditions
  if (score > 60 && confidence > 50) return "BULLISH"
  if (score < -60 && confidence > 50) return "BEARISH"
  return "NEUTRAL"
}

// ============================================================================
// 5. SYMBOL SENTIMENT COMPUTATION
// ============================================================================

/**
 * Compute aggregate sentiment for a specific symbol from recent news articles.
 *
 * Fetches articles from the last 24h that mention the symbol, scores them
 * if needed, aggregates the results, and persists a SentimentSnapshot.
 *
 * @param symbol - Ticker symbol (e.g. "BBCA") or "MARKET"
 * @returns The created/updated SentimentSnapshot
 */
export async function computeSymbolSentiment(symbol: string) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)

  let articles
  if (symbol === "MARKET") {
    articles = await db.newsArticle.findMany({
      where: { publishedAt: { gte: since } },
      orderBy: { publishedAt: "desc" },
    })
  } else {
    // Fetch all recent articles and filter by JSON symbols field
    articles = await db.newsArticle.findMany({
      where: { publishedAt: { gte: since } },
      orderBy: { publishedAt: "desc" },
    })
    articles = articles.filter((a) => symbolInJsonSymbols(a.symbols as string, symbol))
  }

  if (articles.length === 0) {
    logger.info("AI_ENGINE", `No recent articles found for ${symbol}, returning neutral snapshot`, {
      symbol,
    })
    return {
      id: "",
      symbol,
      overallScore: 0,
      articleCount: 0,
      positiveCount: 0,
      negativeCount: 0,
      neutralCount: 0,
      sentimentRegime: "NEUTRAL" as SentimentRegime,
      confidence: 0,
      weightedScore: 0,
      topPositiveWords: "[]",
      topNegativeWords: "[]",
      sectorBreakdown: "{}",
      timestamp: new Date(),
      createdAt: new Date(),
    }
  }

  // Score articles that haven't been scored yet
  let positiveCount = 0
  let negativeCount = 0
  let neutralCount = 0
  let totalScore = 0
  let totalWeight = 0
  const allTopPositive: Array<{ word: string; count: number }> = []
  const allTopNegative: Array<{ word: string; count: number }> = []
  const positiveWordCount = new Map<string, number>()
  const negativeWordCount = new Map<string, number>()

  for (const article of articles) {
    let sentimentScore = article.sentimentScore as number
    let sentimentLabel: string = article.sentiment as string

    // Score if not already scored (sentimentScore === 0)
    if (sentimentScore === 0 || !sentimentScore) {
      const result = scoreArticle({ title: article.title, content: article.content as string | null })
      sentimentScore = result.score
      sentimentLabel = result.label

      // Collect top words from scoring (Fix #9: populate word tracking)
      for (const w of result.topPositive) {
        positiveWordCount.set(w, (positiveWordCount.get(w) ?? 0) + 1)
      }
      for (const w of result.topNegative) {
        negativeWordCount.set(w, (negativeWordCount.get(w) ?? 0) + 1)
      }

      // Persist score to article
      try {
        await db.newsArticle.update({
          where: { id: article.id },
          data: {
            sentiment: sentimentLabel,
            sentimentScore: sentimentScore,
          },
        })
      } catch (err) {
        logger.warn("AI_ENGINE", `Failed to update article sentiment for ${article.id}`, {
          details: err instanceof Error ? err.message : String(err),
          symbol,
        })
      }
    }

    // Weight: more recent articles get higher weight
    const pubTime = article.publishedAt ?? article.createdAt
    const ageHours = Math.max((Date.now() - pubTime.getTime()) / (1000 * 60 * 60), 0.5)
    const recencyWeight = 1 / ageHours

    totalScore += sentimentScore * recencyWeight
    totalWeight += recencyWeight

    if (sentimentLabel === "POSITIVE") positiveCount++
    else if (sentimentLabel === "NEGATIVE") negativeCount++
    else neutralCount++
  }

  // Calculate weighted average score
  const overallScore = totalWeight > 0 ? Math.round(totalScore / totalWeight) : 0
  const clampedScore = clamp(overallScore, -100, 100)

  // Confidence: based on article count and agreement
  const articleRatio = Math.min(articles.length / 5, 1) // More articles → higher confidence
  const totalLabeled = positiveCount + negativeCount + neutralCount
  const dominantCount = Math.max(positiveCount, negativeCount, neutralCount)
  const agreementRatio = totalLabeled > 0 ? dominantCount / totalLabeled : 0
  const confidence = clamp(Math.round((articleRatio * 0.6 + agreementRatio * 0.4) * 100), 0, 100)

  // Detect regime
  const regime = detectRegime(clampedScore, confidence)

  // Calculate weighted score (score adjusted by confidence)
  const weightedScore = Math.round(clampedScore * (confidence / 100))

  // Build top words from accumulated counts (Fix #9: was always empty)
  const sortedPositiveWords = Array.from(positiveWordCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word)
  const sortedNegativeWords = Array.from(negativeWordCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word)
  const topPositiveStr = toJsonString(sortedPositiveWords)
  const topNegativeStr = toJsonString(sortedNegativeWords)

  // Fix #11: Delete old snapshots for this symbol before creating new one (prevent unbounded growth)
  try {
    const maxSnapshotsPerSymbol = 50
    const existingCount = await db.sentimentSnapshot.count({ where: { symbol } })
    if (existingCount >= maxSnapshotsPerSymbol) {
      const toDelete = existingCount - maxSnapshotsPerSymbol + 1
      const oldest = await db.sentimentSnapshot.findMany({
        where: { symbol },
        orderBy: { timestamp: "asc" },
        take: toDelete,
      })
      if (oldest.length > 0) {
        await db.sentimentSnapshot.deleteMany({
          where: { id: { in: oldest.map((s) => s.id) } },
        })
      }
    }
  } catch {
    // Non-critical cleanup
  }

  // Save snapshot
  try {
    const snapshot = await db.sentimentSnapshot.create({
      data: {
        symbol,
        overallScore: clampedScore,
        articleCount: articles.length,
        positiveCount,
        negativeCount,
        neutralCount,
        sentimentRegime: regime,
        confidence,
        weightedScore,
        topPositiveWords: topPositiveStr,
        topNegativeWords: topNegativeStr,
        sectorBreakdown: "{}",
        timestamp: new Date(),
      },
    })

    logger.info("AI_ENGINE", `Sentiment snapshot computed for ${symbol}: score=${clampedScore}, regime=${regime}, articles=${articles.length}`, {
      symbol,
      metadata: { overallScore: clampedScore, regime, confidence, articleCount: articles.length },
    })

    return snapshot
  } catch (err) {
    logger.error("AI_ENGINE", `Failed to save sentiment snapshot for ${symbol}`, {
      details: err instanceof Error ? err.message : String(err),
      symbol,
    })
    // Return in-memory snapshot on DB failure
    return {
      id: "",
      symbol,
      overallScore: clampedScore,
      articleCount: articles.length,
      positiveCount,
      negativeCount,
      neutralCount,
      sentimentRegime: regime,
      confidence,
      weightedScore,
      topPositiveWords: topPositiveStr,
      topNegativeWords: topNegativeStr,
      sectorBreakdown: "{}",
      timestamp: new Date(),
      createdAt: new Date(),
    }
  }
}

// ============================================================================
// 6. MARKET-WIDE SENTIMENT
// ============================================================================

/**
 * Compute market-wide sentiment across all recent news articles.
 * Also computes per-sector sentiment breakdown.
 *
 * @returns SentimentSnapshot for the "MARKET" symbol
 */
export async function computeMarketSentiment() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const articles = await db.newsArticle.findMany({
    where: { publishedAt: { gte: since } },
    orderBy: { publishedAt: "desc" },
  })

  if (articles.length === 0) {
    logger.info("AI_ENGINE", "No recent articles for market sentiment, returning neutral", {})
    return {
      id: "",
      symbol: "MARKET",
      overallScore: 0,
      articleCount: 0,
      positiveCount: 0,
      negativeCount: 0,
      neutralCount: 0,
      sentimentRegime: "NEUTRAL" as SentimentRegime,
      confidence: 0,
      weightedScore: 0,
      topPositiveWords: "[]",
      topNegativeWords: "[]",
      sectorBreakdown: "{}",
      timestamp: new Date(),
      createdAt: new Date(),
    }
  }

  let positiveCount = 0
  let negativeCount = 0
  let neutralCount = 0
  let totalScore = 0
  let totalWeight = 0

  // Sector breakdown: group by category, compute avg sentiment per sector
  const sectorMap = new Map<string, { totalScore: number; count: number }>()
  const marketPositiveWords = new Map<string, number>()
  const marketNegativeWords = new Map<string, number>()

  for (const article of articles) {
    let sentimentScore = article.sentimentScore as number
    let sentimentLabel: string = article.sentiment as string

    // Score if not already scored
    if (sentimentScore === 0 || !sentimentScore) {
      const result = scoreArticle({ title: article.title, content: article.content as string | null })
      sentimentScore = result.score
      sentimentLabel = result.label

      // Track top words for market sentiment (Fix #9)
      for (const w of result.topPositive) {
        marketPositiveWords.set(w, (marketPositiveWords.get(w) ?? 0) + 1)
      }
      for (const w of result.topNegative) {
        marketNegativeWords.set(w, (marketNegativeWords.get(w) ?? 0) + 1)
      }

      try {
        await db.newsArticle.update({
          where: { id: article.id },
          data: {
            sentiment: sentimentLabel,
            sentimentScore: sentimentScore,
          },
        })
      } catch (err) {
        logger.warn("AI_ENGINE", `Failed to update article sentiment for ${article.id}`, {
          details: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // Recency weight
    const pubTime = article.publishedAt ?? article.createdAt
    const ageHours = Math.max((Date.now() - pubTime.getTime()) / (1000 * 60 * 60), 0.5)
    const recencyWeight = 1 / ageHours

    totalScore += sentimentScore * recencyWeight
    totalWeight += recencyWeight

    if (sentimentLabel === "POSITIVE") positiveCount++
    else if (sentimentLabel === "NEGATIVE") negativeCount++
    else neutralCount++

    // Sector tracking
    const sector = (article.category as string) || "general"
    const existing = sectorMap.get(sector) || { totalScore: 0, count: 0 }
    existing.totalScore += sentimentScore
    existing.count++
    sectorMap.set(sector, existing)
  }

  // Calculate aggregate values
  const overallScore = totalWeight > 0 ? Math.round(totalScore / totalWeight) : 0
  const clampedScore = clamp(overallScore, -100, 100)

  const articleRatio = Math.min(articles.length / 10, 1) // Market needs more articles for confidence
  const totalLabeled = positiveCount + negativeCount + neutralCount
  const dominantCount = Math.max(positiveCount, negativeCount, neutralCount)
  const agreementRatio = totalLabeled > 0 ? dominantCount / totalLabeled : 0
  const confidence = clamp(Math.round((articleRatio * 0.6 + agreementRatio * 0.4) * 100), 0, 100)

  const regime = detectRegime(clampedScore, confidence)
  const weightedScore = Math.round(clampedScore * (confidence / 100))

  // Build sector breakdown
  const sectorBreakdown: Record<string, number> = {}
  for (const [sector, data] of sectorMap) {
    sectorBreakdown[sector] = Math.round(data.totalScore / data.count)
  }

  try {
    // Fix #9: Build top words from accumulated counts
    const marketTopPositive = Array.from(marketPositiveWords.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word)
    const marketTopNegative = Array.from(marketNegativeWords.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word)

    // Fix #11: Prune old MARKET snapshots
    try {
      const maxSnapshots = 50
      const existingCount = await db.sentimentSnapshot.count({ where: { symbol: "MARKET" } })
      if (existingCount >= maxSnapshots) {
        const toDelete = existingCount - maxSnapshots + 1
        const oldest = await db.sentimentSnapshot.findMany({
          where: { symbol: "MARKET" },
          orderBy: { timestamp: "asc" },
          take: toDelete,
        })
        if (oldest.length > 0) {
          await db.sentimentSnapshot.deleteMany({
            where: { id: { in: oldest.map((s) => s.id) } },
          })
        }
      }
    } catch {
      // Non-critical cleanup
    }

    const snapshot = await db.sentimentSnapshot.create({
      data: {
        symbol: "MARKET",
        overallScore: clampedScore,
        articleCount: articles.length,
        positiveCount,
        negativeCount,
        neutralCount,
        sentimentRegime: regime,
        confidence,
        weightedScore,
        topPositiveWords: toJsonString(marketTopPositive),
        topNegativeWords: toJsonString(marketTopNegative),
        sectorBreakdown: toJsonString(sectorBreakdown),
        timestamp: new Date(),
      },
    })

    logger.info("AI_ENGINE", `Market sentiment computed: score=${clampedScore}, regime=${regime}, articles=${articles.length}, sectors=${Object.keys(sectorBreakdown).length}`, {
      metadata: { overallScore: clampedScore, regime, confidence, articleCount: articles.length, sectors: Object.keys(sectorBreakdown).length },
    })

    return snapshot
  } catch (err) {
    logger.error("AI_ENGINE", "Failed to save market sentiment snapshot", {
      details: err instanceof Error ? err.message : String(err),
    })
    return {
      id: "",
      symbol: "MARKET",
      overallScore: clampedScore,
      articleCount: articles.length,
      positiveCount,
      negativeCount,
      neutralCount,
      sentimentRegime: regime,
      confidence,
      weightedScore,
      topPositiveWords: toJsonString(marketTopPositive),
      topNegativeWords: toJsonString(marketTopNegative),
      sectorBreakdown: toJsonString(sectorBreakdown),
      timestamp: new Date(),
      createdAt: new Date(),
    }
  }
}

// ============================================================================
// 8. SENTIMENT TREND
// ============================================================================

/**
 * Get the sentiment trend for a symbol by comparing the last two snapshots.
 *
 * @param symbol - Ticker symbol or "MARKET"
 * @param hours - Lookback period in hours (default 24)
 * @returns SentimentTrend with direction and change rate
 */
export async function getSentimentTrend(symbol: string, hours: number = 24): Promise<SentimentTrend> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000)

  try {
    const snapshots = await db.sentimentSnapshot.findMany({
      where: { symbol, timestamp: { gte: since } },
      orderBy: { timestamp: "desc" },
      take: 2,
    })

    if (snapshots.length === 0) {
      return {
        current: 0,
        previous: 0,
        direction: "STABLE",
        changeRate: 0,
        regime: "NEUTRAL",
      }
    }

    const current = snapshots[0].overallScore as number
    const previous = snapshots.length > 1 ? (snapshots[1].overallScore as number) : current

    const diff = current - previous
    const absPrevious = Math.abs(previous) || 1
    const changeRate = Math.round((diff / absPrevious) * 100)

    let direction: SentimentTrend["direction"]
    if (diff > 5) {
      direction = "IMPROVING"
    } else if (diff < -5) {
      direction = "DECLINING"
    } else {
      direction = "STABLE"
    }

    const regime = detectRegime(current, snapshots[0].confidence as number)

    return { current, previous, direction, changeRate, regime }
  } catch (err) {
    logger.error("AI_ENGINE", `Failed to get sentiment trend for ${symbol}`, {
      details: err instanceof Error ? err.message : String(err),
      symbol,
    })
    return {
      current: 0,
      previous: 0,
      direction: "STABLE",
      changeRate: 0,
      regime: "NEUTRAL",
    }
  }
}

// ============================================================================
// 9. TRADE FILTERING (KEY FUNCTION FOR RISK-ENGINE INTEGRATION)
// ============================================================================

/**
 * Filter a trade based on current sentiment conditions.
 *
 * This is the primary integration point for the risk engine. It evaluates
 * both symbol-level and market-wide sentiment to determine whether a trade
 * should be blocked, size-adjusted, or allowed with warnings.
 *
 * Decision rules:
 *  - EXTREME_FEAR or EXTREME_GREED on symbol → block
 *  - EXTREME_FEAR on market → block BUY (don't buy into panic)
 *  - EXTREME_GREED on market → block SELL (don't short into euphoria)
 *  - BUY against strong negative sentiment (< -40) → 50% size reduction
 *  - SELL against strong positive sentiment (> 40) → 50% size reduction
 *  - Low confidence (< 20) → warning
 *
 * @param symbol - Ticker symbol
 * @param direction - Trade direction (BUY or SELL)
 * @returns SentimentFilterResult with blocking decision and adjustments
 */
export async function filterTrade(
  symbol: string,
  direction: "BUY" | "SELL"
): Promise<SentimentFilterResult> {
  const result: SentimentFilterResult = {
    shouldBlock: false,
    sizeAdjustment: 1.0,
    regime: "NEUTRAL",
    symbolScore: 0,
    marketScore: 0,
    confidence: 0,
    warnings: [],
  }

  try {
    // 1. Get latest sentiment snapshot for symbol (or compute if missing/stale >30min)
    const staleThreshold = new Date(Date.now() - 30 * 60 * 1000)
    let symbolSnapshot = await db.sentimentSnapshot.findFirst({
      where: { symbol, timestamp: { gte: staleThreshold } },
      orderBy: { timestamp: "desc" },
    })

    if (!symbolSnapshot) {
      logger.info("AI_ENGINE", `No recent sentiment snapshot for ${symbol}, computing fresh`, { symbol })
      symbolSnapshot = await computeSymbolSentiment(symbol)
    }

    // 2. Get market sentiment snapshot
    let marketSnapshot = await db.sentimentSnapshot.findFirst({
      where: { symbol: "MARKET", timestamp: { gte: staleThreshold } },
      orderBy: { timestamp: "desc" },
    })

    if (!marketSnapshot) {
      logger.info("AI_ENGINE", "No recent market sentiment snapshot, computing fresh", {})
      marketSnapshot = await computeMarketSentiment()
    }

    const symbolScore = symbolSnapshot.overallScore as number
    const marketScore = marketSnapshot.overallScore as number
    const symbolConfidence = symbolSnapshot.confidence as number
    const symbolRegime = symbolSnapshot.sentimentRegime as SentimentRegime
    const marketRegime = marketSnapshot.sentimentRegime as SentimentRegime

    result.symbolScore = symbolScore
    result.marketScore = marketScore
    result.confidence = symbolConfidence
    result.regime = symbolRegime

    // 3. Decision logic

    // Rule: Symbol-level extreme regimes always block
    if (symbolRegime === "EXTREME_FEAR" || symbolRegime === "EXTREME_GREED") {
      result.shouldBlock = true
      result.blockReason = `Extreme sentiment regime detected: ${symbolRegime} (score=${symbolScore})`
      result.warnings.push(result.blockReason)

      logger.warn("RISK_MANAGEMENT", `Sentiment filter BLOCKING ${direction} ${symbol}: ${result.blockReason}`, {
        symbol,
        metadata: {
          direction,
          symbolScore,
          marketScore,
          symbolRegime,
          marketRegime,
          confidence: symbolConfidence,
          blockReason: result.blockReason,
        },
      })

      return result
    }

    // Rule: Market EXTREME_FEAR → block BUY (don't buy into panic)
    if (marketRegime === "EXTREME_FEAR" && direction === "BUY") {
      result.shouldBlock = true
      result.blockReason = `Market EXTREME_FEAR detected (score=${marketScore}), blocking BUY orders`
      result.warnings.push(result.blockReason)

      logger.warn("RISK_MANAGEMENT", `Sentiment filter BLOCKING ${direction} ${symbol}: ${result.blockReason}`, {
        symbol,
        metadata: {
          direction,
          symbolScore,
          marketScore,
          symbolRegime,
          marketRegime,
          confidence: symbolConfidence,
          blockReason: result.blockReason,
        },
      })

      return result
    }

    // Rule: Market EXTREME_GREED → block SELL (don't short into euphoria)
    if (marketRegime === "EXTREME_GREED" && direction === "SELL") {
      result.shouldBlock = true
      result.blockReason = `Market EXTREME_GREED detected (score=${marketScore}), blocking SELL orders`
      result.warnings.push(result.blockReason)

      logger.warn("RISK_MANAGEMENT", `Sentiment filter BLOCKING ${direction} ${symbol}: ${result.blockReason}`, {
        symbol,
        metadata: {
          direction,
          symbolScore,
          marketScore,
          symbolRegime,
          marketRegime,
          confidence: symbolConfidence,
          blockReason: result.blockReason,
        },
      })

      return result
    }

    // Rule: BUY against strong negative sentiment → reduce size 50%
    if (direction === "BUY" && symbolScore < -40) {
      result.sizeAdjustment = 0.5
      const warning = `Buying against strong negative sentiment (score=${symbolScore})`
      result.warnings.push(warning)

      logger.info("RISK_MANAGEMENT", `Sentiment filter SIZE ADJUSTMENT for ${direction} ${symbol}: ${warning}`, {
        symbol,
        metadata: { direction, symbolScore, sizeAdjustment: 0.5 },
      })
    }

    // Rule: SELL against strong positive sentiment → reduce size 50%
    if (direction === "SELL" && symbolScore > 40) {
      result.sizeAdjustment = 0.5
      const warning = `Selling against strong positive sentiment (score=${symbolScore})`
      result.warnings.push(warning)

      logger.info("RISK_MANAGEMENT", `Sentiment filter SIZE ADJUSTMENT for ${direction} ${symbol}: ${warning}`, {
        symbol,
        metadata: { direction, symbolScore, sizeAdjustment: 0.5 },
      })
    }

    // Rule: Low confidence → warning
    if (symbolConfidence < 20) {
      result.warnings.push("Low sentiment confidence, sentiment data may be unreliable")

      logger.info("RISK_MANAGEMENT", `Low sentiment confidence for ${symbol}: ${symbolConfidence}%`, {
        symbol,
        metadata: { confidence: symbolConfidence },
      })
    }

    // Log the final filter result
    logger.info("AI_ENGINE", `Sentiment filter result for ${direction} ${symbol}: block=${result.shouldBlock}, sizeAdj=${result.sizeAdjustment}, regime=${symbolRegime}`, {
      symbol,
      metadata: {
        direction,
        shouldBlock: result.shouldBlock,
        sizeAdjustment: result.sizeAdjustment,
        regime: symbolRegime,
        marketRegime,
        symbolScore,
        marketScore,
        confidence: symbolConfidence,
        warnings: result.warnings,
      },
    })

    return result
  } catch (err) {
    logger.error("AI_ENGINE", `Sentiment filter error for ${direction} ${symbol}`, {
      details: err instanceof Error ? err.message : String(err),
      symbol,
    })

    // On error, allow trade with warning but no blocking
    result.warnings.push(`Sentiment filter encountered an error: ${err instanceof Error ? err.message : String(err)}`)
    result.sizeAdjustment = 0.75 // Conservative reduction on error
    return result
  }
}

// ============================================================================
// 10. SENTIMENT STATISTICS
// ============================================================================

/**
 * Get aggregate sentiment statistics across all snapshots.
 *
 * @returns SentimentStats with totals, distributions, and top symbols
 */
export async function getSentimentStats(): Promise<SentimentStats> {
  try {
    const [totalSnapshots, latestMarket, allSnapshots, bullishSymbols, bearishSymbols] =
      await Promise.all([
        db.sentimentSnapshot.count(),
        db.sentimentSnapshot.findFirst({
          where: { symbol: "MARKET" },
          orderBy: { timestamp: "desc" },
        }),
        db.sentimentSnapshot.findMany({ orderBy: { timestamp: "desc" } }),
        // Top 5 bullish symbols (excluding MARKET)
        db.sentimentSnapshot.findMany({
          where: { symbol: { not: "MARKET" } },
          orderBy: { overallScore: "desc" },
          take: 5,
          distinct: ["symbol"],
        }),
        // Top 5 bearish symbols (excluding MARKET)
        db.sentimentSnapshot.findMany({
          where: { symbol: { not: "MARKET" } },
          orderBy: { overallScore: "asc" },
          take: 5,
          distinct: ["symbol"],
        }),
      ])

    // Average confidence
    const avgConfidence = allSnapshots.length > 0
      ? Math.round(
          allSnapshots.reduce((sum, s) => sum + (s.confidence as number), 0) / allSnapshots.length
        )
      : 0

    // Regime distribution
    const regimeDistribution: Record<SentimentRegime, number> = {
      BULLISH: 0,
      BEARISH: 0,
      NEUTRAL: 0,
      EXTREME_FEAR: 0,
      EXTREME_GREED: 0,
    }
    for (const s of allSnapshots) {
      const regime = s.sentimentRegime as SentimentRegime
      if (regime in regimeDistribution) {
        regimeDistribution[regime]++
      }
    }

    return {
      totalSnapshots,
      latestMarket: latestMarket
        ? {
            overallScore: latestMarket.overallScore as number,
            regime: latestMarket.sentimentRegime as SentimentRegime,
            confidence: latestMarket.confidence as number,
            timestamp: latestMarket.timestamp,
          }
        : null,
      topBullish: bullishSymbols.map((s) => s.symbol),
      topBearish: bearishSymbols.map((s) => s.symbol),
      avgConfidence,
      regimeDistribution,
    }
  } catch (err) {
    logger.error("AI_ENGINE", "Failed to get sentiment stats", {
      details: err instanceof Error ? err.message : String(err),
    })
    return {
      totalSnapshots: 0,
      latestMarket: null,
      topBullish: [],
      topBearish: [],
      avgConfidence: 0,
      regimeDistribution: {
        BULLISH: 0,
        BEARISH: 0,
        NEUTRAL: 0,
        EXTREME_FEAR: 0,
        EXTREME_GREED: 0,
      },
    }
  }
}

// ============================================================================
// 11. SEED SENTIMENT KEYWORDS
// ============================================================================

/**
 * Upsert all built-in lexicon words into the SentimentKeyword database table.
 * Safe to run multiple times (uses upsert with word as unique key).
 */
export async function seedSentimentKeywords(): Promise<{ upserted: number; errors: number }> {
  let upserted = 0
  let errors = 0

  logger.info("SYSTEM", "Starting sentiment keyword seeding", {
    metadata: { totalWords: Object.keys(SENTIMENT_LEXICON).length },
  })

  for (const [word, entry] of Object.entries(SENTIMENT_LEXICON)) {
    try {
      await db.sentimentKeyword.upsert({
        where: { word },
        create: {
          word,
          category: entry.category,
          weight: entry.weight,
          language: entry.language === "EN" ? "EN" : "ID",
        },
        update: {
          category: entry.category,
          weight: entry.weight,
          language: entry.language === "EN" ? "EN" : "ID",
        },
      })
      upserted++
    } catch (err) {
      errors++
      logger.warn("SYSTEM", `Failed to upsert sentiment keyword: ${word}`, {
        details: err instanceof Error ? err.message : String(err),
        metadata: { word, category: entry.category },
      })
    }
  }

  logger.info("SYSTEM", `Sentiment keyword seeding complete: ${upserted} upserted, ${errors} errors`, {
    metadata: { upserted, errors, total: Object.keys(SENTIMENT_LEXICON).length },
  })

  return { upserted, errors }
}
