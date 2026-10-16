import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { files, disabledTests } from './files.mjs';
import { resultErrors } from './ci/results.mjs';
import { legacyScope } from './ci/legacy.mjs';

const baseline = {
  'AGENTS.md':
    '778bc7b6bfc282259929ce0cc45e2b8639af8798347c5c6665408032632fbb55',
  'Grand Comptroller/工程治理与门禁基线-2026-10-13.md':
    '4af1198b4c796037ee9242cfca7abb732f5a31a4508709d40b12d319c846d171',
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
  manifest.phase !== 'CORE' ||
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
  'tests/unit/contracts.test.ts',
  'tests/unit/scanner.test.ts',
  'tests/unit/database-isolation.test.ts',
  'tests/unit/ci.test.ts',
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
let legacy = { paths: opening, userArtifacts: 'unknown' };
try {
  legacy = legacyScope(opening, baseline);
} catch (error) {
  errors.push(error.message);
}
for (const [path, hash] of Object.entries(legacy.paths)) {
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
    errors.push(...resultErrors(report));
  }
}
console.log(
  JSON.stringify(
    {
      phase: manifest.phase,
      oldFilesChecked: Object.keys(legacy.paths).length,
      legacyUserArtifacts: legacy.userArtifacts,
      errors,
      enforcement: 'LOCAL_SAME_USER_WRITABLE; not CI or remote protection',
    },
    null,
    2,
  ),
);
process.exitCode = errors.length ? 1 : 0;
