import { EventEmitter } from 'node:events';
import { installShutdownHandlers } from '../../src/bootstrap';
import { capturingLogger } from '../helpers/logger';

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('installShutdownHandlers', () => {
  it.each(['SIGINT', 'SIGTERM'] as const)('closes the server and exits 0 on %s', async (signal) => {
    const { logger, lines } = capturingLogger();
    const signals = new EventEmitter();
    const close = jest.fn().mockResolvedValue(undefined);
    const exit = jest.fn();

    installShutdownHandlers({ close }, logger, exit, signals);
    signals.emit(signal, signal);
    await flushPromises();

    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(lines[0]).toMatchObject({ msg: 'Shutting down', signal });
  });

  it('exits 1 and logs when shutdown fails', async () => {
    const { logger, lines } = capturingLogger();
    const signals = new EventEmitter();
    const exit = jest.fn();

    installShutdownHandlers(
      { close: jest.fn().mockRejectedValue(new Error('pool stuck')) },
      logger,
      exit,
      signals,
    );
    signals.emit('SIGTERM', 'SIGTERM');
    await flushPromises();

    expect(exit).toHaveBeenCalledWith(1);
    expect(lines.some((line) => line.msg === 'Error during shutdown')).toBe(true);
  });

  it('registers each signal only once', () => {
    const signals = new EventEmitter();
    installShutdownHandlers({ close: jest.fn() }, capturingLogger().logger, jest.fn(), signals);

    expect(signals.listenerCount('SIGINT')).toBe(1);
    expect(signals.listenerCount('SIGTERM')).toBe(1);
  });

  it('defaults to listening on the real process', () => {
    const before = { SIGINT: process.listeners('SIGINT'), SIGTERM: process.listeners('SIGTERM') };
    installShutdownHandlers({ close: jest.fn() }, capturingLogger().logger, jest.fn());

    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      const added = process.listeners(signal).filter((listener) => !before[signal].includes(listener));
      expect(added).toHaveLength(1);
      // Remove only what this test added, never Jest's own handlers.
      added.forEach((listener) => process.removeListener(signal, listener));
    }
  });
});
