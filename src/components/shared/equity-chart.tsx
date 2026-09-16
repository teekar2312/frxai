'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { fmtMoney } from '@/hooks/use-polling'

// ============================================================
// EquityChart — lightweight custom SVG equity curve
// (no external chart libraries; emerald = profit, red = loss)
//
// Features:
// - area fill between the curve and the initial-balance baseline
//   (emerald gradient when the final balance ≥ initial, red otherwise)
// - running-peak line + red shading of the drawdown gap
// - right $-axis, bottom time axis, dashed baseline
// - hover crosshair + tooltip (equity / drawdown / peak)
// ============================================================

export interface EquityPoint {
  time: number
  equity: number
  drawdown: number
}

const EMERALD = '#10b981'
const RED = '#ef4444'
const PRICE_W = 54 // right $-axis width
const TIME_H = 18 // bottom time axis height
const PAD_TOP = 8
const PAD_LEFT = 4

interface HoverState {
  x: number
  y: number
  idx: number
}

export default function EquityChart({
  points,
  initialBalance,
  height = 260,
  className,
}: {
  points: EquityPoint[]
  initialBalance: number
  height?: number
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(720)
  const [hover, setHover] = useState<HoverState | null>(null)

  // Responsive width via ResizeObserver (initial callback carries the size)
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

  const n = points.length
  const up = n > 0 && points[n - 1].equity >= initialBalance
  const lineColor = up ? EMERALD : RED

  // Scales (memoized) — include the baseline and the running peaks in range
  const geom = useMemo(() => {
    if (n === 0) return null
    let min = Infinity
    let max = -Infinity
    for (const p of points) {
      if (p.equity < min) min = p.equity
      if (p.equity > max) max = p.equity
      const peak = p.equity + p.drawdown
      if (peak > max) max = peak
    }
    if (initialBalance < min) min = initialBalance
    if (initialBalance > max) max = initialBalance
    const range = max - min || Math.max(Math.abs(max) * 0.002, 1e-6)
    min -= range * 0.08
    max += range * 0.08
    const plotW = Math.max(width - PRICE_W - PAD_LEFT, 60)
    const plotH = Math.max(height - TIME_H - PAD_TOP, 60)
    const x = (i: number) => PAD_LEFT + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW)
    const y = (v: number) => PAD_TOP + ((max - v) / (max - min)) * plotH
    return { min, max, plotW, plotH, x, y }
  }, [points, n, initialBalance, width, height])

  // Wide spans (≥ 12h between points on average) → date labels
  const showDate = useMemo(() => {
    if (n < 2) return false
    const span = points[n - 1].time - points[0].time
    return span / (n - 1) >= 12 * 3600 * 1000
  }, [points, n])

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!geom) return
      const rect = e.currentTarget.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      if (px < PAD_LEFT || px > PAD_LEFT + geom.plotW || py < PAD_TOP || py > PAD_TOP + geom.plotH) {
        setHover(null)
        return
      }
      const t = (px - PAD_LEFT) / geom.plotW
      const idx = n === 1 ? 0 : Math.min(n - 1, Math.max(0, Math.round(t * (n - 1))))
      setHover({ x: geom.x(idx), y: py, idx })
    },
    [geom, n]
  )

  // ---- Static layers (memoized so crosshair moves stay cheap) ----
  const staticLayers = useMemo(() => {
    if (!geom || n === 0) return null
    const { plotW, plotH, x, y } = geom

    // 5 horizontal gridlines + right $ labels
    const grid = Array.from({ length: 5 }, (_, i) => {
      const v = geom.min + (i / 4) * (geom.max - geom.min)
      const gy = y(v)
      return (
        <g key={`g${i}`}>
          <line x1={PAD_LEFT} x2={PAD_LEFT + plotW} y1={gy} y2={gy} stroke="currentColor" strokeOpacity={0.08} strokeWidth={1} />
          <text x={PAD_LEFT + plotW + 6} y={gy + 3} fontSize={9} fill="currentColor" fillOpacity={0.55} className="num">
            {`$${Math.round(v).toLocaleString('en-US')}`}
          </text>
        </g>
      )
    })

    // 4-5 time labels along the bottom
    const timeIdx = [...new Set(Array.from({ length: 5 }, (_, k) => Math.round((k * (n - 1)) / 4)))]
    const timeLabels = timeIdx.map((i) => {
      const d = new Date(points[i].time)
      const label = showDate
        ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
        : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      return (
        <text key={`t${i}`} x={x(i)} y={height - 5} fontSize={9} textAnchor="middle" fill="currentColor" fillOpacity={0.55} className="num">
          {label}
        </text>
      )
    })

    // Baseline (initial balance) — dashed
    const baseY = y(initialBalance)
    const baseline = (
      <g>
        <line x1={PAD_LEFT} x2={PAD_LEFT + plotW} y1={baseY} y2={baseY} stroke="currentColor" strokeOpacity={0.45} strokeWidth={1} strokeDasharray="5 4" />
        <text x={PAD_LEFT + 3} y={baseY - 4} fontSize={9} fill="currentColor" fillOpacity={0.5} className="num">
          {`initial ${fmtMoney(initialBalance, 0)}`}
        </text>
      </g>
    )

    // Equity points
    const eqPts = points.map((p, i) => `${x(i).toFixed(1)},${y(p.equity).toFixed(1)}`)
    // Running peak = equity + drawdown
    const peakPts = points.map((p, i) => `${x(i).toFixed(1)},${y(p.equity + p.drawdown).toFixed(1)}`)

    // Drawdown shading: polygon between peak line and equity line
    const ddPolygon = (
      <polygon
        points={`${eqPts.join(' ')} ${[...peakPts].reverse().join(' ')}`}
        fill={RED}
        opacity={0.12}
      />
    )

    // Peak line (subtle dashed)
    const peakLine = (
      <polyline points={peakPts.join(' ')} fill="none" stroke="currentColor" strokeOpacity={0.3} strokeWidth={1} strokeDasharray="2 3" />
    )

    // Area between the curve and the baseline
    const basePts = points.map((_, i) => `${x(i).toFixed(1)},${baseY.toFixed(1)}`)
    const area = (
      <polygon
        points={`${eqPts.join(' ')} ${[...basePts].reverse().join(' ')}`}
        fill={`url(#eq-gradient-${up ? 'up' : 'down'})`}
      />
    )

    // The curve itself + end dot
    const curve = (
      <>
        <polyline points={eqPts.join(' ')} fill="none" stroke={lineColor} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(n - 1)} cy={y(points[n - 1].equity)} r={3} fill={lineColor} />
        <circle cx={x(n - 1)} cy={y(points[n - 1].equity)} r={5.5} fill={lineColor} opacity={0.25} />
      </>
    )

    // End-of-curve balance tag on the right axis
    const lastY = y(points[n - 1].equity)
    const tagX = PAD_LEFT + plotW + 2
    const endTag = (
      <g>
        <rect x={tagX} y={lastY - 8} width={PRICE_W - 4} height={16} rx={2} fill={lineColor} />
        <text x={tagX + (PRICE_W - 4) / 2} y={lastY + 3.5} fontSize={9} fontWeight={600} textAnchor="middle" fill="#fff" className="num">
          {`$${Math.round(points[n - 1].equity).toLocaleString('en-US')}`}
        </text>
      </g>
    )

    return (
      <>
        {grid}
        {ddPolygon}
        {peakLine}
        <defs>
          <linearGradient id="eq-gradient-up" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={EMERALD} stopOpacity={0.28} />
            <stop offset="100%" stopColor={EMERALD} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="eq-gradient-down" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={RED} stopOpacity={0.02} />
            <stop offset="100%" stopColor={RED} stopOpacity={0.28} />
          </linearGradient>
        </defs>
        {baseline}
        {area}
        {curve}
        {endTag}
        {timeLabels}
      </>
    )
  }, [geom, n, points, initialBalance, height, showDate, up, lineColor])

  return (
    <div ref={containerRef} className={cn('relative w-full select-none', className)} style={{ height }}>
      {!geom || n === 0 || !staticLayers ? (
        <div className="flex h-full w-full items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
          Menunggu data equity…
        </div>
      ) : (
        <>
          <svg
            width={width}
            height={height}
            onPointerMove={onPointerMove}
            onPointerLeave={() => setHover(null)}
            role="img"
            aria-label={`Kurva equity — saldo akhir ${fmtMoney(points[n - 1].equity)}`}
            className="block"
          >
            {staticLayers}
            {hover ? (
              <g>
                <line x1={hover.x} x2={hover.x} y1={PAD_TOP} y2={PAD_TOP + geom.plotH} stroke="currentColor" strokeOpacity={0.4} strokeWidth={1} strokeDasharray="3 3" />
                <line x1={PAD_LEFT} x2={PAD_LEFT + geom.plotW} y1={hover.y} y2={hover.y} stroke="currentColor" strokeOpacity={0.4} strokeWidth={1} strokeDasharray="3 3" />
              </g>
            ) : null}
          </svg>

          {/* Equity tooltip */}
          {hover ? (() => {
            const p = points[hover.idx]
            if (!p) return null
            const TW = 158
            const left = hover.x + TW + 20 > width ? Math.max(hover.x - TW - 12, 4) : hover.x + 14
            const top = Math.min(Math.max(hover.y - 60, 6), Math.max(height - 118, 6))
            return (
              <div
                className="pointer-events-none absolute z-10 w-[158px] rounded-md border bg-popover/95 px-2 py-1.5 shadow-md"
                style={{ left, top }}
              >
                <div className="num mb-1 text-[9px] text-muted-foreground">
                  {new Date(p.time).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </div>
                <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px]">
                  <span className="text-muted-foreground">Equity</span>
                  <span className={cn('num text-right font-semibold', p.equity >= initialBalance ? 'text-emerald-500' : 'text-red-500')}>
                    {fmtMoney(p.equity)}
                  </span>
                  <span className="text-muted-foreground">Peak</span>
                  <span className="num text-right">{fmtMoney(p.equity + p.drawdown)}</span>
                  <span className="text-muted-foreground">Drawdown</span>
                  <span className={cn('num text-right', p.drawdown > 0 ? 'text-red-500' : 'text-muted-foreground')}>
                    {p.drawdown > 0 ? `-${fmtMoney(p.drawdown)}` : '$0'}
                  </span>
                </div>
              </div>
            )
          })() : null}
        </>
      )}
    </div>
  )
}
