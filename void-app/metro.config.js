const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
// three ships .cjs entry points alongside ESM; let Metro resolve them.
if (!config.resolver.sourceExts.includes("cjs")) config.resolver.sourceExts.push("cjs");
// Globe textures / models (used by src/features/globe via expo-gl + three).
for (const ext of ["glb", "gltf", "bin", "hdr", "ktx2"]) {
  if (!config.resolver.assetExts.includes(ext)) config.resolver.assetExts.push(ext);
}

module.exports = config;
