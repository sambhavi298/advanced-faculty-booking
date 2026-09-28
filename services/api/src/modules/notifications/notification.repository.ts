import type { AppNotification, NotificationKind, NotificationList } from '@afb/types';
import type { Queryable } from '../../db/types';

interface NotificationRow {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  appointment_id: string | null;
  read_at: Date | null;
  created_at: Date;
  unread: number;
}

export class NotificationRepository {
  constructor(private readonly db: Queryable) {}

  /**
   * Latest notifications plus the unread total in one query. The window aggregate
   * `count(*) FILTER (WHERE read_at IS NULL) OVER ()` is evaluated over all of the user's rows
   * before LIMIT applies, so the badge count is exact even though only `limit` rows are returned.
   */
  async list(userId: number, limit: number): Promise<NotificationList> {
    const result = await this.db.query<NotificationRow>(
      `SELECT n.id, n.kind, n.title, n.body, n.appointment_id, n.read_at, n.created_at,
              count(*) FILTER (WHERE n.read_at IS NULL) OVER () AS unread
         FROM notifications n
        WHERE n.user_id = $1
        ORDER BY n.created_at DESC, n.id DESC
        LIMIT $2`,
      [userId, limit],
    );
    const unread = result.rows[0]?.unread ?? 0;
    return {
      unread,
      notifications: result.rows.map((row): AppNotification => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        body: row.body,
        appointmentId: row.appointment_id,
        readAt: row.read_at === null ? null : row.read_at.toISOString(),
        createdAt: row.created_at.toISOString(),
      })),
    };
  }

  async markAllRead(userId: number): Promise<number> {
    const result = await this.db.query(
      'UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL',
      [userId],
    );
    return Number(result.rowCount);
  }
}
