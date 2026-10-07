// THE LANYARD (v2) - a real lanyard, not a line.
//
// Two ribbon ends come down from off-screen, meet in a metal crimp, a swivel
// hook hangs from the crimp, and a clear strap-clip loops through the tag's SLOT.
// The tag hangs from the clip.
//
// The first version drew one stroke that stopped in mid-air above the tag, with a
// second clipped copy painted across the tag's face - it read as a strap lying ON
// the tag rather than threaded THROUGH it. Everything here is anchored to the
// measured slot instead: the crimp sits CRIMP_RISE above the slot's bottom edge,
// the ribbons end 6px above the crimp and 3px either side of it, and the clip is
// the only thing that passes through the hole.
import React from 'react';
import { StyleSheet } from 'react-native';
import Svg, { ClipPath, Defs, G, LinearGradient as SvgGrad, Path, Pattern, Rect, Stop, Text as SvgText, TextPath } from 'react-native-svg';
import { FONTS } from '../../theme/palettes';

export const LANYARD_W = 402;
export const LANYARD_H = 874;
/** The crimp hangs this far above the slot's bottom edge. */
export const CRIMP_RISE = 58;

export interface LanyardFlow { n: string; l: (x: number, y: number) => string; r: (x: number, y: number) => string; gold?: boolean }

/** Ten flows. Rolled once per onboarding session - there is no default. */
export const LANYARDS: LanyardFlow[] = [
  { n: '9a NECK LOOP', l: (x, y) => `M40 -30 C 70 120, ${x-70} ${y-160}, ${x-3} ${y-6}`, r: (x, y) => `M362 -30 C 332 120, ${x+70} ${y-160}, ${x+3} ${y-6}` },
  { n: '9b OFF-SHOULDER', l: (x, y) => `M-30 20 C 90 60, ${x-60} ${y-140}, ${x-3} ${y-6}`, r: (x, y) => `M300 -30 C 300 120, ${x+40} ${y-120}, ${x+3} ${y-6}` },
  { n: '9c SLUNG RIGHT', l: (x, y) => `M120 -30 C 130 100, ${x-30} ${y-130}, ${x-3} ${y-6}`, r: (x, y) => `M430 40 C 330 90, ${x+90} ${y-120}, ${x+3} ${y-6}` },
  { n: '9d CROSSED', l: (x, y) => `M80 -30 C 200 80, ${x-110} ${y-140}, ${x-3} ${y-6}`, r: (x, y) => `M330 -30 C 210 90, ${x+110} ${y-150}, ${x+3} ${y-6}` },
  { n: '9e GOLD LOOP', l: (x, y) => `M40 -30 C 70 120, ${x-70} ${y-160}, ${x-3} ${y-6}`, r: (x, y) => `M362 -30 C 332 120, ${x+70} ${y-160}, ${x+3} ${y-6}`, gold: true },
  { n: '9f WIDE V', l: (x, y) => `M-20 -30 C 60 60, ${x-50} ${y-120}, ${x-3} ${y-6}`, r: (x, y) => `M422 -30 C 342 60, ${x+50} ${y-120}, ${x+3} ${y-6}` },
  { n: '9g TIGHT V', l: (x, y) => `M150 -30 C 160 90, ${x-25} ${y-150}, ${x-3} ${y-6}`, r: (x, y) => `M252 -30 C 242 90, ${x+25} ${y-150}, ${x+3} ${y-6}` },
  { n: '9h SLUNG LEFT', l: (x, y) => `M-28 40 C 70 90, ${x-90} ${y-120}, ${x-3} ${y-6}`, r: (x, y) => `M282 -30 C 272 100, ${x+30} ${y-130}, ${x+3} ${y-6}` },
  { n: '9i SLACK BELLY', l: (x, y) => `M60 -30 C 20 160, ${x-120} ${y-60}, ${x-3} ${y-6}`, r: (x, y) => `M342 -30 C 382 160, ${x+120} ${y-60}, ${x+3} ${y-6}` },
  { n: '9j GOLD CROSSED', l: (x, y) => `M80 -30 C 200 80, ${x-110} ${y-140}, ${x-3} ${y-6}`, r: (x, y) => `M330 -30 C 210 90, ${x+110} ${y-150}, ${x+3} ${y-6}`, gold: true },
];

export interface SlotGeom {
  /** Slot centre X, in lanyard space. */
  x: number;
  /** Slot BOTTOM edge Y. */
  y: number;
  /** The tag's own top edge: the overlay is clipped from here to the slot. */
  tagTop: number;
  /** viewBox height for the box this was measured in, so x and y scale alike. */
  vbH?: number;
}

const PURPLE = ['#150c2c', '#2b1b55', '#3a2670', '#2b1b55', '#150c2c'];
const GOLDR = ['#7a5a1c', '#c9a84c', '#e2c56a', '#c9a84c', '#7a5a1c'];

/**
 * One ribbon end, as the stack of strokes the notes describe. Every layer is the
 * SAME path at a different width, which is what makes a flat line read as woven
 * tape: the stitch is drawn wide, then covered back to a hairline at each edge by
 * re-drawing the body over it.
 */
function Ribbon({ d, uid, gold, pid }: { d: string; uid: string; gold?: boolean; pid: string }) {
  const ink = gold ? '#2a1060' : '#c9a84c';
  return (
    <G>
      <Path d={d} stroke="rgba(0,0,0,0.38)" strokeWidth={19} fill="none" strokeLinecap="butt" translateX={1} translateY={3} />
      <Path d={d} stroke={`url(#rib${uid})`} strokeWidth={18} fill="none" strokeLinecap="butt" />
      <Path d={d} stroke={`url(#weave${uid})`} strokeWidth={18} fill="none" strokeLinecap="butt" />
      <Path
        d={d}
        stroke={gold ? '#2a1060' : '#c9a84c'}
        strokeOpacity={0.6}
        strokeWidth={15}
        strokeDasharray="2.5 3"
        fill="none"
        strokeLinecap="butt"
      />
      {/* Covers the stitch back to a 1.5px line down each edge. */}
      <Path d={d} stroke={`url(#rib${uid})`} strokeWidth={12} fill="none" strokeLinecap="butt" />
      <Path d={d} stroke={`url(#weave${uid})`} strokeWidth={12} fill="none" strokeLinecap="butt" />
      {/* The print, riding the same path; starts 2% in so it never clips at
          the crimp. Gold on the purple ribbon, purple on the gold one. */}
      <SvgText fontFamily={FONTS.sansExtraBold} fontSize={6} fontWeight="800" letterSpacing={1.4} fill={ink} fillOpacity={0.9} alignmentBaseline="central">
        <TextPath href={`#${pid}`} startOffset="2%">{'THE ⬡ VOID · '.repeat(48)}</TextPath>
      </SvgText>
    </G>
  );
}

/** Crimp, neck stub and swivel hook, at the crimp point. */
function Hardware({ cx, cy, uid }: { cx: number; cy: number; uid: string }) {
  return (
    <G>
      <Rect x={cx - 13} y={cy - 11} width={26} height={22} rx={5} fill={`url(#crimp${uid})`} />
      <Path d={`M${cx - 7} ${cy - 4} H${cx + 7} M${cx - 7} ${cy + 4} H${cx + 7}`} stroke="rgba(0,0,0,0.45)" strokeWidth={1.4} />
      <Rect x={cx - 3} y={cy + 11} width={6} height={7} rx={1.5} fill="#c9a84c" />
      {/* Swivel hook: a teardrop ring hanging off the stub. */}
      <Path
        d={`M${cx} ${cy + 18} C ${cx - 9} ${cy + 24}, ${cx - 9} ${cy + 38}, ${cx} ${cy + 40} C ${cx + 9} ${cy + 38}, ${cx + 9} ${cy + 24}, ${cx} ${cy + 18} Z`}
        fill="none"
        stroke="#c9a84c"
        strokeWidth={3.2}
      />
      <Path
        d={`M${cx} ${cy + 21} C ${cx - 6} ${cy + 26}, ${cx - 6} ${cy + 36}, ${cx} ${cy + 37} C ${cx + 6} ${cy + 36}, ${cx + 6} ${cy + 26}, ${cx} ${cy + 21} Z`}
        fill="none"
        stroke="rgba(0,0,0,0.5)"
        strokeWidth={0.7}
      />
    </G>
  );
}

/** The clear plastic clip: from the hook ring down THROUGH the slot and back. */
function clipD(cx: number, cy: number, slotY: number): string {
  const top = cy + 34;
  const bottom = slotY + 10;
  return (
    `M${cx - 5} ${top} C ${cx - 7} ${top + 10}, ${cx - 7} ${bottom - 10}, ${cx - 5} ${bottom} L ${cx + 5} ${bottom} C ${cx + 7} ${bottom - 10}, ${cx + 7} ${top + 10}, ${cx + 5} ${top}`
  );
}

function Clip({ cx, cy, slotY, uid }: { cx: number; cy: number; slotY: number; uid: string }) {
  const d = clipD(cx, cy, slotY);
  return (
    <G>
      <Path d={d} fill="none" stroke={`url(#clip${uid})`} strokeWidth={3} strokeLinecap="round" />
      <Path d={d} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth={0.6} strokeLinecap="round" />
    </G>
  );
}

/**
 * `over` draws ONLY the clip, clipped to the band between the tag's top edge and
 * the slot's lower lip. Painted above the tag, that is what makes the clip visibly
 * pass through the hole and disappear behind the gold band.
 *
 * Every id carries a per-instance uid: without it a second tag on the same screen
 * steals the first one's gradients and pattern.
 */
export function Lanyard({ idx, slot, uid, over = false, opacity = 1, vbH = LANYARD_H }: { idx: number; slot: SlotGeom; uid: string; over?: boolean; opacity?: number; vbH?: number }) {
  const flow = LANYARDS[idx] || LANYARDS[0];
  const cx = slot.x;
  const cy = slot.y - CRIMP_RISE;
  const stops = flow.gold ? GOLDR : PURPLE;
  return (
    <Svg
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { opacity }]}
      // THE BOX'S OWN ASPECT, SO NOTHING IS EVER STRETCHED.
      //
      // This was a fixed 402x874 viewBox with preserveAspectRatio="none", i.e.
      // squash the artwork to whatever box it lands in. Full screen that is nearly
      // proportional and looks almost right, but the moment the keyboard opens the
      // box loses ~40% of its height and everything is squashed with it: the strap
      // curves flatten, the print slides off the ribbon it is supposed to ride, and
      // the clip stops lining up with the slot. The height now follows the box's
      // real aspect (CardGate measures it), so x and y always scale by the same
      // factor and the drawing cannot distort.
      viewBox={`0 0 ${LANYARD_W} ${vbH}`}
      preserveAspectRatio="none"
    >
      <Defs>
        <SvgGrad id={`rib${uid}`} x1="0" y1="0" x2="1" y2="0">
          {stops.map((c, i) => (
            <Stop key={i} offset={String(i / (stops.length - 1))} stopColor={c} />
          ))}
        </SvgGrad>
        <Pattern id={`weave${uid}`} width={3} height={3} patternUnits="userSpaceOnUse">
          <Rect x={0} y={0} width={1.5} height={1.5} fill="rgba(255,255,255,0.07)" />
          <Rect x={1.5} y={1.5} width={1.5} height={1.5} fill="rgba(0,0,0,0.18)" />
        </Pattern>
        <SvgGrad id={`crimp${uid}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#f3e3a6" />
          <Stop offset="0.4" stopColor="#c9a84c" />
          <Stop offset="0.75" stopColor="#7d6122" />
          <Stop offset="1" stopColor="#d8b95a" />
        </SvgGrad>
        <SvgGrad id={`clip${uid}`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#ffffff" stopOpacity={0.08} />
          <Stop offset="0.5" stopColor="#ffffff" stopOpacity={0.28} />
          <Stop offset="1" stopColor="#ffffff" stopOpacity={0.08} />
        </SvgGrad>
        {/* The ribbon paths by id, for the print's textPath. */}
        <Path id={`rpl${uid}`} d={flow.l(cx, cy)} fill="none" />
        <Path id={`rpr${uid}`} d={flow.r(cx, cy)} fill="none" />
        {over ? (
          <ClipPath id={`band${uid}`}>
            <Rect x={0} y={slot.tagTop} width={LANYARD_W} height={Math.max(0, slot.y - slot.tagTop)} />
          </ClipPath>
        ) : null}
      </Defs>
      {over ? (
        <G clipPath={`url(#band${uid})`}>
          <Clip cx={cx} cy={cy} slotY={slot.y} uid={uid} />
        </G>
      ) : (
        <G>
          <Ribbon d={flow.l(cx, cy)} uid={uid} gold={flow.gold} pid={`rpl${uid}`} />
          <Ribbon d={flow.r(cx, cy)} uid={uid} gold={flow.gold} pid={`rpr${uid}`} />
          <Clip cx={cx} cy={cy} slotY={slot.y} uid={uid} />
          <Hardware cx={cx} cy={cy} uid={uid} />
        </G>
      )}
    </Svg>
  );
}
