
// AUDIT-AI-G2: Optional AI-powered sentiment enhancement
// Falls back to keyword-based sentiment when AI is unavailable
import { aiComplete, resolveAiConfig } from './ai-provider';
import { db } from './db';
import { safeLog } from './safe-log';

export async function enhanceSentimentWithAI(
  title: string,
  description: string,
  fallbackSentiment: string,
): Promise<string> {
  try {
    const config = await db.tradingConfig.findFirst();
    const { provider, model } = resolveAiConfig(config?.aiProvider, config?.aiModel);
    const result = await aiComplete(provider, model, [
      { role: 'system', content: 'You are a forex news sentiment analyzer. Respond with ONLY one word: positive, negative, or neutral.' },
      { role: 'user', content: `Title: ${title}\nDescription: ${(description || '').slice(0, 200)}` },
    ]);
    // AUDIT-AI-20: Use regex to extract sentiment from potentially verbose responses
    const cleaned = result.content.trim().toLowerCase();
    const match = cleaned.match(/\b(positive|negative|neutral)\b/);
    if (match) return match[1];
  } catch (err) {
    safeLog({ level: 'warn', route: 'News', message: 'AI sentiment enhancement failed, using keyword fallback', error: err instanceof Error ? err.message : String(err) });
  }
  return fallbackSentiment;
}
