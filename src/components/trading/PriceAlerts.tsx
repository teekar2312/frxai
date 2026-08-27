'use client'

import { useEffect, useState, useCallback } from 'react'
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
import { Bell, Plus, Trash2, BellOff, ArrowUpCircle, ArrowDownCircle } from 'lucide-react'

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

const defaultAlerts: PriceAlert[] = [
  {
    id: 'A1',
    symbol: 'BBCA',
    condition: 'Above',
    targetPrice: 10000,
    message: 'BBCA broke 10K resistance!',
    active: true,
    status: 'Active',
    createdAt: '2025-01-15T08:00:00Z',
  },
  {
    id: 'A2',
    symbol: 'BBRI',
    condition: 'Below',
    targetPrice: 5300,
    message: 'BBRI approaching support level.',
    active: true,
    status: 'Active',
    createdAt: '2025-01-15T09:00:00Z',
  },
  {
    id: 'A3',
    symbol: 'GOTO',
    condition: 'Cross Up',
    targetPrice: 85,
    message: 'GOTO crossed above MA20.',
    active: true,
    status: 'Active',
    createdAt: '2025-01-15T07:30:00Z',
  },
  {
    id: 'A4',
    symbol: 'TLKM',
    condition: 'Cross Down',
    targetPrice: 3400,
    message: 'TLKM broke support.',
    active: false,
    status: 'Triggered',
    createdAt: '2025-01-14T14:00:00Z',
  },
]

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

export default function PriceAlerts() {
  const [alerts, setAlerts] = useState<PriceAlert[]>(defaultAlerts)
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)

  // Form state
  const [newSymbol, setNewSymbol] = useState('')
  const [newCondition, setNewCondition] = useState<AlertCondition>('Above')
  const [newPrice, setNewPrice] = useState('')
  const [newMessage, setNewMessage] = useState('')

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch('/api/alerts')
      if (res.ok) {
        const json = await res.json()
        setAlerts(Array.isArray(json) ? json : json.alerts ?? defaultAlerts)
      }
    } catch {
      // use default
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAlerts()
  }, [fetchAlerts])

  const handleDelete = (id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id))
  }

  const handleToggleActive = (id: string) => {
    setAlerts((prev) =>
      prev.map((a) =>
        a.id === id
          ? { ...a, active: !a.active, status: a.active ? 'Active' : a.status }
          : a
      )
    )
  }

  const handleCreate = () => {
    if (!newSymbol || !newPrice) return
    const alert: PriceAlert = {
      id: `A${Date.now()}`,
      symbol: newSymbol.toUpperCase(),
      condition: newCondition,
      targetPrice: parseFloat(newPrice),
      message: newMessage,
      active: true,
      status: 'Active',
      createdAt: new Date().toISOString(),
    }
    setAlerts((prev) => [alert, ...prev])
    setDialogOpen(false)
    resetForm()
  }

  const resetForm = () => {
    setNewSymbol('')
    setNewCondition('Above')
    setNewPrice('')
    setNewMessage('')
  }

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-amber-600" />
            <CardTitle className="text-base">
              Price Alerts{' '}
              <span className="text-muted-foreground font-normal">
                ({alerts.filter((a) => a.status === 'Active').length})
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
                  disabled={!newSymbol || !newPrice}
                >
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
                  />

                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-red-600"
                    onClick={() => handleDelete(alert.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="sr-only">Delete alert</span>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
