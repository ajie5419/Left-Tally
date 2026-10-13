import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const hash = (path) =>
  createHash('sha256').update(readFileSync(path)).digest('hex');
const opening = JSON.parse(
  readFileSync('evidence/bootstrap/opening-sha256.json', 'utf8'),
);
const changedOld = Object.keys(opening).filter(
  (path) => !existsSync(path) || hash(path) !== opening[path],
);
const all = {};
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (
      [
        'node_modules',
        '.tools',
        'test-results',
        'playwright-report',
        '.aws',
        '.codex',
        '.agents',
        '.git',
      ].includes(entry.name) ||
      entry.name.startsWith('.env')
    )
      continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (
      entry.isFile() &&
      !path.startsWith('.env') &&
      ![
        'evidence/bootstrap/delivery-sha256.json',
        'evidence/bootstrap/audit.json',
      ].includes(path)
    )
      all[path] = hash(path);
  }
}
walk('.');
const newFiles = Object.keys(all).filter(
  (path) => !(path in opening) && path !== '.DS_Store',
);
const roots = [
  'apps/',
  'packages/',
  'tests/',
  'scripts/',
  'config/',
  'evidence/',
  '.github/',
];
const rootFiles = [
  'package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  '.prototools',
  '.gitignore',
  '.prettierrc.json',
  'eslint.config.mjs',
  'tsconfig.json',
];
const review = 'Grand Comptroller/本地门禁复核记录-2026-10-13.md';
const ciReview = 'Grand Comptroller/CI与版本管理复核记录-2026-10-13.md';
const outside = newFiles.filter(
  (path) =>
    !roots.some((root) => path.startsWith(root)) &&
    !rootFiles.includes(path) &&
    path !== review &&
    path !== ciReview,
);
const sourceHashes = JSON.parse(
  readFileSync('evidence/bootstrap/verify/source-sha256.json', 'utf8'),
);
const changedSource = Object.keys(sourceHashes).filter(
  (path) => hash(path) !== sourceHashes[path],
);
const negatives = JSON.parse(
  readFileSync('evidence/bootstrap/negative/results.json', 'utf8'),
);
const probe = JSON.parse(
  readFileSync('evidence/bootstrap/database-probe.json', 'utf8'),
);
writeFileSync(
  'evidence/bootstrap/delivery-sha256.json',
  JSON.stringify(all, null, 2) + '\n',
);
const report = {
  oldFiles: Object.keys(opening).length,
  changedOld,
  newFiles,
  outside,
  changedSource,
  negativeTemporaryRemoved: !existsSync(negatives.temporary),
  databaseCleanupVerified: probe.cleanupVerified,
  gitCreated: existsSync('.git'),
  enforcement: 'local audit only',
};
writeFileSync(
  'evidence/bootstrap/audit.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report, null, 2));
process.exitCode =
  changedOld.length ||
  outside.length ||
  changedSource.length ||
  existsSync(negatives.temporary) ||
  !probe.cleanupVerified
    ? 1
    : 0;
