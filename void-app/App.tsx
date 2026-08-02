import { useEffect, useRef, useState } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { Asset } from "expo-asset";
import Constants from "expo-constants";
import * as Sensing from "./modules/expo-void-sensing";
import { ConsentScreen } from "./src/ConsentScreen";

// The existing web UI, bundled as an asset (no UI rewrite).
const VOID_HTML = require("./assets/void.html");
const PROXY_BASE: string =
  (Constants.expoConfig?.extra as any)?.voidProxyBase ?? "";

export default function App() {
  const webRef = useRef<WebView>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [consented, setConsented] = useState<boolean>(
    () => Sensing.getConsent().affectConsent || Sensing.getConsent().nonBiometricFeed,
  );

  useEffect(() => {
    Asset.fromModule(VOID_HTML)
      .downloadAsync()
      .then((a) => setUri(a.localUri ?? a.uri));
  }, []);

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
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      domStorageEnabled
      javaScriptEnabled
      style={styles.web}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: "#04020c", alignItems: "center", justifyContent: "center" },
  web: { flex: 1, backgroundColor: "#04020c" },
});
