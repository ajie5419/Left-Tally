import { builtinModules, createRequire } from 'node:module';
import { resolve, relative } from 'node:path';
import ts from 'typescript';
import { files, source, ast } from './files.mjs';

const configuration = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
if (configuration.error) throw new Error('Cannot read tsconfig');
const parsed = ts.parseJsonConfigFileContent(
  configuration.config,
  ts.sys,
  process.cwd(),
);
if (parsed.errors.length) throw new Error('Cannot parse tsconfig');
const graph = new Map();
const edges = new Map();
const errors = [];
const builtins = new Set(
  builtinModules.flatMap((name) => [name, `node:${name}`]),
);
const host = {
  ...ts.sys,
  fileExists: (path) =>
    ts.sys.fileExists(path) ||
    (path.endsWith('.vue.ts') && ts.sys.fileExists(path.slice(0, -3))),
};

function forbidden(from, to, specifier) {
  const database =
    /(?:^|[/@-])(prisma|mysql2?|mariadb|sequelize|knex)(?:[/@-]|$)/i;
  if (
    from.startsWith('apps/web/') &&
    (to.startsWith('apps/api/') ||
      specifier.startsWith('@gc/api') ||
      database.test(`${to} ${specifier}`))
  )
    return 'WEB_BACKEND_DB';
  if (
    /\/routes\//.test(from) &&
    (database.test(`${to} ${specifier}`) ||
      /\/(infrastructure|qms)\//i.test(to) ||
      /qms/i.test(specifier) ||
      /^(axios|undici|node:http|node:https)(\/|$)/.test(specifier))
  )
    return 'ROUTE_DB_QMS';
  if (
    /\/domain\//.test(from) &&
    (/\/(infrastructure|routes)\//.test(to) ||
      database.test(`${to} ${specifier}`) ||
      builtins.has(specifier) ||
      /^(hono|vue|axios)(\/|$)/.test(specifier))
  )
    return 'DOMAIN_ENV';
  if (
    /\/application\//.test(from) &&
    (database.test(`${to} ${specifier}`) ||
      /\/infrastructure\//.test(to) ||
      /^(axios|undici|node:https?)(\/|$)/.test(specifier))
  )
    return 'APPLICATION_EXTERNAL_ADAPTER';
  if (
    from.startsWith('packages/contracts/') &&
    (to.startsWith('apps/') ||
      database.test(`${to} ${specifier}`) ||
      /^(vue|pinia|hono)(\/|$)/.test(specifier) ||
      builtins.has(specifier))
  )
    return 'CONTRACT_BOUNDARY';
  if (
    /^(apps|packages)\//.test(from) &&
    /(^|\/)(tests?|fixtures?)(\/|$)/.test(to)
  )
    return 'PRODUCTION_FIXTURE';
  const fromModule = /\/modules\/([^/]+)\//.exec(from)?.[1];
  const toModule = /\/modules\/([^/]+)\//.exec(to)?.[1];
  if (
    fromModule &&
    toModule &&
    fromModule !== toModule &&
    /\/(infrastructure|domain|routes)\//.test(to)
  )
    return 'CROSS_MODULE_INTERNAL';
  return null;
}

function add(from, specifier) {
  let asset = null;
  if (/\.(css|svg)$/.test(specifier)) {
    try {
      asset = createRequire(resolve(from)).resolve(specifier);
    } catch {
      errors.push(`UNRESOLVED_ASSET: ${from} -> ${specifier}`);
    }
  }
  const result = ts.resolveModuleName(
    specifier,
    resolve(from),
    parsed.options,
    host,
  ).resolvedModule;
  const vuePath =
    !result && /\.(vue|css|svg)$/.test(specifier) && specifier.startsWith('.')
      ? resolve(from, '..', specifier)
      : null;
  const resolved = result?.resolvedFileName;
  const target =
    (resolved?.endsWith('.vue.ts') ? resolved.slice(0, -3) : resolved) ??
    asset ??
    (vuePath && ts.sys.fileExists(vuePath) ? vuePath : null);
  const to = target ? relative(process.cwd(), target) : specifier;
  edges.get(from).push({ to, specifier });
  const violation = forbidden(from, to, specifier);
  if (violation) errors.push(`${violation}: ${from} -> ${specifier} (${to})`);
  if (!target && !builtins.has(specifier))
    errors.push(`UNRESOLVED: ${from} -> ${specifier}`);
  if (target && !to.includes('node_modules/') && graph.has(to))
    graph.get(from).push(to);
}

const paths = files(['apps', 'packages', 'tests', 'config'], ['.ts', '.vue']);
for (const path of paths) {
  graph.set(path, []);
  edges.set(path, []);
}
for (const path of paths) {
  const { script, descriptor } = source(path);
  function visit(node) {
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      add(path, node.moduleReference.expression.text);
    }
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier
    ) {
      add(path, node.moduleSpecifier.text);
    }
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    )
      add(path, node.argument.literal.text);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        node.expression.getText() === 'require')
    ) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteral(argument)) add(path, argument.text);
      else errors.push(`DYNAMIC_NON_LITERAL: ${path}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast(path, script));
  for (const block of [descriptor?.template, ...(descriptor?.styles ?? [])]) {
    if (block?.src) add(path, block.src);
  }
}

// Re-export wrappers must not make an otherwise forbidden dependency legal.
for (const origin of paths) {
  const seen = new Set();
  function transit(path, chain) {
    if (seen.has(path)) return;
    seen.add(path);
    for (const { to, specifier } of edges.get(path)) {
      const violation = forbidden(origin, to, specifier);
      if (chain.length && violation) {
        errors.push(
          `${violation}_TRANSITIVE: ${[origin, ...chain, to].join(' -> ')}`,
        );
      }
      if (edges.has(to)) transit(to, [...chain, to]);
    }
  }
  transit(origin, []);
}

const active = new Set();
const visited = new Set();
function cycle(path, chain) {
  if (active.has(path)) {
    errors.push(`CYCLE: ${[...chain, path].join(' -> ')}`);
    return;
  }
  if (visited.has(path)) return;
  active.add(path);
  for (const target of graph.get(path)) cycle(target, [...chain, path]);
  active.delete(path);
  visited.add(path);
}
for (const path of paths) cycle(path, []);
console.log(
  JSON.stringify(
    { files: paths.length, graph: Object.fromEntries(graph), errors },
    null,
    2,
  ),
);
process.exitCode = errors.length ? 1 : 0;
