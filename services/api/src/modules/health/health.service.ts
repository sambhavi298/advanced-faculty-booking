import type { LivenessResponse, ReadinessResponse } from '@afb/types';
import type { Logger } from '../../lib/logger';
import type { DatabaseServerInfo, HealthRepository } from './health.repository';

/**
 * The schema relies on PostgreSQL 18 features (temporal `WITHOUT OVERLAPS` constraints,
 * `uuidv7()`, virtual generated columns). Reporting "not ready" on an older server turns a
 * cryptic migration failure into an explicit, actionable message.
 */
export const MINIMUM_POSTGRES_VERSION_NUM = 180000;
export const MINIMUM_POSTGRES_VERSION = '18';

export interface Clock {
  now(): Date;
  uptimeSeconds(): number;
}

export const systemClock: Clock = {
  now: () => new Date(),
  uptimeSeconds: () => process.uptime(),
};

export class HealthService {
  constructor(
    private readonly repository: HealthRepository,
    private readonly logger: Logger,
    private readonly clock: Clock = systemClock,
  ) {}

  liveness(): LivenessResponse {
    return {
      status: 'ok',
      uptimeSeconds: Math.round(this.clock.uptimeSeconds()),
      timestamp: this.clock.now().toISOString(),
    };
  }

  async readiness(): Promise<ReadinessResponse> {
    let info: DatabaseServerInfo;
    try {
      info = await this.repository.getServerInfo();
    } catch (err) {
      this.logger.warn({ err }, 'Readiness check: database unreachable');
      return {
        status: 'not_ready',
        reason: 'database_unreachable',
        database: { reachable: false, minimumVersion: MINIMUM_POSTGRES_VERSION },
      };
    }

    if (info.versionNum < MINIMUM_POSTGRES_VERSION_NUM) {
      return {
        status: 'not_ready',
        reason: 'unsupported_postgres_version',
        database: { reachable: true, serverVersion: info.version, minimumVersion: MINIMUM_POSTGRES_VERSION },
      };
    }

    return {
      status: 'ready',
      database: { reachable: true, serverVersion: info.version, name: info.name },
    };
  }
}
