import type { AppointmentStatus } from '@afb/types';
import {
  Card,
  ErrorState,
  LoadingState,
  PageHeader,
  STATUS_LABELS,
  StatCard,
  StatusBadge,
  formatCalendarDate,
  useAsync,
  useAuth,
} from '@afb/ui';
import { Building2, CalendarDays, GraduationCap, Users } from 'lucide-react';
import { Link } from 'react-router';
import { AuditSummary } from '../components/AuditSummary';

const STATUSES: AppointmentStatus[] = ['PENDING', 'APPROVED', 'COMPLETED', 'REJECTED', 'CANCELLED'];

export function DashboardPage() {
  const { api } = useAuth();
  const dashboard = useAsync(() => api.admin.dashboard(), []);

  if (dashboard.status === 'loading') {
    return <LoadingState label="Loading the dashboard" rows={4} />;
  }
  if (dashboard.status === 'error') {
    return <ErrorState error={dashboard.error} onRetry={dashboard.reload} />;
  }
  const { totals, appointmentsByStatus, today, daily, topFaculty, recentAudit } = dashboard.data;
  const busiest = Math.max(1, ...daily.map((day) => day.requests));

  return (
    <>
      <PageHeader
        title="System overview"
        description={`Computed live from PostgreSQL on every load · ${String(totals.activeUsers)} active accounts`}
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Students"
          value={totals.students}
          tone="blue"
          icon={<GraduationCap className="h-5 w-5" />}
        />
        <StatCard label="Faculty" value={totals.faculty} tone="green" icon={<Users className="h-5 w-5" />} />
        <StatCard
          label="Departments"
          value={`${String(totals.departments)} · ${String(totals.batches)} batches`}
          tone="violet"
          icon={<Building2 className="h-5 w-5" />}
        />
        <StatCard
          label="Appointments"
          value={totals.appointments}
          tone="amber"
          icon={<CalendarDays className="h-5 w-5" />}
        />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <Card title="Appointments by status">
          <ul className="space-y-2">
            {STATUSES.map((status) => (
              <li key={status} className="flex items-center justify-between">
                <StatusBadge status={status} />
                <span className="font-semibold tabular-nums text-slate-900">
                  {appointmentsByStatus[status]}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 border-t border-slate-100 pt-3 text-sm text-slate-600">
            Today: {today.meetings} meeting{today.meetings === 1 ? '' : 's'}, {today.requests} new request
            {today.requests === 1 ? '' : 's'}.
          </p>
        </Card>

        <Card title="New requests, last 14 days" className="lg:col-span-2">
          <div
            className="flex h-40 items-end gap-1.5"
            role="img"
            aria-label="New requests per day, last 14 days"
          >
            {daily.map((day) => (
              <div key={day.date} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <span className="text-[11px] tabular-nums text-slate-500">
                  {day.requests > 0 ? day.requests : ''}
                </span>
                <div
                  className="w-full rounded-t bg-brand-500"
                  style={{ height: `${String((day.requests / busiest) * 100)}%` }}
                  title={`${day.date}: ${String(day.requests)}`}
                />
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-slate-500">
            <span>{daily[0] === undefined ? '' : formatCalendarDate(daily[0].date)}</span>
            <span>Today</span>
          </div>
          <table className="sr-only">
            <caption>New requests per day</caption>
            <tbody>
              {daily.map((day) => (
                <tr key={day.date}>
                  <td>{day.date}</td>
                  <td>{day.requests}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Faculty by demand">
          <table className="w-full text-sm">
            <caption className="sr-only">Faculty ranked by number of requests</caption>
            <thead>
              <tr className="text-left text-xs text-slate-500 uppercase">
                <th className="pb-2 font-medium">Rank</th>
                <th className="pb-2 font-medium">Faculty</th>
                <th className="pb-2 text-right font-medium">Requests</th>
                <th className="pb-2 text-right font-medium">Pending</th>
                <th className="pb-2 text-right font-medium">Approval</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {topFaculty.map((row) => (
                <tr key={row.facultyId}>
                  <td className="py-2 font-semibold text-slate-900">#{row.rank}</td>
                  <td className="py-2">
                    {row.name} <span className="text-slate-500">· {row.departmentCode}</span>
                  </td>
                  <td className="py-2 text-right tabular-nums">{row.requests}</td>
                  <td className="py-2 text-right tabular-nums">{row.pending}</td>
                  <td className="py-2 text-right tabular-nums">
                    {row.approvalRatePct === null ? '—' : `${String(row.approvalRatePct)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card
          title="Latest changes"
          actions={
            <Link to="/audit" className="text-sm font-medium text-brand-700 hover:underline">
              Full audit log →
            </Link>
          }
        >
          <ul className="-my-2 divide-y divide-slate-100">
            {recentAudit.map((entry) => (
              <li key={entry.id} className="py-2">
                <AuditSummary entry={entry} />
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <p className="mt-6 text-xs text-slate-500">
        {STATUSES.map((status) => `${STATUS_LABELS[status]}: ${String(appointmentsByStatus[status])}`).join(
          ' · ',
        )}
      </p>
    </>
  );
}
