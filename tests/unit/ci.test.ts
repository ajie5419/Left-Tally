import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary) rmSync(directory, { recursive: true });
  temporary.length = 0;
});

function fixture(scenario = 'normal') {
  const directory = mkdtempSync(join(tmpdir(), 'gc-c-checker-'));
  temporary.push(directory);
  const run = spawnSync(
    process.execPath,
    [resolve('tests/support/ci-fixture.mjs'), directory, scenario],
    { encoding: 'utf8' },
  );
  expect(run.status).toBe(0);
  return directory;
}

function check(scenario: string) {
  const directory = fixture(scenario);
  const run = spawnSync(
    process.execPath,
    [
      resolve('scripts/gate.mjs'),
      '--results',
      'evidence/bootstrap/verify/results.json',
    ],
    {
      cwd: directory,
      encoding: 'utf8',
      env: { ...process.env, GC_CHECKOUT_SCOPE: 'versioned-engineering' },
    },
  );
  mkdirSync('evidence/c/checker-controls', { recursive: true });
  writeFileSync(
    `evidence/c/checker-controls/${scenario}.log`,
    `ISOLATED ARTIFICIAL INPUTS ONLY\nexit=${String(run.status)}\n${run.stdout}${run.stderr}`,
  );
  return run;
}

it('accepts complete isolated checker inputs for the versioned artifact scope', () => {
  expect(check('normal').status).toBe(0);
});

it('refuses legacy scope when untracked files are missing in local mode', () => {
  const directory = fixture('normal');
  // In local mode (empty GC_CHECKOUT_SCOPE), gate.mjs requires every opening file.
  // Add an untracked legacy entry the isolated fixture lacks, independent of today's inventory size.
  const inventory = join(directory, 'evidence/bootstrap/opening-sha256.json');
  const entries: unknown = JSON.parse(readFileSync(inventory, 'utf8'));
  const missing = {
    'Grand Comptroller/untracked-legacy-artifact.md': '0'.repeat(64),
  };
  writeFileSync(
    inventory,
    JSON.stringify(Object.assign({}, entries, missing), null, 2) + '\n',
  );
  const run = spawnSync(
    process.execPath,
    [
      resolve('scripts/gate.mjs'),
      '--results',
      'evidence/bootstrap/verify/results.json',
    ],
    {
      cwd: directory,
      encoding: 'utf8',
      env: { ...process.env, GC_CHECKOUT_SCOPE: '' },
    },
  );
  expect(run.status).toBe(1);
  expect(run.stdout).toContain(
    'OLD_FILE_CHANGED: Grand Comptroller/untracked-legacy-artifact.md',
  );
});

for (const [scenario, diagnostic] of [
  ['failed-task', 'REQUIRED_RESULT_FAILED_OR_MISSING'],
  ['missing-task', 'REQUIRED_RESULT_FAILED_OR_MISSING'],
  ['missing-result', 'REQUIRED_REPORT_MISSING'],
  ['skip-unit', 'RESULT_UNIT_FAILED_MISSING_OR_SKIPPED'],
  ['skip-browser', 'RESULT_BROWSER_FAILED_MISSING_OR_SKIPPED'],
  ['missing-suite', 'REQUIRED_SUITE_MISSING'],
  ['delete-unit-artifact', 'RESULT_EVIDENCE_MISSING_OR_INVALID'],
  ['delete-log', 'RESULT_LOG_MISSING'],
  ['source-change', 'RESULT_SOURCE_SNAPSHOT_MISMATCH'],
  ['source-add', 'CI_CHECKOUT_SOURCE_INVENTORY_MISMATCH'],
]) {
  it(`rejects ${scenario ?? 'invalid case'} with its corresponding rule`, () => {
    if (!scenario || !diagnostic) throw new Error('Missing test case');
    const run = check(scenario);
    expect(run.status).toBe(1);
    expect(run.stdout).toContain(diagnostic);
  });
}

it('rejects failed, cancelled, skipped and missing job summaries', () => {
  for (const result of [
    'success',
    'failure',
    'cancelled',
    'skipped',
    'missing',
  ]) {
    const payload = result === 'missing' ? {} : { verify: { result } };
    const run = spawnSync(
      process.execPath,
      [resolve('scripts/ci/summary.mjs')],
      {
        encoding: 'utf8',
        env: { ...process.env, GC_JOB_RESULTS: JSON.stringify(payload) },
      },
    );
    expect(run.status).toBe(result === 'success' ? 0 : 1);
    mkdirSync('evidence/c/checker-controls', { recursive: true });
    writeFileSync(
      `evidence/c/checker-controls/job-${result}.log`,
      `exit=${String(run.status)}\n${run.stdout}${run.stderr}`,
    );
  }
});

it('detects candidate governance and checker self-replacement from a separate reference', () => {
  const reference = fixture();
  const candidate = fixture();
  const executable = resolve('scripts/ci/governance.mjs');
  const baseline = spawnSync(
    process.execPath,
    [executable, reference, candidate],
    { encoding: 'utf8' },
  );
  expect(baseline.status).toBe(0);
  for (const path of [
    'scripts/gate.mjs',
    'scripts/ci/governance.mjs',
    'AGENTS.md',
    '.github/workflows/bootstrap.yml',
  ]) {
    writeFileSync(join(candidate, path), 'candidate replacement\n');
  }
  const changed = spawnSync(
    process.execPath,
    [executable, reference, candidate],
    { encoding: 'utf8' },
  );
  expect(changed.status).toBe(1);
  expect(changed.stdout).toContain('reviewRequired');
  expect(changed.stdout).toContain('scripts/ci/governance.mjs');
  mkdirSync('evidence/c/checker-controls', { recursive: true });
  writeFileSync(
    'evidence/c/checker-controls/governance.log',
    `SIMULATED REFERENCE; NOT AN APPROVED RELEASE\nnormalExit=${String(baseline.status)}\n${baseline.stdout}\nchangedExit=${String(changed.status)}\n${changed.stdout}`,
  );
});

it('refuses a missing or candidate-owned governance reference', () => {
  const executable = resolve('scripts/ci/governance.mjs');
  const missing = spawnSync(process.execPath, [executable], {
    encoding: 'utf8',
  });
  expect(missing.status).toBe(1);
  expect(missing.stderr).toContain('GOVERNANCE_REFERENCE_REQUIRED');
  const candidate = fixture();
  const same = spawnSync(process.execPath, [executable, candidate, candidate], {
    encoding: 'utf8',
  });
  expect(same.status).toBe(1);
  expect(same.stderr).toContain('GOVERNANCE_REFERENCE_NOT_INDEPENDENT');
});

it('normalizes Docker metadata and refuses a public binding without claiming a daemon run', () => {
  const script = `
    import { dockerContainer } from './scripts/database-backend.mjs';
    import { assertIsolation } from './scripts/database-isolation.mjs';
    const target={name:'gc-fixture',token:'fixture',image:'docker.io/library/mysql:8.4',port:49152};
    const raw={Name:'/gc-fixture',Image:'sha256:fixture',Config:{Image:target.image,Labels:{'gc.scope':'bootstrap-isolated-probe','gc.probe-id':'fixture'}},
      Mounts:[],HostConfig:{Privileged:false,Tmpfs:{'/var/lib/mysql':'','/var/run/mysqld':''},
      PortBindings:{'3306/tcp':[{HostIp:process.env.FIXTURE_ADDRESS,HostPort:'49152'}]}}};
    assertIsolation(dockerContainer(raw),target);`;
  for (const address of ['127.0.0.1', '0.0.0.0']) {
    const run = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', script],
      {
        encoding: 'utf8',
        env: { ...process.env, FIXTURE_ADDRESS: address },
      },
    );
    expect(run.status).toBe(address === '127.0.0.1' ? 0 : 1);
    if (address !== '127.0.0.1')
      expect(run.stderr).toContain('MYSQL_PROBE_BINDING_UNKNOWN');
  }
});
