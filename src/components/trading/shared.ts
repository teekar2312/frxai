'use client';

import {
  LayoutDashboard, Brain, Zap, Activity, Shield, Bell,
  History, FileText, Settings, TrendingUp,
  BarChart3, CalendarDays, ListTodo, Users, Share2, Eye,
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
  marketCondition?: string | null;
  aiConfidence?: number | null;
  riskLevel?: string | null;
  aiRecommendation?: string | null;
  riskAmount?: number | null;
  rewardAmount?: number | null;
  trailingStop: number | null;
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
  aiProvider: string;
  aiModel: string;
  notifyEmail: string | null;
  emailOnPositionOpen: boolean;
  emailOnPositionClose: boolean;
  emailOnAlertTrigger: boolean;
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
// ============================================================

export const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { id: 'chart', label: 'Charts', labelKey: 'nav.charts', icon: TrendingUp },
  { id: 'ai-analysis', label: 'AI Analysis', labelKey: 'nav.aiAnalysis', icon: Brain },
  { id: 'trading-signals', label: 'Trading Signals', labelKey: 'nav.tradingSignals', icon: Zap },
  { id: 'live-trading', label: 'Live Trading', labelKey: 'nav.liveTrading', icon: Activity },
  { id: 'pending-orders', label: 'Pending Orders', labelKey: 'nav.pendingOrders', icon: ListTodo },
  { id: 'risk-management', label: 'Risk Management', labelKey: 'nav.riskManagement', icon: Shield },
  { id: 'price-alerts', label: 'Price Alerts', labelKey: 'nav.priceAlerts', icon: Bell },
  { id: 'economic-calendar', label: 'Economic Calendar', labelKey: 'nav.economicCalendar', icon: CalendarDays },
  { id: 'trade-analytics', label: 'Analytics', labelKey: 'nav.analytics', icon: BarChart3 },
  { id: 'backtesting', label: 'Backtesting', labelKey: 'nav.backtesting', icon: History },
  { id: 'correlation', label: 'Correlation', labelKey: 'nav.correlation', icon: Share2 },
  { id: 'watchlist', label: 'Watchlist', labelKey: 'nav.watchlist', icon: Eye },
  { id: 'signal-sharing', label: 'Community', labelKey: 'nav.community', icon: Users },
  { id: 'activity-log', label: 'Activity Log', labelKey: 'nav.activityLog', icon: FileText },
  { id: 'settings', label: 'Settings', labelKey: 'nav.settings', icon: Settings },
] as const;

// Strategy descriptions for reference
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
