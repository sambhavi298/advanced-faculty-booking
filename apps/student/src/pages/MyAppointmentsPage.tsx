import type { Appointment, AppointmentStatus } from '@afb/types';
import {
  AppointmentCard,
  Button,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Modal,
  PageHeader,
  STATUS_LABELS,
  Tabs,
  Textarea,
  describeError,
  useAsync,
  useAuth,
  useToast,
} from '@afb/ui';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';

const TABS: AppointmentStatus[] = ['PENDING', 'APPROVED', 'COMPLETED', 'CANCELLED', 'REJECTED'];

const EMPTY_TEXT: Record<AppointmentStatus, string> = {
  PENDING: 'No requests waiting for a decision.',
  APPROVED: 'No approved appointments.',
  COMPLETED: 'No completed appointments yet.',
  CANCELLED: 'No cancelled appointments.',
  REJECTED: 'No declined requests.',
};

function isStatus(value: string | null): value is AppointmentStatus {
  return TABS.includes(value as AppointmentStatus);
}

/** Pending requests, and approved ones that have not started, can still be cancelled by the student. */
export function canCancel(appointment: Appointment, now = Date.now()): boolean {
  return (
    appointment.status === 'PENDING' ||
    (appointment.status === 'APPROVED' && Date.parse(appointment.startsAt) > now)
  );
}

export function MyAppointmentsPage() {
  const { api } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const requested = params.get('status');
  const tab: AppointmentStatus = isStatus(requested) ? requested : 'PENDING';
  const list = useAsync(() => api.appointments.mine(tab), [tab]);

  const [cancelling, setCancelling] = useState<Appointment | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const closeDialog = () => {
    setCancelling(null);
    setReason('');
  };

  const confirmCancel = async () => {
    const target = cancelling as Appointment;
    setBusy(true);
    try {
      await api.appointments.cancel(target.id, reason.trim() === '' ? undefined : reason.trim());
      toast.success(`Appointment with ${target.faculty.name} cancelled.`);
      closeDialog();
      list.reload();
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="My appointments"
        description="Track your requests and where to meet once they are approved."
      />
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
          <EmptyState
            title={EMPTY_TEXT[tab]}
            action={
              <Link to="/faculty" className="text-sm font-medium text-brand-700 hover:underline">
                Book an appointment
              </Link>
            }
          />
        )}
        {list.status === 'success' && list.data.appointments.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2">
            {list.data.appointments.map((appointment) => (
              <AppointmentCard
                key={appointment.id}
                appointment={appointment}
                perspective="student"
                actions={
                  canCancel(appointment) ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setCancelling(appointment);
                      }}
                    >
                      Cancel
                    </Button>
                  ) : undefined
                }
              />
            ))}
          </div>
        )}
      </div>

      <Modal
        open={cancelling !== null}
        title="Cancel this appointment?"
        onClose={closeDialog}
        footer={
          <>
            <Button variant="secondary" onClick={closeDialog}>
              Keep it
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void confirmCancel()}>
              Cancel appointment
            </Button>
          </>
        }
      >
        <p className="mb-4 text-sm text-slate-600">{cancelling?.faculty.name} will be notified.</p>
        <Field label="Reason (optional)" htmlFor="cancel-reason">
          <Textarea
            id="cancel-reason"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        </Field>
      </Modal>
    </>
  );
}
