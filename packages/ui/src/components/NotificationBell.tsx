import type { NotificationList } from '@afb/types';
import { Bell } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { cn } from '../cn';
import { formatDateTime } from '../format';

/** Unread badge + dropdown of the latest notifications. Polls every `pollMs` so approvals appear without a reload. */
export function NotificationBell({ pollMs = 30_000 }: { pollMs?: number }) {
  const { api } = useAuth();
  const [list, setList] = useState<NotificationList>({ unread: 0, notifications: [] });
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    api.notifications.list(10).then(setList, () => undefined);
  }, [api]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, pollMs);
    return () => {
      clearInterval(timer);
    };
  }, [refresh, pollMs]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onClick = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const markAllRead = () => {
    api.notifications.markAllRead().then(refresh, () => undefined);
  };

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        aria-label={list.unread > 0 ? `Notifications, ${String(list.unread)} unread` : 'Notifications'}
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          refresh();
        }}
        className="relative rounded-full p-2 text-slate-600 hover:bg-slate-100"
      >
        <Bell className="h-5 w-5" />
        {list.unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[11px] font-semibold text-white">
            {list.unread > 9 ? '9+' : list.unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-slate-200">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <p className="text-sm font-semibold text-slate-900">Notifications</p>
            {list.unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-xs font-medium text-brand-700 hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>
          {list.notifications.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">No notifications yet.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
              {list.notifications.map((notification) => (
                <li
                  key={notification.id}
                  className={cn('px-4 py-3', notification.readAt === null && 'bg-brand-50/60')}
                >
                  <p className="text-sm font-medium text-slate-900">{notification.title}</p>
                  <p className="mt-0.5 text-sm text-slate-600">{notification.body}</p>
                  <p className="mt-1 text-xs text-slate-400">{formatDateTime(notification.createdAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
