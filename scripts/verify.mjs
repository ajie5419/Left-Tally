import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { sourceSnapshot } from './ci/snapshot.mjs';
import { resultErrors } from './ci/results.mjs';

const directory = 'evidence/bootstrap/verify';
mkdirSync(directory, { recursive: true });
const hashes = sourceSnapshot();
writeFileSync(
  `${directory}/source-sha256.json`,
  JSON.stringify(hashes, null, 2) + '\n',
);
const required = [
  'check:static',
  'test:unit',
  'build',
  'test:integration',
  'check:migrations',
  'test:negative',
  'test:e2e',
];
const results = [];
const protoPins = readFileSync('.prototools', 'utf8');
let environmentValid =
  process.versions.node === /^node = "([^"]+)"$/m.exec(protoPins)?.[1];
const pnpmVersion = spawnSync('pnpm', ['--version'], { encoding: 'utf8' });
environmentValid =
  environmentValid &&
  pnpmVersion.status === 0 &&
  pnpmVersion.stdout.trim() === '10.28.2';
for (const task of required) {
  const started = new Date().toISOString();
  const run = spawnSync('pnpm', [task], {
    encoding: 'utf8',
    timeout: 600_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  const log = `${directory}/${task.replace(':', '-')}.log`;
  writeFileSync(
    log,
    `${run.stdout ?? ''}${run.stderr ?? ''}${run.error ? `\n${run.error.message}` : ''}`,
  );
  results.push({
    task,
    command: `pnpm ${task}`,
    started,
    exitCode: run.status ?? 1,
    signal: run.signal,
    log,
  });
  console.log(`${task}: exit=${run.status ?? 1}; ${log}`);
}
const reportPath = `${directory}/results.json`;
const gitHead = spawnSync('rtk', ['git', 'rev-parse', 'HEAD'], {
  encoding: 'utf8',
});
const report = {
  phase: 'CORE',
  node: process.versions.node,
  pnpm: pnpmVersion.stdout.trim(),
  environmentValid,
  sourceHashFile: `${directory}/source-sha256.json`,
  sourceChangedDuringVerification: [],
  gitCommit:
    gitHead.status === 0 && /^[a-f0-9]{40}\s*$/.test(gitHead.stdout)
      ? gitHead.stdout.trim()
      : null,
  requestedCICommit: process.env.GITHUB_SHA ?? null,
  sourceIdentity:
    'filesystem SHA256 snapshot; Git HEAD alone does not identify uncommitted changes',
  baselineHashes: Object.fromEntries(
    ['AGENTS.md', 'Grand Comptroller/工程治理与门禁基线-2026-10-13.md'].map(
      (path) => [path, hashes[path]],
    ),
  ),
  trustedRemoteSource: null,
  results,
};
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
const gate = spawnSync('node', ['scripts/gate.mjs', '--results', reportPath], {
  encoding: 'utf8',
});
writeFileSync(
  `${directory}/check-gate.log`,
  `${gate.stdout ?? ''}${gate.stderr ?? ''}`,
);
results.push({
  task: 'check:gate',
  command: `node scripts/gate.mjs --results ${reportPath}`,
  exitCode: gate.status ?? 1,
  signal: gate.signal,
  log: `${directory}/check-gate.log`,
});
const after = sourceSnapshot();
const changed = [
  ...new Set([...Object.keys(hashes), ...Object.keys(after)]),
].filter((path) => after[path] !== hashes[path]);
report.sourceChangedDuringVerification = changed;
report.evidenceErrors = resultErrors(report);
report.success =
  environmentValid &&
  results.every((result) => result.exitCode === 0 && !result.signal) &&
  changed.length === 0 &&
  report.evidenceErrors.length === 0;
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(`verify: ${report.success ? 'PASS' : 'FAIL'} (CORE B01 only)`);
process.exitCode = report.success ? 0 : 1;
