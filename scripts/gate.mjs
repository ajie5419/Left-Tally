import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { files, disabledTests } from './files.mjs';

const baseline = {
  'AGENTS.md':
    '0da12ca487f847733db1bb8a47775a094cbb537c5b1a2f993f98b0651cc596ce',
  'Grand Comptroller/工程治理与门禁基线-2026-10-13.md':
    '33439620e6f87bcb1ea880d1929a07df4dc0278e5054c51513bef5ab885c19e0',
};
const required = [
  'check:static',
  'test:unit',
  'build',
  'test:integration',
  'check:migrations',
  'test:negative',
  'test:e2e',
];
const manifest = JSON.parse(readFileSync('config/bootstrap.json', 'utf8'));
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const errors = [];
if (
  manifest.phase !== 'BOOTSTRAP' ||
  JSON.stringify(manifest.required) !== JSON.stringify(required)
) {
  errors.push('REQUIRED_MANIFEST_CHANGED');
}
for (const task of [...required, 'check:gate', 'verify']) {
  if (!packageJson.scripts[task]?.trim())
    errors.push(`REQUIRED_TASK_MISSING: ${task}`);
}
for (const path of [
  'tests/unit/health.test.ts',
  'tests/unit/scanner.test.ts',
  'tests/unit/database-isolation.test.ts',
  'tests/e2e/bootstrap.spec.ts',
  'scripts/negative.mjs',
  'scripts/database.mjs',
]) {
  if (!existsSync(path) || !readFileSync(path, 'utf8').trim())
    errors.push(`REQUIRED_SUITE_MISSING: ${path}`);
}
for (const [path, expected] of Object.entries(baseline)) {
  if (
    createHash('sha256').update(readFileSync(path)).digest('hex') !== expected
  )
    errors.push(`GOVERNANCE_HASH_CHANGED: ${path}`);
}
const opening = JSON.parse(
  readFileSync('evidence/bootstrap/opening-sha256.json', 'utf8'),
);
for (const [path, hash] of Object.entries(opening)) {
  if (
    !existsSync(path) ||
    createHash('sha256').update(readFileSync(path)).digest('hex') !== hash
  )
    errors.push(`OLD_FILE_CHANGED: ${path}`);
}
for (const path of files(['tests'], ['.ts'])) {
  errors.push(...disabledTests(path, readFileSync(path, 'utf8')));
}
const argument = process.argv.indexOf('--results');
if (argument !== -1) {
  const reportPath = process.argv[argument + 1];
  if (!reportPath || !existsSync(reportPath))
    errors.push('REQUIRED_REPORT_MISSING');
  else {
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    for (const task of required) {
      const result = Array.isArray(report.results)
        ? report.results.filter((entry) => entry.task === task)
        : [];
      if (result.length !== 1 || result[0].exitCode !== 0 || result[0].signal) {
        errors.push(`REQUIRED_RESULT_FAILED_OR_MISSING: ${task}`);
      }
    }
  }
}
console.log(
  JSON.stringify(
    {
      phase: manifest.phase,
      oldFilesChecked: Object.keys(opening).length,
      errors,
      enforcement: 'LOCAL_SAME_USER_WRITABLE; not CI or remote protection',
    },
    null,
    2,
  ),
);
process.exitCode = errors.length ? 1 : 0;
