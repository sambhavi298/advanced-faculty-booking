import { startElapsedAppointmentsJob } from '../../../src/jobs/elapsed-appointments.job';
import { capturingLogger } from '../../helpers/logger';

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('elapsed appointments job', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('sweeps at start-up and then on every interval, logging only when something changed', async () => {
    const { logger, lines } = capturingLogger();
    const processElapsed = jest
      .fn()
      .mockResolvedValueOnce({ completed: 0, expired: 0 })
      .mockResolvedValueOnce({ completed: 2, expired: 1 });

    const stop = startElapsedAppointmentsJob({ processElapsed }, logger, 60_000);
    await flush();
    expect(processElapsed).toHaveBeenCalledTimes(1);
    expect(lines).toHaveLength(0);

    jest.advanceTimersByTime(60_000);
    await flush();
    expect(processElapsed).toHaveBeenCalledTimes(2);
    expect(lines[0]).toMatchObject({ msg: 'Processed elapsed appointments', completed: 2, expired: 1 });

    stop();
    jest.advanceTimersByTime(120_000);
    await flush();
    expect(processElapsed).toHaveBeenCalledTimes(2);
  });

  it('logs failures and keeps running', async () => {
    const { logger, lines } = capturingLogger();
    const processElapsed = jest
      .fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue({ completed: 0, expired: 0 });

    const stop = startElapsedAppointmentsJob({ processElapsed }, logger, 1000);
    await flush();
    expect(lines[0]).toMatchObject({ level: 50, msg: 'Elapsed-appointment sweep failed' });

    jest.advanceTimersByTime(1000);
    await flush();
    expect(processElapsed).toHaveBeenCalledTimes(2);
    stop();
  });

  it('never overlaps two sweeps', async () => {
    const { logger } = capturingLogger();
    let finish!: () => void;
    const processElapsed = jest.fn(
      () =>
        new Promise<{ completed: number; expired: number }>((resolve) => {
          finish = () => {
            resolve({ completed: 0, expired: 0 });
          };
        }),
    );

    const stop = startElapsedAppointmentsJob({ processElapsed }, logger, 1000);
    jest.advanceTimersByTime(3000); // three ticks while the first sweep is still running
    await flush();
    expect(processElapsed).toHaveBeenCalledTimes(1);

    finish();
    await flush();
    jest.advanceTimersByTime(1000);
    await flush();
    expect(processElapsed).toHaveBeenCalledTimes(2);
    stop();
  });
});
