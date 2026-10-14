import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTheme } from '../resolve.ts';

test('first launch follows the device; a manual pick holds', () => {
  // first launch: match on
  assert.equal(resolveTheme('void', true, 'light'), 'light');
  assert.equal(resolveTheme('void', true, 'dark'), 'dark');
  assert.equal(resolveTheme('void', true, 'unspecified'), 'dark');
  // Alternative on: the device picks between CREAM and CREAM DARK
  assert.equal(resolveTheme('cream', true, 'dark'), 'creamDark');
  assert.equal(resolveTheme('creamDark', true, 'light'), 'cream');
  // a manual pick (match off) wins over the device
  assert.equal(resolveTheme('cream', false, 'dark'), 'cream');
  assert.equal(resolveTheme('light', false, 'dark'), 'light');
  assert.equal(resolveTheme('dark', false, 'light'), 'dark');
});
