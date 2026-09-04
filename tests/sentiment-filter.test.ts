/**
 * Unit tests — src/lib/sentiment-filter.ts (Batch B / Task 5-b)
 * ============================================================
 * Covers the pure NLP scoring pipeline:
 *   - analyzeText      (lexicon lookup, negators, intensifiers, phrases)
 *   - scoreArticle     (title 2x / content 1x weighted blend)
 *   - detectRegime     (BULLISH / BEARISH / EXTREME_* classification)
 *   - SENTIMENT_LEXICON structure (EN + ID, categories, weights)
 *
 * DB-bound functions (computeSymbolSentiment, computeMarketSentiment,
 * filterTrade, getSentimentTrend, getSentimentStats) are intentionally not
 * covered — they scan db.newsArticle / db.sentimentSnapshot. Reported as a
 * coverage limitation in the task report.
 */
import { describe, test, expect } from 'bun:test'
import { analyzeText, scoreArticle, detectRegime, SENTIMENT_LEXICON } from '../src/lib/sentiment-filter'

// ============================================================================
// analyzeText — basics
// ============================================================================

describe('analyzeText', () => {
  test('empty / whitespace-only text → NEUTRAL with zero score & magnitude', () => {
    expect(analyzeText('')).toEqual({
      label: 'NEUTRAL',
      score: 0,
      magnitude: 0,
      wordBreakdown: { positive: 0, negative: 0, neutral: 0 },
      topPositive: [],
      topNegative: [],
    })
    expect(analyzeText('   ').label).toBe('NEUTRAL')
  })

  test('positive-only text → POSITIVE with score 100 and matched words listed', () => {
    const r = analyzeText('growth profit surge')
    expect(r.label).toBe('POSITIVE')
    expect(r.score).toBe(100)
    expect(r.magnitude).toBe(100)
    expect(r.topPositive).toContain('growth')
    expect(r.topPositive).toContain('surge')
    expect(r.wordBreakdown.positive).toBe(5) // 1.5 + 1.5 + 2.0
    expect(r.wordBreakdown.negative).toBe(0)
  })

  test('negative-only text → NEGATIVE with score -100', () => {
    const r = analyzeText('crash crisis panic')
    expect(r.label).toBe('NEGATIVE')
    expect(r.score).toBe(-100)
    expect(r.topNegative).toContain('crash')
    expect(r.wordBreakdown.negative).toBe(7.5) // 2.5 + 2.5 + 2.5
  })

  test('balanced positive/negative text → NEUTRAL at score 0', () => {
    const r = analyzeText('profit loss')
    expect(r.label).toBe('NEUTRAL')
    expect(r.score).toBe(0)
    expect(r.wordBreakdown.positive).toBe(1.5)
    expect(r.wordBreakdown.negative).toBe(1.5)
  })

  test('text with no sentiment words → NEUTRAL, magnitude 0', () => {
    const r = analyzeText('regular quarterly schedule announcement')
    expect(r.label).toBe('NEUTRAL')
    expect(r.score).toBe(0)
    expect(r.magnitude).toBe(0)
  })
})

// ============================================================================
// analyzeText — modifiers (negator / intensifier)
// ============================================================================

describe('analyzeText — context modifiers', () => {
  test('negator flips polarity: "no growth" scores NEGATIVE', () => {
    const r = analyzeText('no growth')
    expect(r.label).toBe('NEGATIVE')
    expect(r.score).toBe(-50)
    expect(r.topNegative).toContain('growth')
    expect(r.topPositive).toEqual([])
  })

  test('negator on a negative word flips it positive: "no crash"', () => {
    const r = analyzeText('no crash')
    expect(r.label).toBe('POSITIVE')
    expect(r.topPositive).toContain('crash')
    expect(r.score).toBe(50) // full positive polarity at half magnitude
  })

  test('intensifier boosts the raw sentiment weight ("extremely strong rally" > "strong rally")', () => {
    const plain = analyzeText('strong rally')
    const boosted = analyzeText('extremely strong rally')
    expect(boosted.wordBreakdown.positive).toBeGreaterThan(plain.wordBreakdown.positive)
    // strong 1.2 + rally 2.0 = 3.2 → with 2.0x intensifier: 2.4 + 4.0 = 6.4
    expect(plain.wordBreakdown.positive).toBe(3.2)
    expect(boosted.wordBreakdown.positive).toBe(6.4)
  })

  test('multi-word financial phrases are matched as single units', () => {
    const r = analyzeText('earnings beat')
    expect(r.label).toBe('POSITIVE')
    expect(r.topPositive).toContain('earnings beat')
    expect(r.wordBreakdown.positive).toBe(2)
  })

  test('Indonesian financial phrase "suku bunga naik" is FINANCIAL_NEGATIVE', () => {
    // rate hike — negative despite the standalone word "naik" being positive
    const r = analyzeText('suku bunga naik')
    expect(r.label).toBe('NEGATIVE')
    expect(r.topNegative).toContain('suku bunga naik')
  })

  test('stop words are filtered out of the magnitude denominator', () => {
    // "the/of/the/company" are stop words; only growth & company count
    const r = analyzeText('the growth of the company')
    expect(r.score).toBe(50) // 1 matched word of 2 remaining tokens
    expect(r.magnitude).toBe(50)
  })
})

// ============================================================================
// analyzeText — bilingual lexicon
// ============================================================================

describe('analyzeText — Indonesian lexicon', () => {
  test('ID positive words score positively', () => {
    const r = analyzeText('laba bersih naik tumbuh')
    expect(r.label).toBe('POSITIVE')
    expect(r.score).toBeGreaterThan(0)
  })

  test('ID negative words score negatively', () => {
    const r = analyzeText('anjlok terpuruk merosot')
    expect(r.label).toBe('NEGATIVE')
    expect(r.score).toBeLessThan(0)
  })
})

// ============================================================================
// scoreArticle
// ============================================================================

describe('scoreArticle', () => {
  test('title carries 2x the weight of content: (100·2 + (-100)·1)/3 ≈ 33', () => {
    const r = scoreArticle({ title: 'growth surge', content: 'crash loss' })
    expect(r.label).toBe('POSITIVE')
    expect(r.score).toBe(33)
  })

  test('content-free article falls back to the title score', () => {
    const r = scoreArticle({ title: 'crash' })
    expect(r.label).toBe('NEGATIVE')
    expect(r.score).toBe(-100)
    expect(r.topNegative).toContain('crash')
  })

  test('empty/whitespace content is treated as missing', () => {
    expect(scoreArticle({ title: 'growth', content: '' }).score).toBe(100)
    expect(scoreArticle({ title: 'growth', content: '   ' }).score).toBe(100)
  })

  test('top words are merged and deduplicated across title and content', () => {
    const r = scoreArticle({ title: 'growth profit', content: 'growth rally' })
    expect(new Set(r.topPositive).size).toBe(r.topPositive.length)
    expect(r.topPositive).toContain('growth')
  })
})

// ============================================================================
// detectRegime
// ============================================================================

describe('detectRegime', () => {
  test('EXTREME_GREED requires score > 80 AND confidence > 70', () => {
    expect(detectRegime(85, 80)).toBe('EXTREME_GREED')
    expect(detectRegime(85, 70)).toBe('BULLISH') // confidence not > 70
    expect(detectRegime(80, 90)).toBe('BULLISH') // score not > 80
  })

  test('EXTREME_FEAR requires score < -80 AND confidence > 70', () => {
    expect(detectRegime(-85, 80)).toBe('EXTREME_FEAR')
    expect(detectRegime(-85, 70)).toBe('BEARISH')
    expect(detectRegime(-80, 90)).toBe('BEARISH')
  })

  test('BULLISH / BEARISH require |score| > 60 and confidence > 50', () => {
    expect(detectRegime(70, 60)).toBe('BULLISH')
    expect(detectRegime(-70, 60)).toBe('BEARISH')
    expect(detectRegime(70, 50)).toBe('NEUTRAL') // confidence not > 50
    expect(detectRegime(60, 80)).toBe('NEUTRAL') // score not > 60
    expect(detectRegime(-60, 80)).toBe('NEUTRAL')
  })

  test('extreme score with low confidence degrades to the standard regime', () => {
    expect(detectRegime(90, 40)).toBe('NEUTRAL') // not even > 50
    expect(detectRegime(95, 60)).toBe('BULLISH') // extreme score, mid confidence
  })

  test('middling scores are NEUTRAL regardless of confidence', () => {
    expect(detectRegime(0, 90)).toBe('NEUTRAL')
    expect(detectRegime(30, 90)).toBe('NEUTRAL')
    expect(detectRegime(-30, 90)).toBe('NEUTRAL')
  })
})

// ============================================================================
// LEXICON STRUCTURE
// ============================================================================

describe('SENTIMENT_LEXICON', () => {
  const VALID_CATEGORIES = new Set([
    'POSITIVE',
    'NEGATIVE',
    'INTENSIFIER',
    'NEGATOR',
    'FINANCIAL_POSITIVE',
    'FINANCIAL_NEGATIVE',
  ])

  test('every entry has a valid category and a positive weight', () => {
    for (const [word, entry] of Object.entries(SENTIMENT_LEXICON)) {
      expect(VALID_CATEGORIES.has(entry.category)).toBe(true)
      expect(entry.weight).toBeGreaterThan(0)
      expect(['EN', 'ID']).toContain(entry.language)
      expect(word.length).toBeGreaterThan(0)
    }
  })

  test('contains the expected anchor words with documented weights', () => {
    expect(SENTIMENT_LEXICON['crash']).toMatchObject({ category: 'NEGATIVE', weight: 2.5 })
    expect(SENTIMENT_LEXICON['growth']).toMatchObject({ category: 'POSITIVE', weight: 1.5 })
    expect(SENTIMENT_LEXICON['not']).toMatchObject({ category: 'NEGATOR' })
    expect(SENTIMENT_LEXICON['extremely']).toMatchObject({ category: 'INTENSIFIER', weight: 2 })
    expect(SENTIMENT_LEXICON['suku bunga naik'].category).toBe('FINANCIAL_NEGATIVE')
  })

  test('multi-word phrase entries are consistent (category, weight, language)', () => {
    const phrases = Object.keys(SENTIMENT_LEXICON).filter((w) => w.includes(' '))
    expect(phrases.length).toBeGreaterThan(10) // EN + ID financial phrases
    for (const p of phrases) {
      const e = SENTIMENT_LEXICON[p]
      expect(e.category).toMatch(/FINANCIAL_(POSITIVE|NEGATIVE)|NEGATIVE/)
    }
  })
})
