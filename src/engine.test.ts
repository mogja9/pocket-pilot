import assert from 'node:assert/strict';
import type { GameState, InPlay, ConcreteEnergy } from './types.js';
import { card } from './cards.js';
import { canPayCost, expectedDamage } from './rules.js';
import { recommend } from './recommend.js';

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

function ip(id: Parameters<typeof card>[0], energy: ConcreteEnergy[] = [], damage = 0): InPlay {
  return { card: card(id), energy, damage, turnPlayedOrEvolved: 1 };
}

console.log('engine tests:');

test('canPayCost: Colorless is a wildcard', () => {
  assert.equal(canPayCost(['Fire', 'Fire', 'Fire'], ['Fire', 'Colorless', 'Colorless']), true);
  assert.equal(canPayCost(['Fire', 'Fire', 'Fire'], ['Fire', 'Fire', 'Colorless', 'Colorless']), false);
  assert.equal(canPayCost(['Water', 'Water'], ['Fire', 'Colorless']), false); // no Fire to satisfy
});

test('expectedDamage: coin EV + weakness', () => {
  const marowak = ip('marowak_ex', ['Fighting', 'Fighting']);   // Fighting
  // Bonemerang: 2 flips x 80, EV 80; defender weak to Fighting -> +20.
  const grassDefender = ip('articuno_ex'); // weakness Lightning (not Fighting)
  assert.equal(expectedDamage(marowak.card.attacks[0]!, marowak, grassDefender), 80);
  // Build a defender weak to Fighting via Pikachu ex (weakness Fighting).
  const pika = ip('pikachu_ex');
  assert.equal(expectedDamage(marowak.card.attacks[0]!, marowak, pika), 100); // 80 + 20 weakness
});

test('recommend: finds the attach-then-Crimson-Storm KO of an ex', () => {
  const state: GameState = {
    toMove: 0, turn: 5, isFirstPlayerFirstTurn: false,
    players: [
      { name: 'You', active: ip('charizard_ex', ['Fire', 'Fire', 'Fire']),
        bench: [ip('articuno_ex')], hand: [], deckCount: 18, discardCount: 0, points: 0,
        energyZone: ['Fire'], pendingEnergy: 'Fire', energyAttachedThisTurn: false },
      { name: 'Opp', active: ip('pikachu_ex', ['Lightning']), bench: [ip('articuno_ex')],
        hand: [], deckCount: 18, discardCount: 0, points: 0,
        energyZone: ['Lightning'], pendingEnergy: null, energyAttachedThisTurn: false },
    ],
  };
  const recs = recommend(state);
  const best = recs[0]!;
  // The top line should plan a Crimson Storm (200 -> KO Pikachu ex).
  assert.ok(best.plan.some((m) => m.type === 'attack' && m.attackIndex === 1),
    'best plan should include Crimson Storm');
  // ex KO is worth 2 points: equity should clear the 2-point (2000) threshold.
  assert.ok(best.value >= 2000, `expected KO-of-ex equity, got ${best.value}`);
});

console.log(`\n${passed} passed`);
