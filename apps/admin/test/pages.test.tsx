import { ApiError } from '@afb/api-client';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { browserStorage } from '../src/api';
import { actorLabel } from '../src/components/AuditSummary';
import {
  appointment,
  auditEntry,
  dashboard,
  facultyMember,
  fakeApi,
  renderApp,
  reportRow,
  student,
} from './helpers';

describe('admin portal routing', () => {
  it('shows the Admin ID login to a signed-out visitor', async () => {
    const api = fakeApi();
    api.api.auth.isSignedIn.mockReturnValue(false);
    renderApp(api, '/audit');
    expect(await screen.findByRole('heading', { name: 'Admin Portal' })).toBeInTheDocument();
    expect(screen.getByLabelText('Admin ID')).toHaveAttribute('placeholder', 'ADMIN001');
  });

  it('shows a not-found page inside the portal', async () => {
    renderApp(fakeApi(), '/nowhere');
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(screen.getByText('Admin portal')).toBeInTheDocument();
  });

  it('keeps the session in localStorage when the browser allows it', () => {
    expect(browserStorage()).toBe(window.localStorage);
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(browserStorage()).toBeUndefined();
  });
});

describe('DashboardPage', () => {
  it('shows live totals, status counts, daily requests, top faculty and latest changes', async () => {
    const api = fakeApi();
    api.api.admin.dashboard.mockResolvedValue(dashboard());
    renderApp(api);
    expect(await screen.findByRole('heading', { name: 'System overview' })).toBeInTheDocument();
    expect(screen.getByText('Students', { selector: 'p' }).parentElement).toHaveTextContent('120');
    expect(screen.getByText('Departments', { selector: 'p' }).parentElement).toHaveTextContent(
      '3 · 6 batches',
    );
    expect(screen.getByText('Today: 1 meeting, 3 new requests.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'New requests per day, last 14 days' })).toBeInTheDocument();
    const ranking = screen.getByRole('table', { name: 'Faculty ranked by number of requests' });
    expect(within(ranking).getAllByRole('row')).toHaveLength(3);
    expect(within(ranking).getByText('80%')).toBeInTheDocument();
    expect(within(ranking).getByText('—')).toBeInTheDocument();
    expect(screen.getByText(/by Prof. K. Rao \(FAC200\)/)).toBeInTheDocument();
    expect(screen.getByText(/by System/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Full audit log →' })).toHaveAttribute('href', '/audit');
  });

  it('uses plurals correctly and retries after a failure', async () => {
    const api = fakeApi();
    api.api.admin.dashboard
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValue(dashboard({ today: { meetings: 2, requests: 1 }, daily: [] }));
    renderApp(api);
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Today: 2 meetings, 1 new request.')).toBeInTheDocument();
  });
});

describe('StudentsPage and FacultyPage', () => {
  it('lists students, searches after typing pauses, and deactivates an account after confirmation', async () => {
    const api = fakeApi();
    api.api.admin.students
      .mockResolvedValueOnce([
        student(),
        student({ id: 5, name: 'Arjun Mehta', lastLoginAt: null, isActive: false }),
      ])
      .mockResolvedValueOnce([student()])
      .mockResolvedValue([student({ isActive: false })]);
    api.api.admin.setUserStatus.mockResolvedValue({});
    renderApp(api, '/students');

    const table = await screen.findByRole('table', { name: 'Students' });
    expect(within(table).getAllByText('Batch 1 · Year 3 · CSE', { exact: false })).toHaveLength(2);
    expect(within(table).getByText('Never')).toBeInTheDocument();
    expect(within(table).getByText('Deactivated')).toBeInTheDocument();

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search students' }), 'priya');
    await waitFor(() => {
      expect(api.api.admin.students).toHaveBeenLastCalledWith({ search: 'priya' });
    });
    await waitFor(() => {
      expect(screen.queryByText('Arjun Mehta')).not.toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Deactivate Priya Sharma' }));
    const dialog = screen.getByRole('dialog', { name: 'Deactivate Priya Sharma?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Deactivate Priya Sharma' }));
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Deactivate Priya Sharma' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Deactivate' }));
    expect(api.api.admin.setUserStatus).toHaveBeenCalledWith(1, false);
    expect(await screen.findByText('Priya Sharma has been deactivated and signed out.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Reactivate Priya Sharma' })).toBeInTheDocument();
  });

  it('reactivates an account and reports failures', async () => {
    const api = fakeApi();
    api.api.admin.students.mockResolvedValue([student({ isActive: false })]);
    api.api.admin.setUserStatus
      .mockRejectedValueOnce(new ApiError(409, 'CONFLICT', 'You cannot deactivate your own account.'))
      .mockResolvedValue({});
    renderApp(api, '/students');
    await userEvent.click(await screen.findByRole('button', { name: 'Reactivate Priya Sharma' }));
    expect(await screen.findByText('You cannot deactivate your own account.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reactivate Priya Sharma' }));
    expect(await screen.findByText('Priya Sharma can sign in again.')).toBeInTheDocument();
    expect(api.api.admin.setUserStatus).toHaveBeenLastCalledWith(1, true);
  });

  it('shows empty results and load failures for students', async () => {
    const api = fakeApi();
    api.api.admin.students.mockRejectedValueOnce(new Error('x')).mockResolvedValue([]);
    renderApp(api, '/students');
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No students found')).toBeInTheDocument();
  });

  it('lists faculty with office hours and workload, and searches', async () => {
    const api = fakeApi();
    api.api.admin.faculty
      .mockResolvedValueOnce([
        facultyMember(),
        facultyMember({ id: 3, name: 'Prof. S. Iyer', lastLoginAt: '2030-01-07T05:00:00.000Z' }),
      ])
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValue([facultyMember()]);
    renderApp(api, '/faculty');
    const table = await screen.findByRole('table', { name: 'Faculty' });
    expect(within(table).getAllByText('9 h 40 min a week · 15-min slots')).toHaveLength(2);
    expect(within(table).getByText('Never')).toBeInTheDocument();
    expect(within(table).getByText('Mon, 7 Jan 2030, 10:30 am')).toBeInTheDocument();

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search faculty' }), 'zzz');
    expect(await screen.findByText('No faculty found')).toBeInTheDocument();
    expect(api.api.admin.faculty).toHaveBeenLastCalledWith({ search: 'zzz' });

    await userEvent.clear(screen.getByRole('searchbox', { name: 'Search faculty' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table', { name: 'Faculty' })).toBeInTheDocument();
    expect(api.api.admin.faculty).toHaveBeenLastCalledWith({});
  });
});

describe('DepartmentsPage', () => {
  it('shows per-department counts, empty state and failures', async () => {
    const api = fakeApi();
    api.api.admin.departments
      .mockResolvedValueOnce([
        {
          id: 1,
          code: 'CSE',
          name: 'Computer Science and Engineering',
          faculty: 2,
          students: 1,
          batches: 2,
          appointments: 9,
        },
      ])
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValue([]);
    const { unmount } = renderApp(api, '/departments');
    const table = await screen.findByRole('table', { name: 'Departments' });
    expect(within(table).getByText('Computer Science and Engineering')).toBeInTheDocument();
    expect(within(table).getByText('9')).toBeInTheDocument();
    unmount();

    renderApp(api, '/departments');
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No departments yet')).toBeInTheDocument();
  });
});

describe('AppointmentsPage', () => {
  it('filters on the server, resets to the first page on a new filter, and pages', async () => {
    const api = fakeApi();
    api.api.admin.faculty.mockResolvedValue([facultyMember()]);
    api.api.admin.appointments.mockImplementation((filter: { offset: number }) =>
      Promise.resolve({
        appointments: [
          appointment({ id: `a${String(filter.offset)}` }),
          appointment({ id: `b${String(filter.offset)}`, status: 'REJECTED', decisionNote: 'On leave' }),
        ],
        total: 45,
        limit: 20,
        offset: filter.offset,
      }),
    );
    renderApp(api, '/appointments');
    expect(await screen.findByText('Showing 1–2 of 45')).toBeInTheDocument();
    expect(screen.getByText('Note: On leave')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Showing 21–22 of 45')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Showing 41–42 of 45')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(await screen.findByText('Showing 21–22 of 45')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'REJECTED');
    expect(await screen.findByText('Showing 1–2 of 45')).toBeInTheDocument();
    await userEvent.selectOptions(await screen.findByLabelText('Faculty'), '2');
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2030-01-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2030-01-31' } });
    await userEvent.type(screen.getByLabelText('Student or faculty'), 'priya');
    await waitFor(() => {
      expect(api.api.admin.appointments).toHaveBeenLastCalledWith({
        status: 'REJECTED',
        facultyId: 2,
        search: 'priya',
        from: '2030-01-01',
        to: '2030-01-31',
        limit: 20,
        offset: 0,
      });
    });
  });

  it('shows no-match and error states', async () => {
    const api = fakeApi();
    api.api.admin.faculty.mockRejectedValue(new Error('x'));
    api.api.admin.appointments
      .mockRejectedValueOnce(new ApiError(400, 'VALIDATION_ERROR', '"from" must not be after "to".'))
      .mockResolvedValue({ appointments: [], total: 0, limit: 20, offset: 0 });
    renderApp(api, '/appointments');
    expect(await screen.findByText('"from" must not be after "to".')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No appointments match these filters')).toBeInTheDocument();
  });
});

describe('AuditPage', () => {
  it('shows entries newest first, their details, filters and loads older pages', async () => {
    const api = fakeApi();
    api.api.admin.audit.mockImplementation((filter: { before?: number; table?: string; action?: string }) => {
      if (filter.table !== undefined || filter.action !== undefined) {
        return Promise.resolve({ entries: [], nextBefore: null });
      }
      if (filter.before === undefined) {
        return Promise.resolve({ entries: [auditEntry()], nextBefore: 50 });
      }
      if (filter.before === 50) {
        return Promise.resolve({
          entries: [auditEntry({ id: 40, action: 'INSERT', changedFields: null, recordId: 'x40' })],
          nextBefore: 40,
        });
      }
      return Promise.reject(new Error('offline'));
    });
    renderApp(api, '/audit');
    expect(await screen.findByText('#a1')).toBeInTheDocument();
    expect(screen.getByText('Entry #50 · transaction 900')).toBeInTheDocument();
    expect(screen.getByText(/"from": "PENDING"/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Load older entries' }));
    expect(await screen.findByText('#x40')).toBeInTheDocument();
    expect(screen.getByText(/"status": "APPROVED"/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Load older entries' }));
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    expect(api.api.admin.audit).toHaveBeenLastCalledWith({ before: 40, limit: 25 });

    await userEvent.selectOptions(screen.getByLabelText('Table'), 'users');
    expect(await screen.findByText('No audit entries match these filters')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Action'), 'DELETE');
    await waitFor(() => {
      expect(api.api.admin.audit).toHaveBeenLastCalledWith({ table: 'users', action: 'DELETE', limit: 25 });
    });
    expect(screen.queryByRole('button', { name: 'Load older entries' })).not.toBeInTheDocument();
  });

  it('loads older entries with filters applied, and retries after a failure', async () => {
    const api = fakeApi();
    api.api.admin.audit
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValueOnce({ entries: [auditEntry()], nextBefore: null })
      .mockResolvedValueOnce({ entries: [auditEntry({ id: 60, tableName: 'users' })], nextBefore: 60 })
      .mockResolvedValue({
        entries: [auditEntry({ id: 59, tableName: 'users', recordId: 'u59' })],
        nextBefore: null,
      });
    renderApp(api, '/audit');
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('#a1')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Table'), 'users');
    await userEvent.click(await screen.findByRole('button', { name: 'Load older entries' }));
    expect(await screen.findByText('#u59')).toBeInTheDocument();
    expect(api.api.admin.audit).toHaveBeenLastCalledWith({ table: 'users', before: 60, limit: 25 });
  });

  it('names actors, including deleted accounts and system changes', () => {
    expect(actorLabel(auditEntry())).toBe('Prof. K. Rao (FAC200)');
    expect(actorLabel(auditEntry({ actor: null }))).toBe('System');
    expect(actorLabel(auditEntry({ actor: { id: 9, name: null, loginId: null, role: null } }))).toBe(
      'User 9',
    );
  });
});

describe('ReportsPage', () => {
  it('shows the materialized view, filters by month and refreshes it on demand', async () => {
    const api = fakeApi();
    api.api.admin.reports
      .mockResolvedValueOnce({
        rows: [
          reportRow(),
          reportRow({
            facultyId: 3,
            facultyName: 'Prof. S. Iyer',
            demandRankInDepartment: 2,
            changeFromPreviousMonth: -2,
            approvalRatePct: null,
            avgResponseMinutes: null,
          }),
          reportRow({ facultyId: 4, month: '2029-12-01', changeFromPreviousMonth: null }),
          reportRow({ facultyId: 5, month: '2029-12-01', changeFromPreviousMonth: 0 }),
        ],
        refreshedAt: '2030-01-07T05:00:00.000Z',
      })
      .mockResolvedValue({ rows: [], refreshedAt: null });
    api.api.admin.refreshReports
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValue({ refreshedAt: '2030-01-07T06:00:00.000Z' });
    renderApp(api, '/reports');

    const table = await screen.findByRole('table', {
      name: 'Monthly appointment statistics per faculty member',
    });
    expect(within(table).getAllByText('Jan 2030')).toHaveLength(2);
    expect(within(table).getAllByText('Dec 2029')).toHaveLength(2);
    expect(within(table).getByText('+3')).toBeInTheDocument();
    expect(within(table).getByText('-2')).toBeInTheDocument();
    expect(within(table).getAllByText('81.8%')).toHaveLength(3);
    expect(within(table).getAllByText('35.5 min')).toHaveLength(3);
    expect(within(table).getAllByText('—')).toHaveLength(3);
    expect(screen.getByText('Last refreshed Mon, 7 Jan 2030, 10:30 am')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
    expect(await screen.findByText('Report refreshed from the latest appointments.')).toBeInTheDocument();
    expect(await screen.findByText('Nothing to report')).toBeInTheDocument();
    expect(
      screen.getByText('No data for this selection yet — refresh to include the latest appointments.'),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2029-12' } });
    await waitFor(() => {
      expect(api.api.admin.reports).toHaveBeenLastCalledWith('2029-12');
    });
    expect(api.api.admin.reports).toHaveBeenNthCalledWith(1, undefined);
  });

  it('shows a load failure with a retry', async () => {
    const api = fakeApi();
    api.api.admin.reports
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValue({ rows: [], refreshedAt: null });
    renderApp(api, '/reports');
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Nothing to report')).toBeInTheDocument();
  });
});
