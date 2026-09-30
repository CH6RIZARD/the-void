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
} satisfies Record<string, IconDef>;

export type IconName = keyof typeof ICONS;

/** Bottom-nav tab -> icon (web NAV_ICONS). */
export const NAV_ICONS = { void: 'home', globe: 'globe', search: 'search', messages: 'dms', profile: 'user' } as const satisfies Record<string, IconName>;
