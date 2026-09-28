import type { HealthRepository } from '../../../../src/modules/health/health.repository';
import { HealthService, systemClock, type Clock } from '../../../../src/modules/health/health.service';
import { capturingLogger } from '../../../helpers/logger';

const fixedClock: Clock = {
  now: () => new Date('2026-09-28T10:00:00.000Z'),
  uptimeSeconds: () => 42.6,
};

function serviceWith(getServerInfo: jest.Mock) {
  const { logger, lines } = capturingLogger();
  const repository = { getServerInfo } as unknown as HealthRepository;
  return { service: new HealthService(repository, logger, fixedClock), lines };
}

describe('HealthService.liveness', () => {
  it('reports ok with rounded uptime and an ISO timestamp', () => {
    const { service } = serviceWith(jest.fn());

    expect(service.liveness()).toEqual({
      status: 'ok',
      uptimeSeconds: 43,
      timestamp: '2026-09-28T10:00:00.000Z',
    });
  });

  it('uses the system clock by default', () => {
    const { logger } = capturingLogger();
    const service = new HealthService({} as HealthRepository, logger);

    const result = service.liveness();

    expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(Date.parse(result.timestamp)).not.toBeNaN();
    expect(systemClock.now()).toBeInstanceOf(Date);
    expect(systemClock.uptimeSeconds()).toBeGreaterThan(0);
  });
});

describe('HealthService.readiness', () => {
  it('is ready on PostgreSQL 18 or newer', async () => {
    const { service } = serviceWith(
      jest.fn().mockResolvedValue({ versionNum: 180004, version: '18.4', name: 'afb' }),
    );

    await expect(service.readiness()).resolves.toEqual({
      status: 'ready',
      database: { reachable: true, serverVersion: '18.4', name: 'afb' },
    });
  });

  it('is not ready on an older PostgreSQL', async () => {
    const { service } = serviceWith(
      jest.fn().mockResolvedValue({ versionNum: 160004, version: '16.4', name: 'afb' }),
    );

    await expect(service.readiness()).resolves.toEqual({
      status: 'not_ready',
      reason: 'unsupported_postgres_version',
      database: { reachable: true, serverVersion: '16.4', minimumVersion: '18' },
    });
  });

  it('is not ready (and logs why) when the database is unreachable', async () => {
    const { service, lines } = serviceWith(jest.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    await expect(service.readiness()).resolves.toEqual({
      status: 'not_ready',
      reason: 'database_unreachable',
      database: { reachable: false, minimumVersion: '18' },
    });
    expect(lines[0]).toMatchObject({ level: 40, msg: 'Readiness check: database unreachable' });
  });
});
