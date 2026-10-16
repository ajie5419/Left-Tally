import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { healthOpenApi } from '@gc/contracts';
import { businessOpenApi } from '../../apps/api/src/openapi.js';

test('bootstrap page handles real health, failure and recovery', async ({
  page,
  request,
  browser,
}, info) => {
  const base = process.env['GC_BROWSER_URL'];
  if (!base) throw new Error('Missing finite test server URL');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/engineering`);
  await expect(page.getByText('当前开放：工单新建与查看')).toBeVisible();
  await expect(page.getByRole('heading', { name: '工程状态' })).toBeVisible();
  await page.getByRole('button', { name: '检测健康接口' }).click();
  await expect(page.getByRole('status')).toHaveText('健康接口已响应');
  const response = await request.get(`${base}/health`);
  const body: unknown = await response.json();
  expect(body).toEqual({
    status: 'ok',
    phase: 'BOOTSTRAP',
    businessReady: false,
  });
  const documentation = await request.get(`${base}/openapi.json`);
  const published: unknown = await documentation.json();
  expect(documentation.status()).toBe(200);
  expect(published).toEqual(businessOpenApi);
  expect(businessOpenApi.paths['/health']).toEqual(
    healthOpenApi.paths['/health'],
  );
  console.log(
    JSON.stringify({
      project: info.project.name,
      browser: browser.version(),
      viewport: page.viewportSize(),
      url: base,
    }),
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: resolve(`evidence/bootstrap/${info.project.name}.png`),
    fullPage: true,
  });
  await page.route('**/health', (route) =>
    route.fulfill({ status: 503, body: '{}' }),
  );
  await page.getByRole('button', { name: '检测健康接口' }).click();
  await expect(page.getByRole('alert')).toContainText('未能确认服务状态');
  await expect(page.getByRole('status')).toHaveText('服务状态尚未确认');
  await page.unroute('**/health');
  await page.getByRole('button', { name: '检测健康接口' }).click();
  await expect(page.getByRole('status')).toHaveText('健康接口已响应');
  await page.reload();
  await expect(page.getByRole('status')).toHaveText('服务状态尚未确认');
  expect(errors).toEqual([]);
});
