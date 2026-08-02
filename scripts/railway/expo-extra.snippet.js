// Cursor #3 — Claude: merge into void-app/app.config.js (do not hardcode keys).
// Read via expo-constants: Constants.expoConfig?.extra
//
// module.exports = ({ config }) => ({
//   ...config,
//   extra: {
//     ...(config.extra || {}),
//     supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
//     supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
//     // If Railway hosts a custom API instead of Supabase PostgREST:
//     // apiUrl: process.env.EXPO_PUBLIC_API_URL,
//   },
// });

module.exports = {
  note: 'Snippet only — apply inside void-app/app.config.js on the Windows tree.',
};
