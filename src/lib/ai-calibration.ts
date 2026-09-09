import "server-only";
import { db } from "./db";
import type { Pair } from "./types";

export interface CalibrationStats {
  totalSignals: number;
  wins: number;
  losses: number;
  winRate: number; // 0-100
  avgPips: number;
  netPips: number;
  calibrated: boolean;
}

/**
 * Compute AI signal calibration stats for a given pair.
 * Looks at closed trades with source="AI" for this pair.
 * Used to display "45% win rate over last 50 signals" in the UI,
 * and to feed past-outcome data into the LLM prompt (self-learning).
 */
export async function getCalibration(pair: Pair, lookback = 50): Promise<CalibrationStats> {
  const trades = await db.trade.findMany({
    where: { source: "AI", status: "CLOSED", symbol: pair },
    orderBy: { closedAt: "desc" },
    take: lookback,
  });

  const total = trades.length;
  if (total === 0) {
    return { totalSignals: 0, wins: 0, losses: 0, winRate: 0, avgPips: 0, netPips: 0, calibrated: false };
  }

  const wins = trades.filter((t) => t.pnl > 0).length;
  const losses = trades.filter((t) => t.pnl < 0).length;
  const winRate = (wins / total) * 100;
  const netPips = trades.reduce((s, t) => s + (t.pips ?? 0), 0);
  const avgPips = netPips / total;

  return {
    totalSignals: total,
    wins,
    losses,
    winRate: +winRate.toFixed(1),
    avgPips: +avgPips.toFixed(1),
    netPips: +netPips.toFixed(1),
    calibrated: total >= 5, // need at least 5 to be "calibrated"
  };
}

/**
 * Format recent AI trade outcomes for inclusion in the LLM prompt (self-learning).
 * Example: "Sinyal AI EURUSD 10 trade terakhir: 4 win, 6 loss, avg -2.3 pips, win rate 40%."
 */
export async function formatOutcomeForPrompt(pair: Pair): Promise<string> {
  const stats = await getCalibration(pair, 10);
  if (stats.totalSignals === 0) {
    return "Belum ada riwayat trade AI untuk pair ini.";
  }
  return `Riwayat ${stats.totalSignals} trade AI terakhir di ${pair}: ${stats.wins} win, ${stats.losses} loss, win rate ${stats.winRate}%, avg ${stats.avgPips >= 0 ? "+" : ""}${stats.avgPips} pips, net ${stats.netPips >= 0 ? "+" : ""}${stats.netPips} pips. Gunakan data ini untuk menyesuaikan confidence.`;
}
