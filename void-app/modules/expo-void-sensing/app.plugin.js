const { withInfoPlist, withAndroidManifest, AndroidConfig } = require("expo/config-plugins");

/**
 * Config plugin for expo-void-sensing. Ensures the native usage strings / permissions
 * / privacy posture required by the on-device affect pipeline are present at prebuild.
 * (app.json also declares the high-level bits; this guarantees them if that changes.)
 */
module.exports = function withVoidSensing(config) {
  config = withInfoPlist(config, (cfg) => {
    const p = cfg.modResults;
    p.NSCameraUsageDescription ||=
      "Opt-in on-device heart-rate reading only. Frames never leave your phone.";
    p.NSMotionUsageDescription ||=
      "On-device motion gating only. Never leaves your phone.";
    p.NSHealthShareUsageDescription ||=
      "Optional on-device HR/HRV read to improve personalization. Never used for ads.";
    // Declares this app does NOT use data for tracking (Apple 5.1.3(vi)).
    p.ITSAppUsesNonExemptEncryption = false;
    return cfg;
  });

  config = withAndroidManifest(config, (cfg) => {
    const perms = [
      "android.permission.CAMERA",
      "android.permission.ACTIVITY_RECOGNITION",
      "android.permission.health.READ_HEART_RATE",
    ];
    for (const name of perms) {
      AndroidConfig.Permissions.addPermission(cfg.modResults, name);
    }
    return cfg;
  });

  return config;
};
