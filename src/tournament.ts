// Eval A/B tournament: pit two evaluators against each other from a set of
// starting boards.  Each board is played twice with the sides swapped, so
// first-move advantage cancels and the score reflects eval strength, not who
// moved first.  The engine is deterministic, so each game is reproducible.
//
// MEASUREMENT NOTE: full-game A/B turns out to be INSENSITIVE to small evaluate.ts
// tweaks.  Self-play is dominated by the points*1000 KO race in the terminal
// eval, which both evaluators navigate identically, so a small heuristic term
// rarely flips a game's winner (a +/-40 KO-proximity term, even scaled to 800,
// changed 0 of 24 games across the diverse board set).  Use this harness for
// LARGE changes (new terms, different search depth); for the small-tweak quality
// signal, rely on src/scenarios.test.ts (decision agreement on tactical
// positions), which is the sensitive instrument and the actual regression guard.
import type { GameState } from './types.js';
import { playGame } from './selfplay.js';
import type { EvalFn } from './recommend.js';

export interface TournamentResult {
  aWins: number;
  bWins: number;
  draws: number; // games that hit the turn cap with no winner
  games: number;
}

export function runTournament(evalA: EvalFn, evalB: EvalFn, boards: GameState[], opts: { maxTurns?: number } = {}): TournamentResult {
  const maxTurns = opts.maxTurns ?? 60;
  let aWins = 0, bWins = 0, draws = 0;
  for (const board of boards) {
    // Game 1: A is player 0 (moves first), B is player 1.
    const g1 = playGame(board, { maxTurns, evals: [evalA, evalB] });
    if (g1.winner === 0) aWins++; else if (g1.winner === 1) bWins++; else draws++;
    // Game 2: swap sides so B moves first; cancels first-move advantage.
    const g2 = playGame(board, { maxTurns, evals: [evalB, evalA] });
    if (g2.winner === 0) bWins++; else if (g2.winner === 1) aWins++; else draws++;
  }
  return { aWins, bWins, draws, games: boards.length * 2 };
}
