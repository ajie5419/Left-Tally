import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';

const pinned = readFileSync('.prototools', 'utf8');
const nodeVersion = /^node = "([^"]+)"$/m.exec(pinned)?.[1];
const pnpmVersion = /^pnpm = "([^"]+)"$/m.exec(pinned)?.[1];
if (!nodeVersion || !pnpmVersion)
  throw new Error('Missing exact proto versions');
const home = resolve('.tools/proto-home');
const node = resolve(home, 'tools/node', nodeVersion, 'bin/node');
const pnpm = resolve(home, 'tools/pnpm', pnpmVersion, 'bin/pnpm.cjs');
if (!existsSync(node) || !existsSync(pnpm))
  throw new Error(
    'Missing project-local proto installation; see bootstrap review record',
  );
const nodeCheck = spawnSync(node, ['--version'], { encoding: 'utf8' });
const pnpmCheck = spawnSync(node, [pnpm, '--version'], { encoding: 'utf8' });
if (
  nodeCheck.status !== 0 ||
  nodeCheck.stdout.trim() !== `v${nodeVersion}` ||
  pnpmCheck.status !== 0 ||
  pnpmCheck.stdout.trim() !== pnpmVersion
)
  throw new Error('Toolchain version mismatch');
const command = process.argv[2];
if (!['node', 'pnpm'].includes(command))
  throw new Error('Usage: node scripts/toolchain.mjs <node|pnpm> <arguments>');
const args = process.argv.slice(3);
const run = spawnSync(node, command === 'pnpm' ? [pnpm, ...args] : args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    PATH: [
      dirname(node),
      resolve(home, 'tools/pnpm', pnpmVersion, 'shims'),
      process.env.PATH,
    ].join(delimiter),
    PROTO_HOME: home,
  },
});
process.exitCode = run.status ?? 1;
