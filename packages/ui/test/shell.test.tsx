import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Home } from 'lucide-react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../src/auth/AuthProvider';
import { AppShell } from '../src/components/AppShell';
import { NotificationBell } from '../src/components/NotificationBell';
import { useAsync } from '../src/hooks/useAsync';
import { useDebounced } from '../src/hooks/useDebounced';
import { fakeApi, STUDENT } from './fixtures';

const NOTIFICATIONS = {
  unread: 12,
  notifications: [
    {
      id: 'n1',
      kind: 'APPOINTMENT_APPROVED' as const,
      title: 'Appointment approved',
      body: 'Prof. K. Rao approved your request.',
      appointmentId: 'a1',
      readAt: null,
      createdAt: '2030-01-07T05:10:00.000Z',
    },
    {
      id: 'n2',
      kind: 'APPOINTMENT_REJECTED' as const,
      title: 'Appointment rejected',
      body: 'Not available.',
      appointmentId: 'a2',
      readAt: '2030-01-07T06:00:00.000Z',
      createdAt: '2030-01-06T05:10:00.000Z',
    },
  ],
};

async function renderShell(api: ReturnType<typeof fakeApi>, children = <p>Page body</p>, wide = false) {
  api.api.auth.me.mockResolvedValue(STUDENT);
  render(
    <MemoryRouter initialEntries={['/']}>
      <AuthProvider api={api.client} role="STUDENT">
        <AppShell
          wide={wide}
          portalName="Student"
          nav={[
            { to: '/', label: 'Dashboard', icon: <Home />, end: true },
            { to: '/faculty', label: 'Find faculty', icon: <Home /> },
          ]}
        >
          {children}
        </AppShell>
      </AuthProvider>
    </MemoryRouter>,
  );
  await screen.findByText('Priya Sharma');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('AppShell', () => {
  it('shows the portal, navigation, the signed-in user and signs out', async () => {
    const api = fakeApi(true);
    await renderShell(api);
    expect(screen.getByText('Student portal')).toBeInTheDocument();
    expect(screen.getByText('RA221100301001')).toBeInTheDocument();
    expect(screen.getByText('Page body')).toBeInTheDocument();
    const desktop = screen.getByRole('navigation', { name: 'Main' });
    expect(desktop.querySelector('a[href="/"]')).toHaveClass('bg-brand-50');
    expect(desktop.querySelector('a[href="/faculty"]')).not.toHaveClass('bg-brand-50');
    const mobile = screen.getByRole('navigation', { name: 'Main (mobile)' });
    expect(mobile.querySelector('a[href="/"]')).toHaveClass('bg-brand-50');
    expect(mobile.querySelector('a[href="/faculty"]')).toHaveClass('text-slate-600');

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(api.api.auth.logout).toHaveBeenCalled();
  });
});

describe('AppShell (wide)', () => {
  it('uses the wider layout for data-heavy portals', async () => {
    const api = fakeApi(true);
    await renderShell(api, <p>Tables</p>, true);
    expect(screen.getByRole('main')).toHaveClass('max-w-7xl');
    expect(screen.getByRole('navigation', { name: 'Main' })).toHaveClass('xl:flex');
  });
});

describe('NotificationBell', () => {
  it('shows the unread count, lists notifications and marks them read', async () => {
    const api = fakeApi(true);
    api.api.notifications.list
      .mockResolvedValueOnce(NOTIFICATIONS)
      .mockResolvedValueOnce(NOTIFICATIONS)
      .mockResolvedValue({ unread: 0, notifications: NOTIFICATIONS.notifications });
    await renderShell(api);

    const bell = await screen.findByRole('button', { name: 'Notifications, 12 unread' });
    expect(bell).toHaveTextContent('9+');
    await userEvent.click(bell);
    expect(bell).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Prof. K. Rao approved your request.')).toBeInTheDocument();
    expect(screen.getByText('Appointment approved').closest('li')).toHaveClass('bg-brand-50/60');
    expect(screen.getByText('Appointment rejected').closest('li')).not.toHaveClass('bg-brand-50/60');

    await userEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(api.api.notifications.markAllRead).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark all read' })).not.toBeInTheDocument();
  });

  it('shows a small unread count as is, and an empty list politely', async () => {
    const api = fakeApi(true);
    api.api.notifications.list.mockResolvedValueOnce({ unread: 3, notifications: [] });
    await renderShell(api);
    const bell = await screen.findByRole('button', { name: 'Notifications, 3 unread' });
    expect(bell).toHaveTextContent('3');
    await userEvent.click(bell);
    expect(screen.getByText('No notifications yet.')).toBeInTheDocument();
  });

  it('closes on Escape and on a click outside, but not on a click inside', async () => {
    const api = fakeApi(true);
    await renderShell(api);
    const bell = screen.getByRole('button', { name: 'Notifications' });

    await userEvent.click(bell);
    fireEvent.keyDown(document, { key: 'Enter' });
    fireEvent.mouseDown(screen.getByText('No notifications yet.'));
    expect(bell).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(bell).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(bell);
    fireEvent.mouseDown(screen.getByText('Page body'));
    expect(bell).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps working when the notification service is unreachable', async () => {
    const api = fakeApi(true);
    api.api.notifications.list.mockRejectedValue(new Error('offline'));
    api.api.notifications.markAllRead.mockRejectedValue(new Error('offline'));
    api.api.notifications.list.mockResolvedValueOnce({ unread: 1, notifications: [] });
    await renderShell(api);
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
    await userEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(api.api.notifications.markAllRead).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Notifications, 1 unread' })).toBeInTheDocument();
  });

  it('polls for new notifications', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = fakeApi(true);
    api.api.auth.me.mockResolvedValue(STUDENT);
    render(
      <AuthProvider api={api.client} role="STUDENT">
        <NotificationBell pollMs={1000} />
      </AuthProvider>,
    );
    expect(api.api.notifications.list).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(api.api.notifications.list).toHaveBeenCalledTimes(3);
  });
});

describe('useDebounced', () => {
  it('returns a value only after it stopped changing for the delay', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useDebounced(value, 300), {
      initialProps: { value: 'r' },
    });
    rerender({ value: 'ra' });
    rerender({ value: 'rao' });
    expect(result.current).toBe('r');
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current).toBe('r');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('rao');
  });
});

describe('useAsync', () => {
  it('loads, reports success, reloads on demand and when its inputs change', async () => {
    const loader = vi.fn((query: string) => Promise.resolve(`result for ${query}`));
    const { result, rerender } = renderHook(({ query }) => useAsync(() => loader(query), [query]), {
      initialProps: { query: 'rao' },
    });
    expect(result.current.status).toBe('loading');
    await waitFor(() => {
      expect(result.current.data).toBe('result for rao');
    });

    act(() => {
      result.current.reload();
    });
    expect(result.current.status).toBe('loading');
    await waitFor(() => {
      expect(result.current.status).toBe('success');
    });
    expect(loader).toHaveBeenCalledTimes(2);

    rerender({ query: 'iyer' });
    expect(result.current.status).toBe('loading');
    await waitFor(() => {
      expect(result.current.data).toBe('result for iyer');
    });
  });

  it('reports errors', async () => {
    const failure = new Error('nope');
    const { result } = renderHook(() => useAsync(() => Promise.reject(failure), []));
    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
    expect(result.current.error).toBe(failure);
  });

  it('never lets a stale response overwrite a newer one', async () => {
    const pending: Record<string, { resolve: (value: string) => void; reject: (error: Error) => void }> = {};
    const loader = (query: string) =>
      new Promise<string>((resolve, reject) => {
        pending[query] = { resolve, reject };
      });
    const { result, rerender } = renderHook(({ query }) => useAsync(() => loader(query), [query]), {
      initialProps: { query: 'old' },
    });
    rerender({ query: 'fail-old' });
    rerender({ query: 'new' });
    await act(async () => {
      pending.old?.resolve('old result');
      pending['fail-old']?.reject(new Error('stale'));
      pending.new?.resolve('new result');
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.data).toBe('new result');
    });
  });
});
