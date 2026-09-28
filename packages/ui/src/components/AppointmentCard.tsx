import type { Appointment } from '@afb/types';
import { CalendarDays, Clock, MapPin } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatDate, formatDateTime, formatTimeRange } from '../format';
import { StatusBadge } from './StatusBadge';

const NOTE_LABELS: Record<Appointment['status'], string> = {
  PENDING: 'Note',
  APPROVED: 'Note from faculty',
  REJECTED: 'Reason',
  CANCELLED: 'Cancellation note',
  COMPLETED: 'Note from faculty',
};

/**
 * One appointment. `perspective` decides whose details are shown: a student sees the faculty member
 * (and where to meet them), a faculty member sees the student.
 */
export function AppointmentCard({
  appointment,
  perspective,
  actions,
}: {
  appointment: Appointment;
  perspective: 'student' | 'faculty';
  actions?: ReactNode;
}) {
  const other =
    perspective === 'student'
      ? {
          name: appointment.faculty.name,
          detail: `${appointment.faculty.designation} · ${appointment.faculty.departmentCode}`,
        }
      : {
          name: appointment.student.name,
          detail: `${appointment.student.registrationNumber} · ${appointment.student.batchName}`,
        };

  return (
    <article className="rounded-[var(--radius-card)] bg-white p-5 shadow-[var(--shadow-card)] ring-1 ring-slate-200">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{other.name}</h3>
          <p className="text-sm text-slate-500">{other.detail}</p>
        </div>
        <StatusBadge status={appointment.status} />
      </div>
      <dl className="mt-4 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-slate-400" aria-hidden="true" />
          <dt className="sr-only">Date</dt>
          <dd>{formatDate(appointment.startsAt)}</dd>
        </div>
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-slate-400" aria-hidden="true" />
          <dt className="sr-only">Time</dt>
          <dd>{formatTimeRange(appointment.startsAt, appointment.endsAt)}</dd>
        </div>
        {perspective === 'student' && appointment.status === 'APPROVED' && (
          <div className="flex items-center gap-2 sm:col-span-2">
            <MapPin className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            <dt className="sr-only">Where</dt>
            <dd className="font-medium text-emerald-800">Meet at {appointment.faculty.officeLocation}</dd>
          </div>
        )}
      </dl>
      <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm">
        <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Purpose</p>
        <p className="mt-0.5 text-slate-800">{appointment.purpose}</p>
      </div>
      {appointment.decisionNote !== null && (
        <p className="mt-3 text-sm text-slate-700">
          <span className="font-medium">{NOTE_LABELS[appointment.status]}:</span> {appointment.decisionNote}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-400">Requested {formatDateTime(appointment.createdAt)}</p>
        {actions !== undefined && <div className="flex gap-2">{actions}</div>}
      </div>
    </article>
  );
}
