import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
const types = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
};
export async function startBusinessBrowser(demo, port = 0) {
  const root = resolve('apps/web/dist');
  const web = createServer(async (request, response) => {
    try {
      const base = `http://127.0.0.1:${address.port}`;
      const url = new URL(request.url, base);
      if (
        url.pathname.startsWith('/api/') ||
        ['/health', '/openapi.json'].includes(url.pathname)
      ) {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        const headers = new Headers();
        for (const name of ['cookie', 'origin', 'content-type'])
          if (typeof request.headers[name] === 'string')
            headers.set(name, request.headers[name]);
        const upstream = await demo.app.request(url.href, {
          method: request.method,
          headers,
          ...(body.length ? { body } : {}),
        });
        const outgoing = Object.fromEntries(upstream.headers);
        const cookies = upstream.headers.getSetCookie();
        response.writeHead(upstream.status, {
          ...outgoing,
          ...(cookies.length ? { 'set-cookie': cookies } : {}),
        });
        response.end(await upstream.text());
        return;
      }
      const path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
      if (!path.startsWith(`${root}${sep}`) && path !== root) {
        response.writeHead(403).end();
        return;
      }
      const file =
        path !== root && existsSync(path) ? path : resolve(root, 'index.html');
      response.writeHead(200, {
        'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      });
      response.end(readFileSync(file));
    } catch {
      response.writeHead(500).end('Demonstration request failed');
    }
  });
  await new Promise((accept, reject) => {
    web.once('error', reject);
    web.listen(port, '127.0.0.1', accept);
  });
  const address = web.address();
  if (!address || typeof address === 'string')
    throw new Error('Unknown browser listener');
  return {
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      web.closeAllConnections();
      await new Promise((accept) => web.close(accept));
    },
  };
}
