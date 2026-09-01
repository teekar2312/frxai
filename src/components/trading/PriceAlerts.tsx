'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Bell, Plus, Trash2, BellOff, ArrowUpCircle, ArrowDownCircle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

type AlertCondition = 'Above' | 'Below' | 'Cross Up' | 'Cross Down'
type AlertStatus = 'Active' | 'Triggered'

interface PriceAlert {
  id: string
  symbol: string
  condition: AlertCondition
  targetPrice: number
  message: string
  active: boolean
  status: AlertStatus
  createdAt: string
}

const CONDITIONS: AlertCondition[] = ['Above', 'Below', 'Cross Up', 'Cross Down']

const SYMBOLS = [
  'BBCA', 'BBRI', 'TLKM', 'ASII', 'UNVR', 'BMRI', 'GOTO', 'BRIS', 'ICBP', 'ARTO', 'EXCL', 'TBIG',
]

/** Map UI condition display names to API uppercase values */
const CONDITION_TO_API: Record<AlertCondition, string> = {
  Above: 'ABOVE',
  Below: 'BELOW',
  'Cross Up': 'CROSS_UP',
  'Cross Down': 'CROSS_DOWN',
}

/** Map API uppercase condition back to display names */
const API_TO_CONDITION: Record<string, AlertCondition> = {
  ABOVE: 'Above',
  BELOW: 'Below',
  CROSS_UP: 'Cross Up',
  CROSS_DOWN: 'Cross Down',
}

const conditionIcon = (cond: AlertCondition) => {
  switch (cond) {
    case 'Above':
    case 'Cross Up':
      return <ArrowUpCircle className="h-4 w-4 text-emerald-600" />
    default:
      return <ArrowDownCircle className="h-4 w-4 text-red-600" />
  }
}

const conditionColor: Record<AlertCondition, string> = {
  Above: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-400',
  Below: 'bg-red-100 text-red-700 hover:bg-red-100 dark:bg-red-950/50 dark:text-red-400',
  'Cross Up': 'bg-sky-100 text-sky-700 hover:bg-sky-100 dark:bg-sky-950/50 dark:text-sky-400',
  'Cross Down': 'bg-orange-100 text-orange-700 hover:bg-orange-100 dark:bg-orange-950/50 dark:text-orange-400',
}

/** Map API response item to UI PriceAlert interface */
function mapApiAlert(raw: Record<string, unknown>): PriceAlert {
  const apiCondition = String(raw.condition ?? 'ABOVE')
  return {
    id: String(raw.id),
    symbol: String(raw.symbol),
    condition: API_TO_CONDITION[apiCondition] ?? 'Above',
    targetPrice: Number(raw.price),
    message: raw.message ? String(raw.message) : '',
    active: Boolean(raw.active),
    status: raw.triggered ? 'Triggered' : 'Active',
    createdAt: raw.createdAt ? new Date(String(raw.createdAt)).toISOString() : new Date().toISOString(),
  }
}

export default function PriceAlerts() {
  const [alerts, setAlerts] = useState<PriceAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  // Form state
  const [newSymbol, setNewSymbol] = useState('')
  const [newCondition, setNewCondition] = useState<AlertCondition>('Above')
  const [newPrice, setNewPrice] = useState('')
  const [newMessage, setNewMessage] = useState('')

  // Track which triggered alert IDs have already been toasted
  const toastedIdsRef = useRef<Set<string>>(new Set())
  // Track previously seen triggered IDs for toast dedup
  const prevTriggeredRef = useRef<Set<string>>(new Set())
  const abortRef = useRef<AbortController | null>(null)

  const fetchAlerts = useCallback(async () => {
    try {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      const res = await fetch('/api/alerts?limit=200', { signal: controller.signal })
      if (res.ok) {
        const json = await res.json()
        const data: Array<Record<string, unknown>> = json.data ?? json.alerts ?? []
        const mapped = Array.isArray(data) ? data.map(mapApiAlert) : []
        setAlerts(mapped)

        // Detect newly triggered alerts for toast notifications
        const newTriggered = mapped.filter(
          (a) => a.status === 'Triggered' && !prevTriggeredRef.current.has(a.id)
        )
        prevTriggeredRef.current = new Set(mapped.filter((a) => a.status === 'Triggered').map((a) => a.id))

        for (const alert of newTriggered) {
          if (toastedIdsRef.current.has(alert.id)) continue
          toastedIdsRef.current.add(alert.id)
          // Prune to prevent unbounded growth
          if (toastedIdsRef.current.size > 200) {
            const iter = toastedIdsRef.current.values()
            const first = iter.next().value
            if (first) toastedIdsRef.current.delete(first)
          }
          toast.success(
            `Price alert triggered: ${alert.symbol} ${alert.condition} ${Number(alert.targetPrice).toLocaleString()}`
          )
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      // Silently fail
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAlerts()
    const interval = setInterval(fetchAlerts, 10_000)
    const handleVisibility = () => {
      if (document.hidden) {
        clearInterval(interval)
      } else {
        fetchAlerts()
        // Interval was cleared; need a new one — handled by re-running effect
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      clearInterval(interval)
      abortRef.current?.abort()
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [fetchAlerts])

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/alerts/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setAlerts((prev) => prev.filter((a) => a.id !== id))
      } else {
        toast.error('Failed to delete alert')
      }
    } catch {
      toast.error('Failed to delete alert')
    } finally {
      setDeletingId(null)
    }
  }

  const handleToggleActive = async (id: string) => {
    const alert = alerts.find((a) => a.id === id)
    if (!alert) return

    setTogglingId(id)
    try {
      const res = await fetch(`/api/alerts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !alert.active }),
      })
      if (res.ok) {
        setAlerts((prev) =>
          prev.map((a) =>
            a.id === id ? { ...a, active: !a.active } : a
          )
        )
      } else {
        toast.error('Failed to toggle alert')
      }
    } catch {
      toast.error('Failed to toggle alert')
    } finally {
      setTogglingId(null)
    }
  }

  const handleCreate = async () => {
    if (!newSymbol || !newPrice) return

    setCreating(true)
    try {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: newSymbol,
          condition: CONDITION_TO_API[newCondition],
          price: parseFloat(newPrice),
          message: newMessage || undefined,
        }),
      })

      if (res.ok) {
        const json = await res.json()
        const created = json.data
        if (created) {
          setAlerts((prev) => [mapApiAlert(created), ...prev])
        }
        setDialogOpen(false)
        resetForm()
      } else {
        const json = await res.json().catch(() => ({}))
        toast.error(json.error ?? 'Failed to create alert')
      }
    } catch {
      toast.error('Failed to create alert')
    } finally {
      setCreating(false)
    }
  }

  const resetForm = () => {
    setNewSymbol('')
    setNewCondition('Above')
    setNewPrice('')
    setNewMessage('')
  }

  return (
    <>
    <Card>
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-amber-600" />
            <CardTitle className="text-base">
              Active Alerts{' '}
              <span className="text-muted-foreground font-normal">
                ({alerts.filter((a) => a.active && a.status === 'Active').length})
              </span>
            </CardTitle>
          </div>

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1.5">
                <Plus className="h-4 w-4" />
                New Alert
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Price Alert</DialogTitle>
                <DialogDescription>
                  Set a price alert to get notified when a condition is met.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 py-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Symbol</label>
                  <Select value={newSymbol} onValueChange={setNewSymbol}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select symbol" />
                    </SelectTrigger>
                    <SelectContent>
                      {SYMBOLS.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Condition</label>
                  <Select
                    value={newCondition}
                    onValueChange={(v) => setNewCondition(v as AlertCondition)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONDITIONS.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Target Price (IDR)</label>
                  <Input
                    type="number"
                    value={newPrice}
                    onChange={(e) => setNewPrice(e.target.value)}
                    placeholder="e.g. 10000"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Message (optional)</label>
                  <Textarea
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Add a note for this alert..."
                    rows={2}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={!newSymbol || !newPrice || creating}
                >
                  {creating && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                  Create Alert
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Loading alerts...
          </div>
        ) : alerts.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No price alerts configured. Click &quot;New Alert&quot; to create one.
          </div>
        ) : (
          <div className="space-y-2">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                  alert.status === 'Triggered' ? 'opacity-60' : ''
                }`}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                  {alert.active ? (
                    <Bell className="h-4 w-4 text-amber-500" />
                  ) : (
                    <BellOff className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{alert.symbol}</span>
                    {conditionIcon(alert.condition)}
                    <Badge
                      className={`${conditionColor[alert.condition]} text-xs`}
                    >
                      {alert.condition}
                    </Badge>
                    <span className="font-mono text-sm">
                      Rp {alert.targetPrice.toLocaleString('id-ID')}
                    </span>
                  </div>
                  {alert.message && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {alert.message}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Badge
                    variant={
                      alert.status === 'Active' ? 'default' : 'secondary'
                    }
                    className={
                      alert.status === 'Active'
                        ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-400'
                        : ''
                    }
                  >
                    {alert.status}
                  </Badge>

                  <Switch
                    checked={alert.active}
                    onCheckedChange={() => handleToggleActive(alert.id)}
                    disabled={togglingId === alert.id}
                  />

                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-red-600"
                    onClick={() => setDeleteConfirmId(alert.id)}
                    disabled={deletingId === alert.id}
                  >
                    {deletingId === alert.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    <span className="sr-only">Delete alert</span>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>

    <AlertDialog open={!!deleteConfirmId} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Alert</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete this price alert? This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (deleteConfirmId) {
                handleDelete(deleteConfirmId)
                setDeleteConfirmId(null)
              }
            }}
            className="bg-red-600 hover:bg-red-700"
          >Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}
