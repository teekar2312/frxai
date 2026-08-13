'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { RefreshCw, Trash2, Loader2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { type ActivityLogEntry } from './shared';

export function ActivityLogPanel() {
  const [logs, setLogs] = useState<ActivityLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [logPage, setLogPage] = useState(1);
  const [logTotalPages, setLogTotalPages] = useState(1);
  const [logFilter, setLogFilter] = useState<{ level: string; category: string }>({ level: 'all', category: 'all' });

  // Fetch logs
  const loadLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(logPage), limit: '30' });
      if (logFilter.level !== 'all') params.set('level', logFilter.level);
      if (logFilter.category !== 'all') params.set('category', logFilter.category);
      const res = await fetch(`/api/logs?${params}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
        setLogTotalPages(data.pagination?.totalPages || 1);
      }
    } catch {
      // silent
    } finally {
      setLogsLoading(false);
    }
  }, [logPage, logFilter]);

  useEffect(() => {
    const id = setTimeout(loadLogs, 0);
    const interval = setInterval(loadLogs, 15000);
    return () => { clearTimeout(id); clearInterval(interval); };
  }, [logPage, logFilter, loadLogs]);

  // Clear logs
  const handleClearLogs = async () => {
    try {
      await fetch('/api/logs?all=true', { method: 'DELETE' });
      toast.success('Logs cleared');
      loadLogs();
    } catch {
      toast.error('Failed to clear logs');
    }
  };

  const levelColors: Record<string, string> = {
    error: 'text-rose-400 bg-rose-500/10',
    warn: 'text-amber-400 bg-amber-500/10',
    info: 'text-emerald-400 bg-emerald-500/10',
    debug: 'text-zinc-400 bg-zinc-700/30',
  };

  return (
    <div className="space-y-4">
      {/* Filters and controls */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={logFilter.level} onValueChange={(v) => { setLogFilter(f => ({ ...f, level: v })); setLogPage(1); }}>
          <SelectTrigger className="w-32 bg-zinc-800 border-zinc-700 text-zinc-300 h-8 text-xs">
            <SelectValue placeholder="All Levels" />
          </SelectTrigger>
          <SelectContent className="bg-zinc-800 border-zinc-700">
            <SelectItem value="all" className="text-zinc-200">All Levels</SelectItem>
            <SelectItem value="error" className="text-rose-400">Error</SelectItem>
            <SelectItem value="warn" className="text-amber-400">Warning</SelectItem>
            <SelectItem value="info" className="text-blue-400">Info</SelectItem>
            <SelectItem value="debug" className="text-zinc-400">Debug</SelectItem>
          </SelectContent>
        </Select>
        <Select value={logFilter.category} onValueChange={(v) => { setLogFilter(f => ({ ...f, category: v })); setLogPage(1); }}>
          <SelectTrigger className="w-36 bg-zinc-800 border-zinc-700 text-zinc-300 h-8 text-xs">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent className="bg-zinc-800 border-zinc-700">
            <SelectItem value="all" className="text-zinc-200">All Categories</SelectItem>
            <SelectItem value="trading" className="text-zinc-200">Trading</SelectItem>
            <SelectItem value="analysis" className="text-zinc-200">Analysis</SelectItem>
            <SelectItem value="alert" className="text-zinc-200">Alert</SelectItem>
            <SelectItem value="system" className="text-zinc-200">System</SelectItem>
            <SelectItem value="api" className="text-zinc-200">API</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={loadLogs} className="border-zinc-700 text-zinc-300 h-8">
          <RefreshCw className="w-3 h-3" /> Refresh
        </Button>
        <Button variant="outline" size="sm" onClick={handleClearLogs} className="border-rose-500/30 text-rose-400 hover:bg-rose-500/10 h-8">
          <Trash2 className="w-3 h-3" /> Clear Logs
        </Button>
      </div>

      {/* Log table */}
      <Card className="bg-zinc-900 border-zinc-800 p-4">
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <Table aria-label="Log aktivitas">
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="text-[10px] text-zinc-500 w-20">Level</TableHead>
                  <TableHead className="text-[10px] text-zinc-500 w-24">Category</TableHead>
                  <TableHead className="text-[10px] text-zinc-500">Message</TableHead>
                  <TableHead className="text-[10px] text-zinc-500 w-40">Timestamp</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logsLoading ? (
                  <TableRow><TableCell colSpan={4} className="py-8">
                    <div className="space-y-2">
                      <div className="flex items-center justify-center gap-2 text-zinc-500">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-xs">Loading logs...</span>
                      </div>
                      {[1, 2, 3].map(i => (
                        <Skeleton key={i} className="h-6 w-full bg-zinc-800" />
                      ))}
                    </div>
                  </TableCell></TableRow>
                ) : logs.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-xs text-zinc-500 text-center py-8">No logs found</TableCell></TableRow>
                ) : (
                  logs.map((log) => (
                    <TableRow key={log.id} className="border-zinc-800/50">
                      <TableCell>
                        <Badge className={`text-[10px] ${levelColors[log.level] || levelColors.debug}`}>{log.level}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-zinc-400">{log.category}</TableCell>
                      <TableCell className="text-xs text-zinc-300 max-w-md truncate">{log.message}</TableCell>
                      <TableCell className="text-[10px] text-zinc-500 font-mono">
                        {format(new Date(log.createdAt), 'MM/dd HH:mm:ss')}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-zinc-800">
            <span className="text-[10px] text-zinc-500">Page {logPage} of {logTotalPages}</span>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" disabled={logPage <= 1} onClick={() => setLogPage(p => p - 1)}
                className="h-7 px-2 text-xs border-zinc-700 text-zinc-300">Prev</Button>
              <Button variant="outline" size="sm" disabled={logPage >= logTotalPages} onClick={() => setLogPage(p => p + 1)}
                className="h-7 px-2 text-xs border-zinc-700 text-zinc-300">Next</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
