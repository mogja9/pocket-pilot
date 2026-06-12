import type { GameState, PlayerState } from './types.js';
import { POINTS_TO_WIN } from './types.js';

const WIN = 1e6;

function remainingHP(p: PlayerState): number {
  let hp = 0;
  for (const ip of [p.active, ...p.bench]) if (ip) hp += Math.max(0, ip.card.hp - ip.damage);
  return hp;
}
function energyCount(p: PlayerState): number {
  let e = 0;
  for (const ip of [p.active, ...p.bench]) if (ip) e += ip.energy.length;
  return e;
}
function pokemonCount(p: PlayerState): number {
  return (p.active ? 1 : 0) + p.bench.length;
}

// Heuristic value of `state` from `perspective`'s point of view (higher = better
// for that player).  Tuned so the win condition (points) dominates, then board
// control, pressure on the opponent's active, energy tempo, and board presence.
export function evaluate(state: GameState, perspective: 0 | 1): number {
  const me = state.players[perspective];
  const opp = state.players[(perspective ^ 1) as 0 | 1];

  if (me.points >= POINTS_TO_WIN) return WIN;
  if (opp.points >= POINTS_TO_WIN) return -WIN;
  // A player with no Pokemon left loses.
  if (pokemonCount(opp) === 0) return WIN;
  if (pokemonCount(me) === 0) return -WIN;

  let s = 0;
  s += (me.points - opp.points) * 1000;
  s += (remainingHP(me) - remainingHP(opp)) * 1.0;
  // Extra weight on the active matchup (the Pokemon that actually scores points).
  s += (opp.active ? opp.active.damage : 0) * 2.0;
  s -= (me.active ? me.active.damage : 0) * 2.0;
  s += (energyCount(me) - energyCount(opp)) * 5.0;
  s += (pokemonCount(me) - pokemonCount(opp)) * 25.0;
  return s;
}
