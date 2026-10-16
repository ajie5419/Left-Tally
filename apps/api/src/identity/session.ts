import type { PrismaClient } from '@prisma/client';
import type { RuntimeConfig } from '../runtime-config.js';
import type { IdentityAdapter } from '../session.js';
import type { IdentityConfig } from './upstream.js';
import type { CookieOptions } from 'hono/utils/cookie';
import { timingSafeEqual } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { z, ok } from '@gc/contracts';
import { BusinessException } from '../business-error.js';
import { assertWriteOrigin } from '../session.js';
import {
  identityCipher,
  randomToken,
  hashToken,
  challengeFor,
} from './crypto.js';
import { qmsIdentity, InvalidIdentity } from './upstream.js';

const flowSchema = z
  .object({ state: z.string(), verifier: z.string(), expiresAt: z.number() })
  .strict();
function identityContext(
  db: PrismaClient,
  runtime: RuntimeConfig,
  config: IdentityConfig,
) {
  const secure = new URL(runtime.publicOrigin).protocol === 'https:';
  const cookieOptions: CookieOptions = {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    path: '/',
  };
  return {
    db,
    runtime,
    config,
    cookieOptions,
    cipher: identityCipher(config.encryptionKey),
    qms: qmsIdentity(config),
    names: {
      session: secure ? '__Host-gc-session' : 'gc-session',
      flow: secure ? '__Host-gc-login' : 'gc-login',
    },
    callback: `${runtime.publicOrigin}/api/auth/callback`,
  };
}
type IdentityContext = ReturnType<typeof identityContext>;
function stored(env: IdentityContext, request: Request) {
  const match = request.headers
    .get('cookie')
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${env.names.session}=`));
  const value = match?.slice(env.names.session.length + 1);
  return value && /^[\w-]{43}$/.test(value)
    ? env.db.identitySession.findUnique({ where: { idHash: hashToken(value) } })
    : Promise.resolve(null);
}
async function resolvePrincipal(env: IdentityContext, request: Request) {
  const record = await stored(env, request);
  if (!record) return null;
  if (record.expiresAt.getTime() <= Date.now()) {
    await env.db.identitySession.deleteMany({
      where: { idHash: record.idHash },
    });
    return null;
  }
  try {
    const person = await env.qms.identity(
      env.cipher.open(record.credential, 'credential'),
    );
    return {
      id: person.id,
      name: person.name,
      permissions: Object.hasOwn(env.config.permissions, person.id)
        ? (env.config.permissions[person.id] ?? [])
        : [],
    };
  } catch (error) {
    if (!(error instanceof InvalidIdentity)) throw error;
    await env.db.identitySession.deleteMany({
      where: { idHash: record.idHash },
    });
    return null;
  }
}
/** Local deletion happens first so an upstream outage cannot keep the GC session alive. */
async function retire(env: IdentityContext, request: Request) {
  const record = await stored(env, request);
  if (!record) return true;
  await env.db.identitySession.deleteMany({ where: { idHash: record.idHash } });
  try {
    await env.qms.revoke(env.cipher.open(record.credential, 'credential'));
    return true;
  } catch {
    return false;
  }
}
function beginLogin(env: IdentityContext, context: Context) {
  const state = randomToken();
  const verifier = randomToken();
  const flow = { state, verifier, expiresAt: Date.now() + 300_000 };
  setCookie(
    context,
    env.names.flow,
    env.cipher.seal(JSON.stringify(flow), 'flow'),
    { ...env.cookieOptions, maxAge: 300 },
  );
  const url = new URL(env.runtime.loginUrl ?? 'https://invalid.local');
  const params = new URLSearchParams({
    clientId: env.config.clientId,
    redirectUri: env.callback,
    state,
    challenge: challengeFor(verifier),
    method: 'S256',
  });
  if (url.hash) url.hash = `/identity/authorize?${params}`;
  else url.search = params.toString();
  return context.redirect(url.href, 303);
}
function verifyFlow(env: IdentityContext, context: Context) {
  const cookie = getCookie(context, env.names.flow);
  deleteCookie(context, env.names.flow, env.cookieOptions);
  try {
    const decoded: unknown = JSON.parse(env.cipher.open(cookie ?? '', 'flow'));
    const flow = flowSchema.parse(decoded);
    const state =
      z
        .array(z.string().regex(/^[\w-]{43}$/))
        .length(1)
        .parse(context.req.queries('state'))[0] ?? '';
    const code = z
      .array(z.string().regex(/^[\w-]{43}$/))
      .length(1)
      .parse(context.req.queries('code'))[0];
    const sameState = timingSafeEqual(
      Buffer.from(hashToken(state)),
      Buffer.from(hashToken(flow.state)),
    );
    if (flow.expiresAt <= Date.now() || !sameState || !code)
      throw new Error('INVALID_FLOW');
    return { flow, code };
  } catch {
    throw new BusinessException('FORBIDDEN', '登录请求已失效，请重新登录');
  }
}
async function finishLogin(env: IdentityContext, context: Context) {
  const { flow, code } = verifyFlow(env, context);
  let issuedCredential: string | undefined;
  try {
    const grant = await env.qms.exchange({
      code,
      verifier: flow.verifier,
      redirectUri: env.callback,
    });
    issuedCredential = grant.credential;
    await env.qms.identity(grant.credential);
    const expiresAt = new Date(
      Math.min(Date.parse(grant.expiresAt), Date.now() + 3_600_000),
    );
    if (expiresAt.getTime() <= Date.now()) throw new InvalidIdentity();
    await retire(env, context.req.raw);
    deleteCookie(context, env.names.session, env.cookieOptions);
    const id = randomToken();
    await env.db.identitySession.create({
      data: {
        idHash: hashToken(id),
        credential: env.cipher.seal(grant.credential, 'credential'),
        expiresAt,
      },
    });
    setCookie(context, env.names.session, id, {
      ...env.cookieOptions,
      maxAge: Math.max(
        1,
        Math.floor((expiresAt.getTime() - Date.now()) / 1000),
      ),
    });
    return context.redirect('/work-orders', 303);
  } catch (error) {
    // Failed local persistence must not leave a usable grant when revocation is reachable.
    if (issuedCredential)
      await env.qms.revoke(issuedCredential).catch(() => null);
    if (error instanceof InvalidIdentity)
      throw new BusinessException('FORBIDDEN', '登录授权已失效，请重新登录');
    throw new BusinessException(
      'SOURCE_UNAVAILABLE',
      '无法完成登录，请稍后重新登录',
    );
  }
}
async function logout(
  env: IdentityContext,
  identity: IdentityAdapter,
  context: Context,
) {
  assertWriteOrigin(
    {
      publicOrigin: env.runtime.publicOrigin,
    },
    context.req.raw,
  );
  try {
    const upstreamRevoked = await retire(env, context.req.raw);
    deleteCookie(context, env.names.session, env.cookieOptions);
    deleteCookie(context, env.names.flow, env.cookieOptions);
    return context.json(ok({ upstreamRevoked }, new Date().toISOString()));
  } catch {
    throw new BusinessException(
      'SOURCE_UNAVAILABLE',
      '无法确认本地会话撤销，请重试退出',
    );
  }
}
export function persistentIdentity(
  db: PrismaClient,
  runtime: RuntimeConfig,
  config: IdentityConfig,
) {
  const env = identityContext(db, runtime, config);
  const identity: IdentityAdapter = {
    resolve: (request) => resolvePrincipal(env, request),
  };
  const routes = new Hono();
  routes.use('/auth/*', async (context, next) => {
    context.header('Cache-Control', 'no-store');
    context.header('Referrer-Policy', 'no-referrer');
    await next();
  });
  routes.get('/auth/login', (context) => beginLogin(env, context));
  routes.get('/auth/callback', (context) => finishLogin(env, context));
  routes.post('/auth/logout', (context) => logout(env, identity, context));
  return { identity, routes };
}
