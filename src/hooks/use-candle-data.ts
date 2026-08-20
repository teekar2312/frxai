'use client';

/* eslint-disable react-hooks/set-state-in-effect */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { ForexPair, CandleData } from '@/lib/trading-types';
import { toFinnhubResolution } from '@/lib/trading-types';

const PAIR_SYMBOL: Record<ForexPair, string> = {
  EURUSD: 'OANDA:EUR_USD',
  USDJPY: 'OANDA:USD_JPY',
  GBPUSD: 'OANDA:GBP_USD',
  XAUUSD: 'OANDA:XAU_USD',
};

export function useCandleData(pair: ForexPair, timeframe: string) {
  const [data, setData] = useState<CandleData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const symbol = PAIR_SYMBOL[pair];
      const resolution = toFinnhubResolution(timeframe);
      const res = await globalThis.fetch(`/api/finnhub?type=candles&symbol=${symbol}&resolution=${resolution}&count=200`);
      if (res.ok) {
        const json = await res.json();
        if (json.candles && Array.isArray(json.candles)) {
          setData(json.candles);
          return;
        }
      }
    } catch {
      // ignore
    }
    setIsLoading(false);
  }, [pair, timeframe]);

  useEffect(() => {
    setData([]);
    setIsLoading(true);
    fetchData();
    intervalRef.current = setInterval(fetchData, 30000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchData]);

  // Pause when tab hidden
  useEffect(() => {
    const handler = () => {
      if (document.hidden) {
        if (intervalRef.current) clearInterval(intervalRef.current);
      } else {
        fetchData();
        intervalRef.current = setInterval(fetchData, 30000);
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [fetchData]);

  return { data, isLoading, refetch: fetchData };
}
