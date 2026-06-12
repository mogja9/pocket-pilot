import type { InPlay, PlayerState, EnergyType } from './types.js';

// Board-dependent attack damage.  The dataset has no effect text, so for the
// handful of attacks whose damage scales with the board ("Nx" that means
// per-something rather than per-coin-flip) we encode the real formula here,
// keyed by `${cardName}::${attackName}`.  A scaling fn returns the BASE damage
// (before coin/weakness) given the live board; attacks not listed fall back to
// the dataset's flat base floor.

export interface ScaleCtx {
  attacker: InPlay;
  defender: InPlay;
  me: PlayerState;   // the attacking player (their bench, energy, etc.)
  opp: PlayerState;  // the defending player
}
export type ScaleFn = (ctx: ScaleCtx) => number;

function benchCountOfType(p: PlayerState, t: EnergyType): number {
  return p.bench.filter((ip) => ip.card.type === t).length;
}

export const SCALING: Record<string, ScaleFn> = {
  // 30 damage for each of YOUR Benched Lightning Pokemon (0 if none benched).
  'Pikachu ex::Circle Circuit': ({ me }) => 30 * benchCountOfType(me, 'Lightning'),
};

export function scalingFor(cardName: string, attackName: string): ScaleFn | undefined {
  return SCALING[`${cardName}::${attackName}`];
}
