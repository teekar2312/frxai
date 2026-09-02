// ============================================
// OpenAI-Compatible Provider Base
// Groq, OpenAI, Together.ai, and Tinyfish all use
// the OpenAI chat completions API format.
// ============================================

import type {
  AiChatRequest,
  AiChatResponse,
  AiProviderConfigData,
  AiProviderId,
  AiProviderTestResult,
} from './types'

/**
 * Call any OpenAI-compatible API (Groq, OpenAI, Together, Tinyfish).
 * Returns a unified AiChatResponse.
 */
export async function callOpenAiCompat(
  config: AiProviderConfigData,
  request: AiChatRequest,
): Promise<AiChatResponse> {
  const baseUrl = config.baseUrl.replace(/\/+$/, '')
  const model = request.model || config.model
  const url = `${baseUrl}/chat/completions`

  const body: Record<string, unknown> = {
    model,
    messages: request.messages,
    temperature: request.temperature ?? config.temperature,
    max_tokens: request.maxTokens ?? config.maxTokens,
    top_p: request.topP ?? config.topP,
    frequency_penalty: request.frequencyPenalty ?? config.frequencyPenalty,
    presence_penalty: request.presencePenalty ?? config.presencePenalty,
  }

  // JSON mode for structured analysis
  if (request.jsonMode) {
    body.response_format = { type: 'json_object' }
  }

  const start = performance.now()
  const timeout = request.maxTokens ? 120000 : config.timeoutMs

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    const latencyMs = Math.round(performance.now() - start)

    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      throw new Error(
        `Provider ${config.provider} returned ${res.status}: ${errBody.slice(0, 300)}`,
      )
    }

    const data = await res.json()
    const choice = data.choices?.[0]
    const usage = data.usage || {}

    return {
      content: choice?.message?.content || '',
      model: data.model || model,
      provider: config.provider as AiProviderId,
      usage: {
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: usage.completion_tokens || 0,
        totalTokens: usage.total_tokens || 0,
      },
      latencyMs,
      finishReason: choice?.finish_reason || 'stop',
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Test a provider connection with a minimal request.
 */
export async function testOpenAiCompat(
  config: AiProviderConfigData,
): Promise<AiProviderTestResult> {
  const testRequest: AiChatRequest = {
    messages: [
      {
        role: 'user',
        content: 'Respond with only: OK',
      },
    ],
    maxTokens: 10,
    temperature: 0,
  }

  const start = performance.now()

  try {
    const response = await callOpenAiCompat(config, testRequest)
    const latencyMs = Math.round(performance.now() - start)

    return {
      success: true,
      latencyMs,
      model: response.model,
      response: response.content,
    }
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start)
    return {
      success: false,
      latencyMs,
      model: config.model,
      response: '',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
