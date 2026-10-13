import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const temporary = mkdtempSync(join(tmpdir(), 'gc-b-negative-'));
const evidence = resolve('evidence/bootstrap/negative');
mkdirSync(evidence, { recursive: true });
const records = [];
let completed = false;
const targets = {
  web: 'apps/web/src/probe.ts',
  route: 'apps/api/src/routes/probe.ts',
  domain: 'apps/api/src/domain/probe.ts',
  contract: 'packages/contracts/src/probe.ts',
};
const lint = ['pnpm', 'exec', 'eslint'];
const dependency = ['node', 'scripts/dependencies.mjs'];
const source = ['node', 'scripts/source.mjs'];
const gate = ['node', 'scripts/gate.mjs'];

function put(path, text) {
  mkdirSync(dirname(join(temporary, path)), { recursive: true });
  writeFileSync(join(temporary, path), text);
  const proof = join(evidence, 'support', String(records.length), path);
  mkdirSync(dirname(proof), { recursive: true });
  writeFileSync(proof, text);
}

function check(id, path, text, command, expected, pass = false) {
  if (path) put(path, text);
  const actual = [...command];
  if (command === lint) actual.push(path, '--max-warnings', '0');
  const run = spawnSync(actual[0], actual.slice(1), {
    cwd: temporary,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 5 * 1024 * 1024,
  });
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}${run.error?.message ?? ''}`;
  const exitCode = run.status ?? 1;
  const valid = pass
    ? exitCode === 0
    : exitCode !== 0 &&
      output.includes(expected) &&
      !/Parsing error|Cannot find package|ERR_PNPM|SyntaxError/.test(output) &&
      (expected === 'UNRESOLVED' || !output.includes('UNRESOLVED'));
  const record = {
    id,
    fixture: path,
    support: `support/${records.length}`,
    fixtureSha256: path
      ? createHash('sha256').update(text).digest('hex')
      : null,
    command: actual.join(' '),
    cwd: temporary,
    expected: pass ? 'exit 0' : expected,
    exitCode,
    valid,
  };
  records.push(record);
  writeFileSync(
    join(evidence, `${id}.log`),
    `${JSON.stringify(record, null, 2)}\n${output}`,
  );
  if (path) {
    mkdirSync(join(evidence, 'fixtures'), { recursive: true });
    writeFileSync(
      join(
        evidence,
        'fixtures',
        `${id}${path.endsWith('.vue') ? '.vue' : '.txt'}`,
      ),
      text,
    );
    rmSync(join(temporary, path));
  }
  console.log(
    `${id}: exit=${exitCode}; expected-rule=${expected}; ${valid ? 'PROVEN' : 'FAILED'}`,
  );
}

function functionLines(count) {
  return [
    'export function increment() {',
    '  let value = 0;',
    ...Array.from({ length: count - 4 }, () => '  value += 1;'),
    '  return value;',
    '}',
  ].join('\n');
}
function complexity(count) {
  return `export function branches(value: number) {\n${Array.from(
    { length: count - 1 },
    (_, index) => `  if (value === ${index}) return ${index};`,
  ).join('\n')}\nreturn value;\n}`;
}
function depth(count) {
  return `export function nested(value: number) {\n${Array.from(
    { length: count },
    (_, index) => `if (value > ${index}) {`,
  ).join('\n')}\nvalue += 1;\n${'}\n'.repeat(count)}return value;\n}`;
}
function vueLines(count) {
  return `<template>\n<div>\n${Array.from({ length: count - 4 }, (_, index) => `<span>${index}</span>`).join('\n')}\n</div>\n</template>`;
}

try {
  for (const path of [
    '.github',
    'apps',
    'packages',
    'tests',
    'scripts',
    'config',
    'Grand Comptroller',
    'evidence/bootstrap',
  ]) {
    cpSync(path, join(temporary, path), {
      recursive: true,
      filter: (file) =>
        !file
          .split('/')
          .some((part) =>
            ['node_modules', 'dist', 'negative', 'verify'].includes(part),
          ),
    });
  }
  for (const path of [
    'package.json',
    'pnpm-workspace.yaml',
    'pnpm-lock.yaml',
    'tsconfig.json',
    'eslint.config.mjs',
    '.prettierrc.json',
    '.prototools',
    'AGENTS.md',
  ])
    cpSync(path, join(temporary, path));
  for (const path of [
    'node_modules',
    'apps/web/node_modules',
    'apps/api/node_modules',
    'packages/contracts/node_modules',
  ]) {
    symlinkSync(resolve(path), join(temporary, path), 'dir');
  }
  check('B07-baseline-dependencies', null, '', dependency, 'normal', true);
  check('B07-baseline-source', null, '', source, 'normal', true);
  check('B07-baseline-gate', null, '', gate, 'normal', true);
  check('B07-baseline-lint', null, '', ['pnpm', 'check:lint'], 'normal', true);
  check(
    'B01-relative',
    targets.web,
    "export { app } from '../../api/src/app';\n",
    dependency,
    'WEB_BACKEND_DB',
  );
  check(
    'B01-alias',
    targets.web,
    "export { app } from '@api/app';\n",
    dependency,
    'WEB_BACKEND_DB',
  );
  put('apps/web/src/bridge.ts', "export { app } from '@api/app';\n");
  check(
    'B01-reexport',
    targets.web,
    "export { app } from './bridge';\n",
    dependency,
    'WEB_BACKEND_DB',
  );
  rmSync(join(temporary, 'apps/web/src/bridge.ts'));
  const typeConfigText = readFileSync(join(temporary, 'tsconfig.json'), 'utf8');
  const typeConfig = JSON.parse(typeConfigText);
  typeConfig.compilerOptions.paths['@prisma/client'] = [
    'packages/prisma-probe/src/index.ts',
  ];
  put('tsconfig.json', JSON.stringify(typeConfig));
  put(
    'packages/prisma-probe/src/index.ts',
    '/** Isolated import-resolution fixture, not a Prisma implementation. */\nexport interface PrismaClient { readonly fixture: true }\n',
  );
  check(
    'B01-prisma',
    targets.web,
    "import type { PrismaClient } from '@prisma/client';\nexport type Client = PrismaClient;\n",
    dependency,
    'WEB_BACKEND_DB',
  );
  put('tsconfig.json', typeConfigText);
  rmSync(join(temporary, 'packages/prisma-probe'), { recursive: true });
  check(
    'B01-mysql',
    targets.web,
    "export { createConnection } from 'mysql2';\n",
    dependency,
    'WEB_BACKEND_DB',
  );
  put(
    'packages/bridge/src/index.ts',
    "export { app } from '../../../apps/api/src/app';\n",
  );
  check(
    'B01-transitive',
    targets.web,
    "export { app } from '../../../packages/bridge/src';\n",
    dependency,
    'WEB_BACKEND_DB_TRANSITIVE',
  );
  rmSync(join(temporary, 'packages/bridge'), { recursive: true });
  check(
    'B01-vue',
    'apps/web/src/Probe.vue',
    '<script setup lang="ts">\nimport { app } from \'@api/app\';\nconsole.log(app);\n</script>\n<template><p>probe</p></template>\n',
    dependency,
    'WEB_BACKEND_DB',
  );
  check(
    'B01-dynamic',
    targets.web,
    "export const load = () => import('@api/app');\n",
    dependency,
    'WEB_BACKEND_DB',
  );
  check(
    'B02-db',
    targets.route,
    "export { createConnection } from 'mysql2';\n",
    dependency,
    'ROUTE_DB_QMS',
  );
  put(
    'apps/api/src/infrastructure/qms.ts',
    'export const qms = () => false;\n',
  );
  check(
    'B02-qms',
    targets.route,
    "export { qms } from '../infrastructure/qms';\n",
    dependency,
    'ROUTE_DB_QMS',
  );
  rmSync(join(temporary, 'apps/api/src/infrastructure/qms.ts'));
  check(
    'B02-fetch',
    targets.route,
    "export const external = () => fetch('https://example.invalid');\n",
    source,
    'ROUTE_DIRECT_HTTP',
  );
  check(
    'B03-env',
    targets.domain,
    "export const address = process.env['QMS_URL'];\n",
    source,
    'DOMAIN_IMPLICIT_ENV_TIME',
  );
  check(
    'B03-now',
    targets.domain,
    'export const now = Date.now();\n',
    source,
    'DOMAIN_IMPLICIT_ENV_TIME',
  );
  check(
    'B03-date',
    targets.domain,
    'export const now = new Date();\n',
    source,
    'DOMAIN_IMPLICIT_ENV_TIME',
  );
  const vueConfig = JSON.parse(typeConfigText);
  vueConfig.compilerOptions.paths.vue = [
    'apps/web/node_modules/vue/dist/vue.d.ts',
  ];
  put('tsconfig.json', JSON.stringify(vueConfig));
  check(
    'B03-vue',
    targets.contract,
    "export { ref } from 'vue';\n",
    dependency,
    'CONTRACT_BOUNDARY',
  );
  put('tsconfig.json', typeConfigText);
  check(
    'B03-db',
    targets.contract,
    "export { createConnection } from 'mysql2';\n",
    dependency,
    'CONTRACT_BOUNDARY',
  );
  check(
    'B04-ts401',
    targets.web,
    Array.from(
      { length: 401 },
      (_, index) => `export const line${index} = ${index};`,
    ).join('\n'),
    lint,
    'max-lines',
  );
  check(
    'B04-ts400',
    targets.web,
    Array.from(
      { length: 400 },
      (_, index) => `export const line${index} = ${index};`,
    ).join('\n'),
    lint,
    'boundary',
    true,
  );
  check(
    'B04-vue501',
    'apps/web/src/Probe.vue',
    vueLines(501),
    source,
    'VUE_MAX_LINES',
  );
  check(
    'B04-vue500',
    'apps/web/src/Probe.vue',
    vueLines(500),
    source,
    'boundary',
    true,
  );
  check(
    'B04-function81',
    targets.web,
    functionLines(81),
    lint,
    'max-lines-per-function',
  );
  check(
    'B04-function80',
    targets.web,
    functionLines(80),
    lint,
    'boundary',
    true,
  );
  check('B04-complexity13', targets.web, complexity(13), lint, 'complexity');
  check(
    'B04-complexity12',
    targets.web,
    complexity(12),
    lint,
    'boundary',
    true,
  );
  check('B04-depth5', targets.web, depth(5), lint, 'max-depth');
  check('B04-depth4', targets.web, depth(4), lint, 'boundary', true);
  put('tests/fixtures/quantity.ts', 'export const quantity = 5;\n');
  check(
    'B05-fixture',
    targets.web,
    "export { quantity } from '../../../tests/fixtures/quantity';\n",
    dependency,
    'PRODUCTION_FIXTURE',
  );
  rmSync(join(temporary, 'tests/fixtures/quantity.ts'));
  check(
    'B05-promise',
    targets.web,
    "Promise.resolve('ignored');\n",
    lint,
    '@typescript-eslint/no-floating-promises',
  );
  check(
    'B05-empty-catch',
    targets.web,
    'try { JSON.parse("{}"); } catch {}\n',
    lint,
    'no-empty',
  );
  check(
    'B05-any',
    targets.web,
    'export function identity(value: any) { return value; }\n',
    lint,
    '@typescript-eslint/no-explicit-any',
  );
  check(
    'B05-assertion',
    targets.web,
    "export const value = JSON.parse('{}') as { role: string };\n",
    lint,
    'no-restricted-syntax',
  );
  check(
    'B05-promise-misuse',
    targets.web,
    'export async function callback() { return 1; }\nsetTimeout(callback, 1);\n',
    lint,
    '@typescript-eslint/no-misused-promises',
  );
  check(
    'B06-only',
    'tests/unit/probe.test.ts',
    "import { it, expect } from 'vitest';\nit.only('probe', () => expect(true).toBe(true));\n",
    gate,
    'MANDATORY_TEST_DISABLED',
  );
  check(
    'B06-skip',
    'tests/unit/probe.test.ts',
    "import { it, expect } from 'vitest';\nit.skip('probe', () => expect(true).toBe(true));\n",
    gate,
    'MANDATORY_TEST_DISABLED',
  );
  check(
    'B06-ignore',
    targets.web,
    '// eslint-disable-next-line\nexport const value = 1;\n',
    source,
    'UNAPPROVED_IGNORE',
  );
  check(
    'B06-ts-ignore',
    targets.web,
    '// @ts-ignore\nexport const value = 1;\n',
    source,
    'UNAPPROVED_IGNORE',
  );
  const packageText = readFileSync(join(temporary, 'package.json'), 'utf8');
  const packageObject = JSON.parse(packageText);
  delete packageObject.scripts['test:integration'];
  put('package.json', JSON.stringify(packageObject));
  check('B06-task-missing', null, '', gate, 'REQUIRED_TASK_MISSING');
  put('package.json', packageText);
  const results = JSON.parse(
    readFileSync('config/bootstrap.json', 'utf8'),
  ).required.map((task) => ({ task, exitCode: 0, signal: null }));
  results.find((result) => result.task === 'test:integration').exitCode = 1;
  put('failed-results.json', JSON.stringify({ results }));
  check(
    'B06-task-failed',
    null,
    '',
    ['node', 'scripts/gate.mjs', '--results', 'failed-results.json'],
    'REQUIRED_RESULT_FAILED_OR_MISSING',
  );
  put(
    'failed-results.json',
    JSON.stringify({
      results: results.filter((result) => result.task !== 'test:unit'),
    }),
  );
  check(
    'B06-result-missing',
    null,
    '',
    ['node', 'scripts/gate.mjs', '--results', 'failed-results.json'],
    'REQUIRED_RESULT_FAILED_OR_MISSING',
  );
  check(
    'B07-display',
    targets.web,
    'export const PAGE_SIZE = 20;\nexport function display(value: number) { return `${value.toFixed(2)} 件`; }\n',
    lint,
    'normal',
    true,
  );
  check(
    'graph-unresolved',
    targets.web,
    "export { absent } from './absent';\n",
    dependency,
    'UNRESOLVED',
  );
  put('apps/web/src/cycle.ts', "export { loop } from './probe';\n");
  check(
    'graph-cycle',
    targets.web,
    "export { loop } from './cycle';\n",
    dependency,
    'CYCLE',
  );
  rmSync(join(temporary, 'apps/web/src/cycle.ts'));
  check(
    'graph-nonliteral',
    targets.web,
    'export const load = (path: string) => import(path);\n',
    dependency,
    'DYNAMIC_NON_LITERAL',
  );
  check(
    'B03-clock-alias',
    targets.domain,
    'const Clock = Date;\nexport const now = new Clock();\n',
    source,
    'DOMAIN_IMPLICIT_ENV_TIME',
  );
  check(
    'B03-explicit-time',
    targets.domain,
    'export function explicitTime(value: string) { return new Date(value); }\n',
    source,
    'normal',
    true,
  );
  check(
    'B04-vue-style501',
    'apps/web/src/Probe.vue',
    `<template><p>probe</p></template>\n<style>\n:root {\n${Array.from({ length: 496 }, (_, index) => `--item-${index}: ${index}px;`).join('\n')}\n}\n</style>`,
    source,
    'VUE_MAX_LINES',
  );
  check(
    'B04-vue-style500',
    'apps/web/src/Probe.vue',
    `<template><p>probe</p></template>\n<style>\n:root {\n${Array.from({ length: 495 }, (_, index) => `--item-${index}: ${index}px;`).join('\n')}\n}\n</style>`,
    source,
    'boundary',
    true,
  );
  check(
    'B04-vue-function81',
    'apps/web/src/Probe.vue',
    `<script lang="ts">\n${functionLines(81)}\n</script>\n<template><p>probe</p></template>`,
    lint,
    'max-lines-per-function',
  );
  check(
    'B06-computed-skip',
    'tests/unit/probe.test.ts',
    "import { it as scenario } from 'vitest';\nscenario['skip']('probe', () => {});\n",
    gate,
    'MANDATORY_TEST_DISABLED',
  );
  const suite = readFileSync(
    join(temporary, 'tests/unit/health.test.ts'),
    'utf8',
  );
  rmSync(join(temporary, 'tests/unit/health.test.ts'));
  check('B06-suite-missing', null, '', gate, 'REQUIRED_SUITE_MISSING');
  put('tests/unit/health.test.ts', suite);
  check(
    'graph-unchecked-js',
    'apps/web/src/probe.js',
    "export { app } from '@api/app';\n",
    source,
    'UNCHECKED_PRODUCTION_EXTENSION',
  );
  completed = true;
} finally {
  rmSync(temporary, { recursive: true, force: true });
  writeFileSync(
    join(evidence, 'results.json'),
    JSON.stringify(
      {
        records,
        temporary,
        cleaned: true,
        completed,
        passed: completed && records.every((record) => record.valid),
      },
      null,
      2,
    ) + '\n',
  );
}
process.exitCode =
  completed && records.length > 0 && records.every((record) => record.valid)
    ? 0
    : 1;
