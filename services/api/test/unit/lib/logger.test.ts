import { capturingLogger, silentLogger } from '../../helpers/logger';

describe('createLogger', () => {
  it('uses the configured level', () => {
    expect(silentLogger().level).toBe('silent');
  });

  it('writes structured JSON tagged with the service name', () => {
    const { logger, lines } = capturingLogger();

    logger.info({ bookingId: 7 }, 'Booked');

    expect(lines[0]).toMatchObject({ service: 'afb-api', bookingId: 7, msg: 'Booked' });
  });

  it('redacts credentials before they reach the log', () => {
    const { logger, lines } = capturingLogger();

    logger.info(
      {
        req: { headers: { authorization: 'Bearer abc.def.ghi', cookie: 'sid=1' } },
        password: 'Password123!',
        body: { password: 'Password123!', token: 'jwt', passwordHash: '$2b$10$x' },
      },
      'Login attempt',
    );

    const serialised = JSON.stringify(lines[0]);
    expect(serialised).not.toContain('abc.def.ghi');
    expect(serialised).not.toContain('Password123!');
    expect(serialised).not.toContain('sid=1');
    expect(serialised).not.toContain('$2b$10$x');
    expect(serialised).toContain('[REDACTED]');
  });
});
