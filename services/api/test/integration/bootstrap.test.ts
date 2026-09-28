import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { startServer } from '../../src/bootstrap';
import { TEST_DATABASE_URL } from '../helpers/database';
import { testConfig } from '../helpers/app';
import { capturingLogger } from '../helpers/logger';

const baseConfig = {
  ...testConfig(),
  host: '127.0.0.1',
  port: 0,
  appointmentSweepIntervalMs: 60_000,
  database: { url: TEST_DATABASE_URL, poolMax: 2 },
};

describe('startServer', () => {
  it('serves real HTTP on an ephemeral port and shuts down cleanly', async () => {
    const { logger, lines } = capturingLogger();
    const running = await startServer(baseConfig, logger);

    try {
      expect(running.port).toBeGreaterThan(0);
      const res = await fetch(`http://127.0.0.1:${running.port}/api/health/ready`);
      expect(res.status).toBe(200);
      expect(lines.some((line) => line.msg === 'API listening')).toBe(true);
    } finally {
      await running.close();
    }

    expect(running.server.listening).toBe(false);
    expect(running.pool.ended).toBe(true);
    expect(lines.some((line) => line.msg === 'API stopped')).toBe(true);
  });

  it('close() is idempotent', async () => {
    const running = await startServer(baseConfig, capturingLogger().logger);

    const first = running.close();
    const second = running.close();

    expect(second).toBe(first);
    await first;
  });

  it('rejects (and releases the pool) when the port is already taken', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const { port } = blocker.address() as AddressInfo;

    try {
      await expect(startServer({ ...baseConfig, port }, capturingLogger().logger)).rejects.toMatchObject({
        code: 'EADDRINUSE',
      });
    } finally {
      await new Promise<void>((resolve) => {
        blocker.close(() => {
          resolve();
        });
      });
    }
  });

  it('propagates errors from closing the HTTP server', async () => {
    const running = await startServer(baseConfig, capturingLogger().logger);
    await new Promise<void>((resolve, reject) => {
      running.server.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

    await expect(running.close()).rejects.toMatchObject({ code: 'ERR_SERVER_NOT_RUNNING' });
    await running.pool.end();
  });
});
