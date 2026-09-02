import { NextRequest, NextResponse } from 'next/server'
import { getDecisionConfig, updateDecisionConfig, STRATEGY_REGISTRY, getDecisionAccuracy } from '@/lib/ai-decision-engine'

/**
 * GET /api/ai/config — Get AI decision engine configuration + strategy list + accuracy
 * PUT /api/ai/config — Update AI decision engine configuration
 */

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
 const msg = err instanceof Error ? err.message : String(err)
 return NextResponse.json({ success: false, error: msg }, { status: 500 })
 }
}

export async function PUT(request: NextRequest) {
 try {
 const body = await request.json()

 // Allowed update fields
 const allowedKeys = new Set([
 'minConfidenceBuy',
 'minConfidenceSell',
 'technicalWeight',
 'newsWeight',
 'sentimentWeight',
 'maxPositionsPerDecision',
 'cooldownSeconds',
 'extremeSentimentBlock',
 'volatilityScalingEnabled',
 ])

 const updates: Record<string, unknown> = {}
 for (const [key, value] of Object.entries(body)) {
 if (allowedKeys.has(key)) {
 updates[key] = value
 }
 }

 if (Object.keys(updates).length === 0) {
 return NextResponse.json(
 { success: false, error: 'No valid fields to update' },
 { status: 400 },
 )
 }

 const updated = await updateDecisionConfig(updates as any)

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
 const msg = err instanceof Error ? err.message : String(err)
 return NextResponse.json({ success: false, error: msg }, { status: 500 })
 }
}
