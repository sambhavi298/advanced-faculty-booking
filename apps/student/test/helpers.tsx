import type { ApiClient } from '@afb/api-client';
import type { Appointment, AuthUser, FacultyAvailability, FacultySummary } from '@afb/types';
import { render } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { vi } from 'vitest';
import { StudentApp } from '../src/App';

export const STUDENT: AuthUser = {
  id: 1,
  loginId: 'RA221100301001',
  fullName: 'Priya Sharma',
  role: 'STUDENT',
  student: {
    batchId: 1,
    batchName: 'Batch 1',
    yearOfStudy: 3,
    academicYear: '2026-2027',
    departmentCode: 'CSE',
    departmentName: 'Computer Science and Engineering',
  },
};

export const RAO: FacultySummary = {
  id: 2,
  name: 'Prof. K. Rao',
  employeeId: 'FAC200',
  designation: 'Associate Professor',
  officeLocation: 'Tech Park, Staff Room 712',
  slotMinutes: 15,
  department: { id: 1, code: 'CSE', name: 'Computer Science and Engineering' },
  weeklyAvailableMinutes: 580,
  nextAvailableSlot: { startsAt: '2030-01-07T05:10:00.000Z', endsAt: '2030-01-07T05:25:00.000Z' },
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

/** Two days: Monday 7 Jan 2030 with two free slots (10:40, 10:55 IST) and Tuesday with none. */
export function availability(overrides: Partial<FacultyAvailability> = {}): FacultyAvailability {
  return {
    faculty: RAO,
    from: '2030-01-07',
    to: '2030-01-08',
    days: [
      {
        date: '2030-01-07',
        slots: [
          { startsAt: '2030-01-07T05:10:00.000Z', endsAt: '2030-01-07T05:25:00.000Z' },
          { startsAt: '2030-01-07T05:25:00.000Z', endsAt: '2030-01-07T05:40:00.000Z' },
        ],
      },
      { date: '2030-01-08', slots: [] },
      {
        date: '2030-01-09',
        slots: [{ startsAt: '2030-01-09T09:30:00.000Z', endsAt: '2030-01-09T09:45:00.000Z' }],
      },
    ],
    weeklyAvailability: [{ id: 1, dayOfWeek: 1, startTime: '10:00', endTime: '12:00', durationMinutes: 120 }],
    teaching: [
      {
        dayOfWeek: 2,
        startTime: '08:00',
        endTime: '08:50',
        courseCode: '21CSC303J',
        courseTitle: 'Advanced SQL',
        sessionType: 'LECTURE',
        batchName: 'Batch 1',
        room: 'TP 401',
      },
    ],
    ...overrides,
  };
}

export const COUNTS = { PENDING: 1, APPROVED: 2, COMPLETED: 3, CANCELLED: 0, REJECTED: 1 };

/** A signed-in student's ApiClient whose calls are Vitest mocks. */
export function fakeApi() {
  const api = {
    auth: {
      isSignedIn: vi.fn(() => true),
      me: vi.fn().mockResolvedValue(STUDENT),
      login: vi.fn(),
      logout: vi.fn(),
    },
    student: { dashboard: vi.fn() },
    faculty: { list: vi.fn(), availability: vi.fn() },
    appointments: { mine: vi.fn(), create: vi.fn(), cancel: vi.fn() },
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
      <StudentApp api={api.client} />
      <Where />
    </MemoryRouter>,
  );
}
