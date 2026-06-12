import type { GameState } from './types.js';
import { legalMoves, applyMove, isTerminal, type Move } from './rules.js';
import { evaluate } from './evaluate.js';

const MAX_TURN_DEPTH = 5; // a turn is a handful of setup actions then an attack/pass

// Best achievable equity for the player to move, exploring full action sequences
// this turn (each ending in attack or endTurn).  Returns the value and the plan.
function bestTurn(state: GameState, perspective: 0 | 1, depth: number): { value: number; plan: Move[] } {
  let best: { value: number; plan: Move[] } | null = null;
  for (const move of legalMoves(state)) {
    let value: number;
    let plan: Move[];
    if (isTerminal(move) || depth <= 1) {
      value = evaluate(applyMove(state, move), perspective);
      plan = [move];
    } else {
      const rec = bestTurn(applyMove(state, move), perspective, depth - 1);
      value = rec.value;
      plan = [move, ...rec.plan];
    }
    if (!best || value > best.value) best = { value, plan };
  }
  return best ?? { value: evaluate(state, perspective), plan: [{ type: 'endTurn' }] };
}

export interface Recommendation {
  move: Move;          // the immediate action to take
  value: number;       // best equity reachable if you start with this move
  plan: Move[];        // the full planned turn beginning with `move`
}

// Rank every legal first move by the best turn-equity reachable after it.
export function recommend(state: GameState): Recommendation[] {
  const me = state.toMove;
  const recs: Recommendation[] = legalMoves(state).map((move) => {
    const after = applyMove(state, move);
    if (isTerminal(move)) return { move, value: evaluate(after, me), plan: [move] };
    const rec = bestTurn(after, me, MAX_TURN_DEPTH - 1);
    return { move, value: rec.value, plan: [move, ...rec.plan] };
  });
  recs.sort((a, b) => b.value - a.value);
  return recs;
}

export function describeMove(state: GameState, m: Move): string {
  const me = state.players[state.toMove];
  switch (m.type) {
    case 'attachEnergy':
      return `Attach ${me.pendingEnergy ?? 'energy'} to ${m.target === 'active' ? me.active?.card.name ?? 'active' : `bench ${me.bench[m.target]?.card.name ?? m.target}`}`;
    case 'playBasic':
      return `Play ${me.hand[m.handIndex]?.name ?? '?'} to bench`;
    case 'evolve':
      return `Evolve into ${me.hand[m.handIndex]?.name ?? '?'} (${m.target === 'active' ? 'active' : `bench ${m.target}`})`;
    case 'retreat':
      return `Retreat ${me.active?.card.name ?? 'active'} -> ${me.bench[m.benchIndex]?.card.name ?? m.benchIndex}`;
    case 'attack':
      return `Attack: ${me.active?.card.attacks[m.attackIndex]?.name ?? '?'}`;
    case 'endTurn':
      return 'End turn';
  }
}
