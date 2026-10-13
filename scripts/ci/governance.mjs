import { readdirSync, readFileSync, realpathSync, lstatSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const roots = ['.github', 'scripts', 'config', 'tests', 'packages/contracts'];
const names = [
  'AGENTS.md',
  'Grand Comptroller/工程治理与门禁基线-2026-10-13.md',
  '.prototools',
  '.gitignore',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'eslint.config.mjs',
  '.prettierrc.json',
  'evidence/bootstrap/opening-sha256.json',
];

function protectedFiles(directory) {
  const paths = [...names];
  function visit(path) {
    if (lstatSync(join(directory, path)).isSymbolicLink())
      throw new Error(`GOVERNANCE_UNKNOWN_FILE: ${path}`);
    for (const entry of readdirSync(join(directory, path), {
      withFileTypes: true,
    })) {
      if (['node_modules', 'dist'].includes(entry.name)) continue;
      const next = join(path, entry.name);
      if (entry.isDirectory()) visit(next);
      else if (entry.isFile()) paths.push(next);
      else throw new Error(`GOVERNANCE_UNKNOWN_FILE: ${next}`);
    }
  }
  for (const path of roots) visit(path);
  for (const app of ['web', 'api']) {
    for (const entry of readdirSync(join(directory, 'apps', app))) {
      if (/^(package\.json|tsconfig.*\.json|vite\.config\..+)$/.test(entry))
        paths.push(`apps/${app}/${entry}`);
    }
  }
  return [...new Set(paths)].sort();
}

/** The caller must supply both runner and reference from an independently approved source. */
export function governanceChanges(reference, candidate) {
  const base = realpathSync(resolve(reference));
  const target = realpathSync(resolve(candidate));
  if (
    base === target ||
    base.startsWith(`${target}/`) ||
    target.startsWith(`${base}/`)
  )
    throw new Error('GOVERNANCE_REFERENCE_NOT_INDEPENDENT');
  const before = protectedFiles(base);
  const after = protectedFiles(target);
  const changes = [];
  for (const path of new Set([...before, ...after])) {
    if (!before.includes(path) || !after.includes(path)) changes.push(path);
    else {
      const hash = (root) => {
        if (!lstatSync(join(root, path)).isFile())
          throw new Error(`GOVERNANCE_UNKNOWN_FILE: ${path}`);
        return createHash('sha256')
          .update(readFileSync(join(root, path)))
          .digest('hex');
      };
      if (hash(base) !== hash(target)) changes.push(path);
    }
  }
  return changes;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    const [reference, candidate] = process.argv.slice(2);
    if (!reference || !candidate)
      throw new Error('GOVERNANCE_REFERENCE_REQUIRED');
    const changes = governanceChanges(reference, candidate);
    console.log(
      JSON.stringify(
        {
          changes,
          reviewRequired: changes.length > 0,
          enforcement:
            'comparison only; no approved remote trust source configured',
        },
        null,
        2,
      ),
    );
    process.exitCode = changes.length ? 1 : 0;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
