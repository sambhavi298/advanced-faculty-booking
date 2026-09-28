import type { ApiClient } from '@afb/api-client';
import { AppShell, AuthProvider, LoginPage, RequireAuth, ToastProvider, type NavItem } from '@afb/ui';
import { CalendarCheck, LayoutDashboard, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { Route, Routes } from 'react-router';
import { DashboardPage } from './pages/DashboardPage';
import { FacultyPage } from './pages/FacultyPage';
import { FindFacultyPage } from './pages/FindFacultyPage';
import { MyAppointmentsPage } from './pages/MyAppointmentsPage';
import { NotFoundPage } from './pages/NotFoundPage';

const NAV: NavItem[] = [
  {
    to: '/',
    label: 'Dashboard',
    icon: <LayoutDashboard className="h-4 w-4" aria-hidden="true" />,
    end: true,
  },
  { to: '/faculty', label: 'Find faculty', icon: <Search className="h-4 w-4" aria-hidden="true" /> },
  {
    to: '/appointments',
    label: 'My appointments',
    icon: <CalendarCheck className="h-4 w-4" aria-hidden="true" />,
  },
];

function Protected({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <AppShell portalName="Student" nav={NAV}>
        {children}
      </AppShell>
    </RequireAuth>
  );
}

/** The student portal. Rendered inside a router (BrowserRouter in the browser, MemoryRouter in tests). */
export function StudentApp({ api }: { api: ApiClient }) {
  return (
    <AuthProvider api={api} role="STUDENT">
      <ToastProvider>
        <Routes>
          <Route
            path="/login"
            element={
              <LoginPage portalName="Student" idLabel="Registration Number" idPlaceholder="RA221100301001" />
            }
          />
          <Route
            path="/"
            element={
              <Protected>
                <DashboardPage />
              </Protected>
            }
          />
          <Route
            path="/faculty"
            element={
              <Protected>
                <FindFacultyPage />
              </Protected>
            }
          />
          <Route
            path="/faculty/:id"
            element={
              <Protected>
                <FacultyPage />
              </Protected>
            }
          />
          <Route
            path="/appointments"
            element={
              <Protected>
                <MyAppointmentsPage />
              </Protected>
            }
          />
          <Route
            path="*"
            element={
              <Protected>
                <NotFoundPage />
              </Protected>
            }
          />
        </Routes>
      </ToastProvider>
    </AuthProvider>
  );
}
