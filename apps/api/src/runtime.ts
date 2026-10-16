import { randomUUID } from 'node:crypto';
import { createServerApp } from './app.js';
import { workOrderRoutes } from './modules/work-orders/routes/index.js';
import { workOrderService } from './modules/work-orders/application/service.js';
import { createWorkOrderDatabase } from './modules/work-orders/infrastructure/repository.js';
import type { RuntimeConfig, ProductionAdapters } from './runtime-config.js';
import { createProductionAdapters } from './runtime-adapters.js';
import { LocalAccounts } from './accounts/service.js';
import {
  localAuthRoutes,
  localIdentity,
  type LocalAuthOptions,
} from './accounts/routes.js';

export type { RuntimeConfig, ProductionAdapters } from './runtime-config.js';
/** Demo and deployed services use the same routes, use cases and repository. */
export function createRuntimeApp(
  config: RuntimeConfig,
  suppliedAdapters?: ProductionAdapters,
) {
  const database = createWorkOrderDatabase(config.databaseUrl);
  const adapters = suppliedAdapters ?? createProductionAdapters();
  const accounts = new LocalAccounts(database.client);
  const localAuthOptions: LocalAuthOptions = {
    accounts,
    mode: 'production',
    publicOrigin: config.publicOrigin,
    now: Date.now,
    ...(config.insecureCookiesForTesting
      ? { insecureCookiesForTesting: true }
      : {}),
  };
  const service = workOrderService({
    repository: database.repository,
    source: adapters.personnel,
    newId: randomUUID,
    now: () => new Date().toISOString(),
  });
  const routes = workOrderRoutes({
    service,
    identity: localIdentity(localAuthOptions),
    mode: 'production',
    publicOrigin: config.publicOrigin,
    loginUrl: '/api/auth/login',
    now: Date.now,
  });
  routes.route('/', localAuthRoutes(localAuthOptions));
  return { app: createServerApp(routes), database };
}
