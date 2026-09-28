import {
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  formatDateTime,
  useAsync,
  useAuth,
  useDebounced,
} from '@afb/ui';
import { useState } from 'react';
import { AccountStatus } from '../components/AccountStatus';
import { Cell, Table } from '../components/Table';

export function StudentsPage() {
  const { api } = useAuth();
  const [search, setSearch] = useState('');
  const term = useDebounced(search.trim(), 300);
  const students = useAsync(() => api.admin.students(term === '' ? {} : { search: term }), [term]);

  return (
    <>
      <PageHeader title="Students" description="Accounts, batches and appointment activity." />
      <Input
        type="search"
        aria-label="Search students"
        placeholder="Name or Registration Number"
        className="mb-6 max-w-md"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
        }}
      />
      {students.status === 'loading' && <LoadingState label="Loading students" />}
      {students.status === 'error' && <ErrorState error={students.error} onRetry={students.reload} />}
      {students.status === 'success' && students.data.length === 0 && (
        <EmptyState title="No students found" description="Try another name or Registration Number." />
      )}
      {students.status === 'success' && students.data.length > 0 && (
        <Table caption="Students" head={['Student', 'Batch', 'Appointments', 'Last sign-in', 'Account']}>
          {students.data.map((student) => (
            <tr key={student.id}>
              <Cell>
                <p className="font-medium text-slate-900">{student.name}</p>
                <p className="text-slate-500">{student.registrationNumber}</p>
              </Cell>
              <Cell>
                {student.batchName} · Year {student.yearOfStudy} · {student.departmentCode}
              </Cell>
              <Cell>
                {student.appointments.total} total · {student.appointments.pending} pending ·{' '}
                {student.appointments.upcoming} upcoming
              </Cell>
              <Cell>{student.lastLoginAt === null ? 'Never' : formatDateTime(student.lastLoginAt)}</Cell>
              <Cell>
                <AccountStatus user={student} onChanged={students.reload} />
              </Cell>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
