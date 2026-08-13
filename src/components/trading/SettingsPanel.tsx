'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Settings, RefreshCw, Cable } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { type TradingConfig } from './shared';
import { Mt5ConnectionPanel } from './Mt5ConnectionPanel';
import { useTradingStore } from '@/lib/trading-store';

export function SettingsPanel() {
  const { tradingMode } = useTradingStore();
  const [config, setConfig] = useState<TradingConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);

  // Fetch config
  const fetchConfig = useCallback(async () => {
    try {
      setConfigLoading(true);
      const res = await fetch('/api/config');
      if (res.ok) {
        const data = await res.json();
        if (data.config) setConfig(data.config as TradingConfig);
      }
    } catch {
      // silent
    } finally {
      setConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // Save config
  const handleSaveConfig = async () => {
    if (!config) return;
    setConfigSaving(true);
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (res.ok) {
        toast.success('Configuration saved');
      } else {
        toast.error('Failed to save configuration');
      }
    } catch {
      toast.error('Network error saving config');
    } finally {
      setConfigSaving(false);
    }
  };

  // Reset config
  const handleResetConfig = async () => {
    setConfigLoading(true);
    try {
      await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset: true }),
      });
      toast.success('Configuration reset to defaults');
      fetchConfig();
    } catch {
      toast.error('Failed to reset configuration');
    } finally {
      setConfigLoading(false);
    }
  };

  if (configLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48 bg-zinc-800" />
        <Skeleton className="h-64 w-full bg-zinc-800" />
      </div>
    );
  }

  if (!config) {
    return (
      <Card className="bg-zinc-900 border-zinc-800 p-8">
        <div className="text-center">
          <Settings className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
          <p className="text-sm text-zinc-400">Unable to load configuration</p>
        </div>
      </Card>
    );
  }

  const updateConfig = (key: keyof TradingConfig, value: number | boolean | string) => {
    setConfig(prev => prev ? { ...prev, [key]: value } : prev);
  };

  return (
    <div className="space-y-4">
      {/* MT5 Integration */}
      <Mt5ConnectionPanel />

      {/* Mode indicator on config card */}
      <Card className="bg-zinc-900 border-zinc-800 p-4">
        <CardHeader className="p-0 pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm text-white flex items-center gap-2">
              <Settings className="w-4 h-4" /> Trading Configuration
              {tradingMode === 'mt5_live' && (
                <span className="text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full">
                  MT5 LIVE - Some settings controlled by broker
                </span>
              )}
            </CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleResetConfig} className="border-zinc-700 text-zinc-300 h-8 text-xs">
                Reset Defaults
              </Button>
              <Button size="sm" onClick={handleSaveConfig} disabled={configSaving}
                className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs">
                {configSaving ? <RefreshCw className="w-3 h-3 animate-spin" /> : null}
                Save Changes
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Risk settings */}
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Risk Management</h4>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-zinc-300 text-xs">Risk per Trade (%)</Label>
                  <Input type="number" step="0.1" value={config.riskPerTrade}
                    onChange={(e) => updateConfig('riskPerTrade', parseFloat(e.target.value) || 1)}
                    className="bg-zinc-800 border-zinc-700 text-white w-20 h-8 text-xs" />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-zinc-300 text-xs">SL Min (pips)</Label>
                  <Input type="number" value={config.stopLossMin}
                    onChange={(e) => updateConfig('stopLossMin', parseInt(e.target.value) || 5)}
                    className="bg-zinc-800 border-zinc-700 text-white w-20 h-8 text-xs" />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-zinc-300 text-xs">SL Max (pips)</Label>
                  <Input type="number" value={config.stopLossMax}
                    onChange={(e) => updateConfig('stopLossMax', parseInt(e.target.value) || 15)}
                    className="bg-zinc-800 border-zinc-700 text-white w-20 h-8 text-xs" />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-zinc-300 text-xs">R:R Ratio</Label>
                  <Input type="number" step="0.1" value={config.riskRewardRatio}
                    onChange={(e) => updateConfig('riskRewardRatio', parseFloat(e.target.value) || 1.5)}
                    className="bg-zinc-800 border-zinc-700 text-white w-20 h-8 text-xs" />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-zinc-300 text-xs">Max Positions</Label>
                  <Input type="number" value={config.maxOpenPositions}
                    onChange={(e) => updateConfig('maxOpenPositions', parseInt(e.target.value) || 3)}
                    className="bg-zinc-800 border-zinc-700 text-white w-20 h-8 text-xs" />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-zinc-300 text-xs">Daily Risk Limit (%)</Label>
                  <Input type="number" step="0.1" value={config.dailyRiskLimit}
                    onChange={(e) => updateConfig('dailyRiskLimit', parseFloat(e.target.value) || 3)}
                    className="bg-zinc-800 border-zinc-700 text-white w-20 h-8 text-xs" />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-zinc-300 text-xs">Daily Target Min (%)</Label>
                  <Input type="number" step="0.1" value={config.dailyTargetMin}
                    onChange={(e) => updateConfig('dailyTargetMin', parseFloat(e.target.value) || 1)}
                    className="bg-zinc-800 border-zinc-700 text-white w-20 h-8 text-xs" />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-zinc-300 text-xs">Daily Target Max (%)</Label>
                  <Input type="number" step="0.1" value={config.dailyTargetMax}
                    onChange={(e) => updateConfig('dailyTargetMax', parseFloat(e.target.value) || 3)}
                    className="bg-zinc-800 border-zinc-700 text-white w-20 h-8 text-xs" />
                </div>
              </div>
            </div>

            {/* Broker settings */}
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Broker Settings</h4>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-zinc-300 text-xs">Leverage</Label>
                  <Input type="number" value={config.leverage}
                    onChange={(e) => updateConfig('leverage', parseInt(e.target.value) || 500)}
                    className="bg-zinc-800 border-zinc-700 text-white w-20 h-8 text-xs" />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-zinc-300 text-xs">Spread (pip)</Label>
                  <Input type="number" step="0.1" value={config.spreadPip}
                    onChange={(e) => updateConfig('spreadPip', parseFloat(e.target.value) || 0.5)}
                    className="bg-zinc-800 border-zinc-700 text-white w-20 h-8 text-xs" />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-zinc-300 text-xs">Commission ($/lot)</Label>
                  <Input type="number" step="0.1" value={config.commissionPerLot}
                    onChange={(e) => updateConfig('commissionPerLot', parseFloat(e.target.value) || 1)}
                    className="bg-zinc-800 border-zinc-700 text-white w-20 h-8 text-xs" />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-zinc-300 text-xs">Margin Call (%)</Label>
                  <Input type="number" value={config.marginCallLevel}
                    onChange={(e) => updateConfig('marginCallLevel', parseInt(e.target.value) || 50)}
                    className="bg-zinc-800 border-zinc-700 text-white w-20 h-8 text-xs" />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-zinc-300 text-xs">Stop Out (%)</Label>
                  <Input type="number" value={config.stopOutLevel}
                    onChange={(e) => updateConfig('stopOutLevel', parseInt(e.target.value) || 20)}
                    className="bg-zinc-800 border-zinc-700 text-white w-20 h-8 text-xs" />
                </div>
              </div>
            </div>

            {/* Auto trading settings */}
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Automation</h4>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-zinc-300 text-xs">Auto Trading</Label>
                  <Switch checked={config.autoTrading} onCheckedChange={(v) => updateConfig('autoTrading', v)} />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-zinc-300 text-xs">Auto Trailing Stop</Label>
                  <Switch checked={config.autoTrailingStop} onCheckedChange={(v) => updateConfig('autoTrailingStop', v)} />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-zinc-300 text-xs">Trailing Stop (pips)</Label>
                  <Input type="number" value={config.trailingStopPips}
                    onChange={(e) => updateConfig('trailingStopPips', parseInt(e.target.value) || 10)}
                    className="bg-zinc-800 border-zinc-700 text-white w-20 h-8 text-xs" />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-zinc-300 text-xs">Avoid News Trading</Label>
                  <Switch checked={config.avoidNewsTrading} onCheckedChange={(v) => updateConfig('avoidNewsTrading', v)} />
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
