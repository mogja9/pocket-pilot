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
};

export function trainerEffect(name: string): TrainerEffect | undefined {
  return TRAINERS[name];
}
