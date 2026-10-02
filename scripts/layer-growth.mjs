// DO THE VIDEO SURFACES EVER GO AWAY?
//
// MAX_MOUNTED_PLAYERS is 10, and the device has 4 hardware overlay planes - past
// that SurfaceFlinger composites the whole screen on the GPU every frame, which
// is the stage measured over budget. So the question is whether the app's surface
// count sits at its budget or climbs with scrolling.
//
// Count DISTINCT layer names. dumpsys SurfaceFlinger names each layer once per
// section it appears in (the layer list, the composition list, the per-layer
// detail blocks), so grepping lines multiplies the real count by five or ten and
// made it look like 130 surfaces.
import { execFileSync } from 'node:child_process';
const ADB = 'D:/android-sdk/platform-tools/adb.exe';
const S = process.argv[2] || 'R5CYA0GF6FP';
const adb = (...a) => execFileSync(ADB, ['-s', S, ...a], { encoding: 'utf8', maxBuffer: 64 << 20 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!adb('shell', 'dumpsys activity activities | grep -m1 mResumedActivity').includes('com.thevoid.app')) {
  console.log('The Void is not in the foreground - refusing to touch the phone.');
  process.exit(2);
}
const [, W, H] = adb('shell', 'wm size').match(/(\d+)x(\d+)/).map(Number);

const count = () => {
  const sf = adb('shell', 'dumpsys SurfaceFlinger');
  const sv = new Set(sf.match(/SurfaceView - com\.thevoid\.app\/[^\s#)\]]*#\d+/g) || []);
  const all = new Set(sf.match(/com\.thevoid\.app\/[^\s#)\]]*#\d+/g) || []);
  return { sv: sv.size, all: all.size, names: [...sv].sort() };
};

console.log('round  surfaceviews  distinct-app-layers');
let first = null;
for (let i = 0; i <= 6; i++) {
  const c = count();
  if (!first) first = c;
  console.log(`${String(i).padStart(5)}  ${String(c.sv).padStart(12)}  ${String(c.all).padStart(19)}`);
  if (i === 6) { console.log('\nfinal surface layers:'); c.names.forEach((n) => console.log('  ' + n)); break; }
  for (let k = 0; k < 4; k++) {
    adb('shell', `input swipe ${Math.round(W / 2)} ${Math.round(H * 0.75)} ${Math.round(W / 2)} ${Math.round(H * 0.25)} 400`);
    await sleep(200);
  }
  await sleep(1500);
}
