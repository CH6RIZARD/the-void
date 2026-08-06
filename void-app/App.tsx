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
// A real build is ~470KB. A captive-portal login page or a host error page served
// as 200 is a few KB — the size alone separates them, which is the whole reason
// the probe can be a HEAD.
const MIN_PLAUSIBLE_BYTES = 100_000;

// The probe used to be a GET: it pulled the entire ~470KB document over the wire
// purely to regex one attribute out of it, threw the body away, and then handed
// the URL to the WebView — which downloaded the SAME 470KB a second time. Two full
// transfers, in series, before a single pixel. A HEAD answers the same question
// (is a plausible build there, and which version) in one round trip and no body.
type Remote = { url: string; tag: string };
async function probeRemote(): Promise<Remote | null> {
  if (!HTML_URL) return null;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), REMOTE_TIMEOUT_MS);
    const r = await fetch(HTML_URL, { method: "HEAD", cache: "no-store", signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const type = r.headers.get("content-type") || "";
    if (!/text\/html/i.test(type)) return null;
    const len = Number(r.headers.get("content-length") || 0);
    // Absent length means a chunked response, which is legitimate — accept it and
    // let onError handle a load that turns out to be broken.
    if (len && len < MIN_PLAUSIBLE_BYTES) return null;
    // Version identity, in preference order. This is what decides whether a
    // foreground is allowed to reload — so it must change when, and only when,
    // the deployed file changes.
    const tag =
      r.headers.get("etag") || r.headers.get("last-modified") || String(len) || "1";
    return { url: HTML_URL, tag };
  } catch {
    return null;
  }
}

// Stable per version, so the WebView's HTTP cache can actually serve a repeat
// launch. The old `?v=${Date.now()}` was a new URL on every single resolve, which
// guaranteed a cache miss forever and made the cacheEnabled prop decorative.
const remoteUri = (r: Remote) =>
  `${r.url}${r.url.includes("?") ? "&" : "?"}v=${encodeURIComponent(r.tag)}`;

export default function App() {
  const webRef = useRef<WebView>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [source, setSource] = useState<"remote" | "bundled">("bundled");
  const [consented, setConsented] = useState<boolean>(
    () => Sensing.getConsent().affectConsent || Sensing.getConsent().nonBiometricFeed,
  );

  // The version tag currently rendering. A foreground that finds this same tag
  // still deployed changes NOTHING — see the AppState effect below.
  const tagRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    const remote = await probeRemote();
    if (remote) {
      tagRef.current = remote.tag;
      setSource("remote");
      setUri(remoteUri(remote));
      return;
    }
    const a = await Asset.fromModule(VOID_HTML).downloadAsync();
    setSource("bundled");
    setUri(a.localUri ?? a.uri);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Re-check on foreground so a UI update lands without the user reinstalling —
  // only when we are already on the remote copy, so returning to the app offline
  // never yanks a working screen out from under them.
  //
  // This used to call load() on EVERY foreground, and load() always built a new
  // `?v=${Date.now()}` URI. A changed uri prop remounts the WebView's source, so
  // every single resume — including a two-second glance at a notification — threw
  // the entire app away and cold-started it: re-parse 470KB, re-run boot, re-connect
  // every stream, lose scroll position and lose the feed. That is what "unusably
  // slow when switching back to the app" was.
  //
  // Now a resume costs one HEAD. The URI is replaced only when the deployed file
  // is genuinely a different version; otherwise the running app is left alone.
  useEffect(() => {
    const sub = AppState.addEventListener("change", async (s) => {
      if (s !== "active" || source !== "remote") return;
      const remote = await probeRemote();
      if (!remote) return;                       // offline / host down — keep what works
      if (remote.tag === tagRef.current) return; // same build — do not touch the WebView
      tagRef.current = remote.tag;
      setUri(remoteUri(remote));
    });
    return () => sub.remove();
  }, [source]);

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
