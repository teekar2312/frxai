'use client'

import { create } from 'zustand'

export type TabId =
  | 'overview'
  | 'trading'
  | 'analysis'
  | 'news'
  | 'backtest'
  | 'alerts'
  | 'logs'
  | 'settings'
  | 'setup'

/** UI display density (spec: compact / dense / minimal) */
export type UiDensity = 'compact' | 'dense' | 'minimal'

export const DENSITY_STORAGE_KEY = 'finex:uiDensity'

interface AppState {
  activeTab: TabId
  setActiveTab: (tab: TabId) => void
  /** force refresh counters for badges */
  refreshTick: number
  bumpRefresh: () => void
  /** currently selected trading pair (syncs overview watchlist ↔ trading chart) */
  selectedPair: string
  setSelectedPair: (pair: string) => void
  /** UI display density — applied as data-density on <html> (CSS-driven), persisted to localStorage */
  uiDensity: UiDensity
  setUiDensity: (density: UiDensity) => void
}

export const useAppStore = create<AppState>((set) => ({
  activeTab: 'overview',
  setActiveTab: (activeTab) => set({ activeTab }),
  refreshTick: 0,
  bumpRefresh: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
  selectedPair: 'EURUSD',
  setSelectedPair: (selectedPair) => set({ selectedPair }),
  uiDensity: 'compact',
  setUiDensity: (uiDensity) => set({ uiDensity }),
}))
