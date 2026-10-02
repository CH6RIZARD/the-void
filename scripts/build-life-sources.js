#!/usr/bin/env node
/**
 * build-life-sources.js — generate a verified pool of "what it looks like
 * there" YouTube videos: walking tours, day-in-the-life, live street cams.
 *
 * WHY
 * CAM_SOURCES + RAW_FOOTAGE are hand-curated and cover 28 countries. The globe
 * places 82. For the other ~54 a click opens a wall of broadcast TV (IPTV) or
 * nothing at all, when what the user wanted was the street. Walking-tour and
 * live-cam uploads exist for almost every capital on earth, get re-uploaded
 * constantly, and are exactly the place-specific footage the wall leads with.
 *
 * WHAT IT DOES
 *   1. map the app's own country names (read from the C array)
 *   2. per country, search "<city> walking tour 4K", "<country> day in the
 *      life", "<city> street walk", and for live "<city> live street cam" /
 *      "live walk <city>"
 *        Path A — YOUTUBE_API_KEY set: YouTube Data API v3 search + videos.list
 *        Path B — no key: parse ytInitialData from the public results page
 *   3. filter: > 8 min or LIVE, published within ~2 years, title names the
 *      place AND reads like a walk / tour / life / cam
 *   4. merge scripts/life-sources.handlist.json (read at run time; hand entries
 *      are preferred) and dedupe against every id already in CAM_SOURCES /
 *      RAW_FOOTAGE
 *   5. VERIFY every candidate with oEmbed — a 200 means the video exists and
 *      allows embedding; a 401/404 would be a black tile on the wall
 *   6. cap per country (6, at most 2 live) and write
 *      scripts/life-sources.generated.json  ({country:[entries]})
 *
 * It never writes an empty pool: if everything failed it exits non-zero and
 * leaves the previous file alone. If YouTube answers with a consent wall or
 * 429 it stops searching immediately and does NOT overwrite the real output.
 *
 * Run from a NORMAL network. From a datacenter IP YouTube serves consent walls
 * and throttles, and you will bake "nothing exists" into the build — the same
 * trap resolve-live.js warns about.
 *
 *   node scripts/build-life-sources.js
 *   node scripts/build-life-sources.js --per-country 6 --max-live 2 --sleep 1200
 *   node scripts/build-life-sources.js --only "Kenya,Peru"
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'void2-final.html');
const OUT = path.join(__dirname, 'life-sources.generated.json');
const PARTIAL = path.join(__dirname, 'life-sources.partial.json');
const HAND = path.join(__dirname, 'life-sources.handlist.json');

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const PER_COUNTRY = parseInt(arg('per-country', '6'), 10);
const MAX_LIVE    = parseInt(arg('max-live', '2'), 10);
const SLEEP_MS    = parseInt(arg('sleep', '1200'), 10);
const MIN_SECONDS = parseInt(arg('min-seconds', '480'), 10);   // > 8:00
const MAX_AGE_YRS = parseInt(arg('max-age-years', '2'), 10);
const CONCURRENCY = parseInt(arg('concurrency', '4'), 10);
const FETCH_MS    = parseInt(arg('timeout', '15000'), 10);
const ONLY        = arg('only', '') ? new Set(arg('only', '').split(',').map(s => s.trim())) : null;
const API_KEY     = process.env.YOUTUBE_API_KEY || '';
// --candidates <file>: save raw search candidates there; if it already exists,
// skip searching and reuse it. Lets the hand-list merge + verify step be
// re-run without hitting YouTube search again.
const CANDIDATES  = arg('candidates', '');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const SP_VIDEOS = 'EgIQAQ%253D%253D';   // results filter: type = video
const SP_LIVE   = 'EgJAAQ%253D%253D';   // results filter: features = live

/**
 * Most-filmed city first (that is what the queries use), then aliases that
 * count as "the title names the place". Capital where it is also where people
 * film; otherwise the largest city. Every country in C must appear here — a
 * missing one falls back to the country name and is warned about.
 */
const PLACES = {
  'Afghanistan': ['Kabul', 'Herat', 'Mazar'],
  'Albania': ['Tirana', 'Durres'],
  'Algeria': ['Algiers', 'Oran', 'Alger'],
  'Angola': ['Luanda'],
  'Argentina': ['Buenos Aires', 'Cordoba', 'Mendoza'],
  'Armenia': ['Yerevan'],
  'Australia': ['Sydney', 'Melbourne', 'Brisbane'],
  'Austria': ['Vienna', 'Wien', 'Salzburg'],
  'Azerbaijan': ['Baku'],
  'Bangladesh': ['Dhaka', 'Chittagong'],
  'Belarus': ['Minsk'],
  'Belgium': ['Brussels', 'Antwerp', 'Bruges', 'Ghent'],
  'Bolivia': ['La Paz', 'Santa Cruz', 'Sucre'],
  'Brazil': ['Rio de Janeiro', 'Sao Paulo', 'Rio'],
  'Bulgaria': ['Sofia', 'Plovdiv'],
  'Cambodia': ['Phnom Penh', 'Siem Reap'],
  'Canada': ['Toronto', 'Montreal', 'Vancouver'],
  'Chile': ['Santiago', 'Valparaiso'],
  'China': ['Shanghai', 'Beijing', 'Chongqing', 'Shenzhen', 'Guangzhou'],
  'Colombia': ['Bogota', 'Medellin', 'Cartagena'],
  'Cuba': ['Havana', 'Habana'],
  'DR Congo': ['Kinshasa', 'Congo', 'DRC', 'Goma', 'Lubumbashi'],
  'Egypt': ['Cairo', 'Alexandria'],
  'Ethiopia': ['Addis Ababa'],
  'France': ['Paris', 'Marseille', 'Lyon'],
  'Germany': ['Berlin', 'Munich', 'Hamburg'],
  'Ghana': ['Accra', 'Kumasi'],
  'Greece': ['Athens', 'Thessaloniki'],
  'Haiti': ['Port-au-Prince', 'Cap-Haitien'],
  'India': ['Mumbai', 'Delhi', 'Kolkata', 'Varanasi'],
  'Indonesia': ['Jakarta', 'Bali', 'Yogyakarta'],
  'Iran': ['Tehran', 'Isfahan', 'Shiraz'],
  'Iraq': ['Baghdad', 'Erbil', 'Basra'],
  'Ireland': ['Dublin', 'Galway', 'Cork'],
  'Israel': ['Tel Aviv', 'Jerusalem', 'Haifa'],
  'Italy': ['Rome', 'Roma', 'Milan', 'Naples', 'Venice', 'Florence'],
  'Japan': ['Tokyo', 'Osaka', 'Kyoto'],
  'Jordan': ['Amman', 'Petra'],
  'Kazakhstan': ['Almaty', 'Astana'],
  'Kenya': ['Nairobi', 'Mombasa'],
  'Lebanon': ['Beirut'],
  'Libya': ['Tripoli', 'Benghazi'],
  'Malaysia': ['Kuala Lumpur', 'Penang'],
  'Mali': ['Bamako', 'Timbuktu'],
  'Mexico': ['Mexico City', 'CDMX', 'Guadalajara'],
  'Morocco': ['Marrakech', 'Casablanca', 'Fes', 'Rabat', 'Marrakesh'],
  'Myanmar': ['Yangon', 'Mandalay', 'Burma'],
  'Nepal': ['Kathmandu', 'Pokhara'],
  'Netherlands': ['Amsterdam', 'Rotterdam', 'Holland'],
  'New Zealand': ['Auckland', 'Wellington'],
  'Nigeria': ['Lagos', 'Abuja'],
  'North Korea': ['Pyongyang', 'DPRK'],
  'Norway': ['Oslo', 'Bergen'],
  'Pakistan': ['Lahore', 'Karachi', 'Islamabad'],
  'Peru': ['Lima', 'Cusco'],
  'Philippines': ['Manila', 'Cebu'],
  'Poland': ['Warsaw', 'Krakow'],
  'Portugal': ['Lisbon', 'Porto', 'Lisboa'],
  'Romania': ['Bucharest', 'Cluj'],
  'Russia': ['Moscow', 'Saint Petersburg', 'St Petersburg'],
  'Saudi Arabia': ['Riyadh', 'Jeddah', 'Mecca'],
  'Serbia': ['Belgrade', 'Novi Sad'],
  'Somalia': ['Mogadishu', 'Hargeisa'],
  'South Africa': ['Johannesburg', 'Cape Town', 'Durban'],
  'South Korea': ['Seoul', 'Busan'],
  'Spain': ['Madrid', 'Barcelona', 'Seville'],
  'Sudan': ['Khartoum', 'Port Sudan', 'Omdurman'],
  'Sweden': ['Stockholm', 'Gothenburg'],
  'Syria': ['Damascus', 'Aleppo'],
  'Taiwan': ['Taipei', 'Taichung', 'Kaohsiung'],
  'Thailand': ['Bangkok', 'Chiang Mai', 'Pattaya'],
  'Tunisia': ['Tunis', 'Sousse'],
  'Turkey': ['Istanbul', 'Ankara', 'Turkiye'],
  'Uganda': ['Kampala'],
  'Ukraine': ['Kyiv', 'Kiev', 'Lviv', 'Odesa'],
  'United Arab Emirates': ['Dubai', 'Abu Dhabi', 'UAE'],
  'United Kingdom': ['London', 'UK', 'England', 'Edinburgh'],
  'United States': ['New York', 'NYC', 'USA', 'Chicago', 'Los Angeles'],
  'Venezuela': ['Caracas', 'Maracaibo'],
  'Vietnam': ['Hanoi', 'Ho Chi Minh', 'Saigon', 'Viet Nam'],
  'Yemen': ['Sanaa', "Sana'a", 'Aden'],
  'Zimbabwe': ['Harare', 'Bulawayo'],
  // Nations added to the globe after the first pool was built (the C array grew
  // 82 -> 199). First alias is the search city; where a capital's name is shared
  // with somewhere better known (San Jose, Kingston, Georgetown, Nassau, Panama
  // City) it is qualified with the country so the query lands, and NOT_PLACE
  // below rejects the other place. Short names (<= 4 letters) are matched on
  // word boundaries by relevant(), longer ones as substrings — which is why
  // 'Split', 'Male' and 'Galle' are not aliases.
  'Andorra': ['Andorra la Vella'],
  'Antigua and Barbuda': ["St John's Antigua", 'Antigua'],
  'Bahamas': ['Nassau Bahamas', 'Nassau'],
  'Bahrain': ['Manama'],
  'Barbados': ['Bridgetown'],
  'Belize': ['Belize City', 'San Pedro Belize', 'Caye Caulker'],
  'Benin': ['Cotonou', 'Porto-Novo', 'Porto Novo'],
  'Bhutan': ['Thimphu', 'Paro'],
  'Bosnia and Herzegovina': ['Sarajevo', 'Bosnia', 'Mostar'],
  'Botswana': ['Gaborone', 'Maun'],
  'Brunei': ['Bandar Seri Begawan'],
  'Burkina Faso': ['Ouagadougou', 'Bobo-Dioulasso', 'Burkina'],
  'Burundi': ['Bujumbura', 'Gitega'],
  'Cameroon': ['Douala', 'Yaounde', 'Yaoundé'],
  'Cape Verde': ['Praia', 'Cabo Verde', 'Mindelo'],
  'Central African Republic': ['Bangui'],
  'Chad': ["N'Djamena", 'Ndjamena'],
  'Comoros': ['Moroni'],
  'Congo': ['Brazzaville', 'Pointe-Noire', 'Pointe Noire'],
  'Costa Rica': ['San Jose Costa Rica', 'San José Costa Rica', 'Tamarindo', 'Puntarenas'],
  "Cote d'Ivoire": ['Abidjan', 'Ivory Coast', 'Yamoussoukro'],
  'Croatia': ['Zagreb', 'Dubrovnik', 'Split Croatia', 'Zadar'],
  'Cyprus': ['Nicosia', 'Limassol', 'Larnaca', 'Paphos'],
  'Czechia': ['Prague', 'Czech Republic', 'Czech', 'Brno', 'Praha'],
  'Denmark': ['Copenhagen', 'Aarhus', 'København'],
  'Djibouti': ['Djibouti City'],
  'Dominica': ['Roseau'],
  'Dominican Republic': ['Santo Domingo', 'Punta Cana', 'Dominicana'],
  'Ecuador': ['Quito', 'Guayaquil'],
  'El Salvador': ['San Salvador', 'Santa Ana El Salvador'],
  'Equatorial Guinea': ['Malabo', 'Bata'],
  'Eritrea': ['Asmara'],
  'Estonia': ['Tallinn', 'Tartu'],
  'Eswatini': ['Mbabane', 'Swaziland', 'Manzini'],
  'Fiji': ['Suva', 'Nadi'],
  'Finland': ['Helsinki', 'Tampere', 'Turku'],
  'Gabon': ['Libreville'],
  'Gambia': ['Banjul', 'Serekunda'],
  'Georgia': ['Tbilisi', 'Batumi', 'Kutaisi'],
  'Greenland': ['Nuuk', 'Ilulissat'],
  'Grenada': ["St George's Grenada"],
  'Guatemala': ['Guatemala City', 'Antigua Guatemala'],
  'Guinea': ['Conakry'],
  'Guinea-Bissau': ['Bissau'],
  'Guyana': ['Georgetown Guyana', 'Georgetown'],
  'Honduras': ['Tegucigalpa', 'San Pedro Sula', 'Roatan'],
  'Hong Kong': ['Kowloon', 'Mong Kok', 'Tsim Sha Tsui', 'Central Hong Kong'],
  'Hungary': ['Budapest', 'Debrecen'],
  'Iceland': ['Reykjavik', 'Reykjavík'],
  'Jamaica': ['Kingston Jamaica', 'Montego Bay', 'Ocho Rios'],
  'Kiribati': ['Tarawa'],
  'Kosovo': ['Pristina', 'Prishtina', 'Prizren'],
  'Kuwait': ['Kuwait City'],
  'Kyrgyzstan': ['Bishkek', 'Osh'],
  'Laos': ['Vientiane', 'Luang Prabang'],
  'Latvia': ['Riga', 'Rīga'],
  'Lesotho': ['Maseru'],
  'Liberia': ['Monrovia'],
  'Liechtenstein': ['Vaduz'],
  'Lithuania': ['Vilnius', 'Kaunas'],
  'Luxembourg': ['Luxembourg City'],
  'Madagascar': ['Antananarivo', 'Nosy Be'],
  'Malawi': ['Lilongwe', 'Blantyre'],
  'Maldives': ['Maldives', 'Hulhumale', 'Addu'],
  'Malta': ['Valletta', 'Sliema', 'Mdina'],
  'Marshall Islands': ['Majuro'],
  'Mauritania': ['Nouakchott'],
  'Mauritius': ['Port Louis'],
  'Micronesia': ['Pohnpei', 'Chuuk', 'Kolonia'],
  'Moldova': ['Chisinau', 'Chișinău'],
  'Monaco': ['Monte Carlo', 'Monte-Carlo'],
  'Mongolia': ['Ulaanbaatar', 'Ulan Bator'],
  'Montenegro': ['Podgorica', 'Kotor', 'Budva'],
  'Mozambique': ['Maputo'],
  'Namibia': ['Windhoek', 'Swakopmund'],
  'Nauru': ['Yaren'],
  'Nicaragua': ['Managua', 'Granada Nicaragua', 'Leon Nicaragua'],
  'Niger': ['Niamey'],
  'North Macedonia': ['Skopje', 'Macedonia', 'Ohrid'],
  'Oman': ['Muscat', 'Salalah'],
  'Palau': ['Koror'],
  'Palestine': ['Ramallah', 'Gaza', 'Hebron', 'Nablus', 'Bethlehem'],
  'Panama': ['Panama City Panama', 'Casco Viejo', 'Panama City'],
  'Papua New Guinea': ['Port Moresby', 'Lae'],
  'Paraguay': ['Asuncion', 'Asunción'],
  'Puerto Rico': ['San Juan Puerto Rico', 'Old San Juan', 'San Juan', 'Ponce'],
  'Qatar': ['Doha'],
  'Rwanda': ['Kigali'],
  'Saint Kitts and Nevis': ['Basseterre', 'St Kitts', 'St. Kitts', 'Nevis'],
  'Saint Lucia': ['Castries', 'St Lucia', 'St. Lucia'],
  'Saint Vincent and the Grenadines': ['Kingstown', 'St Vincent', 'St. Vincent', 'Bequia'],
  'Samoa': ['Apia'],
  'San Marino': ['San Marino'],
  'Sao Tome and Principe': ['Sao Tome', 'São Tomé'],
  'Senegal': ['Dakar'],
  'Seychelles': ['Victoria Seychelles', 'Mahe', 'Mahé'],
  'Sierra Leone': ['Freetown'],
  'Singapore': ['Marina Bay', 'Orchard Road', 'Chinatown Singapore'],
  'Slovakia': ['Bratislava', 'Kosice', 'Košice'],
  'Slovenia': ['Ljubljana', 'Maribor', 'Bled'],
  'Solomon Islands': ['Honiara'],
  'South Sudan': ['Juba'],
  'Sri Lanka': ['Colombo', 'Kandy'],
  'Suriname': ['Paramaribo'],
  'Switzerland': ['Zurich', 'Zürich', 'Geneva', 'Bern', 'Lucerne'],
  'Tajikistan': ['Dushanbe', 'Khujand'],
  'Tanzania': ['Dar es Salaam', 'Zanzibar', 'Arusha', 'Dodoma'],
  'Timor-Leste': ['Dili', 'East Timor', 'Timor Leste'],
  'Togo': ['Lome', 'Lomé'],
  'Tonga': ["Nuku'alofa", 'Nukualofa'],
  'Trinidad and Tobago': ['Port of Spain', 'Trinidad', 'Tobago'],
  'Turkmenistan': ['Ashgabat'],
  'Tuvalu': ['Funafuti'],
  'Uruguay': ['Montevideo', 'Punta del Este'],
  'Uzbekistan': ['Tashkent', 'Samarkand', 'Bukhara'],
  'Vanuatu': ['Port Vila'],
  'Zambia': ['Lusaka'],
};
/** Title matches that name the WRONG place despite containing an alias. */
const NOT_PLACE = {
  'South Korea': /north korea/,
  'Libya': /lebanon/,
  'Sudan': /south sudan|juba/,
  // Substring aliases that live inside another place's name, and capitals that
  // share a name with a better-known city elsewhere.
  'Georgia': /atlanta|savannah|augusta|\busa\b|united states|america|georgia state|south georgia|georgia tech|\bga\b|england|lioness|midfielder|footballer/,
  'Guinea': /papua|equatorial|bissau|new guinea|guinea pig/,
  'Niger': /nigeria|lagos|abuja|kano|niger delta|niger state|guinea|conakry/,
  'Congo': /kinshasa|dr congo|\bdrc\b|democratic|lubumbashi|goma/,
  'Dominica': /dominican|santo domingo|punta cana/,
  'Samoa': /american samoa|pago pago/,
  'Antigua and Barbuda': /guatemala/,
  'Costa Rica': /california|silicon valley|san jose ca\b/,
  'El Salvador': /bahia|brazil|brasil/,
  'Jamaica': /ontario|canada|new york|queens|jamaica plain/,
  'Bahamas': /long island|new york|nassau county/,
  'Guyana': /penang|malaysia|washington|\bdc\b|texas|south carolina/,
  'Panama': /florida|panama city beach/,
  'Puerto Rico': /argentina|philippines|manila/,
  'Liberia': /costa rica|guanacaste/,
  'Mongolia': /inner mongolia|hohhot|china/,
  'North Macedonia': /thessaloniki|greece|greek/,
  'Monaco': /grand prix|f1|formula/,
  'Palestine': /texas|palestine tx/,
};

const KIND_WORDS = /walk|tour|stroll|life|daily|cam|webcam|live|street|4k|market|downtown|city center|night/;
const JUNK = /#shorts|reaction|trailer|podcast|prank|lyrics|music video|official video|gameplay|minecraft|gta|flight simulator|\bmovie\b/;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const fold = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** App country names, read from the real C array so they always match. */
function appCountries(html) {
  const i = html.search(/const C\s*=\s*\[/);
  if (i < 0) throw new Error('could not find the C country array in void2-final.html');
  let depth = 0; const j = html.indexOf('[', i); let k = j;
  for (; k < html.length; k++) {
    if (html[k] === '[') depth++;
    else if (html[k] === ']') { depth--; if (!depth) break; }
  }
  const names = [];
  // Quote-aware: "Cote d'Ivoire" has an apostrophe inside double quotes, and a
  // [^'"] class ended the match at it (the C array read as "Cote d").
  for (const m of html.slice(j, k + 1).matchAll(/n:\s*(?:"([^"]+)"|'([^']+)')/g)) names.push(m[1] || m[2]);
  return names;
}

/** Every YouTube id already in CAM_SOURCES / RAW_FOOTAGE — never duplicate curated picks. */
function existingIds(html) {
  const ids = new Set();
  for (const anchor of ['const CAM_SOURCES = {', 'const RAW_FOOTAGE = {']) {
    const at = html.indexOf(anchor);
    if (at < 0) { console.warn('WARN: anchor not found, cannot dedupe against it:', anchor); continue; }
    let depth = 0; let k = html.indexOf('{', at);
    const j = k;
    for (; k < html.length; k++) {
      if (html[k] === '{') depth++;
      else if (html[k] === '}') { depth--; if (!depth) break; }
    }
    for (const m of html.slice(j, k + 1).matchAll(/id\s*:\s*['"]([\w-]+)['"]/g)) ids.add(m[1]);
  }
  return ids;
}

function readHandlist() {
  if (!fs.existsSync(HAND)) return {};
  try {
    const j = JSON.parse(fs.readFileSync(HAND, 'utf8'));
    return j && typeof j === 'object' ? (j.sources && typeof j.sources === 'object' ? j.sources : j) : {};
  } catch (e) {
    console.warn('WARN: life-sources.handlist.json unreadable, ignoring:', e.message);
    return {};
  }
}

const hms = s => {
  if (!s) return 0;
  return String(s).split(':').reduce((acc, p) => acc * 60 + (parseInt(p, 10) || 0), 0);
};
const iso8601 = s => {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(s || '');
  return m ? ((+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0)) : 0;
};
/** "Streamed 2 years ago" -> age in years (fractional). Unknown -> 0 (live has none). */
function ageYears(text) {
  const m = /(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago/i.exec(text || '');
  if (!m) return 0;
  const per = { second: 1 / 31536000, minute: 1 / 525600, hour: 1 / 8760, day: 1 / 365,
                week: 7 / 365, month: 1 / 12, year: 1 };
  return +m[1] * per[m[2].toLowerCase()];
}

function relevant(country, title) {
  const t = fold(title);
  if (JUNK.test(t)) return false;
  if (NOT_PLACE[country] && NOT_PLACE[country].test(t)) return false;
  const names = [country, ...(PLACES[country] || [])].map(fold);
  const named = names.some(n => (n.length <= 4
    ? new RegExp('(^|[^a-z])' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z]|$)').test(t)
    : t.includes(n)));
  return named && KIND_WORDS.test(t);
}

function kindOf(queryKind, title, isLive) {
  const t = fold(title);
  if (isLive) return 'livecam';
  if (/day in the life|daily life|life in|living in|real life|everyday life/.test(t) && !/walk|tour/.test(t)) return 'life';
  if (queryKind === 'life' && !/walk|tour/.test(t)) return 'life';
  return 'walk';
}

/** Readable label from a real title, same spirit as RAW_FOOTAGE labels. */
function cleanLabel(title, fallback) {
  let s = String(title || '')
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '')                  // flag pairs
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
    .replace(/[【】《》«»]/g, ' ')
    .replace(/\s*[|•]\s*/g, ' | ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s|:\-–—]+|[\s|:\-–—]+$/g, '')
    .trim();
  if (!s) s = fallback;
  if (s.length > 90) s = s.slice(0, 87).replace(/\s+\S*$/, '') + '…';
  return s;
}

class Blocked extends Error {}

const stats = { searches: 0, searchFail: 0, verified: 0, verifyFail: 0, verifyErr: 0 };

async function fetchText(url, opts = {}) {
  // Connection-level failures ("fetch failed", ECONNRESET, timeouts) come in bursts
  // during a long sweep and clear within seconds; one 2s retry was turning whole
  // countries into "0 candidates". Back off 2s / 5s / 10s / 20s before giving up.
  const backoff = [2000, 5000, 10000, 20000];
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(FETCH_MS), redirect: 'follow', ...opts });
      return { status: r.status, url: r.url, text: await r.text() };
    } catch (e) {
      if (attempt >= backoff.length) throw e;
      await sleep(backoff[attempt]);
    }
  }
}

/* ---------------- Path B: public results page ---------------- */

function walkRenderers(node, out) {
  if (!node || typeof node !== 'object') return;
  if (node.videoRenderer) { out.push(node.videoRenderer); return; }
  for (const k in node) walkRenderers(node[k], out);
}

async function searchPage(q, live) {
  const url = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q) +
              '&sp=' + (live ? SP_LIVE : SP_VIDEOS);
  stats.searches++;
  let r, m;
  // Two tries: YouTube occasionally serves a shell page without ytInitialData.
  // Every results page mentions "recaptcha" in its config, so only a real
  // google.com/sorry redirect or "unusual traffic" text counts as a block.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      r = await fetchText(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } });
    } catch (e) { stats.searchFail++; console.warn(`  search error "${q}": ${e.message}`); return []; }
    if (r.status === 429) throw new Blocked(`HTTP 429 rate limit on "${q}"`);
    if (/consent\.(youtube|google)\.com/.test(r.url) || /<form[^>]+consent\.(youtube|google)\.com/.test(r.text)) {
      throw new Blocked(`consent wall on "${q}" (${r.url})`);
    }
    if (/google\.com\/sorry/.test(r.url) || /unusual traffic/i.test(r.text)) {
      throw new Blocked(`captcha / unusual-traffic page on "${q}" (${r.url})`);
    }
    if (r.status !== 200) { stats.searchFail++; console.warn(`  search HTTP ${r.status} "${q}"`); return []; }
    m = r.text.match(/ytInitialData"?\]?\s*=\s*(\{.*?\});\s*(?:<\/script>|window\[)/s);
    if (m) break;
    await sleep(SLEEP_MS * 3);
  }
  if (!m) { stats.searchFail++; console.warn(`  no ytInitialData "${q}" (${r.text.length} bytes)`); return []; }
  let data;
  try { data = JSON.parse(m[1]); } catch { stats.searchFail++; return []; }
  const vids = []; walkRenderers(data, vids);
  return vids.map(v => {
    const badges = (v.badges || []).map(b => b.metadataBadgeRenderer || {});
    const overlays = (v.thumbnailOverlays || []).map(o => o.thumbnailOverlayTimeStatusRenderer || {});
    const isLive = badges.some(b => b.style === 'BADGE_STYLE_TYPE_LIVE_NOW' || /^live$/i.test(b.label || '')) ||
                   overlays.some(o => o.style === 'LIVE');
    return {
      id: v.videoId,
      title: (v.title && (v.title.runs || []).map(x => x.text).join('')) || (v.title && v.title.simpleText) || '',
      seconds: hms(v.lengthText && v.lengthText.simpleText),
      age: ageYears(v.publishedTimeText && v.publishedTimeText.simpleText),
      isLive, upcoming: !!v.upcomingEventData,
    };
  });
}

/* ---------------- Path A: YouTube Data API v3 ---------------- */

async function apiJSON(endpoint, params) {
  const u = new URL('https://www.googleapis.com/youtube/v3/' + endpoint);
  for (const [k, v] of Object.entries({ ...params, key: API_KEY })) u.searchParams.set(k, v);
  stats.searches++;
  const r = await fetchText(u.toString());
  if (r.status === 429 || (r.status === 403 && /quota/i.test(r.text))) throw new Blocked(`API quota/429 on ${endpoint}`);
  if (r.status !== 200) { stats.searchFail++; console.warn(`  API ${endpoint} HTTP ${r.status}`); return null; }
  return JSON.parse(r.text);
}

async function searchApi(q, live) {
  const after = new Date(Date.now() - MAX_AGE_YRS * 365 * 864e5).toISOString();
  const base = { part: 'snippet', q, type: 'video', videoEmbeddable: 'true', maxResults: '20',
                 relevanceLanguage: 'en', safeSearch: 'moderate' };
  const items = [];
  if (live) {
    const j = await apiJSON('search', { ...base, eventType: 'live' });
    for (const it of (j && j.items) || []) {
      items.push({ id: it.id.videoId, title: it.snippet.title, seconds: 0, age: 0, isLive: true, upcoming: false });
    }
    return items;
  }
  const found = new Map();
  for (const dur of ['long', 'medium']) {
    const j = await apiJSON('search', { ...base, videoDuration: dur, publishedAfter: after });
    for (const it of (j && j.items) || []) if (it.id && it.id.videoId) found.set(it.id.videoId, it.snippet.title);
    await sleep(SLEEP_MS);
  }
  const ids = [...found.keys()];
  for (let i = 0; i < ids.length; i += 50) {
    const j = await apiJSON('videos', { part: 'contentDetails,snippet', id: ids.slice(i, i + 50).join(',') });
    for (const v of (j && j.items) || []) {
      items.push({ id: v.id, title: v.snippet.title, seconds: iso8601(v.contentDetails.duration),
                   age: (Date.now() - Date.parse(v.snippet.publishedAt)) / (365 * 864e5),
                   isLive: v.snippet.liveBroadcastContent === 'live', upcoming: v.snippet.liveBroadcastContent === 'upcoming' });
    }
  }
  return items;
}

/* ---------------- verification ---------------- */

const verifyCache = new Map();
/** oEmbed 200 = exists AND embeddable. 401 = embedding disabled, 404 = gone/private. */
async function verify(id) {
  if (verifyCache.has(id)) return verifyCache.get(id);
  const p = (async () => {
    const url = 'https://www.youtube.com/oembed?format=json&url=' +
                encodeURIComponent('https://www.youtube.com/watch?v=' + id);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(FETCH_MS), headers: { 'User-Agent': UA } });
        if (r.status === 429) { await sleep(5000 * (attempt + 1)); continue; }
        if (r.status === 200) {
          const j = await r.json().catch(() => ({}));
          stats.verified++; return { ok: true, title: j.title || '' };
        }
        stats.verifyFail++; return { ok: false };
      } catch { await sleep(1500); }
    }
    stats.verifyErr++; return { ok: false };
  })();
  verifyCache.set(id, p);
  return p;
}

async function pool(items, worker, n) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const at = i++; out[at] = await worker(items[at]); }
  }));
  return out;
}

/* ---------------- main ---------------- */

(async () => {
  const t0 = Date.now();
  const html = fs.readFileSync(SRC, 'utf8');
  const countries = appCountries(html).filter(n => !ONLY || ONLY.has(n));
  const curated = existingIds(html);
  const hand = readHandlist();
  console.log('app countries mapped from C array :', countries.length);
  console.log('curated ids (CAM + RAW) to skip   :', curated.size);
  console.log('hand-list countries               :', Object.keys(hand).length, fs.existsSync(HAND) ? '' : '(no handlist file)');
  console.log('search path                       :', API_KEY ? 'A — YouTube Data API v3' : 'B — public results page');
  for (const n of countries) if (!PLACES[n]) console.warn('WARN: no city mapping for', n, '— using the country name');

  const search = API_KEY ? searchApi : searchPage;
  const candidates = {};           // country -> [{id,label,kind,hand,rank}]
  let blocked = null;

  const cached = CANDIDATES && fs.existsSync(CANDIDATES) ? JSON.parse(fs.readFileSync(CANDIDATES, 'utf8')) : null;
  if (cached) console.log(`\nreusing search candidates from ${CANDIDATES} (no search requests)`);
  else console.log(`\nsearching (${SLEEP_MS}ms between requests)…`);
  for (const country of countries) {
    if (cached) { candidates[country] = cached[country] || []; continue; }
    const city = (PLACES[country] || [country])[0];
    const list = candidates[country] = [];
    const seen = new Set();
    const queries = [
      { q: `${city} walking tour 4K`, kind: 'walk' },
      { q: `${country} day in the life`, kind: 'life' },
      { q: `${city} street walk`, kind: 'walk' },
      { q: `${city} live street cam`, kind: 'livecam', live: true },
      { q: `live walk ${city}`, kind: 'livecam', live: true },
    ];
    for (const { q, kind, live } of queries) {
      const vod = list.filter(c => c.kind !== 'livecam').length;
      const lives = list.filter(c => c.kind === 'livecam').length;
      if (!live && q.includes('street walk') && vod >= PER_COUNTRY * 2) continue;   // enough already
      if (live && lives >= MAX_LIVE * 2) continue;
      let items;
      try { items = await search(q, !!live); }
      catch (e) { if (e instanceof Blocked) { blocked = e.message; break; } throw e; }
      for (const v of items) {
        if (!v.id || !/^[\w-]{11}$/.test(v.id) || seen.has(v.id) || curated.has(v.id) || v.upcoming) continue;
        if (live ? !v.isLive : (v.isLive || v.seconds <= MIN_SECONDS || v.age > MAX_AGE_YRS + 0.99)) continue;
        if (!relevant(country, v.title)) continue;
        seen.add(v.id);
        const k = kindOf(kind, v.title, v.isLive);
        list.push({ id: v.id, kind: k, label: cleanLabel(v.title, `${city} ${k === 'life' ? 'daily life' : k === 'livecam' ? 'live cam' : 'walking tour'}`), rank: list.length });
      }
      await sleep(SLEEP_MS);
    }
    console.log(`  ${country.padEnd(22)} ${String(list.length).padStart(3)} candidates`);
    if (blocked) break;
  }

  if (CANDIDATES && !cached && !blocked) {
    fs.writeFileSync(CANDIDATES, JSON.stringify(candidates));
    console.log('saved search candidates to', CANDIDATES);
  }
  if (blocked) {
    console.error('\nBLOCKED:', blocked);
    console.error('Stopped searching. Re-run later / from a normal residential network.');
  }

  // Selection: hand entries first, then an interleave walk / life / livecam so a
  // country is not six near-identical walking tours. Verify in that order and
  // stop once the country is full, so failures backfill from further down.
  const final = {}; const usedIds = new Set(curated);
  const order = { walk: 0, life: 1, livecam: 2 };
  const verifyJobs = countries.map(country => async () => {
    const handEntries = (Array.isArray(hand[country]) ? hand[country] : [])
      .filter(h => h && /^[\w-]{11}$/.test(h.id || ''))
      .map(h => ({ id: h.id, label: h.label || '', kind: order[h.kind] !== undefined ? h.kind : 'walk', hand: true }));
    const found = candidates[country] || [];
    const byKind = { walk: [], life: [], livecam: [] };
    for (const c of found) byKind[c.kind].push(c);
    const mixed = [];
    for (let i = 0; mixed.length < found.length; i++) {
      for (const k of ['walk', 'life', 'walk', 'livecam']) {
        const c = byKind[k].shift();
        if (c) mixed.push(c);
      }
      if (i > 200) break;
    }
    const out = []; let lives = 0;
    for (const c of [...handEntries, ...mixed]) {
      if (out.length >= PER_COUNTRY) break;
      if (usedIds.has(c.id)) continue;
      if (c.kind === 'livecam' && lives >= MAX_LIVE) continue;
      usedIds.add(c.id);                              // claim before await: no cross-country dupes
      const v = await verify(c.id);
      if (!v.ok) continue;
      if (c.kind === 'livecam') lives++;
      out.push({ type: 'youtube', id: c.id, label: c.label || cleanLabel(v.title, country), kind: c.kind });
    }
    if (out.length) final[country] = out;
  });

  console.log(`\nverifying with oEmbed (concurrency ${CONCURRENCY})…`);
  await pool(verifyJobs, job => job(), CONCURRENCY);

  const ordered = {};
  for (const n of countries) if (final[n]) ordered[n] = final[n];
  const total = Object.values(ordered).reduce((a, v) => a + v.length, 0);

  console.log('\nper country:');
  for (const n of countries) {
    const v = ordered[n] || [];
    const k = v.reduce((a, e) => (a[e.kind]++, a), { walk: 0, life: 0, livecam: 0 });
    console.log(`  ${n.padEnd(22)} ${v.length}  (walk ${k.walk}, life ${k.life}, live ${k.livecam})`);
  }
  const empty = countries.filter(n => !ordered[n]);
  const secs = Math.round((Date.now() - t0) / 1000);
  console.log('\nsearch requests :', stats.searches, `(${stats.searchFail} failed)`);
  console.log('oEmbed verified :', stats.verified, `ok, ${stats.verifyFail} rejected, ${stats.verifyErr} errored`);
  console.log('empty countries :', empty.length ? empty.join(', ') : 'none');
  console.log('runtime         :', secs + 's');

  if (!total) {
    console.error('\nFAILED: pool is empty — NOT writing', path.relative(ROOT, OUT));
    process.exit(1);
  }
  const target = (blocked || ONLY) ? PARTIAL : OUT;   // --only runs never clobber the full pool
  fs.writeFileSync(target, JSON.stringify(ordered, null, 1));
  console.log('\nWROTE', path.relative(ROOT, target));
  console.log('  entries  :', total);
  console.log('  countries:', Object.keys(ordered).length, '/', countries.length);
  if (blocked) {
    console.error('  (blocked run — wrote the PARTIAL file, left', path.relative(ROOT, OUT), 'untouched)');
    process.exit(2);
  }
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
