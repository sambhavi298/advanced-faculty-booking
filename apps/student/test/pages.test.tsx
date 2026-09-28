import { ApiError } from '@afb/api-client';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserStorage } from '../src/api';
import { canCancel } from '../src/pages/MyAppointmentsPage';
import { appointment, availability, COUNTS, fakeApi, RAO, renderApp } from './helpers';

afterEach(() => {
  vi.useRealTimers();
});

describe('student portal routing', () => {
  it('shows the Registration Number login to a signed-out visitor', async () => {
    const api = fakeApi();
    api.api.auth.isSignedIn.mockReturnValue(false);
    renderApp(api, '/appointments');
    expect(await screen.findByRole('heading', { name: 'Student Portal' })).toBeInTheDocument();
    expect(screen.getByLabelText('Registration Number')).toHaveAttribute('placeholder', 'RA221100301001');
  });

  it('shows a not-found page inside the portal for unknown paths', async () => {
    const api = fakeApi();
    renderApp(api, '/nowhere');
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the dashboard' })).toHaveAttribute('href', '/');
  });

  it('uses localStorage for the session when the browser allows it', () => {
    expect(browserStorage()).toBe(window.localStorage);
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(browserStorage()).toBeUndefined();
  });
});

describe('DashboardPage', () => {
  it('greets the student and shows counts, the next appointment and recent activity', async () => {
    const api = fakeApi();
    api.api.student.dashboard.mockResolvedValue({
      student: {
        name: 'Priya Sharma',
        registrationNumber: 'RA221100301001',
        batchName: 'Batch 1',
        departmentName: 'Computer Science and Engineering',
      },
      counts: { ...COUNTS, total: 7 },
      upcoming: appointment({ id: 'u1', status: 'APPROVED', decisionNote: 'Bring your notes' }),
      recent: [appointment({ id: 'r1' }), appointment({ id: 'r2', status: 'REJECTED' })],
    });
    renderApp(api);
    expect(await screen.findByRole('heading', { name: 'Welcome back, Priya' })).toBeInTheDocument();
    expect(screen.getByText('Total appointments').parentElement).toHaveTextContent('7');
    const upcoming = screen.getByRole('region', { name: 'Upcoming appointment' });
    expect(within(upcoming).getByText('Bring your notes', { exact: false })).toBeInTheDocument();
    const recent = screen.getByRole('region', { name: 'Recent activity' });
    expect(within(recent).getAllByRole('listitem')).toHaveLength(2);
    expect(within(recent).getAllByText('Mon, 7 Jan 2030 ·', { exact: false })).toHaveLength(2);
  });

  it('explains empty states for a new student', async () => {
    const api = fakeApi();
    api.api.student.dashboard.mockResolvedValue({
      student: { name: 'Priya', registrationNumber: 'RA1', batchName: 'Batch 1', departmentName: 'CSE' },
      counts: { PENDING: 0, APPROVED: 0, COMPLETED: 0, CANCELLED: 0, REJECTED: 0, total: 0 },
      upcoming: null,
      recent: [],
    });
    renderApp(api);
    expect(await screen.findByText('No upcoming appointment')).toBeInTheDocument();
    expect(screen.getByText('No appointments yet')).toBeInTheDocument();
  });

  it('shows a failure with a retry', async () => {
    const api = fakeApi();
    api.api.student.dashboard.mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'offline'));
    api.api.student.dashboard.mockResolvedValue({
      student: { name: 'Priya', registrationNumber: 'RA1', batchName: 'Batch 1', departmentName: 'CSE' },
      counts: { PENDING: 0, APPROVED: 0, COMPLETED: 0, CANCELLED: 0, REJECTED: 0, total: 0 },
      upcoming: null,
      recent: [],
    });
    renderApp(api);
    expect(
      await screen.findByText('Cannot reach the server. Check your connection and try again.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Welcome back, Priya' })).toBeInTheDocument();
  });
});

describe('FindFacultyPage', () => {
  it('lists faculty with their next free slot, and searches after typing pauses', async () => {
    const api = fakeApi();
    api.api.faculty.list
      .mockResolvedValueOnce([RAO, { ...RAO, id: 3, name: 'Prof. S. Iyer', nextAvailableSlot: null }])
      .mockResolvedValueOnce([RAO])
      .mockResolvedValueOnce([]);
    renderApp(api, '/faculty');
    expect(await screen.findByText('Prof. S. Iyer')).toBeInTheDocument();
    expect(screen.getByText('Next free: Mon, 7 Jan 2030, 10:40 am')).toBeInTheDocument();
    expect(screen.getByText('No free slots in the next 2 weeks')).toBeInTheDocument();
    expect(screen.getAllByText('9 h 40 min a week · 15-minute slots')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'View slots for Prof. K. Rao' })).toHaveAttribute(
      'href',
      '/faculty/2',
    );
    expect(api.api.faculty.list).toHaveBeenLastCalledWith({});

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search faculty' }), ' rao ');
    await waitFor(() => {
      expect(api.api.faculty.list).toHaveBeenLastCalledWith({ search: 'rao' });
    });
    await waitFor(() => {
      expect(screen.queryByText('Prof. S. Iyer')).not.toBeInTheDocument();
    });
    expect(api.api.faculty.list).toHaveBeenCalledTimes(2);

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search faculty' }), 'zzz');
    expect(await screen.findByText('No faculty match “rao zzz”')).toBeInTheDocument();
  });

  it('handles no faculty at all and failures', async () => {
    const api = fakeApi();
    api.api.faculty.list.mockRejectedValueOnce(new Error('x')).mockResolvedValue([]);
    renderApp(api, '/faculty');
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No faculty available')).toBeInTheDocument();
  });
});

describe('FacultyPage (booking)', () => {
  it('shows the profile, office hours and timetable, and books a chosen slot', async () => {
    const api = fakeApi();
    api.api.faculty.availability.mockResolvedValue(availability());
    api.api.appointments.create.mockResolvedValue(appointment());
    api.api.appointments.mine.mockResolvedValue({ appointments: [appointment()], counts: COUNTS });
    renderApp(api, '/faculty/2');

    expect(await screen.findByRole('heading', { name: 'Prof. K. Rao' })).toBeInTheDocument();
    expect(api.api.faculty.availability).toHaveBeenCalledWith(2);
    expect(screen.getByText('10:00 am – 12:00 pm')).toBeInTheDocument();
    expect(screen.getByText('Advanced SQL')).toBeInTheDocument();
    expect(screen.getByText('Tuesday 8:00 am–8:50 am · Batch 1')).toBeInTheDocument();

    const days = screen.getByRole('group', { name: 'Days' });
    expect(within(days).getByRole('button', { name: /Mon, 7 Jan/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(days).getByRole('button', { name: /Tue, 8 Jan/ })).toBeDisabled();

    await userEvent.click(within(days).getByRole('button', { name: /Wed, 9 Jan/ }));
    expect(within(screen.getByRole('group', { name: 'Times' })).getAllByRole('button')).toHaveLength(1);
    await userEvent.click(within(days).getByRole('button', { name: /Mon, 7 Jan/ }));
    await userEvent.click(screen.getByRole('button', { name: '10:55 am' }));
    expect(screen.getByRole('button', { name: '10:55 am' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('10:55 am – 11:10 am with Prof. K. Rao', { exact: false })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('3. Purpose of the meeting'), 'short');
    expect(screen.getByText('5/500 characters')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Request appointment' }));
    expect(screen.getByText('Describe the purpose in at least 10 characters.')).toBeInTheDocument();
    expect(api.api.appointments.create).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText('3. Purpose of the meeting'), ' question on triggers');
    await userEvent.click(screen.getByRole('button', { name: 'Request appointment' }));
    expect(api.api.appointments.create).toHaveBeenCalledWith({
      facultyId: 2,
      startsAt: '2030-01-07T05:25:00.000Z',
      purpose: 'short question on triggers',
    });
    expect(
      await screen.findByText('Request sent to Prof. K. Rao. You will be notified when they respond.'),
    ).toBeInTheDocument();
    // navigate() completes in a transition, so the new location can land a tick after the toast.
    await waitFor(() => {
      expect(screen.getByTestId('where')).toHaveTextContent('/appointments?status=PENDING');
    });
  });

  it('reloads fresh slots when the chosen slot was taken meanwhile', async () => {
    const api = fakeApi();
    api.api.faculty.availability.mockResolvedValue(availability());
    api.api.appointments.create.mockRejectedValue(
      new ApiError(409, 'SLOT_CONFLICT', 'This slot has just been taken by another request.'),
    );
    renderApp(api, '/faculty/2');
    await userEvent.click(await screen.findByRole('button', { name: '10:40 am' }));
    await userEvent.type(screen.getByLabelText('3. Purpose of the meeting'), 'Project discussion');
    await userEvent.click(screen.getByRole('button', { name: 'Request appointment' }));
    expect(await screen.findByText('This slot has just been taken by another request.')).toBeInTheDocument();
    await waitFor(() => {
      expect(api.api.faculty.availability).toHaveBeenCalledTimes(2);
    });
  });

  it('shows server-side purpose validation next to the field, and other failures as a toast', async () => {
    const api = fakeApi();
    api.api.faculty.availability.mockResolvedValue(availability());
    api.api.appointments.create
      .mockRejectedValueOnce(
        new ApiError(400, 'VALIDATION_ERROR', 'Invalid request.', {
          issues: [{ field: 'purpose', message: 'Purpose must not be only spaces.' }],
        }),
      )
      .mockRejectedValueOnce(new ApiError(400, 'VALIDATION_ERROR', 'Invalid request.', { issues: [] }))
      .mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR', 'x'));
    renderApp(api, '/faculty/2');
    await userEvent.click(await screen.findByRole('button', { name: '10:40 am' }));
    await userEvent.type(screen.getByLabelText('3. Purpose of the meeting'), 'Project discussion');
    const submit = screen.getByRole('button', { name: 'Request appointment' });

    await userEvent.click(submit);
    expect(await screen.findByText('Purpose must not be only spaces.')).toBeInTheDocument();
    await userEvent.click(submit);
    expect(await screen.findByText('Invalid request.')).toBeInTheDocument();
    await userEvent.click(submit);
    expect(
      await screen.findByText('Something went wrong on our side. Please try again in a moment.'),
    ).toBeInTheDocument();
    expect(api.api.faculty.availability).toHaveBeenCalledTimes(1);
  });

  it('explains when nothing is free and when the faculty has no hours or classes', async () => {
    const api = fakeApi();
    api.api.faculty.availability.mockResolvedValue(
      availability({ days: [{ date: '2030-01-07', slots: [] }], weeklyAvailability: [], teaching: [] }),
    );
    renderApp(api, '/faculty/2');
    expect(await screen.findByText('No free slots in this period')).toBeInTheDocument();
    expect(screen.getByText('No weekly office hours set.')).toBeInTheDocument();
    expect(screen.getByText('No classes scheduled.')).toBeInTheDocument();
  });

  it('shows a load failure with a retry', async () => {
    const api = fakeApi();
    api.api.faculty.availability
      .mockRejectedValueOnce(new ApiError(404, 'NOT_FOUND', 'Faculty member not found.'))
      .mockResolvedValue(availability());
    renderApp(api, '/faculty/99');
    expect(await screen.findByText('Faculty member not found.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Prof. K. Rao' })).toBeInTheDocument();
  });
});

describe('MyAppointmentsPage', () => {
  it('opens the tab named in the URL, shows counts, and switches tabs', async () => {
    const api = fakeApi();
    api.api.appointments.mine.mockImplementation((status: string) =>
      Promise.resolve({
        appointments: status === 'APPROVED' ? [appointment({ status: 'APPROVED' })] : [],
        counts: COUNTS,
      }),
    );
    renderApp(api, '/appointments?status=APPROVED');
    expect(await screen.findByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Approved/, selected: true })).toHaveTextContent('Approved2');
    expect(api.api.appointments.mine).toHaveBeenCalledWith('APPROVED');

    await userEvent.click(screen.getByRole('tab', { name: /Completed/ }));
    expect(await screen.findByText('No completed appointments yet.')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/appointments?status=COMPLETED');
  });

  it('falls back to the Pending tab for an unknown status', async () => {
    const api = fakeApi();
    api.api.appointments.mine.mockResolvedValue({ appointments: [], counts: COUNTS });
    renderApp(api, '/appointments?status=BOGUS');
    expect(await screen.findByText('No requests waiting for a decision.')).toBeInTheDocument();
    expect(api.api.appointments.mine).toHaveBeenCalledWith('PENDING');
  });

  it('cancels a request with an optional reason after confirmation', async () => {
    const api = fakeApi();
    api.api.appointments.mine
      .mockResolvedValueOnce({ appointments: [appointment()], counts: COUNTS })
      .mockResolvedValue({ appointments: [], counts: { ...COUNTS, PENDING: 0, CANCELLED: 1 } });
    api.api.appointments.cancel.mockResolvedValue(appointment({ status: 'CANCELLED' }));
    renderApp(api, '/appointments');

    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    const dialog = screen.getByRole('dialog', { name: 'Cancel this appointment?' });
    expect(within(dialog).getByText('Prof. K. Rao will be notified.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.type(screen.getByLabelText('Reason (optional)'), '  Clash with lab  ');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel appointment' }));
    expect(api.api.appointments.cancel).toHaveBeenCalledWith('a1', 'Clash with lab');
    expect(await screen.findByText('Appointment with Prof. K. Rao cancelled.')).toBeInTheDocument();
    expect(await screen.findByText('No requests waiting for a decision.')).toBeInTheDocument();
  });

  it('cancels without a reason, and reports a failed cancellation', async () => {
    const api = fakeApi();
    api.api.appointments.mine.mockResolvedValue({ appointments: [appointment()], counts: COUNTS });
    api.api.appointments.cancel
      .mockRejectedValueOnce(
        new ApiError(409, 'INVALID_STATUS_TRANSITION', 'This request has already been approved.'),
      )
      .mockResolvedValue(appointment({ status: 'CANCELLED' }));
    renderApp(api, '/appointments');

    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel appointment' }));
    expect(await screen.findByText('This request has already been approved.')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel appointment' }));
    expect(api.api.appointments.cancel).toHaveBeenLastCalledWith('a1', undefined);
  });

  it('shows a load failure with a retry', async () => {
    const api = fakeApi();
    api.api.appointments.mine
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValue({ appointments: [], counts: COUNTS });
    renderApp(api, '/appointments');
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No requests waiting for a decision.')).toBeInTheDocument();
  });

  it('only offers cancellation before an approved appointment starts', () => {
    const now = Date.parse('2030-01-07T05:00:00.000Z');
    expect(canCancel(appointment(), now)).toBe(true);
    expect(canCancel(appointment({ status: 'APPROVED' }), now)).toBe(true);
    expect(canCancel(appointment({ status: 'APPROVED' }), now + 3_600_000)).toBe(false);
    expect(canCancel(appointment({ status: 'COMPLETED' }), now)).toBe(false);
    expect(canCancel(appointment())).toBe(true);
  });
});
