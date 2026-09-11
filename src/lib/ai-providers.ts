import "server-only";
import ZAI from "z-ai-web-dev-sdk";
import type { ApiKeys } from "./types";
import { getConfig } from "./server-config";
import { log } from "./server-config";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  content: string;
  provider: string;
}

/**
 * Multi-provider LLM chat completion.
 *
 * Provider selection:
 * - "zai" (default): uses z-ai-web-dev-sdk (always available, no key needed)
 * - "groq": OpenAI-compatible API at https://api.groq.com/openai/v1/chat/completions
 * - "openai": https://api.openai.com/v1/chat/completions
 * - "together": https://api.together.xyz/v1/chat/completions
 * - "tinyfish": https://sdk.tinyfish.ai/v1/chat/completions
 *
 * All non-Z.ai providers use the OpenAI-compatible chat completions format via fetch.
 */
export async function chatComplete(
  messages: ChatMessage[],
  opts: { thinking?: boolean } = {},
): Promise<ChatResult> {
  const keys = await getConfig<ApiKeys>("apiKeys", {
    groq: "", openai: "", together: "", tinyfish: "",
    finnhub: "", marketaux: "", activeProvider: "zai",
  });

  const provider = keys.activeProvider ?? "zai";

  // Z.ai (default, always available)
  if (provider === "zai" || !keys[provider as keyof ApiKeys]) {
    return chatViaZai(messages, opts);
  }

  try {
    return await chatViaOpenAICompatible(provider, keys, messages);
  } catch (e: any) {
    // Fallback to Z.ai if the selected provider fails
    await log("WARN", "AI-PROVIDER", `Provider ${provider} failed: ${e?.message ?? e} — falling back to Z.ai`);
    return chatViaZai(messages, opts);
  }
}

async function chatViaZai(messages: ChatMessage[], opts: { thinking?: boolean }): Promise<ChatResult> {
  const zai = await ZAI.create();
  const completion = await zai.chat.completions.create({
    messages: messages as any,
    thinking: { type: opts.thinking ? "enabled" : "disabled" },
  });
  return {
    content: completion.choices[0]?.message?.content ?? "",
    provider: "zai",
  };
}

// Provider configurations: endpoint, model, and which ApiKeys field holds the key
// Model names verified as of 2025-09. If a model is deprecated, the fallback
// to Z.ai ensures the system still works.
const PROVIDER_CONFIG: Record<string, { url: string; model: string; keyField: keyof ApiKeys; label: string }> = {
  groq: {
    url: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.1-8b-instant", // fast, always-available model
    keyField: "groq",
    label: "Groq",
  },
  openai: {
    url: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o-mini",
    keyField: "openai",
    label: "OpenAI",
  },
  together: {
    url: "https://api.together.xyz/v1/chat/completions",
    model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    keyField: "together",
    label: "Together.ai",
  },
  tinyfish: {
    url: "https://sdk.tinyfish.ai/v1/chat/completions",
    model: "llama-3.3-70b",
    keyField: "tinyfish",
    label: "Tinyfish",
  },
};

async function chatViaOpenAICompatible(
  provider: string,
  keys: ApiKeys,
  messages: ChatMessage[],
): Promise<ChatResult> {
  const cfg = PROVIDER_CONFIG[provider];
  if (!cfg) throw new Error(`Unknown provider: ${provider}`);

  const apiKey = keys[cfg.keyField] as string;
  if (!apiKey) throw new Error(`No API key for ${cfg.label}`);

  const res = await fetch(cfg.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: 0.7,
      max_tokens: 2000,
    }),
    signal: AbortSignal.timeout(55_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`${cfg.label} API ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? "";
  if (!content) throw new Error(`${cfg.label} returned empty response`);

  return { content, provider };
}
