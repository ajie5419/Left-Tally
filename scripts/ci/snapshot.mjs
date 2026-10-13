import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { files } from '../files.mjs';

export function sourceSnapshot() {
  const roots = ['apps', 'packages', 'tests', 'scripts', 'config'];
  if (existsSync('.github')) roots.push('.github');
  const paths = [
    ...files(roots, [
      '.ts',
      '.vue',
      '.mjs',
      '.json',
      '.html',
      '.css',
      '.yaml',
      '.yml',
    ]),
    'package.json',
    'pnpm-workspace.yaml',
    'pnpm-lock.yaml',
    '.prototools',
    'tsconfig.json',
    'eslint.config.mjs',
    '.prettierrc.json',
    '.gitignore',
    'AGENTS.md',
    'Grand Comptroller/工程治理与门禁基线-2026-10-13.md',
    'evidence/bootstrap/opening-sha256.json',
  ];
  return Object.fromEntries(
    [...new Set(paths)]
      .sort()
      .map((path) => [
        path,
        createHash('sha256').update(readFileSync(path)).digest('hex'),
      ]),
  );
}

export function snapshotMatches(expected) {
  const actual = sourceSnapshot();
  return JSON.stringify(actual) === JSON.stringify(expected);
}
