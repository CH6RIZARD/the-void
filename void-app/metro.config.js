const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
// Bundle the existing web UI (.html) as an asset so the WebView can load it offline.
config.resolver.assetExts.push("html");

module.exports = config;
