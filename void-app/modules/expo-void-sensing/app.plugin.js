const { withInfoPlist, withAndroidManifest, AndroidConfig } = require("expo/config-plugins");

const CAMERA_COPY =
  "Only if you turn on body signals: the front camera estimates attention, expression and " +
  "pulse on your device while the feed is open, and the rear camera with the flash takes an " +
  "optional 30-second fingertip calm reading. Frames are processed in memory, never stored or " +
  "uploaded. This is an estimate, not a medical device. The camera is also used if you choose to " +
  "take a photo for a post.";
const BLE_COPY =
  "Only if you choose to pair one: The Void connects to a Bluetooth heart-rate strap or watch " +
  "to read heart rate on your device. Readings never leave your phone.";

/** Permissions the sensing module needs. No Health Connect, BODY_SENSORS, mic or activity recognition. */
const ANDROID_PERMS = [
  "android.permission.CAMERA",
  "android.permission.BLUETOOTH_SCAN",
  "android.permission.BLUETOOTH_CONNECT",
];
/** Permissions this module must never add (and removes if an older config added them). */
const ANDROID_REMOVED = [
  "android.permission.ACTIVITY_RECOGNITION",
  "android.permission.BODY_SENSORS",
  "android.permission.health.READ_HEART_RATE",
  "android.permission.health.READ_HEART_RATE_VARIABILITY",
];

/**
 * Config plugin for expo-void-sensing. Ensures the native usage strings / permissions
 * required by the on-device affect pipeline are present at prebuild. app.json declares
 * the same bits; this guarantees them if that changes.
 */
module.exports = function withVoidSensing(config) {
  config = withInfoPlist(config, (cfg) => {
    const p = cfg.modResults;
    p.NSCameraUsageDescription ||= CAMERA_COPY;
    p.NSBluetoothAlwaysUsageDescription ||= BLE_COPY;
    // No HealthKit: make sure a stale health usage string does not linger.
    delete p.NSHealthShareUsageDescription;
    delete p.NSHealthUpdateUsageDescription;
    p.ITSAppUsesNonExemptEncryption = false;
    return cfg;
  });

  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    for (const name of ANDROID_PERMS) {
      AndroidConfig.Permissions.addPermission(manifest, name);
    }
    const perms = manifest.manifest["uses-permission"] || [];
    manifest.manifest["uses-permission"] = perms.filter(
      (p) => !ANDROID_REMOVED.includes(p?.$?.["android:name"]),
    );
    for (const p of manifest.manifest["uses-permission"]) {
      if (p?.$?.["android:name"] === "android.permission.BLUETOOTH_SCAN") {
        // Scan results are never used to derive location.
        p.$["android:usesPermissionFlags"] = "neverForLocation";
      }
    }
    // Camera hardware is optional: the app works without it.
    const features = manifest.manifest["uses-feature"] || [];
    const want = ["android.hardware.camera", "android.hardware.camera.front", "android.hardware.camera.flash", "android.hardware.bluetooth_le"];
    for (const name of want) {
      const existing = features.find((f) => f?.$?.["android:name"] === name);
      if (existing) existing.$["android:required"] = "false";
      else features.push({ $: { "android:name": name, "android:required": "false" } });
    }
    manifest.manifest["uses-feature"] = features;
    return cfg;
  });

  return config;
};
