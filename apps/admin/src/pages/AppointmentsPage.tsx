import type { AppointmentStatus } from '@afb/types';
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  PageHeader,
  STATUS_LABELS,
  Select,
  StatusBadge,
  formatDate,
  formatTimeRange,
  useAsync,
  useAuth,
  useDebounced,
} from '@afb/ui';
import { useState } from 'react';
import { Cell, Table } from '../components/Table';

const PAGE_SIZE = 20;
const STATUSES: AppointmentStatus[] = ['PENDING', 'APPROVED', 'COMPLETED', 'REJECTED', 'CANCELLED'];

/** Every appointment in the system, filtered and paged on the server. */
export function AppointmentsPage() {
  const { api } = useAuth();
  const [status, setStatus] = useState<AppointmentStatus | ''>('');
  const [facultyId, setFacultyId] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const term = useDebounced(search.trim(), 300);

  const faculty = useAsync(() => api.admin.faculty(), []);
  const page = useAsync(
    () =>
      api.admin.appointments({
        ...(status === '' ? {} : { status }),
        ...(facultyId === '' ? {} : { facultyId: Number(facultyId) }),
        ...(term === '' ? {} : { search: term }),
        ...(from === '' ? {} : { from }),
        ...(to === '' ? {} : { to }),
        limit: PAGE_SIZE,
        offset,
      }),
    [status, facultyId, term, from, to, offset],
  );

  /** Any filter change starts again from the first page. */
  const filter =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setOffset(0);
    };

  return (
    <>
      <PageHeader
        title="Appointments"
        description="Monitor every request in the system, latest slot first."
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Status" htmlFor="filter-status">
          <Select
            id="filter-status"
            value={status}
            onChange={(event) => {
              filter(setStatus)(event.target.value as AppointmentStatus | '');
            }}
          >
            <option value="">All statuses</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {STATUS_LABELS[value]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Faculty" htmlFor="filter-faculty">
          <Select
            id="filter-faculty"
            value={facultyId}
            onChange={(event) => {
              filter(setFacultyId)(event.target.value);
            }}
          >
            <option value="">All faculty</option>
            {faculty.status === 'success' &&
              faculty.data.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Student or faculty" htmlFor="filter-search">
          <Input
            id="filter-search"
            type="search"
            placeholder="Name, RA… or FAC…"
            value={search}
            onChange={(event) => {
              filter(setSearch)(event.target.value);
            }}
          />
        </Field>
        <Field label="From" htmlFor="filter-from">
          <Input
            id="filter-from"
            type="date"
            value={from}
            onChange={(event) => {
              filter(setFrom)(event.target.value);
            }}
          />
        </Field>
        <Field label="To" htmlFor="filter-to">
          <Input
            id="filter-to"
            type="date"
            value={to}
            onChange={(event) => {
              filter(setTo)(event.target.value);
            }}
          />
        </Field>
      </div>

      {page.status === 'loading' && <LoadingState label="Loading appointments" />}
      {page.status === 'error' && <ErrorState error={page.error} onRetry={page.reload} />}
      {page.status === 'success' && page.data.appointments.length === 0 && (
        <EmptyState title="No appointments match these filters" />
      )}
      {page.status === 'success' && page.data.appointments.length > 0 && (
        <>
          <Table caption="Appointments" head={['When', 'Student', 'Faculty', 'Purpose', 'Status']}>
            {page.data.appointments.map((appointment) => (
              <tr key={appointment.id}>
                <Cell className="whitespace-nowrap">
                  <p className="font-medium text-slate-900">{formatDate(appointment.startsAt)}</p>
                  <p className="text-slate-500">
                    {formatTimeRange(appointment.startsAt, appointment.endsAt)}
                  </p>
                </Cell>
                <Cell>
                  <p>{appointment.student.name}</p>
                  <p className="text-slate-500">
                    {appointment.student.registrationNumber} · {appointment.student.batchName}
                  </p>
                </Cell>
                <Cell>
                  <p>{appointment.faculty.name}</p>
                  <p className="text-slate-500">{appointment.faculty.employeeId}</p>
                </Cell>
                <Cell className="max-w-xs">
                  <p className="line-clamp-2">{appointment.purpose}</p>
                  {appointment.decisionNote !== null && (
                    <p className="text-slate-500">Note: {appointment.decisionNote}</p>
                  )}
                </Cell>
                <Cell>
                  <StatusBadge status={appointment.status} />
                </Cell>
              </tr>
            ))}
          </Table>
          <div className="mt-4 flex items-center justify-between gap-3 text-sm text-slate-600">
            <p>
              Showing {page.data.offset + 1}–{page.data.offset + page.data.appointments.length} of{' '}
              {page.data.total}
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={offset === 0}
                onClick={() => {
                  setOffset(Math.max(0, offset - PAGE_SIZE));
                }}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={offset + PAGE_SIZE >= page.data.total}
                onClick={() => {
                  setOffset(offset + PAGE_SIZE);
                }}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
