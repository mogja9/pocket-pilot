// Regenerate the trimmed card dataset (data/ptcgp-cards.json) from source.
//
// Source: hugoburguete/pokemon-tcg-pocket-card-database (per-set en JSON, the
// only open dataset found that includes attacks).  We keep ONLY the fields the
// engine adapter (src/card-index.ts) reads, which roughly halves the file and
// the web bundle.
//
// Run:  npm run build:data
// (Uses node's global fetch.  If your network blocks raw.githubusercontent over
// node TLS, fetch each set with `curl` into a folder and adapt this to read it.)

import { writeFileSync } from 'node:fs';

const BASE = 'https://raw.githubusercontent.com/hugoburguete/pokemon-tcg-pocket-card-database/main/cards/en';
const SETS = [
  'a1-genetic-apex', 'a1a-mythical-island', 'a2-space-time-smackdown', 'a2a-triumphant-light',
  'a2b-shining-revelry', 'a3-celestial-guardians', 'a3a-extradimensional-crisis', 'a3b-eevee-grove',
  'a4-wisdom-of-sea-and-sky', 'a4a-secluded-springs', 'a4b-deluxe-pack-ex', 'b1-mega-rising',
  'b1a-crimson-blaze', 'b2-fantastical-parade', 'b2a-paldean-wonders', 'b2b-mega-shine',
  'b3-pulsing-aura', 'b3a-paradox-drive', 'promo-a', 'promo-b',
];

const trim = (c) => {
  const o = { id: c.id, name: c.name, type: c.type, subtype: c.subtype };
  if (c.element != null) o.element = c.element;
  if (c.health != null) o.health = c.health;
  if (c.retreatCost != null) o.retreatCost = c.retreatCost;
  if (c.weakness != null) o.weakness = c.weakness;
  if (c.evolvesFrom != null) o.evolvesFrom = c.evolvesFrom;
  if (Array.isArray(c.attacks) && c.attacks.length)
    o.attacks = c.attacks.map((a) => ({ name: a.name, damage: a.damage, cost: a.cost }));
  return o;
};

const all = [];
for (const s of SETS) {
  const res = await fetch(`${BASE}/${s}.json`);
  if (!res.ok) throw new Error(`fetch ${s}: ${res.status}`);
  const data = await res.json();
  for (const c of Array.isArray(data) ? data : data.cards ?? []) all.push(trim(c));
}
writeFileSync(new URL('../data/ptcgp-cards.json', import.meta.url), JSON.stringify(all));
console.log(`wrote ${all.length} trimmed cards to data/ptcgp-cards.json`);
