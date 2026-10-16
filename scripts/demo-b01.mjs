import { withBusinessDatabase } from './business-database.mjs';
import { migrateBusinessDatabase } from './business-migrations.mjs';
import { startBusinessBrowser } from './business-browser.mjs';
import { allocatePort } from './database-isolation.mjs';

/** Explicit local demonstration; its database lives only for this process. */
await withBusinessDatabase(async (url) => {
  migrateBusinessDatabase(url);
  const { createLocalAuthDemo } =
    await import('../apps/api/dist/tests/support/local-auth-demo.js');
  const port = await allocatePort();
  const demo = await createLocalAuthDemo(url, `http://127.0.0.1:${port}`);
  const web = await startBusinessBrowser(demo, port);
  console.log(`B01_DEMO ${web.url}/work-orders`);
  console.log(
    `仅本次测试数据库：管理员 ${demo.credentials.admin.username} / ${demo.credentials.admin.password}；建单 ${demo.credentials.creator.username} / ${demo.credentials.creator.password}；只读 ${demo.credentials.reader.username} / ${demo.credentials.reader.password}。停止后数据删除。`,
  );
  try {
    await new Promise((accept) => {
      process.once('SIGINT', accept);
      process.once('SIGTERM', accept);
    });
  } finally {
    await web.close();
    await demo.database.close();
  }
});
