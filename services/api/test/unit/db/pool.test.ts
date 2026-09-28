import { createPool } from '../../../src/db/pool';
import { capturingLogger } from '../../helpers/logger';

describe('createPool', () => {
  it('configures the pool from DatabaseConfig without connecting', async () => {
    const { logger } = capturingLogger();
    const pool = createPool({ url: 'postgres://u:p@localhost:5433/db', poolMax: 7 }, logger);

    expect(pool.options).toMatchObject({
      connectionString: 'postgres://u:p@localhost:5433/db',
      max: 7,
      application_name: 'afb-api',
      statement_timeout: 15_000,
    });
    expect(pool.totalCount).toBe(0);
    await pool.end();
  });

  it('logs idle-client errors instead of crashing the process', async () => {
    const { logger, lines } = capturingLogger();
    const pool = createPool({ url: 'postgres://u:p@localhost:5433/db', poolMax: 1 }, logger);

    pool.emit('error', new Error('server closed the connection'));

    expect(lines[0]).toMatchObject({ level: 50, msg: 'Idle PostgreSQL client error' });
    await pool.end();
  });
});
