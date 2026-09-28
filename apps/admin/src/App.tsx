import type { ApiClient } from '@afb/api-client';
import { AppShell, AuthProvider, LoginPage, RequireAuth, ToastProvider, type NavItem } from '@afb/ui';
import {
  BarChart3,
  Building2,
  CalendarSearch,
  GraduationCap,
  LayoutDashboard,
  ScrollText,
  Users,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Route, Routes } from 'react-router';
import { AppointmentsPage } from './pages/AppointmentsPage';
import { AuditPage } from './pages/AuditPage';
import { DashboardPage } from './pages/DashboardPage';
import { DepartmentsPage } from './pages/DepartmentsPage';
import { FacultyPage } from './pages/FacultyPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ReportsPage } from './pages/ReportsPage';
import { StudentsPage } from './pages/StudentsPage';

const icon = (Icon: typeof Users) => <Icon className="h-4 w-4" aria-hidden="true" />;

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: icon(LayoutDashboard), end: true },
  { to: '/students', label: 'Students', icon: icon(GraduationCap) },
  { to: '/faculty', label: 'Faculty', icon: icon(Users) },
  { to: '/departments', label: 'Departments', icon: icon(Building2) },
  { to: '/appointments', label: 'Appointments', icon: icon(CalendarSearch) },
  { to: '/audit', label: 'Audit log', icon: icon(ScrollText) },
  { to: '/reports', label: 'Reports', icon: icon(BarChart3) },
];

const PAGES: [path: string, page: ReactNode][] = [
  ['/', <DashboardPage key="dashboard" />],
  ['/students', <StudentsPage key="students" />],
  ['/faculty', <FacultyPage key="faculty" />],
  ['/departments', <DepartmentsPage key="departments" />],
  ['/appointments', <AppointmentsPage key="appointments" />],
  ['/audit', <AuditPage key="audit" />],
  ['/reports', <ReportsPage key="reports" />],
  ['*', <NotFoundPage key="not-found" />],
];

/** The admin portal. Rendered inside a router (BrowserRouter in the browser, MemoryRouter in tests). */
export function AdminApp({ api }: { api: ApiClient }) {
  return (
    <AuthProvider api={api} role="ADMIN">
      <ToastProvider>
        <Routes>
          <Route
            path="/login"
            element={<LoginPage portalName="Admin" idLabel="Admin ID" idPlaceholder="ADMIN001" />}
          />
          {PAGES.map(([path, page]) => (
            <Route
              key={path}
              path={path}
              element={
                <RequireAuth>
                  <AppShell portalName="Admin" nav={NAV} wide>
                    {page}
                  </AppShell>
                </RequireAuth>
              }
            />
          ))}
        </Routes>
      </ToastProvider>
    </AuthProvider>
  );
}
