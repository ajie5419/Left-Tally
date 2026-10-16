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
