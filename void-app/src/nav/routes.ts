// Route paths (expo-router, app/ directory). Use these instead of string literals.
//   import { router } from 'expo-router';
//   router.push(ROUTES.nation('NG'));
export const TABS = ['void', 'globe', 'search', 'messages', 'profile'] as const;
export type TabName = (typeof TABS)[number];

export const ROUTES = {
  void: '/void',
  globe: '/globe',
  search: '/search',
  messages: '/messages',
  profile: '/profile',
  /** Nation dossier, ISO 3166-1 alpha-2 or alpha-3 code. */
  nation: (iso: string) => `/nation/${encodeURIComponent(iso)}`,
  /** Thread / post detail. */
  thread: (id: string) => `/thread/${encodeURIComponent(id)}`,
  /** Still photo viewer for a post's image(s), opened at slide `index`. */
  photo: (id: string, index = 0) => `/photo?id=${encodeURIComponent(id)}&i=${Math.max(0, index | 0)}`,
  /** Reels, optionally seeded: ROUTES.reelsFor('NG', postId) */
  reels: '/reels',
  reelsFor: (nation?: string, post?: string) => `/reels?${[nation ? `nation=${encodeURIComponent(nation)}` : '', post ? `post=${encodeURIComponent(post)}` : ''].filter(Boolean).join('&')}`,
  /** DM conversation */
  chat: (convId: string) => `/messages/${encodeURIComponent(convId)}`,
  /** Someone else's profile (handle without @) */
  user: (handle: string) => `/u/${encodeURIComponent(handle.replace(/^@/, ''))}`,
  blocked: '/blocked',
  composer: '/composer',
  settings: '/settings',
  signIn: '/sign-in',
  /** OAuth return: thevoid://auth-callback */
  authCallback: '/auth-callback',
} as const;

export const DEEP_LINK_SCHEME = 'thevoid';
export const AUTH_REDIRECT_URL = 'thevoid://auth-callback';
