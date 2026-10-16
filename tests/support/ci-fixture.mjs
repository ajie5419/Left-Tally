import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  cpSync,
  rmSync,
  realpathSync,
} from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { sourceSnapshot } from '../../scripts/ci/snapshot.mjs';

const [directory, scenario = 'normal'] = process.argv.slice(2);
if (!directory) throw new Error('Missing isolated fixture directory');
const snapshot = sourceSnapshot();
for (const path of Object.keys(snapshot)) {
  mkdirSync(dirname(join(directory, path)), { recursive: true });
  cpSync(path, join(directory, path));
}
function put(path, value) {
  mkdirSync(dirname(join(directory, path)), { recursive: true });
  writeFileSync(join(directory, path), JSON.stringify(value, null, 2) + '\n');
}
const required = JSON.parse(readFileSync('config/bootstrap.json', 'utf8'));
const unitNames = required.suites.filter((path) =>
  path.startsWith('tests/unit/'),
);
const units = {
  numTotalTests: unitNames.length,
  numPassedTests: unitNames.length,
  numPendingTests: 0,
  testResults: unitNames.map((path) => ({
    name: resolve(realpathSync(directory), path),
    assertionResults: [{ status: 'passed' }],
  })),
};
const report = {
  phase: 'CORE',
  environmentValid: true,
  node: '24.21.0',
  pnpm: '10.28.2',
  gitCommit: process.env.GITHUB_SHA ?? null,
  requestedCICommit: process.env.GITHUB_SHA ?? null,
  sourceChangedDuringVerification: [],
  sourceHashFile: 'evidence/bootstrap/verify/source-sha256.json',
  results: required.required.map((task) => ({
    task,
    exitCode: 0,
    signal: null,
    log: `evidence/bootstrap/verify/${task.replace(':', '-')}.log`,
  })),
};
// These deliberately artificial artifacts exercise a checker, never claim a runtime acceptance.
for (const result of report.results) {
  mkdirSync(dirname(join(directory, result.log)), { recursive: true });
  writeFileSync(
    join(directory, result.log),
    'ISOLATED CHECKER INPUT FIXTURE; NOT A REAL EXECUTION\n',
  );
}
const browser = { stats: { expected: 8, unexpected: 0, skipped: 0, flaky: 0 } };
if (scenario === 'failed-task') report.results[0].exitCode = 1;
if (scenario === 'missing-task') report.results.shift();
if (scenario === 'skip-unit') units.numPendingTests = 1;
if (scenario === 'skip-browser') browser.stats.skipped = 1;
put('evidence/bootstrap/unit-results.json', units);
put('evidence/bootstrap/browser-results.json', browser);
put('evidence/bootstrap/negative/results.json', {
  passed: true,
  completed: true,
  cleaned: true,
  records: JSON.parse(
    readFileSync('config/ci/expected-negatives.json', 'utf8'),
  ).map((id) => ({ id, valid: true })),
});
put('evidence/bootstrap/database-probe.json', {
  exitCode: 0,
  containersCreated: true,
  databaseConnected: true,
  probeVerified: true,
  isolationVerified: true,
  cleanupVerified: true,
  portClosed: true,
  faultControl: false,
  sourceSha256: Object.fromEntries(
    [
      'scripts/database.mjs',
      'scripts/database-isolation.mjs',
      'scripts/database-backend.mjs',
      'config/database-probe.json',
    ].map((path) => [path, snapshot[path]]),
  ),
  query: { result: [{ version: '8.4.fixture', engine: 'InnoDB' }] },
});
put(report.sourceHashFile, snapshot);
put('evidence/bootstrap/verify/results.json', report);
put('evidence/bootstrap/business-migrations.json', {
  applicability: 'INITIAL_BUSINESS_SCHEMA_NO_PREVIOUS_BUSINESS_DELIVERY',
  migrationExecuted: true,
  schemaFound: true,
  previousDeliveryFound: false,
});
if (scenario === 'missing-result')
  rmSync(join(directory, 'evidence/bootstrap/verify/results.json'));
if (scenario === 'delete-unit-artifact')
  rmSync(join(directory, 'evidence/bootstrap/unit-results.json'));
if (scenario === 'delete-log') rmSync(join(directory, report.results[0].log));
if (scenario === 'missing-suite')
  rmSync(join(directory, 'tests/unit/health.test.ts'));
if (scenario === 'source-change')
  writeFileSync(
    join(directory, 'apps/web/src/main.ts'),
    'export const changed = true;\n',
  );
if (scenario === 'source-add')
  writeFileSync(
    join(directory, 'apps/web/src/added.ts'),
    'export const added = true;\n',
  );
