'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from 'sonner'
import { CheckCircle2, Loader2, Settings2, Trash2, X } from 'lucide-react'
import { LayerBadge } from './badges'
import { formatAge, type ConfigEntry } from './types'

// ============================================
// CONFIG ENTRY ROW (inline editor)
// ============================================

export function ConfigEntryRow({
  entry,
  busy,
  onSave,
  onReset,
}: {
  entry: ConfigEntry
  busy: boolean
  onSave: (key: string, value: unknown) => Promise<boolean>
  onReset: (key: string) => Promise<boolean>
}) {
  const topLayer = entry.sources[0]?.layer ?? 'default'
  const hasRuntimeOverride = entry.sources.some((s) => s.layer === 'runtime')
  const [editing, setEditing] = useState(false)
  // Draft override: null = show the effective (server) value — avoids prop→state sync
  const [draftOverride, setDraftOverride] = useState<string | null>(null)
  const draft = draftOverride ?? String(entry.effective)

  const isNumber = entry.effectiveType === 'number'
  const isBoolean = entry.effectiveType === 'boolean'

  const validate = (raw: string): { ok: true; value: unknown } | { ok: false; error: string } => {
    if (isNumber) {
      const n = Number(raw)
      if (!Number.isFinite(n)) return { ok: false, error: 'Value must be a valid number' }
      return { ok: true, value: n }
    }
    if (isBoolean) {
      if (raw !== 'true' && raw !== 'false') return { ok: false, error: 'Value must be true or false' }
      return { ok: true, value: raw === 'true' }
    }
    if (!raw.trim()) return { ok: false, error: 'Value cannot be empty' }
    return { ok: true, value: raw.trim() }
  }

  const handleSave = async () => {
    const parsed = validate(draft)
    if (!parsed.ok) {
      toast.error(parsed.error, { description: entry.key })
      return
    }
    const ok = await onSave(entry.key, parsed.value)
    if (ok) {
      setEditing(false)
      setDraftOverride(null)
    }
  }

  const handleCancel = () => {
    setDraftOverride(null)
    setEditing(false)
  }

  return (
    <div className="border-b px-3 py-2.5 last:border-b-0">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-medium">{entry.key}</span>
            <LayerBadge layer={topLayer} />
            {!entry.mutable && <Badge variant="outline" className="text-[10px] text-muted-foreground">IMMUTABLE</Badge>}
            {hasRuntimeOverride && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-red-600 disabled:opacity-50"
                    disabled={busy}
                    aria-label={`Reset ${entry.key}`}
                    onClick={() => onReset(entry.key)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Remove runtime override &amp; reset</TooltipContent>
              </Tooltip>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{entry.description || '—'}</p>
          {/* Layer chain */}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {entry.sources.map((s, i) => (
              <Tooltip key={`${entry.key}-${s.layer}`}>
                <TooltipTrigger asChild>
                  <span className="cursor-help">
                    {i > 0 && <span className="mr-1 text-[10px] text-muted-foreground">←</span>}
                    <LayerBadge layer={s.layer} />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[260px]">
                  <span className="font-mono">{String(s.value)}</span>
                  {s.updatedAt ? ` (set ${formatAge(s.updatedAt)})` : ''}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 sm:shrink-0">
          {editing ? (
            <>
              {isBoolean ? (
                <Select value={draft} onValueChange={setDraftOverride}>
                  <SelectTrigger className="h-8 w-[110px] text-xs font-mono">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true" className="text-xs">true</SelectItem>
                    <SelectItem value="false" className="text-xs">false</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={draft}
                  onChange={(e) => setDraftOverride(e.target.value)}
                  className="h-8 w-[140px] text-xs font-mono"
                  autoFocus
                  type={isNumber ? 'number' : 'text'}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSave()
                    if (e.key === 'Escape') handleCancel()
                  }}
                />
              )}
              <Button size="sm" className="h-8 gap-1 text-xs" disabled={busy} onClick={handleSave}>
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 gap-1 text-xs"
                onClick={handleCancel}
              >
                <X className="h-3 w-3" />
                Cancel
              </Button>
            </>
          ) : (
            <>
              <span className="max-w-[160px] truncate rounded bg-muted px-2 py-1 font-mono text-xs" title={String(entry.effective)}>
                {String(entry.effective)}
              </span>
              {entry.mutable && (
                <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => setEditing(true)}>
                  <Settings2 className="h-3 w-3" />
                  Edit
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
