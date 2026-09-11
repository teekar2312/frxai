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

// Provider configurations: endpoint, models (fallback list), and which ApiKeys field holds the key
// Multiple models per provider — if one is deprecated/404, the next is tried automatically.
const PROVIDER_CONFIG: Record<string, { url: string; models: string[]; keyField: keyof ApiKeys; label: string }> = {
  groq: {
    url: "https://api.groq.com/openai/v1/chat/completions",
    models: [
      "llama-3.1-8b-instant",
      "llama3-8b-8192",
      "llama3-70b-8192",
      "gemma2-9b-it",
      "deepseek-r1-distill-llama-70b",
    ],
    keyField: "groq",
    label: "Groq",
  },
  openai: {
    url: "https://api.openai.com/v1/chat/completions",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-3.5-turbo"],
    keyField: "openai",
    label: "OpenAI",
  },
  together: {
    url: "https://api.together.xyz/v1/chat/completions",
    models: [
      "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
      "meta-llama/Meta-Llama-3-70B-Instruct-Turbo",
    ],
    keyField: "together",
    label: "Together.ai",
  },
  tinyfish: {
    url: "https://sdk.tinyfish.ai/v1/chat/completions",
    models: ["llama-3.3-70b", "llama-3.1-70b"],
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

  // Try each model in order — if one returns 404 model_not_found, try the next
  let lastError: any = null;
  for (const model of cfg.models) {
    try {
      const res = await fetch(cfg.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          temperature: 0.7,
          max_tokens: 2000,
        }),
        signal: AbortSignal.timeout(55_000),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        // If model is not found / decommissioned / deprecated, try next model
        const modelUnavailable =
          res.status === 404 ||
          res.status === 400 ||
          errText.includes("model_not_found") ||
          errText.includes("does not exist") ||
          errText.includes("decommissioned") ||
          errText.includes("deprecated") ||
          errText.includes("no longer supported");
        if (modelUnavailable) {
          lastError = new Error(`${cfg.label} model '${model}' unavailable (${res.status}), trying next...`);
          continue; // try next model
        }
        // For other errors (401, 429, 500), throw immediately
        throw new Error(`${cfg.label} API ${res.status}: ${errText.slice(0, 200)}`);
      }

      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content ?? "";
      if (!content) throw new Error(`${cfg.label} returned empty response`);

      return { content, provider };
    } catch (e: any) {
      // If it's a model unavailable that we already handled (continue), skip
      if (e?.message?.includes("unavailable") || e?.message?.includes("not found")) {
        lastError = e;
        continue;
      }
      // For other errors, throw immediately
      throw e;
    }
  }

  // All models failed
  throw lastError ?? new Error(`${cfg.label}: all models failed`);
}
