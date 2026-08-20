'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CandlestickChart } from './CandlestickChart';
import { useCandleData } from '@/hooks/use-candle-data';
import { useTradingStore, type TimeframeId } from '@/lib/trading-store';
import { TIMEFRAMES, EXTENDED_PAIR_DISPLAY, EXTENDED_PAIR_PIP_VALUES, PAIR_PIP_VALUES, type ForexPair } from '@/lib/trading-types';
import type { Position } from './shared';

// ============================================================
// Helpers
// ============================================================

function fmtPrice(pair: string, price: number): string {
  const pipInfo = PAIR_PIP_VALUES[pair as ForexPair] ?? EXTENDED_PAIR_PIP_VALUES[pair];
  if (!pipInfo) return price.toFixed(5);
  const decimals = pipInfo.pipSize < 0.001 ? 5 : 3;
  return price.toFixed(decimals);
}

const DISPLAYABLE_TFS = TIMEFRAMES.filter(tf =>
  ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1'].includes(tf)
);

// ============================================================
// Component: ChartPanel
// ============================================================

interface ChartPanelProps {
  /** Optional position to overlay entry/SL/TP lines */
  position?: Position | null;
}

export function ChartPanel({ position }: ChartPanelProps) {
  const selectedPair = useTradingStore(s => s.selectedPair);
  const selectedTimeframe = useTradingStore(s => s.selectedTimeframe);
  const setSelectedTimeframe = useTradingStore(s => s.setSelectedTimeframe);
  const quotes = useTradingStore(s => s.quotes);
  const panelRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(400);

  // Fetch candle data
  const { data, isLoading } = useCandleData(selectedPair, selectedTimeframe);

  // Responsive height
  useEffect(() => {
    if (!panelRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // Chart takes full width and a minimum of 300px height
        const h = Math.max(300, Math.min(600, entry.contentRect.width * 0.5));
        setHeight(h);
      }
    });
    ro.observe(panelRef.current);
    return () => ro.disconnect();
  }, []);

  // Handle timeframe change — syncs with global store
  const handleTimeframeChange = useCallback((tf: string) => {
    setSelectedTimeframe(tf as TimeframeId);
  }, [setSelectedTimeframe]);

  // Current quote for the selected pair
  const quote = quotes[selectedPair];
  const pairDisplay = EXTENDED_PAIR_DISPLAY[selectedPair] || selectedPair;

  // Position overlay lines
  const entryPrice = position?.isOpen ? position.entryPrice : undefined;
  const stopLoss = position?.isOpen ? (position.stopLoss ?? undefined) : undefined;
  const takeProfit = position?.isOpen ? (position.takeProfit ?? undefined) : undefined;

  return (
    <Card className="bg-zinc-900 border-zinc-800">
      {/* Header: pair info + timeframe selector */}
      <CardHeader className="pb-2">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          {/* Left: pair + bid/ask */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold text-zinc-100">{pairDisplay}</span>
              {position?.isOpen && (
                <Badge
                  variant="outline"
                  className={`text-[10px] px-1.5 py-0 ${
                    position.direction === 'BUY'
                      ? 'border-emerald-600/40 text-emerald-400'
                      : 'border-red-600/40 text-red-400'
                  }`}
                >
                  {position.direction} {position.lotSize} lot
                </Badge>
              )}
            </div>
            {quote && (
              <div className="flex items-center gap-3 text-sm">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-zinc-500">BID</span>
                      <span className="font-mono text-zinc-200">{fmtPrice(selectedPair, quote.bid)}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="bg-zinc-800 border-zinc-700 text-zinc-300 text-xs">
                    Spread: {quote.spread.toFixed(1)} pips
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-zinc-500">ASK</span>
                      <span className="font-mono text-zinc-200">{fmtPrice(selectedPair, quote.ask)}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="bg-zinc-800 border-zinc-700 text-zinc-300 text-xs">
                    Spread: {quote.spread.toFixed(1)} pips
                  </TooltipContent>
                </Tooltip>
                <span className={`text-xs font-mono ${quote.changePercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {quote.changePercent >= 0 ? '+' : ''}{quote.changePercent.toFixed(2)}%
                </span>
              </div>
            )}
          </div>

          {/* Right: timeframe selector */}
          <div className="flex items-center gap-0.5 bg-zinc-800/60 rounded-lg p-0.5">
            {DISPLAYABLE_TFS.map((tf) => (
              <button
                key={tf}
                onClick={() => handleTimeframeChange(tf)}
                className={`px-2 py-1 text-[11px] rounded-md transition-colors ${
                  selectedTimeframe === tf
                    ? 'bg-zinc-100 text-zinc-900 font-medium'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>

      {/* Chart body */}
      <CardContent className="pt-0" ref={panelRef}>
        {isLoading ? (
          <Skeleton
            className="w-full rounded-lg"
            style={{ height }}
          />
        ) : (
          <CandlestickChart
            pair={selectedPair}
            data={data}
            height={height}
            entryPrice={entryPrice}
            stopLoss={stopLoss}
            takeProfit={takeProfit}
            onTimeframeChange={handleTimeframeChange}
          />
        )}
      </CardContent>
    </Card>
  );
}
