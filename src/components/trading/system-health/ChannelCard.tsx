'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Cable, CheckCircle2, Leaf, Loader2, Send, XCircle } from 'lucide-react'
import { formatAge, SEVERITIES, VALID_EVENTS, type ChannelConfig } from './types'

// ============================================
// CHANNEL CONFIG CARD (Telegram / Discord)
// ============================================

export function ChannelCard({
  cfg,
  saving,
  onPatch,
}: {
  cfg: ChannelConfig
  saving: boolean
  onPatch: (channel: 'TELEGRAM' | 'DISCORD', patch: Record<string, unknown>) => Promise<boolean>
}) {
  const isTelegram = cfg.channel === 'TELEGRAM'
  // Draft override: null = show the server value (no prop→state sync needed)
  const [targetOverride, setTargetOverride] = useState<string | null>(null)
  const targetDraft = targetOverride ?? (cfg.chatId ?? '')
  const targetDirty = targetDraft !== (cfg.chatId ?? '')
  const lastErrorShort = cfg.lastError && cfg.lastError.length > 90 ? `${cfg.lastError.slice(0, 90)}…` : cfg.lastError

  const handleSaveTarget = async () => {
    const value = targetDraft.trim()
    if (!value) return
    const ok = await onPatch(cfg.channel, isTelegram ? { chatId: value } : { webhookUrl: value })
    if (ok) setTargetOverride(null)
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            {isTelegram ? <Send className="h-4 w-4 text-emerald-600" /> : <Cable className="h-4 w-4 text-emerald-600" />}
            {isTelegram ? 'Telegram' : 'Discord'}
          </CardTitle>
          <div className="flex items-center gap-2">
            {cfg.envConfigured ? (
              <Badge variant="outline" className="text-[10px] gap-1">
                <Leaf className="h-3 w-3 text-emerald-600" />
                ENV OK
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                NO ENV
              </Badge>
            )}
            <Switch
              checked={cfg.enabled}
              disabled={saving}
              onCheckedChange={(checked) => onPatch(cfg.channel, { enabled: checked })}
              aria-label={`Toggle ${cfg.channel} notifications`}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Target input */}
        <div className="space-y-2">
          <Label htmlFor={`target-${cfg.channel}`} className="text-xs">
            {isTelegram ? 'Chat ID' : 'Webhook URL'}
          </Label>
          <div className="flex gap-2">
            <Input
              id={`target-${cfg.channel}`}
              value={targetDraft}
              onChange={(e) => setTargetOverride(e.target.value)}
              placeholder={isTelegram ? 'e.g. 123456789' : 'https://discord.com/api/webhooks/…'}
              className="text-xs font-mono"
              disabled={saving}
            />
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              disabled={saving || !targetDirty || !targetDraft.trim()}
              onClick={handleSaveTarget}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Save
            </Button>
          </div>
        </div>

        {/* Min severity */}
        <div className="space-y-2">
          <Label className="text-xs">Minimum Severity</Label>
          <Select
            value={cfg.minSeverity}
            disabled={saving}
            onValueChange={(v) => onPatch(cfg.channel, { minSeverity: v })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEVERITIES.map((s) => (
                <SelectItem key={s} value={s} className="text-xs">
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Events */}
        <div className="space-y-1.5">
          <Label className="text-xs">Events</Label>
          <div className="flex flex-wrap gap-1">
            {VALID_EVENTS.map((ev) => {
              const active = cfg.events.includes(ev)
              return (
                <button
                  key={ev}
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    const next = active ? cfg.events.filter((e) => e !== ev) : [...cfg.events, ev]
                    onPatch(cfg.channel, { events: next })
                  }}
                  className={
                    active
                      ? 'rounded-full border border-emerald-600 bg-emerald-600 text-white px-2 py-0.5 text-[10px] font-medium transition-colors hover:bg-emerald-700'
                      : 'rounded-full border bg-muted text-muted-foreground px-2 py-0.5 text-[10px] transition-colors hover:bg-muted/70'
                  }
                  title={active ? `Click to disable ${ev}` : `Click to enable ${ev}`}
                >
                  {ev}
                </button>
              )
            })}
          </div>
          <p className="text-[10px] text-muted-foreground">Empty = all events dispatched (server default).</p>
        </div>

        {/* Health of channel */}
        <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/30 p-2.5 text-[11px]">
          <div>
            <span className="text-muted-foreground">Errors streak: </span>
            <span className={cfg.consecutiveErrors > 0 ? 'font-mono font-medium text-red-600' : 'font-mono'}>
              {cfg.consecutiveErrors}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Rate limit: </span>
            <span className="font-mono">{cfg.rateLimitPerMin}/min</span>
          </div>
          <div>
            <span className="text-muted-foreground">Last sent: </span>
            <span className="font-mono">{formatAge(cfg.lastSentAt)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Enabled: </span>
            <span className={cfg.enabled ? 'font-mono text-emerald-600' : 'font-mono text-muted-foreground'}>
              {cfg.enabled ? 'yes' : 'no'}
            </span>
          </div>
          {lastErrorShort && (
            <div className="col-span-2 truncate text-red-600 dark:text-red-400" title={cfg.lastError ?? undefined}>
              <XCircle className="mr-1 inline h-3 w-3" />
              {lastErrorShort}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
