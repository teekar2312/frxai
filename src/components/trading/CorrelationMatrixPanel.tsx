'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

// ============================================================
// Types
// ============================================================

interface CorrelationResponse {
  pairs: string[];
  matrix: number[][];
  labels: string[];
}

// ============================================================
// Color scale: -1 (dark red) -> 0 (zinc-900/black) -> +1 (dark green)
// ============================================================

function correlationColor(value: number): string {
  const clamped = Math.max(-1, Math.min(1, value));
  const abs = Math.abs(clamped);
  if (clamped >= 0) {
    // black -> green
    const r = Math.round(24 * (1 - abs));
    const g = Math.round(24 + (80 - 24) * abs);
    const b = Math.round(24 * (1 - abs));
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    // black -> red
    const r = Math.round(24 + (120 - 24) * abs);
    const g = Math.round(24 * (1 - abs));
    const b = Math.round(24 * (1 - abs));
    return `rgb(${r}, ${g}, ${b})`;
  }
}

function textColor(value: number): string {
  const abs = Math.abs(value);
  if (abs > 0.6) return 'text-white';
  if (abs > 0.3) return 'text-zinc-200';
  return 'text-zinc-400';
}

// ============================================================
// Component: CorrelationMatrixPanel
// ============================================================

export function CorrelationMatrixPanel() {
  const [data, setData] = useState<CorrelationResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredCell, setHoveredCell] = useState<{ row: number; col: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchCorrelation = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/correlation');
        if (!res.ok) throw new Error('Gagal memuat data korelasi');
        const json = await res.json();
        if (!cancelled) {
          setData(json);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Terjadi kesalahan');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    fetchCorrelation();
    return () => { cancelled = true; };
  }, []);

  // ---- Legend gradient stops ----
  const legendStops = [
    { pos: 0, color: correlationColor(-1), label: '-1.0' },
    { pos: 25, color: correlationColor(-0.5), label: '-0.5' },
    { pos: 50, color: correlationColor(0), label: '0.0' },
    { pos: 75, color: correlationColor(0.5), label: '+0.5' },
    { pos: 100, color: correlationColor(1), label: '+1.0' },
  ];

  // ---- Hovered value for tooltip ----
  const getHoveredValue = (): string | null => {
    if (!hoveredCell || !data) return null;
    const { row, col } = hoveredCell;
    if (row >= data.matrix.length || col >= data.matrix[row].length) return null;
    return `${data.labels[row]} ↔ ${data.labels[col]}: ${data.matrix[row][col].toFixed(4)}`;
  };

  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-zinc-100">
          Matriks Korelasi
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <Skeleton className="h-6 w-16 bg-zinc-800" />
              <Skeleton className="h-32 flex-1 bg-zinc-800" />
            </div>
            <Skeleton className="h-4 w-full bg-zinc-800" />
          </div>
        ) : error ? (
          <div className="py-8 text-center">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        ) : data && data.labels.length > 0 ? (
          <div className="space-y-3">
            {/* Matrix grid */}
            <div className="overflow-x-auto">
              <div className="inline-block min-w-full">
                {/* Header row with pair labels */}
                <div className="flex items-center">
                  <div className="w-16 sm:w-20 shrink-0" /> {/* spacer for row labels */}
                  {data.labels.map((label, i) => (
                    <div
                      key={i}
                      className="w-12 sm:w-14 h-6 flex items-center justify-center shrink-0"
                    >
                      <span className="text-[9px] sm:text-[10px] font-mono text-zinc-400 truncate max-w-[3.5rem]">
                        {label}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Data rows */}
                {data.matrix.map((row, rowIdx) => (
                  <div key={rowIdx} className="flex items-center">
                    {/* Row label */}
                    <div className="w-16 sm:w-20 shrink-0 pr-2 flex items-center justify-end">
                      <span className="text-[9px] sm:text-[10px] font-mono text-zinc-400 truncate">
                        {data.labels[rowIdx]}
                      </span>
                    </div>

                    {/* Cells */}
                    {row.map((value, colIdx) => {
                      const isDiagonal = rowIdx === colIdx;
                      const isHovered = hoveredCell?.row === rowIdx && hoveredCell?.col === colIdx;

                      return (
                        <Tooltip key={colIdx}>
                          <TooltipTrigger asChild>
                            <div
                              className={`w-12 sm:w-14 h-10 sm:h-11 flex items-center justify-center shrink-0 cursor-default transition-all border border-transparent ${
                                isDiagonal ? 'cursor-default' : ''
                              } ${
                                isHovered ? 'border-zinc-400 ring-1 ring-zinc-500 z-10' : 'hover:border-zinc-600'
                              }`}
                              style={{ backgroundColor: isDiagonal ? '#27272a' : correlationColor(value) }}
                              onMouseEnter={() => setHoveredCell({ row: rowIdx, col: colIdx })}
                              onMouseLeave={() => setHoveredCell(null)}
                            >
                              <span className={`text-[10px] sm:text-xs font-mono font-medium ${isDiagonal ? 'text-zinc-600' : textColor(value)}`}>
                                {isDiagonal ? '—' : value.toFixed(2)}
                              </span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent
                            side="top"
                            className="bg-zinc-800 border-zinc-700 text-zinc-200 text-xs"
                          >
                            <span>
                              {data.labels[rowIdx]} / {data.labels[colIdx]}:{' '}
                              <span className="font-mono font-medium">{value.toFixed(4)}</span>
                            </span>
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            {/* Color legend */}
            <div className="pt-3 border-t border-zinc-800/60">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-zinc-500 shrink-0">Korelasi Kuat Negatif</span>
                <div className="flex-1 h-3 rounded-full overflow-hidden relative">
                  <div
                    className="w-full h-full rounded-full"
                    style={{
                      background: `linear-gradient(to right, ${legendStops.map(s => `${s.color} ${s.pos}%`).join(', ')})`,
                    }}
                  />
                </div>
                <span className="text-[10px] text-zinc-500 shrink-0">Korelasi Kuat Positif</span>
              </div>
              <div className="flex items-center justify-between mt-1 px-1">
                <span className="text-[9px] text-zinc-600 font-mono">-1.0</span>
                <span className="text-[9px] text-zinc-600 font-mono">0.0</span>
                <span className="text-[9px] text-zinc-600 font-mono">+1.0</span>
              </div>
            </div>

            {/* Hovered info bar */}
            {getHoveredValue() && (
              <div className="text-[10px] text-zinc-400 text-center">
                {getHoveredValue()}
              </div>
            )}
          </div>
        ) : (
          <div className="py-8 text-center">
            <p className="text-sm text-zinc-500">Tidak ada data korelasi</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
