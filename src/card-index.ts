import type { PokemonCard, TrainerCard, Card, Attack, EnergyType, ConcreteEnergy, Stage, CoinFlipEffect } from './types.js';

// PURE card-data adapter (no fs, no JSON import) so it runs in both Node and the
// browser.  `buildIndex(raw)` maps the hugoburguete dataset schema to the engine
// model and returns a small lookup index.  The node loader (data.ts) and the web
// app each feed it the raw JSON from their own environment.

export interface RawCard {
  id: string; name: string; element?: string; type?: string; subtype?: string;
  health?: number | null; retreatCost?: number | null; weakness?: string | null;
  evolvesFrom?: string | null;
  attacks?: { name: string; damage?: string; cost?: string[] }[];
}

// Hand-curated coin-flip riders for attacks whose real effect the dataset can't
// express (it lacks effect text).  When present the attack's base damage is set
// to 0 and the rider carries the damage.  Keyed by `${cardName}::${attackName}`.
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

export function adapt(r: RawCard): Card {
  if ((r.type ?? '').toLowerCase() !== 'pokemon') {
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

export interface CardIndex {
  ALL_CARDS: Card[];
  ALL_POKEMON: PokemonCard[];
  findCard: (name: string) => PokemonCard;
  hasCard: (name: string) => boolean;
}

export function buildIndex(raw: RawCard[]): CardIndex {
  const ALL_CARDS = raw.map(adapt);
  const ALL_POKEMON = ALL_CARDS.filter((c): c is PokemonCard => c.kind === 'Pokemon');
  const byName = new Map<string, PokemonCard[]>();
  for (const p of ALL_POKEMON) {
    const arr = byName.get(p.name) ?? [];
    arr.push(p);
    byName.set(p.name, arr);
  }
  return {
    ALL_CARDS,
    ALL_POKEMON,
    findCard(name: string): PokemonCard {
      const hits = byName.get(name);
      if (!hits || hits.length === 0) throw new Error(`no Pokemon named "${name}" in dataset`);
      return hits[0]!;
    },
    hasCard: (name: string) => byName.has(name),
  };
}
