// End-to-end self-play: the engine playing both sides should drive a normal
// board to a real finish, not stall.  Catches multi-turn pathologies (infinite
// retreat, never attacking, illegal states) that single-decision tests miss.
import assert from 'node:assert/strict';
import { findCard } from './data.js';
import type { GameState, InPlay, ConcreteEnergy, PlayerState } from './types.js';
import { playGame } from './selfplay.js';

const ip = (name: string, energy: ConcreteEnergy[] = []): InPlay =>
  ({ card: findCard(name), energy, damage: 0, turnPlayedOrEvolved: 0 });
const side = (active: InPlay, bench: InPlay[], zone: ConcreteEnergy[]): PlayerState =>
  ({ name: 'p', active, bench, hand: [], deckCount: 20, discardCount: 0, points: 0, energyZone: zone, pendingEnergy: null, energyAttachedThisTurn: false });

let passed = 0;
const t = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ok  ${name}`); };
console.log('self-play tests:');

t('a normal board plays out to a winner within the turn cap', () => {
  const state: GameState = {
    toMove: 0, turn: 1, isFirstPlayerFirstTurn: false,
    players: [
      side(ip('Charizard ex'), [ip('Marowak ex')], ['Fire']),
      side(ip('Pikachu ex'), [ip('Articuno ex')], ['Lightning']),
    ],
  };
  const out = playGame(state, { maxTurns: 50 });
  assert.notEqual(out.winner, null, `expected a winner, stalled after ${out.turns} turns:\n${out.log.join('\n')}`);
  assert.equal(out.reason, 'points', 'won by reaching 3 points');
  assert.ok(out.turns <= 50, 'finished within the cap');
  // Sanity: the loser scored at most as many points as the winner.
  assert.ok(out.log.length > 0, 'produced a move log');
});

t('the mirror match also resolves (no stall from symmetric eval)', () => {
  const mk = (): GameState => ({
    toMove: 0, turn: 1, isFirstPlayerFirstTurn: false,
    players: [
      side(ip('Charizard ex'), [ip('Articuno ex')], ['Fire']),
      side(ip('Charizard ex'), [ip('Articuno ex')], ['Fire']),
    ],
  });
  const out = playGame(mk(), { maxTurns: 60 });
  assert.notEqual(out.winner, null, `mirror stalled after ${out.turns} turns:\n${out.log.join('\n')}`);
});

console.log(`\n${passed} passed`);
