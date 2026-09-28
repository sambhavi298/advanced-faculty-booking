/**
 * Process entry point (excluded from coverage — every piece it calls is unit/integration tested).
 * Loads services/api/.env if present, validates configuration, starts the server and installs
 * graceful-shutdown handlers.
 */
import path from 'node:path';
import { installShutdownHandlers, startServer } from './bootstrap';
import { loadConfig, loadEnvFileIfPresent } from './config/env';
import { createLogger } from './lib/logger';

async function main(): Promise<void> {
  loadEnvFileIfPresent(path.resolve(process.cwd(), '.env'));
  const config = loadConfig();
  const logger = createLogger(config);
  const running = await startServer(config, logger);
  installShutdownHandlers(running, logger, (code) => process.exit(code));
}

main().catch((err: unknown) => {
  // The logger may not exist yet (e.g. invalid configuration), so fall back to stderr.
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
