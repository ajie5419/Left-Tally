import { expect, it } from 'vitest';
import { jsonValueSchema } from '@gc/contracts';

it.each([
  { name: 'null', value: null, accepted: true },
  { name: 'boolean', value: true, accepted: true },
  { name: 'string', value: 'public text', accepted: true },
  { name: 'finite number', value: 42.5, accepted: true },
  { name: 'nested array', value: [null, { n: 1 }], accepted: true },
  { name: 'nested object', value: { a: [false, 'x'] }, accepted: true },
  { name: 'undefined', value: undefined, accepted: false },
  { name: 'NaN', value: Number.NaN, accepted: false },
  { name: 'positive infinity', value: Infinity, accepted: false },
  { name: 'negative infinity', value: -Infinity, accepted: false },
  { name: 'bigint', value: 1n, accepted: false },
  { name: 'Date', value: new Date('2026-10-15'), accepted: false },
  { name: 'Map', value: new Map([['x', 1]]), accepted: false },
  { name: 'function', value: () => 1, accepted: false },
  { name: 'nested undefined', value: { nested: [undefined] }, accepted: false },
])('validates JSON $name without coercion', ({ value, accepted }) => {
  const result = jsonValueSchema.safeParse(value);
  expect(result.success).toBe(accepted);
  if (result.success) expect(result.data).toEqual(value);
});
