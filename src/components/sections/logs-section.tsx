"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bot,
  Info,
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
  EmptyState,
  Panel,
  Pill,
  SectionHeader,
  StatCard,
} from "@/components/shared";
import { useStore } from "@/lib/store";
import type { LogRow } from "@/lib/types";

type Level = "ALL" | "INFO" | "WARN" | "ERROR" | "TRADE" | "AI";

const LEVELS: { value: Level; label: string }[] = [
  { value: "ALL", label: "Semua" },
  { value: "INFO", label: "Info" },
  { value: "WARN", label: "Warn" },
  { value: "ERROR", label: "Error" },
  { value: "TRADE", label: "Trade" },
  { value: "AI", label: "AI" },
];

const LEVEL_TONE: Record<
  LogRow["level"],
  "default" | "warn" | "down" | "up" | "accent"
> = {
  INFO: "default",
  WARN: "warn",
  ERROR: "down",
  TRADE: "up",
  AI: "accent",
};

function timeHHMMSS(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("id-ID", { hour12: false });
  } catch {
    return "--:--:--";
  }
}

export function LogsSection() {
  const logs = useStore((s) => s.logs);
  const setLogs = useStore((s) => s.setLogs);

  const [level, setLevel] = useState<Level>("ALL");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const fetchLogs = useCallback(
    async (lvl: Level) => {
      setLoading(true);
      try {
        const url = `/api/logs?limit=300${lvl !== "ALL" ? `&level=${lvl}` : ""}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data?.logs) setLogs(data.logs);
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    },
    [setLogs],
  );

  useEffect(() => {
    fetchLogs(level);
  }, [level, fetchLogs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter(
      (l) =>
        l.message.toLowerCase().includes(q) ||
        l.source.toLowerCase().includes(q) ||
        (l.meta ?? "").toLowerCase().includes(q),
    );
  }, [logs, search]);

  const counts = useMemo(() => {
    const c = { total: logs.length, error: 0, trade: 0, ai: 0 };
    for (const l of logs) {
      if (l.level === "ERROR") c.error++;
      else if (l.level === "TRADE") c.trade++;
      else if (l.level === "AI") c.ai++;
    }
    return c;
  }, [logs]);

  const handleClearFilter = () => {
    setLevel("ALL");
    setSearch("");
    toast.success("Filter dibersihkan");
  };

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Log Sistem & Error"
        description="Log runtime, eksekusi trade, dan aktivitas AI."
        icon={<AlertTriangle className="h-4 w-4" />}
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => fetchLogs(level)}
              disabled={loading}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" variant="ghost" onClick={handleClearFilter}>
              <Trash2 className="h-3.5 w-3.5" />
              Bersihkan
            </Button>
          </>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Total Log"
          value={counts.total}
          icon={<Info className="h-4 w-4" />}
        />
        <StatCard
          label="Errors"
          value={counts.error}
          tone="down"
          icon={<AlertTriangle className="h-4 w-4" />}
        />
        <StatCard
          label="Trades"
          value={counts.trade}
          tone="up"
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <StatCard
          label="AI Events"
          value={counts.ai}
          tone="accent"
          icon={<Bot className="h-4 w-4" />}
        />
      </div>

      {/* Filter bar */}
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
          <div className="relative ml-auto w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari pesan / source..."
              className="pl-8"
              aria-label="Search logs"
            />
          </div>
        </div>
      </Panel>

      {/* Log entries */}
      <Panel
        title="Log Entries"
        description={`${filtered.length} dari ${logs.length} entri`}
        actions={
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Terminal className="h-3.5 w-3.5" />
            <span className="tnum">
              {new Date().toLocaleTimeString("id-ID", { hour12: false })}
            </span>
          </div>
        }
        bodyClassName="p-0"
      >
        <div className="max-h-[32rem] overflow-y-auto scroll-thin bg-background/40 font-mono">
          {filtered.length === 0 ? (
            <EmptyState
              icon={<Terminal className="h-8 w-8" />}
              title="Tidak ada log"
              description="Coba ubah filter atau lakukan refresh."
            />
          ) : (
            <ul className="divide-y divide-border/60">
              {filtered.map((l) => (
                <li
                  key={l.id}
                  className="flex items-start gap-3 px-4 py-2 text-xs transition-colors hover:bg-card/40"
                >
                  <span className="mt-0.5 shrink-0 text-muted-foreground tnum">
                    {timeHHMMSS(l.createdAt)}
                  </span>
                  <Pill
                    tone={LEVEL_TONE[l.level]}
                    className="shrink-0 font-mono text-[10px]"
                  >
                    {l.level}
                  </Pill>
                  <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground">
                    {l.source}
                  </span>
                  <span className="min-w-0 flex-1 break-words leading-relaxed">
                    {l.message}
                    {l.meta && (
                      <span className="ml-2 text-muted-foreground">· {l.meta}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>
    </div>
  );
}
