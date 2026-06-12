// The tournament harness must be unbiased: with the SAME evaluator on both
// sides, swapping who moves first cancels exactly, so A and B win equally.  This
// proves the measurement is sound before it is used to judge an eval change.
import assert from 'node:assert/strict';
import { evaluate } from './evaluate.js';
import { runTournament } from './tournament.js';
import { diverseBoards } from './tournament-boards.js';

let passed = 0;
const t = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ok  ${name}`); };
console.log('tournament tests:');

t('harness is unbiased across the diverse board set: evaluate vs evaluate balances', () => {
  const boards = diverseBoards();
  const r = runTournament(evaluate, evaluate, boards, { maxTurns: 60 });
  assert.equal(r.games, boards.length * 2, 'each board played twice');
  // Identical evals on both sides + the side swap => A and B win exactly equally.
  // (If this ever fails, the swap or the per-side eval threading is broken.)
  assert.equal(r.aWins, r.bWins, `expected balance, got A:${r.aWins} B:${r.bWins} draws:${r.draws}`);
});

console.log(`\n${passed} passed`);
