import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const [label, executable, ...args] = process.argv.slice(2);
if (!label || !/^[a-z-]+$/.test(label) || !executable)
  throw new Error('Invalid CI step invocation');
mkdirSync('evidence/c/runtime', { recursive: true });
const run = spawnSync(executable, args, {
  encoding: 'utf8',
  timeout: 600_000,
  maxBuffer: 20 * 1024 * 1024,
});
const output = `${run.stdout ?? ''}${run.stderr ?? ''}${run.error?.message ?? ''}`;
writeFileSync(`evidence/c/runtime/${label}.log`, output);
writeFileSync(
  `evidence/c/runtime/${label}.json`,
  JSON.stringify(
    {
      command: [executable, ...args],
      exitCode: run.status ?? 1,
      signal: run.signal,
    },
    null,
    2,
  ) + '\n',
);
console.log(output);
process.exitCode = run.status ?? 1;
