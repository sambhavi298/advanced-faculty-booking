import type { AuditEntry } from '@afb/types';
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  PageHeader,
  Select,
  describeError,
  useAsync,
  useAuth,
  useToast,
} from '@afb/ui';
import { useState } from 'react';
import { AuditSummary } from '../components/AuditSummary';

const PAGE_SIZE = 25;

const TABLES = [
  'appointments',
  'users',
  'students',
  'faculty',
  'faculty_availability',
  'faculty_schedule_exceptions',
  'batch_schedule',
  'batches',
  'departments',
];

const ACTIONS: AuditEntry['action'][] = ['INSERT', 'UPDATE', 'DELETE'];

/** For an UPDATE only the changed fields matter; for INSERT/DELETE the whole row. */
function details(entry: AuditEntry): string {
  if (entry.action === 'UPDATE' && entry.changedFields !== null) {
    const changes = Object.fromEntries(
      entry.changedFields.map((field) => [
        field,
        { from: entry.oldData?.[field], to: entry.newData?.[field] },
      ]),
    );
    return JSON.stringify(changes, null, 2);
  }
  return JSON.stringify(entry.newData ?? entry.oldData, null, 2);
}

/** The append-only audit trail written by triggers, newest first, with keyset "load older" paging. */
export function AuditPage() {
  const { api } = useAuth();
  const toast = useToast();
  const [table, setTable] = useState('');
  const [action, setAction] = useState<AuditEntry['action'] | ''>('');
  const key = JSON.stringify([table, action]);
  const first = useAsync(
    () =>
      api.admin.audit({
        ...(table === '' ? {} : { table }),
        ...(action === '' ? {} : { action }),
        limit: PAGE_SIZE,
      }),
    [table, action],
  );
  const [older, setOlder] = useState<{
    key: string;
    entries: AuditEntry[];
    nextBefore: number | null;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  if (first.status === 'loading') {
    return (
      <>
        <PageHeader
          title="Audit log"
          description="Every change to the business tables, recorded by triggers."
        />
        <LoadingState label="Loading the audit log" />
      </>
    );
  }
  if (first.status === 'error') {
    return <ErrorState error={first.error} onRetry={first.reload} />;
  }

  const extra = older?.key === key ? older : null;
  const entries = [...first.data.entries, ...(extra?.entries ?? [])];
  const nextBefore = extra === null ? first.data.nextBefore : extra.nextBefore;

  const loadOlder = async (before: number) => {
    setLoading(true);
    try {
      const page = await api.admin.audit({
        ...(table === '' ? {} : { table }),
        ...(action === '' ? {} : { action }),
        before,
        limit: PAGE_SIZE,
      });
      setOlder({ key, entries: [...(extra?.entries ?? []), ...page.entries], nextBefore: page.nextBefore });
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every change to the business tables, recorded by triggers in the same transaction. Entries cannot be edited or deleted."
      />
      <div className="mb-6 grid max-w-xl gap-3 sm:grid-cols-2">
        <Field label="Table" htmlFor="audit-table">
          <Select
            id="audit-table"
            value={table}
            onChange={(event) => {
              setTable(event.target.value);
            }}
          >
            <option value="">All tables</option>
            {TABLES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Action" htmlFor="audit-action">
          <Select
            id="audit-action"
            value={action}
            onChange={(event) => {
              setAction(event.target.value as AuditEntry['action'] | '');
            }}
          >
            <option value="">All actions</option>
            {ACTIONS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {entries.length === 0 ? (
        <EmptyState title="No audit entries match these filters" />
      ) : (
        <ul className="divide-y divide-slate-100 rounded-[var(--radius-card)] bg-white shadow-[var(--shadow-card)] ring-1 ring-slate-200">
          {entries.map((entry) => (
            <li key={entry.id} className="px-4 py-3">
              <details>
                <summary className="cursor-pointer list-none">
                  <AuditSummary entry={entry} />
                </summary>
                <p className="mt-2 text-xs text-slate-500">
                  Entry #{entry.id} · transaction {entry.transactionId}
                </p>
                <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
                  {details(entry)}
                </pre>
              </details>
            </li>
          ))}
        </ul>
      )}
      {nextBefore !== null && (
        <Button
          variant="secondary"
          className="mt-4"
          loading={loading}
          onClick={() => void loadOlder(nextBefore)}
        >
          Load older entries
        </Button>
      )}
    </>
  );
}
