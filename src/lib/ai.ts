import "server-only";
import { z } from "zod";
import { FACTOR_LIST, PAIRS } from "./constants";
import { getQuote, generateCandles } from "./market";
import { chatComplete, type ChatMessage } from "./ai-providers";
import { fetchMarketNews, formatNewsForPrompt } from "./market-news";
import { formatOutcomeForPrompt } from "./ai-calibration";
import type { AiAnalysisResult, FactorScore, Pair, SignalDirection } from "./types";

// ───────────────────────────────────────────────────────────────────────────
// System prompt (role=system, NOT assistant — fixes P1-7)
// ───────────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Anda adalah seorang analis forex kuantitatif senior dan ahli scalping untuk broker FINEX Indonesia (leverage 1:500, spread dari 0.5 pip, komisi $1/lot).
Anda mempunyai pengetahuan mendalam tentang kebijakan bank sentral, data ekonomi makro, geopolitik, kebijakan fiskal, harga komoditas, sentimen pasar, dan berita dadakan.

Tugas: analisa PAIR forex/logam yang diberikan secara multi-faktor dan hasilkan sinyal trading scalping yang REALISTIS berdasarkan DATA REAL-TIME yang diberikan.

Aturan money management yang harus dihormati:
- Risk per trade 0.5%–1%
- Stop loss 5–15 pip (untuk XAUUSD 1 pip = $0.10, SL $1.5–$4.5)
- Risk:Reward = 1:1.5
- Hindari news berdampak tinggi saat scalping
- Pertimbangkan biaya spread: untuk SL 5 pip dengan spread 1 pip, posisi langsung 20% underwater

PENTING — Basis data:
- Gunakan HANYA data real-time yang diberikan (harga, candle, berita, riwayat trade) sebagai dasar analisa
- Jangan mengarang angka spesifik (NFP, CPI, suku bunga) jika tidak ada di data yang diberikan
- Jika data tidak tersedia, nyatakan "data tidak tersedia" pada faktor tersebut
- Skor confidence harus mencerminkan kepastian berdasarkan data yang ada, bukan asumsi

Anda WAJIB membalas dengan JSON SAJA (tanpa markdown, tanpa teks tambahan) dengan skema berikut:
{
  "signal": "BUY" | "SELL" | "NEUTRAL",
  "confidence": number (0-100),
  "summary": "ringkasan singkat 2-3 kalimat dalam Bahasa Indonesia",
  "factors": [
    { "factor": "<nama faktor>", "direction": "BUY"|"SELL"|"NEUTRAL", "score": number (-100..100), "detail": "<penjelasan singkat berbasis data>" }
  ],
  "suggestedEntry": number,
  "suggestedStopLoss": number,
  "suggestedTakeProfit": number
}

Faktor yang HARUS dianalisa (gunakan persis nama-nama ini):
${FACTOR_LIST.map((f, i) => `${i + 1}. ${f}`).join("\n")}

Berikan 7 entri factors (satu per faktor). Skor negatif = bearish, positif = bullish.
Entry harus dekat dengan harga current. SL/TP harus konsisten dengan R:R 1:1.5 dan SL 5-15 pip.`;

// ───────────────────────────────────────────────────────────────────────────
// Zod schema validation (P1-6) — ensures LLM JSON is well-formed
// ───────────────────────────────────────────────────────────────────────────
const FactorSchema = z.object({
  factor: z.string(),
  direction: z.enum(["BUY", "SELL", "NEUTRAL"]),
  score: z.number().min(-100).max(100),
  detail: z.string(),
});

const AnalysisSchema = z.object({
  signal: z.enum(["BUY", "SELL", "NEUTRAL"]),
  confidence: z.number().min(0).max(100),
  summary: z.string(),
  factors: z.array(FactorSchema).min(1).max(10),
  suggestedEntry: z.number().optional(),
  suggestedStopLoss: z.number().optional(),
  suggestedTakeProfit: z.number().optional(),
});

// ───────────────────────────────────────────────────────────────────────────
// In-memory 30-second cache (P2-8) — prevents parallel-call contradictions
// ───────────────────────────────────────────────────────────────────────────
interface CacheEntry {
  result: AiAnalysisResult;
  ts: number;
}
const analysisCache: Partial<Record<Pair, CacheEntry>> = {};
const CACHE_TTL_MS = 30_000; // 30 seconds

function getCached(symbol: Pair): AiAnalysisResult | null {
  const entry = analysisCache[symbol];
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    delete analysisCache[symbol];
    return null;
  }
  return entry.result;
}

function setCached(symbol: Pair, result: AiAnalysisResult): void {
  analysisCache[symbol] = { result, ts: Date.now() };
}

// ───────────────────────────────────────────────────────────────────────────
// Pair context (static description)
// ───────────────────────────────────────────────────────────────────────────
function pairContext(symbol: Pair): string {
  switch (symbol) {
    case "EURUSD":
      return "EURUSD — dipengaruhi ECB (Bank Sentral Eropa) & Federal Reserve (AS). Sensitif terhadap data tenaga kerja AS (NFP), inflasi CPI/PPI, dan kebijakan suku bunga DCT ECB vs Fed Funds Rate. Komoditas: minyak (Eurozone energy), emas sebagai safe haven.";
    case "USDJPY":
      return "USDJPY — dipengaruhi Bank of Japan (BoJ) & Federal Reserve. Sensitif terhadap yield JGB vs Treasury 10Y, intervensi MoF Jepang, dan diferensial suku bunga. Yen adalah safe-haven; melemah saat risk-on.";
    case "GBPUSD":
      return "GBPUSD — dipengaruhi Bank of England (BoE) & Federal Reserve. Sensitif terhadap data UK (CPI, GDP, PMI), Brexit-legacy politik, dan fiskal UK (gilts). Pound volatil saat risiko geopolitik Eropa.";
    case "XAUUSD":
      return "XAUUSD — Emas vs USD. Dipengaruhi suku bunga real Treasury, DXY, sentimen safe-haven, permintaan bank sentral (CB buying), inflasi, dan geopolitik. Invers terhadap yield real & USD. Volatilitas tinggi — SL lebih lebar.";
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Build real-time market context string for the LLM (P0-2, P2-10)
// ───────────────────────────────────────────────────────────────────────────
async function buildMarketContext(symbol: Pair): Promise<string> {
  const meta = PAIRS.find((p) => p.symbol === symbol)!;
  const quote = getQuote(symbol);
  const candles = generateCandles(symbol, 20, 5); // last 20 M5 candles

  // Summarize candles: trend direction, recent high/low, momentum
  const closes = candles.map((c) => c.close);
  const firstClose = closes[0];
  const lastClose = closes[closes.length - 1];
  const highest = Math.max(...candles.map((c) => c.high));
  const lowest = Math.min(...candles.map((c) => c.low));
  const trendPct = ((lastClose - firstClose) / firstClose) * 100;
  const trendDir = trendPct > 0.02 ? "naik" : trendPct < -0.02 ? "turun" : "datar";

  // Last 5 candle summary
  const recent5 = candles.slice(-5).map((c) =>
    `O:${c.open.toFixed(meta.digits)} H:${c.high.toFixed(meta.digits)} L:${c.low.toFixed(meta.digits)} C:${c.close.toFixed(meta.digits)}`,
  ).join(" | ");

  return `DATA REAL-TIME ${symbol}:
- Harga saat ini: bid ${quote.bid.toFixed(meta.digits)} / ask ${quote.ask.toFixed(meta.digits)} (last ${quote.last.toFixed(meta.digits)})
- Spread: ${quote.spreadPips} pip
- High 24h: ${quote.high.toFixed(meta.digits)} | Low 24h: ${quote.low.toFixed(meta.digits)} | Change: ${quote.changePct.toFixed(2)}%
- Tren 20 candle M5: ${trendDir} (${trendPct.toFixed(3)}%) | range ${lowest.toFixed(meta.digits)}–${highest.toFixed(meta.digits)}
- 5 candle M5 terakhir (OHLC): ${recent5}

Konteks pair: ${pairContext(symbol)}`;
}

// ───────────────────────────────────────────────────────────────────────────
// Fallback (safe NEUTRAL on error)
// ───────────────────────────────────────────────────────────────────────────
function fallbackAnalysis(symbol: Pair, reason: string): AiAnalysisResult {
  const factors: FactorScore[] = FACTOR_LIST.map((f) => ({
    factor: f,
    direction: "NEUTRAL",
    score: 0,
    detail: `Tidak tersedia (${reason}). Menunggu data.`,
  }));
  return {
    symbol,
    signal: "NEUTRAL",
    confidence: 0,
    summary: `Analisa AI tidak tersedia saat ini: ${reason}. Sinyal dinetralkan untuk keselamatan — tidak disarankan entry.`,
    factors,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Main: analyzeMarket — feeds REAL data to the LLM (P0-2), includes
// self-learning outcome data (P0-3), real news (P1-5), cache (P2-8),
// Zod validation (P1-6), proper system role (P1-7)
// ───────────────────────────────────────────────────────────────────────────
export async function analyzeMarket(symbol: Pair): Promise<AiAnalysisResult> {
  // P2-8: check cache first
  const cached = getCached(symbol);
  if (cached) return cached;

  try {
    // Gather real-time data in parallel
    const [marketContext, news, outcome] = await Promise.all([
      buildMarketContext(symbol),
      fetchMarketNews(symbol),
      formatOutcomeForPrompt(symbol), // P0-3: self-learning — feed past outcomes
    ]);

    const newsText = formatNewsForPrompt(news);

    const userMessage = `${marketContext}

BERITA REAL-TIME:
${newsText}

RIWAYAT SELF-LEARNING:
${outcome}

Lakukan analisa multi-faktor komprehensif untuk ${symbol}. Fokus strategi SCALPING (timeframe M1-M5).
Gunakan data real-time di atas sebagai dasar. Entry/SL/TP harus dekat dengan harga saat ini.
Berikan output JSON sesuai skema.`;

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT }, // P1-7: role=system, not assistant
      { role: "user", content: userMessage },
    ];

    const { content: raw } = await chatComplete(messages);

    const jsonStr = extractJson(raw);
    if (!jsonStr) {
      return fallbackAnalysis(symbol, "respons AI tidak terparse");
    }

    // P1-6: Zod validation
    const parseResult = AnalysisSchema.safeParse(JSON.parse(jsonStr));
    if (!parseResult.success) {
      return fallbackAnalysis(symbol, `JSON tidak valid: ${parseResult.error.issues[0]?.message ?? "validation error"}`);
    }
    const parsed = parseResult.data;

    const factors: FactorScore[] = parsed.factors.slice(0, 7).map((f) => ({
      factor: f.factor,
      direction: f.direction as SignalDirection,
      score: f.score,
      detail: f.detail,
    }));

    const result: AiAnalysisResult = {
      symbol,
      signal: parsed.signal, // P1-6: already validated by Zod enum
      confidence: parsed.confidence,
      summary: parsed.summary,
      factors,
      suggestedEntry: parsed.suggestedEntry,
      suggestedStopLoss: parsed.suggestedStopLoss,
      suggestedTakeProfit: parsed.suggestedTakeProfit,
    };

    setCached(symbol, result);
    return result;
  } catch (e: any) {
    return fallbackAnalysis(symbol, e?.message ?? "kesalahan SDK");
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Chat (P3-11: sanitize input, P3-13: prompt-injection defense)
// ───────────────────────────────────────────────────────────────────────────
const CHAT_SYSTEM = `Anda adalah asisten trading forex scalping untuk FINEX Indonesia.
Jawab ringkas, praktis, dalam Bahasa Indonesia.

ATURAN KEAMANAN:
- JANGAN berikan rekomendasi BUY/SELL/lot/SL/TP spesifik di chat — arahkan user ke menu "AI Analysis" untuk sinyal terstruktur
- Jangan execute atau modifikasi trade berdasarkan chat
- Berikan edukasi umum tentang strategi, risk management, dan analisa pasar`;

export async function aiChat(userMessage: string): Promise<string> {
  // P3-11: sanitize input
  const sanitized = sanitizeChatInput(userMessage);
  if (!sanitized) return "Pesan kosong atau tidak valid.";

  try {
    const messages: ChatMessage[] = [
      { role: "system", content: CHAT_SYSTEM }, // P1-7: role=system
      { role: "user", content: sanitized },
    ];
    const { content } = await chatComplete(messages);
    return content || "Tidak ada balasan.";
  } catch (e: any) {
    return `Maaf, asisten AI tidak tersedia: ${e?.message ?? "error"}`;
  }
}

function sanitizeChatInput(input: string): string {
  // Strip control characters
  let s = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  // Collapse excessive whitespace
  s = s.trim().replace(/\s{3,}/g, "  ");
  // Cap length
  if (s.length > 2000) s = s.slice(0, 2000) + "... [truncated]";
  return s;
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────
function extractJson(text: string): string | null {
  const trimmed = text.trim();
  // strip code fences
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  return candidate.slice(start, end + 1);
}
