import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';
import { z } from '@gc/contracts';
import {
  workOrderRequest,
  WorkOrderRequestError,
} from '../../apps/web/src/work-order-api.js';
import { useWorkOrderStore } from '../../apps/web/src/work-order-store.js';

const webRequire = createRequire(
  new URL('../../apps/web/package.json', import.meta.url),
);
const { createPinia } = z
  .object({
    createPinia: z.custom<() => Parameters<typeof useWorkOrderStore>[0]>(
      (value) => typeof value === 'function',
    ),
  })
  .parse(webRequire('pinia'));
afterEach(() => vi.unstubAllGlobals());

it('reports HTML proxy responses in Chinese while retaining the actual HTTP status', async () => {
  for (const status of [502, 504]) {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response('<html>Bad Gateway</html>', { status })),
    );
    await expect(
      workOrderRequest('/session', z.unknown()),
    ).rejects.toMatchObject({
      status,
      unavailable: true,
      message: '服务暂时不可用，请稍后重试。',
    });
  }
});
it('reports network and successful non-JSON protocol failures without native parser messages', async () => {
  vi.stubGlobal('fetch', () =>
    Promise.reject(new TypeError('Failed to fetch')),
  );
  await expect(workOrderRequest('/session', z.unknown())).rejects.toMatchObject(
    {
      status: 0,
      unavailable: true,
      message: '服务连接失败，请检查网络后重试。',
    },
  );
  vi.stubGlobal('fetch', () =>
    Promise.resolve(new Response('<html>proxy</html>')),
  );
  await expect(
    workOrderRequest('/session', z.unknown()),
  ).rejects.toBeInstanceOf(WorkOrderRequestError);
});
it('clears the actionable identity and previous orders after refresh and create transport failures', async () => {
  const store = useWorkOrderStore(createPinia());
  const seed = () => {
    store.mode = 'production';
    store.identity = {
      id: 'previous',
      name: 'Previous',
      permissions: ['work-orders:read', 'work-orders:create'],
    };
    store.orders = [
      {
        id: '00000000-0000-4000-8000-000000000001',
        number: 'OLD',
        customer: 'Previous',
        quantity: 1,
        dueDate: '2026-11-20',
        project: null,
        division: null,
        productionLeadId: null,
        createdAt: '2026-10-15T00:00:00.000Z',
      },
    ];
  };
  seed();
  vi.stubGlobal('fetch', () =>
    Promise.resolve(
      new Response('<html>Gateway Timeout</html>', { status: 504 }),
    ),
  );
  await store.refresh();
  expect(store.identity).toBeNull();
  expect(store.orders).toHaveLength(0);
  expect(store.error).toBe('服务暂时不可用，请稍后重试。');
  seed();
  vi.stubGlobal('fetch', () =>
    Promise.reject(new TypeError('Failed to fetch')),
  );
  await store.create({
    number: 'N',
    customer: 'C',
    quantity: 1,
    dueDate: '2026-11-20',
    project: null,
    division: null,
  });
  expect(store.identity).toBeNull();
  expect(store.orders).toHaveLength(0);
  expect(store.error).toBe('服务连接失败，请检查网络后重试。');
});
it('translates local schema failures during login to user-facing error message', async () => {
  const store = useWorkOrderStore(createPinia());
  await store.login('ab', 'short');
  expect(store.error).toBe('用户名或密码不正确，请重试');
});
it('preserves orders and identity when personnel lookup fails after orders load', async () => {
  const store = useWorkOrderStore(createPinia());
  store.mode = 'production';
  store.identity = {
    id: 'creator',
    name: 'Creator',
    permissions: ['work-orders:read'],
  };
  vi.stubGlobal('fetch', (input: unknown) => {
    const target =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input instanceof Request
            ? input.url
            : '';
    if (target.includes('/work-orders/sources')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            success: false,
            error: { code: 'UNAVAILABLE', message: 'Personnel service down' },
            timestamp: new Date().toISOString(),
          }),
          { status: 503, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          success: true,
          data: [
            {
              id: '00000000-0000-4000-8000-000000000001',
              number: 'GC-01',
              customer: 'Test',
              quantity: 1,
              dueDate: '2026-11-20',
              project: null,
              division: null,
              productionLeadId: 'lead-1',
              createdAt: '2026-10-15T00:00:00.000Z',
            },
          ],
          timestamp: new Date().toISOString(),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
  });
  await store.refresh();
  expect(store.identity).not.toBeNull();
  expect(store.orders).toHaveLength(1);
  expect(store.orders[0]?.number).toBe('GC-01');
});
