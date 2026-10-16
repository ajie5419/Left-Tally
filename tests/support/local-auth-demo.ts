import { createRuntimeApp } from '../../apps/api/src/runtime.js';
import { LocalAccounts } from '../../apps/api/src/accounts/service.js';
import { randomBytes } from 'node:crypto';

function credentials() {
  const password = () => `Gc!${randomBytes(18).toString('base64url')}`;
  return {
    admin: { username: 'demo.admin', password: password() },
    creator: { username: 'demo.creator', password: password() },
    reader: { username: 'demo.reader', password: password() },
  };
}

/** Isolated browser/demo fixture only. Production never creates these accounts. */
export async function createLocalAuthDemo(
  databaseUrl: string,
  publicOrigin: string,
) {
  const localDemoCredentials = credentials();
  const runtime = createRuntimeApp(
    {
      databaseUrl,
      publicOrigin,
      insecureCookiesForTesting: true,
    },
    { personnel: { productionLeads: () => Promise.resolve([]) } },
  );
  const accounts = new LocalAccounts(runtime.database.client);
  await accounts.create({
    username: localDemoCredentials.admin.username,
    name: '演示账户管理员',
    password: localDemoCredentials.admin.password,
    permissions: [],
    accountAdmin: true,
  });
  await accounts.create({
    username: localDemoCredentials.creator.username,
    name: '演示项目建单员',
    password: localDemoCredentials.creator.password,
    permissions: ['work-orders:read', 'work-orders:create'],
    accountAdmin: false,
  });
  await accounts.create({
    username: localDemoCredentials.reader.username,
    name: '演示只读人员',
    password: localDemoCredentials.reader.password,
    permissions: ['work-orders:read'],
    accountAdmin: false,
  });
  return {
    app: runtime.app,
    database: runtime.database,
    credentials: localDemoCredentials,
  };
}
