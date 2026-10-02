// RUN A SURFACE N TIMES AND REPORT THE MEDIAN, NOT A SINGLE ROLL OF THE DICE.
//
// Two single runs of stage-of on the same build gave gpu p50 12.8 and 15.0ms -
// a spread larger than the effect most changes have. A before/after on one
// stage needs the median of several runs, with the per-run spread shown so a
// difference smaller than it is not mistaken for a result.
//
//   node stage-median.mjs globe 3
import { execFileSync } from 'node:child_process';
const which = process.argv[2] || 'globe';
const n = Math.max(1, +(process.argv[3] || 3));
const runs = [];
for (let i = 0; i < n; i++) {
  let out = '';
  try {
    out = execFileSync('node', ['D:/void-audit/scripts/stage-of.mjs', which], { encoding: 'utf8', maxBuffer: 8 << 20 });
  } catch (e) {
    console.log(`run ${i + 1}: ${(e.stdout || '').toString().split('\n')[0] || e.message}`);
    process.exit(2);
  }
  const j = out.split('\n').find((l) => l.startsWith('JSON '));
  if (!j) { console.log('run ' + (i + 1) + ': no JSON line'); process.exit(1); }
  runs.push(JSON.parse(j.slice(5)));
  await new Promise((r) => setTimeout(r, 2500));
}
const med = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s[s.length >> 1]; };
const spread = (xs) => (Math.max(...xs) - Math.min(...xs)).toFixed(1);
const f = (k, g) => runs.map((r) => (g ? r.stages[g][k] : r[k]));
console.log(`[${which}] median of ${n} runs (spread in parens)`);
console.log(`  total  p50 ${med(f('p50'))} (${spread(f('p50'))})  p90 ${med(f('p90'))} (${spread(f('p90'))})  over10 ${med(f('over10Pct'))}%`);
for (const g of ['gpu', 'animation', 'draw', 'traversal', 'sync', 'input']) {
  console.log(`  ${g.padEnd(10)} p50 ${String(med(f('p50', g))).padStart(5)} (${spread(f('p50', g))})  p90 ${String(med(f('p90', g))).padStart(5)} (${spread(f('p90', g))})`);
}
console.log('JSON ' + JSON.stringify({ surface: which, n, p50: med(f('p50')), p90: med(f('p90')), gpu_p50: med(f('p50', 'gpu')), gpu_p90: med(f('p90', 'gpu')), anim_p50: med(f('p50', 'animation')) }));
