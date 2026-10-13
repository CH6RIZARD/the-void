import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTheme } from '../resolve.ts';

test('first launch follows the device; a manual pick holds', () => {
  // first launch: match on
  assert.equal(resolveTheme('void', true, 'light'), 'light');
  assert.equal(resolveTheme('void', true, 'dark'), 'dark');
  assert.equal(resolveTheme('void', true, 'unspecified'), 'dark');
  assert.equal(resolveTheme('cream', true, 'dark'), 'dark');
  // a manual pick (match off) wins over the device
  assert.equal(resolveTheme('cream', false, 'dark'), 'cream');
  assert.equal(resolveTheme('light', false, 'dark'), 'light');
  assert.equal(resolveTheme('dark', false, 'light'), 'dark');
});
