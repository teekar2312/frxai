'use client';

import React, { useMemo } from 'react';
import { TrendingUp, ChevronRight, Cable } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useTradingStore } from '@/lib/trading-store';
import { NAV_ITEMS } from './shared';

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const {
    activeTab, setActiveTab,
    accountBalance,
    dailyPnl, openPositionsCount,
    tradingMode, mt5ConnectionStatus, mt5AccountInfo, mt5Positions,
  } = useTradingStore();

  // H2: Compute MT5-aware sidebar values
  const isMt5Live = tradingMode === 'mt5_live';
  const displayPnl = useMemo(() => {
    if (isMt5Live && mt5AccountInfo) return mt5AccountInfo.profit;
    return dailyPnl;
  }, [isMt5Live, mt5AccountInfo, dailyPnl]);

  const displayPositionCount = useMemo(() => {
    if (isMt5Live) return mt5Positions.length;
    return openPositionsCount;
  }, [isMt5Live, mt5Positions.length, openPositionsCount]);

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="p-4 border-b border-zinc-700/50">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-sm text-white">FINEX Indonesia</h1>
            <p className="text-[10px] text-zinc-400">Platform Trading AI</p>
          </div>
        </div>
      </div>

      {/* Account summary in sidebar */}
      <div className="p-3 border-b border-zinc-700/50">
        <div className="bg-zinc-800/80 rounded-lg p-3 space-y-2">
          {isMt5Live && (
            <div className="flex items-center gap-2 mb-1">
              <Cable className={`w-3 h-3 ${mt5ConnectionStatus === 'connected' ? 'text-amber-400' : 'text-amber-400/50'}`} />
              <span className={`text-[10px] font-medium ${mt5ConnectionStatus === 'connected' ? 'text-amber-400' : 'text-amber-400/70'}`}>
                MT5 {mt5ConnectionStatus === 'connected' ? 'LIVE' : 'Standby'}
              </span>
            </div>
          )}
          <div className="flex justify-between text-xs">
            <span className="text-zinc-400">Balance</span>
            <span className="text-white font-mono font-medium">
              {isMt5Live && mt5AccountInfo
                ? `${mt5AccountInfo.currency} ${mt5AccountInfo.balance.toLocaleString()}`
                : `$${accountBalance.toLocaleString()}`}
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-zinc-400">Daily P&L</span>
            <span className={`font-mono font-medium ${displayPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {displayPnl >= 0 ? '+' : ''}{displayPnl.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-zinc-400">Open Positions</span>
            <span className="text-white font-mono font-medium">{displayPositionCount}</span>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 py-2">
        <nav className="space-y-0.5 px-2">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  onNavigate?.();
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                  isActive
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                    : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 border border-transparent'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
                {isActive && <ChevronRight className="w-3 h-3 ml-auto shrink-0" />}
              </button>
            );
          })}
        </nav>
      </ScrollArea>

      {/* Footer in sidebar */}
      <div className="p-3 border-t border-zinc-700/50 space-y-1">
        <div className="text-[10px] text-zinc-500 text-center">
          © {new Date().getFullYear()} FINEX Indonesia
        </div>
        <div className="text-[9px] text-zinc-600 text-center leading-tight">
          Terdaftar di BAPPEBTI
        </div>
      </div>
    </div>
  );
}
