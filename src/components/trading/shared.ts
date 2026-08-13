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
  isActive: boolean;
  isTriggered: boolean;
  triggeredAt: string | null;
  emailNotify: boolean;
  createdAt: string;
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
export const STRATEGY_DESCS: Record<StrategyName, string> = {
  MA_RIBBON: 'Uses multiple moving averages (5/10/20/50 EMA) to identify trend direction and momentum. Best in trending markets.',
  MOMENTUM_SCALPING: 'Combines RSI, Stochastic, and MACD for quick scalping entries. Best during high-volume sessions.',
  PIVOT_POINT: 'Uses daily pivot points with support/resistance levels. Works well in range-bound markets.',
  EMA_CROSSOVER: 'Fast EMA (9) / Slow EMA (21) crossover with RSI confirmation. Good for swing trading.',
  RMI_TREND_SYNC: 'Relative Momentum Index synced with Supertrend and EMA. Filters noise in volatile markets.',
  LINEAR_REGRESSION: 'Linear regression channel with Bollinger Bands for mean reversion. Best in ranging markets.',
  EMA_RSI_FILTER: 'EMA trend detection filtered by RSI overbought/oversold zones. Reduces false signals.',
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
