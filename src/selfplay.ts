// Self-play driver: play both sides with recommend() to a finish.  This is an
// end-to-end check (catches multi-turn stalls / illegal states that single
// decision tests miss) and the substrate for measuring engine strength.
//
// The engine generates energy only at advise time, so the driver primes the
// mover's pendingEnergy from their Energy Zone each turn (round-robin over the
// registered types, since Pocket draws a random one).
import type { GameState } from './types.js';
import { POINTS_TO_WIN } from './types.js';
import { applyMove } from './rules.js';
import { recommend, describeMove } from './recommend.js';

export interface GameOutcome {
  winner: 0 | 1 | null; // null = no winner within maxTurns (a stall)
  turns: number;
  log: string[];
  reason: 'points' | 'no-pokemon' | 'turn-cap';
}

export function playGame(initial: GameState, opts: { maxTurns?: number; verbose?: boolean } = {}): GameOutcome {
  const maxTurns = opts.maxTurns ?? 60;
  let state = structuredClone(initial);
  const log: string[] = [];
  const energyTick: [number, number] = [0, 0];

  for (let t = 0; t < maxTurns; t++) {
    const mover = state.toMove;
    // A player with no Active (and no bench to promote) has lost.
    if (!state.players[mover]!.active) {
      return { winner: (mover ^ 1) as 0 | 1, turns: t, log, reason: 'no-pokemon' };
    }
    // Generate this turn's energy (Pocket: first player's very first turn gets none).
    const p = state.players[mover]!;
    if (!state.isFirstPlayerFirstTurn && p.energyZone.length) {
      p.pendingEnergy = p.energyZone[energyTick[mover] % p.energyZone.length]!;
      energyTick[mover]++;
    }

    const best = recommend(state)[0];
    let s = state;
    if (best) {
      const steps: string[] = [];
      for (const m of best.plan) { steps.push(describeMove(s, m)); s = applyMove(s, m); }
      log.push(`T${state.turn} P${mover}: ${steps.join(' > ')}`);
    }
    if (s.toMove === mover) s = applyMove(s, { type: 'endTurn' }); // ensure the turn passed
    state = s;

    if (state.players[0]!.points >= POINTS_TO_WIN) return { winner: 0, turns: t + 1, log, reason: 'points' };
    if (state.players[1]!.points >= POINTS_TO_WIN) return { winner: 1, turns: t + 1, log, reason: 'points' };
  }
  return { winner: null, turns: maxTurns, log, reason: 'turn-cap' };
}
