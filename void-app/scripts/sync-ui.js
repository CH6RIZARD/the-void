// Keeps assets/void.html in lockstep with the canonical web UI so the app can
// never bundle a stale build. Runs on prestart/preios/preandroid/prebuild/build:*.
const fs = require("fs");
const path = require("path");

const SRC = path.resolve(__dirname, "..", "..", "void2-final.html");
const DEST = path.resolve(__dirname, "..", "assets", "void.html");

if (!fs.existsSync(SRC)) {
  console.error(`[sync-ui] source UI not found: ${SRC}`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(DEST), { recursive: true });

const src = fs.readFileSync(SRC);
const changed = !fs.existsSync(DEST) || !fs.readFileSync(DEST).equals(src);
if (changed) {
  fs.writeFileSync(DEST, src);
  console.log(`[sync-ui] updated assets/void.html (${src.length} bytes)`);
} else {
  console.log("[sync-ui] assets/void.html already current");
}
