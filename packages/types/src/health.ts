/** `GET /api/health` — liveness: the process is up and serving HTTP. Never touches the database. */
export interface LivenessResponse {
  status: 'ok';
  uptimeSeconds: number;
  timestamp: string;
}

/** Why the API is not ready to serve traffic. */
export type NotReadyReason = 'database_unreachable' | 'unsupported_postgres_version';

/** `GET /api/health/ready` — readiness: the database is reachable and new enough for our schema. */
export type ReadinessResponse =
  | {
      status: 'ready';
      database: {
        reachable: true;
        serverVersion: string;
        name: string;
      };
    }
  | {
      status: 'not_ready';
      reason: NotReadyReason;
      database: {
        reachable: boolean;
        serverVersion?: string;
        minimumVersion: string;
      };
    };
