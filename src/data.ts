import { readFileSync } from 'node:fs';
import type { PokemonCard, TrainerCard, Card, Attack, EnergyType, ConcreteEnergy, Stage, CoinFlipEffect } from './types.js';

// Adapter for the hugoburguete/pokemon-tcg-pocket-card-database JSON (vendored
// at data/ptcgp-cards.json).  That dataset has card metadata + attacks
// (name/damage/cost) but NO attack effect text, so:
//   - "40+"  -> base 40, variable=true  (conditional bonus unknown)
//   - "30x"  -> base 30, variable=true  (per-coin or per-bench scaling unknown)
// For a few important coin-flip attacks we restore the real effect via the
// hand-curated COIN_OVERRIDES so the engine keeps reasoning about probability.

interface RawCard {
  id: string; name: string; element?: string; type?: string; subtype?: string;
  health?: number | null; retreatCost?: number | null; weakness?: string | null;
  evolvesFrom?: string | null;
  attacks?: { name: string; damage?: string; cost?: string[] }[];
}

// Hand-curated coin-flip riders for attacks whose real effect the dataset can't
// express (it lacks effect text).  When present, the attack's base damage is set
// to 0 and the rider carries the damage.  Extend this as needed; keep entries
// you can verify against the actual card.  Keyed by `${cardName}::${attackName}`.
const COIN_OVERRIDES: Record<string, CoinFlipEffect> = {
  'Marowak ex::Bonemerang': { flips: 2, damagePerHeads: 80 }, // flip 2, 80 per heads
};

const CONCRETE = new Set<string>(['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal']);

function parseDamage(raw: string | undefined): { damage: number; variable: boolean } {
  const s = (raw ?? '').trim();
  const m = /^(\d+)/.exec(s);
  return { damage: m ? Number(m[1]) : 0, variable: /[x+]/.test(s) };
}

function toStage(subtype: string | undefined): Stage {
  if (subtype === 'Stage 1') return 'Stage1';
  if (subtype === 'Stage 2') return 'Stage2';
  return 'Basic';
}

function adaptAttack(cardName: string, a: NonNullable<RawCard['attacks']>[number]): Attack {
  const { damage, variable } = parseDamage(a.damage);
  const coin = COIN_OVERRIDES[`${cardName}::${a.name}`];
  return {
    name: a.name,
    cost: (a.cost ?? []) as EnergyType[],
    damage: coin ? 0 : damage, // a coin rider replaces the base "Nx" number
    variable: variable || undefined,
    ...(coin ? { coin } : {}),
    text: a.damage && /[x+]/.test(a.damage) ? `dataset damage "${a.damage}" (base is a floor)` : undefined,
  };
}

function adapt(r: RawCard): Card | null {
  const isPokemon = (r.type ?? '').toLowerCase() === 'pokemon';
  if (!isPokemon) {
    const kind = r.subtype === 'Supporter' ? 'Supporter' : 'Item';
    const t: TrainerCard = { id: r.id, name: r.name, kind };
    return t;
  }
  const weak = r.weakness && CONCRETE.has(r.weakness) ? (r.weakness as ConcreteEnergy) : undefined;
  const p: PokemonCard = {
    id: r.id,
    name: r.name,
    kind: 'Pokemon',
    type: (r.element && r.element !== 'None' ? r.element : 'Colorless') as EnergyType,
    hp: r.health ?? 0,
    stage: toStage(r.subtype),
    isEx: r.name.toLowerCase().endsWith(' ex'),
    retreatCost: r.retreatCost ?? 0,
    ...(weak ? { weakness: weak } : {}),
    ...(r.evolvesFrom ? { evolvesFrom: r.evolvesFrom } : {}),
    attacks: (r.attacks ?? []).map((a) => adaptAttack(r.name, a)),
  };
  return p;
}

const RAW: RawCard[] = JSON.parse(
  readFileSync(new URL('../data/ptcgp-cards.json', import.meta.url), 'utf8'),
);

export const ALL_CARDS: Card[] = RAW.map(adapt).filter((c): c is Card => c !== null);
export const ALL_POKEMON: PokemonCard[] = ALL_CARDS.filter((c): c is PokemonCard => c.kind === 'Pokemon');

const byName = new Map<string, PokemonCard[]>();
for (const p of ALL_POKEMON) {
  const arr = byName.get(p.name) ?? [];
  arr.push(p);
  byName.set(p.name, arr);
}

// Look up a Pokemon by exact name (first printing).  Throws if unknown so the
// CLI/tests fail loudly on a typo rather than silently misbehaving.
export function findCard(name: string): PokemonCard {
  const hits = byName.get(name);
  if (!hits || hits.length === 0) throw new Error(`no Pokemon named "${name}" in dataset`);
  return hits[0]!;
}

export function hasCard(name: string): boolean {
  return byName.has(name);
}
