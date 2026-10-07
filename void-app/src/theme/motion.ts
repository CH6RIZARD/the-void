// Motion tokens. One place for curves and springs, instead of a dozen hand-typed
// beziers that almost match.
//
// New and corrected motion uses the playbook values (.claude/skills/improve-animations/
// AUDIT.md, animate-expo/SKILL.md). WEB holds the curves the screens port 1:1 from
// void2-final.html's CSS - kept as cited, declared once.
import { Easing } from 'react-native-reanimated';

/** Entering / exiting UI: starts fast, so the response is immediate. */
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
/** Moving something that stays on screen. */
export const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);

/** After a drag: settle with the finger's release velocity (pass `velocity`). */
export const SPRING_SNAP = { duration: 400, dampingRatio: 0.8 } as const;

/** A flick this fast (pt/s) commits a swipe even short of its distance threshold. */
export const FLICK_VELOCITY = 900;

/** The web build's CSS curves, for the screens that port it. */
export const WEB = {
  /** CSS `ease` */
  EASE: Easing.bezier(0.25, 0.1, 0.25, 1),
  /** CSS `ease-out` */
  EASE_OUT: Easing.bezier(0, 0, 0.58, 1),
  /** the thread sheet / FLIP: cubic-bezier(.32,.72,.28,1) */
  SHEET: Easing.bezier(0.32, 0.72, 0.28, 1),
} as const;
