import type { Appointment, AppointmentList, AppointmentStatus } from '@afb/types';
import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../../db/transaction';
import { AppError, NotFoundError } from '../../errors/app-error';
import type { AuthContext } from '../../lib/tokens';
import type { AppointmentRepository, LockedAppointment } from './appointment.repository';

const STATUS_WORDS: Record<AppointmentStatus, string> = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
};

function invalidTransition(message: string): AppError {
  return new AppError(409, 'INVALID_STATUS_TRANSITION', message);
}

function notFound(): NotFoundError {
  // The same answer for "does not exist" and "not yours": ids of other people's appointments are not confirmed.
  return new NotFoundError('Appointment not found.');
}

/**
 * Appointment use cases. Booking rules (free slot, no double booking, lifecycle) are enforced by
 * PostgreSQL; this service adds what only the application knows — who the caller is — and runs each
 * change in a transaction attributed to that caller for the audit log.
 */
export class AppointmentService {
  constructor(
    private readonly repository: AppointmentRepository,
    private readonly pool: Pool,
  ) {}

  /** A student requests a slot. The database either accepts it as PENDING or says precisely why not. */
  async request(
    actor: AuthContext,
    input: { facultyId: number; startsAt: string; purpose: string },
  ): Promise<Appointment> {
    return withTransaction(
      this.pool,
      async (client) => {
        const id = await this.repository.create(client, { studentId: actor.userId, ...input });
        if (id === null) {
          throw new NotFoundError('Faculty member not found.');
        }
        return this.repository.getById(client, id);
      },
      { actor },
    );
  }

  async listMine(
    actor: AuthContext,
    status: AppointmentStatus | undefined,
    limit: number,
  ): Promise<AppointmentList> {
    const party = actor.role === 'STUDENT' ? 'student' : 'faculty';
    const [appointments, counts] = await Promise.all([
      this.repository.listFor(party, actor.userId, status, limit),
      this.repository.countsFor(party, actor.userId),
    ]);
    return { appointments, counts };
  }

  async pending(actor: AuthContext): Promise<Appointment[]> {
    return this.repository.pendingForFaculty(actor.userId);
  }

  /** The student cancels their own pending request, or an approved appointment that has not started. */
  async cancel(actor: AuthContext, id: string, reason: string | undefined): Promise<Appointment> {
    return this.change(actor, id, (row) => {
      if (row.studentId !== actor.userId) {
        throw notFound();
      }
      if (row.status !== 'PENDING' && row.status !== 'APPROVED') {
        throw invalidTransition(
          `This appointment is already ${STATUS_WORDS[row.status]} and cannot be cancelled.`,
        );
      }
      if (row.started) {
        throw invalidTransition('This appointment has already started and can no longer be cancelled.');
      }
      return { status: 'CANCELLED', note: reason ?? null, cancelledBy: actor.userId };
    });
  }

  async approve(actor: AuthContext, id: string, note: string | undefined): Promise<Appointment> {
    return this.change(actor, id, (row) => {
      this.assertPendingForFaculty(actor, row);
      return { status: 'APPROVED', note: note ?? null };
    });
  }

  async reject(actor: AuthContext, id: string, reason: string | undefined): Promise<Appointment> {
    return this.change(actor, id, (row) => {
      this.assertPendingForFaculty(actor, row);
      return { status: 'REJECTED', note: reason ?? null };
    });
  }

  private assertPendingForFaculty(actor: AuthContext, row: LockedAppointment): void {
    if (row.facultyId !== actor.userId) {
      throw notFound();
    }
    if (row.status !== 'PENDING') {
      throw invalidTransition(`This request has already been ${STATUS_WORDS[row.status]}.`);
    }
  }

  /**
   * Lock → decide → update → read back, in one transaction. The row lock makes concurrent decisions
   * on the same appointment take turns; the database trigger remains the final guard on transitions.
   */
  private async change(
    actor: AuthContext,
    id: string,
    decide: (row: LockedAppointment) => {
      status: AppointmentStatus;
      note: string | null;
      cancelledBy?: number;
    },
  ): Promise<Appointment> {
    return withTransaction(
      this.pool,
      async (client: PoolClient) => {
        const row = await this.repository.lockForUpdate(client, id);
        if (row === null) {
          throw notFound();
        }
        await this.repository.updateStatus(client, id, decide(row));
        return this.repository.getById(client, id);
      },
      { actor },
    );
  }
}
