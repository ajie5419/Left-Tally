import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createConnection } from 'mysql2/promise';
import { withBusinessDatabase } from './business-database.mjs';
import { migrateBusinessDatabase } from './business-migrations.mjs';
import { startBusinessBrowser } from './business-browser.mjs';
import { allocatePort } from './database-isolation.mjs';

await withBusinessDatabase(async (url) => {
  migrateBusinessDatabase(url);
  const { createLocalAuthDemo } =
    await import('../apps/api/dist/tests/support/local-auth-demo.js');
  const port = await allocatePort();
  const demo = await createLocalAuthDemo(url, `http://127.0.0.1:${port}`);
  const web = await startBusinessBrowser(demo, port);
  try {
    const environment = { ...process.env };
    delete environment.NO_COLOR;
    delete environment.FORCE_COLOR;
    for (const project of ['desktop', 'mobile']) {
      const connection = await createConnection(url);
      try {
        await connection.query('DELETE FROM WorkOrder');
      } finally {
        await connection.end();
      }
      const child = spawn(
        'pnpm',
        [
          'exec',
          'playwright',
          'test',
          '--config',
          'config/playwright.config.ts',
          '--project',
          project,
        ],
        {
          stdio: 'inherit',
          env: {
            ...environment,
            PLAYWRIGHT_BROWSERS_PATH:
              process.env.PLAYWRIGHT_BROWSERS_PATH ??
              resolve('.tools/playwright'),
            GC_BROWSER_URL: web.url,
            GC_BROWSER_PROJECT: project,
            GC_DEMO_ADMIN: demo.credentials.admin.username,
            GC_DEMO_ADMIN_PASSWORD: demo.credentials.admin.password,
            GC_DEMO_CREATOR: demo.credentials.creator.username,
            GC_DEMO_CREATOR_PASSWORD: demo.credentials.creator.password,
            GC_DEMO_READER: demo.credentials.reader.username,
            GC_DEMO_READER_PASSWORD: demo.credentials.reader.password,
          },
        },
      );
      const timeout = setTimeout(() => child.kill('SIGTERM'), 120_000);
      const code = await new Promise((accept, reject) => {
        child.once('error', reject);
        child.once('exit', (status) => accept(status ?? 1));
      }).finally(() => clearTimeout(timeout));
      if (code !== 0) throw new Error(`BROWSER_TEST_FAILED exit=${code}`);
    }
    const reports = ['desktop', 'mobile'].map((project) =>
      JSON.parse(
        readFileSync(`evidence/bootstrap/browser-${project}.json`, 'utf8'),
      ),
    );
    const stats = { expected: 0, unexpected: 0, skipped: 0, flaky: 0 };
    for (const report of reports)
      for (const key of Object.keys(stats)) stats[key] += report.stats[key];
    writeFileSync(
      'evidence/bootstrap/browser-results.json',
      JSON.stringify(
        { stats, suites: reports.flatMap((report) => report.suites) },
        null,
        2,
      ) + '\n',
    );
  } finally {
    await web.close();
    await demo.database.close();
    console.log('FINITE_BROWSER_SERVERS_CLEANED');
  }
});
