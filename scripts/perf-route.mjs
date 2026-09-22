// Scripted perf route for The Void on the test phone: same taps, same timing, every run.
//   node scripts/perf-route.mjs <outdir>
// Route: feed idle 15 s -> feed scroll (6 swipes) -> GLOBE 40 s -> REELS 20 s -> back to feed 60 s (past the wall's 20 s sleep).
// Taps are for a 720x1560 screen at density 320 (the test phone). Screenshots + perf.log go to <outdir>.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.resolve(process.argv[2] || 'run');
fs.mkdirSync(out, { recursive: true });
const ADB = path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', 'adb.exe');
const PKG = 'com.thevoid.app';
const sh = (cmd) => execFileSync(ADB, ['shell', cmd], { encoding: 'utf8' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (name) => fs.writeFileSync(path.join(out, name + '.png'), execFileSync(ADB, ['exec-out', 'screencap', '-p']));
const tap = (x, y) => sh(`input tap ${x} ${y}`);

const NAV = { feed: [125, 1378], globe: [242, 1378] };
const TOGGLE = { reels: [297, 120], globe: [424, 120] };

sh(`am force-stop ${PKG}`);
await sleep(2000);
sh(`am start -n ${PKG}/.MainActivity`);
await sleep(9000);

const perf = spawn(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'perf-android.mjs'), '--every=3'], { stdio: ['pipe', 'pipe', 'inherit'] });
const log = fs.createWriteStream(path.join(out, 'perf.log'));
perf.stdout.pipe(log);
perf.stdout.pipe(process.stdout);
const label = (l) => perf.stdin.write(l + '\n');
await sleep(4000);

label('feed');
await sleep(15000);
shot('1-feed');
label('feedscroll');
for (let i = 0; i < 6; i++) {
  sh('input swipe 360 1100 360 450 280');
  await sleep(3000);
}
tap(...NAV.globe);
await sleep(500);
tap(...TOGGLE.globe); // make sure GLOBE is showing, whatever mode was stored
label('globe');
await sleep(12000);
shot('2-globe-12s');
await sleep(28000);
shot('3-globe-40s');
tap(...TOGGLE.reels);
label('reels');
await sleep(20000);
shot('4-reels');
tap(...NAV.feed);
label('away');
await sleep(60000);
shot('5-away');
sh(`am force-stop ${PKG}`);
await new Promise((r) => perf.on('exit', r));
log.end();
console.log('done ->', out);
