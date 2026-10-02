// THE GLOBE IS THE LEFT PANEL AND THE DEFAULT, as native (GlobeScreen: globe is
// the left surface, GLOBE is the default mode, the toggle reads GLOBE | REELS).
// The web had it mirrored: REELS | GLOBE, reels on the left, reels by default.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const L = (...x) => x.join('\n');
const f = fileURLToPath(new URL('../void2-final.html', import.meta.url));
let s = readFileSync(f, 'utf8'); const crlf = s.includes('\r\n'); s = s.replace(/\r\n/g, '\n');
const rep = (a, b) => { const n = s.split(a).length - 1; if (n !== 1) { console.log('ANCHOR x' + n + ': ' + a.slice(0, 90)); process.exit(1); } s = s.split(a).join(b); };

// Toggle: GLOBE first, and lit by default.
rep(L(
"    <button class=\"gmode on\" data-mode=\"reels\" onclick=\"setGlobeMode('reels',1)\">REELS</button>",
"    <button class=\"gmode\" data-mode=\"globe\" onclick=\"setGlobeMode('globe',1)\">GLOBE</button>",
), L(
"    <button class=\"gmode on\" data-mode=\"globe\" onclick=\"setGlobeMode('globe',1)\">GLOBE</button>",
"    <button class=\"gmode\" data-mode=\"reels\" onclick=\"setGlobeMode('reels',1)\">REELS</button>",
));
// Default mode: the globe, as the tab's name says.
rep("let globeMode=localStorage.getItem('void_globe_mode')||'reels';",
    "// GLOBE is the default: the tab opens on the globe (native persist.ts says the same).\nlet globeMode=localStorage.getItem('void_globe_mode')||'globe';");
// Sides: the globe sits at x=0 and REELS waits to the RIGHT; in reels mode the
// globe leaves to the left. (It was reels-left / globe-right.)
rep(L(
"#globe-reels-view{transform:translateX(-100%);pointer-events:none}",
"#globe-map-view{transform:translateX(0)}",
"#screen-globe.reels-mode #globe-reels-view{transform:translateX(0);pointer-events:auto}",
"#screen-globe.reels-mode #globe-map-view{transform:translateX(100%);pointer-events:none}",
), L(
"/* The globe is the LEFT panel and the default; REELS waits to the right, as native. */",
"#globe-reels-view{transform:translateX(100%);pointer-events:none}",
"#globe-map-view{transform:translateX(0)}",
"#screen-globe.reels-mode #globe-reels-view{transform:translateX(0);pointer-events:auto}",
"#screen-globe.reels-mode #globe-map-view{transform:translateX(-100%);pointer-events:none}",
));
// The drag follows the new geometry: in reels mode a rightward drag (f>0) pulls
// the globe in from the left; in globe mode a leftward drag (f<0) pulls reels in
// from the right.
rep(L(
"  if(globeMode==='reels'){ r.style.transform='translateX('+(f*100)+'%)'; m.style.transform='translateX('+(100+f*100)+'%)'; }",
"  else{ r.style.transform='translateX('+(-100+f*100)+'%)'; m.style.transform='translateX('+(f*100)+'%)'; }",
), L(
"  if(globeMode==='reels'){ r.style.transform='translateX('+(f*100)+'%)'; m.style.transform='translateX('+(-100+f*100)+'%)'; }",
"  else{ r.style.transform='translateX('+(100+f*100)+'%)'; m.style.transform='translateX('+(f*100)+'%)'; }",
));
rep("    dx=globeMode==='reels'?Math.min(0,ddx):Math.max(0,ddx);",
    "    dx=globeMode==='reels'?Math.max(0,ddx):Math.min(0,ddx);   // toward the other surface: globe is left, reels right");

// Profile tab row: the layout toggle sits in the tab row exactly as native's
// layoutBtn (paddingHorizontal 8, paddingVertical 6), flush right.
rep(".me-tabs .prof-layout-btn{margin-left:auto;background:none;border:none;padding:0 0 9px;color:var(--nav-dim);cursor:pointer;display:flex;align-items:center}",
    ".me-tabs .prof-layout-btn{margin-left:auto;background:none;border:none;padding:6px 8px;margin-bottom:3px;color:var(--nav-dim);cursor:pointer;display:flex;align-items:center;align-self:flex-start}");

if (crlf) s = s.replace(/\n/g, '\r\n');
writeFileSync(f, s);
console.log('globe left and default; reels to the right; drag mirrored');
