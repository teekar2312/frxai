// ============================================================
// FINEX AI TRADING SYSTEM — 30 technical indicators (PURE)
// Input candles are ordered oldest → newest (last = current bar).
// No side effects, no pip/pair knowledge — raw price units only.
// ============================================================

import type { Candle } from '@/lib/types'

export interface IndicatorCalc {
  value: number
  display: string
  signal: 'BUY' | 'SELL' | 'NEUTRAL'
  detail?: string
}

type Signal = 'BUY' | 'SELL' | 'NEUTRAL'

// ------------------------------------------------------------
// Formatting helpers
// ------------------------------------------------------------
function fmt(v: number | null, dec?: number): string {
  if (v === null || !isFinite(v)) return '—'
  const a = Math.abs(v)
  const d = dec !== undefined ? dec : a >= 100 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 5 : 6
  return v.toFixed(d)
}

function signed(v: number | null, dec?: number): string {
  if (v === null || !isFinite(v)) return '—'
  return (v >= 0 ? '+' : '') + fmt(v, dec)
}

function fmtVol(v: number): string {
  const a = Math.abs(v)
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (a >= 1_000) return `${(v / 1_000).toFixed(1)}k`
  return v.toFixed(0)
}

const INSUFFICIENT = (): IndicatorCalc => ({ value: 0, display: '—', signal: 'NEUTRAL', detail: 'insufficient data' })

// ------------------------------------------------------------
// Series helpers
// ------------------------------------------------------------
const closesOf = (c: Candle[]): number[] => c.map((x) => x.close)

function smaAt(v: number[], period: number, end = v.length - 1): number | null {
  if (period <= 0 || end + 1 < period) return null
  let s = 0
  for (let i = end - period + 1; i <= end; i++) s += v[i]
  return s / period
}

function emaSeries(v: number[], period: number): number[] {
  const k = 2 / (period + 1)
  const out: number[] = []
  let e = v[0]
  for (let i = 0; i < v.length; i++) {
    e = i === 0 ? v[0] : v[i] * k + e * (1 - k)
    out.push(e)
  }
  return out
}

function emaAt(v: number[], period: number): number | null {
  if (v.length < period || period <= 0) return null
  return emaSeries(v, period)[v.length - 1]
}

function wmaAt(v: number[], period: number, end: number): number | null {
  if (period <= 0 || end + 1 < period) return null
  let num = 0
  let den = 0
  for (let i = 0; i < period; i++) {
    const w = period - i
    num += v[end - i] * w
    den += w
  }
  return num / den
}

function trueRange(c: Candle[], i: number): number {
  if (i === 0) return c[0].high - c[0].low
  const p = c[i - 1].close
  return Math.max(c[i].high - c[i].low, Math.abs(c[i].high - p), Math.abs(c[i].low - p))
}

/** ATR (simple rolling mean of True Range). Returns price units. */
export function atrValue(c: Candle[], period = 14, end = c.length - 1): number | null {
  if (end + 1 < period || period <= 0) return null
  let s = 0
  for (let i = end - period + 1; i <= end; i++) s += trueRange(c, i)
  return s / period
}

function rsiAt(cl: number[], period = 14): number | null {
  if (cl.length < period + 1) return null
  let gain = 0
  let loss = 0
  for (let i = 1; i <= period; i++) {
    const d = cl[i] - cl[i - 1]
    if (d >= 0) gain += d
    else loss -= d
  }
  let avgG = gain / period
  let avgL = loss / period
  for (let i = period + 1; i < cl.length; i++) {
    const d = cl[i] - cl[i - 1]
    avgG = (avgG * (period - 1) + Math.max(d, 0)) / period
    avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period
  }
  if (avgL === 0) return 100
  return 100 - 100 / (1 + avgG / avgL)
}

function stochOf(v: number[], period: number, end: number): number {
  let hh = -Infinity
  let ll = Infinity
  for (let i = end - period + 1; i <= end; i++) {
    hh = Math.max(hh, v[i])
    ll = Math.min(ll, v[i])
  }
  if (hh === ll) return 50
  return ((v[end] - ll) / (hh - ll)) * 100
}

/** Slow stochastic %K (SMA-smoothed) over candle highs/lows. */
function stochK(c: Candle[], period = 14, smooth = 3): number | null {
  if (c.length < period + smooth) return null
  const ks: number[] = []
  for (let e = c.length - smooth; e < c.length; e++) ks.push(rawStochCandle(c, period, e))
  return ks.reduce((a, b) => a + b, 0) / ks.length
}

function rawStochCandle(c: Candle[], period: number, end: number): number {
  let hh = -Infinity
  let ll = Infinity
  for (let i = end - period + 1; i <= end; i++) {
    hh = Math.max(hh, c[i].high)
    ll = Math.min(ll, c[i].low)
  }
  if (hh === ll) return 50
  return ((c[end].close - ll) / (hh - ll)) * 100
}

// ------------------------------------------------------------
// TREND (7)
// ------------------------------------------------------------
function calcEma(c: Candle[]): IndicatorCalc {
  const cl = closesOf(c)
  if (cl.length < 30) return INSUFFICIENT()
  const e12 = emaAt(cl, 12)
  const e26 = emaAt(cl, 26)
  if (e12 === null || e26 === null) return INSUFFICIENT()
  const last = cl[cl.length - 1]
  const diff = e12 - e26
  let sig: Signal = 'NEUTRAL'
  if (e12 > e26 && last > e12) sig = 'BUY'
  else if (e12 < e26 && last < e12) sig = 'SELL'
  return { value: diff, display: signed(diff), signal: sig, detail: `EMA12 ${fmt(e12)} · EMA26 ${fmt(e26)}` }
}

function calcSma(c: Candle[]): IndicatorCalc {
  const cl = closesOf(c)
  const sma = smaAt(cl, 20)
  if (sma === null) return INSUFFICIENT()
  const last = cl[cl.length - 1]
  const diff = last - sma
  return { value: diff, display: signed(diff), signal: diff > 0 ? 'BUY' : diff < 0 ? 'SELL' : 'NEUTRAL', detail: `SMA20 ${fmt(sma)}` }
}

function calcHma(c: Candle[]): IndicatorCalc {
  const cl = closesOf(c)
  if (cl.length < 35) return INSUFFICIENT()
  const rawAt = (end: number): number | null => {
    const a = wmaAt(cl, 10, end)
    const b = wmaAt(cl, 21, end)
    return a !== null && b !== null ? 2 * a - b : null
  }
  const raws: number[] = []
  for (let e = cl.length - 8; e < cl.length; e++) {
    const r = rawAt(e)
    if (r === null) return INSUFFICIENT()
    raws.push(r)
  }
  const hmaOf = (arr: number[]): number | null => {
    if (arr.length < 5) return null
    let num = 0
    let den = 0
    for (let i = 0; i < 5; i++) {
      const w = 5 - i
      num += arr[i] * w
      den += w
    }
    return num / den
  }
  const now = hmaOf(raws.slice(3))
  const prev = hmaOf(raws.slice(0, 5))
  if (now === null || prev === null) return INSUFFICIENT()
  const slope = now - prev
  return { value: slope, display: fmt(now), signal: slope > 0 ? 'BUY' : slope < 0 ? 'SELL' : 'NEUTRAL', detail: `HMA(21) slope ${signed(slope)}` }
}

function calcSupertrend(c: Candle[]): IndicatorCalc {
  if (c.length < 25) return INSUFFICIENT()
  const period = 10
  const mult = 3
  const atrs: number[] = []
  for (let i = 0; i < c.length; i++) {
    if (i < period - 1) {
      atrs.push(NaN)
      continue
    }
    let s = 0
    for (let j = i - period + 1; j <= i; j++) s += trueRange(c, j)
    atrs.push(s / period)
  }
  let i0 = period - 1
  let fu = (c[i0].high + c[i0].low) / 2 + mult * atrs[i0]
  let fl = (c[i0].high + c[i0].low) / 2 - mult * atrs[i0]
  let dir = 1
  let line = fl
  for (let i = i0 + 1; i < c.length; i++) {
    const bu = (c[i].high + c[i].low) / 2 + mult * atrs[i]
    const bl = (c[i].high + c[i].low) / 2 - mult * atrs[i]
    fu = bu < fu || c[i - 1].close > fu ? bu : fu
    fl = bl > fl || c[i - 1].close < fl ? bl : fl
    if (c[i].close > fu) {
      dir = 1
      line = fl
    } else if (c[i].close < fl) {
      dir = -1
      line = fu
    } else if (dir === 1) {
      line = fl
    } else {
      line = fu
    }
  }
  return {
    value: line,
    display: fmt(line),
    signal: dir === 1 ? 'BUY' : 'SELL',
    detail: `ATR10×3 · trend ${dir === 1 ? 'UP' : 'DOWN'}`,
  }
}

function calcPsar(c: Candle[]): IndicatorCalc {
  if (c.length < 15) return INSUFFICIENT()
  let af = 0.02
  let ep = c[0].high
  let sar = c[0].low
  let up = true
  for (let i = 1; i < c.length; i++) {
    sar = sar + af * (ep - sar)
    if (up) {
      if (c[i].low < sar) {
        up = false
        sar = ep
        ep = c[i].low
        af = 0.02
      } else if (c[i].high > ep) {
        ep = c[i].high
        af = Math.min(0.2, af + 0.02)
      }
    } else {
      if (c[i].high > sar) {
        up = true
        sar = ep
        ep = c[i].high
        af = 0.02
      } else if (c[i].low < ep) {
        ep = c[i].low
        af = Math.min(0.2, af + 0.02)
      }
    }
  }
  return { value: sar, display: fmt(sar), signal: up ? 'BUY' : 'SELL', detail: `SAR ${up ? 'below' : 'above'} price · trend ${up ? 'UP' : 'DOWN'}` }
}

function calcIchimoku(c: Candle[]): IndicatorCalc {
  if (c.length < 78) return INSUFFICIENT()
  const hh = (start: number, len: number): number => {
    let h = -Infinity
    for (let i = start; i < start + len; i++) h = Math.max(h, c[i].high)
    return h
  }
  const ll = (start: number, len: number): number => {
    let l = Infinity
    for (let i = start; i < start + len; i++) l = Math.min(l, c[i].low)
    return l
  }
  const n = c.length
  const tenkan = (hh(n - 9, 9) + ll(n - 9, 9)) / 2
  const kijun = (hh(n - 26, 26) + ll(n - 26, 26)) / 2
  const i26 = n - 1 - 26
  const t26 = (hh(i26 - 8, 9) + ll(i26 - 8, 9)) / 2
  const k26 = (hh(i26 - 25, 26) + ll(i26 - 25, 26)) / 2
  const spanA = (t26 + k26) / 2
  const spanB = (hh(i26 - 51, 52) + ll(i26 - 51, 52)) / 2
  const cloudMid = (spanA + spanB) / 2
  const close = c[n - 1].close
  const diff = tenkan - kijun
  let sig: Signal = 'NEUTRAL'
  if (tenkan > kijun && close > cloudMid) sig = 'BUY'
  else if (tenkan < kijun && close < cloudMid) sig = 'SELL'
  return { value: diff, display: signed(diff), signal: sig, detail: `Tenkan ${fmt(tenkan)} · Kijun ${fmt(kijun)} · cloud ${fmt(cloudMid)}` }
}

function calcLinreg(c: Candle[]): IndicatorCalc {
  const cl = closesOf(c)
  if (cl.length < 50) return INSUFFICIENT()
  const n = 50
  const ys = cl.slice(-n)
  const xm = (n - 1) / 2
  let ym = 0
  for (const y of ys) ym += y
  ym /= n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (i - xm) * (ys[i] - ym)
    den += (i - xm) * (i - xm)
  }
  const slope = den === 0 ? 0 : num / den
  return { value: slope, display: signed(slope), signal: slope > 0 ? 'BUY' : slope < 0 ? 'SELL' : 'NEUTRAL', detail: `slope/bar ${signed(slope)} · 10-bar ${signed(slope * 10)}` }
}

// ------------------------------------------------------------
// MOMENTUM (10)
// ------------------------------------------------------------
function calcMacd(c: Candle[]): IndicatorCalc {
  const cl = closesOf(c)
  if (cl.length < 45) return INSUFFICIENT()
  const e12 = emaSeries(cl, 12)
  const e26 = emaSeries(cl, 26)
  const macd = e12.map((v, i) => v - e26[i])
  const sig = emaSeries(macd, 9)
  const hist = macd.map((v, i) => v - sig[i])
  const h = hist[hist.length - 1]
  const hp = hist[hist.length - 2]
  let s: Signal = 'NEUTRAL'
  if (h > 0 && h > hp) s = 'BUY'
  else if (h < 0 && h < hp) s = 'SELL'
  return {
    value: h,
    display: signed(h),
    signal: s,
    detail: `hist ${signed(h)} (prev ${signed(hp)}) · MACD ${signed(macd[macd.length - 1])}`,
  }
}

function calcRsi(c: Candle[]): IndicatorCalc {
  const cl = closesOf(c)
  const rsi = rsiAt(cl, 14)
  if (rsi === null) return INSUFFICIENT()
  let s: Signal = 'NEUTRAL'
  if (rsi < 30) s = 'BUY'
  else if (rsi > 70) s = 'SELL'
  const detail = rsi < 30 ? 'oversold' : rsi > 70 ? 'overbought' : `weak bias ${rsi > 50 ? 'bullish' : 'bearish'}`
  return { value: rsi, display: rsi.toFixed(1), signal: s, detail }
}

function calcStoch(c: Candle[]): IndicatorCalc {
  const k = stochK(c, 14, 3)
  if (k === null) return INSUFFICIENT()
  let s: Signal = 'NEUTRAL'
  if (k < 20) s = 'BUY'
  else if (k > 80) s = 'SELL'
  return { value: k, display: k.toFixed(1), signal: s, detail: k < 20 ? 'oversold' : k > 80 ? 'overbought' : 'mid-range' }
}

function calcCci(c: Candle[]): IndicatorCalc {
  if (c.length < 25) return INSUFFICIENT()
  const tp = c.map((x) => (x.high + x.low + x.close) / 3)
  const sma = smaAt(tp, 20)
  if (sma === null) return INSUFFICIENT()
  let md = 0
  for (let i = tp.length - 20; i < tp.length; i++) md += Math.abs(tp[i] - sma)
  md /= 20
  const cci = md === 0 ? 0 : (tp[tp.length - 1] - sma) / (0.015 * md)
  let s: Signal = 'NEUTRAL'
  if (cci < -100) s = 'BUY'
  else if (cci > 100) s = 'SELL'
  return { value: cci, display: cci.toFixed(1), signal: s, detail: cci < -100 ? 'oversold' : cci > 100 ? 'overbought' : 'inside ±100' }
}

function calcMomentum(c: Candle[]): IndicatorCalc {
  const cl = closesOf(c)
  if (cl.length < 11) return INSUFFICIENT()
  const mom = cl[cl.length - 1] - cl[cl.length - 11]
  return { value: mom, display: signed(mom), signal: mom > 0 ? 'BUY' : mom < 0 ? 'SELL' : 'NEUTRAL', detail: 'MOM(10)' }
}

function calcWilliamsr(c: Candle[]): IndicatorCalc {
  if (c.length < 15) return INSUFFICIENT()
  let hh = -Infinity
  let ll = Infinity
  for (let i = c.length - 14; i < c.length; i++) {
    hh = Math.max(hh, c[i].high)
    ll = Math.min(ll, c[i].low)
  }
  if (hh === ll) return { value: -50, display: '-50.0', signal: 'NEUTRAL', detail: 'flat range' }
  const wr = (-100 * (hh - c[c.length - 1].close)) / (hh - ll)
  let s: Signal = 'NEUTRAL'
  if (wr < -80) s = 'BUY'
  else if (wr > -20) s = 'SELL'
  return { value: wr, display: wr.toFixed(1), signal: s, detail: wr < -80 ? 'oversold' : wr > -20 ? 'overbought' : 'mid-range' }
}

function calcTsi(c: Candle[]): IndicatorCalc {
  const cl = closesOf(c)
  if (cl.length < 50) return INSUFFICIENT()
  const m: number[] = []
  for (let i = 1; i < cl.length; i++) m.push(cl[i] - cl[i - 1])
  const e1 = emaSeries(m, 25)
  const e2 = emaSeries(e1, 13)
  const a1 = emaSeries(m.map(Math.abs), 25)
  const a2 = emaSeries(a1, 13)
  const denom = a2[a2.length - 1]
  if (denom === 0) return { value: 0, display: '0.0', signal: 'NEUTRAL', detail: 'no momentum' }
  const tsi = (100 * e2[e2.length - 1]) / denom
  return { value: tsi, display: tsi.toFixed(1), signal: tsi > 0 ? 'BUY' : tsi < 0 ? 'SELL' : 'NEUTRAL', detail: 'TSI(25,13)' }
}

function calcRoc(c: Candle[]): IndicatorCalc {
  const cl = closesOf(c)
  if (cl.length < 13) return INSUFFICIENT()
  const prev = cl[cl.length - 13]
  if (prev === 0) return INSUFFICIENT()
  const roc = ((cl[cl.length - 1] - prev) / prev) * 100
  return { value: roc, display: `${signed(roc, 2)}%`, signal: roc > 0 ? 'BUY' : roc < 0 ? 'SELL' : 'NEUTRAL', detail: 'ROC(12)' }
}

function calcStc(c: Candle[]): IndicatorCalc {
  const cl = closesOf(c)
  if (cl.length < 60) return INSUFFICIENT()
  const e12 = emaSeries(cl, 12)
  const e26 = emaSeries(cl, 26)
  const macd = e12.map((v, i) => v - e26[i])
  const k1: number[] = []
  for (let i = 9; i < macd.length; i++) k1.push(stochOf(macd, 10, i))
  if (k1.length < 13) return INSUFFICIENT()
  const d1 = emaSeries(k1, 3)
  const k2: number[] = []
  for (let i = 9; i < d1.length; i++) k2.push(stochOf(d1, 10, i))
  if (k2.length < 3) return INSUFFICIENT()
  const stc = emaSeries(k2, 3)[k2.length - 1]
  let s: Signal = 'NEUTRAL'
  if (stc < 25) s = 'BUY'
  else if (stc > 75) s = 'SELL'
  return { value: stc, display: stc.toFixed(1), signal: s, detail: stc < 25 ? 'cycle low' : stc > 75 ? 'cycle high' : 'mid-cycle' }
}

function calcUo(c: Candle[]): IndicatorCalc {
  if (c.length < 30) return INSUFFICIENT()
  const bp: number[] = []
  const tr: number[] = []
  for (let i = 0; i < c.length; i++) {
    const prevClose = i === 0 ? c[0].close : c[i - 1].close
    bp.push(c[i].close - Math.min(c[i].low, prevClose))
    tr.push(Math.max(c[i].high, prevClose) - Math.min(c[i].low, prevClose))
  }
  const avg = (period: number): number => {
    let b = 0
    let t = 0
    for (let i = c.length - period; i < c.length; i++) {
      b += bp[i]
      t += tr[i]
    }
    return t === 0 ? 0 : b / t
  }
  const uo = (100 * (4 * avg(7) + 2 * avg(14) + avg(28))) / 7
  let s: Signal = 'NEUTRAL'
  if (uo < 30) s = 'BUY'
  else if (uo > 70) s = 'SELL'
  return { value: uo, display: uo.toFixed(1), signal: s, detail: uo < 30 ? 'oversold' : uo > 70 ? 'overbought' : 'mid-range' }
}

// ------------------------------------------------------------
// VOLATILITY (7)
// ------------------------------------------------------------
function calcBollinger(c: Candle[]): IndicatorCalc {
  const cl = closesOf(c)
  const sma = smaAt(cl, 20)
  if (sma === null) return INSUFFICIENT()
  let ss = 0
  for (let i = cl.length - 20; i < cl.length; i++) ss += (cl[i] - sma) * (cl[i] - sma)
  const sd = Math.sqrt(ss / 20)
  const upper = sma + 2 * sd
  const lower = sma - 2 * sd
  const last = cl[cl.length - 1]
  let s: Signal = 'NEUTRAL'
  if (last < lower) s = 'BUY'
  else if (last > upper) s = 'SELL'
  const bw = sma === 0 ? 0 : ((upper - lower) / sma) * 100
  return { value: bw, display: `${bw.toFixed(1)}%`, signal: s, detail: `bandwidth · L ${fmt(lower)} · U ${fmt(upper)}` }
}

function calcAtr(c: Candle[]): IndicatorCalc {
  const atr = atrValue(c, 14)
  if (atr === null) return INSUFFICIENT()
  const prev = atrValue(c, 14, c.length - 2)
  const chg = prev && prev !== 0 ? ((atr - prev) / prev) * 100 : 0
  return { value: atr, display: fmt(atr), signal: 'NEUTRAL', detail: `ATR14 · ${signed(chg, 1)}% vs prev` }
}

function calcKeltner(c: Candle[]): IndicatorCalc {
  const cl = closesOf(c)
  const mid = emaAt(cl, 20)
  const atr = atrValue(c, 10)
  if (mid === null || atr === null) return INSUFFICIENT()
  const upper = mid + 1.5 * atr
  const lower = mid - 1.5 * atr
  const last = cl[cl.length - 1]
  let s: Signal = 'NEUTRAL'
  if (last < lower) s = 'BUY'
  else if (last > upper) s = 'SELL'
  return { value: last - mid, display: signed(last - mid), signal: s, detail: `EMA20 ${fmt(mid)} ± ${fmt(1.5 * atr)}` }
}

function calcDonchian(c: Candle[]): IndicatorCalc {
  if (c.length < 21) return INSUFFICIENT()
  const win = c.slice(-21, -1) // 20 bars excluding current
  let hh = -Infinity
  let ll = Infinity
  for (const k of win) {
    hh = Math.max(hh, k.high)
    ll = Math.min(ll, k.low)
  }
  const last = c[c.length - 1].close
  if (hh === ll) return { value: 50, display: '50%', signal: 'NEUTRAL', detail: 'flat channel' }
  let s: Signal = 'NEUTRAL'
  if (last >= hh) s = 'BUY'
  else if (last <= ll) s = 'SELL'
  const pos = ((last - ll) / (hh - ll)) * 100
  return { value: pos, display: `${pos.toFixed(0)}%`, signal: s, detail: `20-bar H ${fmt(hh)} · L ${fmt(ll)}` }
}

function calcStddev(c: Candle[]): IndicatorCalc {
  const cl = closesOf(c)
  const sma = smaAt(cl, 20)
  if (sma === null) return INSUFFICIENT()
  let ss = 0
  for (let i = cl.length - 20; i < cl.length; i++) ss += (cl[i] - sma) * (cl[i] - sma)
  const sd = Math.sqrt(ss / 20)
  const cv = sma === 0 ? 0 : (sd / sma) * 100
  return { value: sd, display: fmt(sd), signal: 'NEUTRAL', detail: `σ20 · CV ${cv.toFixed(2)}%` }
}

function calcChaikin(c: Candle[]): IndicatorCalc {
  if (c.length < 25) return INSUFFICIENT()
  const hl = c.map((x) => x.high - x.low)
  const emaHl = emaSeries(hl, 10)
  const now = emaHl[emaHl.length - 1]
  const prevIdx = emaHl.length - 11
  const prev = prevIdx >= 0 ? emaHl[prevIdx] : null
  if (prev === null || prev === 0) return INSUFFICIENT()
  const chg = ((now - prev) / prev) * 100
  return { value: chg, display: `${signed(chg, 1)}%`, signal: 'NEUTRAL', detail: `EMA10(H-L) ${fmt(now)}` }
}

function calcVolratio(c: Candle[]): IndicatorCalc {
  const atr = atrValue(c, 14)
  if (atr === null || atr === 0) return INSUFFICIENT()
  const lastTr = trueRange(c, c.length - 1)
  const ratio = lastTr / atr
  let s: Signal = 'NEUTRAL'
  if (ratio > 1.5) {
    const lastC = c[c.length - 1]
    s = lastC.close >= lastC.open ? 'BUY' : 'SELL'
  }
  return { value: ratio, display: `${ratio.toFixed(2)}×`, signal: s, detail: ratio > 1.5 ? 'volatility spike' : 'normal range' }
}

// ------------------------------------------------------------
// VOLUME (6)
// ------------------------------------------------------------
function calcVwap(c: Candle[]): IndicatorCalc {
  if (c.length < 5) return INSUFFICIENT()
  const win = c.slice(-100)
  let pv = 0
  let vv = 0
  for (const k of win) {
    const tp = (k.high + k.low + k.close) / 3
    pv += tp * k.volume
    vv += k.volume
  }
  if (vv === 0) return INSUFFICIENT()
  const vwap = pv / vv
  const last = win[win.length - 1].close
  const diff = last - vwap
  return { value: diff, display: signed(diff), signal: diff > 0 ? 'BUY' : diff < 0 ? 'SELL' : 'NEUTRAL', detail: `VWAP ${fmt(vwap)}` }
}

function calcObv(c: Candle[]): IndicatorCalc {
  if (c.length < 25) return INSUFFICIENT()
  const obv: number[] = [0]
  for (let i = 1; i < c.length; i++) {
    const d = c[i].close - c[i - 1].close
    obv.push(obv[i - 1] + (d > 0 ? c[i].volume : d < 0 ? -c[i].volume : 0))
  }
  const slope = obv[obv.length - 1] - obv[obv.length - 21]
  return {
    value: slope,
    display: fmtVol(slope),
    signal: slope > 0 ? 'BUY' : slope < 0 ? 'SELL' : 'NEUTRAL',
    detail: `OBV ${fmtVol(obv[obv.length - 1])} · 20-bar slope`,
  }
}

function calcMfi(c: Candle[]): IndicatorCalc {
  if (c.length < 16) return INSUFFICIENT()
  let pos = 0
  let neg = 0
  for (let i = c.length - 14; i < c.length; i++) {
    const tp = (c[i].high + c[i].low + c[i].close) / 3
    const tpPrev = (c[i - 1].high + c[i - 1].low + c[i - 1].close) / 3
    const flow = tp * c[i].volume
    if (tp > tpPrev) pos += flow
    else if (tp < tpPrev) neg += flow
  }
  const mfi = neg === 0 ? 100 : 100 - 100 / (1 + pos / neg)
  let s: Signal = 'NEUTRAL'
  if (mfi < 20) s = 'BUY'
  else if (mfi > 80) s = 'SELL'
  return { value: mfi, display: mfi.toFixed(1), signal: s, detail: mfi < 20 ? 'oversold' : mfi > 80 ? 'overbought' : 'mid-range' }
}

function calcTickvol(c: Candle[]): IndicatorCalc {
  const avg = smaAt(c.map((x) => x.volume), 20)
  if (avg === null || avg === 0) return INSUFFICIENT()
  const lastC = c[c.length - 1]
  const ratio = lastC.volume / avg
  let s: Signal = 'NEUTRAL'
  if (ratio > 1.5) s = lastC.close >= lastC.open ? 'BUY' : 'SELL'
  return { value: ratio, display: `${ratio.toFixed(2)}×`, signal: s, detail: `vol ${lastC.volume.toFixed(0)} vs avg ${avg.toFixed(0)}` }
}

function calcVolumeprofile(c: Candle[]): IndicatorCalc {
  if (c.length < 20) return INSUFFICIENT()
  const win = c.slice(-100)
  let minC = Infinity
  let maxC = -Infinity
  for (const k of win) {
    minC = Math.min(minC, k.close)
    maxC = Math.max(maxC, k.close)
  }
  if (maxC <= minC) return { value: 0, display: fmt(minC), signal: 'NEUTRAL', detail: 'flat profile' }
  const width = (maxC - minC) / 10
  const buckets = new Array<number>(10).fill(0)
  let total = 0
  for (const k of win) {
    const idx = Math.min(9, Math.max(0, Math.floor((k.close - minC) / width)))
    buckets[idx] += k.volume
    total += k.volume
  }
  let pocIdx = 0
  for (let i = 1; i < 10; i++) if (buckets[i] > buckets[pocIdx]) pocIdx = i
  const poc = minC + (pocIdx + 0.5) * width
  const last = win[win.length - 1].close
  const share = total === 0 ? 0 : (buckets[pocIdx] / total) * 100
  return {
    value: poc,
    display: fmt(poc),
    signal: last > poc ? 'BUY' : last < poc ? 'SELL' : 'NEUTRAL',
    detail: `POC · ${share.toFixed(0)}% of volume`,
  }
}

function calcAd(c: Candle[]): IndicatorCalc {
  if (c.length < 25) return INSUFFICIENT()
  const ad: number[] = [0]
  for (let i = 1; i < c.length; i++) {
    const rngHL = c[i].high - c[i].low
    const clv = rngHL === 0 ? 0 : ((c[i].close - c[i].low) - (c[i].high - c[i].close)) / rngHL
    ad.push(ad[i - 1] + clv * c[i].volume)
  }
  const slope = ad[ad.length - 1] - ad[ad.length - 21]
  return {
    value: slope,
    display: fmtVol(slope),
    signal: slope > 0 ? 'BUY' : slope < 0 ? 'SELL' : 'NEUTRAL',
    detail: `A/D ${fmtVol(ad[ad.length - 1])} · 20-bar slope`,
  }
}

// ------------------------------------------------------------
// Dispatcher
// ------------------------------------------------------------
const CALCULATORS: Record<string, (c: Candle[]) => IndicatorCalc> = {
  // Trend
  ema: calcEma,
  sma: calcSma,
  hma: calcHma,
  supertrend: calcSupertrend,
  psar: calcPsar,
  ichimoku: calcIchimoku,
  linreg: calcLinreg,
  // Momentum
  macd: calcMacd,
  rsi: calcRsi,
  stoch: calcStoch,
  cci: calcCci,
  momentum: calcMomentum,
  williamsr: calcWilliamsr,
  tsi: calcTsi,
  roc: calcRoc,
  stc: calcStc,
  uo: calcUo,
  // Volatility
  bollinger: calcBollinger,
  atr: calcAtr,
  keltner: calcKeltner,
  donchian: calcDonchian,
  stddev: calcStddev,
  chaikin: calcChaikin,
  volratio: calcVolratio,
  // Volume
  vwap: calcVwap,
  obv: calcObv,
  mfi: calcMfi,
  tickvol: calcTickvol,
  volumeprofile: calcVolumeprofile,
  ad: calcAd,
}

export function computeIndicatorSignal(id: string, candles: Candle[]): IndicatorCalc {
  const fn = CALCULATORS[id]
  if (!fn) return { value: 0, display: '—', signal: 'NEUTRAL' }
  try {
    return fn(candles)
  } catch {
    return INSUFFICIENT()
  }
}

export function computeIndicatorSet(ids: string[], candles: Candle[]): Record<string, IndicatorCalc> {
  const out: Record<string, IndicatorCalc> = {}
  for (const id of ids) out[id] = computeIndicatorSignal(id, candles)
  return out
}
