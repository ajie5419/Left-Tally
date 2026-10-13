import ts from 'typescript';
import { files, source, ast, disabledTests } from './files.mjs';
import { vueEffectiveLines } from './vue-lines.mjs';

const errors = [];
for (const path of files(
  ['apps', 'packages'],
  ['.js', '.mjs', '.cjs', '.jsx', '.tsx', '.mts', '.cts'],
)) {
  errors.push(`UNCHECKED_PRODUCTION_EXTENSION: ${path}`);
}
for (const path of files(
  ['apps', 'packages', 'tests', 'config'],
  ['.ts', '.vue'],
)) {
  const { text, script, descriptor } = source(path);
  if (descriptor && !path.startsWith('apps/web/')) {
    errors.push(`SFC_UNCHECKED_LOCATION: ${path}`);
  }
  if (
    /(eslint-(?:disable|enable)|@ts-(?:ignore|nocheck|expect-error))/.test(text)
  ) {
    errors.push(`UNAPPROVED_IGNORE: ${path}`);
  }
  if (/\/routes\//.test(path)) {
    function routeVisit(node) {
      if (ts.isIdentifier(node) && node.text === 'fetch') {
        errors.push(`ROUTE_DIRECT_HTTP: ${path}`);
      }
      ts.forEachChild(node, routeVisit);
    }
    routeVisit(ast(path, script));
  }
  if (/\/domain\//.test(path)) {
    function visit(node) {
      const value = node.getText();
      if (
        (ts.isIdentifier(node) &&
          ['process', 'globalThis'].includes(node.text)) ||
        ts.isMetaProperty(node) ||
        (ts.isIdentifier(node) &&
          node.text === 'Date' &&
          !(
            ts.isPropertyAccessExpression(node.parent) &&
            ['parse', 'UTC'].includes(node.parent.name.text)
          ) &&
          !(
            ts.isNewExpression(node.parent) && node.parent.arguments?.length
          )) ||
        (ts.isPropertyAccessExpression(node) &&
          /^(process\.env|import\.meta\.env|Date\.now|globalThis\.(process|Date))/.test(
            value,
          )) ||
        (ts.isNewExpression(node) &&
          node.expression.getText() === 'Date' &&
          !node.arguments?.length) ||
        (ts.isCallExpression(node) &&
          ['Date', 'fetch'].includes(node.expression.getText()))
      ) {
        errors.push(`DOMAIN_IMPLICIT_ENV_TIME: ${path}: ${value}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast(path, script));
  }
  if (descriptor && path.startsWith('apps/')) {
    const count = vueEffectiveLines(text, descriptor);
    if (count > 500) errors.push(`VUE_MAX_LINES: ${path}: ${count} > 500`);
  }
  if (path.startsWith('tests/')) errors.push(...disabledTests(path, script));
}
console.log(JSON.stringify({ errors }, null, 2));
process.exitCode = errors.length ? 1 : 0;
