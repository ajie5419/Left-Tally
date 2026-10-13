import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const directory = 'evidence/bootstrap/static';
mkdirSync(directory, { recursive: true });
const commands = [
  'check:types',
  'check:lint',
  'check:format',
  'check:dependencies',
  'check:source',
  'check:lockfile',
];
const results = commands.map((task) => {
  const run = spawnSync('pnpm', [task], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    timeout: 120_000,
  });
  const log = `${directory}/${task.replace(':', '-')}.log`;
  writeFileSync(
    log,
    `${run.stdout ?? ''}${run.stderr ?? ''}${run.error?.message ?? ''}`,
  );
  const result = {
    task,
    command: `pnpm ${task}`,
    exitCode: run.status ?? 1,
    signal: run.signal,
    log,
  };
  console.log(`${task}: exit=${result.exitCode}; ${log}`);
  return result;
});
writeFileSync(
  `${directory}/results.json`,
  JSON.stringify({ results }, null, 2) + '\n',
);
process.exitCode = results.every(
  (result) => result.exitCode === 0 && !result.signal,
)
  ? 0
  : 1;
