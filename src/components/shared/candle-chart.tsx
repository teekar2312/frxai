'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Candle } from '@/lib/types'
import { cn } from '@/lib/utils'
import { fmtPct } from '@/hooks/use-polling'

// ============================================================
// CandleChart — lightweight custom SVG candlestick chart
// (no external chart libraries; bull = emerald, bear = red)
// ============================================================

export interface ChartOverlay {
  label: string
  color: string
  /** values aligned 1:1 with the candles array (null = gap) */
  values: (number | null)[]
  dash?: boolean
}

const BULL = '#10b981'
const BEAR = '#ef4444'
const PRICE_W = 56 // right price scale width
const TIME_H = 18 // bottom time axis height
const PAD_TOP = 6
const PAD_LEFT = 4
const VOL_RATIO = 0.15 // bottom 15% of plot = volume histogram

interface HoverState {
  x: number
  y: number
  idx: number
}

export default function CandleChart({
  candles,
  digits,
  height = 380,
  overlays = [],
  className,
}: {
  candles: Candle[]
  digits: number
  height?: number
  overlays?: ChartOverlay[]
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(720)
  const [hover, setHover] = useState<HoverState | null>(null)

  // Responsive width via ResizeObserver (container div is stable across renders).
  // observe() fires an initial callback with the current size, so no manual sync read needed.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w && w > 0) setWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Cap at the last 200 candles for performance
  const data = useMemo(() => (candles.length > 200 ? candles.slice(-200) : candles), [candles])
  const n = data.length

  // Align overlays to the (possibly sliced) data window, indexing from the end
  const alignedOverlays = useMemo(() => {
    return overlays.map((o) => {
      const vals: (number | null)[] = new Array<number | null>(n).fill(null)
      const off = o.values.length - n
      for (let i = 0; i < n; i++) {
        const j = off + i
        if (j >= 0 && j < o.values.length) vals[i] = o.values[j]
      }
      return { ...o, values: vals }
    })
  }, [overlays, n])

  // Scales (memoized)
  const geom = useMemo(() => {
    if (n === 0) return null
    let min = Infinity
    let max = -Infinity
    for (const c of data) {
      if (c.low < min) min = c.low
      if (c.high > max) max = c.high
    }
    for (const o of alignedOverlays) {
      for (const v of o.values) {
        if (v === null) continue
        if (v < min) min = v
        if (v > max) max = v
      }
    }
    const range = max - min || Math.max(Math.abs(max) * 0.001, 1e-6)
    min -= range * 0.08 // 8% padding
    max += range * 0.08
    const plotW = Math.max(width - PRICE_W - PAD_LEFT, 60)
    const plotH = Math.max(height - TIME_H - PAD_TOP, 60)
    const priceH = plotH * (1 - VOL_RATIO)
    const volH = plotH * VOL_RATIO
    const cw = plotW / n
    let maxVol = 1
    for (const c of data) if (c.volume > maxVol) maxVol = c.volume
    const y = (v: number) => PAD_TOP + ((max - v) / (max - min)) * priceH
    return { min, max, plotW, plotH, priceH, volH, cw, maxVol, y }
  }, [data, n, alignedOverlays, width, height])

  // Wide timeframes (≥ 12h per candle) → date labels instead of HH:MM
  const showDate = useMemo(() => {
    if (n < 2) return false
    const span = data[n - 1].time - data[0].time
    return span / (n - 1) >= 12 * 3600 * 1000
  }, [data, n])

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!geom) return
      const rect = e.currentTarget.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      if (x < PAD_LEFT || x > PAD_LEFT + geom.plotW || y < PAD_TOP || y > PAD_TOP + geom.plotH) {
        setHover(null)
        return
      }
      const idx = Math.min(n - 1, Math.max(0, Math.floor((x - PAD_LEFT) / geom.cw)))
      setHover({ x: PAD_LEFT + (idx + 0.5) * geom.cw, y, idx })
    },
    [geom, n]
  )

  // ---- Static layers (memoized so crosshair moves stay cheap) ----
  const staticLayers = useMemo(() => {
    if (!geom || n === 0) return null
    const { plotW, plotH, priceH, cw, y, maxVol } = geom

    // 6 horizontal gridlines + right price labels
    const grid = Array.from({ length: 6 }, (_, i) => {
      const p = geom.min + (i / 5) * (geom.max - geom.min)
      const gy = y(p)
      return (
        <g key={`g${i}`}>
          <line x1={PAD_LEFT} x2={PAD_LEFT + plotW} y1={gy} y2={gy} stroke="currentColor" strokeOpacity={0.08} strokeWidth={1} />
          <text x={PAD_LEFT + plotW + 6} y={gy + 3} fontSize={10} fill="currentColor" fillOpacity={0.55} className="num">
            {p.toFixed(digits)}
          </text>
        </g>
      )
    })

    // 4-6 time labels along the bottom
    const timeIdx = [...new Set(Array.from({ length: 5 }, (_, k) => Math.round((k * (n - 1)) / 4)))]
    const timeLabels = timeIdx.map((i) => {
      const d = new Date(data[i].time)
      const label = showDate
        ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
        : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      return (
        <text key={`t${i}`} x={PAD_LEFT + (i + 0.5) * cw} y={height - 5} fontSize={10} textAnchor="middle" fill="currentColor" fillOpacity={0.55} className="num">
          {label}
        </text>
      )
    })

    // Volume histogram (bottom 15%, muted)
    const bw = Math.max(Math.min(cw * 0.66, 13), 1)
    const volumes = data.map((c, i) => {
      const up = c.close >= c.open
      const h = (c.volume / maxVol) * (plotH * VOL_RATIO)
      return (
        <rect
          key={`v${c.time}-${i}`}
          x={PAD_LEFT + i * cw}
          y={PAD_TOP + plotH - h}
          width={Math.max(cw, 1)}
          height={Math.max(h, 0.5)}
          fill={up ? BULL : BEAR}
          opacity={0.22}
        />
      )
    })

    // Candles with wicks
    const bodies = data.map((c, i) => {
      const up = c.close >= c.open
      const color = up ? BULL : BEAR
      const x = PAD_LEFT + (i + 0.5) * cw
      const yH = y(c.high)
      const yL = y(c.low)
      const bodyTop = Math.min(y(c.open), y(c.close))
      const bodyH = Math.max(Math.abs(y(c.close) - y(c.open)), 1)
      return (
        <g key={`c${c.time}-${i}`}>
          <line x1={x} x2={x} y1={yH} y2={yL} stroke={color} strokeWidth={1} />
          <rect x={x - bw / 2} y={bodyTop} width={bw} height={bodyH} fill={color} />
        </g>
      )
    })

    // Overlay polylines (EMA / BB …)
    const lines = alignedOverlays.map((o, oi) => {
      const pts: string[] = []
      o.values.forEach((v, i) => {
        if (v === null) return
        pts.push(`${(PAD_LEFT + (i + 0.5) * cw).toFixed(1)},${y(v).toFixed(1)}`)
      })
      if (pts.length < 2) return null
      return (
        <polyline
          key={`o${oi}`}
          points={pts.join(' ')}
          fill="none"
          stroke={o.color}
          strokeWidth={1.2}
          strokeDasharray={o.dash ? '4 3' : undefined}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )
    })

    // Last price dashed line + right tag
    const last = data[n - 1]
    const lastUp = last.close >= last.open
    const lastColor = lastUp ? BULL : BEAR
    const lastY = y(last.close)
    const tagX = PAD_LEFT + plotW + 2
    const lastPrice = (
      <g>
        <line x1={PAD_LEFT} x2={PAD_LEFT + plotW} y1={lastY} y2={lastY} stroke={lastColor} strokeWidth={1} strokeDasharray="4 3" opacity={0.8} />
        <rect x={tagX} y={lastY - 8} width={PRICE_W - 4} height={16} rx={2} fill={lastColor} />
        <text x={tagX + (PRICE_W - 4) / 2} y={lastY + 3.5} fontSize={10} fontWeight={600} textAnchor="middle" fill="#fff" className="num">
          {last.close.toFixed(digits)}
        </text>
      </g>
    )

    return (
      <>
        {grid}
        {volumes}
        {bodies}
        {lines}
        {lastPrice}
        {timeLabels}
      </>
    )
  }, [geom, n, data, alignedOverlays, digits, height, showDate])

  const last = n > 0 ? data[n - 1] : null

  return (
    <div ref={containerRef} className={cn('relative w-full select-none', className)} style={{ height }}>
      {!geom || n === 0 || !staticLayers || !last ? (
        <div className="flex h-full w-full items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
          Menunggu data candle…
        </div>
      ) : (
        <>
          <svg
            width={width}
            height={height}
            onPointerMove={onPointerMove}
            onPointerLeave={() => setHover(null)}
            role="img"
            aria-label={`Candlestick chart ${last.close.toFixed(digits)}`}
            className="block"
          >
            {staticLayers}
            {hover ? (
              <g>
                {/* crosshair vertical (full plot height) */}
                <line x1={hover.x} x2={hover.x} y1={PAD_TOP} y2={PAD_TOP + geom.plotH} stroke="currentColor" strokeOpacity={0.4} strokeWidth={1} strokeDasharray="3 3" />
                {/* crosshair horizontal (price area only) + price tag */}
                {hover.y <= PAD_TOP + geom.priceH ? (
                  <>
                    <line x1={PAD_LEFT} x2={PAD_LEFT + geom.plotW} y1={hover.y} y2={hover.y} stroke="currentColor" strokeOpacity={0.4} strokeWidth={1} strokeDasharray="3 3" />
                    <rect x={PAD_LEFT + geom.plotW + 2} y={hover.y - 8} width={PRICE_W - 4} height={16} rx={2} fill="currentColor" fillOpacity={0.75} />
                    <text
                      x={PAD_LEFT + geom.plotW + 2 + (PRICE_W - 4) / 2}
                      y={hover.y + 3.5}
                      fontSize={10}
                      textAnchor="middle"
                      fill="var(--background)"
                      className="num"
                    >
                      {(geom.max - ((hover.y - PAD_TOP) / geom.priceH) * (geom.max - geom.min)).toFixed(digits)}
                    </text>
                  </>
                ) : null}
              </g>
            ) : null}
          </svg>

          {/* OHLC tooltip */}
          {hover ? (() => {
            const c = data[hover.idx]
            if (!c) return null
            const up = c.close >= c.open
            const chg = ((c.close - c.open) / c.open) * 100
            const TW = 152
            const left = hover.x + TW + 20 > width ? Math.max(hover.x - TW - 12, 4) : hover.x + 14
            const top = Math.min(Math.max(hover.y - 44, 6), Math.max(height - 132, 6))
            return (
              <div
                className="pointer-events-none absolute z-10 w-[152px] rounded-md border bg-popover/95 px-2 py-1.5 shadow-md"
                style={{ left, top }}
              >
                <div className="num mb-1 text-[9px] text-muted-foreground">
                  {new Date(c.time).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </div>
                <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px]">
                  <span className="text-muted-foreground">O</span>
                  <span className="num text-right">{c.open.toFixed(digits)}</span>
                  <span className="text-muted-foreground">H</span>
                  <span className="num text-right">{c.high.toFixed(digits)}</span>
                  <span className="text-muted-foreground">L</span>
                  <span className="num text-right">{c.low.toFixed(digits)}</span>
                  <span className="text-muted-foreground">C</span>
                  <span className={cn('num text-right font-semibold', up ? 'text-emerald-500' : 'text-red-500')}>{c.close.toFixed(digits)}</span>
                  <span className="text-muted-foreground">Vol</span>
                  <span className="num text-right">{c.volume}</span>
                  <span className="text-muted-foreground">Chg</span>
                  <span className={cn('num text-right', up ? 'text-emerald-500' : 'text-red-500')}>{fmtPct(chg)}</span>
                </div>
              </div>
            )
          })() : null}
        </>
      )}
    </div>
  )
}
