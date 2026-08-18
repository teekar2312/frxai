import ZAI from 'z-ai-web-dev-sdk';
import type { AiProviderId, AiProviderConfig, AiModel, AiCompletionResult } from '@/lib/trading-types';
import { safeLog } from '@/lib/safe-log';

// ============================================================
// AI-006: Multi-Provider AI Architecture
// Unified abstraction layer for 6 AI providers:
//   ZAI (default), Groq, OpenAI, Tinyfish.ai, together.ai, Lokal AI
// ============================================================

/** Provider registry — single source of truth for all supported providers */
export const AI_PROVIDERS: Record<AiProviderId, AiProviderConfig> = {
  zai: {
    id: 'zai',
    name: 'ZAI (Default)',
    baseUrl: '', // handled internally by z-ai-web-dev-sdk
    apiKeyEnvVar: '', // handled by .z-ai-config file
    models: [{ id: 'default', name: 'ZAI Default' }],
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKeyEnvVar: 'GROQ_API_KEY',
    models: [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile' },
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant' },
      { id: 'llama3-70b-8192', name: 'Llama 3 70B' },
      { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B' },
      { id: 'gemma2-9b-it', name: 'Gemma 2 9B' },
    ],
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
    ],
  },
  tinyfish: {
    id: 'tinyfish',
    name: 'Tinyfish.ai',
    baseUrl: 'https://api.tinyfish.ai/v1',
    apiKeyEnvVar: 'TINYFISH_API_KEY',
    models: [
      { id: 'default', name: 'Tinyfish Default' },
    ],
  },
  together: {
    id: 'together',
    name: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    apiKeyEnvVar: 'TOGETHER_API_KEY',
    models: [
      { id: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo', name: 'Llama 3.1 70B Turbo' },
      { id: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', name: 'Llama 3.1 8B Turbo' },
      { id: 'mistralai/Mixtral-8x7B-Instruct-v0.1', name: 'Mixtral 8x7B' },
      { id: 'Qwen/Qwen2.5-72B-Instruct-Turbo', name: 'Qwen 2.5 72B' },
    ],
  },
  lokal_ai: {
    id: 'lokal_ai',
    name: 'Lokal AI',
    baseUrl: process.env.LOKAL_AI_BASE_URL || 'http://localhost:11434/v1',
    apiKeyEnvVar: 'LOKAL_AI_API_KEY',
    models: [
      { id: 'llama3', name: 'Llama 3 (Local)' },
      { id: 'llama3.1', name: 'Llama 3.1 (Local)' },
      { id: 'mistral', name: 'Mistral (Local)' },
      { id: 'codellama', name: 'Code Llama (Local)' },
      { id: 'phi3', name: 'Phi-3 (Local)' },
    ],
  },
};

/** Valid provider IDs for validation */
export const VALID_AI_PROVIDER_IDS = Object.keys(AI_PROVIDERS) as AiProviderId[];

/** Check if a provider has its API key configured */
export function isProviderAvailable(providerId: AiProviderId): boolean {
  const provider = AI_PROVIDERS[providerId];
  if (providerId === 'zai') return true; // ZAI uses .z-ai-config file
  if (providerId === 'lokal_ai') return true; // Lokal AI (Ollama) doesn't require an API key
  if (!provider.apiKeyEnvVar) return true;
  return !!process.env[provider.apiKeyEnvVar];
}

/** Get all providers that have API keys configured */
export function getAvailableProviders(): AiProviderConfig[] {
  return VALID_AI_PROVIDER_IDS
    .filter(isProviderAvailable)
    .map(id => AI_PROVIDERS[id]);
}

/** Get models available for a specific provider */
export function getModelsForProvider(providerId: AiProviderId): AiModel[] {
  return AI_PROVIDERS[providerId]?.models || [];
}

// ============================================================
// Provider-specific completion functions
// ============================================================

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Call ZAI (z-ai-web-dev-sdk) — AUDIT-AI-14: Added timeout + temperature + max_tokens */
async function callZai(
  messages: ChatMessage[],
  model: string,
  maxTokens = 2000,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      model: model || undefined,
      messages,
      thinking: { type: 'disabled' },
      temperature: 0.3,
      // @ts-expect-error — max_tokens passed through to underlying model
      max_tokens: maxTokens,
    });
    return completion.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timeout);
  }
}

/** Call an OpenAI-compatible API (Groq, OpenAI, together, Tinyfish, Lokal AI) */
async function callOpenAiCompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
): Promise<string> {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      // AUDIT-AI-14: Added max_tokens to prevent unbounded token usage
      body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 2000 }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${errorBody.slice(0, 200)}`);
    }

    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================
// Main unified completion function with failover
// ============================================================

/**
 * Send a chat completion request to the specified AI provider.
 * Includes automatic failover to ZAI if the selected provider fails.
 */
export async function aiComplete(
  providerId: AiProviderId,
  modelId: string,
  messages: ChatMessage[],
): Promise<AiCompletionResult> {
  const provider = AI_PROVIDERS[providerId];

  // ZAI path (special SDK) — AUDIT-AI-14: Add fallback to first available non-ZAI provider
  if (providerId === 'zai') {
    try {
      const content = await callZai(messages, modelId);
      return { content, provider: 'zai', model: modelId || 'default' };
    } catch (zaiError) {
      const fallback = getAvailableProviders().find(p => p.id !== 'zai');
      if (fallback) {
        safeLog({
          level: 'warn',
          route: 'AI-Provider',
          message: `ZAI failed, falling back to ${fallback.name}`,
          error: zaiError instanceof Error ? zaiError.message : String(zaiError),
        });
        const apiKey = fallback.id === 'lokal_ai'
          ? (process.env[fallback.apiKeyEnvVar] || 'ollama')
          : process.env[fallback.apiKeyEnvVar];
        if (apiKey) {
          try {
            const content = await callOpenAiCompatible(fallback.baseUrl, apiKey, fallback.models[0]?.id || 'default', messages);
            return { content, provider: fallback.id, model: fallback.models[0]?.id || 'default' };
          } catch {
            // fall through to throw original ZAI error
          }
        }
      }
      throw zaiError;
    }
  }

  // OpenAI-compatible path (Groq, OpenAI, together, Tinyfish, Lokal AI)
  // Lokal AI (Ollama) doesn't require an API key
  const apiKey = providerId === 'lokal_ai'
    ? (process.env[provider.apiKeyEnvVar] || 'ollama')
    : process.env[provider.apiKeyEnvVar];
  if (!apiKey) {
    throw new Error(`API key not configured for ${provider.name}. Set ${provider.apiKeyEnvVar} in .env`);
  }

  try {
    const content = await callOpenAiCompatible(provider.baseUrl, apiKey, modelId, messages);
    return { content, provider: providerId, model: modelId };
  } catch (primaryError) {
    safeLog({
      level: 'warn',
      route: 'AI-Provider',
      message: `${provider.name} (${modelId}) failed, falling back to ZAI`,
      error: primaryError instanceof Error ? primaryError.message : String(primaryError),
    });

    // AI-006: Automatic failover to ZAI
    try {
      const content = await callZai(messages, 'default');
      return { content, provider: 'zai', model: 'default' };
    } catch (fallbackError) {
      throw new Error(
        `Primary provider (${provider.name}) failed: ${primaryError instanceof Error ? primaryError.message : String(primaryError)}. ` +
        `Fallback (ZAI) also failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`
      );
    }
  }
}

/**
 * Resolve the active provider/model from DB config.
 * Falls back to 'zai'/'default' if config is invalid or provider unavailable.
 */
export function resolveAiConfig(
  dbProvider?: string | null,
  dbModel?: string | null,
): { provider: AiProviderId; model: string } {
  let provider: AiProviderId = 'zai';
  let model: string = 'default';

  if (dbProvider && dbProvider in AI_PROVIDERS) {
    const pid = dbProvider as AiProviderId;
    if (isProviderAvailable(pid)) {
      provider = pid;
    } else {
      safeLog({
        level: 'warn',
        route: 'AI-Provider',
        message: `Provider ${pid} configured but API key missing, falling back to ZAI`,
      });
    }
  }

  const availableModels = getModelsForProvider(provider);
  if (dbModel && availableModels.some(m => m.id === dbModel)) {
    model = dbModel;
  } else {
    model = availableModels[0]?.id || 'default';
  }

  return { provider, model };
}
