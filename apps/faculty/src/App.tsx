import type { ApiClient } from '@afb/api-client';
import { AppShell, AuthProvider, LoginPage, RequireAuth, ToastProvider, type NavItem } from '@afb/ui';
import { CalendarClock, History, Inbox, LayoutDashboard } from 'lucide-react';
import type { ReactNode } from 'react';
import { Route, Routes } from 'react-router';
import { AppointmentsPage } from './pages/AppointmentsPage';
import { AvailabilityPage } from './pages/AvailabilityPage';
import { DashboardPage } from './pages/DashboardPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { RequestsPage } from './pages/RequestsPage';

const NAV: NavItem[] = [
  {
    to: '/',
    label: 'Dashboard',
    icon: <LayoutDashboard className="h-4 w-4" aria-hidden="true" />,
    end: true,
  },
  { to: '/requests', label: 'Requests', icon: <Inbox className="h-4 w-4" aria-hidden="true" /> },
  {
    to: '/availability',
    label: 'Availability',
    icon: <CalendarClock className="h-4 w-4" aria-hidden="true" />,
  },
  { to: '/appointments', label: 'History', icon: <History className="h-4 w-4" aria-hidden="true" /> },
];

function Protected({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <AppShell portalName="Faculty" nav={NAV}>
        {children}
      </AppShell>
    </RequireAuth>
  );
}

const PAGES: [path: string, page: ReactNode][] = [
  ['/', <DashboardPage key="dashboard" />],
  ['/requests', <RequestsPage key="requests" />],
  ['/availability', <AvailabilityPage key="availability" />],
  ['/appointments', <AppointmentsPage key="appointments" />],
  ['*', <NotFoundPage key="not-found" />],
];

/** The faculty portal. Rendered inside a router (BrowserRouter in the browser, MemoryRouter in tests). */
export function FacultyApp({ api }: { api: ApiClient }) {
  return (
    <AuthProvider api={api} role="FACULTY">
      <ToastProvider>
        <Routes>
          <Route
            path="/login"
            element={<LoginPage portalName="Faculty" idLabel="Employee ID" idPlaceholder="FAC200" />}
          />
          {PAGES.map(([path, page]) => (
            <Route key={path} path={path} element={<Protected>{page}</Protected>} />
          ))}
        </Routes>
      </ToastProvider>
    </AuthProvider>
  );
}
