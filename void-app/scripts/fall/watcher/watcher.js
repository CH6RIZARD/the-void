/* THE WATCHER: the Void character's eyes as the site's see/view icon, alive.
 *
 *   <script src="watcher.js" defer></script>
 *   <span data-watcher style="width:28px;color:#c9a84c"></span>     (colour = currentColor, height follows the width)
 *
 * Every [data-watcher] on the page (and any added later) gets the mark and:
 *   - on page load: wakes up (eyes open out of a squint, brows settle), staggered across icons, then one blink;
 *   - always: blinks now and then, and the eyes drift a little toward the mouse wherever it is on the page;
 *   - on hover: brows lift and the eyes widen slightly; on leave they relax.
 * Reduced motion: the mark is drawn still. One mousemove listener and one animation loop for all icons.
 */
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  // Geometry from the character (voidFigure.ts FACE lock), straight on; units are arbitrary, y down.
  const BROW = { l: '11.2,71.9 14.9,78.3 74.6,101.4 89.9,92.3 86.3,85.9 27,62.1', r: '186.5,59.3 125.1,83.6 121.9,89.1 121.2,105.2 182.3,81.5 185.4,76.1' };
  const EYE = { l: [58.4, 115.2, 29.2, 30.8], r: [146.2, 115.9, 29.2, 30] };
  const GAP = 1.7; // knockout where a brow cuts into an eye
  const LOOK = 3.2, BROW_FOLLOW = 0.45, LIFT = 4.5, WIDEN = 0.06;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const all = [];
  let mx = innerWidth / 2, my = innerHeight / 2, uid = 0;

  const el = (n, a) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); return e; };

  function mount(host) {
    if (host.__watcher) return;
    const id = 'wg' + ++uid;
    const svg = el('svg', { viewBox: '7 55 184 95', width: '100%', role: 'img', 'aria-label': host.getAttribute('aria-label') || 'views' });
    svg.style.display = 'block'; svg.style.overflow = 'visible';
    const mask = el('mask', { id, maskUnits: 'userSpaceOnUse', x: -50, y: -50, width: 300, height: 260 });
    mask.append(el('rect', { x: -50, y: -50, width: 300, height: 260, fill: '#fff' }));
    const parts = {};
    for (const s of ['l', 'r']) {
      const cut = el('polygon', { points: BROW[s], fill: '#000', stroke: '#000', 'stroke-width': GAP * 2, 'stroke-linejoin': 'round' });
      mask.append(cut);
      const [cx, cy, rx, ry] = EYE[s];
      const eye = el('ellipse', { cx, cy, rx, ry, fill: 'currentColor' });
      const brow = el('polygon', { points: BROW[s], fill: 'currentColor' });
      parts[s] = { cut, eye, brow, cx, cy };
    }
    const defs = el('defs', {}); defs.append(mask);
    const eyes = el('g', { mask: `url(#${id})` }); eyes.append(parts.l.eye, parts.r.eye);
    svg.append(defs, eyes, parts.l.brow, parts.r.brow);
    host.textContent = '';
    host.append(svg);
    if (!host.style.display) host.style.display = 'inline-block';
    const w = { host, parts, born: performance.now() + 120 + all.length * 90, lx: 0, ly: 0, hover: 0, hv: 0, blinkAt: 0, nextBlink: 0 };
    w.nextBlink = w.born + 1400 + Math.random() * 900;
    host.addEventListener('pointerenter', () => (w.hover = 1));
    host.addEventListener('pointerleave', () => (w.hover = 0));
    host.__watcher = w;
    all.push(w);
    draw(w, performance.now());
  }

  const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.pow(1 - x, 3));
  const back = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2));

  function draw(w, now) {
    let open = 1, wake = 1;
    if (!still) {
      // wake: eyes open out of a squint with a little overshoot, brows drop in from raised
      const t = (now - w.born) / 650;
      open = 0.08 + 0.92 * back(t);
      wake = ease(t);
      // blink: 70 ms down, 110 ms up
      if (now >= w.nextBlink && t > 1) { w.blinkAt = now; w.nextBlink = now + 2800 + Math.random() * 4200 + (Math.random() < 0.2 ? -2400 : 0); }
      const b = now - w.blinkAt;
      if (b < 180) open *= b < 70 ? 1 - 0.9 * (b / 70) : 0.1 + 0.9 * ((b - 70) / 110);
      // look toward the mouse (relative to this icon), eased
      const r = w.host.getBoundingClientRect();
      const dx = mx - (r.left + r.width / 2), dy = my - (r.top + r.height / 2), d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, d / 260);
      w.lx += ((dx / d) * k * LOOK - w.lx) * 0.12;
      w.ly += ((dy / d) * k * LOOK * 0.7 - w.ly) * 0.12;
      w.hv += (w.hover - w.hv) * 0.15;
    }
    const lift = (1 - wake) * 6 + w.hv * LIFT;
    const grow = 1 + w.hv * WIDEN;
    for (const s of ['l', 'r']) {
      const p = w.parts[s];
      p.eye.setAttribute('transform', `translate(${w.lx} ${w.ly}) translate(${p.cx} ${p.cy}) scale(${grow} ${grow * open}) translate(${-p.cx} ${-p.cy})`);
      // brows follow the look a little, lift on hover; the outer ends lift more (s: which way is outward)
      const tilt = (s === 'l' ? -1 : 1) * w.hv * 2.5;
      const bt = `translate(${w.lx * BROW_FOLLOW} ${w.ly * BROW_FOLLOW - lift}) rotate(${tilt} ${p.cx} ${p.cy - 30})`;
      p.brow.setAttribute('transform', bt);
      p.cut.setAttribute('transform', bt);
    }
  }

  function frame(now) {
    for (let i = all.length - 1; i >= 0; i--) {
      if (!all[i].host.isConnected) { all.splice(i, 1); continue; }
      draw(all[i], now);
    }
  }
  // Watcher.manual = true stops the live loop so a recorder can drive frames itself (Watcher.frame(ms)).
  function loop(now) { if (window.Watcher.manual) return; frame(now); if (!still) requestAnimationFrame(loop); }

  addEventListener('pointermove', (e) => { mx = e.clientX; my = e.clientY; }, { passive: true });
  const point = (x, y) => { mx = x; my = y; };
  const scan = (root) => root.querySelectorAll && root.querySelectorAll('[data-watcher]').forEach(mount);
  const start = () => {
    scan(document);
    new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) { if (n.matches('[data-watcher]')) mount(n); scan(n); } })))
      .observe(document.body, { childList: true, subtree: true });
    requestAnimationFrame(loop);
  };
  document.readyState === 'loading' ? addEventListener('DOMContentLoaded', start) : start();
  window.Watcher = { mount, frame, point, manual: false, hover: (h, on) => (h.__watcher.hover = on ? 1 : 0), restart: (t) => all.forEach((w, i) => { w.born = t + 120 + i * 90; w.nextBlink = w.born + 1400; }) };
})();
