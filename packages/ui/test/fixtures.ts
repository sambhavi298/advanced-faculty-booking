import type { ApiClient } from '@afb/api-client';
import type { Appointment, AuthUser } from '@afb/types';
import { vi } from 'vitest';

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

/** An ApiClient whose methods are Vitest mocks. Only what a test configures is meaningful. */
export function fakeApi(signedIn = false) {
  const expiredListeners = new Set<(error: unknown) => void>();
  const api = {
    auth: {
      isSignedIn: vi.fn(() => signedIn),
      me: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
    },
    notifications: {
      list: vi.fn().mockResolvedValue({ unread: 0, notifications: [] }),
      markAllRead: vi.fn().mockResolvedValue(undefined),
    },
    onSessionExpired: vi.fn((listener: (error: unknown) => void) => {
      expiredListeners.add(listener);
      return () => {
        expiredListeners.delete(listener);
      };
    }),
  };
  const expire = () => {
    for (const listener of expiredListeners) {
      listener(new Error('expired'));
    }
  };
  return { api, client: api as unknown as ApiClient, expire };
}
