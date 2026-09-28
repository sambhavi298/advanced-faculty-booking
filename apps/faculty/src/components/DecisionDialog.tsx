import { ApiError } from '@afb/api-client';
import type { Appointment } from '@afb/types';
import {
  Button,
  Field,
  Modal,
  Textarea,
  describeError,
  formatDate,
  formatTimeRange,
  useAuth,
  useToast,
} from '@afb/ui';
import { useState } from 'react';

export type Decision = 'approve' | 'reject';

const COPY: Record<Decision, { title: string; label: string; hint: string; button: string }> = {
  approve: {
    title: 'Approve this request?',
    label: 'Note for the student (optional)',
    hint: 'For example: bring your draft report.',
    button: 'Approve',
  },
  reject: {
    title: 'Decline this request?',
    label: 'Reason (optional, shown to the student)',
    hint: 'For example: please book a slot after the mid-term.',
    button: 'Decline',
  },
};

/**
 * Confirms an approval or rejection with an optional note. The database makes the final call: if
 * the request was cancelled, already decided in another tab, or its time has passed, the API answers
 * 409 and the caller refreshes the list.
 */
export function DecisionDialog({
  target,
  onClose,
  onDone,
}: {
  target: { appointment: Appointment; decision: Decision } | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { api } = useAuth();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const close = () => {
    setNote('');
    onClose();
  };

  const confirm = async (appointment: Appointment, decision: Decision) => {
    setBusy(true);
    const text = note.trim() === '' ? undefined : note.trim();
    try {
      if (decision === 'approve') {
        await api.appointments.approve(appointment.id, text);
        toast.success(`Approved. ${appointment.student.name} has been notified.`);
      } else {
        await api.appointments.reject(appointment.id, text);
        toast.success(`Declined. ${appointment.student.name} has been notified.`);
      }
      close();
      onDone();
    } catch (error) {
      toast.error(describeError(error));
      if (error instanceof ApiError && error.status === 409) {
        close();
        onDone(); // the request changed meanwhile — show the current state
      }
    } finally {
      setBusy(false);
    }
  };

  const copy = COPY[target?.decision ?? 'approve'];
  return (
    <Modal
      open={target !== null}
      title={copy.title}
      onClose={close}
      footer={
        target !== null && (
          <>
            <Button variant="secondary" onClick={close}>
              Back
            </Button>
            <Button
              variant={target.decision === 'approve' ? 'primary' : 'danger'}
              loading={busy}
              onClick={() => void confirm(target.appointment, target.decision)}
            >
              {copy.button}
            </Button>
          </>
        )
      }
    >
      {target !== null && (
        <p className="mb-4 text-sm text-slate-600">
          {target.appointment.student.name} · {formatDate(target.appointment.startsAt)},{' '}
          {formatTimeRange(target.appointment.startsAt, target.appointment.endsAt)}
        </p>
      )}
      <Field label={copy.label} htmlFor="decision-note" hint={copy.hint}>
        <Textarea
          id="decision-note"
          rows={3}
          maxLength={500}
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
      </Field>
    </Modal>
  );
}

/** The Approve / Decline buttons shown on a pending request. */
export function DecisionButtons({
  appointment,
  onDecide,
}: {
  appointment: Appointment;
  onDecide: (target: { appointment: Appointment; decision: Decision }) => void;
}) {
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        aria-label={`Decline request from ${appointment.student.name}`}
        onClick={() => {
          onDecide({ appointment, decision: 'reject' });
        }}
      >
        Decline
      </Button>
      <Button
        size="sm"
        aria-label={`Approve request from ${appointment.student.name}`}
        onClick={() => {
          onDecide({ appointment, decision: 'approve' });
        }}
      >
        Approve
      </Button>
    </>
  );
}
