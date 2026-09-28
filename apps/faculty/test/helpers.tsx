import type { ApiClient } from '@afb/api-client';
import type { Appointment, AuthUser, FacultyDashboard, MyAvailability } from '@afb/types';
import { render } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { vi } from 'vitest';
import { FacultyApp } from '../src/App';

export const RAO: AuthUser = {
  id: 2,
  loginId: 'FAC200',
  fullName: 'Prof. K. Rao',
  role: 'FACULTY',
  faculty: {
    departmentId: 1,
    departmentCode: 'CSE',
    departmentName: 'Computer Science and Engineering',
    designation: 'Associate Professor',
    officeLocation: 'Tech Park, Staff Room 712',
    slotMinutes: 15,
  },
};

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

export const COUNTS = { PENDING: 2, APPROVED: 3, COMPLETED: 4, CANCELLED: 0, REJECTED: 1 };

export function dashboard(overrides: Partial<FacultyDashboard> = {}): FacultyDashboard {
  const weeks = [
    '2029-11-19',
    '2029-11-26',
    '2029-12-03',
    '2029-12-10',
    '2029-12-17',
    '2029-12-24',
    '2029-12-31',
    '2030-01-07',
  ];
  return {
    faculty: {
      name: 'Prof. K. Rao',
      employeeId: 'FAC200',
      designation: 'Associate Professor',
      departmentName: 'Computer Science and Engineering',
      officeLocation: 'Tech Park, Staff Room 712',
      slotMinutes: 15,
    },
    counts: { ...COUNTS, total: 10 },
    today: [appointment({ id: 't1', status: 'APPROVED', purpose: 'Project review' })],
    pending: [appointment({ id: 'p1', purpose: 'Doubt in triggers' })],
    upcoming: [
      appointment({
        id: 'u1',
        status: 'APPROVED',
        startsAt: '2030-01-11T09:00:00.000Z',
        endsAt: '2030-01-11T09:15:00.000Z',
        purpose: 'Viva preparation',
      }),
    ],
    stats: {
      responded: 5,
      approvalRatePct: 80,
      medianResponseMinutes: 42.4,
      weekly: weeks.map((weekStart, index) => ({
        weekStart,
        requests: index,
        accepted: Math.floor(index / 2),
      })),
    },
    recent: [appointment({ id: 'r1', status: 'REJECTED', purpose: 'Late request' })],
    ...overrides,
  };
}

export function availability(overrides: Partial<MyAvailability> = {}): MyAvailability {
  return {
    slotMinutes: 15,
    windows: [
      { id: 2, dayOfWeek: 5, startTime: '13:20', endTime: '15:05', durationMinutes: 105 },
      { id: 1, dayOfWeek: 1, startTime: '10:40', endTime: '12:25', durationMinutes: 105 },
    ],
    exceptions: [
      {
        id: 7,
        kind: 'MEETING',
        startsAt: '2030-01-08T09:30:00.000Z',
        endsAt: '2030-01-08T11:30:00.000Z',
        reason: 'Board of Studies',
        createdAt: '2030-01-01T04:30:00.000Z',
      },
    ],
    ...overrides,
  };
}

/** A signed-in faculty member's ApiClient whose calls are Vitest mocks. */
export function fakeApi() {
  const api = {
    auth: {
      isSignedIn: vi.fn(() => true),
      me: vi.fn().mockResolvedValue(RAO),
      login: vi.fn(),
      logout: vi.fn(),
    },
    faculty: {
      dashboard: vi.fn(),
      myAvailability: vi.fn(),
      replaceAvailability: vi.fn(),
      addException: vi.fn(),
      removeException: vi.fn(),
    },
    appointments: { mine: vi.fn(), pending: vi.fn(), approve: vi.fn(), reject: vi.fn() },
    notifications: {
      list: vi.fn().mockResolvedValue({ unread: 0, notifications: [] }),
      markAllRead: vi.fn(),
    },
    onSessionExpired: vi.fn(() => () => undefined),
  };
  return { api, client: api as unknown as ApiClient };
}

function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
}

export function renderApp(api: ReturnType<typeof fakeApi>, path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <FacultyApp api={api.client} />
      <Where />
    </MemoryRouter>,
  );
}
