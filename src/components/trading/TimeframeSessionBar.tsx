'use client';

import React from 'react';
import {
  Clock, Timer, ChevronDown, Sun,
} from 'lucide-react';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { TRADING_SESSIONS } from '@/lib/trading-types';
import { useTradingStore, type TimeframeId, type TradingSessionId } from '@/lib/trading-store';

// ============================================================
// Timeframe definitions with grouping
// ============================================================

interface TimeframeOption {
  id: TimeframeId;
  label: string;
  group: string;
  seconds: number;
}

const TIMEFRAME_OPTIONS: TimeframeOption[] = [
  { id: 'M1',  label: '1m',   group: 'Menit',  seconds: 60 },
  { id: 'M2',  label: '2m',   group: 'Menit',  seconds: 120 },
  { id: 'M5',  label: '5m',   group: 'Menit',  seconds: 300 },
  { id: 'M15', label: '15m',  group: 'Menit',  seconds: 900 },
  { id: 'M30', label: '30m',  group: 'Menit',  seconds: 1800 },
  { id: 'H1',  label: '1H',   group: 'Jam',    seconds: 3600 },
  { id: 'H4',  label: '4H',   group: 'Jam',    seconds: 14400 },
  { id: 'D1',  label: '1D',   group: 'Hari+',  seconds: 86400 },
  { id: 'W1',  label: '1W',   group: 'Hari+',  seconds: 604800 },
];

const TIMEFRAME_GROUPS = ['Menit', 'Jam', 'Hari+'] as const;

const SESSION_OPTIONS: { id: TradingSessionId; label: string; icon: string }[] = [
  { id: 'all',       label: 'Semua Sesi',      icon: '🌍' },
  { id: 'Sydney',    label: 'Sydney',           icon: '🦘' },
  { id: 'Tokyo',     label: 'Tokyo',            icon: '🗼' },
  { id: 'London',    label: 'London',           icon: '🎡' },
  { id: 'New York',  label: 'New York',         icon: '🗽' },
];

// ============================================================
// Session helper
// ============================================================

function getSessionInfo(currentHourWib: number) {
  return TRADING_SESSIONS.map((s) => {
    let isActive = false;
    if (s.startHour <= s.endHour) {
      isActive = currentHourWib >= s.startHour && currentHourWib < s.endHour;
    } else {
      isActive = currentHourWib >= s.startHour || currentHourWib < s.endHour;
    }
    return { ...s, isActive };
  });
}

// ============================================================
// Main component
// ============================================================

export function TimeframeSessionBar() {
  const {
    selectedTimeframe, setSelectedTimeframe,
    selectedSession, setSelectedSession,
  } = useTradingStore();

  // Compute current WIB hour for session status (updates every minute)
  const [nowWib, setNowWib] = React.useState(() => {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
    return now.getHours() + now.getMinutes() / 60;
  });

  React.useEffect(() => {
    const id = setInterval(() => {
      const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
      setNowWib(now.getHours() + now.getMinutes() / 60);
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const sessions = getSessionInfo(nowWib);

  const selectedTf = TIMEFRAME_OPTIONS.find(t => t.id === selectedTimeframe);
  const selectedSess = SESSION_OPTIONS.find(s => s.id === selectedSession);

  // Count active sessions
  const activeSessionNames = sessions.filter(s => s.isActive).map(s => s.name);

  return (
    <div className="flex items-center gap-2 px-4 lg:px-6 py-2 bg-zinc-900/80 border-b border-zinc-800 shrink-0 overflow-x-auto">
      {/* Timeframe selector */}
      <div className="flex items-center gap-1.5 shrink-0">
        <Timer className="w-3.5 h-3.5 text-zinc-500" />
        <Popover>
          <PopoverTrigger asChild>
            <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-800 border border-zinc-700 hover:border-zinc-600 transition-colors text-xs text-white font-medium min-w-[60px] justify-center">
              {selectedTf?.label || 'H1'}
              <ChevronDown className="w-3 h-3 text-zinc-400" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2 bg-zinc-900 border-zinc-700" align="start">
            {TIMEFRAME_GROUPS.map((group) => (
              <div key={group} className="mb-2 last:mb-0">
                <p className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider px-2 py-1">{group}</p>
                <div className="grid grid-cols-3 gap-0.5">
                  {TIMEFRAME_OPTIONS.filter(t => t.group === group).map((tf) => (
                    <button
                      key={tf.id}
                      onClick={() => setSelectedTimeframe(tf.id)}
                      className={`px-3 py-1.5 rounded text-xs font-medium transition-colors text-center ${
                        selectedTimeframe === tf.id
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'text-zinc-300 hover:bg-zinc-800 border border-transparent'
                      }`}
                    >
                      {tf.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </PopoverContent>
        </Popover>

        {/* Quick timeframe chips — most used */}
        <div className="hidden sm:flex items-center gap-0.5">
          {(['M5', 'M15', 'H1', 'H4', 'D1'] as TimeframeId[]).map((tf) => (
            <button
              key={tf}
              onClick={() => setSelectedTimeframe(tf)}
              title={`${tf} — ${TIMEFRAME_OPTIONS.find(t => t.id === tf)?.seconds}s`}
              className={`px-2 py-1 rounded text-[11px] font-mono transition-colors ${
                selectedTimeframe === tf
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 border border-transparent'
              }`}
            >
              {TIMEFRAME_OPTIONS.find(t => t.id === tf)?.label}
            </button>
          ))}
        </div>
      </div>

      <Separator orientation="vertical" className="h-5 bg-zinc-700/50" />

      {/* Trading Session selector */}
      <div className="flex items-center gap-1.5 shrink-0">
        <Clock className="w-3.5 h-3.5 text-zinc-500" />
        <Popover>
          <PopoverTrigger asChild>
            <button className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-800 border border-zinc-700 hover:border-zinc-600 transition-colors text-xs text-white font-medium min-w-[90px] justify-center">
              <span>{selectedSess?.icon}</span>
              <span className="truncate">{selectedSess?.label || 'Semua Sesi'}</span>
              <ChevronDown className="w-3 h-3 text-zinc-400" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-52 p-2 bg-zinc-900 border-zinc-700" align="start">
            <div className="space-y-0.5">
              {SESSION_OPTIONS.map((s) => {
                const isActive = s.id === 'all'
                  ? activeSessionNames.length > 0
                  : sessions.find(sess => sess.name === s.id)?.isActive;
                return (
                  <button
                    key={s.id}
                    onClick={() => setSelectedSession(s.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs transition-colors text-left ${
                      selectedSession === s.id
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'text-zinc-300 hover:bg-zinc-800'
                    }`}
                  >
                    <span className="text-sm">{s.icon}</span>
                    <span className="flex-1 font-medium">{s.label}</span>
                    {isActive && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    )}
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>

        {/* Live session indicators */}
        <div className="flex items-center gap-1">
          {sessions.map((s) => {
            const isSelected = selectedSession === s.name || selectedSession === 'all';
            return (
              <button
                key={s.name}
                onClick={() => setSelectedSession(s.name as TradingSessionId)}
                title={`${s.name}: ${String(s.startHour).padStart(2, '0')}:00 - ${String(s.endHour).padStart(2, '0')}:00 WIB${s.isActive ? ' (AKTIF)' : ''}`}
                className={`px-2 py-1 rounded text-[10px] font-medium transition-colors whitespace-nowrap ${
                  s.isActive && isSelected
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
                    : s.isActive && !isSelected
                      ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                      : isSelected
                        ? 'bg-zinc-800 text-zinc-300 border border-zinc-600'
                        : 'text-zinc-600 hover:text-zinc-400 border border-transparent'
                }`}
              >
                {s.name}
                {s.isActive && <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Spacer + session status text */}
      <div className="ml-auto flex items-center gap-2 shrink-0">
        {activeSessionNames.length > 0 && (
          <div className="hidden md:flex items-center gap-1.5 text-[10px] text-zinc-500">
            <Sun className="w-3 h-3" />
            <span>
              {activeSessionNames.length > 0
                ? `Sesi aktif: ${activeSessionNames.join(', ')}`
                : 'Tidak ada sesi aktif'
              }
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
