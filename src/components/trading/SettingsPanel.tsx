'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Settings, RefreshCw, Cable, Shield, FileText, Info, Brain, CheckCircle2, XCircle, Mail } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { type TradingConfig } from './shared';
import { Mt5ConnectionPanel } from './Mt5ConnectionPanel';
import { useTradingStore } from '@/lib/trading-store';

interface AiProviderInfo {
  id: string;
  name: string;
  models: { id: string; name: string }[];
  isAvailable: boolean;
  apiKeyEnvVar?: string;
}

export function SettingsPanel() {
  const { tradingMode, setServerConfig } = useTradingStore();
  const [config, setConfig] = useState<TradingConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [aiProviders, setAiProviders] = useState<AiProviderInfo[]>([]);
  const [emailStatus, setEmailStatus] = useState<Record<string, string | boolean> | null>(null);

  // AUDIT-TRADE-01: Sync config to Zustand store
  const syncConfigToStore = useCallback((cfg: TradingConfig) => {
    setServerConfig({
      autoTrading: cfg.autoTrading,
      avoidNewsTrading: cfg.avoidNewsTrading,
      maxOpenPositions: cfg.maxOpenPositions,
      dailyTargetMax: cfg.dailyTargetMax,
      accountBalance: cfg.accountBalance,
      leverage: cfg.leverage,
      trailingStopPips: cfg.trailingStopPips,
      autoTrailingStop: cfg.autoTrailingStop,
    });
  }, [setServerConfig]);

  // Fetch config
  const fetchConfig = useCallback(async () => {
    try {
      setConfigLoading(true);
      const res = await fetch('/api/config');
      if (res.ok) {
        const data = await res.json();
        if (data.config) {
          setConfig(data.config as TradingConfig);
          syncConfigToStore(data.config as TradingConfig);
        }
        if (data.emailStatus) setEmailStatus(data.emailStatus);
      }
    } catch {
      // silent
    } finally {
      setConfigLoading(false);
    }
  }, [syncConfigToStore]);

  // Fetch AI providers
  const fetchAiProviders = useCallback(async () => {
    try {
      const res = await fetch('/api/ai-providers');
      if (res.ok) {
        const data = await res.json();
        if (data.providers) setAiProviders(data.providers);
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchConfig();
    fetchAiProviders();
  }, [fetchConfig, fetchAiProviders]);

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
        const savedData = await res.json().catch(() => ({}));
        toast.success('Configuration saved');
        // AUDIT-TRADE-01: Re-sync store after save
        if (savedData.config) syncConfigToStore(savedData.config as TradingConfig);
        fetchConfig();
      } else {
        const errData = await res.json().catch(() => ({}));
        toast.error(errData.error || 'Failed to save configuration');
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

  const updateConfig = (key: keyof TradingConfig, value: number | boolean | string | null) => {
    setConfig(prev => prev ? { ...prev, [key]: value } : prev);
  };

  const selectedProvider = aiProviders.find(p => p.id === config.aiProvider);
  const availableModels = selectedProvider?.models || [];

  return (
    <div className="space-y-4">
      {/* MT5 Integration */}
      <Mt5ConnectionPanel />

      {/* AI-006: AI Provider Configuration */}
      <Card className="bg-zinc-900 border-zinc-800 p-4">
        <CardHeader className="p-0 pb-3">
          <CardTitle className="text-sm text-white flex items-center gap-2">
            <Brain className="w-4 h-4" /> AI Provider Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-zinc-300 text-xs">AI Provider</Label>
              <Select value={config.aiProvider} onValueChange={(v) => {
                updateConfig('aiProvider', v);
                const provider = aiProviders.find(p => p.id === v);
                if (provider && provider.models.length > 0) {
                  updateConfig('aiModel', provider.models[0].id);
                }
              }}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-800 border-zinc-700">
                  {aiProviders.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-zinc-200">
                      <div className="flex items-center gap-2">
                        {p.isAvailable
                          ? <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                          : <XCircle className="w-3 h-3 text-zinc-500" />
                        }
                        <span>{p.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-zinc-300 text-xs">Model</Label>
              <Select value={config.aiModel} onValueChange={(v) => updateConfig('aiModel', v)}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-800 border-zinc-700">
                  {availableModels.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="text-zinc-200">
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {aiProviders.map((p) => (
              <Badge
                key={p.id}
                variant="outline"
                className={`text-[10px] ${
                  p.id === config.aiProvider
                    ? 'border-emerald-500/40 text-emerald-400'
                    : p.isAvailable
                      ? 'border-zinc-700 text-zinc-400'
                      : 'border-zinc-800 text-zinc-600'
                }`}
              >
                {p.isAvailable ? '●' : '○'} {p.name}
              </Badge>
            ))}
          </div>
          {selectedProvider && !selectedProvider.isAvailable && selectedProvider.id !== 'zai' && (
            <p className="text-[10px] text-amber-400 bg-amber-500/5 border border-amber-500/20 rounded-lg p-2">
              API key for {selectedProvider.name} is not configured. Set {selectedProvider.id === 'lokal_ai' ? 'LOKAL_AI_BASE_URL' : selectedProvider.apiKeyEnvVar || 'the API key'} in environment variables.
            </p>
          )}
        </CardContent>
      </Card>

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
                    onChange={(e) => updateConfig('leverage', parseInt(e.target.value) || 100)}
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
                  <div className="space-y-0.5">
                    <Label className="text-zinc-300 text-xs">Auto Trailing Stop</Label>
                    <p className="text-[9px] text-zinc-600">Automatically applies TS to all positions</p>
                  </div>
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
      {/* Email Notifications */}
      <Card className="bg-zinc-900 border-zinc-800 p-4">
        <CardHeader className="p-0 pb-3">
          <CardTitle className="text-sm text-white flex items-center gap-2">
            <Mail className="w-4 h-4 text-emerald-400" /> Notifikasi Email
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 space-y-4">
          <div className="space-y-2">
            <Label className="text-zinc-300 text-xs">Email Penerima</Label>
            <div className="flex items-center gap-2">
              <Input
                type="email"
                placeholder="trader@email.com"
                value={config?.notifyEmail || ''}
                onChange={(e) => updateConfig('notifyEmail', e.target.value || null)}
                className="bg-zinc-800 border-zinc-700 text-white text-xs h-8"
              />
              {emailStatus?.configured ? (
                <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[10px]">
                  <CheckCircle2 className="w-3 h-3 mr-1" /> Aktif
                </Badge>
              ) : (
                <Badge className="bg-zinc-500/10 text-zinc-400 border-zinc-500/20 text-[10px]">
                  <XCircle className="w-3 h-3 mr-1" /> Nonaktif
                </Badge>
              )}
            </div>
            {emailStatus && !emailStatus.configured && (
              <p className="text-[10px] text-zinc-500">
                Set RESEND_API_KEY dan NOTIFICATION_EMAIL_TO di .env
              </p>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3">
            <div className="flex items-center justify-between">
              <Label className="text-zinc-300 text-xs">Posisi Dibuka</Label>
              <Switch checked={config?.emailOnPositionOpen || false} onCheckedChange={(v) => updateConfig('emailOnPositionOpen', v)} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-zinc-300 text-xs">Posisi Ditutup</Label>
              <Switch checked={config?.emailOnPositionClose || false} onCheckedChange={(v) => updateConfig('emailOnPositionClose', v)} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-zinc-300 text-xs">Price Alert Terpicau</Label>
              <Switch checked={config?.emailOnAlertTrigger ?? true} onCheckedChange={(v) => updateConfig('emailOnAlertTrigger', v)} />
            </div>
          </div>
        </CardContent>
      </Card>
      {/* Legal & Regulatory Info */}
      <Card className="bg-zinc-900 border-zinc-800 p-4">
        <CardHeader className="p-0 pb-3">
          <CardTitle className="text-sm text-white flex items-center gap-2">
            <Shield className="w-4 h-4" /> Informasi Regulasi
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 space-y-3">
          <div className="bg-zinc-800/50 rounded-lg p-3 space-y-2 text-xs text-zinc-300">
            <div className="flex items-center gap-2">
              <FileText className="w-3 h-3 text-emerald-400 shrink-0" />
              <span className="font-medium text-white">Badan Pengawas Perdagangan Berjangka Komoditi (BAPPEBTI)</span>
            </div>
            <p className="text-zinc-400 leading-relaxed pl-5">
              FINEX Indonesia beroperasi di bawah pengawasan BAPPEBTI, lembaga regulasi resmi di bawah Kementerian Perdagangan Republik Indonesia yang mengawasi perdagangan berjangka komoditi.
            </p>
          </div>
          <div className="bg-zinc-800/50 rounded-lg p-3 space-y-2 text-xs text-zinc-300">
            <div className="flex items-center gap-2">
              <Shield className="w-3 h-3 text-emerald-400 shrink-0" />
              <span className="font-medium text-white">Pemisahan Dana Klien</span>
            </div>
            <p className="text-zinc-400 leading-relaxed pl-5">
              Sesuai dengan Undang-Undang No. 10 Tahun 2011 tentang Perdagangan Berjangka Komoditi, dana klien disimpan terpisah pada bank penampung yang diawasi oleh BAPPEBTI, terpisah dari aset perusahaan.
            </p>
          </div>
          <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Info className="w-3 h-3 text-amber-400 shrink-0" />
              <span className="font-medium text-amber-400 text-xs">Pernyataan Risiko</span>
            </div>
            <p className="text-[11px] text-zinc-400 leading-relaxed pl-5">
              Perdagangan berjangka memiliki risiko tinggi dan mungkin tidak cocok untuk semua investor. Anda dapat mengalami kerugian yang melebihi investasi awal Anda. Pastikan Anda telah membaca dan memahami seluruh risiko sebelum memulai perdagangan. Kinerja masa lalu bukan indikator hasil di masa depan.
            </p>
          </div>
          <div className="bg-zinc-800/50 rounded-lg p-3 space-y-2 text-xs text-zinc-300">
            <div className="flex items-center gap-2">
              <Info className="w-3 h-3 text-emerald-400 shrink-0" />
              <span className="font-medium text-white">Disclaimer AI</span>
            </div>
            <p className="text-zinc-400 leading-relaxed pl-5">
              Fitur analisis AI dan sinyal trading yang disediakan merupakan alat bantu keputusan dan BUKAN merupakan saran investasi. Keputusan trading sepenuhnya menjadi tanggung jawab pengguna. FINEX Indonesia tidak bertanggung jawab atas kerugian yang timbul dari penggunaan fitur AI ini.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Version & Legal Footer */}
      <div className="text-center space-y-2 pt-2">
        <p className="text-[10px] text-zinc-500">FINEX Indonesia v1.0 — Platform Trading Forex AI</p>
        <p className="text-[10px] text-zinc-600">© {new Date().getFullYear()} FINEX Indonesia. Seluruh hak cipta dilindungi.</p>
        <p className="text-[9px] text-zinc-700">Terdaftar dan diawasi oleh BAPPEBTI · Dana klien disimpan terpisah</p>
      </div>
    </div>
  );
}
