// ============================================
// AI Provider Manager
// Handles DB-backed provider config, routing,
// fallback, and unified chat/analysis API.
// ============================================

import { db } from '@/lib/db'
import { PROVIDER_REGISTRY } from './provider-registry'
import { callOpenAiCompat, testOpenAiCompat } from './openai-compat'
import type {
  AiProviderId,
  AiProviderConfigData,
  AiChatRequest,
  AiChatResponse,
  AiProviderTestResult,
  AnalysisTaskType,
} from './types'

// ---- Default configs for each provider (no API keys) ----

interface RawProviderConfig {
  id?: string
  provider: AiProviderId
  name: string
  enabled: boolean
  apiKey: string
  baseUrl: string
  model: string
  temperature: number
  maxTokens: number
  topP: number
  frequencyPenalty: number
  presencePenalty: number
  systemPrompt: string
  roles: string[]
  priority: number
  timeoutMs: number
}

const DEFAULT_PROVIDERS: RawProviderConfig[] = [
  {
    provider: 'groq',
    name: 'Groq AI',
    enabled: false,
    apiKey: '',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    temperature: 0.3,
    maxTokens: 4096,
    topP: 0.9,
    frequencyPenalty: 0,
    presencePenalty: 0,
    systemPrompt: 'Kamu adalah analis pasar saham profesional untuk bursa Indonesia (IDX). Berikan analisis yang akurat, ringkas, dan actionable.',
    roles: ['analysis', 'sentiment', 'news_summary'],
    priority: 1,
    timeoutMs: 30000,
  },
  {
    provider: 'openai',
    name: 'OpenAI',
    enabled: false,
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    temperature: 0.3,
    maxTokens: 4096,
    topP: 0.9,
    frequencyPenalty: 0,
    presencePenalty: 0,
    systemPrompt: 'Kamu adalah analis pasar saham profesional untuk bursa Indonesia (IDX). Berikan analisis yang akurat, ringkas, dan actionable.',
    roles: ['analysis', 'sentiment', 'news_summary'],
    priority: 2,
    timeoutMs: 60000,
  },
  {
    provider: 'together',
    name: 'Together.ai',
    enabled: false,
    apiKey: '',
    baseUrl: 'https://api.together.xyz/v1',
    model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    temperature: 0.3,
    maxTokens: 4096,
    topP: 0.9,
    frequencyPenalty: 0,
    presencePenalty: 0,
    systemPrompt: 'Kamu adalah analis pasar saham profesional untuk bursa Indonesia (IDX). Berikan analisis yang akurat, ringkas, dan actionable.',
    roles: ['analysis', 'sentiment'],
    priority: 3,
    timeoutMs: 60000,
  },
  {
    provider: 'tinyfish',
    name: 'Tinyfish.ai',
    enabled: false,
    apiKey: '',
    baseUrl: 'https://api.tinyfish.ai/v1',
    model: 'tinyfish-latest',
    temperature: 0.3,
    maxTokens: 2048,
    topP: 0.9,
    frequencyPenalty: 0,
    presencePenalty: 0,
    systemPrompt: 'Kamu adalah analis pasar saham profesional untuk bursa Indonesia (IDX).',
    roles: ['sentiment'],
    priority: 5,
    timeoutMs: 30000,
  },
  {
    provider: 'local',
    name: 'Lokal (Ollama)',
    enabled: false,
    apiKey: 'ollama', // Ollama doesn't need a real key
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.1',
    temperature: 0.3,
    maxTokens: 4096,
    topP: 0.9,
    frequencyPenalty: 0,
    presencePenalty: 0,
    systemPrompt: 'Kamu adalah analis pasar saham profesional untuk bursa Indonesia (IDX). Berikan analisis yang akurat, ringkas, dan actionable.',
    roles: ['analysis', 'sentiment', 'news_summary'],
    priority: 10,
    timeoutMs: 120000,
  },
]

// ---- In-memory cache ----
let configCache: AiProviderConfigData[] | null = null
let cacheTimestamp = 0
const CACHE_TTL = 30_000 // 30s

// ---- DB Helpers ----

function toDbFormat(config: RawProviderConfig) {
  return {
    provider: config.provider,
    name: config.name,
    enabled: config.enabled,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    topP: config.topP,
    frequencyPenalty: config.frequencyPenalty,
    presencePenalty: config.presencePenalty,
    systemPrompt: config.systemPrompt,
    roles: JSON.stringify(config.roles),
    priority: config.priority,
    timeoutMs: config.timeoutMs,
  }
}

function fromDbRow(row: Record<string, unknown>): AiProviderConfigData {
  return {
    id: row.id as string,
    provider: row.provider as AiProviderId,
    name: row.name as string,
    enabled: !!(row.enabled as number),
    apiKey: row.apiKey as string,
    baseUrl: row.baseUrl as string,
    model: row.model as string,
    temperature: row.temperature as number,
    maxTokens: row.maxTokens as number,
    topP: row.topP as number,
    frequencyPenalty: row.frequencyPenalty as number,
    presencePenalty: row.presencePenalty as number,
    systemPrompt: row.systemPrompt as string,
    roles: JSON.parse((row.roles as string) || '[]'),
    priority: row.priority as number,
    timeoutMs: row.timeoutMs as number,
    lastTestedAt: (row.lastTestedAt as string) || null,
    lastTestResult: row.lastTestResult === 'success' || row.lastTestResult === 'failure'
      ? row.lastTestResult
      : null,
    lastLatencyMs: (row.lastLatencyMs as number) || null,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  }
}

// ---- Seed defaults ----

export async function seedProviderConfigs(): Promise<void> {
  for (const def of DEFAULT_PROVIDERS) {
    await db.aiProviderConfig.upsert({
      where: { provider: def.provider },
      update: {
        name: def.name,
        baseUrl: def.baseUrl,
        model: def.model,
        temperature: def.temperature,
        maxTokens: def.maxTokens,
        topP: def.topP,
        frequencyPenalty: def.frequencyPenalty,
        presencePenalty: def.presencePenalty,
        systemPrompt: def.systemPrompt,
        roles: JSON.stringify(def.roles),
        priority: def.priority,
        timeoutMs: def.timeoutMs,
      },
      create: toDbFormat(def),
    })
  }
  configCache = null // invalidate cache
}

// ---- CRUD ----

export async function getAllProviderConfigs(): Promise<AiProviderConfigData[]> {
  const now = Date.now()
  if (configCache && now - cacheTimestamp < CACHE_TTL) {
    return configCache
  }

  const rows = await db.aiProviderConfig.findMany({
    orderBy: { priority: 'asc' },
  })
  configCache = rows.map(fromDbRow)
  cacheTimestamp = now
  return configCache
}

export async function getProviderConfig(
  provider: AiProviderId,
): Promise<AiProviderConfigData | null> {
  const row = await db.aiProviderConfig.findUnique({
    where: { provider },
  })
  return row ? fromDbRow(row) : null
}

export async function updateProviderConfig(
  provider: AiProviderId,
  data: Partial<RawProviderConfig>,
): Promise<AiProviderConfigData> {
  const updateData: Record<string, unknown> = { ...data }
  if (data.roles) {
    updateData.roles = JSON.stringify(data.roles)
  }

  const row = await db.aiProviderConfig.update({
    where: { provider },
    data: updateData,
  })
  configCache = null
  return fromDbRow(row)
}

export async function enableProvider(
  provider: AiProviderId,
  enabled: boolean,
): Promise<void> {
  await db.aiProviderConfig.update({
    where: { provider },
    data: { enabled },
  })
  configCache = null
}

export async function testProvider(
  provider: AiProviderId,
): Promise<AiProviderTestResult> {
  const config = await getProviderConfig(provider)
  if (!config) {
    return {
      success: false,
      latencyMs: 0,
      model: '',
      response: '',
      error: 'Provider config not found',
    }
  }

  const result = await testOpenAiCompat(config)

  // Persist test result
  await db.aiProviderConfig.update({
    where: { provider },
    data: {
      lastTestedAt: new Date().toISOString(),
      lastTestResult: result.success ? 'success' : 'failure',
      lastLatencyMs: result.latencyMs,
    },
  })
  configCache = null

  return result
}

// ---- Routing ----

/**
 * Find the best enabled provider for a given task.
 * Returns null if no provider is available.
 */
export async function resolveProvider(
  taskType: AnalysisTaskType,
  preferProvider?: AiProviderId,
): Promise<AiProviderConfigData | null> {
  // If a specific provider is requested, use it if enabled
  if (preferProvider) {
    const config = await getProviderConfig(preferProvider)
    if (config && config.enabled) {
      return config
    }
  }

  // Find providers that support this task role
  const allConfigs = await getAllProviderConfigs()
  const roleMap: Record<AnalysisTaskType, string> = {
    market_analysis: 'analysis',
    sentiment_analysis: 'sentiment',
    news_summary: 'news_summary',
    strategy_suggestion: 'analysis',
    risk_assessment: 'analysis',
  }

  const neededRole = roleMap[taskType]
  const candidates = allConfigs
    .filter(c => c.enabled && c.roles.includes(neededRole))
    .sort((a, b) => a.priority - b.priority)

  // Prefer recently tested-successful providers
  const successful = candidates.filter(
    c => c.lastTestResult === 'success',
  )
  if (successful.length > 0) {
    // Among successful, prefer lowest latency
    return successful.sort(
      (a, b) => (a.lastLatencyMs ?? 99999) - (b.lastLatencyMs ?? 99999),
    )[0]
  }

  // Fall back to any enabled provider for the role
  return candidates[0] || null
}

/**
 * Send a chat request with automatic provider resolution and fallback.
 */
export async function chat(
  request: AiChatRequest,
  options?: {
    taskType?: AnalysisTaskType
    provider?: AiProviderId
    fallbackProviders?: AiProviderId[]
  },
): Promise<AiChatResponse> {
  const taskType = options?.taskType || 'market_analysis'
  const preferProvider = options?.provider
  const fallbackIds = options?.fallbackProviders || []

  // Build ordered list of providers to try
  const triedProviders = new Set<AiProviderId>()
  const providerOrder: AiProviderId[] = []

  if (preferProvider) {
    providerOrder.push(preferProvider)
    triedProviders.add(preferProvider)
  }
  for (const fid of fallbackIds) {
    if (!triedProviders.has(fid)) {
      providerOrder.push(fid)
      triedProviders.add(fid)
    }
  }

  // Add all enabled providers that support the task
  const allConfigs = await getAllProviderConfigs()
  const roleMap: Record<AnalysisTaskType, string> = {
    market_analysis: 'analysis',
    sentiment_analysis: 'sentiment',
    news_summary: 'news_summary',
    strategy_suggestion: 'analysis',
    risk_assessment: 'analysis',
  }
  const neededRole = roleMap[taskType]

  for (const c of allConfigs) {
    if (!triedProviders.has(c.provider) && c.enabled && c.roles.includes(neededRole)) {
      providerOrder.push(c.provider)
      triedProviders.add(c.provider)
    }
  }

  if (providerOrder.length === 0) {
    throw new Error(
      `No AI provider configured for task "${taskType}". Please enable at least one provider.`,
    )
  }

  // Try each provider in order
  const errors: string[] = []
  for (const pid of providerOrder) {
    const config = await getProviderConfig(pid)
    if (!config) continue

    try {
      // Inject system prompt if not already in messages
      const messages = request.messages[0]?.role === 'system'
        ? request.messages
        : [
            { role: 'system' as const, content: config.systemPrompt },
            ...request.messages,
          ]

      const response = await callOpenAiCompat(config, { ...request, messages })
      return response
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${pid}: ${msg}`)
      // Continue to next provider
    }
  }

  throw new Error(
    `All AI providers failed for task "${taskType}": ${errors.join('; ')}`,
  )
}

// ---- Convenience: get provider metadata list for UI ----

export function getProviderMetas() {
  return Object.values(PROVIDER_REGISTRY).map(meta => ({
    id: meta.id,
    name: meta.name,
    description: meta.description,
    website: meta.website,
    defaultModel: meta.defaultModel,
    defaultBaseUrl: meta.defaultBaseUrl,
    models: meta.models,
    supportsStreaming: meta.supportsStreaming,
    supportsVision: meta.supportsVision,
    maxContextTokens: meta.maxContextTokens,
    iconColor: meta.iconColor,
  }))
}
