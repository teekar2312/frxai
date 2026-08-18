'use client';

import {
  LayoutDashboard, Brain, Zap, Activity, Shield, Bell,
  History, FileText, Settings, TrendingUp, TrendingDown,
} from 'lucide-react';
import type { ForexPair, StrategyName, TradingDirection } from '@/lib/trading-types';

// ============================================================
// Local type definitions for API responses
// ============================================================

export interface ActivityLogEntry {
  id: string;
  level: string;
  category: string;
  message: string;
  pair: string | null;
  details: string | null;
  metadata: string | null;
  createdAt: string;
}

export interface Position {
  id: string;
  pair: ForexPair;
  direction: TradingDirection;
  lotSize: number;
  entryPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  currentPrice: number;
  pnl: number;
  pips: number;
  strategy: StrategyName | null;
  trailingStop: boolean;
  trailingPips: number;
  isOpen: boolean;
  openedAt: string;
  closedAt: string | null;
}

export interface PriceAlert {
  id: string;
  pair: ForexPair;
  condition: 'above' | 'below' | 'crosses_above' | 'crosses_below';
  targetPrice: number;
  currentPrice?: number | null;
  isActive: boolean;
  isTriggered: boolean;
  triggeredAt: string | null;
  note?: string | null;
  emailNotify: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface TradingConfig {
  id: string;
  riskPerTrade: number;
  stopLossMin: number;
  stopLossMax: number;
  riskRewardRatio: number;
  maxOpenPositions: number;
  dailyRiskLimit: number;
  dailyTargetMin: number;
  dailyTargetMax: number;
  leverage: number;
  spreadPip: number;
  commissionPerLot: number;
  marginCallLevel: number;
  stopOutLevel: number;
  autoTrading: boolean;
  autoTrailingStop: boolean;
  trailingStopPips: number;
  avoidNewsTrading: boolean;
  accountBalance: number;
  aiProvider: string;  // AI-006
  aiModel: string;     // AI-006
  // Email notification settings
  notifyEmail: string | null;
  emailOnPositionOpen: boolean;
  emailOnPositionClose: boolean;
  emailOnAlertTrigger: boolean;
  // FE-019: Lot size constraints from server config
  minLot: number;
  maxLotPerOrder: number;
}

export interface EquityPoint {
  time: string;
  equity: number;
  balance: number;
}

// ============================================================
// Navigation items for sidebar
// NOTE: Labels are intentionally kept in English as they represent
// standard trading/technical terms. Indonesian translations are
// provided contextually in other parts of the UI (e.g., error pages,
// regulatory disclaimers, and accessible labels).
// ============================================================

export const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, emoji: '📊' },
  { id: 'ai-analysis', label: 'AI Analysis', icon: Brain, emoji: '🤖' },
  { id: 'trading-signals', label: 'Trading Signals', icon: Zap, emoji: '📈' },
  { id: 'live-trading', label: 'Live Trading', icon: Activity, emoji: '💹' },
  { id: 'risk-management', label: 'Risk Management', icon: Shield, emoji: '🛡️' },
  { id: 'price-alerts', label: 'Price Alerts', icon: Bell, emoji: '🔔' },
  { id: 'backtesting', label: 'Backtesting', icon: History, emoji: '⏪' },
  { id: 'activity-log', label: 'Activity Log', icon: FileText, emoji: '📋' },
  { id: 'settings', label: 'Settings', icon: Settings, emoji: '⚙️' },
] as const;

// Strategy descriptions for reference
// FIX STRATEGY-008: Corrected strategy descriptions to match actual implementations
export const STRATEGY_DESCS: Record<StrategyName, string> = {
  MA_RIBBON: 'Uses multiple moving averages (5/9/21/50 EMA) to identify trend direction and momentum. Best in trending markets.',
  MOMENTUM_SCALPING: 'Combines RSI, Momentum, and MACD histogram for quick scalping entries. Best during high-volume sessions.',
  PIVOT_POINT: 'Uses daily pivot points with support/resistance levels (R1-R3, S1-S3). Works well in range-bound markets.',
  EMA_CROSSOVER: 'Fast EMA (9) / Slow EMA (21) crossover with trend continuation detection. Good for swing trading.',
  RMI_TREND_SYNC: 'Schaff Trend Cycle (STC) synced with Supertrend direction for noise-filtered entries in volatile markets.',
  LINEAR_REGRESSION: 'Linear regression channel with 2σ bands for mean reversion at channel boundaries. Best in ranging markets.',
  EMA_RSI_FILTER: 'EMA trend detection (9/21) filtered by RSI (40-70 buy zone, 30-60 sell zone). Reduces false signals.',
};

// ============================================================
// Format helpers
// ============================================================

export const fmtPrice = (pair: ForexPair, price: number) => {
  const decimals = pair === 'XAUUSD' || pair === 'USDJPY' ? 3 : 5;
  return price.toFixed(decimals);
};

export const fmtChange = (change: number) => {
  const sign = change >= 0 ? '+' : '';
  return `${sign}${change.toFixed(2)}%`;
};
