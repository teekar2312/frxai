'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import {
  Bell, Zap, Info, ArrowUpCircle, ArrowDownCircle,
  CheckCheck, Loader2, Inbox,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

import { Skeleton } from '@/components/ui/skeleton';


// ============================================================
// Types
// ============================================================

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  pair: string | null;
  data: Record<string, unknown> | null;
  isRead: boolean;
  createdAt: string;
}

// ============================================================
// Helpers
// ============================================================

const NOTIFICATION_ICON: Record<string, React.ElementType> = {
  signal: Zap,
  alert: Bell,
  position_open: ArrowUpCircle,
  position_close: ArrowDownCircle,
  system: Info,
  auto_trade: Zap,
};

const NOTIFICATION_COLOR: Record<string, string> = {
  signal: 'text-amber-400',
  alert: 'text-rose-400',
  position_open: 'text-emerald-400',
  position_close: 'text-zinc-400',
  system: 'text-sky-400',
  auto_trade: 'text-violet-400',
};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return 'Baru saja';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m lalu`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}j lalu`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}h lalu`;
  return `${Math.floor(diffDay / 7)}mg lalu`;
}

// ============================================================
// NotificationBell – compact bell with badge (for header)
// ============================================================

export function NotificationBell() {
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll unread count every 15s
  useEffect(() => {
    const fetchCount = async () => {
      try {
        const res = await fetch('/api/notifications/unread-count');
        if (res.ok) {
          const data = await res.json();
          setUnreadCount(data.count ?? 0);
        }
      } catch {
        // silent
      }
    };

    fetchCount();
    timerRef.current = setInterval(fetchCount, 15_000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Fetch notifications when popover opens
  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/notifications?unreadOnly=true');
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications ?? []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) fetchNotifications();
  };

  const markAsRead = async (id: string) => {
    try {
      await fetch('/api/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      // silent
    }
  };

  const markAllRead = async () => {
    try {
      const ids = notifications.map((n) => n.id);
      if (ids.length === 0) return;
      await fetch('/api/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
      toast.success('Semua notifikasi ditandai sebagai dibaca');
    } catch {
      toast.error('Gagal menandai notifikasi');
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative text-zinc-400 hover:text-zinc-100">
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-[10px] font-bold text-white leading-none">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[360px] max-w-[calc(100vw-2rem)] p-0 bg-zinc-900 border-zinc-800"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-100">Notifikasi</h3>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-zinc-400 hover:text-zinc-200 h-7"
              onClick={markAllRead}
            >
              <CheckCheck className="w-3.5 h-3.5 mr-1" />
              Tandai semua dibaca
            </Button>
          )}
        </div>

        {/* Content */}
        {loading ? (
          <div className="p-4 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="w-8 h-8 rounded-full bg-zinc-800 shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-3/4 bg-zinc-800" />
                  <Skeleton className="h-3 w-full bg-zinc-800" />
                </div>
              </div>
            ))}
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-zinc-500">
            <Inbox className="w-10 h-10 mb-2" />
            <p className="text-sm">Tidak ada notifikasi</p>
          </div>
        ) : (
          <ScrollArea className="max-h-80">
            <div className="divide-y divide-zinc-800/50">
              {notifications.map((notif) => {
                const Icon = NOTIFICATION_ICON[notif.type] ?? Info;
                const iconColor = NOTIFICATION_COLOR[notif.type] ?? 'text-zinc-400';
                return (
                  <button
                    key={notif.id}
                    onClick={() => !notif.isRead && markAsRead(notif.id)}
                    className={`w-full text-left px-4 py-3 flex gap-3 hover:bg-zinc-800/50 transition-colors ${!notif.isRead ? 'bg-zinc-800/30' : ''}`}
                  >
                    <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${iconColor}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`text-sm truncate ${!notif.isRead ? 'text-zinc-100 font-medium' : 'text-zinc-300'}`}>
                          {notif.title}
                        </span>
                        {notif.pair && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-zinc-700 text-zinc-400 shrink-0">
                            {notif.pair}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500 line-clamp-2 leading-relaxed">
                        {notif.message}
                      </p>
                      <span className="text-[10px] text-zinc-600 mt-1 block">
                        {timeAgo(notif.createdAt)}
                      </span>
                    </div>
                    {!notif.isRead && (
                      <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0 mt-1.5" />
                    )}
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ============================================================
// NotificationCenter – full panel version
// ============================================================

export function NotificationCenter() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/notifications');
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications ?? []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const markAsRead = async (id: string) => {
    try {
      await fetch('/api/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    } catch {
      // silent
    }
  };

  const markAllRead = async () => {
    setMarkingAll(true);
    try {
      const unreadIds = notifications.filter((n) => !n.isRead).map((n) => n.id);
      if (unreadIds.length === 0) return;
      await fetch('/api/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: unreadIds }),
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      toast.success('Semua notifikasi ditandai sebagai dibaca');
    } catch {
      toast.error('Gagal menandai notifikasi');
    } finally {
      setMarkingAll(false);
    }
  };

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="w-5 h-5 text-zinc-400" />
          <h2 className="text-lg font-semibold text-zinc-100">Notifikasi</h2>
          {unreadCount > 0 && (
            <Badge className="bg-rose-500 text-white hover:bg-rose-600 text-xs px-1.5">
              {unreadCount}
            </Badge>
          )}
        </div>
        {unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="text-xs border-zinc-700 text-zinc-300 hover:bg-zinc-800 h-8"
            onClick={markAllRead}
            disabled={markingAll}
          >
            {markingAll ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <CheckCheck className="w-3.5 h-3.5 mr-1" />}
            Tandai semua dibaca
          </Button>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex gap-3 p-3 rounded-lg bg-zinc-900 border border-zinc-800">
              <Skeleton className="w-8 h-8 rounded-full bg-zinc-800 shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-2/3 bg-zinc-800" />
                <Skeleton className="h-3 w-full bg-zinc-800" />
                <Skeleton className="h-2.5 w-1/3 bg-zinc-800" />
              </div>
            </div>
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
          <Inbox className="w-12 h-12 mb-3" />
          <p className="text-sm">Tidak ada notifikasi</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
          {notifications.map((notif) => {
            const Icon = NOTIFICATION_ICON[notif.type] ?? Info;
            const iconColor = NOTIFICATION_COLOR[notif.type] ?? 'text-zinc-400';
            return (
              <button
                key={notif.id}
                onClick={() => !notif.isRead && markAsRead(notif.id)}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${!notif.isRead ? 'bg-zinc-800/50 border-zinc-700/50 hover:border-zinc-600' : 'bg-zinc-900 border-zinc-800/50 hover:border-zinc-700'}`}
              >
                <div className="flex gap-3">
                  <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${iconColor}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-sm truncate ${!notif.isRead ? 'text-zinc-100 font-medium' : 'text-zinc-300'}`}>
                        {notif.title}
                      </span>
                      {notif.pair && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-zinc-700 text-zinc-400 shrink-0">
                          {notif.pair}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500 line-clamp-2 leading-relaxed">
                      {notif.message}
                    </p>
                    <span className="text-[10px] text-zinc-600 mt-1 block">
                      {timeAgo(notif.createdAt)}
                    </span>
                  </div>
                  {!notif.isRead && (
                    <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0 mt-1.5" />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
