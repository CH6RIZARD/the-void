import { useEffect, useRef, useState, useCallback } from "react";
import { View, ActivityIndicator, StyleSheet, AppState } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { Asset } from "expo-asset";
import Constants from "expo-constants";
import * as Sensing from "./modules/expo-void-sensing";
import { ConsentScreen } from "./src/ConsentScreen";

// The web UI, bundled as an asset. This is now only the OFFLINE FALLBACK.
const VOID_HTML = require("./assets/void.html");
const PROXY_BASE: string =
  (Constants.expoConfig?.extra as any)?.voidProxyBase ?? "";

// ── OVER-THE-AIR UI ────────────────────────────────────────────────────────
// The app used to load ONLY the bundled asset, which meant every change to
// void.html — a feed rule, a filter, a layout fix — required a full native
// rebuild and a store round-trip before a single device saw it.
//
// Now the WebView loads the UI from a URL and the bundle is the fallback. Ship a
// UI change by uploading one file; every device picks it up on next launch or
// foreground. No rebuild, no review.
//
// A native rebuild is still needed for NATIVE changes only — new native modules,
// permissions, or SDK upgrades. Those are rare; UI changes are not.
const HTML_URL: string =
  (Constants.expoConfig?.extra as any)?.voidHtmlUrl ?? "";
// Kept short: this runs on a cold start, and a slow host must not hold the app on
// a spinner. Miss the window and we render the bundled copy instead.
const REMOTE_TIMEOUT_MS = 4000;

async function resolveRemote(): Promise<string | null> {
  if (!HTML_URL) return null;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), REMOTE_TIMEOUT_MS);
    // cache:'no-store' on the probe so a stale CDN copy cannot pin an old UI.
    const r = await fetch(HTML_URL, { method: "GET", cache: "no-store", signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const body = await r.text();
    // Guard against a captive portal or an error page being served as 200 — those
    // would replace the app with a login screen and look like a total failure.
    if (!/id=["']void-feed["']/.test(body)) return null;
    return HTML_URL;
  } catch {
    return null;
  }
}

export default function App() {
  const webRef = useRef<WebView>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [source, setSource] = useState<"remote" | "bundled">("bundled");
  const [consented, setConsented] = useState<boolean>(
    () => Sensing.getConsent().affectConsent || Sensing.getConsent().nonBiometricFeed,
  );

  const load = useCallback(async () => {
    const remote = await resolveRemote();
    if (remote) { setSource("remote"); setUri(`${remote}${remote.includes("?") ? "&" : "?"}v=${Date.now()}`); return; }
    const a = await Asset.fromModule(VOID_HTML).downloadAsync();
    setSource("bundled");
    setUri(a.localUri ?? a.uri);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Re-check on foreground so a UI update lands without the user reinstalling —
  // only when we are already on the remote copy, so returning to the app offline
  // never yanks a working screen out from under them.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active" && source === "remote") load();
    });
    return () => sub.remove();
  }, [load, source]);

  // Push the latest quantized AffectState (or nothing) into the web ranker.
  useEffect(() => {
    if (!consented) return;
    Sensing.start().catch(() => {});
    const sub = Sensing.addAffectListener((state) => {
      webRef.current?.injectJavaScript(
        `window.__VOID_AFFECT__ && window.__VOID_AFFECT__(${JSON.stringify(state)}); true;`,
      );
    });
    return () => {
      sub.remove();
      Sensing.stop().catch(() => {});
    };
  }, [consented]);

  // Bridge messages from the web UI (impression marks; affect pulls).
  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === "impression") Sensing.markImpression(msg.impressionId, msg.itemId);
      if (msg.type === "getAffect") {
        const s = Sensing.getAffectState();
        webRef.current?.injectJavaScript(
          `window.__VOID_AFFECT__ && window.__VOID_AFFECT__(${JSON.stringify(s)}); true;`,
        );
      }
    } catch {}
  };

  if (!consented) {
    return (
      <ConsentScreen
        onDone={(state) => setConsented(state.affectConsent || state.nonBiometricFeed)}
      />
    );
  }
  if (!uri) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#c9a84c" />
      </View>
    );
  }

  // Expose the proxy base + a bridge hook to the existing web app before it runs.
  const injectedBeforeLoad = `
    // Never overwrite a working saved proxy with an empty build-time value.
    if (${JSON.stringify(Boolean(PROXY_BASE))}) window.localStorage.setItem('void_proxy', ${JSON.stringify(PROXY_BASE)});
    window.__VOID_NATIVE__ = true;
    window.__voidPost = function(o){ window.ReactNativeWebView.postMessage(JSON.stringify(o)); };
    true;`;

  return (
    <WebView
      ref={webRef}
      source={{ uri }}
      originWhitelist={["*"]}
      injectedJavaScriptBeforeContentLoaded={injectedBeforeLoad}
      onMessage={onMessage}
      // If the remote copy fails mid-load (dropped connection, bad deploy), fall
      // back to the bundled one rather than showing the WebView's error page.
      onError={() => {
        if (source === "remote") {
          Asset.fromModule(VOID_HTML).downloadAsync()
            .then((a) => { setSource("bundled"); setUri(a.localUri ?? a.uri); })
            .catch(() => {});
        }
      }}
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      domStorageEnabled
      javaScriptEnabled
      // localStorage must survive across loads — the feed's seen-set, cursors and
      // interest model all live there, and the remote URL is the same origin each time.
      sharedCookiesEnabled
      cacheEnabled
      style={styles.web}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: "#04020c", alignItems: "center", justifyContent: "center" },
  web: { flex: 1, backgroundColor: "#04020c" },
});
