import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('counts executable string literals while excluding pure comments and blank lines', () => {
  const fixture = [
    '// comment',
    '/* comment',
    'continued */',
    '',
    'const url = "https://example.invalid";',
    'const text = "/* real value */";',
  ].join('\n');
  const script = `import { effectiveLines } from './scripts/files.mjs'; console.log(effectiveLines(${JSON.stringify(fixture)}));`;
  const run = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', script],
    { encoding: 'utf8' },
  );
  expect(run.status).toBe(0);
  expect(run.stdout.trim()).toBe('2');
});

it('preserves interpolated template tails and regex literals that look like comments', () => {
  const fixture = [
    'const value = `head ${1} /* literal',
    'tail */`; // real comment',
    'const pattern = /\\/\\*literal\\*\\//;',
    '// excluded',
  ].join('\n');
  const script = `import { effectiveLines } from './scripts/files.mjs'; console.log(effectiveLines(${JSON.stringify(fixture)}));`;
  const run = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', script],
    { encoding: 'utf8' },
  );
  expect(run.status).toBe(0);
  expect(run.stdout.trim()).toBe('3');
});

it('counts complete SFC physical lines across all blocks and preserves quoted markers', () => {
  const fixture = [
    '<!-- outer -->',
    '<template>',
    '<p title="<!-- literal -->">visible</p>',
    '<!-- excluded -->',
    '</template>',
    '<script setup lang="ts">',
    '// excluded',
    'const literal = "/* text */";',
    '</script>',
    '<style>',
    '/* excluded */',
    'p::before { content: "/* literal */"; }',
    '</style>',
  ].join('\n');
  const script = `import { parse } from '@vue/compiler-sfc'; import { vueEffectiveLines } from './scripts/vue-lines.mjs'; const text = ${JSON.stringify(fixture)}; console.log(vueEffectiveLines(text, parse(text).descriptor));`;
  const run = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', script],
    { encoding: 'utf8' },
  );
  expect(run.status).toBe(0);
  expect(run.stdout.trim()).toBe('9');
});

it('retains a CSS closing brace immediately after a parsed comment', () => {
  const fixture =
    '<template><p>visible</p></template>\n<style>\np{\n/* comment */}\n</style>';
  const script = `import { parse } from '@vue/compiler-sfc'; import { vueEffectiveLines } from './scripts/vue-lines.mjs'; const text = ${JSON.stringify(fixture)}; console.log(vueEffectiveLines(text, parse(text).descriptor));`;
  const run = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', script],
    { encoding: 'utf8' },
  );
  expect(run.status).toBe(0);
  expect(run.stdout.trim()).toBe('5');
});
