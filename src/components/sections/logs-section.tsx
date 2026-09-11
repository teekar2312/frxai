"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eraser,
  Info,
  Loader2,
  RefreshCw,
  Search,
  Terminal,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EmptyState,
  Panel,
  Pill,
  SectionHeader,
  StatCard,
} from "@/components/shared";
import { useStore } from "@/lib/store";
import type { LogRow } from "@/lib/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type Level = "ALL" | "INFO" | "WARN" | "ERROR" | "TRADE" | "AI";

const LEVELS: { value: Level; label: string }[] = [
  { value: "ALL", label: "Semua" },
  { value: "INFO", label: "Info" },
  { value: "WARN", label: "Warn" },
  { value: "ERROR", label: "Error" },
  { value: "TRADE", label: "Trade" },
  { value: "AI", label: "AI" },
];

const LEVEL_TONE: Record<LogRow["level"], "default" | "warn" | "down" | "up" | "accent"> = {
  INFO: "default",
  WARN: "warn",
  ERROR: "down",
  TRADE: "up",
  AI: "accent",
};

function timeFmt(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getDate().toString().padStart(2, "0")}/${(d.getMonth() + 1).toString().padStart(2, "0")} ${d.toLocaleTimeString("id-ID", { hour12: false })}`;
  } catch {
    return "--/-- --:--:--";
  }
}

export function LogsSection() {
  const logs = useStore((s) => s.logs);
  const setLogs = useStore((s) => s.setLogs);

  const [level, setLevel] = useState<Level>("ALL");
  const [source, setSource] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [liveClock, setLiveClock] = useState(new Date());
  const [dbTotal, setDbTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [pollFailures, setPollFailures] = useState(0); // V2-M8: track consecutive failures
  const latestLogTsRef = useRef<string | null>(null); // V2-H4: track newest log for `since` param

  // V2-C1 FIX: mergeLogs uses useStore.getState() — no `logs` in deps
  const mergeLogs = useCallback((newLogs: LogRow[]) => {
    const existing = useStore.getState().logs;
    const existingIds = new Set(existing.map((l) => l.id));
    const fresh = newLogs.filter((l) => !existingIds.has(l.id));
    if (fresh.length > 0) {
      setLogs([...fresh, ...existing].slice(0, 500));
      latestLogTsRef.current = fresh[0].createdAt; // newest log
    }
  }, [setLogs]);

  // V2-C1 FIX: fetchLogs does NOT depend on `logs` — uses useStore.getState() for append
  const fetchLogs = useCallback(
    async (lvl: Level, src: string, append = false) => {
      if (!append) setLoading(true);
      try {
        const params = new URLSearchParams({ limit: "300" });
        if (lvl !== "ALL") params.set("level", lvl);
        if (src !== "ALL") params.set("source", src);
        if (append && nextCursor) params.set("cursor", nextCursor);

        const res = await fetch(`/api/logs?${params}`);
        if (!res.ok) throw new Error("fetch failed");
        const data = await res.json();

        if (append) {
          // V2-H5 FIX: use useStore.getState() instead of stale closure `logs`
          const current = useStore.getState().logs;
          const currentIds = new Set(current.map((l) => l.id));
          const newOnes = (data.logs as LogRow[]).filter((l) => !currentIds.has(l.id));
          setLogs([...current, ...newOnes].slice(0, 500));
        } else {
          setLogs(data.logs);
          if (data.logs.length > 0) {
            latestLogTsRef.current = data.logs[0].createdAt;
          }
        }
        setDbTotal(data.total ?? 0);
        setHasMore(data.hasMore ?? false);
        setNextCursor(data.nextCursor ?? null);
      } catch {
        toast.error("Gagal memuat log");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [setLogs, nextCursor], // V2-C1 FIX: removed `logs` from deps
  );

  // Initial fetch — V2-C1 FIX: stable deps, no re-fetch loop
  useEffect(() => {
    fetchLogs("ALL", "ALL");
  }, [fetchLogs]);

  // V2-H4 FIX: real-time polling uses `since` param to fetch ONLY new logs
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(async () => {
      if (document.hidden) return;
      try {
        const since = latestLogTsRef.current;
        const params = new URLSearchParams({ limit: "100" });
        if (since) params.set("since", since);
        const res = await fetch(`/api/logs?${params}`);
        if (!res.ok) throw new Error("poll failed");
        const data = await res.json();
        // V2-M2 FIX: always update dbTotal
        setDbTotal(data.total ?? 0);
        if (data.logs && data.logs.length > 0) {
          mergeLogs(data.logs);
        }
        setPollFailures(0); // reset on success
      } catch {
        setPollFailures((n) => n + 1); // V2-M8: track failures
      }
    }, 5000);
    return () => clearInterval(id);
  }, [autoRefresh, mergeLogs]);

  // Live clock (runs regardless of autoRefresh)
  useEffect(() => {
    const id = setInterval(() => setLiveClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // V2-M7: immediate fetch on resume
  const handleToggleAutoRefresh = () => {
    const newVal = !autoRefresh;
    setAutoRefresh(newVal);
    if (newVal) {
      // Immediate fetch on resume
      fetchLogs("ALL", "ALL");
    }
  };

  // Client-side filtering
  const filtered = useMemo(() => {
    return logs.filter((l) => {
      if (level !== "ALL" && l.level !== level) return false;
      if (source !== "ALL" && !l.source.includes(source)) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          l.message.toLowerCase().includes(q) ||
          l.source.toLowerCase().includes(q) ||
          (l.meta ?? "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [logs, level, source, search]);

  const counts = useMemo(() => {
    const c = { total: dbTotal, error: 0, trade: 0, ai: 0 };
    for (const l of logs) {
      if (l.level === "ERROR") c.error++;
      else if (l.level === "TRADE") c.trade++;
      else if (l.level === "AI") c.ai++;
    }
    return c;
  }, [logs, dbTotal]);

  const sources = useMemo(() => {
    const set = new Set(logs.map((l) => l.source));
    return Array.from(set).sort();
  }, [logs]);

  const handleClearFilter = () => {
    setLevel("ALL");
    setSource("ALL");
    setSearch("");
    toast.success("Filter dibersihkan");
  };

  // V2-H6 FIX: reset hasMore/nextCursor on clear
  const handleClearLogs = async () => {
    try {
      const res = await fetch("/api/logs", { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      const data = await res.json();
      toast.success("Log dibersihkan", { description: `${data.deleted} entri dihapus.` });
      setLogs([]);
      setDbTotal(0);
      setHasMore(false);
      setNextCursor(null);
      latestLogTsRef.current = null;
    } catch {
      toast.error("Gagal menghapus log");
    }
  };

  const handleExport = (format: "csv" | "json") => {
    const params = new URLSearchParams({ format, limit: "500" });
    if (level !== "ALL") params.set("level", level);
    if (source !== "ALL") params.set("source", source);
    if (search) params.set("q", search); // V2-L2: include search in export
    window.open(`/api/logs?${params}`, "_blank");
  };

  const handleCopy = async (l: LogRow) => {
    const text = `[${l.createdAt}] ${l.level} ${l.source}: ${l.message}${l.meta ? ` | ${l.meta}` : ""}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Log disalin");
    } catch {
      toast.error("Gagal menyalin");
    }
  };

  // V2-H1 FIX: pass current filter to Load More
  const handleLoadMore = () => {
    setLoadingMore(true);
    fetchLogs(level, source, true);
  };

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Log Sistem & Error"
        description="Log runtime, eksekusi trade, aktivitas AI, dan alert. Auto-refresh 5 detik."
        icon={<AlertTriangle className="h-4 w-4" />}
        actions={
          <>
            <Button
              size="sm"
              variant={autoRefresh ? "outline" : "ghost"}
              onClick={handleToggleAutoRefresh}
            >
              {autoRefresh ? <span className="size-2 rounded-full bg-emerald-500 live-dot" /> : <span className="size-2 rounded-full bg-muted-foreground/40" />}
              {autoRefresh ? "Live" : "Paused"}
            </Button>
            {/* V2-M8: show disconnected indicator after 3+ consecutive failures */}
            {pollFailures >= 3 && autoRefresh && (
              <span className="flex items-center gap-1 text-xs text-rose-400">
                <AlertTriangle className="size-3" /> Koneksi terputus
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => fetchLogs("ALL", "ALL")}
              disabled={loading}
            >
              {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Refresh
            </Button>
            <Button size="sm" variant="ghost" onClick={handleClearFilter}>
              <Eraser className="size-3.5" />
              Reset Filter
            </Button>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => handleExport("csv")}>
                <Download className="size-3.5" /> CSV
              </Button>
              <Button size="sm" variant="ghost" onClick={() => handleExport("json")}>
                <Download className="size-3.5" /> JSON
              </Button>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="ghost" className="text-rose-400 hover:text-rose-300">
                  <Trash2 className="size-3.5" /> Hapus Log
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Hapus semua log?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Tindakan ini akan menghapus semua {dbTotal} entri log dari database. Tidak dapat dibatalkan.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Batal</AlertDialogCancel>
                  <AlertDialogAction onClick={handleClearLogs} className="bg-rose-500 hover:bg-rose-600">
                    Hapus Semua
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total Log (DB)" value={dbTotal} icon={<Info className="size-4" />} />
        <StatCard label="Errors" value={counts.error} tone="down" icon={<AlertTriangle className="size-4" />} />
        <StatCard label="Trades" value={counts.trade} tone="up" icon={<TrendingUp className="size-4" />} />
        <StatCard label="AI Events" value={counts.ai} tone="accent" icon={<Bot className="size-4" />} />
      </div>

      <Panel title="Filter">
        <div className="flex flex-wrap items-center gap-3">
          <ToggleGroup
            type="single"
            value={level}
            onValueChange={(v) => v && setLevel(v as Level)}
            variant="outline"
            size="sm"
            className="flex-wrap"
          >
            {LEVELS.map((l) => (
              <ToggleGroupItem key={l.value} value={l.value} className="px-3">
                {l.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger size="sm" className="w-[150px]">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Semua Source</SelectItem>
              {sources.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative ml-auto w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari pesan / source / meta..."
              className="pl-8"
              aria-label="Search logs"
            />
          </div>
        </div>
      </Panel>

      <Panel
        title="Log Entries"
        description={`${filtered.length} dari ${logs.length} fetched (DB: ${dbTotal})`}
        actions={
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Terminal className="size-3.5" />
            <span className="tnum">{liveClock.toLocaleTimeString("id-ID", { hour12: false })}</span>
          </div>
        }
        bodyClassName="p-0"
      >
        {/* V2-M4 FIX: removed aria-live to prevent screen-reader spam */}
        <div className="max-h-[32rem] overflow-y-auto scroll-thin bg-background/40 font-mono" role="log">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<Terminal className="size-8" />}
              title="Tidak ada log"
              description="Coba ubah filter atau lakukan refresh."
            />
          ) : (
            <>
              <ul className="divide-y divide-border/60">
                {filtered.map((l) => (
                  <LogRowItem key={l.id} log={l} onCopy={() => handleCopy(l)} />
                ))}
              </ul>
              {hasMore && (
                <div className="border-t border-border p-3 text-center">
                  <Button size="sm" variant="ghost" onClick={handleLoadMore} disabled={loadingMore}>
                    {loadingMore ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    Muat Lebih Banyak
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </Panel>
    </div>
  );
}

// V2-H3 FIX: try/catch on JSON.parse for meta
function LogRowItem({ log, onCopy }: { log: LogRow; onCopy: () => void }) {
  const [expanded, setExpanded] = useState(false);

  const formatMeta = (meta: string): string => {
    if (!expanded) return meta;
    try {
      return JSON.stringify(JSON.parse(meta), null, 2);
    } catch {
      return meta; // V2-H3: fallback to raw if not valid JSON
    }
  };

  return (
    <li className="group flex items-start gap-3 px-4 py-2 text-xs transition-colors hover:bg-card/40">
      <span className="mt-0.5 shrink-0 text-muted-foreground tnum">
        {timeFmt(log.createdAt)}
      </span>
      <Pill tone={LEVEL_TONE[log.level]} className="shrink-0 font-mono text-[10px]">
        {log.level}
      </Pill>
      <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground">
        {log.source}
      </span>
      <div className="min-w-0 flex-1">
        <span className={`break-words leading-relaxed ${expanded ? "" : "line-clamp-2"}`}>
          {log.message}
        </span>
        {log.meta && (
          <button
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            aria-label={expanded ? "Sembunyikan detail" : "Tampilkan detail"}
            className="ml-2 inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
          >
            {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            <span className={expanded ? "block whitespace-pre-wrap" : "truncate"}>
              {formatMeta(log.meta)}
            </span>
          </button>
        )}
      </div>
      <button
        onClick={onCopy}
        className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
        aria-label="Copy log"
      >
        <Copy className="size-3" />
      </button>
    </li>
  );
}
