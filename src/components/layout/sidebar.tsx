'use client'

import {
  LayoutDashboard,
  ArrowLeftRight,
  BrainCircuit,
  Newspaper,
  FlaskConical,
  BellRing,
  ScrollText,
  Settings2,
  Rocket,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore, type TabId } from '@/lib/store'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

const NAV: { id: TabId; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'trading', label: 'Trading', icon: ArrowLeftRight },
  { id: 'analysis', label: 'AI Analysis', icon: BrainCircuit },
  { id: 'news', label: 'News', icon: Newspaper },
  { id: 'backtest', label: 'Backtest', icon: FlaskConical },
  { id: 'alerts', label: 'Alerts', icon: BellRing },
  { id: 'logs', label: 'Logs', icon: ScrollText },
  { id: 'settings', label: 'Settings', icon: Settings2 },
  { id: 'setup', label: 'Engine Setup', icon: Rocket },
]

export function SidebarNav() {
  const activeTab = useAppStore((s) => s.activeTab)
  const setActiveTab = useAppStore((s) => s.setActiveTab)

  return (
    <TooltipProvider delayDuration={0}>
      <nav
        aria-label="Main navigation"
        className="flex gap-1 overflow-x-auto px-2 py-1.5 md:w-14 md:flex-col md:overflow-visible md:px-1.5 scrollbar-thin"
      >
        {NAV.map((item) => {
          const Icon = item.icon
          const active = activeTab === item.id
          return (
            <Tooltip key={item.id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setActiveTab(item.id)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors md:w-full md:justify-center md:px-0 md:py-2',
                    active
                      ? 'bg-emerald-600/15 text-emerald-600 dark:text-emerald-400'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="md:hidden">{item.label}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="md:block hidden">
                {item.label}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </nav>
    </TooltipProvider>
  )
}
