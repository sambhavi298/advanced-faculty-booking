import { ApiError } from '@afb/api-client';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { browserStorage } from '../src/api';
import { campusInstant, sortWindows, validateWindows } from '../src/pages/availability-rules';
import { appointment, availability, COUNTS, dashboard, fakeApi, renderApp } from './helpers';

describe('faculty portal routing', () => {
  it('shows the Employee ID login to a signed-out visitor', async () => {
    const api = fakeApi();
    api.api.auth.isSignedIn.mockReturnValue(false);
    renderApp(api, '/requests');
    expect(await screen.findByRole('heading', { name: 'Faculty Portal' })).toBeInTheDocument();
    expect(screen.getByLabelText('Employee ID')).toHaveAttribute('placeholder', 'FAC200');
  });

  it('shows a not-found page inside the portal for unknown paths', async () => {
    const api = fakeApi();
    renderApp(api, '/nowhere');
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(screen.getByText('Faculty portal')).toBeInTheDocument();
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
  it("shows today's schedule, pending requests, what is coming up, statistics and recent activity", async () => {
    const api = fakeApi();
    api.api.faculty.dashboard.mockResolvedValue(dashboard());
    renderApp(api);
    expect(await screen.findByRole('heading', { name: 'Welcome, Prof. K. Rao' })).toBeInTheDocument();
    expect(screen.getByText('Waiting for you').parentElement).toHaveTextContent('2');
    expect(screen.getByText('Meetings today').parentElement).toHaveTextContent('1');
    expect(screen.getByText('Approval rate').parentElement).toHaveTextContent('80%');
    expect(screen.getByText('Project review')).toBeInTheDocument();
    expect(screen.getByText('Doubt in triggers')).toBeInTheDocument();
    expect(screen.getByText('Viva preparation')).toBeInTheDocument();
    expect(screen.getByText('Fri, 11 Jan 2030 · 2:30 pm – 2:45 pm')).toBeInTheDocument();
    expect(screen.getByText('Late request')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review all →' })).toHaveAttribute('href', '/requests');
    expect(screen.getByRole('img', { name: 'Requests per week, last 8 weeks' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Requests per week' })).toBeInTheDocument();
    expect(
      screen.getByText(/You answered 5 requests before their time; typical response 42 min\./),
    ).toBeInTheDocument();
  });

  it('explains empty sections for a faculty member without appointments', async () => {
    const api = fakeApi();
    api.api.faculty.dashboard.mockResolvedValue(
      dashboard({
        counts: { PENDING: 0, APPROVED: 0, COMPLETED: 0, CANCELLED: 0, REJECTED: 0, total: 0 },
        today: [],
        pending: [],
        upcoming: [],
        recent: [],
        stats: {
          responded: 0,
          approvalRatePct: null,
          medianResponseMinutes: null,
          weekly: dashboard().stats.weekly.map((week) => ({ ...week, requests: 0, accepted: 0 })),
        },
      }),
    );
    renderApp(api);
    expect(await screen.findByText('No meetings today.')).toBeInTheDocument();
    expect(screen.getByText('Nothing is waiting for a decision.')).toBeInTheDocument();
    expect(screen.getByText('No approved appointments after today.')).toBeInTheDocument();
    expect(screen.getByText('No appointments yet')).toBeInTheDocument();
    expect(screen.getByText('Approval rate').parentElement).toHaveTextContent('—');
    expect(screen.getByText('Response statistics appear after your first decision.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Review all →' })).not.toBeInTheDocument();
  });

  it('uses the singular for one answered request', async () => {
    const api = fakeApi();
    const base = dashboard();
    api.api.faculty.dashboard.mockResolvedValue(
      dashboard({ stats: { ...base.stats, responded: 1, medianResponseMinutes: 90 } }),
    );
    renderApp(api);
    expect(
      await screen.findByText('You answered 1 request before their time; typical response 1 h 30 min.'),
    ).toBeInTheDocument();
  });

  it('shows a failure with a retry', async () => {
    const api = fakeApi();
    api.api.faculty.dashboard.mockRejectedValueOnce(new Error('x')).mockResolvedValue(dashboard());
    renderApp(api);
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Welcome, Prof. K. Rao' })).toBeInTheDocument();
  });
});

describe('RequestsPage', () => {
  it('approves a request with a note and declines another with a reason', async () => {
    const api = fakeApi();
    const first = appointment({ id: 'p1', student: { ...appointment().student, name: 'Priya Sharma' } });
    const second = appointment({
      id: 'p2',
      startsAt: '2030-01-07T05:25:00.000Z',
      endsAt: '2030-01-07T05:40:00.000Z',
      student: { id: 9, name: 'Arjun Mehta', registrationNumber: 'RA221100301999', batchName: 'Batch 2' },
    });
    api.api.appointments.pending
      .mockResolvedValueOnce([first, second])
      .mockResolvedValueOnce([second])
      .mockResolvedValue([]);
    api.api.appointments.approve.mockResolvedValue({ ...first, status: 'APPROVED' });
    api.api.appointments.reject.mockResolvedValue({ ...second, status: 'REJECTED' });
    renderApp(api, '/requests');

    await userEvent.click(await screen.findByRole('button', { name: 'Approve request from Priya Sharma' }));
    const dialog = screen.getByRole('dialog', { name: 'Approve this request?' });
    expect(
      within(dialog).getByText('Priya Sharma · Mon, 7 Jan 2030, 10:40 am – 10:55 am'),
    ).toBeInTheDocument();
    await userEvent.type(
      within(dialog).getByLabelText('Note for the student (optional)'),
      ' Bring the draft ',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    expect(api.api.appointments.approve).toHaveBeenCalledWith('p1', 'Bring the draft');
    expect(await screen.findByText('Approved. Priya Sharma has been notified.')).toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: 'Decline request from Arjun Mehta' }));
    const decline = screen.getByRole('dialog', { name: 'Decline this request?' });
    expect(within(decline).getByLabelText('Reason (optional, shown to the student)')).toHaveValue('');
    await userEvent.click(within(decline).getByRole('button', { name: 'Decline' }));
    expect(api.api.appointments.reject).toHaveBeenCalledWith('p2', undefined);
    expect(await screen.findByText('Declined. Arjun Mehta has been notified.')).toBeInTheDocument();
    expect(await screen.findByText('You are all caught up')).toBeInTheDocument();
  });

  it('refreshes when the request changed meanwhile, and keeps the dialog open on other errors', async () => {
    const api = fakeApi();
    api.api.appointments.pending.mockResolvedValueOnce([appointment()]).mockResolvedValue([]);
    api.api.appointments.approve
      .mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR', 'x'))
      .mockRejectedValueOnce(
        new ApiError(409, 'INVALID_STATUS_TRANSITION', 'This appointment is already cancelled.'),
      );
    renderApp(api, '/requests');

    await userEvent.click(await screen.findByRole('button', { name: 'Approve request from Priya Sharma' }));
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(
      await screen.findByText('Something went wrong on our side. Please try again in a moment.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('This appointment is already cancelled.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByText('You are all caught up')).toBeInTheDocument();
  });

  it('closes the dialog without deciding', async () => {
    const api = fakeApi();
    api.api.appointments.pending.mockResolvedValue([appointment()]);
    renderApp(api, '/requests');
    await userEvent.click(await screen.findByRole('button', { name: 'Decline request from Priya Sharma' }));
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.api.appointments.reject).not.toHaveBeenCalled();
  });

  it('shows a load failure with a retry', async () => {
    const api = fakeApi();
    api.api.appointments.pending.mockRejectedValueOnce(new Error('x')).mockResolvedValue([]);
    renderApp(api, '/requests');
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('You are all caught up')).toBeInTheDocument();
  });
});

describe('AppointmentsPage (history)', () => {
  it('opens on Approved, switches tabs and lets pending requests be decided from there', async () => {
    const api = fakeApi();
    api.api.appointments.mine.mockImplementation((status: string) =>
      Promise.resolve({
        appointments:
          status === 'APPROVED'
            ? [appointment({ status: 'APPROVED', decisionNote: 'Bring notes' })]
            : status === 'PENDING'
              ? [appointment()]
              : [],
        counts: COUNTS,
      }),
    );
    api.api.appointments.approve.mockResolvedValue(appointment({ status: 'APPROVED' }));
    renderApp(api, '/appointments');
    expect(await screen.findByText('Note from faculty:')).toBeInTheDocument();
    expect(api.api.appointments.mine).toHaveBeenCalledWith('APPROVED');
    expect(screen.queryByRole('button', { name: /Approve request/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /Pending/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Approve request from Priya Sharma' }));
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Approved. Priya Sharma has been notified.')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/appointments?status=PENDING');

    await userEvent.click(screen.getByRole('tab', { name: /Rejected/ }));
    expect(await screen.findByText('No declined requests.')).toBeInTheDocument();
  });

  it('falls back to Approved for an unknown status and retries after a failure', async () => {
    const api = fakeApi();
    api.api.appointments.mine
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValue({ appointments: [], counts: COUNTS });
    renderApp(api, '/appointments?status=BOGUS');
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No approved appointments coming up.')).toBeInTheDocument();
    expect(api.api.appointments.mine).toHaveBeenLastCalledWith('APPROVED');
  });
});

describe('AvailabilityPage: weekly office hours', () => {
  it('lists windows Monday first and saves an edited set', async () => {
    const api = fakeApi();
    api.api.faculty.myAvailability.mockResolvedValue(availability());
    api.api.faculty.replaceAvailability.mockResolvedValue({ ...availability(), added: 1, removed: 0 });
    renderApp(api, '/availability');

    expect(await screen.findByText('3 h 30 min a week · 15-minute slots')).toBeInTheDocument();
    const days = screen.getAllByLabelText('Day');
    expect(days.map((select) => (select as HTMLSelectElement).value)).toEqual(['1', '5']);
    const save = screen.getByRole('button', { name: 'Save office hours' });
    expect(save).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Add window' }));
    const rows = screen.getAllByLabelText('Day');
    await userEvent.selectOptions(rows[2]!, '3');
    fireEvent.change(screen.getAllByLabelText('From')[2]!, { target: { value: '14:00' } });
    fireEvent.change(screen.getAllByLabelText('To')[2]!, { target: { value: '16:00' } });
    expect(screen.getByText('5 h 30 min a week · 15-minute slots')).toBeInTheDocument();
    expect(save).toBeEnabled();
    await userEvent.click(save);

    expect(api.api.faculty.replaceAvailability).toHaveBeenCalledWith([
      { dayOfWeek: 1, startTime: '10:40', endTime: '12:25' },
      { dayOfWeek: 5, startTime: '13:20', endTime: '15:05' },
      { dayOfWeek: 3, startTime: '14:00', endTime: '16:00' },
    ]);
    expect(
      await screen.findByText('Office hours saved (1 added, 0 removed). Students see the new slots now.'),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(api.api.faculty.myAvailability).toHaveBeenCalledTimes(2);
    });
  });

  it('flags overlapping and invalid rows before saving, and can discard changes', async () => {
    const api = fakeApi();
    api.api.faculty.myAvailability.mockResolvedValue(availability());
    renderApp(api, '/availability');
    await userEvent.click(await screen.findByRole('button', { name: 'Add window' }));
    expect(screen.getByText('Overlaps 10:00–11:00 on the same day.')).toBeInTheDocument();
    expect(screen.getByText('Overlaps 10:40–12:25 on the same day.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save office hours' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getAllByLabelText('Day')).toHaveLength(2);

    await userEvent.click(screen.getByRole('button', { name: 'Remove window 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove window 1' }));
    expect(
      screen.getByText('No office hours: students cannot book you until you add a window.'),
    ).toBeInTheDocument();
  });

  it('shows server-side validation next to the row it concerns', async () => {
    const api = fakeApi();
    api.api.faculty.myAvailability.mockResolvedValue(availability());
    api.api.faculty.replaceAvailability
      .mockRejectedValueOnce(
        new ApiError(400, 'VALIDATION_ERROR', 'Invalid request.', {
          issues: [
            { field: 'windows.1.endTime', message: 'Too late for the building.' },
            { field: 'windows.9.endTime', message: 'No such row.' },
          ],
        }),
      )
      .mockRejectedValueOnce(new Error('offline'));
    renderApp(api, '/availability');
    await userEvent.click(await screen.findByRole('button', { name: 'Remove window 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add window' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save office hours' }));
    expect(await screen.findByText('Too late for the building.')).toBeInTheDocument();
    expect(screen.queryByText('No such row.')).not.toBeInTheDocument();

    fireEvent.change(screen.getAllByLabelText('To')[1]!, { target: { value: '11:30' } });
    expect(screen.queryByText('Too late for the building.')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save office hours' }));
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
  });

  it('shows a load failure with a retry', async () => {
    const api = fakeApi();
    api.api.faculty.myAvailability.mockRejectedValueOnce(new Error('x')).mockResolvedValue(availability());
    renderApp(api, '/availability');
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Board of Studies')).toBeInTheDocument();
  });
});

describe('AvailabilityPage: leave, meetings and blocked time', () => {
  it('records leave in campus time and reports the released appointments', async () => {
    const api = fakeApi();
    api.api.faculty.myAvailability.mockResolvedValue(availability({ exceptions: [] }));
    api.api.faculty.addException
      .mockResolvedValueOnce({ exception: availability().exceptions[0], releasedAppointments: 2 })
      .mockResolvedValueOnce({ exception: availability().exceptions[0], releasedAppointments: 1 })
      .mockResolvedValueOnce({ exception: availability().exceptions[0], releasedAppointments: 0 })
      .mockRejectedValueOnce(new ApiError(400, 'PERIOD_ALREADY_ENDED', 'That period has already ended.'));
    renderApp(api, '/availability');
    expect(await screen.findByText('Nothing planned. Add leave or a meeting below.')).toBeInTheDocument();

    const fill = (start: string, end: string) => {
      fireEvent.change(screen.getByLabelText('Starts'), { target: { value: start } });
      fireEvent.change(screen.getByLabelText('Ends'), { target: { value: end } });
    };
    fill('2030-01-08T09:00', '2030-01-08T17:00');
    await userEvent.type(
      screen.getByLabelText('Reason (optional, shown to affected students)'),
      'Medical leave',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add period' }));
    expect(api.api.faculty.addException).toHaveBeenCalledWith({
      kind: 'LEAVE',
      startsAt: '2030-01-08T09:00:00+05:30',
      endsAt: '2030-01-08T17:00:00+05:30',
      reason: 'Medical leave',
    });
    expect(
      await screen.findByText('Leave recorded. 2 appointments were released and the students notified.'),
    ).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Type'), 'MEETING');
    fill('2030-01-09T09:00', '2030-01-09T10:00');
    await userEvent.click(screen.getByRole('button', { name: 'Add period' }));
    expect(api.api.faculty.addException).toHaveBeenLastCalledWith({
      kind: 'MEETING',
      startsAt: '2030-01-09T09:00:00+05:30',
      endsAt: '2030-01-09T10:00:00+05:30',
    });
    expect(
      await screen.findByText('Meeting recorded. 1 appointment was released and the students notified.'),
    ).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Type'), 'BLOCKED');
    fill('2030-01-10T09:00', '2030-01-10T10:00');
    await userEvent.click(screen.getByRole('button', { name: 'Add period' }));
    expect(await screen.findByText('Blocked time recorded.')).toBeInTheDocument();

    fill('2020-01-10T09:00', '2020-01-10T10:00');
    await userEvent.click(screen.getByRole('button', { name: 'Add period' }));
    expect(await screen.findByText('That period has already ended.')).toBeInTheDocument();
  });

  it('validates the period before sending it', async () => {
    const api = fakeApi();
    api.api.faculty.myAvailability.mockResolvedValue(availability());
    renderApp(api, '/availability');
    await userEvent.click(await screen.findByRole('button', { name: 'Add period' }));
    expect(screen.getByText('Choose when it starts.')).toBeInTheDocument();
    expect(screen.getByText('Choose when it ends.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2030-01-08T17:00' } });
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2030-01-08T09:00' } });
    await userEvent.click(screen.getByRole('button', { name: 'Add period' }));
    expect(screen.getByText('The end must be after the start.')).toBeInTheDocument();
    expect(api.api.faculty.addException).not.toHaveBeenCalled();
  });

  it('removes a period after confirmation', async () => {
    const api = fakeApi();
    api.api.faculty.myAvailability
      .mockResolvedValueOnce(availability())
      .mockResolvedValue(availability({ exceptions: [] }));
    api.api.faculty.removeException.mockRejectedValueOnce(new Error('x')).mockResolvedValue(undefined);
    renderApp(api, '/availability');

    const remove = await screen.findByRole('button', {
      name: 'Remove meeting from Tue, 8 Jan 2030, 3:00 pm',
    });
    await userEvent.click(remove);
    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(remove);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(remove);
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));
    expect(api.api.faculty.removeException).toHaveBeenLastCalledWith(7);
    expect(await screen.findByText('Meeting removed. Those hours are bookable again.')).toBeInTheDocument();
    expect(await screen.findByText('Nothing planned. Add leave or a meeting below.')).toBeInTheDocument();
  });

  it('labels each kind of period', async () => {
    const api = fakeApi();
    const base = availability().exceptions[0]!;
    api.api.faculty.myAvailability.mockResolvedValue(
      availability({
        exceptions: [
          { ...base, id: 1, kind: 'LEAVE', reason: null },
          { ...base, id: 2, kind: 'BLOCKED' },
        ],
      }),
    );
    renderApp(api, '/availability');
    expect(await screen.findByText('Leave', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('Blocked time', { selector: 'span' })).toBeInTheDocument();
  });
});

describe('availability rules', () => {
  const row = (key: string, dayOfWeek: number, startTime: string, endTime: string) => ({
    key,
    dayOfWeek,
    startTime,
    endTime,
  });

  it('match the rules the API and database enforce', () => {
    expect(
      validateWindows([
        row('a', 1, '10:00', '11:00'),
        row('b', 1, '11:00', '12:00'), // touching is fine
        row('c', 2, '', '12:00'),
        row('d', 2, '10:02', '12:00'),
        row('e', 3, '12:00', '11:00'),
        row('f', 4, '10:00', '12:00'),
        row('g', 4, '11:00', '13:00'),
        row('h', 5, '10:00', '12:00'),
        row('i', 6, '10:00', '11:00'),
      ]),
    ).toEqual({
      c: 'Enter both times.',
      d: 'Use times on a 5-minute boundary (e.g. 14:05).',
      e: 'The end time must be after the start time.',
      f: 'Overlaps 11:00–13:00 on the same day.',
      g: 'Overlaps 10:00–12:00 on the same day.',
    });
  });

  it('sort Monday first, then by time, and read datetime-local values as IST', () => {
    expect(
      sortWindows([
        row('x', 3, '09:00', '10:00'),
        row('y', 1, '14:00', '15:00'),
        row('z', 1, '09:00', '10:00'),
      ]).map((window) => window.key),
    ).toEqual(['z', 'y', 'x']);
    expect(campusInstant('2030-01-08T09:30')).toBe('2030-01-08T09:30:00+05:30');
  });
});
