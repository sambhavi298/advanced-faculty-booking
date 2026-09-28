import type {
  AdminAppointmentFilter,
  AdminAppointmentPage,
  AdminDashboard,
  AdminDepartment,
  AdminFaculty,
  AdminStudent,
  AuditEntry,
  AuditFilter,
  AuditPage,
  MonthlyReport,
  UserStatusResponse,
} from '@afb/types';
import type { Pool } from 'pg';
import { withTransaction, type Actor } from '../../db/transaction';
import { ConflictError, NotFoundError } from '../../errors/app-error';
import type { AdminRepository } from './admin.repository';

export class AdminService {
  constructor(
    private readonly repository: AdminRepository,
    private readonly pool: Pool,
  ) {}

  /** The live dashboard: six independent queries in parallel, each over the current tables. */
  async dashboard(): Promise<AdminDashboard> {
    const [totals, appointmentsByStatus, today, daily, topFaculty, recentAudit] = await Promise.all([
      this.repository.totals(),
      this.repository.appointmentsByStatus(),
      this.repository.today(),
      this.repository.daily(14),
      this.repository.topFaculty(5),
      this.repository.audit({ limit: 8 }),
    ]);
    return { totals, appointmentsByStatus, today, daily, topFaculty, recentAudit };
  }

  students(filter: { search?: string; batchId?: number }): Promise<AdminStudent[]> {
    return this.repository.students(filter);
  }

  faculty(filter: { search?: string }): Promise<AdminFaculty[]> {
    return this.repository.faculty(filter);
  }

  departments(): Promise<AdminDepartment[]> {
    return this.repository.departments();
  }

  /**
   * Activates or deactivates an account. The change is audited as done by the admin, and takes effect
   * at once: the authentication middleware re-reads is_active on every request, so a deactivated
   * user's existing token stops working immediately.
   */
  async setUserStatus(actor: Actor, userId: number, isActive: boolean): Promise<UserStatusResponse> {
    if (userId === actor.userId && !isActive) {
      throw new ConflictError('CONFLICT', 'You cannot deactivate your own account.');
    }
    const updated = await withTransaction(
      this.pool,
      (client) => this.repository.setActive(client, userId, isActive),
      { actor },
    );
    if (updated === null) {
      throw new NotFoundError('User not found.');
    }
    return updated;
  }

  async appointments(
    filter: Required<Pick<AdminAppointmentFilter, 'limit' | 'offset'>> & AdminAppointmentFilter,
  ): Promise<AdminAppointmentPage> {
    const page = await this.repository.appointments(filter);
    return { ...page, limit: filter.limit, offset: filter.offset };
  }

  /** Fetches one extra row to learn whether an older page exists. */
  async audit(filter: AuditFilter & { limit: number }): Promise<AuditPage> {
    const rows = await this.repository.audit({ ...filter, limit: filter.limit + 1 });
    const entries = rows.slice(0, filter.limit);
    const hasMore = rows.length > filter.limit;
    return { entries, nextBefore: hasMore ? (entries[entries.length - 1] as AuditEntry).id : null };
  }

  async reports(month?: string): Promise<MonthlyReport> {
    const { rows, refreshedAt } = await this.repository.report(month === undefined ? null : `${month}-01`);
    return { rows, refreshedAt: refreshedAt?.toISOString() ?? null };
  }

  async refreshReports(): Promise<{ refreshedAt: string }> {
    return { refreshedAt: (await this.repository.refreshReports()).toISOString() };
  }
}
