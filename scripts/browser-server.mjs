import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const require = createRequire(resolve('apps/api/package.json'));
const { serve } = require('@hono/node-server');
const { app } = await import('../apps/api/dist/apps/api/src/app.js');
const api = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
await new Promise((accept) => api.once('listening', accept));
const apiAddress = api.address();
if (!apiAddress || typeof apiAddress === 'string')
  throw new Error('Unknown API listener');
const root = resolve('apps/web/dist');
const contentTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
};
const web = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (['/health', '/openapi.json'].includes(pathname)) {
      const upstream = await fetch(
        `http://127.0.0.1:${apiAddress.port}${pathname}`,
      );
      response.writeHead(upstream.status, {
        'Content-Type': 'application/json',
      });
      response.end(await upstream.text());
      return;
    }
    const path = resolve(root, `.${decodeURIComponent(pathname)}`);
    if (!path.startsWith(`${root}${sep}`) && path !== root) {
      response.writeHead(403);
      response.end();
      return;
    }
    const file =
      path !== root && existsSync(path) ? path : resolve(root, 'index.html');
    response.writeHead(200, {
      'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream',
    });
    response.end(readFileSync(file));
  } catch (error) {
    console.error(error);
    response.writeHead(500);
    response.end('Test server failure');
  }
});
web.listen(0, '127.0.0.1');
await new Promise((accept) => web.once('listening', accept));
const address = web.address();
if (!address || typeof address === 'string')
  throw new Error('Unknown web listener');
console.log(
  `FINITE_BROWSER_SERVERS api=${apiAddress.port} web=${address.port}`,
);
const browserEnvironment = { ...process.env };
delete browserEnvironment.NO_COLOR;
delete browserEnvironment.FORCE_COLOR;
const child = spawn(
  'pnpm',
  ['exec', 'playwright', 'test', '--config', 'config/playwright.config.ts'],
  {
    stdio: 'inherit',
    env: {
      ...browserEnvironment,
      PLAYWRIGHT_BROWSERS_PATH:
        process.env.PLAYWRIGHT_BROWSERS_PATH ?? resolve('.tools/playwright'),
      GC_BROWSER_URL: `http://127.0.0.1:${address.port}`,
    },
  },
);
const timeout = setTimeout(() => child.kill('SIGTERM'), 120_000);
function cleanup() {
  child.kill('SIGTERM');
  web.close();
  api.close();
}
process.once('SIGTERM', cleanup);
process.once('SIGINT', cleanup);
const code = await new Promise((accept) => {
  child.once('error', (error) => {
    console.error(error);
    accept(1);
  });
  child.once('exit', (status) => accept(status ?? 1));
});
clearTimeout(timeout);
web.closeAllConnections();
await Promise.all([
  new Promise((accept) => web.close(accept)),
  new Promise((accept) => api.close(accept)),
]);
console.log('FINITE_BROWSER_SERVERS_CLEANED');
process.exitCode = code;
