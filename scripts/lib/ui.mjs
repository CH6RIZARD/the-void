// Reading the screen as a view tree instead of as pixels.
//
// The harness used to find things by sampling brightness at fractions of the
// screen height. That guessed wrong about the nav bar (thin outline icons make
// no wide bright run), and worse, a blind tap at a guessed coordinate once
// landed in a completely different app on the phone. uiautomator gives the real
// tree: the text on screen, where each node is, and - the part that matters -
// which package it belongs to, so nothing here can drive someone else's UI.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const adb = (() => {
  const g = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe') : null;
  return g && existsSync(g) ? g : 'adb';
})();
const sh = (args) => execFileSync(adb, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** Every node with text or a content description, with its centre point. */
export function dumpUi() {
  let xml = '';
  for (let attempt = 0; attempt < 3 && !xml; attempt++) {
    try {
      sh(['shell', 'uiautomator', 'dump', '/sdcard/void-ui.xml']);
      xml = sh(['shell', 'cat', '/sdcard/void-ui.xml']);
    } catch {
      xml = '';
    }
  }
  if (!xml) return { pkg: null, nodes: [] };

  const nodes = [];
  let pkg = null;
  // One regex over the flat node list: uiautomator emits self-closing elements
  // with every attribute inline, so there is no tree to walk for this purpose.
  const re = /<node\b([^>]*)\/?>/g;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = m[1];
    const get = (k) => {
      const a = new RegExp(`\\b${k}="([^"]*)"`).exec(attrs);
      return a ? a[1] : '';
    };
    const text = get('text');
    const desc = get('content-desc');
    const p = get('package');
    if (p && !pkg) pkg = p;
    const bounds = get('bounds');
    const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(bounds);
    if (!b) continue;
    const [x0, y0, x1, y1] = [+b[1], +b[2], +b[3], +b[4]];
    if (!text && !desc) continue;
    nodes.push({
      text,
      desc,
      pkg: p,
      clickable: get('clickable') === 'true',
      x: Math.round((x0 + x1) / 2),
      y: Math.round((y0 + y1) / 2),
      w: x1 - x0,
      h: y1 - y0,
    });
  }
  return { pkg, nodes };
}

/** All on-screen text, uppercased, as one string - for "does this screen say X". */
export function screenText(ui) {
  return ui.nodes.map((n) => `${n.text} ${n.desc}`).join(' | ').toUpperCase();
}

/**
 * Tap the first node whose text matches, but only inside `pkg`.
 * Returns what was tapped, or null. Never taps on a guess.
 */
export function tapText(ui, pattern, pkg) {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i');
  const hit = ui.nodes.find((n) => (!pkg || n.pkg === pkg) && (re.test(n.text) || re.test(n.desc)));
  if (!hit) return null;
  sh(['shell', 'input', 'tap', String(hit.x), String(hit.y)]);
  return hit;
}

/** Is this package the one in front? */
export function foreground(pkg) {
  try {
    return sh(['shell', 'dumpsys', 'activity', 'activities']).includes(`mResumedActivity`) &&
      sh(['shell', 'dumpsys', 'activity', 'activities']).split('mResumedActivity')[1]?.slice(0, 120).includes(pkg);
  } catch {
    return false;
  }
}
