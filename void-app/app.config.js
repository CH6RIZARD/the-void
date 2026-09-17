const fs = require('fs');
const path = require('path');

// ── Native React Native app (Expo SDK 57, expo-router) ─────────────────────
// The WebView shell that loaded void.html is gone. void2-final.html remains the
// design/behaviour source of truth, but nothing from it is bundled or loaded.

// Optional backend overrides (env at build time > app.json extra > built-in
// defaults in src/lib/config.ts, which mirror void2-final.html).

// expo-void-sensing (CameraX + ML Kit face detection + BLE heart rate) lives in
// modules/ and is autolinked by convention. If it ever has to be disabled, move
// the folder OUT of modules/; the plugin entry is dropped automatically when the
// directory is absent.
const sensingPresent = fs.existsSync(path.join(__dirname, 'modules', 'expo-void-sensing'));

// Config plugins live in node_modules. The dev box is disk-constrained and has
// no node_modules, but the EAS CLI still reads this config locally to find the
// project id before uploading. The EAS worker installs dependencies first and
// sets EAS_BUILD=true, so there every plugin is kept and must resolve.
const canResolvePlugins = (() => {
  if (process.env.EAS_BUILD) return true;
  try {
    require.resolve('expo/config-plugins', { paths: [__dirname] });
    return true;
  } catch {
    return false;
  }
})();
if (!canResolvePlugins) {
  console.warn('[app.config] node_modules missing: config plugins skipped for this LOCAL read only (EAS workers apply them).');
}

// Function form: Expo passes the static app.json `expo` object in as `config`.
module.exports = ({ config }) => {
  const extraBase = config.extra || {};
  const proxyBase = process.env.VOID_PROXY_BASE || extraBase.voidProxyBase || '';
  const supabaseUrl = process.env.VOID_SUPABASE_URL || extraBase.supabaseUrl || '';
  const supabaseAnonKey = process.env.VOID_SUPABASE_ANON_KEY || extraBase.supabaseAnonKey || '';
  const plugins = (config.plugins || [])
    .filter((p) => sensingPresent || !(typeof p === 'string' && p.includes('expo-void-sensing')))
    .filter(() => canResolvePlugins);
  return {
  ...config,
  plugins,
  extra: {
    ...extraBase,
    voidProxyBase: proxyBase.replace(/\/$/, ''),
    supabaseUrl: supabaseUrl.trim(),
    supabaseAnonKey: supabaseAnonKey.trim(),
    router: { origin: false },
    // EAS project id (not a secret; identifies the project).
    eas: { projectId: '7520e2f4-88ca-4c82-83c1-df7aeed7a5dd' },
  },
  };
};
