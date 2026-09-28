import type { ApiClient } from '@afb/api-client';
import type {
  AdminDashboard,
  AdminFaculty,
  AdminStudent,
  Appointment,
  AuditEntry,
  AuthUser,
  MonthlyReportRow,
} from '@afb/types';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { AdminApp } from '../src/App';

export const AMY: AuthUser = { id: 4, loginId: 'ADMIN001', fullName: 'Amy', role: 'ADMIN' };

export function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'a1',
    status: 'PENDING',
    startsAt: '2030-01-07T05:10:00.000Z',
    endsAt: '2030-01-07T05:25:00.000Z',
    purpose: 'Doubt in BCNF decomposition',
    decisionNote: null,
    createdAt: '2030-01-01T04:30:00.000Z',
    decidedAt: null,
    cancelledAt: null,
    cancelledBy: null,
    completedAt: null,
    student: { id: 1, name: 'Priya Sharma', registrationNumber: 'RA221100301001', batchName: 'Batch 1' },
    faculty: {
      id: 2,
      name: 'Prof. K. Rao',
      employeeId: 'FAC200',
      designation: 'Associate Professor',
      officeLocation: 'Tech Park, Staff Room 712',
      departmentCode: 'CSE',
      departmentName: 'Computer Science and Engineering',
    },
    ...overrides,
  };
}

export function auditEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 50,
    occurredAt: '2030-01-07T05:00:00.000Z',
    transactionId: '900',
    actor: { id: 2, name: 'Prof. K. Rao', loginId: 'FAC200', role: 'FACULTY' },
    tableName: 'appointments',
    recordId: 'a1',
    action: 'UPDATE',
    changedFields: ['decided_at', 'status'],
    oldData: { status: 'PENDING', decided_at: null },
    newData: { status: 'APPROVED', decided_at: '2030-01-07T10:30:00+05:30' },
    ...overrides,
  };
}

export function dashboard(overrides: Partial<AdminDashboard> = {}): AdminDashboard {
  return {
    totals: { students: 120, faculty: 12, departments: 3, batches: 6, activeUsers: 130, appointments: 42 },
    appointmentsByStatus: { PENDING: 5, APPROVED: 7, COMPLETED: 20, REJECTED: 6, CANCELLED: 4 },
    today: { meetings: 1, requests: 3 },
    daily: Array.from({ length: 14 }, (_, index) => ({
      date: `2030-01-${String(index + 1).padStart(2, '0')}`,
      requests: index % 3,
    })),
    topFaculty: [
      {
        rank: 1,
        facultyId: 2,
        name: 'Prof. K. Rao',
        departmentCode: 'CSE',
        requests: 30,
        pending: 3,
        approvalRatePct: 80,
      },
      {
        rank: 2,
        facultyId: 3,
        name: 'Prof. S. Iyer',
        departmentCode: 'CSE',
        requests: 12,
        pending: 2,
        approvalRatePct: null,
      },
    ],
    recentAudit: [auditEntry(), auditEntry({ id: 49, actor: null, action: 'INSERT', changedFields: null })],
    ...overrides,
  };
}

export function student(overrides: Partial<AdminStudent> = {}): AdminStudent {
  return {
    id: 1,
    name: 'Priya Sharma',
    registrationNumber: 'RA221100301001',
    batchName: 'Batch 1',
    yearOfStudy: 3,
    departmentCode: 'CSE',
    isActive: true,
    lastLoginAt: '2030-01-07T05:00:00.000Z',
    appointments: { total: 4, pending: 1, upcoming: 2 },
    ...overrides,
  };
}

export function facultyMember(overrides: Partial<AdminFaculty> = {}): AdminFaculty {
  return {
    id: 2,
    name: 'Prof. K. Rao',
    employeeId: 'FAC200',
    designation: 'Associate Professor',
    officeLocation: 'Tech Park, Staff Room 712',
    departmentCode: 'CSE',
    departmentName: 'Computer Science and Engineering',
    slotMinutes: 15,
    weeklyAvailableMinutes: 580,
    isActive: true,
    lastLoginAt: null,
    appointments: { total: 10, pending: 2, upcoming: 3 },
    ...overrides,
  };
}

export function reportRow(overrides: Partial<MonthlyReportRow> = {}): MonthlyReportRow {
  return {
    facultyId: 2,
    facultyName: 'Prof. K. Rao',
    departmentCode: 'CSE',
    month: '2030-01-01',
    totalRequests: 12,
    pending: 1,
    approved: 4,
    completed: 5,
    rejected: 2,
    cancelled: 0,
    avgResponseMinutes: 35.5,
    approvalRatePct: 81.8,
    demandRankInDepartment: 1,
    changeFromPreviousMonth: 3,
    cumulativeRequests: 40,
    ...overrides,
  };
}

/** A signed-in admin's ApiClient whose calls are Vitest mocks. */
export function fakeApi() {
  const api = {
    auth: {
      isSignedIn: vi.fn(() => true),
      me: vi.fn().mockResolvedValue(AMY),
      login: vi.fn(),
      logout: vi.fn(),
    },
    admin: {
      dashboard: vi.fn(),
      students: vi.fn(),
      faculty: vi.fn(),
      departments: vi.fn(),
      setUserStatus: vi.fn(),
      appointments: vi.fn(),
      audit: vi.fn(),
      reports: vi.fn(),
      refreshReports: vi.fn(),
    },
    notifications: {
      list: vi.fn().mockResolvedValue({ unread: 0, notifications: [] }),
      markAllRead: vi.fn(),
    },
    onSessionExpired: vi.fn(() => () => undefined),
  };
  return { api, client: api as unknown as ApiClient };
}

export function renderApp(api: ReturnType<typeof fakeApi>, path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AdminApp api={api.client} />
    </MemoryRouter>,
  );
}
