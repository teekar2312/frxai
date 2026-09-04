import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDecisionConfig, updateDecisionConfig, STRATEGY_REGISTRY, getDecisionAccuracy } from '@/lib/ai-decision-engine'
import { apiErrorResponse } from '@/lib/api-errors'

/**
 * GET /api/ai/config — Get AI decision engine configuration + strategy list + accuracy
 * PUT /api/ai/config — Update AI decision engine configuration
 */

/** Zod-validated subset of DecisionConfig that clients may update. */
const decisionConfigUpdateSchema = z
  .object({
    minConfidenceBuy: z.number().min(0).max(1).optional(),
    minConfidenceSell: z.number().min(0).max(1).optional(),
    technicalWeight: z.number().min(0).max(1).optional(),
    newsWeight: z.number().min(0).max(1).optional(),
    sentimentWeight: z.number().min(0).max(1).optional(),
    maxPositionsPerDecision: z.number().int().min(1).max(20).optional(),
    cooldownSeconds: z.number().int().min(0).max(86_400).optional(),
    extremeSentimentBlock: z.boolean().optional(),
    volatilityScalingEnabled: z.boolean().optional(),
  })
  .strict()

export async function GET() {
 try {
 const [config, accuracy] = await Promise.all([
 getDecisionConfig(),
 getDecisionAccuracy(30),
 ])

 return NextResponse.json({
 success: true,
 data: {
 config: {
 minConfidenceBuy: config.minConfidenceBuy,
 minConfidenceSell: config.minConfidenceSell,
 technicalWeight: config.technicalWeight,
 newsWeight: config.newsWeight,
 sentimentWeight: config.sentimentWeight,
 maxPositionsPerDecision: config.maxPositionsPerDecision,
 cooldownSeconds: config.cooldownSeconds,
 extremeSentimentBlock: config.extremeSentimentBlock,
 volatilityScalingEnabled: config.volatilityScalingEnabled,
 },
 strategies: STRATEGY_REGISTRY.map(s => ({
 id: s.id,
 name: s.name,
 description: s.description,
 timeframes: s.timeframes,
 minBars: s.minBars,
 weight: s.weight,
 })),
 accuracy: {
 totalDecisions: accuracy.totalDecisions,
 winRate: accuracy.winRate,
 avgConfidence: accuracy.avgConfidence,
 avgPnlImpact: accuracy.avgPnlImpact,
 confidenceCalibration: accuracy.confidenceCalibration,
 },
 },
 })
 } catch (err) {
 return apiErrorResponse(err, { route: 'AI-CONFIG' })
 }
}

export async function PUT(request: NextRequest) {
 try {
 const body = await request.json()

 const parsed = decisionConfigUpdateSchema.safeParse(body)
 if (!parsed.success) {
 const issues = parsed.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
 return NextResponse.json(
 { success: false, error: `Invalid configuration update: ${issues}` },
 { status: 400 },
 )
 }

 const updates = parsed.data

 if (Object.keys(updates).length === 0) {
 return NextResponse.json(
 { success: false, error: 'No valid fields to update' },
 { status: 400 },
 )
 }

 const updated = await updateDecisionConfig(updates)

 return NextResponse.json({
 success: true,
 data: {
 minConfidenceBuy: updated.minConfidenceBuy,
 minConfidenceSell: updated.minConfidenceSell,
 technicalWeight: updated.technicalWeight,
 newsWeight: updated.newsWeight,
 sentimentWeight: updated.sentimentWeight,
 maxPositionsPerDecision: updated.maxPositionsPerDecision,
 cooldownSeconds: updated.cooldownSeconds,
 extremeSentimentBlock: updated.extremeSentimentBlock,
 volatilityScalingEnabled: updated.volatilityScalingEnabled,
 },
 })
 } catch (err) {
 return apiErrorResponse(err, { route: 'AI-CONFIG' })
 }
}
