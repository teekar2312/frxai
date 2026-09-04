import { db } from '@/lib/db'
import logger from '@/lib/trading-logger'

// ============================================================================
// SECTION 15: CONFIGURATION MANAGEMENT
// ============================================================================

/**
 * Retrieve the AI decision configuration from the database.
 * Falls back to default values if no config exists.
 *
 * @returns AiDecisionConfig record
 */
export async function getDecisionConfig() {
  try {
    const config = await db.aiDecisionConfig.findFirst({
      where: { name: 'default' },
    })

    if (config) {
      return config
    }

    // Seed default config if none exists
    return await seedDecisionConfig()
  } catch (err) {
    logger.error('AI_ENGINE', 'Failed to load decision config, using defaults', {
      details: err instanceof Error ? err.message : String(err),
    })
    // Return a synthetic default config object
    return {
      id: '',
      name: 'default',
      minConfidenceBuy: 65,
      minConfidenceSell: 65,
      sentimentWeight: 0.25,
      technicalWeight: 0.50,
      newsWeight: 0.25,
      maxPositionsPerDecision: 3,
      cooldownSeconds: 300,
      extremeSentimentBlock: true,
      volatilityScalingEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
  }
}

/**
 * Update the AI decision configuration.
 *
 * Merges the provided updates with the existing config. Creates a default
 * config first if none exists.
 *
 * @param updates - Partial config fields to update
 * @returns Updated AiDecisionConfig record
 */
export async function updateDecisionConfig(
  updates: Partial<{
    minConfidenceBuy: number
    minConfidenceSell: number
    sentimentWeight: number
    technicalWeight: number
    newsWeight: number
    maxPositionsPerDecision: number
    cooldownSeconds: number
    extremeSentimentBlock: boolean
    volatilityScalingEnabled: boolean
  }>,
) {
  try {
    // Ensure config exists
    const existing = await db.aiDecisionConfig.findFirst({
      where: { name: 'default' },
    })

    if (!existing) {
      await seedDecisionConfig()
    }

    // Validate weight sum doesn't exceed 1.0
    const current = await db.aiDecisionConfig.findFirst({
      where: { name: 'default' },
    })

    if (!current) {
      logger.error('AI_ENGINE', 'Failed to find config after seeding')
      return await getDecisionConfig()
    }

    let newSentimentW = updates.sentimentWeight ?? (current.sentimentWeight as number)
    let newTechnicalW = updates.technicalWeight ?? (current.technicalWeight as number)
    let newNewsW = updates.newsWeight ?? (current.newsWeight as number)

    // Auto-normalize if sum > 1.0
    const weightSum = newSentimentW + newTechnicalW + newNewsW
    if (weightSum > 1.0) {
      const scale = 1.0 / weightSum
      newSentimentW = Math.round(newSentimentW * scale * 100) / 100
      newTechnicalW = Math.round(newTechnicalW * scale * 100) / 100
      newNewsW = Math.round(newNewsW * scale * 100) / 100

      logger.info('AI_ENGINE', 'Weights auto-normalized to sum to 1.0', {
        metadata: {
          originalSum: weightSum,
          normalized: { sentiment: newSentimentW, technical: newTechnicalW, news: newNewsW },
        },
      })
    }

    // Ensure normalized weights sum to exactly 1.0
    const normalizedSum = newSentimentW + newTechnicalW + newNewsW
    if (Math.abs(normalizedSum - 1.0) > 0.001) {
      // Adjust the largest weight to make the sum exactly 1.0
      const diff = 1.0 - normalizedSum
      if (newTechnicalW >= newSentimentW && newTechnicalW >= newNewsW) {
        newTechnicalW = Math.round((newTechnicalW + diff) * 100) / 100
      } else if (newSentimentW >= newNewsW) {
        newSentimentW = Math.round((newSentimentW + diff) * 100) / 100
      } else {
        newNewsW = Math.round((newNewsW + diff) * 100) / 100
      }
    }

    const updated = await db.aiDecisionConfig.update({
      where: { id: current.id },
      data: {
        ...updates,
        sentimentWeight: newSentimentW,
        technicalWeight: newTechnicalW,
        newsWeight: newNewsW,
      },
    })

    logger.info('AI_ENGINE', 'Decision config updated', {
      metadata: { updates: Object.keys(updates), newValues: updates },
    })

    return updated
  } catch (err) {
    logger.error('AI_ENGINE', 'Failed to update decision config', {
      details: err instanceof Error ? err.message : String(err),
    })
    return await getDecisionConfig()
  }
}

/**
 * Seed the default AI decision configuration if it doesn't exist.
 *
 * Uses upsert to ensure idempotency — safe to call multiple times.
 *
 * @returns The created or existing AiDecisionConfig record
 */
export async function seedDecisionConfig() {
  try {
    const existing = await db.aiDecisionConfig.findFirst({
      where: { name: 'default' },
    })

    if (existing) {
      return existing
    }

    const config = await db.aiDecisionConfig.create({
      data: {
        name: 'default',
        minConfidenceBuy: 65,
        minConfidenceSell: 65,
        sentimentWeight: 0.25,
        technicalWeight: 0.50,
        newsWeight: 0.25,
        maxPositionsPerDecision: 3,
        cooldownSeconds: 300,
        extremeSentimentBlock: true,
        volatilityScalingEnabled: true,
      },
    })

    logger.info('AI_ENGINE', 'Default decision config seeded', {
      metadata: {
        id: config.id,
        minConfidenceBuy: config.minConfidenceBuy,
        minConfidenceSell: config.minConfidenceSell,
        weights: {
          technical: config.technicalWeight,
          news: config.newsWeight,
          sentiment: config.sentimentWeight,
        },
      },
    })

    return config
  } catch (err) {
    logger.error('AI_ENGINE', 'Failed to seed decision config', {
      details: err instanceof Error ? err.message : String(err),
    })
    // Return synthetic default
    return {
      id: '',
      name: 'default',
      minConfidenceBuy: 65,
      minConfidenceSell: 65,
      sentimentWeight: 0.25,
      technicalWeight: 0.50,
      newsWeight: 0.25,
      maxPositionsPerDecision: 3,
      cooldownSeconds: 300,
      extremeSentimentBlock: true,
      volatilityScalingEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
  }
}
