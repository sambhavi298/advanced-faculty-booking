import type { Appointment } from '@afb/types';
import {
  AppointmentCard,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  useAsync,
  useAuth,
} from '@afb/ui';
import { useState } from 'react';
import { DecisionButtons, DecisionDialog, type Decision } from '../components/DecisionDialog';

/** Requests waiting for a decision, soonest slot first, each with Approve / Decline. */
export function RequestsPage() {
  const { api } = useAuth();
  const pending = useAsync(() => api.appointments.pending(), []);
  const [target, setTarget] = useState<{ appointment: Appointment; decision: Decision } | null>(null);

  return (
    <>
      <PageHeader
        title="Appointment requests"
        description="Soonest first. A request you do not answer before its time is declined automatically."
      />
      {pending.status === 'loading' && <LoadingState label="Loading requests" />}
      {pending.status === 'error' && <ErrorState error={pending.error} onRetry={pending.reload} />}
      {pending.status === 'success' && pending.data.length === 0 && (
        <EmptyState
          title="You are all caught up"
          description="New requests from students will appear here."
        />
      )}
      {pending.status === 'success' && pending.data.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {pending.data.map((appointment) => (
            <AppointmentCard
              key={appointment.id}
              appointment={appointment}
              perspective="faculty"
              actions={<DecisionButtons appointment={appointment} onDecide={setTarget} />}
            />
          ))}
        </div>
      )}
      <DecisionDialog
        target={target}
        onClose={() => {
          setTarget(null);
        }}
        onDone={pending.reload}
      />
    </>
  );
}
