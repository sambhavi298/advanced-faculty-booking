import {
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  formatDateTime,
  formatMinutes,
  useAsync,
  useAuth,
  useDebounced,
} from '@afb/ui';
import { useState } from 'react';
import { AccountStatus } from '../components/AccountStatus';
import { Cell, Table } from '../components/Table';

export function FacultyPage() {
  const { api } = useAuth();
  const [search, setSearch] = useState('');
  const term = useDebounced(search.trim(), 300);
  const faculty = useAsync(() => api.admin.faculty(term === '' ? {} : { search: term }), [term]);

  return (
    <>
      <PageHeader title="Faculty" description="Accounts, office hours and workload." />
      <Input
        type="search"
        aria-label="Search faculty"
        placeholder="Name, Employee ID or department"
        className="mb-6 max-w-md"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
        }}
      />
      {faculty.status === 'loading' && <LoadingState label="Loading faculty" />}
      {faculty.status === 'error' && <ErrorState error={faculty.error} onRetry={faculty.reload} />}
      {faculty.status === 'success' && faculty.data.length === 0 && (
        <EmptyState title="No faculty found" description="Try another name, Employee ID or department." />
      )}
      {faculty.status === 'success' && faculty.data.length > 0 && (
        <Table
          caption="Faculty"
          head={['Faculty', 'Department & office', 'Office hours', 'Appointments', 'Last sign-in', 'Account']}
        >
          {faculty.data.map((member) => (
            <tr key={member.id}>
              <Cell>
                <p className="font-medium text-slate-900">{member.name}</p>
                <p className="text-slate-500">
                  {member.employeeId} · {member.designation}
                </p>
              </Cell>
              <Cell>
                <p>{member.departmentName}</p>
                <p className="text-slate-500">{member.officeLocation}</p>
              </Cell>
              <Cell>
                {formatMinutes(member.weeklyAvailableMinutes)} a week · {member.slotMinutes}-min slots
              </Cell>
              <Cell>
                {member.appointments.total} total · {member.appointments.pending} pending ·{' '}
                {member.appointments.upcoming} upcoming
              </Cell>
              <Cell>{member.lastLoginAt === null ? 'Never' : formatDateTime(member.lastLoginAt)}</Cell>
              <Cell>
                <AccountStatus user={member} onChanged={faculty.reload} />
              </Cell>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
