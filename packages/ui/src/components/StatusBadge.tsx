import type { AppointmentStatus } from '@afb/types';
import { Badge, type Tone } from './Card';

export const STATUS_LABELS: Record<AppointmentStatus, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Completed',
};

const STATUS_TONES: Record<AppointmentStatus, Tone> = {
  PENDING: 'amber',
  APPROVED: 'green',
  REJECTED: 'red',
  CANCELLED: 'slate',
  COMPLETED: 'blue',
};

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  return <Badge tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</Badge>;
}
