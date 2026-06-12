// The tournament harness must be unbiased: with the SAME evaluator on both
// sides, swapping who moves first cancels exactly, so A and B win equally.  This
// proves the measurement is sound before it is used to judge an eval change.
import assert from 'node:assert/strict';
import { findCard } from './data.js';
import type { GameState, InPlay, ConcreteEnergy, PlayerState } from './types.js';
import { evaluate } from './evaluate.js';
import { runTournament } from './tournament.js';

const ip = (name: string, energy: ConcreteEnergy[] = []): InPlay =>
  ({ card: findCard(name), energy, damage: 0, turnPlayedOrEvolved: 0 });
const side = (active: InPlay, bench: InPlay[], zone: ConcreteEnergy[]): PlayerState =>
  ({ name: 'p', active, bench, hand: [], deckCount: 20, discardCount: 0, points: 0, energyZone: zone, pendingEnergy: null, energyAttachedThisTurn: false });
const game = (p0: PlayerState, p1: PlayerState): GameState =>
  ({ toMove: 0, turn: 1, isFirstPlayerFirstTurn: false, players: [p0, p1] });

const BOARDS: GameState[] = [
  game(side(ip('Charizard ex'), [ip('Marowak ex')], ['Fire']), side(ip('Pikachu ex'), [ip('Articuno ex')], ['Lightning'])),
  game(side(ip('Charizard ex'), [ip('Articuno ex')], ['Fire']), side(ip('Greninja'), [ip('Snorlax')], ['Water'])),
];

let passed = 0;
const t = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ok  ${name}`); };
console.log('tournament tests:');

t('harness is unbiased: evaluate vs evaluate is perfectly balanced', () => {
  const r = runTournament(evaluate, evaluate, BOARDS, { maxTurns: 60 });
  assert.equal(r.games, BOARDS.length * 2, 'each board played twice');
  // Identical evals on both sides + the side swap => A and B win exactly equally.
  assert.equal(r.aWins, r.bWins, `expected balance, got A:${r.aWins} B:${r.bWins} draws:${r.draws}`);
});

console.log(`\n${passed} passed`);
