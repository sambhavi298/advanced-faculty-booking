import type { Appointment, WeeklyActivity } from '@afb/types';
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatCard,
  StatusBadge,
  formatCalendarDate,
  formatDate,
  formatMinutes,
  formatTimeRange,
  useAsync,
  useAuth,
} from '@afb/ui';
import { CalendarCheck, Clock, Inbox, TrendingUp } from 'lucide-react';
import { Link } from 'react-router';

const linkClass = 'text-sm font-medium text-brand-700 hover:underline';

/** One line per appointment: time, student, purpose and status. */
function AppointmentRows({ appointments, showDate }: { appointments: Appointment[]; showDate: boolean }) {
  return (
    <ul className="-my-3 divide-y divide-slate-100">
      {appointments.map((appointment) => (
        <li key={appointment.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900">
              {showDate && `${formatDate(appointment.startsAt)} · `}
              {formatTimeRange(appointment.startsAt, appointment.endsAt)}
            </p>
            <p className="text-sm text-slate-600">
              {appointment.student.name} · {appointment.student.registrationNumber}
            </p>
            <p className="truncate text-sm text-slate-500">{appointment.purpose}</p>
          </div>
          <StatusBadge status={appointment.status} />
        </li>
      ))}
    </ul>
  );
}

/** Requests per week as bars; the darker part is what was approved. */
function WeeklyChart({ weeks }: { weeks: WeeklyActivity[] }) {
  const max = Math.max(1, ...weeks.map((week) => week.requests));
  return (
    <div>
      <div className="flex h-36 items-end gap-2" role="img" aria-label="Requests per week, last 8 weeks">
        {weeks.map((week) => (
          <div
            key={week.weekStart}
            className="flex h-full flex-1 flex-col justify-end"
            title={week.weekStart}
          >
            <div
              className="flex flex-col justify-end overflow-hidden rounded-t bg-brand-100"
              style={{ height: `${String((week.requests / max) * 100)}%` }}
            >
              <div
                className="bg-brand-600"
                style={{
                  height: `${String(week.requests === 0 ? 0 : (week.accepted / week.requests) * 100)}%`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2 text-[11px] text-slate-500">
        {weeks.map((week) => (
          <span key={week.weekStart} className="flex-1 truncate text-center">
            {formatCalendarDate(week.weekStart).split(', ')[1]}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>Requests per week</caption>
        <thead>
          <tr>
            <th>Week starting</th>
            <th>Requests</th>
            <th>Approved</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week.weekStart}>
              <td>{week.weekStart}</td>
              <td>{week.requests}</td>
              <td>{week.accepted}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 flex gap-4 text-xs text-slate-600">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-brand-100" /> Requested
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-brand-600" /> Approved
        </span>
      </p>
    </div>
  );
}

export function DashboardPage() {
  const { api } = useAuth();
  const dashboard = useAsync(() => api.faculty.dashboard(), []);

  if (dashboard.status === 'loading') {
    return <LoadingState label="Loading your dashboard" rows={4} />;
  }
  if (dashboard.status === 'error') {
    return <ErrorState error={dashboard.error} onRetry={dashboard.reload} />;
  }
  const { faculty, counts, today, pending, upcoming, stats, recent } = dashboard.data;

  return (
    <>
      <PageHeader
        title={`Welcome, ${faculty.name}`}
        description={`${faculty.designation} · ${faculty.departmentName} · ${faculty.officeLocation}`}
        actions={
          <Link
            to="/availability"
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Manage availability
          </Link>
        }
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Waiting for you"
          value={counts.PENDING}
          tone="amber"
          icon={<Inbox className="h-5 w-5" />}
        />
        <StatCard
          label="Meetings today"
          value={today.length}
          tone="blue"
          icon={<Clock className="h-5 w-5" />}
        />
        <StatCard
          label="Approved, upcoming"
          value={counts.APPROVED}
          tone="green"
          icon={<CalendarCheck className="h-5 w-5" />}
        />
        <StatCard
          label="Approval rate"
          value={stats.approvalRatePct === null ? '—' : `${String(stats.approvalRatePct)}%`}
          tone="violet"
          icon={<TrendingUp className="h-5 w-5" />}
        />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card title="Today's schedule">
          {today.length === 0 ? (
            <p className="text-sm text-slate-500">No meetings today.</p>
          ) : (
            <AppointmentRows appointments={today} showDate={false} />
          )}
        </Card>

        <Card
          title={`Pending requests (${String(counts.PENDING)})`}
          actions={
            counts.PENDING > 0 ? (
              <Link to="/requests" className={linkClass}>
                Review all →
              </Link>
            ) : undefined
          }
        >
          {pending.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing is waiting for a decision.</p>
          ) : (
            <AppointmentRows appointments={pending} showDate />
          )}
        </Card>

        <Card title="Coming up">
          {upcoming.length === 0 ? (
            <p className="text-sm text-slate-500">No approved appointments after today.</p>
          ) : (
            <AppointmentRows appointments={upcoming} showDate />
          )}
        </Card>

        <Card title="Requests per week">
          <WeeklyChart weeks={stats.weekly} />
          <p className="mt-4 text-sm text-slate-600">
            {stats.responded === 0 || stats.medianResponseMinutes === null
              ? 'Response statistics appear after your first decision.'
              : `You answered ${String(stats.responded)} request${stats.responded === 1 ? '' : 's'} before their time; typical response ${formatMinutes(Math.round(stats.medianResponseMinutes))}.`}
          </p>
        </Card>
      </div>

      <section className="mt-8" aria-labelledby="recent-heading">
        <h2 id="recent-heading" className="mb-3 text-sm font-semibold text-slate-900">
          Recent activity
        </h2>
        {recent.length === 0 ? (
          <EmptyState
            title="No appointments yet"
            description="Student requests and your decisions will be listed here."
          />
        ) : (
          <Card>
            <AppointmentRows appointments={recent} showDate />
            <Link to="/appointments" className={`mt-4 inline-block ${linkClass}`}>
              View full history →
            </Link>
          </Card>
        )}
      </section>
    </>
  );
}
