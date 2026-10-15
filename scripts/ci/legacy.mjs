import { existsSync, readFileSync } from 'node:fs';
import { sourceSnapshot } from './snapshot.mjs';

/** Untracked user artifacts remain a local audit obligation, outside the clean CI checkout. */
export function legacyScope(opening, baseline) {
  const scope = process.env.GC_CHECKOUT_SCOPE;
  if (!scope) return { paths: opening, userArtifacts: 'audited locally' };
  if (scope !== 'versioned-engineering')
    throw new Error('CHECKOUT_SCOPE_UNKNOWN');
  for (const path of Object.keys(opening)) {
    if (!(path in baseline) && existsSync(path))
      throw new Error(`CI_ARTIFACT_HAS_UNVERSIONED_USER_FILES: ${path}`);
  }
  const expected = JSON.parse(
    readFileSync('config/ci/checkout-files.json', 'utf8'),
  );
  const actual = Object.keys(sourceSnapshot()).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error('CI_CHECKOUT_SOURCE_INVENTORY_MISMATCH');
  return {
    paths: baseline,
    userArtifacts:
      'outside versioned CI artifact; local opening-file audit still required',
  };
}
