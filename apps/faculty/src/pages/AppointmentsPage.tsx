import type { Appointment, AppointmentStatus } from '@afb/types';
import {
  AppointmentCard,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  STATUS_LABELS,
  Tabs,
  useAsync,
  useAuth,
} from '@afb/ui';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { DecisionButtons, DecisionDialog, type Decision } from '../components/DecisionDialog';

const TABS: AppointmentStatus[] = ['APPROVED', 'PENDING', 'COMPLETED', 'CANCELLED', 'REJECTED'];

const EMPTY_TEXT: Record<AppointmentStatus, string> = {
  PENDING: 'No requests waiting for a decision.',
  APPROVED: 'No approved appointments coming up.',
  COMPLETED: 'No completed appointments yet.',
  CANCELLED: 'No cancelled appointments.',
  REJECTED: 'No declined requests.',
};

function isStatus(value: string | null): value is AppointmentStatus {
  return TABS.includes(value as AppointmentStatus);
}

/** Every appointment with this faculty member, by status. */
export function AppointmentsPage() {
  const { api } = useAuth();
  const [params, setParams] = useSearchParams();
  const requested = params.get('status');
  const tab: AppointmentStatus = isStatus(requested) ? requested : 'APPROVED';
  const list = useAsync(() => api.appointments.mine(tab), [tab]);
  const [target, setTarget] = useState<{ appointment: Appointment; decision: Decision } | null>(null);

  return (
    <>
      <PageHeader title="Appointment history" description="Every request students have made to you." />
      <Tabs
        label="Appointment status"
        value={tab}
        onChange={(status) => {
          setParams({ status });
        }}
        items={TABS.map((status) => ({
          id: status,
          label: STATUS_LABELS[status],
          ...(list.status === 'success' ? { count: list.data.counts[status] } : {}),
        }))}
      />
      <div role="tabpanel" aria-labelledby={`tab-${tab}`} className="mt-6">
        {list.status === 'loading' && <LoadingState label="Loading appointments" />}
        {list.status === 'error' && <ErrorState error={list.error} onRetry={list.reload} />}
        {list.status === 'success' && list.data.appointments.length === 0 && (
          <EmptyState title={EMPTY_TEXT[tab]} />
        )}
        {list.status === 'success' && list.data.appointments.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2">
            {list.data.appointments.map((appointment) => (
              <AppointmentCard
                key={appointment.id}
                appointment={appointment}
                perspective="faculty"
                actions={
                  appointment.status === 'PENDING' ? (
                    <DecisionButtons appointment={appointment} onDecide={setTarget} />
                  ) : undefined
                }
              />
            ))}
          </div>
        )}
      </div>
      <DecisionDialog
        target={target}
        onClose={() => {
          setTarget(null);
        }}
        onDone={list.reload}
      />
    </>
  );
}
