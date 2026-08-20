'use client';

import { useEffect, useRef, useCallback } from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type Time,
  type HistogramData,
} from 'lightweight-charts';
import type { CandleData } from '@/lib/trading-types';
import { TIMEFRAMES } from '@/lib/trading-types';
import { Skeleton } from '@/components/ui/skeleton';

interface CandlestickChartProps {
  pair: string;
  data: CandleData[];
  height?: number;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  onTimeframeChange?: (tf: string) => void;
}

const PAIR_COLORS: Record<string, string> = {
  EURUSD: '#3b82f6',
  USDJPY: '#f97316',
  GBPUSD: '#a855f7',
  XAUUSD: '#eab308',
};

export function CandlestickChart({
  pair,
  data,
  height = 400,
  entryPrice,
  stopLoss,
  takeProfit,
  onTimeframeChange,
}: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  // Create chart
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#a1a1aa',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(63, 63, 70, 0.3)' },
        horzLines: { color: 'rgba(63, 63, 70, 0.3)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#71717a', width: 1, style: 2 },
        horzLine: { color: '#71717a', width: 1, style: 2 },
      },
      rightPriceScale: {
        borderColor: '#3f3f46',
        scaleMargins: { top: 0.1, bottom: 0.25 },
      },
      timeScale: {
        borderColor: '#3f3f46',
        timeVisible: true,
        secondsVisible: false,
      },
      width: containerRef.current.clientWidth,
      height,
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderDownColor: '#ef4444',
      borderUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      wickUpColor: '#22c55e',
    });

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });

    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    // Resize observer
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        chart.applyOptions({ width: entry.contentRect.width });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [height]);

  // Update data
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || !data.length) return;

    const candles: CandlestickData[] = data.map((d) => ({
      time: d.time as Time,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));

    const volumes: HistogramData[] = data.map((d) => ({
      time: d.time as Time,
      value: d.volume,
      color: d.close >= d.open
        ? 'rgba(34, 197, 94, 0.3)'
        : 'rgba(239, 68, 68, 0.3)',
    }));

    candleSeriesRef.current.setData(candles);
    volumeSeriesRef.current.setData(volumes);
  }, [data]);

  // Add price level lines
  useEffect(() => {
    if (!candleSeriesRef.current) return;
    const levels: { price: number; color: string; lineWidth: number; lineStyle: number; title: string }[] = [];
    if (entryPrice) levels.push({ price: entryPrice, color: '#3b82f6', lineWidth: 1, lineStyle: 2, title: 'Entry' });
    if (stopLoss) levels.push({ price: stopLoss, color: '#ef4444', lineWidth: 1, lineStyle: 2, title: 'SL' });
    if (takeProfit) levels.push({ price: takeProfit, color: '#22c55e', lineWidth: 1, lineStyle: 2, title: 'TP' });

    for (const lvl of levels) {
      try {
        candleSeriesRef.current.createPriceLine(lvl);
      } catch { /* price line may already exist */ }
    }
  }, [entryPrice, stopLoss, takeProfit]);

  const handleTimeframe = useCallback((tf: string) => {
    onTimeframeChange?.(tf);
  }, [onTimeframeChange]);

  const pairColor = PAIR_COLORS[pair] || '#3b82f6';

  if (!data.length) {
    return <Skeleton className="w-full rounded-lg" style={{ height }} />;
  }

  return (
    <div className="space-y-2">
      {/* Header with pair and timeframe selector */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: pairColor }} />
          <span className="text-sm font-medium text-zinc-200">{pair}</span>
          <span className="text-xs text-zinc-500">OHLCV</span>
        </div>
        <div className="flex items-center gap-1">
          {TIMEFRAMES.filter(tf => ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1'].includes(tf)).map((tf) => (
            <button
              key={tf}
              onClick={() => handleTimeframe(tf)}
              className="px-1.5 py-0.5 text-[10px] rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              {tf}
            </button>
          ))}
        </div>
      </div>
      {/* Chart container */}
      <div ref={containerRef} className="w-full rounded-lg overflow-hidden" />
    </div>
  );
}