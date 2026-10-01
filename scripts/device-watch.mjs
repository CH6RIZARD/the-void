#!/usr/bin/env node
/**
 * device-watch.mjs — watches the PHONE, not the code, and keeps watching.
 *
 * WHY THIS EXISTS
 * Every performance fix in this app has been judged by a person looking at a
 * phone and typing what they saw. That is slow, it is exhausting, and the same
 * faults get reported five times because nothing is measuring them between
 * reports. This watches continuously and writes down what it finds.
 *
 * It looks at the SCREEN, because that is where the problem is:
 *
 *   - FILL        how many live tiles actually have a picture, as a fraction of
 *                 the tiles on screen. "The wall is never full" is this number.
 *   - TIME TO FILL  how long after opening the tab until the wall stops changing.
 *   - GLOBE       whether the sphere has drawn at all, and whether it is textured
 *                 (a lit globe and a black circle are easy to tell apart).
 *   - JANK        frame timings from the OS, around a scripted scroll.
 *   - FAULTS      decoder failures, fatal signals and app deaths from logcat.
 *
 * None of that needs a language model: "is this rectangle black" is arithmetic,
 * and arithmetic does not hallucinate. If Ollama is reachable AND a vision model
 * is installed, each cycle also asks it to describe the screen in one line,
 * which catches the things arithmetic will not - a wrong layout, text where a
 * picture should be. That is a bonus, never the measurement.
 *
 * IT DOES NOT STOP. The loop ends only when scripts/device-watch.STOP exists, or
 * the process is killed. Errors in a cycle are logged and the next cycle runs.
 *
 *   node scripts/device-watch.mjs                 # forever, both phones
 *   node scripts/device-watch.mjs --serial R5...  # one phone
 *   node scripts/device-watch.mjs --once          # a single pass
 *   touch scripts/device-watch.STOP               # ask it to stop
 */
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, 'device-watch-shots');
const JSONL = path.join(HERE, 'device-watch.jsonl');
const REPORT = path.join(HERE, 'device-watch.report.md');
const STOP = path.join(HERE, 'device-watch.STOP');
const ADB = process.env.ADB_PATH || 'D:\\android-sdk\\platform-tools\\adb.exe';
const PKG = 'com.thevoid.app';

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const has = (k) => process.argv.includes('--' + k);
const ONCE = has('once');
const INTERVAL_S = parseInt(arg('interval', '120'), 10);
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

const sh = (args, opts = {}) => execFileSync(ADB, args, { encoding: 'utf8', timeout: 60000, ...opts }).trim();
const shq = (args) => {
  try {
    return sh(args);
  } catch {
    return '';
  }
};

function devices() {
  const only = arg('serial', '');
  if (only) return [only];
  return shq(['devices'])
    .split('\n')
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter((p) => p[1] === 'device')
    .map((p) => p[0]);
}

// ─── reading the screen ──────────────────────────────────────────────────
/** Raw RGBA straight off the framebuffer - no PNG decode, no dependencies. */
function screen(serial) {
  const buf = execFileSync(ADB, ['-s', serial, 'exec-out', 'screencap'], { maxBuffer: 64 << 20, timeout: 45000 });
  // screencap: w, h, format as little-endian uint32, then RGBA rows.
  const w = buf.readUInt32LE(0);
  const h = buf.readUInt32LE(4);
  if (!w || !h || w > 8000 || h > 8000) throw new Error('unexpected framebuffer ' + w + 'x' + h);
  // Android 8+ writes a 16-byte header (w,h,format,colorSpace); older writes 12.
  const px = buf.length - w * h * 4;
  if (px < 0) throw new Error('short framebuffer');
  return { w, h, data: buf.subarray(px), stride: w * 4 };
}

/** Mean luminance and how much the region varies - a picture varies, a hole does not. */
function regionStats(img, x0, y0, x1, y1) {
  let n = 0, sum = 0, sumSq = 0, lit = 0;
  const step = 4; // every 4th pixel is plenty and keeps a cycle cheap
  for (let y = Math.max(0, y0); y < Math.min(img.h, y1); y += step) {
    for (let x = Math.max(0, x0); x < Math.min(img.w, x1); x += step) {
      const i = y * img.stride + x * 4;
      const l = (img.data[i] * 299 + img.data[i + 1] * 587 + img.data[i + 2] * 114) / 1000;
      sum += l;
      sumSq += l * l;
      if (l > 36) lit++;
      n++;
    }
  }
  if (!n) return { mean: 0, sd: 0, litFrac: 0 };
  const mean = sum / n;
  return { mean, sd: Math.sqrt(Math.max(0, sumSq / n - mean * mean)), litFrac: lit / n };
}

/**
 * A tile counts as SHOWING A PICTURE when it is both lit and varied.
 *
 * Either test alone is wrong: the app's background is near-black so a dark tile
 * passes a variance test on noise alone, and a flat loader panel is lit but
 * uniform. Live video is both - and a parked tile holding its last frame is
 * equally both, which is correct, because the reader cannot tell them apart and
 * neither should this.
 */
const hasPicture = (s) => s.litFrac > 0.18 && s.sd > 14;

/** The wall is the lower part of the globe screen; sample it as a 2-wide grid. */
function wallFill(img) {
  const top = Math.round(img.h * 0.44); // under the globe
  const bottom = Math.round(img.h * 0.88); // above the nav pill
  const cols = 2;
  const rowH = Math.round((bottom - top) / 3);
  const cells = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = Math.round((img.w / cols) * c) + 8;
      const x1 = Math.round((img.w / cols) * (c + 1)) - 8;
      const y0 = top + r * rowH + 6;
      const y1 = top + (r + 1) * rowH - 6;
      cells.push(hasPicture(regionStats(img, x0, y0, x1, y1)));
    }
  }
  return { tiles: cells.length, withPicture: cells.filter(Boolean).length };
}

/** The globe sits in the upper third. Drawn vs black, and textured vs flat. */
/**
 * Drawn, and showing the NIGHT MAP rather than the fallback.
 *
 * Variance alone called a flat purple fallback sphere "textured" - it is blocky,
 * and blocky varies. The night map is distinguishable by COLOUR: it is dark blue
 * and black with warm city lights, so its blue channel leads and its red channel
 * is low on average. The fallback is a violet gradient, where red and blue run
 * together. Comparing the channels tells them apart; counting variance does not.
 */
function globeState(img) {
  const x0 = Math.round(img.w * 0.12), y0 = Math.round(img.h * 0.09);
  const x1 = Math.round(img.w * 0.88), y1 = Math.round(img.h * 0.4);
  const st = regionStats(img, x0, y0, x1, y1);
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y < y1; y += 4) {
    for (let x = x0; x < x1; x += 4) {
      const i = y * img.stride + x * 4;
      r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++;
    }
  }
  const R = n ? r / n : 0, G = n ? g / n : 0, B = n ? b / n : 0;
  // Night map: blue clearly ahead of red. Violet fallback: red close to blue.
  const mapLike = B > R * 1.55 && st.sd > 14;
  return { drawn: st.litFrac > 0.08, textured: mapLike, fallbackLikely: st.litFrac > 0.08 && !mapLike,
           mean: +st.mean.toFixed(1), sd: +st.sd.toFixed(1), rgb: [Math.round(R), Math.round(G), Math.round(B)] };
}

// ─── what the OS knows ───────────────────────────────────────────────────
/**
 * PER-FRAME TIMING, WHICH IS WHAT LAG ACTUALLY IS.
 *
 * A screenshot cannot show a stutter and an average cannot either - 60fps with
 * one 400ms hitch averages fine and feels broken. framestats gives the last 120
 * frames with nanosecond timestamps, so this reports the distribution: how many
 * frames missed the 16.7ms budget, and how bad the worst ones were. That is the
 * number that matches what a thumb feels.
 */
function frameTimeline(serial) {
  const out = shq(['-s', serial, 'shell', 'dumpsys', 'gfxinfo', PKG, 'framestats']);
  const rows = out.split('\n').filter((l) => /^0,/.test(l.trim()));
  const ms = [];
  for (const r of rows) {
    const c = r.trim().split(',').map(Number);
    // INTENDED_VSYNC is column 1, FRAME_COMPLETED is the last populated column.
    if (c.length < 14 || !c[1]) continue;
    const done = c[13] || c[c.length - 1];
    if (!done || done < c[1]) continue;
    ms.push((done - c[1]) / 1e6);
  }
  if (!ms.length) return { frames: 0 };
  ms.sort((a, b) => a - b);
  const pick = (p) => +ms[Math.min(ms.length - 1, Math.floor(ms.length * p))].toFixed(1);
  return {
    frames: ms.length,
    over16: ms.filter((v) => v > 16.7).length,
    over100: ms.filter((v) => v > 100).length,
    p50: pick(0.5),
    p90: pick(0.9),
    worst: +ms[ms.length - 1].toFixed(1),
  };
}

/**
 * A filmstrip across one scroll, so the lag can be LOOKED at rather than only
 * counted - six frames, which is enough to see a wall that does not move with
 * the finger or tiles that blink out as they pass.
 */
async function filmstrip(serial) {
  const sz = shq(['-s', serial, 'shell', 'wm', 'size']).match(/(\d+)x(\d+)/);
  const W = sz ? +sz[1] : 720;
  const H = sz ? +sz[2] : 1560;
  const shots = [];
  // A slow swipe, so the frames land across the motion rather than after it.
  try {
    execFileSync(ADB, ['-s', serial, 'shell', 'input', 'swipe', String(Math.round(W / 2)), String(Math.round(H * 0.8)), String(Math.round(W / 2)), String(Math.round(H * 0.3)), '1400'], { timeout: 20000, stdio: 'ignore' });
  } catch {}
  for (let i = 0; i < 6; i++) {
    try {
      const png = execFileSync(ADB, ['-s', serial, 'exec-out', 'screencap', '-p'], { maxBuffer: 64 << 20, timeout: 20000 });
      const p = path.join(SHOTS, 'strip-' + i + '.png');
      writeFileSync(p, png);
      shots.push(p);
    } catch {}
  }
  return shots;
}
function frameStats(serial) {
  const out = shq(['-s', serial, 'shell', 'dumpsys', 'gfxinfo', PKG]);
  const num = (re) => {
    const m = out.match(re);
    return m ? parseFloat(m[1]) : null;
  };
  return {
    total: num(/Total frames rendered:\s*(\d+)/),
    janky: num(/Janky frames:\s*(\d+)/),
    jankPct: num(/Janky frames:\s*\d+\s*\(([\d.]+)%\)/),
    p90: num(/90th percentile:\s*(\d+)ms/),
    p95: num(/95th percentile:\s*(\d+)ms/),
  };
}

function faults(serial) {
  const log = shq(['-s', serial, 'logcat', '-d', '-t', '1200']);
  const count = (re) => (log.match(re) || []).length;
  return {
    decoderFailures: count(/decoder failed|MediaCodec error|InsufficientResources/gi),
    fatal: count(/FATAL EXCEPTION|Fatal signal/gi),
    globeLines: (log.match(/\[globe\][^\n]*/g) || []).slice(-3),
  };
}

const alive = (serial) => !!shq(['-s', serial, 'shell', 'pidof', PKG]);

// ─── the optional extra pair of eyes ─────────────────────────────────────
let visionModel = null;
async function findVisionModel() {
  try {
    const r = await fetch(OLLAMA_URL + '/api/tags', { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return null;
    const names = ((await r.json()).models || []).map((m) => m.name || '');
    return names.find((n) => /llava|vision|moondream|bakllava|minicpm/i.test(n)) || null;
  } catch {
    return null;
  }
}

async function describe(serial) {
  if (!visionModel) return null;
  try {
    const png = execFileSync(ADB, ['-s', serial, 'exec-out', 'screencap', '-p'], { maxBuffer: 64 << 20, timeout: 45000 });
    const r = await fetch(OLLAMA_URL + '/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: visionModel,
        prompt:
          'This is a phone screenshot of a live-video app. In ONE sentence: how many tiles show real video, how many are blank or loading, and is the globe drawn and textured? Be literal.',
        images: [png.toString('base64')],
        stream: false,
        options: { temperature: 0 },
      }),
      signal: AbortSignal.timeout(180000),
    });
    if (!r.ok) return null;
    return String((await r.json()).response || '').trim().slice(0, 300);
  } catch {
    return null;
  }
}

// ─── a pass over one phone ───────────────────────────────────────────────
/** Whatever is on screen right now, by package. */
function foreground(serial) {
  const out = shq(['-s', serial, 'shell', 'dumpsys', 'activity', 'activities']);
  const m = out.match(/mResumedActivity[^\n]*?([a-zA-Z0-9_.]+)\/[^\s}]+/);
  return m ? m[1] : '';
}

async function inspect(serial) {
  const model = shq(['-s', serial, 'shell', 'getprop', 'ro.product.model']);

  // THE PHONE BELONGS TO WHOEVER IS HOLDING IT.
  //
  // This used to force-launch the app and swipe every cycle. That takes the
  // screen away mid-use, and it also measures nonsense: with a launcher or
  // another app in front, the brightness-and-variance test counts wallpaper as
  // live video and reports a full wall. One such reading was logged as 6/6 while
  // the phone was sitting on an app-drawer search.
  //
  // So: measure only when The Void is already in front, and never bring it
  // there. A skipped cycle is worth far more than a wrong number.
  const fg = foreground(serial);
  if (fg !== PKG) return { serial, model, skipped: 'in use - foreground is ' + (fg || 'unknown') };

  // GO TO THE GLOBE TAB FIRST.
  //
  // This drove its scroll on whatever screen happened to be open, which was
  // usually the void feed - so it was measuring the wrong thing entirely. The
  // globe and the wall under it are the subject; the feed is not.
  const sz0 = shq(['-s', serial, 'shell', 'wm', 'size']).match(/(d+)x(d+)/);
  const NW = sz0 ? +sz0[1] : 720, NH = sz0 ? +sz0[2] : 1560;
  // The nav pill is five icons across the bottom; the globe is the second.
  shq(['-s', serial, 'shell', 'input', 'tap', String(Math.round(NW * 0.338)), String(Math.round(NH * 0.883))]);
  await new Promise((r) => setTimeout(r, 2500));

  // Reset frame stats, drive a scroll, then read them: jank DURING a scroll is
  // the number that matters, and an idle app reports nothing at all.
  shq(['-s', serial, 'shell', 'dumpsys', 'gfxinfo', PKG, 'reset']);
  const size = shq(['-s', serial, 'shell', 'wm', 'size']).match(/(\d+)x(\d+)/);
  const W = size ? +size[1] : 720;
  const H = size ? +size[2] : 1560;
  for (let i = 0; i < 3; i++) {
    shq(['-s', serial, 'shell', 'input', 'swipe', String(W / 2), String(H * 0.8), String(W / 2), String(H * 0.35), '320']);
    await new Promise((r) => setTimeout(r, 700));
  }
  await new Promise((r) => setTimeout(r, 1200));

  // KEEP THE PICTURE, NOT JUST THE ARITHMETIC.
  //
  // The numbers say how many tiles are blank; they cannot say that the layout is
  // wrong, that a label sits over a video, or that the globe is the wrong colour.
  // Claude reads this file each cycle and looks at it, which is the difference
  // between patching a metric and patching what is actually on the screen.
  try {
    const png = execFileSync(ADB, ['-s', serial, 'exec-out', 'screencap', '-p'], { maxBuffer: 64 << 20, timeout: 45000 });
    writeFileSync(path.join(SHOTS, 'latest-' + serial + '.png'), png);
    writeFileSync(path.join(SHOTS, 'latest.png'), png);
  } catch {}

  const img = screen(serial);
  const fill = wallFill(img);
  const globe = globeState(img);
  const frames = frameStats(serial);
  const timeline = frameTimeline(serial);
  const strip = await filmstrip(serial);
  const f = faults(serial);
  const vision = await describe(serial);

  return { serial, model, w: img.w, h: img.h, fill, globe, frames, timeline, strip: strip.length, faults: f, vision };
}

function writeReport(rows) {
  const lines = ['# device-watch', '', `Last pass ${new Date().toISOString()}`, ''];
  for (const r of rows) {
    lines.push(`## ${r.model || r.serial} (${r.serial})`);
    if (r.skipped) {
      lines.push('', '- **not measured this cycle** - ' + r.skipped + '. The app was not in front, and measuring another app would produce a false reading.', '');
      continue;
    }
    if (r.error) {
      lines.push('', '- could not read: ' + r.error, '');
      continue;
    }
    lines.push(
      '',
      `- wall: **${r.fill.withPicture}/${r.fill.tiles} tiles showing a picture**`,
      `- globe: ${r.globe.drawn ? 'drawn' : '**NOT DRAWN**'}, ${r.globe.textured ? 'night map' : '**FALLBACK TEXTURE (purple)**'} (rgb ${(r.globe.rgb||[]).join('/')}, sd ${r.globe.sd})`,
      `- frames during a scroll: ${r.frames.total ?? '?'} rendered, ${r.frames.jankPct ?? '?'}% janky, p90 ${r.frames.p90 ?? '?'}ms, p95 ${r.frames.p95 ?? '?'}ms`,
      `- per-frame timing: ${r.timeline?.frames ?? 0} frames, ${r.timeline?.over16 ?? '?'} over 16.7ms, ${r.timeline?.over100 ?? '?'} over 100ms, p50 ${r.timeline?.p50 ?? '?'}ms, p90 ${r.timeline?.p90 ?? '?'}ms, worst ${r.timeline?.worst ?? '?'}ms`,
      `- filmstrip: scripts/device-watch-shots/strip-0..5.png (one scroll)`,
      `- decoder failures in the last 1200 log lines: ${r.faults.decoderFailures}; fatals: ${r.faults.fatal}`,
    );
    if (r.faults.globeLines?.length) lines.push(`- globe log: ${r.faults.globeLines.join(' | ')}`);
    if (r.vision) lines.push(`- vision: ${r.vision}`);
    lines.push('');
  }
  writeFileSync(REPORT, lines.join('\n'));
}

function log(line) {
  const s = `[${new Date().toISOString()}] ${line}`;
  console.log(s);
  try {
    appendFileSync(path.join(HERE, 'device-watch.log'), s + '\n');
  } catch {
    /* the log is a convenience */
  }
}

(async () => {
  if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });
  visionModel = await findVisionModel();
  log(`device-watch starting · every ${INTERVAL_S}s · vision ${visionModel || 'none (arithmetic does the measuring)'} · stop with ${path.basename(STOP)}`);

  for (let n = 1; ; n++) {
    if (existsSync(STOP)) {
      log('STOP file found - exiting');
      break;
    }
    const rows = [];
    for (const d of devices()) {
      try {
        rows.push(await inspect(d));
      } catch (e) {
        rows.push({ serial: d, error: String(e.message || e).slice(0, 160) });
      }
    }
    for (const r of rows) {
      if (r.skipped) {
        log(`${r.model || r.serial}: skipped - ${r.skipped}`);
        continue;
      }
      if (r.error) {
        log(`${r.serial}: ${r.error}`);
        continue;
      }
      log(
        `${r.model}: wall ${r.fill.withPicture}/${r.fill.tiles}` +
          ` · globe ${r.globe.drawn ? (r.globe.textured ? 'textured' : 'FLAT') : 'NOT DRAWN'}` +
          ` · jank ${r.frames.jankPct ?? '?'}% p90 ${r.frames.p90 ?? '?'}ms` +
          ` · decoder fails ${r.faults.decoderFailures}`,
      );
      try {
        appendFileSync(JSONL, JSON.stringify({ t: Date.now(), ...r }) + '\n');
      } catch {}
    }
    writeReport(rows);
    if (ONCE) break;
    await new Promise((r) => setTimeout(r, INTERVAL_S * 1000));
  }
})();
