import type { PokemonCard, TrainerCard, Card, Attack, EnergyType, ConcreteEnergy, Stage, CoinFlipEffect } from './types.js';
import { coinRiderFromText, defenderConditionsFromText, energyDiscardsFromText, healFromText, splashFromText, coinInflictFromText, scalingFromText, conditionalsFromText } from './effect-text.js';

// PURE card-data adapter (no fs, no JSON import) so it runs in both Node and the
// browser.  `buildIndex(raw)` maps the hugoburguete dataset schema to the engine
// model and returns a small lookup index.  The node loader (data.ts) and the web
// app each feed it the raw JSON from their own environment.

export interface RawCard {
  id: string; name: string; element?: string; type?: string; subtype?: string;
  health?: number | null; retreatCost?: number | null; weakness?: string | null;
  evolvesFrom?: string | null;
  attacks?: { name: string; damage?: string; cost?: string[]; text?: string }[];
  ability?: { name: string; text: string };
  text?: string; // trainer effect text
}

// Last-resort hand-curated coin-flip riders, for the rare attack whose wording
// the text parser (effect-text.ts) can't safely template.  An override is always
// a per-heads rider, so the attack's base damage is set to 0 and the rider
// carries the damage.  Keyed by `${cardName}::${attackName}`.
//
// Empty today: the regular coin templates (incl. Marowak ex Bonemerang) are now
// derived from the dataset's real effect text instead of being hardcoded here.
const COIN_OVERRIDES: Record<string, CoinFlipEffect> = {};

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
  const override = COIN_OVERRIDES[`${cardName}::${a.name}`];
  const textRider = override ? null : coinRiderFromText(a.text);
  const coin: CoinFlipEffect | undefined = override
    ? override
    : textRider
      ? {
          flips: textRider.flips,
          damagePerHeads: textRider.damagePerHeads,
          ...(textRider.successProbability != null ? { successProbability: textRider.successProbability } : {}),
        }
      : undefined;
  const scaling = scalingFromText(a.text);
  const conditional = conditionalsFromText(a.text);
  // A per-heads rider ("Nx" = "N damage for each heads") means the dataset's
  // number is the per-heads value, so the flat base is 0.  A heads-bonus rider
  // ("N+" = "+N on heads") keeps the flat base.  Board scaling of the
  // "N damage for each X" form (replacesBase) likewise carries the whole damage,
  // so its flat base is 0 too.
  const zeroBase = override ? true : (textRider?.zeroBase ?? false) || (scaling?.replacesBase ?? false);
  const inflicts = defenderConditionsFromText(a.text);
  const discards = energyDiscardsFromText(a.text);
  const heal = healFromText(a.text);
  const splash = splashFromText(a.text);
  const coinInflict = coinInflictFromText(a.text);
  return {
    name: a.name,
    cost: (a.cost ?? []) as EnergyType[],
    damage: zeroBase ? 0 : damage,
    variable: variable || undefined,
    ...(coin ? { coin } : {}),
    ...(scaling ? { scaling } : {}),
    ...(conditional.length ? { conditional } : {}),
    ...(inflicts.length ? { inflicts } : {}),
    ...(discards.length ? { discards } : {}),
    ...(heal ? { heal } : {}),
    ...(splash ? { splash } : {}),
    ...(coinInflict.length ? { coinInflict } : {}),
    // Prefer the real effect text now that the dataset carries it; fall back to
    // a note about variable damage for the rare attack without text.
    text: a.text ?? (a.damage && /[x+]/.test(a.damage) ? `dataset damage "${a.damage}" (base is a floor)` : undefined),
  };
}

export function adapt(r: RawCard): Card {
  if ((r.type ?? '').toLowerCase() !== 'pokemon') {
    const kind: TrainerCard['kind'] = r.subtype === 'Supporter' ? 'Supporter' : r.subtype === 'Stadium' ? 'Stadium' : 'Item';
    const t: TrainerCard = { id: r.id, name: r.name, kind, ...(r.text ? { text: r.text } : {}) };
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
    ...(r.ability ? { ability: r.ability } : {}),
  };
  return p;
}

export interface CardIndex {
  ALL_CARDS: Card[];
  ALL_POKEMON: PokemonCard[];
  findCard: (name: string) => PokemonCard;     // Pokemon only (throws if unknown)
  hasCard: (name: string) => boolean;          // is a Pokemon
  findAnyCard: (name: string) => Card | undefined; // any card (Pokemon or trainer)
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
  const byAnyName = new Map<string, Card>();
  for (const c of ALL_CARDS) if (!byAnyName.has(c.name)) byAnyName.set(c.name, c);
  return {
    ALL_CARDS,
    ALL_POKEMON,
    findCard(name: string): PokemonCard {
      const hits = byName.get(name);
      if (!hits || hits.length === 0) throw new Error(`no Pokemon named "${name}" in dataset`);
      return hits[0]!;
    },
    hasCard: (name: string) => byName.has(name),
    findAnyCard: (name: string) => byAnyName.get(name),
  };
}
