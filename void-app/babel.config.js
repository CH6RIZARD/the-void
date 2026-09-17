module.exports = function (api) {
  api.cache(true);
  // babel-preset-expo (SDK 57) already adds expo-router and the
  // react-native-worklets (Reanimated 4) plugin automatically.
  return {
    presets: ["babel-preset-expo"],
  };
};
