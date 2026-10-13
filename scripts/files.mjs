import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { parse } from '@vue/compiler-sfc';

export function files(roots, extensions) {
  const found = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', 'dist'].includes(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (extensions.some((extension) => path.endsWith(extension)))
        found.push(path);
    }
  }
  for (const root of roots) visit(root);
  return found.sort();
}

export function source(path) {
  const text = readFileSync(path, 'utf8');
  if (!path.endsWith('.vue')) return { text, script: text, descriptor: null };
  const { descriptor, errors } = parse(text, { filename: path });
  if (errors.length) throw new Error(`SFC_PARSE ${path}: ${errors.join(', ')}`);
  if (descriptor.script?.src) throw new Error(`SFC_EXTERNAL_SCRIPT ${path}`);
  return {
    text,
    script: [descriptor.script?.content, descriptor.scriptSetup?.content]
      .filter(Boolean)
      .join('\n'),
    descriptor,
  };
}

export function ast(path, script) {
  return ts.createSourceFile(
    path.replace(/\.vue$/, '.ts'),
    script,
    ts.ScriptTarget.Latest,
    true,
  );
}

export function disabledTests(path, script) {
  const forbidden = [];
  function visit(node) {
    const name = ts.isPropertyAccessExpression(node)
      ? node.name.text
      : ts.isElementAccessExpression(node) &&
          ts.isStringLiteral(node.argumentExpression)
        ? node.argumentExpression.text
        : null;
    if (['only', 'skip', 'todo'].includes(name))
      forbidden.push(`MANDATORY_TEST_DISABLED: ${path}: ${name}`);
    ts.forEachChild(node, visit);
  }
  visit(ast(path, script));
  return forbidden;
}

export function commentRanges(text) {
  const tree = ast('scanner.ts', text);
  const literals = [];
  function visit(node) {
    if (
      ts.isStringLiteral(node) ||
      ts.isRegularExpressionLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    )
      literals.push([node.getStart(tree), node.end]);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  literals.sort((first, second) => first[0] - second[0]);
  // Template tails and regular expressions require parser context, not a raw scanner alone.
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    text,
  );
  const ranges = [];
  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    const position = scanner.getTokenPos();
    const literal = literals.find(
      ([start, end]) => position >= start && position < end,
    );
    if (literal) scanner.setTextPos(literal[1]);
    else if (
      [
        ts.SyntaxKind.SingleLineCommentTrivia,
        ts.SyntaxKind.MultiLineCommentTrivia,
      ].includes(token)
    ) {
      ranges.push([position, scanner.getTextPos()]);
    }
    token = scanner.scan();
  }
  return ranges;
}

export function effectiveLines(text) {
  const characters = text.split('');
  for (const [start, end] of commentRanges(text)) {
    for (let index = start; index < end; index++) {
      if (characters[index] !== '\n' && characters[index] !== '\r')
        characters[index] = ' ';
    }
  }
  return characters
    .join('')
    .split('\n')
    .filter((line) => line.trim()).length;
}
