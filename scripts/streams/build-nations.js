#!/usr/bin/env node
/**
 * build-nations.js — grow the globe's `C` array from 82 nations to every nation
 * on earth, and emit the ISO-keyed nation table the stream pipeline runs on.
 *
 * WHY
 * Every source builder in scripts/ gates discovery on the `C` array: the iptv-org
 * builder maps ISO-2 -> app country name by READING C (appCountries()), so a
 * channel from a nation the globe does not place is dropped before it is ever
 * probed. That means the stream pool cannot exceed C's nation count no matter how
 * many catalogues we add. C had 82 entries; 111 UN members had nowhere to live.
 *
 * WHAT IT DOES
 *   1. parse the existing C array out of void2-final.html and KEEP IT EXACTLY —
 *      those 82 entries carry hand-tuned lat/lon and subreddit mappings, and the
 *      globe's marker placement was eyeballed against them. New nations are
 *      appended, nothing existing is rewritten.
 *   2. build the target list: 193 UN member states + the places this app clearly
 *      treats as nations already (Taiwan is in C today; the iptv-org builder has
 *      an explicit Palestine branch) + a few territories with their own feeds.
 *   3. take centroids from a real dataset, not by hand. South Sudan is absent
 *      from that dataset (it predates 2011) and is supplied here.
 *   4. write the new C array back into void2-final.html between markers, and
 *      write scripts/streams/nations.generated.json for the rest of the pipeline.
 *
 * `sr` (subreddit) is null for every new nation. Verified unused in the app today
 * — nothing reads `.sr` — so it is a placeholder for later, not a gap.
 *
 *   node scripts/streams/build-nations.js --dry     # report only, write nothing
 *   node scripts/streams/build-nations.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'void2-final.html');
const OUT = path.join(__dirname, 'nations.generated.json');
const DRY = process.argv.includes('--dry');

const CENTROIDS = 'https://raw.githubusercontent.com/eesur/country-codes-lat-long/master/country-codes-lat-long-alpha3.json';

/** The 193 UN member states, ISO-3166-1 alpha-2. */
const UN_MEMBERS = ('AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI CV KH ' +
  'CM CA CF TD CL CN CO KM CG CD CR CI HR CU CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH ' +
  'GR GD GT GN GW GY HT HN HU IS IN ID IR IQ IE IL IT JM JP JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU ' +
  'MG MW MY MV ML MT MH MR MU MX FM MD MC MN ME MA MZ MM NA NR NP NL NZ NI NE NG MK NO OM PK PW PA PG PY PE PH ' +
  'PL PT QA RO RU RW KN LC VC WS SM ST SA SN RS SC SL SG SK SI SB SO ZA SS ES LK SD SR SE CH SY TJ TZ TH TL TG ' +
  'TO TT TN TR TM TV UG UA AE GB US UY UZ VU VE VN YE ZM ZW').split(/\s+/);

/**
 * Not UN members, but this app already treats them as places with their own feed:
 * Taiwan is in C today, and build-iptv-sources.js has a dedicated Palestine branch.
 */
const ALSO = ['TW', 'PS', 'XK', 'HK', 'GL', 'PR'];

/** Centroids the dataset lacks or places badly for a globe marker. */
const CENTROID_FIX = {
  SS: { lat: 7.9, lon: 29.7 },    // absent: dataset predates independence
  XK: { lat: 42.6, lon: 20.9 },   // no ISO-3166 assignment
  PS: { lat: 31.9, lon: 35.2 },
  FR: { lat: 46.2, lon: 2.2 },    // dataset centroid includes overseas départements
  US: { lat: 37.1, lon: -95.7 },  // ... and Alaska/Hawaii
  NL: { lat: 52.1, lon: 5.3 },
  NO: { lat: 60.5, lon: 8.5 },
  NZ: { lat: -40.9, lon: 174.9 },
  CL: { lat: -35.7, lon: -71.5 },
  EC: { lat: -1.8, lon: -78.2 },
  PT: { lat: 39.4, lon: -8.2 },
  ES: { lat: 40.5, lon: -3.7 },
};

/** Friendly names. The dataset ships formal ISO names ("Moldova, Republic of"). */
const NAME = {
  BO: 'Bolivia', BN: 'Brunei', CV: 'Cape Verde', CD: 'DR Congo', CG: 'Congo', CI: "Cote d'Ivoire",
  CZ: 'Czechia', SZ: 'Eswatini', FM: 'Micronesia', IR: 'Iran', KP: 'North Korea', KR: 'South Korea',
  LA: 'Laos', MD: 'Moldova', MK: 'North Macedonia', PS: 'Palestine', RU: 'Russia', SS: 'South Sudan', SY: 'Syria',
  TW: 'Taiwan', TZ: 'Tanzania', TL: 'Timor-Leste', GB: 'United Kingdom', US: 'United States',
  VE: 'Venezuela', VN: 'Vietnam', XK: 'Kosovo', HK: 'Hong Kong', GL: 'Greenland', PR: 'Puerto Rico',
  VA: 'Vatican City', AE: 'United Arab Emirates', GQ: 'Equatorial Guinea', CF: 'Central African Republic',
  DO: 'Dominican Republic', GW: 'Guinea-Bissau', KN: 'Saint Kitts and Nevis', LC: 'Saint Lucia',
  VC: 'Saint Vincent and the Grenadines', ST: 'Sao Tome and Principe', SB: 'Solomon Islands',
  MH: 'Marshall Islands', BA: 'Bosnia and Herzegovina', TT: 'Trinidad and Tobago', AG: 'Antigua and Barbuda',
};

/** Parse the live C array. Keeps raw text per entry so existing ones round-trip byte-exact. */
function readC(html) {
  const i = html.search(/const C\s*=\s*\[/);
  if (i < 0) throw new Error('could not find the C country array in void2-final.html');
  const open = html.indexOf('[', i);
  let depth = 0, k = open;
  for (; k < html.length; k++) {
    if (html[k] === '[') depth++;
    else if (html[k] === ']') { depth--; if (!depth) break; }
  }
  const body = html.slice(open + 1, k);
  const entries = [];
  for (const m of body.matchAll(/\{[^{}]*\}/g)) {
    const raw = m[0];
    const n = /n:\s*"([^"]+)"/.exec(raw), iso = /iso:\s*"([^"]+)"/.exec(raw);
    const lat = /lat:\s*(-?[\d.]+)/.exec(raw), lon = /lon:\s*(-?[\d.]+)/.exec(raw);
    if (!n || !iso) throw new Error('unparsable C entry: ' + raw.slice(0, 80));
    entries.push({ raw, n: n[1], iso: iso[1].toUpperCase(), lat: +lat[1], lon: +lon[1] });
  }
  return { entries, start: open, end: k, declStart: i };
}

const cleanName = s => String(s)
  .replace(/\s*\(.*?\)\s*/g, ' ')
  .replace(/^(.*?),\s*(Republic|Kingdom|State|Federation|Islamic Republic|Province).*$/i, '$1')
  .replace(/\s+/g, ' ').trim();

(async () => {
  const html = fs.readFileSync(SRC, 'utf8');
  const { entries, start, end } = readC(html);
  const have = new Map(entries.map(e => [e.iso, e]));
  console.log('C array today                 :', entries.length, 'nations');

  const r = await fetch(CENTROIDS, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error('centroids HTTP ' + r.status);
  const ds = (await r.json()).ref_country_codes;
  const byIso = {};
  for (const c of ds) byIso[c.alpha2] = c;
  console.log('centroid dataset              :', ds.length, 'entries');

  const want = [...UN_MEMBERS, ...ALSO];
  const dupes = want.filter((x, i) => want.indexOf(x) !== i);
  if (dupes.length) throw new Error('duplicate ISO in target list: ' + dupes.join(','));

  const added = [], skipped = [];
  for (const iso of want) {
    if (have.has(iso)) continue;
    const fix = CENTROID_FIX[iso], d = byIso[iso];
    const lat = fix ? fix.lat : d ? +d.latitude : null;
    const lon = fix ? fix.lon : d ? +d.longitude : null;
    if (lat === null || lon === null || Number.isNaN(lat) || Number.isNaN(lon)) {
      skipped.push(iso); continue;   // never place a marker at 0,0 in the Atlantic
    }
    const name = NAME[iso] || (d ? cleanName(d.country) : null);
    if (!name) { skipped.push(iso); continue; }
    added.push({ iso, n: name, lat: +lat.toFixed(1), lon: +lon.toFixed(1) });
  }

  if (skipped.length) console.log('SKIPPED (no usable centroid) :', skipped.join(', '));
  console.log('nations to add                :', added.length);

  // A name collision would break every pool, which is keyed by display name.
  const names = new Map();
  for (const e of [...entries, ...added]) {
    if (names.has(e.n)) throw new Error(`display-name collision: ${e.n} (${names.get(e.n)} and ${e.iso})`);
    names.set(e.n, e.iso);
  }

  const all = [...entries, ...added].sort((a, b) => a.n.localeCompare(b.n));
  const text = all.map(e => e.raw
    ? e.raw
    : `{n:"${e.n}",lat:${e.lat},lon:${e.lon},sr:null,iso:"${e.iso}"}`).join(',');

  const table = {};
  for (const e of all) table[e.iso] = { iso: e.iso, name: e.n, lat: e.lat, lon: e.lon };

  if (DRY) {
    console.log('\n--dry: nothing written. Would add:');
    console.log(added.map(a => `${a.iso} ${a.n}`).join(' | '));
    return;
  }

  fs.writeFileSync(OUT, JSON.stringify({
    generated: new Date().toISOString(),
    note: 'Canonical nation table for the stream pipeline. ISO-3166-1 alpha-2 is the key; ' +
          '`name` is the app display name and the key the source pools use. ' +
          'Generated by scripts/streams/build-nations.js — do not hand-edit.',
    count: all.length, nations: table,
  }, null, 1));

  fs.writeFileSync(SRC, html.slice(0, start + 1) + text + html.slice(end));
  console.log('\nWROTE', path.relative(ROOT, SRC), 'and', path.relative(ROOT, OUT));
  console.log('  C array now                 :', all.length, 'nations');

  // Prove the page still parses — a broken C array black-screens the whole app.
  const out = fs.readFileSync(SRC, 'utf8');
  const re = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g;
  let m, n = 0, bad = 0;
  while ((m = re.exec(out))) { n++; try { new Function(m[1]); } catch (e) { bad++; console.error('PARSE:', e.message); } }
  console.log(`  ${n} inline scripts, ${bad} errors`);
  if (bad) process.exit(1);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
