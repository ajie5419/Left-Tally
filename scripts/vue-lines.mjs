import { parse, NodeTypes } from '@vue/compiler-dom';
import postcss from 'postcss';
import { commentRanges } from './files.mjs';

/** Count physical SFC lines after removing parsed comments, preserving literals. */
export function vueEffectiveLines(text, descriptor) {
  const ranges = [];
  const tree = parse(text, { parseMode: 'sfc', comments: true });
  function visit(node) {
    if (node.type === NodeTypes.COMMENT)
      ranges.push([node.loc.start.offset, node.loc.end.offset]);
    for (const child of node.children ?? []) visit(child);
  }
  visit(tree);
  for (const block of [descriptor.script, descriptor.scriptSetup].filter(
    Boolean,
  )) {
    if (block.lang !== 'ts') throw new Error('SFC_UNCHECKED_SCRIPT_LANGUAGE');
    for (const [start, end] of commentRanges(block.content)) {
      ranges.push([
        block.loc.start.offset + start,
        block.loc.start.offset + end,
      ]);
    }
  }
  if (descriptor.template?.lang && descriptor.template.lang !== 'html')
    throw new Error('SFC_UNCHECKED_TEMPLATE_LANGUAGE');
  for (const block of descriptor.styles) {
    if (block.lang && block.lang !== 'css')
      throw new Error('SFC_UNCHECKED_STYLE_LANGUAGE');
    postcss.parse(block.content).walkComments((comment) => {
      const start = comment.source?.start?.offset;
      const end = comment.source?.end?.offset;
      if (start === undefined || end === undefined)
        throw new Error('CSS_COMMENT_RANGE_UNKNOWN');
      ranges.push([
        block.loc.start.offset + start,
        block.loc.start.offset + end,
      ]);
    });
  }
  const characters = text.split('');
  for (const [start, end] of ranges) {
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
