import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptPool } from '../streams/health.ts';
import { iptvFor, iptvPool, poolCount, setLiveIptv } from '../data/sources.ts';

const pool = (n: number) => ({ Turkey: Array.from({ length: n }, (_, i) => ({ type: 'hls' as const, url: `https://t/${i}.m3u8`, label: 'T' + i })) });

test('the live stream list replaces the built-in one, and a collapsed list is refused', () => {
  setLiveIptv(null);
  const builtIn = poolCount(iptvPool());
  const big = pool(Math.max(10, builtIn));
  assert.equal(acceptPool(big), true);
  assert.equal(iptvFor('Turkey').length, big.Turkey.length);
  // under half of the list in force: an outage upstream, not dead channels
  assert.equal(acceptPool(pool(Math.floor(big.Turkey.length / 2) - 1)), false);
  assert.equal(acceptPool({}), false);
  assert.equal(acceptPool(null), false);
  assert.equal(iptvFor('Turkey').length, big.Turkey.length);
  setLiveIptv(null);
});
