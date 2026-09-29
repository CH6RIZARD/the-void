#!/usr/bin/env node
// Get past the Jump In flow, anonymously, so the harness measures the app.
//
// A clean install always starts here, and every measurement taken straight after
// an install was really a measurement of the sign-in card. Worse, the first
// attempt tapped blind coordinates and landed in a different app on the phone
// entirely - so this only ever taps a node it can see, inside our package.
//
// Anonymous throughout: the new-user path, nothing typed, no account linked.
//
//   node scripts/onboard.mjs          exit 0 once the app proper is up
//   node scripts/onboard.mjs --check  report where we are, tap nothing
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { dumpUi, screenText, tapText } from './lib/ui.mjs';

const PKG = 'com.thevoid.app';
const adb = (() => {
  const g = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe') : null;
  return g && existsSync(g) ? g : 'adb';
})();
const sh = (args) => execFileSync(adb, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const sleep = (ms) => execFileSync(process.execPath, ['-e', `setTimeout(()=>{},${ms})`], { stdio: 'ignore' });

// The flow's own words, in the order it says them. Matching on what is on screen
// beats counting steps: the flow's length is not this script's business.
const ONBOARDING = /JUMP INTO THE VOID|CLAIM A SIGNAL|EVERY LIGHT IS SOMEONE|WELCOME BACK|IDENTITY ·|ALREADY HAVE A CARD|WINDOWS OPEN|SIGN IN|NEW USER|ENTER PASSWORD|FOUR WAYS IN/;

// The forward button on each screen, most specific first. Anonymous only: the
// account buttons (APPLE, GOOGLE, EMAIL) are deliberately absent.
const FORWARD = [
  /^JUMP INTO THE VOID$/i,
  /^CLAIM A SIGNAL$/i,
  /^NEW USER$/i,
  /^(CONTINUE|NEXT|DONE|ENTER|SKIP|LATER|NOT NOW)$/i,
  /^(IGNITE|LIGHT IT|LET.?S GO|START)$/i,
];

/** Which screen are we on? */
function where() {
  const ui = dumpUi();
  if (!ui.pkg) return { state: 'unknown', ui };
  if (ui.pkg !== PKG) return { state: 'other-app', ui };
  const text = screenText(ui);
  if (ONBOARDING.test(text)) return { state: 'onboarding', ui, text };
  return { state: 'app', ui, text };
}

function main() {
  const checkOnly = process.argv.includes('--check');
  let last = '';
  for (let i = 0; i < 24; i++) {
    const w = where();

    if (w.state === 'other-app') {
      console.error(`another app is in front (${w.ui.pkg}) - not tapping`);
      process.exit(2);
    }
    if (w.state === 'unknown') {
      console.error('could not read the screen');
      process.exit(2);
    }
    if (w.state === 'app') {
      console.log(checkOnly ? 'app' : `through the flow after ${i} steps`);
      process.exit(0);
    }
    if (checkOnly) {
      console.log('onboarding');
      process.exit(1);
    }

    // Tap the first forward button this screen actually offers.
    let tapped = null;
    for (const re of FORWARD) {
      tapped = tapText(w.ui, re, PKG);
      if (tapped) break;
    }
    if (!tapped) {
      // No named button: the flow's own CTA is the widest clickable node low on
      // the screen. Still a node we can see, never a guessed coordinate.
      const low = w.ui.nodes
        .filter((n) => n.pkg === PKG && n.clickable && n.w > 120)
        .sort((a, b) => b.y - a.y || b.w - a.w)[0];
      if (low) {
        sh(['shell', 'input', 'tap', String(low.x), String(low.y)]);
        tapped = low;
      }
    }
    if (!tapped) {
      console.error('onboarding, but nothing on it to press');
      process.exit(3);
    }

    const sig = (tapped.text || tapped.desc || '') + '@' + tapped.y;
    if (sig === last) sleep(1200); // the same button twice: give it longer
    last = sig;
    sleep(1600);
  }
  console.error('still in the flow after 24 steps');
  process.exit(4);
}

main();
