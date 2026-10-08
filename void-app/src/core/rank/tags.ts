// ─── TAG INFERENCE ───────────────────────────────────────────────────────
// BIO.rankScore sums p.tags against BIO.tags. Upstream sources carry no tags in
// that vocabulary, so without this every post scored 0 on interest and the ranker
// could not learn. Maps source metadata + text onto the BIO vocabulary.

export const SUB_TAGS: Record<string, string[]> = {
  combatfootage: ['warfare', 'graphic'], ukrainianconflict: ['warfare', 'geopolitics'],
  worldnews: ['geopolitics'], geopolitics: ['geopolitics', 'power'], news: ['geopolitics'],
  worldevents: ['geopolitics'], internationalnews: ['geopolitics'], middleeastnews: ['geopolitics', 'theology'],
};

// Terms match on WORD BOUNDARIES, never raw substrings ("hand warmers" is not
// warfare, "a couple months" is not a coup). A trailing '*' marks a stem.
export const TAG_KEYWORDS: Record<string, string[]> = {
  // CRISIS leads so it is tags[0] — diversify() buckets on tags[0], which keeps a
  // breaking disaster from stacking consecutive slots. Added after the Nepal /
  // Bhotekoshi glacial flood (Aug-Sep 2026, 1,300+ dead) was invisible to the gate.
  // Only strong terms here; ambiguous ones count only in pairs (CRISIS_WEAK).
  crisis: ['tragedy', 'disaster*', 'catastroph*', 'death toll', 'casualt*', 'massacre*', 'stampede*', 'earthquake*', 'landslide*', 'mudslide*', 'avalanche*', 'tsunami', 'flash flood*', 'floods', 'flooding', 'glacial lake', 'glacial flood', 'cyclone', 'plane crash', 'helicopter crash', 'bus crash', 'train crash', 'derail*', 'capsiz*', 'shipwreck', 'building collapse', 'bridge collapse', 'dam collapse', 'curfew', 'crackdown', 'state of emergency', 'martial law', 'feared dead', 'bodies recovered', 'rescuers', 'evacuat*', 'mass shooting', 'gunman', 'famine', 'cholera'],
  warfare: ['war', 'wars', 'warfare', 'strike', 'strikes', 'airstrike*', 'shelling', 'frontline', 'front line', 'missile*', 'drone*', 'artillery', 'offensive', 'combat', 'troops', 'soldier*', 'ceasefire', 'invasion', 'invaded', 'bombard*'],
  graphic: ['killed', 'dead', 'death toll', 'casualt*', 'massacre*', 'bodies', 'wounded', 'execution', 'executed', 'atrocit*', 'genocide', 'beheaded', 'corpse*'],
  geopolitics: ['border', 'borders', 'sanction*', 'treaty', 'summit', 'nato', 'united nations', 'embassy', 'diplomat*', 'election*', 'parliament', 'annex*'],
  power: ['regime', 'coup', 'coups', 'president', 'presidency', 'minister', 'oligarch*', 'corruption', 'corrupt', 'crackdown', 'martial law', 'dictator*', 'junta'],
  surveillance: ['surveillance', 'facial recognition', 'spyware', 'wiretap*', 'privacy', 'censorship', 'censor*', 'mass tracking'],
  resistance: ['protest*', 'uprising', 'revolt', 'demonstrat*', 'riot', 'riots', 'rioting', 'dissident*', 'resistance', 'insurgen*'],
  theology: ['islam*', 'christian*', 'jewish', 'muslim*', 'church', 'mosque', 'synagogue', 'sectarian', 'religio*', 'cleric*', 'jihad*', 'caliphate'],
  AI: ['ai', 'artificial intelligence', 'algorithm*', 'openai', 'chatbot*', 'deepfake*', 'llm', 'machine learning'],
  // The conspiracy register the app is built around: suppressed warnings, blame, cover-ups.
  deception: ['propaganda', 'disinformation', 'misinformation', 'psyop*', 'bot network', 'cover-up', 'cover up', 'covered up', 'falsified', 'forged', 'conspirac*', 'false flag', 'whistleblower*', 'leaked', 'they knew', 'was warned', 'were warned', 'ignored warnings', 'nobody is answering', 'no one is answering'],
  identity: ['diaspora', 'refugee*', 'migrant*', 'ethnic', 'ethnicity', 'minority', 'citizenship', 'statelessness'],
  philosophy: ['philosoph*', 'morality', 'existential', 'nihilis*', 'ideolog*'],
  // Street-level incidents: how a viral current-events clip is captioned ("Tempe Police
  // push, tackle and punch...", "Footage shows..."). None of it matched, so the reel
  // lanes dropped exactly those clips as untagged. Bare shot / shooting / fight / crash
  // are phrases only: "great shot", "shooting on 35mm", "fight for", "crash course".
  // TAG_KEYWORDS gates the main feed too, so no bare footage / officer / cop / viral
  // ("gameplay footage", "chief executive officer", "cop these sneakers", "song went viral").
  incident: ['police', 'policeman', 'policemen', 'police officer*', 'officer-involved', 'cops', 'cop car*', 'bodycam*', 'body cam*', 'dashcam*', 'dash cam*', 'cctv', 'caught on camera', 'caught on video',
    'arrest', 'arrests', 'arrested', 'handcuff*', 'detain*', 'taser*', 'tased', 'tear gas', 'teargas', 'pepper spray*', 'rubber bullet*',
    'shootings', 'school shooting', 'fatal shooting', 'shooting suspect', 'shooting victim*', 'shot dead', 'shot and killed', 'was shot', 'were shot', 'got shot', 'gunfire', 'gunshot*', 'opened fire', 'stabbing', 'stabbed',
    'brawl*', 'fistfight*', 'fist fight', 'fight breaks out', 'fight broke out', 'street fight', 'punched', 'assault*',
    'car crash', 'crashed into', 'crashes into', 'pileup', 'pile-up', 'hit-and-run', 'hit and run', 'rammed into', 'ramming', 'kidnap*', 'carjack*', 'robbery', 'looting', 'manhunt',
    'ice agents', 'federal agents', 'border patrol'],
  // ---- Everything below exists so the feed has RANGE. The vocabulary above is all
  // conflict and politics, and the tag gate discards anything matching none of it.
  science: ['science', 'scientist*', 'research', 'researcher*', 'study finds', 'physics', 'biolog*', 'chemistr*', 'neuroscience', 'genome', 'quantum', 'experiment*'],
  space: ['nasa', 'spacex', 'rocket', 'satellite*', 'orbit', 'mars', 'lunar', 'asteroid', 'telescope', 'galaxy', 'astronaut*', 'spacecraft', 'eclipse'],
  tech: ['software', 'hardware', 'startup*', 'silicon valley', 'semiconductor*', 'robotic*', 'robot', 'crypto', 'blockchain', 'open source', 'engineer*', 'browser', 'encryption'],
  climate: ['climate', 'wildfire*', 'flood*', 'flooding', 'drought', 'hurricane', 'typhoon', 'earthquake', 'emissions', 'glacier*', 'heatwave', 'renewable*'],
  nature: ['forest*', 'ocean', 'coral', 'ecosystem*', 'conservation', 'rainforest', 'extinct*', 'climate'],
  // Pets/wildlife as CONTENT, split out of nature so it can be governed on its own.
  animals: ['wildlife', 'species', 'animal*', 'bird*', 'birding', 'whale*', 'cat', 'cats', 'kitten*', 'kitty', 'dog', 'dogs', 'puppy', 'pupper', 'doggo', 'pet', 'pets', 'hedgehog', 'squirrel', 'bunny', 'rabbit', 'hamster', 'parrot', 'meow', 'purr', 'caturday', 'zoomies', 'aquarium', 'zoo', 'kingfisher'],
  culture: ['museum', 'exhibition', 'literature', 'novel', 'poet*', 'festival', 'heritage', 'archive*', 'translation', 'folklore'],
  art: ['art', 'artist*', 'painting', 'sculpture', 'illustration', 'photograph*', 'architecture', 'mural', 'gallery', 'typograph*'],
  music: ['music', 'album', 'song', 'band', 'concert', 'guitar', 'jazz', 'hip hop', 'orchestra', 'composer', 'vinyl'],
  film: ['film', 'movie', 'cinema', 'documentary', 'screenplay', 'filmmaker*', 'trailer', 'animation'],
  sport: ['football', 'soccer', 'basketball', 'olympic*', 'tournament', 'league', 'athlete*', 'marathon', 'cricket', 'tennis', 'boxing', 'formula 1'],
  food: ['recipe', 'restaurant', 'chef', 'cuisine', 'coffee', 'harvest', 'farming', 'bakery'],
  history: ['history', 'historic*', 'archaeolog*', 'ancient', 'medieval', 'empire', 'artifact*', 'excavation', 'manuscript*'],
  health: ['medicine', 'vaccine*', 'hospital', 'disease', 'mental health', 'virus', 'doctor*', 'therapy', 'outbreak'],
  economy: ['economy', 'inflation', 'currency', 'unemployment', 'tariff*', 'recession', 'housing', 'labour', 'labor union'],
  games: ['gaming', 'video game*', 'console', 'esports', 'nintendo', 'playstation', 'xbox', 'speedrun*'],
};

// Compiled once. '*' => stem (prefix match); otherwise the whole word must match.
export const TAG_RE: Record<string, RegExp[]> = (() => {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const out: Record<string, RegExp[]> = {};
  for (const tag in TAG_KEYWORDS) {
    out[tag] = TAG_KEYWORDS[tag].map(k => k.endsWith('*')
      ? new RegExp('\\b' + esc(k.slice(0, -1)), 'i')
      : new RegExp('\\b' + esc(k) + '\\b', 'i'));
  }
  return out;
})();

// Ambiguous crisis words ("I'm dead", "missing the point") — two DISTINCT hits
// together ("dead … missing", "trapped … rescue") are a disaster report.
export const CRISIS_WEAK = /\b(dead|died|deaths|victims|missing|trapped|buried|survivors?|rescued?|rescuing|flood|blast|explosion|collapsed?|mourning|vigil|wall of (?:water|ice|mud)|swept away|villages?)\b/gi;
// The lexicon is English-only and \b is ASCII-only, so reports in Nepali/Hindi,
// Spanish, Portuguese, Italian, French, German, Dutch, Arabic, Chinese, Japanese,
// Russian, Bengali and Urdu scored NOTHING. Distinctive stems only.
export const CRISIS_INTL = /मृत्यु|मारिए|मृतक|बाढी|बाढ़|पहिरो|भूकम्प|भूकंप|हिमताल|बेपत्ता|लापता|उद्धार|दुर्घटना|कर्फ्यु|कर्फ्यू|त्रासदी|विपद्|आपदा|قتلى|ضحايا|فيضان|زلزال|انهيار|死亡|遇难|遇難|洪水|地震|滑坡|泥石流|死者|行方不明|土砂崩れ|津波|погиб|жертв|наводнен|землетрясен|оползн|катастроф|বন্যা|سیلاب|ہلاک|\b(muertos|mortos|fallecidos|v[ií]ctimas|vittime|victimes|opfer|slachtoffers|doden|toten|inundaci[oó]n|inunda[cç][aã]o|alluvione|inondations?|hochwasser|sturzflut|[üu]berschwemmung|overstroming|terremoto|s[ée]isme|erdbeben|aardbeving|deslizamiento|erdrutsch|tragedia|trag[ée]die|katastrophe|rescatad|resgatad|sauvetage|rettungskr)/iu;

/**
 * Returns [] when nothing matches. Must NOT fall back to a real topic: a default of
 * 'geopolitics' once stamped ~89% of whats-hot (pet photos, birthdays) as
 * geopolitics. Empty tags is the honest answer, and callers gate on it.
 */
export function inferTags(text: unknown, extra?: string[]): string[] {
  const t = String(text || ''); const out = new Set<string>(extra || []);
  for (const tag in TAG_RE) { if (TAG_RE[tag].some(re => re.test(t))) out.add(tag); }
  if (!out.has('crisis')) {
    const weak = new Set((t.match(CRISIS_WEAK) || []).map(w => w.toLowerCase().replace(/s$/, '')));
    if (weak.size >= 2 || CRISIS_INTL.test(t)) out.add('crisis');
  }
  return [...out];
}
