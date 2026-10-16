import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { demoLoginSchema, ok } from '@gc/contracts';
import { BusinessException } from '../../../business-error.js';
import type { SessionOptions } from '../../../session.js';
import { assertWriteOrigin } from '../../../session.js';
import type { DemoSessions } from './demo-sessions.js';

/** Only the demonstration composition imports these routes. */
export function demoLoginRoutes(
  sessions: DemoSessions,
  options: SessionOptions,
) {
  const routes = new Hono();
  routes.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    assertWriteOrigin(options, c.req.raw);
    await next();
  });
  routes.get('/demo/identities', (c) =>
    c.json(ok(sessions.identities, new Date(options.now()).toISOString())),
  );
  routes.post('/demo/session', async (c) => {
    let input: unknown;
    try {
      input = await c.req.json();
    } catch {
      throw new BusinessException('VALIDATION_FAILED', '请求内容无效');
    }
    const parsed = demoLoginSchema.safeParse(input);
    if (!parsed.success)
      throw new BusinessException('VALIDATION_FAILED', '请选择演示身份');
    const { token, identity } = sessions.login(
      parsed.data.identityId,
      getCookie(c, 'gc_demo_session'),
    );
    setCookie(c, 'gc_demo_session', token, {
      httpOnly: true,
      sameSite: 'Strict',
      path: '/api',
      maxAge: 3600,
    });
    return c.json(ok(identity, new Date(options.now()).toISOString()));
  });
  return routes;
}
