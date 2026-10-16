import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { createServer as httpsServer } from 'node:https';
import { request as httpRequest } from 'node:http';
import { resolve, extname } from 'node:path';
import { getCACertificates, setDefaultCACertificates } from 'node:tls';
import { createRuntimeApp } from '../../apps/api/src/runtime.ts';
import { serverConfig } from '../../apps/api/src/server-config.ts';

// Only the owning QMS runner supplies ports, databases and short-lived test configuration.
if (
  process.env.QGS_E2E_MODE !== 'isolated' ||
  process.env.NODE_ENV !== 'test' ||
  !/^[a-f\d]{24}$/.test(process.env.QGS_E2E_RUN_ID ?? '')
)
  throw new Error('OWNED_IDENTITY_RUNTIME_REQUIRED');
const { assertOwnedTargets } = await import(
  resolve('../Quality-Guardian/scripts/e2e/safety.mjs')
);
await assertOwnedTargets(process.env);
const ownDatabase = new URL(process.env.GC_DATABASE_URL);
const qmsDatabase = new URL(process.env.DATABASE_URL);
if (
  ownDatabase.host !== qmsDatabase.host ||
  ownDatabase.username !== qmsDatabase.username ||
  ownDatabase.pathname !== `/gc_identity_${process.env.QGS_E2E_RUN_ID}`
)
  throw new Error('IDENTITY_DATABASE_SCOPE_INVALID');
const require = createRequire(
  new URL('../../apps/api/package.json', import.meta.url),
);
const { serve } = require('@hono/node-server');
const certificate = spawnSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    '/dev/stdout',
    '-out',
    '/dev/stdout',
    '-subj',
    '/CN=127.0.0.1',
    '-addext',
    'subjectAltName=IP:127.0.0.1',
    '-days',
    '1',
  ],
  { encoding: 'utf8', timeout: 30_000 },
);
if (certificate.status !== 0) throw new Error('EPHEMERAL_CERTIFICATE_FAILED');
const cert = certificate.stdout.match(
  /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/,
)?.[0];
const keyPattern = new RegExp(
  '-----BEGIN ' +
    'PRIVATE' +
    ' KEY-----[\\s\\S]*?-----END ' +
    'PRIVATE' +
    ' KEY-----',
);
const key = certificate.stdout.match(keyPattern)?.[0];
if (!cert || !key) throw new Error('EPHEMERAL_CERTIFICATE_INVALID');
setDefaultCACertificates([...getCACertificates(), cert]);
const tlsOptions = { cert, key };
const qmsTlsPort = Number(process.env.GC_IDENTITY_QMS_TLS_PORT);
const proxy = httpsServer(tlsOptions, (req, res) => {
  const origin = req.url?.startsWith('/api/')
    ? process.env.QGS_E2E_BACKEND_ORIGIN
    : process.env.QGS_E2E_BASE_URL;
  const target = new URL(req.url ?? '/', origin);
  const upstream = httpRequest(
    target,
    { method: req.method, headers: { ...req.headers, host: target.host } },
    (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(res);
    },
  );
  upstream.on('error', () => {
    res.writeHead(502);
    res.end('Temporary test proxy failure');
  });
  req.pipe(upstream);
});
await new Promise((accept, reject) => {
  proxy.once('error', reject);
  proxy.listen(qmsTlsPort, '127.0.0.1', accept);
});
const fixture = JSON.parse(
  readFileSync(`${process.env.QGS_E2E_ARTIFACT_DIR}/seed.json`, 'utf8'),
);
const config = serverConfig({
  GC_DATABASE_URL: process.env.GC_DATABASE_URL,
  GC_PUBLIC_ORIGIN: process.env.GC_IDENTITY_E2E_ORIGIN,
  GC_LOGIN_URL: `https://127.0.0.1:${qmsTlsPort}/identity/authorize`,
  GC_QMS_ORIGIN: `https://127.0.0.1:${qmsTlsPort}`,
  GC_QMS_CLIENT_ID: process.env.QMS_IDENTITY_CLIENT_ID,
  GC_QMS_CLIENT_SECRET: process.env.QMS_IDENTITY_CLIENT_SECRET,
  GC_SESSION_KEY: process.env.GC_SESSION_KEY,
  GC_USER_PERMISSIONS: JSON.stringify({
    [fixture.identityUserId]: ['work-orders:read', 'work-orders:create'],
  }),
});
const migration = spawnSync(
  process.execPath,
  ['scripts/toolchain.mjs', 'pnpm', 'db:deploy'],
  { env: process.env, encoding: 'utf8', timeout: 60_000 },
);
if (migration.status !== 0) throw new Error('ISOLATED_GC_MIGRATION_FAILED');
const runtime = createRuntimeApp(config);
const dist = resolve('apps/web/dist');
if (!existsSync(resolve(dist, 'index.html')))
  throw new Error('GC_BUILD_REQUIRED');
const server = serve({
  port: Number(process.env.GC_IDENTITY_E2E_PORT),
  hostname: '127.0.0.1',
  createServer: httpsServer,
  serverOptions: tlsOptions,
  fetch(request) {
    const pathname = new URL(request.url).pathname;
    if (
      pathname.startsWith('/api/') ||
      pathname === '/health' ||
      pathname === '/openapi.json'
    )
      return runtime.app.fetch(request);
    const asset = resolve(dist, `.${pathname}`);
    const file =
      asset.startsWith(`${dist}/`) && existsSync(asset) && extname(asset)
        ? asset
        : resolve(dist, 'index.html');
    const contentType =
      {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
      }[extname(file)] ?? 'application/octet-stream';
    return new Response(readFileSync(file), {
      headers: { 'Content-Type': contentType, 'Cache-Control': 'no-store' },
    });
  },
});
await new Promise((accept, reject) => {
  if (server.listening) accept();
  else server.once('listening', accept);
  server.once('error', reject);
});
// No credentials, authorization codes, cookies, request headers or bodies enter task logs.
console.log('IDENTITY_BROWSER_READY');
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  server.closeAllConnections();
  proxy.closeAllConnections();
  server.close();
  proxy.close();
  await runtime.database.close();
}
process.once('SIGTERM', () => {
  stop().catch(() => {
    process.exitCode = 1;
  });
});
process.once('SIGINT', () => {
  stop().catch(() => {
    process.exitCode = 1;
  });
});
