'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  Download,
  FileCode,
  FileText,
  Folder,
  FolderOpen,
  KeyRound,
  Loader2,
  Package,
  ServerCog,
  Terminal,
} from 'lucide-react'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SectionTitle, EmptyState } from '@/components/shared/primitives'
import { usePolling } from '@/hooks/use-polling'
import { cn } from '@/lib/utils'

// ============================================================
// SETUP PANEL — Python engine (LIVE mode) setup guide + file browser
// ============================================================

interface FileNode {
  name: string
  path: string
  type: 'file' | 'dir'
  size?: number
  children?: FileNode[]
}

interface FilesResponse {
  root: string
  tree: FileNode[]
}

function fmtSize(bytes?: number): string {
  if (bytes === undefined) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function fileIcon(name: string) {
  const lower = name.toLowerCase()
  const cls = 'h-3 w-3 shrink-0'
  if (lower.endsWith('.py')) return <FileCode className={cn(cls, 'text-emerald-500/80')} />
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return <KeyRound className={cn(cls, 'text-amber-500/80')} />
  if (lower.endsWith('.md') || lower.endsWith('.txt')) return <FileText className={cn(cls, 'text-zinc-400')} />
  if (lower.startsWith('.env')) return <KeyRound className={cn(cls, 'text-rose-500/80')} />
  if (lower === 'requirements.txt') return <Package className={cn(cls, 'text-emerald-500/80')} />
  return <FileText className={cn(cls, 'text-zinc-400')} />
}

// ------------------------------------------------------------
// File tree
// ------------------------------------------------------------

function TreeDir({
  node,
  selected,
  onOpen,
  depth,
}: {
  node: FileNode
  selected: string | null
  onOpen: (path: string) => void
  depth: number
}) {
  const [open, setOpen] = useState(true)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1 rounded px-1.5 py-0.5 text-left text-[11px] font-semibold transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/50"
        style={{ paddingLeft: `${depth * 10 + 6}px` }}
      >
        <ChevronRight className={cn('h-3 w-3 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        {open ? (
          <FolderOpen className="h-3 w-3 shrink-0 text-amber-500/90" />
        ) : (
          <Folder className="h-3 w-3 shrink-0 text-amber-500/70" />
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {open
        ? node.children?.map((c) =>
            c.type === 'dir' ? (
              <TreeDir key={c.path} node={c} selected={selected} onOpen={onOpen} depth={depth + 1} />
            ) : (
              <button
                key={c.path}
                type="button"
                onClick={() => onOpen(c.path)}
                aria-current={selected === c.path}
                className={cn(
                  'flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/50',
                  selected === c.path
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : 'text-foreground/90'
                )}
                style={{ paddingLeft: `${(depth + 1) * 10 + 6}px` }}
              >
                {fileIcon(c.name)}
                <span className="truncate font-mono text-[11px]">{c.name}</span>
                <span className="num ml-auto shrink-0 text-[9px] tabular-nums text-muted-foreground/60">
                  {fmtSize(c.size)}
                </span>
              </button>
            )
          )
        : null}
    </div>
  )
}

// ------------------------------------------------------------
// Code viewer (always dark)
// ------------------------------------------------------------

function CodeViewer({ path, content }: { path: string; content: string }) {
  const lines = content.split('\n')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      toast.success(`${path} disalin ke clipboard`)
    } catch {
      toast.error('Clipboard tidak tersedia di browser ini')
    }
  }
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-900 px-3 py-1.5">
        <span className="truncate font-mono text-[11px] text-zinc-400">{path}</span>
        <div className="flex items-center gap-2">
          <span className="num hidden text-[9px] tabular-nums text-zinc-500 sm:inline">
            {lines.length} baris · {fmtSize(new Blob([content]).size)}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-[10px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            onClick={copy}
            aria-label={`Salin isi file ${path}`}
          >
            <Copy className="h-3 w-3" />
            Salin
          </Button>
        </div>
      </div>
      <div className="max-h-[600px] overflow-auto bg-zinc-950 p-2 scrollbar-thin">
        <pre className="font-mono text-[11px] leading-relaxed text-zinc-300">
          {lines.map((line, i) => (
            <div key={i} className="flex hover:bg-zinc-900/60">
              <span className="num w-10 shrink-0 select-none pr-3 text-right text-zinc-600 tabular-nums">{i + 1}</span>
              <span className="whitespace-pre">{line || ' '}</span>
            </div>
          ))}
        </pre>
      </div>
    </div>
  )
}

// ------------------------------------------------------------
// Panel
// ------------------------------------------------------------

const ENGINE_ENDPOINTS: { method: string; path: string; desc: string; main?: boolean }[] = [
  { method: 'GET', path: '/api/v1/poll', desc: 'Endpoint utama — dikonsumsi dashboard ini setiap 2 detik (mode LIVE)', main: true },
  { method: 'GET', path: '/health', desc: 'Health check engine + koneksi MetaTrader 5' },
  { method: 'POST', path: '/orders', desc: 'Open / close / closeAll / modify posisi' },
  { method: 'GET', path: '/positions', desc: 'Posisi terbuka (live P/L dari MT5)' },
  { method: 'GET', path: '/history', desc: 'Riwayat trade tertutup' },
  { method: 'GET', path: '/candles', desc: 'Candle OHLCV langsung dari MT5' },
  { method: 'GET', path: '/news', desc: 'News real-time (Finnhub / Marketaux)' },
  { method: 'GET', path: '/calendar', desc: 'Kalender ekonomi' },
  { method: 'GET|POST', path: '/settings', desc: 'Baca / update settings engine' },
  { method: 'GET|POST', path: '/alerts', desc: 'Price alerts (dicek tiap 2 detik)' },
  { method: 'GET', path: '/logs', desc: 'Log engine terbaru' },
  { method: 'GET', path: '/', desc: 'Info engine (versi, mode, uptime)' },
]

export default function SetupPanel() {
  const { data: files, loading: filesLoading } = usePolling<FilesResponse>('/api/engine/files', 60000)

  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [fileLoading, setFileLoading] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)

  const openFile = useCallback(async (path: string) => {
    setSelected(path)
    setFileError(null)
    setContent(null)
    setFileLoading(true)
    try {
      const res = await fetch(`/api/engine/file?path=${encodeURIComponent(path)}`, { cache: 'no-store' })
      const json = (await res.json().catch(() => ({}))) as { content?: string; error?: string }
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setContent(json.content ?? '')
    } catch (e) {
      setFileError(e instanceof Error ? e.message : 'Gagal memuat file')
    } finally {
      setFileLoading(false)
    }
  }, [])

  // auto-open main.py on first load
  useEffect(() => {
    if (files && selected === null && content === null && !fileLoading) {
      const hasMain = files.tree.some((n) => n.type === 'file' && n.path === 'main.py')
      if (hasMain) void openFile('main.py')
    }
  }, [files, selected, content, fileLoading, openFile])

  return (
    <div className="space-y-3 p-3 sm:p-4">
      {/* ===== Intro + quickstart ===== */}
      <Card className="p-3 sm:p-4">
        <SectionTitle
          right={
            <Badge variant="outline" className="border-emerald-500/40 px-1.5 text-[9px] font-semibold text-emerald-500">
              LIVE MODE
            </Badge>
          }
        >
          <span className="flex items-center gap-1.5">
            <ServerCog className="h-3.5 w-3.5" />
            Python Engine — Trading Real via MetaTrader 5
          </span>
        </SectionTitle>
        <p className="max-w-4xl text-xs leading-relaxed text-muted-foreground">
          Dashboard yang Anda lihat berjalan di mode <span className="font-semibold text-foreground">DEMO</span>{' '}
          (simulator realistis di server). Untuk trading dengan{' '}
          <span className="font-semibold text-foreground">akun real FINEX Indonesia</span>, jalankan Python engine di PC
          Windows 11 Anda — engine terhubung langsung ke terminal MetaTrader 5, mengambil harga live, mengeksekusi
          order AI/manual, dan menyalurkan semuanya ke dashboard ini melalui satu endpoint. Semua kode engine
          (production-ready) bisa diunduh dan di-browse di bawah.
        </p>

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {/* Step 1 */}
          <div className="flex flex-col gap-2 rounded-lg border p-2.5">
            <div className="flex items-center gap-2">
              <span className="num flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white">
                1
              </span>
              <span className="text-xs font-bold">Download ZIP</span>
            </div>
            <p className="flex-1 text-[10px] leading-tight text-muted-foreground">
              Unduh paket engine lengkap (main.py, app/*, config example, requirements, README).
            </p>
            <Button asChild size="sm" className="h-8 w-full gap-1.5 bg-emerald-600 text-[11px] font-bold text-white hover:bg-emerald-600/90">
              <a href="/api/engine/download" download aria-label="Download python engine ZIP">
                <Download className="h-3.5 w-3.5" />
                Download ZIP
              </a>
            </Button>
          </div>
          {/* Step 2 */}
          <div className="flex flex-col gap-2 rounded-lg border p-2.5">
            <div className="flex items-center gap-2">
              <span className="num flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white">
                2
              </span>
              <span className="text-xs font-bold">Install Python 3.14</span>
            </div>
            <p className="flex-1 text-[10px] leading-tight text-muted-foreground">
              Windows 11 x64 + Python 3.14, lalu install dependensi:
            </p>
            <code className="num block truncate rounded bg-muted/60 px-2 py-1 font-mono text-[10px] text-emerald-600 dark:text-emerald-400">
              pip install -r requirements.txt
            </code>
          </div>
          {/* Step 3 */}
          <div className="flex flex-col gap-2 rounded-lg border p-2.5">
            <div className="flex items-center gap-2">
              <span className="num flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white">
                3
              </span>
              <span className="text-xs font-bold">Konfigurasi</span>
            </div>
            <p className="flex-1 text-[10px] leading-tight text-muted-foreground">
              Copy <span className="font-mono">config.example.yaml</span> →{' '}
              <span className="font-mono">config.yaml</span>, isi <span className="font-mono">.env</span> (MT5
              login/password/server FINEX).
            </p>
          </div>
          {/* Step 4 */}
          <div className="flex flex-col gap-2 rounded-lg border p-2.5">
            <div className="flex items-center gap-2">
              <span className="num flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white">
                4
              </span>
              <span className="text-xs font-bold">Jalankan</span>
            </div>
            <p className="flex-1 text-[10px] leading-tight text-muted-foreground">
              <span className="font-mono">python main.py</span> — terminal MT5 di-launch otomatis, lalu di dashboard:
              Settings → Engine Mode <span className="font-semibold">LIVE</span>.
            </p>
            <code className="num block truncate rounded bg-muted/60 px-2 py-1 font-mono text-[10px] text-emerald-600 dark:text-emerald-400">
              <Terminal className="mr-1 inline h-3 w-3 -translate-y-0.5" />
              python main.py
            </code>
          </div>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Panduan lengkap (konfigurasi 8 AI provider, SMTP email, troubleshooting, keamanan) ada di{' '}
          <span className="font-semibold text-foreground">README.md</span> di dalam ZIP.
        </p>
      </Card>

      {/* ===== File browser ===== */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[290px_1fr]">
        <Card className="h-fit p-3 lg:max-h-[660px]">
          <SectionTitle
            right={
              <Badge variant="outline" className="num px-1 text-[9px] font-semibold tabular-nums text-muted-foreground">
                {files?.tree.length ?? 0} item
              </Badge>
            }
          >
            File Engine
          </SectionTitle>
          {filesLoading && !files ? (
            <div className="space-y-1.5">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-5 rounded" />
              ))}
            </div>
          ) : !files || files.tree.length === 0 ? (
            <EmptyState title="File engine tidak tersedia" hint="Folder python-engine tidak dapat dibaca dari server." />
          ) : (
            <div className="max-h-[520px] space-y-0.5 overflow-y-auto pr-1 scrollbar-thin">
              {files.tree.map((n) =>
                n.type === 'dir' ? (
                  <TreeDir key={n.path} node={n} selected={selected} onOpen={openFile} depth={0} />
                ) : (
                  <button
                    key={n.path}
                    type="button"
                    onClick={() => openFile(n.path)}
                    aria-current={selected === n.path}
                    className={cn(
                      'flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/50',
                      selected === n.path ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'text-foreground/90'
                    )}
                  >
                    {fileIcon(n.name)}
                    <span className="truncate font-mono text-[11px]">{n.name}</span>
                    <span className="num ml-auto shrink-0 text-[9px] tabular-nums text-muted-foreground/60">
                      {fmtSize(n.size)}
                    </span>
                  </button>
                )
              )}
            </div>
          )}
        </Card>

        <Card className="h-fit p-3">
          <SectionTitle
            right={
              selected ? (
                <Badge variant="outline" className="max-w-56 truncate border-emerald-500/40 px-1.5 font-mono text-[9px] text-emerald-600 dark:text-emerald-400">
                  {selected}
                </Badge>
              ) : undefined
            }
          >
            Code Viewer
          </SectionTitle>
          {fileLoading ? (
            <div className="space-y-1.5">
              <Skeleton className="h-6 w-2/3 rounded" />
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} className="h-4 rounded" />
              ))}
            </div>
          ) : fileError ? (
            <EmptyState title="Gagal memuat file" hint={`${fileError} — pilih file lain dari daftar di samping.`} />
          ) : selected === null ? (
            <EmptyState
              icon={<FileCode />}
              title="Pilih file untuk melihat kode"
              hint="Klik file di daftar sebelah kiri — kode engine Python ditampilkan apa adanya."
            />
          ) : content === null ? (
            <EmptyState title="File kosong" />
          ) : (
            <CodeViewer path={selected} content={content} />
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* ===== Requirements checklist ===== */}
        <Card className="p-3">
          <SectionTitle>Prasyarat</SectionTitle>
          <ul className="space-y-1.5">
            {[
              { text: 'Python 3.14 x64 terinstall di Windows 11', hint: 'python --version' },
              { text: 'Terminal MetaTrader 5 (FINEX Indonesia)', hint: 'di-launch otomatis oleh engine' },
              { text: 'Akun real FINEX Indonesia', hint: 'login/password/server diisi di .env' },
              { text: 'API keys opsional', hint: 'Finnhub & Marketaux (news), AI provider (Z.AI, Groq, dst.)' },
            ].map((req) => (
              <li key={req.text} className="flex items-start gap-2 rounded-md border px-2.5 py-1.5">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                <div>
                  <p className="text-xs font-medium">{req.text}</p>
                  <p className="text-[9px] text-muted-foreground">{req.hint}</p>
                </div>
              </li>
            ))}
          </ul>
          <Alert className="mt-2.5 border-red-500/40 bg-red-500/[0.07] py-2.5">
            <AlertTriangle className="h-4 w-4 text-red-500" />
            <AlertTitle className="text-xs font-bold text-red-600 dark:text-red-400">RISIKO — AKUN REAL</AlertTitle>
            <AlertDescription className="text-[10px] leading-tight text-red-600/90 dark:text-red-400/90">
              Mode LIVE memperdagangkan uang Anda sungguhan. Mulai dengan risk 0.5% per trade, lakukan backtest dulu
              di tab Backtest, dan pahami aturan FINEX: margin call 50% / stop out 20% — posisi ditutup paksa oleh
              broker saat margin menyentuh level tersebut.
            </AlertDescription>
          </Alert>
        </Card>

        {/* ===== API reference ===== */}
        <Card className="p-3">
          <SectionTitle
            right={
              <Badge variant="outline" className="num px-1.5 text-[9px] font-semibold text-muted-foreground">
                engineUrl · FastAPI
              </Badge>
            }
          >
            Endpoint Python Engine
          </SectionTitle>
          <p className="mb-2 text-[10px] leading-tight text-muted-foreground">
            Engine berjalan di <span className="num font-mono text-foreground">engineUrl</span> (default{' '}
            <span className="num font-mono">http://localhost:8000</span>). Dashboard mengonsumsi endpoint{' '}
            <span className="font-mono text-emerald-600 dark:text-emerald-400">/api/v1/poll</span> — semua fitur lain
            di-proxy melalui dashboard.
          </p>
          <div className="max-h-72 overflow-y-auto scrollbar-thin">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-7 px-2 text-[10px]">Method</TableHead>
                  <TableHead className="h-7 px-2 text-[10px]">Endpoint</TableHead>
                  <TableHead className="h-7 px-2 text-[10px]">Fungsi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ENGINE_ENDPOINTS.map((ep) => (
                  <TableRow key={ep.path} className={cn(ep.main && 'bg-emerald-500/[0.06]')}>
                    <TableCell className="px-2 py-1.5">
                      <span className="num rounded bg-muted/60 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-muted-foreground">
                        {ep.method}
                      </span>
                    </TableCell>
                    <TableCell className="px-2 py-1.5">
                      <span className="flex items-center gap-1 font-mono text-[10px] font-semibold">
                        {ep.path}
                        {ep.main ? (
                          <Badge variant="outline" className="border-emerald-500/40 px-1 text-[8px] font-semibold text-emerald-500">
                            <Check className="h-2.5 w-2.5" />
                            dashboard
                          </Badge>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className="px-2 py-1.5 text-[10px] text-muted-foreground">{ep.desc}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>
    </div>
  )
}
