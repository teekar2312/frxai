'use client'

import { useEffect } from 'react'
import { Header } from '@/components/layout/header'
import { SidebarNav } from '@/components/layout/sidebar'
import { Footer } from '@/components/layout/footer'
import { useAppStore, DENSITY_STORAGE_KEY, type UiDensity } from '@/lib/store'

import OverviewPanel from '@/components/panels/overview-panel'
import TradingPanel from '@/components/panels/trading-panel'
import AnalysisPanel from '@/components/panels/analysis-panel'
import NewsPanel from '@/components/panels/news-panel'
import BacktestPanel from '@/components/panels/backtest-panel'
import AlertsPanel from '@/components/panels/alerts-panel'
import LogsPanel from '@/components/panels/logs-panel'
import SettingsPanel from '@/components/panels/settings-panel'
import SetupPanel from '@/components/panels/setup-panel'

function isDensity(v: string | null): v is UiDensity {
  return v === 'compact' || v === 'dense' || v === 'minimal'
}

/**
 * Shell dashboard FINEX AI (client). Hanya dirender setelah session
 * tervalidasi di server (lihat src/app/page.tsx).
 */
export function FinexApp({ username }: { username: string }) {
  const activeTab = useAppStore((s) => s.activeTab)
  const uiDensity = useAppStore((s) => s.uiDensity)

  // Hydrate UI density from localStorage once (attribute itself was already
  // set pre-paint by the inline script in layout.tsx — this only syncs the store).
  useEffect(() => {
    const saved = window.localStorage.getItem(DENSITY_STORAGE_KEY)
    if (isDensity(saved) && saved !== useAppStore.getState().uiDensity) {
      useAppStore.getState().setUiDensity(saved)
    }
  }, [])

  // Apply density to <html> + persist whenever it changes.
  useEffect(() => {
    document.documentElement.dataset.density = uiDensity
    try {
      window.localStorage.setItem(DENSITY_STORAGE_KEY, uiDensity)
    } catch {
      /* private mode — non-fatal */
    }
  }, [uiDensity])

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header username={username} />
      <div className="flex flex-1 overflow-hidden">
        <aside className="hidden shrink-0 border-r bg-background md:block">
          <SidebarNav />
        </aside>
        <main className="flex-1 overflow-y-auto scrollbar-thin" aria-live="polite">
          {activeTab === 'overview' && <OverviewPanel />}
          {activeTab === 'trading' && <TradingPanel />}
          {activeTab === 'analysis' && <AnalysisPanel />}
          {activeTab === 'news' && <NewsPanel />}
          {activeTab === 'backtest' && <BacktestPanel />}
          {activeTab === 'alerts' && <AlertsPanel />}
          {activeTab === 'logs' && <LogsPanel />}
          {activeTab === 'settings' && <SettingsPanel />}
          {activeTab === 'setup' && <SetupPanel />}
        </main>
      </div>
      {/* Mobile bottom navigation (in flow, above footer) */}
      <div className="border-t bg-background md:hidden [&_nav]:justify-evenly [&_nav]:px-1 [&_nav]:py-1 [&_button]:flex-col [&_button]:gap-0.5 [&_button]:text-[9px]">
        <SidebarNav />
      </div>
      <Footer />
    </div>
  )
}
