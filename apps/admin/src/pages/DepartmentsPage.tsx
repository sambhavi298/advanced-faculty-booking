import { EmptyState, ErrorState, LoadingState, PageHeader, useAsync, useAuth } from '@afb/ui';
import { Cell, Table } from '../components/Table';

export function DepartmentsPage() {
  const { api } = useAuth();
  const departments = useAsync(() => api.admin.departments(), []);

  return (
    <>
      <PageHeader
        title="Departments"
        description="Faculty, batches, students and appointments per department."
      />
      {departments.status === 'loading' && <LoadingState label="Loading departments" />}
      {departments.status === 'error' && (
        <ErrorState error={departments.error} onRetry={departments.reload} />
      )}
      {departments.status === 'success' && departments.data.length === 0 && (
        <EmptyState title="No departments yet" />
      )}
      {departments.status === 'success' && departments.data.length > 0 && (
        <Table caption="Departments" head={['Department', 'Faculty', 'Batches', 'Students', 'Appointments']}>
          {departments.data.map((department) => (
            <tr key={department.id}>
              <Cell>
                <p className="font-medium text-slate-900">{department.name}</p>
                <p className="text-slate-500">{department.code}</p>
              </Cell>
              <Cell>{department.faculty}</Cell>
              <Cell>{department.batches}</Cell>
              <Cell>{department.students}</Cell>
              <Cell>{department.appointments}</Cell>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
