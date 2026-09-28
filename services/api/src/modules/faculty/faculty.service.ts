import type {
  AvailabilityWindow,
  CreateExceptionRequest,
  CreateExceptionResponse,
  FacultyAvailability,
  FacultySummary,
  MyAvailability,
  ReplaceAvailabilityResponse,
} from '@afb/types';
import type { Pool } from 'pg';
import { withTransaction } from '../../db/transaction';
import type { Queryable } from '../../db/types';
import { NotFoundError, ValidationError } from '../../errors/app-error';
import type { AuthContext } from '../../lib/tokens';
import type { FacultyRepository } from './faculty.repository';

/** Longest date range one availability request may cover. */
export const MAX_RANGE_DAYS = 31;

const DAY_MS = 86_400_000;

/** Number of days from `from` to `to`, inclusive, for 'YYYY-MM-DD' strings. */
export function daysInRange(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

/** Students see slots personalised to their own timetable; other roles see the faculty member's free slots. */
function studentIdOf(actor: AuthContext): number | null {
  return actor.role === 'STUDENT' ? actor.userId : null;
}

export class FacultyService {
  constructor(
    private readonly repository: FacultyRepository,
    private readonly pool: Pool,
  ) {}

  async list(
    actor: AuthContext,
    filter: { search?: string; department?: string },
  ): Promise<FacultySummary[]> {
    return this.repository.list({
      search: filter.search,
      departmentCode: filter.department,
      studentId: studentIdOf(actor),
    });
  }

  /** A faculty member's profile, free slots per day, weekly availability and teaching timetable. */
  async availability(
    actor: AuthContext,
    facultyId: number,
    range: { from?: string; to?: string },
  ): Promise<FacultyAvailability> {
    const studentId = studentIdOf(actor);
    const faculty = await this.repository.findSummary(facultyId, studentId);
    if (faculty === null) {
      throw new NotFoundError('Faculty member not found.');
    }
    const { from, to } = await this.repository.resolveRange(range.from, range.to);
    const days = daysInRange(from, to);
    if (days < 1) {
      throw new ValidationError('The end date must not be before the start date.');
    }
    if (days > MAX_RANGE_DAYS) {
      throw new ValidationError(`Choose a range of at most ${String(MAX_RANGE_DAYS)} days.`);
    }
    const [slots, weeklyAvailability, teaching] = await Promise.all([
      this.repository.freeSlotsByDay(facultyId, from, to, studentId),
      this.repository.weeklyWindows(this.pool, facultyId),
      this.repository.teaching(facultyId),
    ]);
    return { faculty, from, to, days: slots, weeklyAvailability, teaching };
  }

  async mine(actor: AuthContext): Promise<MyAvailability> {
    return this.snapshot(this.pool, actor.userId);
  }

  /** Replaces the weekly set in one transaction (all or nothing), audited as the faculty member. */
  async replace(actor: AuthContext, windows: AvailabilityWindow[]): Promise<ReplaceAvailabilityResponse> {
    return withTransaction(
      this.pool,
      async (client) => {
        const changes = await this.repository.replaceWindows(client, actor.userId, windows);
        return { ...(await this.snapshot(client, actor.userId)), ...changes };
      },
      { actor },
    );
  }

  /**
   * Records leave / a meeting / blocked time. PostgreSQL's trigger then rejects pending requests and
   * cancels approved appointments in the period and notifies each student — in this same transaction.
   */
  async addException(actor: AuthContext, input: CreateExceptionRequest): Promise<CreateExceptionResponse> {
    return withTransaction(
      this.pool,
      async (client) => {
        const releasedAppointments = await this.repository.countReleasable(
          client,
          actor.userId,
          input.startsAt,
          input.endsAt,
        );
        const exception = await this.repository.createException(client, actor.userId, {
          kind: input.kind,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          reason: input.reason,
        });
        return { exception, releasedAppointments };
      },
      { actor },
    );
  }

  /** Removes an exception (appointments it released stay released). */
  async removeException(actor: AuthContext, exceptionId: number): Promise<void> {
    await withTransaction(
      this.pool,
      async (client) => {
        if (!(await this.repository.deleteException(client, actor.userId, exceptionId))) {
          throw new NotFoundError('Exception not found.');
        }
      },
      { actor },
    );
  }

  /** Sequential on purpose: `db` may be a single transaction client, which runs one query at a time. */
  private async snapshot(db: Queryable, facultyId: number): Promise<MyAvailability> {
    const slotMinutes = await this.repository.slotMinutes(db, facultyId);
    const windows = await this.repository.weeklyWindows(db, facultyId);
    const exceptions = await this.repository.upcomingExceptions(db, facultyId);
    return { slotMinutes, windows, exceptions };
  }
}
