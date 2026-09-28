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
import { Building2, Clock, MapPin, Search } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

export function FindFacultyPage() {
  const { api } = useAuth();
  const [search, setSearch] = useState('');
  const term = useDebounced(search.trim(), 300);
  const faculty = useAsync(() => api.faculty.list(term === '' ? {} : { search: term }), [term]);

  return (
    <>
      <PageHeader
        title="Find faculty"
        description="Search by name, Employee ID, department or designation. Slots shown already avoid your own classes."
      />
      <div className="relative mb-6 max-w-lg">
        <Search
          className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400"
          aria-hidden="true"
        />
        <Input
          type="search"
          aria-label="Search faculty"
          placeholder="e.g. Rao, FAC200, CSE"
          className="pl-9"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
      </div>

      {faculty.status === 'loading' && <LoadingState label="Searching faculty" />}
      {faculty.status === 'error' && <ErrorState error={faculty.error} onRetry={faculty.reload} />}
      {faculty.status === 'success' && faculty.data.length === 0 && (
        <EmptyState
          title={term === '' ? 'No faculty available' : `No faculty match “${term}”`}
          description="Try a different name or department."
        />
      )}
      {faculty.status === 'success' && faculty.data.length > 0 && (
        <ul className="grid gap-4 md:grid-cols-2">
          {faculty.data.map((member) => (
            <li
              key={member.id}
              className="flex flex-col rounded-[var(--radius-card)] bg-white p-5 shadow-[var(--shadow-card)] ring-1 ring-slate-200"
            >
              <h2 className="text-base font-semibold text-slate-900">{member.name}</h2>
              <p className="text-sm text-slate-500">
                {member.designation} · {member.employeeId}
              </p>
              <dl className="mt-3 space-y-1.5 text-sm text-slate-700">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-slate-400" aria-hidden="true" />
                  <dt className="sr-only">Department</dt>
                  <dd>{member.department.name}</dd>
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-slate-400" aria-hidden="true" />
                  <dt className="sr-only">Office</dt>
                  <dd>{member.officeLocation}</dd>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-slate-400" aria-hidden="true" />
                  <dt className="sr-only">Availability</dt>
                  <dd>
                    {formatMinutes(member.weeklyAvailableMinutes)} a week · {member.slotMinutes}-minute slots
                  </dd>
                </div>
              </dl>
              <div className="mt-4 flex flex-1 items-end justify-between gap-3">
                <p
                  className={
                    member.nextAvailableSlot === null
                      ? 'text-sm text-slate-500'
                      : 'text-sm font-medium text-emerald-700'
                  }
                >
                  {member.nextAvailableSlot === null
                    ? 'No free slots in the next 2 weeks'
                    : `Next free: ${formatDateTime(member.nextAvailableSlot.startsAt)}`}
                </p>
                <Link
                  to={`/faculty/${String(member.id)}`}
                  className="shrink-0 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
                  aria-label={`View slots for ${member.name}`}
                >
                  View slots
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
