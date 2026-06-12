import type { GameState, InPlay, Condition } from './types.js';

// A small registry of ACTIVATED, once-per-turn abilities the engine can model
// (the dataset has the ability text but no structure).  Keyed by ability name.
// `apply` mutates state from the perspective of `side` who owns `source` (the
// in-play Pokemon whose ability it is -- may be benched).  `usable` gates it;
// `requiresActive` restricts it to the Active Spot.  Damage-dealing abilities
// just add damage; applyMove resolves any resulting KO.
export interface AbilityEffect {
  apply: (state: GameState, side: 0 | 1, source: InPlay) => void;
  usable?: (state: GameState, side: 0 | 1, source: InPlay) => boolean;
  requiresActive?: boolean;
}

const opp = (s: 0 | 1): 0 | 1 => (s ^ 1) as 0 | 1;

// Best target for a small snipe: a KO is best (ex first), else the most-damaged.
function snipeTarget(pool: InPlay[], amount: number): InPlay | undefined {
  if (!pool.length) return undefined;
  const score = (ip: InPlay): number => {
    const kos = ip.damage + amount >= ip.card.hp;
    return (kos ? (ip.card.isEx ? 3000 : 2000) : 0) + Math.min(ip.card.hp, ip.damage + amount);
  };
  return [...pool].sort((a, b) => score(b) - score(a))[0];
}

export const ABILITIES: Record<string, AbilityEffect> = {
  // Greninja: once per turn, 20 damage to 1 of the opponent's Pokemon (from the
  // bench too) -- chip or finish a benched threat.
  'Water Shuriken': {
    apply: (s, side) => {
      const o = s.players[opp(side)];
      const t = snipeTarget([o.active, ...o.bench].filter((x): x is InPlay => !!x), 20);
      if (t) t.damage += 20;
    },
    usable: (s, side) => !!s.players[opp(side)].active,
  },
  // Gardevoir: once per turn, attach 1 extra [P] Energy to a Psychic Active.
  'Psy Shadow': {
    apply: (s, side) => { const a = s.players[side].active; if (a && a.card.type === 'Psychic') a.energy.push('Psychic'); },
    usable: (s, side) => { const a = s.players[side].active; return !!a && a.card.type === 'Psychic'; },
  },
  // Magneton: once per turn, attach 1 extra [L] Energy to itself.
  'Volt Charge': {
    apply: (_s, _side, source) => { source.energy.push('Lightning'); },
  },
  // Butterfree: once per turn, heal 20 from each of your Pokemon.
  'Powder Heal': {
    apply: (s, side) => { const p = s.players[side]; for (const x of [p.active, ...p.bench]) if (x) x.damage = Math.max(0, x.damage - 20); },
    usable: (s, side) => { const p = s.players[side]; return [p.active, ...p.bench].some((x) => x && x.damage > 0); },
  },
  // Pidgeot: once per turn, switch the opponent's Active to the Bench (they pick
  // the replacement; approximated by promoting their first benched Pokemon).
  'Drive Off': {
    apply: (s, side) => { const o = s.players[opp(side)]; if (o.active && o.bench.length) { const old = o.active; o.active = o.bench.shift()!; o.bench.push(old); } },
    usable: (s, side) => { const o = s.players[opp(side)]; return !!o.active && o.bench.length > 0; },
  },
  // Victreebel: once per turn while Active, drag 1 of the opponent's Benched BASIC
  // Pokemon into the Active Spot (the most-damaged, to expose it); old active benches.
  'Fragrance Trap': {
    apply: (s, side) => {
      const o = s.players[opp(side)];
      const basics = o.bench.filter((b) => b.card.stage === 'Basic');
      if (!o.active || !basics.length) return;
      basics.sort((a, b) => b.damage - a.damage);
      const pick = basics[0]!;
      o.bench.splice(o.bench.indexOf(pick), 1);
      o.bench.push(o.active);
      o.active = pick;
    },
    usable: (s, side) => { const o = s.players[opp(side)]; return !!o.active && o.bench.some((b) => b.card.stage === 'Basic'); },
    requiresActive: true,
  },
  // Wigglytuff: once per turn, heal 20 from your Active.
  'Comforting Song': {
    apply: (s, side) => { const a = s.players[side].active; if (a) a.damage = Math.max(0, a.damage - 20); },
    usable: (s, side) => { const a = s.players[side].active; return !!a && a.damage > 0; },
  },
  // Hypno: once per turn, flip a coin -> 50% the opponent's Active falls Asleep.
  // Modeled like a coin-gated attack rider (a transient marker) so the 2-ply reply
  // blends over the coin rather than committing to one outcome.
  'Sleep Pendulum': {
    apply: (s, side) => { const o = s.players[opp(side)].active; if (o) o.pendingCoinConditions = [...new Set<Condition>([...(o.pendingCoinConditions ?? []), 'asleep'])]; },
    usable: (s, side) => { const o = s.players[opp(side)].active; return !!o && !(o.conditions ?? []).includes('asleep'); },
  },
  // Weezing: once per turn while Active, poison the opponent's Active.
  'Gas Leak': {
    apply: (s, side) => {
      const o = s.players[opp(side)].active;
      if (o) o.conditions = [...new Set<Condition>([...(o.conditions ?? []), 'poisoned'])];
    },
    usable: (s, side) => { const o = s.players[opp(side)].active; return !!o && !(o.conditions ?? []).includes('poisoned'); },
    requiresActive: true,
  },
};

export function abilityEffect(name: string): AbilityEffect | undefined {
  return ABILITIES[name];
}
