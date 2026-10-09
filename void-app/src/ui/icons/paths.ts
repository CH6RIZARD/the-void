// Every glyph of the web icon system (void2-final.html `VI` / `VICON`), as data.
// viewBox 0 0 24 24. Stroked icons: stroke currentColor, width 1.5, round caps/joins,
// fill none. Filled icons (boltFill, play, pause, send): fill currentColor, no stroke.

export type IconShape =
  | { t: 'path'; d: string }
  | { t: 'circle'; cx: number; cy: number; r: number }
  | { t: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { t: 'rect'; x: number; y: number; width: number; height: number; rx?: number };

export interface IconDef {
  filled?: boolean;
  shapes: IconShape[];
}

const p = (d: string): IconShape => ({ t: 'path', d });

export const ICONS = {
  bolt: { shapes: [p('M13 2 4 14h6l-1 8 9-12h-6l1-8z')] },
  // The reaction is a heart now. The bolt glyphs stay defined: the bolt is still
  // the mark of the app itself, and deleting it would take the logo with it.
  // The profile's layout toggle and its gallery marker.
  grid: { shapes: [
    { t: 'rect', x: 3.5, y: 3.5, width: 7, height: 7, rx: 1.5 },
    { t: 'rect', x: 13.5, y: 3.5, width: 7, height: 7, rx: 1.5 },
    { t: 'rect', x: 3.5, y: 13.5, width: 7, height: 7, rx: 1.5 },
    { t: 'rect', x: 13.5, y: 13.5, width: 7, height: 7, rx: 1.5 },
  ] },
  rows: { shapes: [p('M4 7h16M4 12h16M4 17h16')] },
  stack: { shapes: [
    { t: 'rect', x: 7.5, y: 3.5, width: 13, height: 13, rx: 2 },
    p('M16.5 20.5h-11a2 2 0 0 1-2-2v-11'),
  ] },
  heart: { shapes: [p('M12 20.4 4.2 12.6a4.8 4.8 0 0 1 6.8-6.8l1 1 1-1a4.8 4.8 0 0 1 6.8 6.8z')] },
  heartFill: { filled: true, shapes: [p('M12 20.4 4.2 12.6a4.8 4.8 0 0 1 6.8-6.8l1 1 1-1a4.8 4.8 0 0 1 6.8 6.8z')] },
  boltFill: { filled: true, shapes: [p('M13 2 4 14h6l-1 8 9-12h-6l1-8z')] },
  reply: { shapes: [p('M21 12a8 8 0 0 1-8 8H4l2.2-2.6A8 8 0 1 1 21 12z')] },
  pen: { shapes: [p('M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3z'), p('M14.5 6.5l3 3')] },
  share: { shapes: [p('M12 16V4M7 9l5-5 5 5M4 20h16')] },
  less: { shapes: [p('M12 5v14M6 13l6 6 6-6')] },
  play: { filled: true, shapes: [p('M7 4.5v15l13-7.5-13-7.5z')] },
  pause: { filled: true, shapes: [p('M7 4h3.5v16H7zM13.5 4H17v16h-3.5z')] },
  globe: {
    shapes: [
      { t: 'circle', cx: 12, cy: 12, r: 8.5 },
      { t: 'ellipse', cx: 12, cy: 12, rx: 3.8, ry: 8.5 },
      p('M3.5 12h17'),
    ],
  },
  home: { shapes: [p('M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5L12 2.5z')] },
  user: { shapes: [{ t: 'circle', cx: 12, cy: 7.5, r: 3.5 }, p('M5 20c1.3-3.6 4-5.5 7-5.5s5.7 1.9 7 5.5')] },
  arrowUp: { shapes: [p('M9 18v-6H5l7-7 7 7h-4v6H9z')] },
  arrowDown: { shapes: [p('M15 6v6h4l-7 7-7-7h4V6h6z')] },
  at: { shapes: [p('M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'), p('M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.9 7.9')] },
  userPlus: { shapes: [p('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'), { t: 'circle', cx: 9, cy: 7, r: 4 }, p('M19 8v6M22 11h-6')] },
  repost: { shapes: [p('M17 2l4 4-4 4'), p('M3 11V9a4 4 0 0 1 4-4h14'), p('M7 22l-4-4 4-4'), p('M21 13v2a4 4 0 0 1-4 4H3')] },
  dms: { shapes: [p('M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5z')] },
  gear: {
    shapes: [
      { t: 'circle', cx: 12, cy: 12, r: 3 },
      p('M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.5 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.5-2-1.5c.07-.4.1-.8.1-1.2z'),
    ],
  },
  x: { shapes: [p('M5 5l14 14M19 5 5 19')] },
  back: { shapes: [p('M15 4l-8 8 8 8')] },
  send: { filled: true, shapes: [p('M3 11.5 21 3l-6.5 18-3-7.5L3 11.5z')] },
  attach: { shapes: [p('M21 12.5 12.7 20.8a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l8-8')] },
  search: { shapes: [{ t: 'circle', cx: 11, cy: 11, r: 6.5 }, p('m20.5 20.5-4.8-4.8')] },
  pin: { shapes: [p('M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z'), { t: 'circle', cx: 12, cy: 10, r: 2.5 }] },
  lock: { shapes: [{ t: 'rect', x: 5, y: 11, width: 14, height: 9, rx: 2 }, p('M8 11V7a4 4 0 0 1 8 0v4')] },
  unlock: { shapes: [{ t: 'rect', x: 5, y: 11, width: 14, height: 9, rx: 2 }, p('M8 11V7a4 4 0 0 1 7.5-1.3')] },
  // Calls (src/features/calls). The web build has no call glyphs; these follow the
  // same hairline grammar so the chat header reads as one set.
  phone: { shapes: [p('M5 4h3.5l1.5 4-2 1.5a11 11 0 0 0 6.5 6.5l1.5-2 4 1.5V19a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z')] },
  phoneEnd: { filled: true, shapes: [p('M12 9c-3.6 0-7 1.2-9.6 3.4a1.6 1.6 0 0 0-.2 2.2l1.8 2.1a1.5 1.5 0 0 0 2 .3l2.6-1.9a1.5 1.5 0 0 0 .6-1.4l-.2-1.6a9.8 9.8 0 0 1 6 0l-.2 1.6a1.5 1.5 0 0 0 .6 1.4l2.6 1.9a1.5 1.5 0 0 0 2-.3l1.8-2.1a1.6 1.6 0 0 0-.2-2.2A14.5 14.5 0 0 0 12 9z')] },
  camera: { shapes: [{ t: 'rect', x: 3, y: 7, width: 13, height: 10, rx: 2 }, p('M16 11l5-3v8l-5-3')] },
  cameraOff: { shapes: [p('M3 7h10a2 2 0 0 1 2 2v2l6-3v8'), p('M16 17H5a2 2 0 0 1-2-2V9'), p('M3 3l18 18')] },
  mic: { shapes: [{ t: 'rect', x: 9, y: 3, width: 6, height: 11, rx: 3 }, p('M5 11a7 7 0 0 0 14 0M12 18v3')] },
  micOff: { shapes: [p('M9 9V6a3 3 0 0 1 6 0v4a3 3 0 0 1-1 2.2'), p('M5 11a7 7 0 0 0 10.5 6M19 11a7 7 0 0 1-.6 2.8M12 18v3'), p('M3 3l18 18')] },
  flip: { shapes: [p('M4.5 12a7.5 7.5 0 0 1 13-5.1M19.5 12a7.5 7.5 0 0 1-13 5.1'), p('M17.5 3v4h-4M6.5 21v-4h4')] },
  speaker: { shapes: [p('M4 9h4l5-4v14l-5-4H4z'), p('M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12')] },
} satisfies Record<string, IconDef>;

export type IconName = keyof typeof ICONS;

/** Bottom-nav tab -> icon (web NAV_ICONS). */
export const NAV_ICONS = { void: 'home', globe: 'globe', search: 'search', messages: 'dms', profile: 'user' } as const satisfies Record<string, IconName>;
