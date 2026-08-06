const base = require('./app.json');

// Set VOID_PROXY_BASE at build/start time (for example, your HTTPS deployment
// URL). Keeping it out of source avoids hard-coding a localhost address that
// cannot work from a physical phone.
const configuredBase = process.env.VOID_PROXY_BASE || base.expo.extra?.voidProxyBase || '';

// ── OVER-THE-AIR UI ────────────────────────────────────────────────────────
// URL the app loads void.html from at runtime. Set this and a UI change ships by
// uploading one file — no native rebuild, no store review. Leave it empty and the
// app falls back to the bundled asset, i.e. the old rebuild-every-time behaviour.
//
// Point it at wherever the generated NATIVE build is hosted, e.g.
//   VOID_HTML_URL=https://yourhost.example/void.html
// (that file is The Void/void-app/assets/void.html, produced by `node build.js`).
//
// Must be HTTPS in production: iOS ATS blocks plain HTTP, and an HTTP UI would be
// trivially injectable.
const htmlUrl = process.env.VOID_HTML_URL || base.expo.extra?.voidHtmlUrl || '';

// expo-void-sensing is a hand-written native module (CameraX + Health Connect +
// TensorFlow Lite) that has never compiled — two EAS builds died with
// EAS_BUILD_UNKNOWN_GRADLE_ERROR. It currently lives in native-modules-disabled/
// so Expo does not autolink it (autolinking picks up ANYTHING under modules/ by
// convention — removing the config plugin alone does NOT unlink it, which is why
// the first 'without sensing' build compiled it anyway and failed identically,
// and `expo.autolinking.exclude` does not apply to local modules either).
//
// The plugin entry is dropped when the module directory is absent, so the config
// stays valid in both states rather than pointing at a path that no longer
// exists. Move the folder back into modules/ to re-enable it.
const fs = require('fs');
const path = require('path');
const SENSING_DIR = path.join(__dirname, 'modules', 'expo-void-sensing');
const sensingPresent = fs.existsSync(SENSING_DIR);
const plugins = (base.expo.plugins || []).filter(
  (p) => sensingPresent || !(typeof p === 'string' && p.includes('expo-void-sensing'))
);

module.exports = {
  ...base.expo,
  plugins,
  extra: {
    ...base.expo.extra,
    voidProxyBase: configuredBase.replace(/\/$/, ''),
    voidHtmlUrl: htmlUrl.trim(),
    // EAS project id. `eas project:init` cannot write to a dynamic config, so it
    // lives here by hand. Not a secret - it identifies the project, it does not
    // grant access to it.
    eas: { projectId: '7520e2f4-88ca-4c82-83c1-df7aeed7a5dd' },
  },
};
