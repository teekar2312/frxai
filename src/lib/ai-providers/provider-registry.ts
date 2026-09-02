// ============================================
// AI Provider Registry — Metadata for all providers
// ============================================

import type { AiProviderId, AiProviderMeta } from './types'

export const PROVIDER_REGISTRY: Record<AiProviderId, AiProviderMeta> = {
  groq: {
    id: 'groq',
    name: 'Groq AI',
    description: 'Ultra-fast LLM inference. Ideal for real-time trading analysis.',
    website: 'https://console.groq.com',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    supportsStreaming: true,
    supportsVision: false,
    maxContextTokens: 128000,
    iconColor: 'bg-orange-500',
    models: [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile', maxTokens: 32768, supportsVision: false, contextWindow: 128000 },
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant', maxTokens: 8192, supportsVision: false, contextWindow: 128000 },
      { id: 'llama3-70b-8192', name: 'Llama 3 70B', maxTokens: 8192, supportsVision: false, contextWindow: 8192 },
      { id: 'llama3-8b-8192', name: 'Llama 3 8B', maxTokens: 8192, supportsVision: false, contextWindow: 8192 },
      { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', maxTokens: 32768, supportsVision: false, contextWindow: 32768 },
      { id: 'gemma2-9b-it', name: 'Gemma 2 9B IT', maxTokens: 8192, supportsVision: false, contextWindow: 8192 },
    ],
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT-4o & GPT-4o-mini. Best reasoning quality for complex analysis.',
    website: 'https://platform.openai.com',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    supportsStreaming: true,
    supportsVision: true,
    maxContextTokens: 128000,
    iconColor: 'bg-emerald-600',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', maxTokens: 16384, supportsVision: true, contextWindow: 128000 },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', maxTokens: 16384, supportsVision: true, contextWindow: 128000 },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', maxTokens: 4096, supportsVision: true, contextWindow: 128000 },
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', maxTokens: 4096, supportsVision: false, contextWindow: 16385 },
    ],
  },
  together: {
    id: 'together',
    name: 'Together.ai',
    description: 'Open-source models hosted fast. Llama, Qwen, Mistral, DeepSeek.',
    website: 'https://api.together.xyz',
    defaultBaseUrl: 'https://api.together.xyz/v1',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    supportsStreaming: true,
    supportsVision: false,
    maxContextTokens: 128000,
    iconColor: 'bg-sky-600',
    models: [
      { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', name: 'Llama 3.3 70B Turbo', maxTokens: 16384, supportsVision: false, contextWindow: 128000 },
      { id: 'meta-llama/Llama-3.1-8B-Instruct-Turbo', name: 'Llama 3.1 8B Turbo', maxTokens: 8192, supportsVision: false, contextWindow: 128000 },
      { id: 'mistralai/Mixtral-8x7B-Instruct-v0.1', name: 'Mixtral 8x7B', maxTokens: 8192, supportsVision: false, contextWindow: 32768 },
      { id: 'Qwen/Qwen2.5-72B-Instruct-Turbo', name: 'Qwen 2.5 72B Turbo', maxTokens: 16384, supportsVision: false, contextWindow: 128000 },
      { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3', maxTokens: 16384, supportsVision: false, contextWindow: 128000 },
      { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free', name: 'Llama 3.3 70B (Free)', maxTokens: 8192, supportsVision: false, contextWindow: 128000 },
    ],
  },
  tinyfish: {
    id: 'tinyfish',
    name: 'Tinyfish.ai',
    description: 'Lightweight AI for quick analysis tasks.',
    website: 'https://tinyfish.ai',
    defaultBaseUrl: 'https://api.tinyfish.ai/v1',
    defaultModel: 'tinyfish-latest',
    supportsStreaming: false,
    supportsVision: false,
    maxContextTokens: 32000,
    iconColor: 'bg-violet-500',
    models: [
      { id: 'tinyfish-latest', name: 'Tinyfish Latest', maxTokens: 4096, supportsVision: false, contextWindow: 32000 },
      { id: 'tinyfish-fast', name: 'Tinyfish Fast', maxTokens: 2048, supportsVision: false, contextWindow: 16000 },
    ],
  },
  local: {
    id: 'local',
    name: 'Lokal (Ollama)',
    description: 'Model LLM lokal via Ollama. Privasi penuh, tanpa biaya API.',
    website: 'https://ollama.ai',
    defaultBaseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.1',
    supportsStreaming: true,
    supportsVision: false,
    maxContextTokens: 128000,
    iconColor: 'bg-slate-600',
    models: [
      { id: 'llama3.1', name: 'Llama 3.1 8B', maxTokens: 8192, supportsVision: false, contextWindow: 128000 },
      { id: 'llama3.2', name: 'Llama 3.2 3B', maxTokens: 4096, supportsVision: false, contextWindow: 128000 },
      { id: 'gemma2', name: 'Gemma 2 9B', maxTokens: 8192, supportsVision: false, contextWindow: 8192 },
      { id: 'mistral', name: 'Mistral 7B', maxTokens: 8192, supportsVision: false, contextWindow: 32768 },
      { id: 'qwen2.5', name: 'Qwen 2.5 7B', maxTokens: 8192, supportsVision: false, contextWindow: 32768 },
      { id: 'deepseek-r1', name: 'DeepSeek R1 7B', maxTokens: 8192, supportsVision: false, contextWindow: 65536 },
      { id: 'phi3', name: 'Phi-3 Medium', maxTokens: 4096, supportsVision: false, contextWindow: 128000 },
    ],
  },
}

/** Get a provider's metadata by ID */
export function getProviderMeta(id: AiProviderId): AiProviderMeta {
  return PROVIDER_REGISTRY[id]
}

/** Get all provider IDs */
export function getProviderIds(): AiProviderId[] {
  return Object.keys(PROVIDER_REGISTRY) as AiProviderId[]
}

/** Get available models for a provider */
export function getProviderModels(id: AiProviderId) {
  return PROVIDER_REGISTRY[id].models
}
