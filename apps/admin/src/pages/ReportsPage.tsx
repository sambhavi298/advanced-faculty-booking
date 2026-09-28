import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  PageHeader,
  describeError,
  formatDateTime,
  useAsync,
  useAuth,
  useToast,
} from '@afb/ui';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Cell, Table } from '../components/Table';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-09-01' → "Sep 2026" */
function monthLabel(date: string): string {
  const [year = '', month = '1'] = date.split('-');
  return `${MONTHS[Number(month) - 1] ?? ''} ${year}`;
}

const orDash = (value: number | null, suffix = '') => (value === null ? '—' : `${String(value)}${suffix}`);

/** Monthly statistics from the faculty_monthly_report materialized view. */
export function ReportsPage() {
  const { api } = useAuth();
  const toast = useToast();
  const [month, setMonth] = useState('');
  const report = useAsync(() => api.admin.reports(month === '' ? undefined : month), [month]);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await api.admin.refreshReports();
      toast.success('Report refreshed from the latest appointments.');
      report.reload();
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Monthly reports"
        description="Served from a materialized view, so the page stays fast however long the history grows. Refresh recomputes it with REFRESH MATERIALIZED VIEW CONCURRENTLY — readers are never blocked."
        actions={
          <Button loading={refreshing} onClick={() => void refresh()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh now
          </Button>
        }
      />
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <Field label="Month" htmlFor="report-month">
          <Input
            id="report-month"
            type="month"
            value={month}
            onChange={(event) => {
              setMonth(event.target.value);
            }}
          />
        </Field>
        {report.status === 'success' && (
          <p className="pb-2 text-sm text-slate-600">
            {report.data.refreshedAt === null
              ? 'No data for this selection yet — refresh to include the latest appointments.'
              : `Last refreshed ${formatDateTime(report.data.refreshedAt)}`}
          </p>
        )}
      </div>
      {report.status === 'loading' && <LoadingState label="Loading the report" />}
      {report.status === 'error' && <ErrorState error={report.error} onRetry={report.reload} />}
      {report.status === 'success' && report.data.rows.length === 0 && (
        <EmptyState title="Nothing to report" description="No appointments in the selected period." />
      )}
      {report.status === 'success' && report.data.rows.length > 0 && (
        <Table
          caption="Monthly appointment statistics per faculty member"
          head={[
            'Month',
            'Faculty',
            'Requests',
            'Approved',
            'Completed',
            'Rejected',
            'Cancelled',
            'Pending',
            'Approval',
            'Avg response',
            'Rank in dept',
            'vs last month',
            'Cumulative',
          ]}
        >
          {report.data.rows.map((row) => (
            <tr key={`${row.month}-${String(row.facultyId)}`}>
              <Cell className="whitespace-nowrap">{monthLabel(row.month)}</Cell>
              <Cell className="whitespace-nowrap">
                {row.facultyName} <span className="text-slate-500">· {row.departmentCode}</span>
              </Cell>
              <Cell>{row.totalRequests}</Cell>
              <Cell>{row.approved}</Cell>
              <Cell>{row.completed}</Cell>
              <Cell>{row.rejected}</Cell>
              <Cell>{row.cancelled}</Cell>
              <Cell>{row.pending}</Cell>
              <Cell>{orDash(row.approvalRatePct, '%')}</Cell>
              <Cell>{orDash(row.avgResponseMinutes, ' min')}</Cell>
              <Cell>#{row.demandRankInDepartment}</Cell>
              <Cell>
                {row.changeFromPreviousMonth === null
                  ? '—'
                  : `${row.changeFromPreviousMonth > 0 ? '+' : ''}${String(row.changeFromPreviousMonth)}`}
              </Cell>
              <Cell>{row.cumulativeRequests}</Cell>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
