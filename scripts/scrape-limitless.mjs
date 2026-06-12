// Build the card dataset by scraping pocket.limitlesstcg.com (the de-facto
// competitive PTCGP database -- the same org whose CDN already serves our card
// art, so ids line up 1:1).  This REPLACES the old hugoburguete source because
// Limitless is complete (all 20 sets = 3406 cards, incl. every promo) AND it
// carries the one thing hugo lacked: real attack / ability EFFECT TEXT.
//
// Each card page is small static server-rendered HTML; we parse it with regex
// (no deps) into the engine's RawCard shape (src/card-index.ts) plus the new
// `text` (attack effect) and `ability` fields.
//
// Run:  npm run build:data
// Output: data/ptcgp-cards.json
//
// Polite: small concurrency, retries, descriptive UA.  ~3400 requests, a few
// minutes.  Numbers in a set are contiguous 1..count (verified against the set
// index), so we enumerate rather than scrape each set listing.

import { writeFileSync } from 'node:fs';

const BASE = 'https://pocket.limitlesstcg.com/cards';
const UA = 'pocket-pilot-datasync/1.0 (personal move-optimizer; contact via github)';

// [Limitless set code, card count] in release order; counts from /cards index.
// Sum = 3406, matching the live database.
const SETS = [
  ['A1', 286], ['A1a', 86], ['A2', 207], ['A2a', 96], ['A2b', 111],
  ['A3', 239], ['A3a', 103], ['A3b', 107], ['A4', 241], ['A4a', 105], ['A4b', 379],
  ['B1', 331], ['B1a', 103], ['B2', 234], ['B2a', 131], ['B2b', 117], ['B3', 234], ['B3a', 109],
  ['P-A', 117], ['P-B', 70],
];

// ptcg-symbol font letters -> energy type.  Pocket has no Fairy.
const SYM = { G: 'Grass', R: 'Fire', W: 'Water', L: 'Lightning', P: 'Psychic', F: 'Fighting', D: 'Darkness', M: 'Metal', N: 'Dragon', C: 'Colorless' };

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ', eacute: 'é', times: 'x', rsquo: '’', hellip: '…', deg: '°' };
function decode(s) {
  return s.replace(/&(#?\w+);/g, (m, e) => (e in ENTITIES ? ENTITIES[e] : (e[0] === '#' ? String.fromCharCode(Number(e.slice(1))) : ' ')));
}
// Visible text of an HTML fragment.  Inline energy symbols are font-span letters
// wrapped in copy-only "[" "]" brackets, so tag-stripping yields "[R]" etc.
function text(html) {
  return decode((html || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}
function firstMatch(re, s) { const m = re.exec(s); return m ? m[1] : ''; }

function parseCard(html, id) {
  const ti = html.indexOf('card-text-title');
  if (ti < 0) return null;
  let block = html.slice(ti);
  const cut = block.search(/card-prints|card-page-aside|<\/main/);
  if (cut > 0) block = block.slice(0, cut);

  const rawName = firstMatch(/card-text-name"><a[^>]*>([^<]+)<\/a>|card-text-name">\s*<a[^>]*>([^<]+)<\/a>/, block);
  const nm = firstMatch(/card-text-name">\s*<a[^>]*>([^<]+)<\/a>/, block);
  const name = decode(nm || rawName).trim();
  if (!name) return null;

  const typeBlock = firstMatch(/<p class="card-text-type">([\s\S]*?)<\/p>/, block);
  const typeText = text(typeBlock);
  const isTrainer = /Trainer/.test(typeText);

  if (isTrainer) {
    const subtype = /Supporter/.test(typeText) ? 'Supporter' : /Stadium/.test(typeText) ? 'Stadium' : /Tool/.test(typeText) ? 'Tool' : 'Item';
    const eff = text(firstMatch(/<div class="card-text-section">([\s\S]*?)<\/div>/, block));
    const o = { id, name, type: 'Trainer', subtype };
    if (eff) o.text = eff;
    return o;
  }

  const elHp = /-\s*([A-Za-z]+)\s*-\s*(\d+)\s*HP/.exec(block);
  const element = elHp ? elHp[1] : undefined;
  const health = elHp ? Number(elHp[2]) : undefined;
  const subtype = /Stage 2/.test(typeText) ? 'Stage 2' : /Stage 1/.test(typeText) ? 'Stage 1' : 'Basic';
  const evolvesFrom = (() => {
    const m = /Evolves from[\s\S]*?<a[^>]*>([^<]+)<\/a>/.exec(typeBlock);
    return m ? decode(m[1]).trim() : undefined;
  })();

  const attacks = [];
  for (const am of block.matchAll(/<div class="card-text-attack">([\s\S]*?)<\/div>/g)) {
    const ab = am[1];
    const info = firstMatch(/<p class="card-text-attack-info">([\s\S]*?)<\/p>/, ab);
    const symbols = firstMatch(/<span class="ptcg-symbol">([A-Z]*)<\/span>/, info);
    const cost = [...symbols].map((c) => SYM[c]).filter(Boolean);
    const rest = text(info.replace(/<span class="ptcg-symbol">[A-Z]*<\/span>/, ''));
    const dm = /(?:^|\s)(\d+[x+]?)$/.exec(rest);
    const atk = { name: dm ? rest.slice(0, rest.length - dm[1].length).trim() : rest, cost };
    if (dm) atk.damage = dm[1];
    const eff = text(firstMatch(/<p class="card-text-attack-effect">([\s\S]*?)<\/p>/, ab));
    if (eff) atk.text = eff;
    attacks.push(atk);
  }

  let ability;
  const abm = /<div class="card-text-ability">([\s\S]*?)<\/div>/.exec(block);
  if (abm) {
    const an = text(firstMatch(/card-text-ability-info">([\s\S]*?)<\/p>/, abm[1])).replace(/^Ability:\s*/, '');
    const at = text(firstMatch(/card-text-ability-effect">([\s\S]*?)<\/p>/, abm[1]));
    if (an) ability = { name: an, text: at };
  }

  const wrr = text(firstMatch(/<p class="card-text-wrr">([\s\S]*?)<\/p>/, block));
  const weakRaw = firstMatch(/Weakness:\s*([A-Za-z]+)/, wrr);
  const weakness = weakRaw && weakRaw !== 'None' ? weakRaw : undefined;
  const retreatCost = Number(firstMatch(/Retreat:\s*(\d+)/, wrr) || 0);

  const o = { id, name, type: 'Pokemon', subtype, element, health, retreatCost };
  if (weakness) o.weakness = weakness;
  if (evolvesFrom) o.evolvesFrom = evolvesFrom;
  if (attacks.length) o.attacks = attacks;
  if (ability) o.ability = ability;
  return o;
}

async function fetchCard(code, num, tries = 3) {
  const id = `${code.toLowerCase()}-${String(num).padStart(3, '0')}`;
  const url = `${BASE}/${code}/${num}`;
  for (let t = 0; t < tries; t++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.status === 404) return { id, missing: true };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const card = parseCard(await res.text(), id);
      if (!card) throw new Error('parse: no card block');
      return { id, card };
    } catch (e) {
      if (t === tries - 1) return { id, error: String(e.message || e) };
      await new Promise((r) => setTimeout(r, 400 * (t + 1)));
    }
  }
}

// bounded-concurrency map
async function pmap(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }));
  return out;
}

// Optional limits for a quick validation pass: PP_ONLY=A1a, PP_MAXN=5
const ONLY = process.env.PP_ONLY ? process.env.PP_ONLY.split(',') : null;
const MAXN = process.env.PP_MAXN ? Number(process.env.PP_MAXN) : Infinity;
const activeSets = ONLY ? SETS.filter(([c]) => ONLY.includes(c)) : SETS;

const jobs = [];
for (const [code, count] of activeSets) for (let n = 1; n <= Math.min(count, MAXN); n++) jobs.push([code, n]);
console.log(`scraping ${jobs.length} cards from ${activeSets.length} sets...`);

const cards = [];
const failures = [];
let done = 0;
await pmap(jobs, 8, async ([code, n]) => {
  const r = await fetchCard(code, n);
  if (r.card) cards.push(r.card);
  else failures.push(r);
  if (++done % 250 === 0) console.log(`  ${done}/${jobs.length}  (${cards.length} ok, ${failures.length} miss/err)`);
});

// stable order: by set release order, then number
const setOrder = new Map(SETS.map(([c], i) => [c.toLowerCase(), i]));
cards.sort((a, b) => {
  const [as, an] = [a.id.slice(0, a.id.lastIndexOf('-')), Number(a.id.slice(a.id.lastIndexOf('-') + 1))];
  const [bs, bn] = [b.id.slice(0, b.id.lastIndexOf('-')), Number(b.id.slice(b.id.lastIndexOf('-') + 1))];
  return (setOrder.get(as) - setOrder.get(bs)) || (an - bn);
});

const OUT = process.env.PP_OUT || new URL('../data/ptcgp-cards.json', import.meta.url);
writeFileSync(OUT, JSON.stringify(cards));
const errs = failures.filter((f) => f.error);
console.log(`\nwrote ${cards.length} cards to ${OUT}`);
console.log(`missing (404): ${failures.filter((f) => f.missing).length}, errors: ${errs.length}`);
if (errs.length) console.log('errors:', errs.slice(0, 20).map((f) => `${f.id} ${f.error}`).join('\n  '));
