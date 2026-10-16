import { test, expect } from '@playwright/test';

function credentials(role: 'ADMIN' | 'CREATOR' | 'READER') {
  const username = process.env[`GC_DEMO_${role}`];
  const password = process.env[`GC_DEMO_${role}_PASSWORD`];
  if (!username || !password)
    throw new Error('Missing isolated browser credentials');
  return { username, password };
}
async function login(
  page: import('@playwright/test').Page,
  role: 'ADMIN' | 'CREATOR' | 'READER',
) {
  const base = process.env.GC_BROWSER_URL;
  if (!base) throw new Error('Missing finite browser server');
  const user = credentials(role);
  await page.goto(`${base}/work-orders`);
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('账号').fill(user.username);
  await page.getByLabel('密码').fill(user.password);
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page).toHaveURL(/\/work-orders$/);
}

test('B01 creator logs in, creates two equipment orders and sees own name', async ({
  page,
}) => {
  await login(page, 'CREATOR');
  await expect(page.getByText('当前登录：演示项目建单员')).toBeVisible();
  const orders: Array<[string, string]> = [
    ['GC-LOCAL-01', '2026-11-20'],
    ['GC-LOCAL-02', '2026-11-25'],
  ];
  for (const [number, dueDate] of orders) {
    await page.getByLabel('工单号（必填）', { exact: true }).fill(number);
    await page.getByLabel('客户名称（必填）').fill('示例客户');
    await page.getByLabel('交期（必填）').fill(dueDate);
    await page.getByRole('button', { name: '保存工单' }).click();
    await expect(
      page.getByRole('list', { name: '设备工单' }).getByText(number),
    ).toBeVisible();
  }
  await expect(page.getByText('待生产部指定').first()).toBeVisible();
  const calls: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/demo')) calls.push(request.url());
  });
  await page.reload();
  await expect(
    page.getByRole('list', { name: '设备工单' }).getByRole('listitem'),
  ).toHaveCount(2);
  expect(calls).toEqual([]);
});

test('wrong credentials retry, reader cannot create, and logout blocks access', async ({
  page,
}) => {
  const base = process.env.GC_BROWSER_URL;
  if (!base) throw new Error('Missing finite browser server');
  await page.goto(`${base}/login`);
  await page.getByLabel('账号').fill('not-an-account');
  await page.getByLabel('密码').fill('not-a-valid-password');
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page.getByRole('alert')).toContainText('用户名或密码不正确');
  const reader = credentials('READER');
  await page.getByLabel('账号').fill(reader.username);
  await page.getByLabel('密码').fill(reader.password);
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await expect(page.getByRole('button', { name: '保存工单' })).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      fetch('/api/work-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }).then((response) => response.status),
    ),
  ).toBe(403);
  await page.getByRole('button', { name: '退出履约系统' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto(`${base}/work-orders`);
  await expect(page).toHaveURL(/\/login$/);
});

test('administrator manages an account and is not granted work order access automatically', async ({
  page,
}, info) => {
  await login(page, 'ADMIN');
  const base = process.env.GC_BROWSER_URL;
  if (!base) throw new Error('Missing finite browser server');
  await page.goto(`${base}/accounts`);
  await expect(
    page.getByRole('heading', { name: '账户管理', exact: true }),
  ).toBeVisible();
  await page.getByLabel('账号').fill(`demo.reader.${info.project.name}`);
  await page.getByLabel('姓名').fill('新建只读人员');
  await page.getByLabel('初始密码').fill('New-demo-password-2026');
  await page.getByRole('button', { name: '创建账户' }).click();
  await expect(page.getByRole('status')).toContainText('账户已创建');
  await page.goto(`${base}/work-orders`);
  await expect(
    page.getByText('尚未获得履约工单库的查看或建单权限'),
  ).toBeVisible();
});
