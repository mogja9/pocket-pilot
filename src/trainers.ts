import type { GameState } from './types.js';

// A small registry of combat-relevant trainer cards.  The dataset has no
// trainer effect text, so the impactful ones are encoded here by name.  `apply`
// mutates the state from the perspective of the player `side` who plays it;
// `usable` (optional) gates whether the play is legal/useful.

export interface TrainerEffect {
  kind: 'Item' | 'Supporter';
  apply: (state: GameState, side: 0 | 1) => void;
  usable?: (state: GameState, side: 0 | 1) => boolean;
}

const other = (s: 0 | 1): 0 | 1 => (s ^ 1) as 0 | 1;

export const TRAINERS: Record<string, TrainerEffect> = {
  // Heal 20 damage from your Active Pokemon.
  Potion: {
    kind: 'Item',
    apply: (s, side) => { const a = s.players[side].active; if (a) a.damage = Math.max(0, a.damage - 20); },
    usable: (s, side) => { const a = s.players[side].active; return !!a && a.damage > 0; },
  },
  // The Retreat Cost of your Active is 1 less this turn.
  'X Speed': {
    kind: 'Item',
    apply: (s, side) => { const p = s.players[side]; p.retreatReduction = (p.retreatReduction ?? 0) + 1; },
  },
  // Your Pokemon's attacks do +10 damage to the opponent's Active this turn.
  Giovanni: {
    kind: 'Supporter',
    apply: (s, side) => { const p = s.players[side]; p.attackBonus = (p.attackBonus ?? 0) + 10; },
  },
  // Switch out the opponent's Active to the Bench (opponent picks the new
  // Active; approximated here by promoting their first benched Pokemon).
  Sabrina: {
    kind: 'Supporter',
    apply: (s, side) => {
      const o = s.players[other(side)];
      if (o.active && o.bench.length) { const old = o.active; o.active = o.bench.shift()!; o.bench.push(old); }
    },
    usable: (s, side) => { const o = s.players[other(side)]; return !!o.active && o.bench.length > 0; },
  },
  // Draw cards: no combat effect in this model.
  "Professor's Research": { kind: 'Supporter', apply: () => {} },

  // Switch in 1 of the opponent's DAMAGED benched Pokemon to the Active Spot (a
  // setup/finish enabler).  We pull the most-damaged (ex first), to expose the
  // best knockout target; the displaced active goes to their bench.
  Cyrus: {
    kind: 'Supporter',
    apply: (s, side) => {
      const o = s.players[other(side)];
      const cands = o.bench.filter((b) => b.damage > 0);
      if (!o.active || !cands.length) return;
      cands.sort((a, b) => (Number(b.card.isEx) - Number(a.card.isEx)) || (b.damage - a.damage));
      const pick = cands[0]!;
      o.bench.splice(o.bench.indexOf(pick), 1);
      o.bench.push(o.active);
      o.active = pick;
    },
    usable: (s, side) => { const o = s.players[other(side)]; return !!o.active && o.bench.some((b) => b.damage > 0); },
  },
  // During this turn, your attacks do +20 to the opponent's Active ONLY if it is
  // an ex.
  Red: {
    kind: 'Supporter',
    apply: (s, side) => { const p = s.players[side]; p.attackBonusVsEx = (p.attackBonusVsEx ?? 0) + 20; },
    usable: (s, side) => !!s.players[other(side)].active?.card.isEx,
  },
  // The Retreat Cost of your Active is 2 less this turn (a bigger X Speed).
  Leaf: {
    kind: 'Supporter',
    apply: (s, side) => { const p = s.players[side]; p.retreatReduction = (p.retreatReduction ?? 0) + 2; },
  },
  // Move an Energy from 1 of your Benched Pokemon to your Active (energy accel to
  // power up an attack a turn early).
  Dawn: {
    kind: 'Supporter',
    apply: (s, side) => {
      const p = s.players[side];
      const donor = p.bench.find((b) => b.energy.length);
      if (p.active && donor) p.active.energy.push(donor.energy.shift()!);
    },
    usable: (s, side) => { const p = s.players[side]; return !!p.active && p.bench.some((b) => b.energy.length > 0); },
  },
  // Heal 50 damage from 1 of your damaged Grass Pokemon (heal the most-hurt one).
  Erika: {
    kind: 'Supporter',
    apply: (s, side) => {
      const p = s.players[side];
      const grass = [p.active, ...p.bench].filter((x): x is NonNullable<typeof x> => !!x && x.card.type === 'Grass' && x.damage > 0);
      if (!grass.length) return;
      grass.sort((a, b) => b.damage - a.damage);
      grass[0]!.damage = Math.max(0, grass[0]!.damage - 50);
    },
    usable: (s, side) => { const p = s.players[side]; return [p.active, ...p.bench].some((x) => x && x.card.type === 'Grass' && x.damage > 0); },
  },
};

export function trainerEffect(name: string): TrainerEffect | undefined {
  return TRAINERS[name];
}
