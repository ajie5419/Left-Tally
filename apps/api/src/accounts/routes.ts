import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { CookieOptions } from 'hono/utils/cookie';
import {
  accountSchema,
  createAccountSchema,
  loginSchema,
  logoutSchema,
  ok,
  resetPasswordSchema,
  updateAccountActiveSchema,
  updateAccountPermissionsSchema,
  z,
} from '@gc/contracts';
import { BusinessException } from '../business-error.js';
import {
  assertWriteOrigin,
  verifiedPrincipal,
  type IdentityAdapter,
  type SessionOptions,
} from '../session.js';
import {
  LocalAccounts,
  LoginThrottle,
  principalFor,
  SESSION_LIFETIME_MS,
} from './service.js';
import { normalizeUsername } from './crypto.js';

const idSchema = z.uuid();

export interface LocalAuthOptions extends Omit<
  SessionOptions,
  'identity' | 'loginUrl'
> {
  accounts: LocalAccounts;
  insecureCookiesForTesting?: boolean;
}

function cookieSettings(options: LocalAuthOptions) {
  const secure = !options.insecureCookiesForTesting;
  const cookieOptions: CookieOptions = {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    path: '/',
  };
  return {
    name: secure ? '__Host-gc-session' : 'gc-session',
    options: cookieOptions,
  };
}

function sessionToken(context: Context, options: LocalAuthOptions) {
  const cookie = cookieSettings(options);
  return getCookie(context, cookie.name);
}

async function input<T extends z.ZodType>(context: Context, schema: T) {
  try {
    const parsed = schema.safeParse(await context.req.json());
    if (parsed.success) return parsed.data;
  } catch {
    // The same safe validation response covers malformed and extra input.
  }
  throw new BusinessException('VALIDATION_FAILED', '请求内容无效，请重新填写');
}

async function accountAdministrator(
  options: LocalAuthOptions,
  context: Context,
) {
  const actor = await verifiedPrincipal(
    {
      ...options,
      identity: localIdentity(options),
      loginUrl: '/api/auth/login',
    },
    context,
  );
  if (!actor?.accountAdmin)
    throw new BusinessException('FORBIDDEN', '仅账户管理员可以管理账户');
  return actor;
}

export function localIdentity(options: LocalAuthOptions): IdentityAdapter {
  return {
    resolve: (request) =>
      options.accounts.resolve(sessionTokenFromRequest(request, options)),
  };
}

function sessionTokenFromRequest(request: Request, options: LocalAuthOptions) {
  const name = cookieSettings(options).name;
  return request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

/** Local credentials and management endpoints; no QMS identity route is mounted here. */
export function localAuthRoutes(options: LocalAuthOptions) {
  return new Hono()
    .route('/', credentialRoutes(options))
    .route('/', accountManagementRoutes(options));
}

function guardedRoutes(options: LocalAuthOptions) {
  const routes = new Hono();
  routes.use('*', async (context, next) => {
    context.header('Cache-Control', 'no-store');
    assertWriteOrigin(options, context.req.raw);
    await next();
  });
  return routes;
}

function credentialRoutes(options: LocalAuthOptions) {
  const routes = guardedRoutes(options);
  const throttle = new LoginThrottle(options.now);
  const timestamp = () => new Date(options.now()).toISOString();
  routes.post('/auth/login', async (context) => {
    const parsed = await input(context, loginSchema);
    const key = normalizeUsername(parsed.username);
    if (!throttle.reserve(key))
      throw new BusinessException(
        'INVALID_CREDENTIALS',
        '用户名或密码不正确，请重试',
      );
    const result = await options.accounts.login(
      parsed.username,
      parsed.password,
    );
    if (!result) {
      throttle.failed(key);
      throw new BusinessException(
        'INVALID_CREDENTIALS',
        '用户名或密码不正确，请重试',
      );
    }
    throttle.succeeded(key);
    const cookie = cookieSettings(options);
    setCookie(context, cookie.name, result.token, {
      ...cookie.options,
      maxAge: Math.floor(SESSION_LIFETIME_MS / 1000),
    });
    return context.json(
      ok({ principal: principalFor(result.account) }, timestamp()),
    );
  });
  routes.post('/auth/logout', async (context) => {
    await input(context, logoutSchema);
    await options.accounts.logout(sessionToken(context, options));
    const cookie = cookieSettings(options);
    deleteCookie(context, cookie.name, cookie.options);
    return context.json(ok({ loggedOut: true }, timestamp()));
  });
  return routes;
}

function accountManagementRoutes(options: LocalAuthOptions) {
  const routes = guardedRoutes(options);
  const timestamp = () => new Date(options.now()).toISOString();
  routes.get('/accounts', async (context) => {
    await accountAdministrator(options, context);
    return context.json(
      ok(
        accountSchema.array().parse(await options.accounts.list()),
        timestamp(),
      ),
    );
  });
  routes.post('/accounts', async (context) => {
    await accountAdministrator(options, context);
    return context.json(
      ok(
        accountSchema.parse(
          await options.accounts.create(
            await input(context, createAccountSchema),
          ),
        ),
        timestamp(),
      ),
      201,
    );
  });
  routes.put('/accounts/:id/permissions', async (context) => {
    await accountAdministrator(options, context);
    const id = idSchema.safeParse(context.req.param('id'));
    if (!id.success)
      throw new BusinessException('VALIDATION_FAILED', '账户标识无效');
    return context.json(
      ok(
        accountSchema.parse(
          await options.accounts.updatePermissions(
            id.data,
            await input(context, updateAccountPermissionsSchema),
          ),
        ),
        timestamp(),
      ),
    );
  });
  routes.post('/accounts/:id/reset-password', async (context) => {
    await accountAdministrator(options, context);
    const id = idSchema.safeParse(context.req.param('id'));
    if (!id.success)
      throw new BusinessException('VALIDATION_FAILED', '账户标识无效');
    const body = await input(context, resetPasswordSchema);
    return context.json(
      ok(
        accountSchema.parse(
          await options.accounts.resetPassword(id.data, body.password),
        ),
        timestamp(),
      ),
    );
  });
  routes.put('/accounts/:id/active', async (context) => {
    await accountAdministrator(options, context);
    const id = idSchema.safeParse(context.req.param('id'));
    if (!id.success)
      throw new BusinessException('VALIDATION_FAILED', '账户标识无效');
    return context.json(
      ok(
        accountSchema.parse(
          await options.accounts.updateActive(
            id.data,
            await input(context, updateAccountActiveSchema),
          ),
        ),
        timestamp(),
      ),
    );
  });
  return routes;
}
