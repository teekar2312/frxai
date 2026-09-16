'use client'

import { useTheme } from 'next-themes'
import { Moon, Sun, Activity, Landmark, TrendingUp, TrendingDown, Bot, RefreshCw, Rows3, AlignJustify, Expand, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { LiveDot } from '@/components/shared/primitives'
import { usePolling, fmtMoney, fmtPct } from '@/hooks/use-polling'
import type { EnginePollResponse } from '@/lib/types'
import { useAppStore, type UiDensity } from '@/lib/store'
import { cn } from '@/lib/utils'

const DENSITY_OPTIONS: { value: UiDensity; label: string; hint: string; icon: typeof Rows3 }[] = [
  { value: 'compact', label: 'Compact', hint: 'Seimbang (default)', icon: Rows3 },
  { value: 'dense', label: 'Dense', hint: 'Maksimal data di layar', icon: AlignJustify },
  { value: 'minimal', label: 'Minimal', hint: 'Lega & mudah dibaca', icon: Expand },
]

export function Header() {
  const { theme, setTheme } = useTheme()
  const { data, refresh } = usePolling<EnginePollResponse>('/api/engine', 2000)
  const bumpRefresh = useAppStore((s) => s.bumpRefresh)
  const uiDensity = useAppStore((s) => s.uiDensity)
  const setUiDensity = useAppStore((s) => s.setUiDensity)

  const account = data?.account
  const status = data?.status
  const floating = account?.floatingPnl ?? 0
  const dailyPct = data?.dailyPnlPct ?? 0

  const toggleAi = async (checked: boolean) => {
    try {
      const cur = await fetch('/api/settings', { cache: 'no-store' }).then((r) => r.json())
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...cur, tradingMode: checked ? 'ai' : 'manual' }),
      })
      refresh()
      bumpRefresh()
    } catch {
      /* handled by toast in panels */
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="flex h-12 items-center gap-2 px-3 sm:gap-3 sm:px-4">
        {/* Brand */}
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-600 text-white">
            <Activity className="h-4 w-4" />
          </div>
          <div className="leading-none">
            <div className="text-sm font-bold tracking-tight">FINEX<span className="text-emerald-500">AI</span></div>
            <div className="hidden text-[9px] uppercase tracking-widest text-muted-foreground sm:block">Trading System</div>
          </div>
        </div>

        {/* Engine mode — hidden on phones (mode juga terlihat di tab Overview & Settings) */}
        <Badge
          variant="outline"
          className={cn(
            'hidden gap-1.5 border font-mono text-[10px] sm:inline-flex',
            status?.mode === 'LIVE' ? 'border-red-500/40 text-red-500' : 'border-emerald-500/40 text-emerald-500'
          )}
        >
          <LiveDot ok={status?.connected ?? false} />
          {status?.mode === 'LIVE' ? 'LIVE ENGINE' : 'DEMO ENGINE'}
        </Badge>

        <div className="mx-auto hidden items-center gap-4 md:flex">
          {/* Balance / Equity */}
          <div className="flex items-center gap-1.5 text-xs">
            <Landmark className="h-3.5 w-3.5 text-muted-foreground" />
            <div className="leading-none">
              <div className="num font-semibold">{fmtMoney(account?.equity ?? 0)}</div>
              <div className="text-[9px] uppercase text-muted-foreground">Equity</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            {floating >= 0 ? <TrendingUp className="h-3.5 w-3.5 text-emerald-500" /> : <TrendingDown className="h-3.5 w-3.5 text-red-500" />}
            <div className="leading-none">
              <div className={cn('num font-semibold', floating >= 0 ? 'text-emerald-500' : 'text-red-500')}>
                {fmtMoney(floating)}
              </div>
              <div className="text-[9px] uppercase text-muted-foreground">Floating</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <div className="leading-none">
              <div className={cn('num font-semibold', dailyPct >= 0 ? 'text-emerald-500' : 'text-red-500')}>{fmtPct(dailyPct)}</div>
              <div className="text-[9px] uppercase text-muted-foreground">Daily P/L</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <div className="leading-none">
              <div className="num font-semibold">
                {data?.openPositions ?? 0}
                <span className="text-muted-foreground">/{status ? '3' : '—'}</span>
              </div>
              <div className="text-[9px] uppercase text-muted-foreground">Positions</div>
            </div>
          </div>
        </div>

        {/* Right controls */}
        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <div className="flex items-center gap-1.5">
            <Bot className={cn('h-3.5 w-3.5', status?.aiTrading ? 'text-emerald-500' : 'text-muted-foreground')} />
            <span className="hidden text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:inline">
              AI Trade
            </span>
            <Switch checked={status?.aiTrading ?? false} onCheckedChange={toggleAi} aria-label="Toggle AI auto trading" />
          </div>

          {/* UI density switcher (compact / dense / minimal) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="relative h-8 w-8"
                aria-label="Ubah mode tampilan (kepadatan UI)"
                title="Mode tampilan"
              >
                <AlignJustify
                  className={cn(
                    'h-4 w-4 transition-opacity',
                    uiDensity === 'dense' ? 'opacity-100' : 'opacity-0'
                  )}
                />
                <Expand
                  className={cn(
                    'absolute h-4 w-4 transition-opacity',
                    uiDensity === 'minimal' ? 'opacity-100' : 'opacity-0'
                  )}
                />
                <Rows3
                  className={cn(
                    'absolute h-4 w-4 transition-opacity',
                    uiDensity === 'compact' ? 'opacity-100' : 'opacity-0'
                  )}
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider">
                Mode Tampilan
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {DENSITY_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => setUiDensity(opt.value)}
                  aria-checked={uiDensity === opt.value}
                  className="gap-2"
                >
                  <opt.icon className="h-3.5 w-3.5 text-muted-foreground" />
                  <div className="flex flex-1 flex-col">
                    <span className="text-xs font-medium">{opt.label}</span>
                    <span className="text-[10px] text-muted-foreground">{opt.hint}</span>
                  </div>
                  {uiDensity === opt.value ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => refresh()}
            aria-label="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label="Toggle theme"
          >
            <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          </Button>
        </div>
      </div>
    </header>
  )
}
