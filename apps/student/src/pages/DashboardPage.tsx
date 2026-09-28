import {
  AppointmentCard,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatCard,
  StatusBadge,
  formatDate,
  formatTimeRange,
  useAsync,
  useAuth,
} from '@afb/ui';
import { CalendarDays, CheckCircle2, Clock, Search, XCircle } from 'lucide-react';
import { Link } from 'react-router';

const linkButton =
  'inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700';

export function DashboardPage() {
  const { api } = useAuth();
  const dashboard = useAsync(() => api.student.dashboard(), []);

  if (dashboard.status === 'loading') {
    return <LoadingState label="Loading your dashboard" rows={4} />;
  }
  if (dashboard.status === 'error') {
    return <ErrorState error={dashboard.error} onRetry={dashboard.reload} />;
  }
  const { student, counts, upcoming, recent } = dashboard.data;
  const firstName = student.name.split(' ')[0] as string;

  return (
    <>
      <PageHeader
        title={`Welcome back, ${firstName}`}
        description={`${student.registrationNumber} · ${student.batchName} · ${student.departmentName}`}
        actions={
          <Link to="/faculty" className={linkButton}>
            <Search className="h-4 w-4" aria-hidden="true" /> Book an appointment
          </Link>
        }
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Pending" value={counts.PENDING} tone="amber" icon={<Clock className="h-5 w-5" />} />
        <StatCard
          label="Approved"
          value={counts.APPROVED}
          tone="green"
          icon={<CheckCircle2 className="h-5 w-5" />}
        />
        <StatCard
          label="Rejected"
          value={counts.REJECTED}
          tone="red"
          icon={<XCircle className="h-5 w-5" />}
        />
        <StatCard
          label="Total appointments"
          value={counts.total}
          tone="blue"
          icon={<CalendarDays className="h-5 w-5" />}
        />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-5">
        <section className="lg:col-span-2" aria-labelledby="upcoming-heading">
          <h2 id="upcoming-heading" className="mb-3 text-sm font-semibold text-slate-900">
            Upcoming appointment
          </h2>
          {upcoming === null ? (
            <EmptyState
              title="No upcoming appointment"
              description="Once a faculty member approves a request, it appears here with where to meet."
              action={
                <Link to="/faculty" className={linkButton}>
                  Find a faculty member
                </Link>
              }
            />
          ) : (
            <AppointmentCard appointment={upcoming} perspective="student" />
          )}
        </section>

        <section className="lg:col-span-3" aria-labelledby="recent-heading">
          <h2 id="recent-heading" className="mb-3 text-sm font-semibold text-slate-900">
            Recent activity
          </h2>
          {recent.length === 0 ? (
            <EmptyState
              title="No appointments yet"
              description="Your requests and their outcomes will be listed here."
            />
          ) : (
            <Card>
              <ul className="-my-3 divide-y divide-slate-100">
                {recent.map((appointment) => (
                  <li key={appointment.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{appointment.faculty.name}</p>
                      <p className="text-sm text-slate-500">
                        {formatDate(appointment.startsAt)} ·{' '}
                        {formatTimeRange(appointment.startsAt, appointment.endsAt)}
                      </p>
                    </div>
                    <StatusBadge status={appointment.status} />
                  </li>
                ))}
              </ul>
              <Link
                to="/appointments"
                className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline"
              >
                View all appointments →
              </Link>
            </Card>
          )}
        </section>
      </div>
    </>
  );
}
