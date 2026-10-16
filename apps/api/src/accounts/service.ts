import { randomUUID } from 'node:crypto';
import type { LocalAccount, Prisma, PrismaClient } from '@prisma/client';
import type {
  Account,
  CreateAccount,
  Principal,
  UpdateAccountActive,
  UpdateAccountPermissions,
} from '@gc/contracts';
import { BusinessException } from '../business-error.js';
import {
  hashPassword,
  hashSessionToken,
  normalizeUsername,
  randomSessionToken,
  verifyPassword,
} from './crypto.js';

export const SESSION_LIFETIME_MS = 3_600_000;
const transactionOptions = {
  isolationLevel: 'Serializable',
} satisfies Parameters<PrismaClient['$transaction']>[1];

function permissions(
  account: Pick<LocalAccount, 'canRead' | 'canCreate'>,
): Principal['permissions'] {
  const result: Principal['permissions'] = [];
  if (account.canRead) result.push('work-orders:read');
  if (account.canCreate) result.push('work-orders:create');
  return result;
}

function accountDto(account: LocalAccount): Account {
  return {
    id: account.id,
    username: account.username,
    name: account.name,
    permissions: permissions(account),
    accountAdmin: account.accountAdmin,
    active: account.active,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

export function principalFor(account: LocalAccount): Principal {
  return {
    id: account.id,
    name: account.name,
    permissions: permissions(account),
    accountAdmin: account.accountAdmin,
  };
}

function toPermissions(input: { permissions: readonly string[] }) {
  const canCreate = input.permissions.includes('work-orders:create');
  return {
    canCreate,
    canRead: canCreate || input.permissions.includes('work-orders:read'),
  };
}

function persistenceFailure() {
  return new BusinessException(
    'SOURCE_UNAVAILABLE',
    '账户服务暂时不可用，请重试',
  );
}

/** Test-only synchronization preserves real persistence while making a race reproducible. */
interface LocalAccountHooks {
  onLoginAccountLoaded?(account: LocalAccount | null): Promise<void>;
}

export class LoginThrottle {
  private readonly failures = new Map<
    string,
    { count: number; until: number }
  >();
  constructor(
    private readonly now: () => number,
    private readonly maximum = 5,
    private readonly intervalMs = 60_000,
  ) {}
  allowed(key: string) {
    const state = this.failures.get(key);
    if (!state) return true;
    if (state.until <= this.now()) {
      this.failures.delete(key);
      return true;
    }
    return state.count < this.maximum;
  }
  failed(key: string) {
    const previous = this.failures.get(key);
    const state = {
      count: previous && previous.until > this.now() ? previous.count + 1 : 1,
      until: this.now() + this.intervalMs,
    };
    this.failures.set(key, state);
    while (this.failures.size > 1024) {
      const first = this.failures.keys().next();
      if (!first.done) this.failures.delete(first.value);
    }
  }
  succeeded(key: string) {
    this.failures.delete(key);
  }
}

export class LocalAccounts {
  constructor(
    private readonly db: PrismaClient,
    private readonly now: () => number = Date.now,
    private readonly newId: () => string = randomUUID,
    private readonly hooks?: LocalAccountHooks,
  ) {}

  async resolve(token: string | undefined): Promise<Principal | null> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    try {
      const session = await this.db.localSession.findUnique({
        where: { idHash: hashSessionToken(token) },
        include: { account: true },
      });
      if (!session) return null;
      if (
        session.expiresAt.getTime() <= this.now() ||
        !session.account.active ||
        session.authVersion !== session.account.authVersion
      ) {
        await this.db.localSession.deleteMany({
          where: { idHash: session.idHash },
        });
        return null;
      }
      return principalFor(session.account);
    } catch {
      throw persistenceFailure();
    }
  }

  async login(username: string, password: string) {
    const normalized = normalizeUsername(username);
    let account: LocalAccount | null;
    try {
      account = await this.db.localAccount.findUnique({
        where: { usernameNormalized: normalized },
      });
    } catch {
      throw persistenceFailure();
    }
    await this.hooks?.onLoginAccountLoaded?.(account);
    if (
      !account ||
      !account.active ||
      !(await verifyPassword(password, account.passwordHash))
    )
      return null;
    const token = randomSessionToken();
    try {
      const session = await this.transaction(async (tx) => {
        const changed = await tx.localAccount.updateMany({
          where: {
            id: account.id,
            active: true,
            authVersion: account.authVersion,
          },
          data: { authVersion: { increment: 1 } },
        });
        if (changed.count !== 1) return null;
        const current = await tx.localAccount.findUniqueOrThrow({
          where: { id: account.id },
        });
        await tx.localSession.deleteMany({ where: { accountId: account.id } });
        const expiresAt = new Date(this.now() + SESSION_LIFETIME_MS);
        await tx.localSession.create({
          data: {
            idHash: hashSessionToken(token),
            accountId: account.id,
            authVersion: current.authVersion,
            expiresAt,
          },
        });
        return { account: current, expiresAt };
      });
      return session ? { ...session, token } : null;
    } catch {
      throw persistenceFailure();
    }
  }

  async logout(token: string | undefined) {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    try {
      await this.db.localSession.deleteMany({
        where: { idHash: hashSessionToken(token) },
      });
    } catch {
      throw persistenceFailure();
    }
  }

  async list() {
    try {
      return (
        await this.db.localAccount.findMany({
          orderBy: { usernameNormalized: 'asc' },
        })
      ).map(accountDto);
    } catch {
      throw persistenceFailure();
    }
  }

  async create(input: CreateAccount) {
    const permissionsInput = toPermissions(input);
    try {
      return accountDto(
        await this.db.localAccount.create({
          data: {
            id: this.newId(),
            username: input.username,
            usernameNormalized: normalizeUsername(input.username),
            name: input.name,
            passwordHash: await hashPassword(input.password),
            accountAdmin: input.accountAdmin,
            ...permissionsInput,
          },
        }),
      );
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'P2002'
      )
        throw new BusinessException('ACCOUNT_USERNAME_EXISTS', '用户名已存在');
      throw persistenceFailure();
    }
  }

  async updatePermissions(id: string, input: UpdateAccountPermissions) {
    return this.updateAdminSensitive(id, input.accountAdmin, async (tx) =>
      tx.localAccount.update({
        where: { id },
        data: {
          ...toPermissions(input),
          accountAdmin: input.accountAdmin,
          authVersion: { increment: 1 },
        },
      }),
    );
  }

  async updateActive(id: string, input: UpdateAccountActive) {
    return this.updateAdminSensitive(id, input.active, async (tx) =>
      tx.localAccount.update({
        where: { id },
        data: { active: input.active, authVersion: { increment: 1 } },
      }),
    );
  }

  async resetPassword(id: string, password: string) {
    try {
      return accountDto(
        await this.transaction(async (tx) => {
          const account = await tx.localAccount.update({
            where: { id },
            data: {
              passwordHash: await hashPassword(password),
              authVersion: { increment: 1 },
            },
          });
          await tx.localSession.deleteMany({ where: { accountId: id } });
          return account;
        }),
      );
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'P2025'
      )
        throw new BusinessException('NOT_FOUND', '账户不存在');
      throw persistenceFailure();
    }
  }

  private async updateAdminSensitive(
    id: string,
    remainsEligible: boolean,
    change: (tx: Prisma.TransactionClient) => Promise<LocalAccount>,
  ) {
    try {
      return accountDto(
        await this.transaction(async (tx) => {
          const existing = await tx.localAccount.findUnique({ where: { id } });
          if (!existing) throw new BusinessException('NOT_FOUND', '账户不存在');
          if (existing.active && existing.accountAdmin && !remainsEligible) {
            const count = await tx.localAccount.count({
              where: { active: true, accountAdmin: true },
            });
            if (count <= 1)
              throw new BusinessException(
                'ACCOUNT_LAST_ADMIN',
                '必须保留至少一个启用的账户管理员',
              );
          }
          const account = await change(tx);
          await tx.localSession.deleteMany({ where: { accountId: id } });
          return account;
        }),
      );
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      throw persistenceFailure();
    }
  }

  private async transaction<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.db.$transaction(operation, transactionOptions);
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'P2034' &&
          attempt < 2
        )
          continue;
        throw error;
      }
    }
    throw new Error('TRANSACTION_RETRY_EXHAUSTED');
  }
}
