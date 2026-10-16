import { serve } from '@hono/node-server';
import { serverConfig } from './server-config.js';
import { createRuntimeApp } from './runtime.js';

async function start() {
  const config = serverConfig(process.env);
  const runtime = createRuntimeApp(config);
  try {
    // Checking the business shape also rejects an un-migrated database.
    await runtime.database.client.workOrder.findFirst();
    await runtime.database.client.localAccount.findFirst();
    await runtime.database.client.localSession.findFirst();
  } catch {
    await runtime.database.close();
    throw new Error('RUNTIME_DATABASE_UNAVAILABLE');
  }
  const server = serve(
    {
      fetch: runtime.app.fetch,
      port: config.port,
      hostname: config.hostname,
    },
    () => {
      console.log(`API_LISTENING port=${String(config.port)}`);
    },
  );
  const closeDatabase = () => {
    runtime.database.close().catch(() => {
      process.exitCode = 1;
    });
  };
  server.once('error', () => {
    console.error('API_LISTENER_FAILED');
    process.exitCode = 1;
    closeDatabase();
  });
  const stop = () => server.close(closeDatabase);
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
start().catch(() => {
  console.error(
    'API_START_FAILED: check local account configuration and database',
  );
  process.exitCode = 1;
});
