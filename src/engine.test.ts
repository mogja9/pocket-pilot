import assert from 'node:assert/strict';
import type { GameState, InPlay, ConcreteEnergy, PlayerState } from './types.js';
import { findCard, ALL_POKEMON } from './data.js';
import { canPayCost, expectedDamage } from './rules.js';
import { recommend } from './recommend.js';

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

function ip(name: string, energy: ConcreteEnergy[] = [], damage = 0): InPlay {
  return { card: findCard(name), energy, damage, turnPlayedOrEvolved: 1 };
}

console.log('engine tests:');

test('dataset loads a real card pool', () => {
  assert.ok(ALL_POKEMON.length > 1000, `expected a large pool, got ${ALL_POKEMON.length}`);
  const zard = findCard('Charizard ex');
  assert.equal(zard.hp, 180);
  assert.equal(zard.isEx, true);
  assert.ok(zard.attacks.some((a) => a.name === 'Crimson Storm' && a.damage === 200));
});

test('canPayCost: Colorless is a wildcard', () => {
  assert.equal(canPayCost(['Fire', 'Fire', 'Fire'], ['Fire', 'Colorless', 'Colorless']), true);
  assert.equal(canPayCost(['Fire', 'Fire', 'Fire'], ['Fire', 'Fire', 'Colorless', 'Colorless']), false);
  assert.equal(canPayCost(['Water', 'Water'], ['Fire', 'Colorless']), false);
});

test('expectedDamage: coin override EV + weakness', () => {
  const marowak = ip('Marowak ex', ['Fighting', 'Fighting']);
  const bonemerang = marowak.card.attacks.find((a) => a.name === 'Bonemerang')!;
  // Bonemerang: 2 flips x 80 -> EV 80; Articuno ex is not weak to Fighting.
  assert.equal(expectedDamage(bonemerang, marowak, ip('Articuno ex')), 80);
  // Pikachu ex is weak to Fighting -> +20.
  assert.equal(expectedDamage(bonemerang, marowak, ip('Pikachu ex')), 100);
});

test('recommend: finds the attach-then-Crimson-Storm KO of an ex', () => {
  const zard = findCard('Charizard ex');
  const crimsonIdx = zard.attacks.findIndex((a) => a.name === 'Crimson Storm');
  const state: GameState = {
    toMove: 0, turn: 5, isFirstPlayerFirstTurn: false,
    players: [
      { name: 'You', active: ip('Charizard ex', ['Fire', 'Fire', 'Fire']),
        bench: [ip('Articuno ex')], hand: [], deckCount: 18, discardCount: 0, points: 0,
        energyZone: ['Fire'], pendingEnergy: 'Fire', energyAttachedThisTurn: false },
      { name: 'Opp', active: ip('Pikachu ex', ['Lightning']), bench: [ip('Articuno ex')],
        hand: [], deckCount: 18, discardCount: 0, points: 0,
        energyZone: ['Lightning'], pendingEnergy: null, energyAttachedThisTurn: false },
    ],
  };
  const best = recommend(state)[0]!;
  assert.ok(best.plan.some((m) => m.type === 'attack' && m.attackIndex === crimsonIdx),
    'best plan should include Crimson Storm');
  assert.ok(best.value >= 2000, `expected KO-of-ex equity, got ${best.value}`);
});

test('2-ply: retreats a threatened ex instead of hanging it to a lethal reply', () => {
  // My Pikachu ex (120 HP) is active and CAN attack, but the opponent's Moltres
  // can Sky Attack for 130 next turn -> a 2-point KO.  Snorlax (150 HP) survives
  // 130.  A 1-ply engine attacks (deals damage now); a 2-ply engine must retreat.
  const moltres = findCard('Moltres');
  const lethal = moltres.attacks.find((a) => a.damage >= 120);
  assert.ok(lethal, 'test setup: expected a Moltres with a >=120 flat attack');
  const state: GameState = {
    toMove: 0, turn: 8, isFirstPlayerFirstTurn: false,
    players: [
      { name: 'You', active: ip('Pikachu ex', ['Lightning', 'Lightning']),
        bench: [ip('Snorlax')], hand: [], deckCount: 15, discardCount: 0, points: 0,
        energyZone: ['Lightning'], pendingEnergy: 'Lightning', energyAttachedThisTurn: false },
      { name: 'Opp', active: ip('Moltres', ['Fire', 'Fire', 'Fire']),
        bench: [ip('Articuno ex')], hand: [], deckCount: 15, discardCount: 0, points: 0,
        energyZone: ['Fire'], pendingEnergy: null, energyAttachedThisTurn: false },
    ],
  };
  const recs = recommend(state);
  const top = recs[0]!;
  // The best line must plan to retreat the threatened ex (multiple first moves
  // tie since attach-then-retreat reaches the same safe state).
  assert.ok(top.plan.some((m) => m.type === 'retreat'),
    `top plan should retreat the ex; got ${top.plan.map((m) => m.type).join('>')}`);
  // And attacking while staying active (hanging the ex) must score strictly worse.
  const attackLine = recs.find((r) => r.move.type === 'attack');
  assert.ok(attackLine && attackLine.value < top.value,
    'hanging the ex to a lethal reply should score worse than retreating');
});

test('scaling: Circle Circuit deals 30 x benched Lightning', () => {
  const pikachu = ip('Pikachu ex', ['Lightning', 'Lightning']);
  const cc = pikachu.card.attacks.find((a) => a.name === 'Circle Circuit')!;
  const defender = ip('Charmander'); // Fire, not weak to Lightning
  const mk = (bench: InPlay[]): PlayerState => ({
    name: 'p', active: pikachu, bench, hand: [], deckCount: 0, discardCount: 0,
    points: 0, energyZone: ['Lightning'], pendingEnergy: null, energyAttachedThisTurn: false,
  });
  const opp = mk([]);
  assert.equal(expectedDamage(cc, pikachu, defender, mk([]), opp), 0, '0 benched Lightning -> 0');
  const twoLightning = mk([ip('Pikachu ex'), ip('Pikachu ex')]);
  assert.equal(expectedDamage(cc, pikachu, defender, twoLightning, opp), 60, '2 benched Lightning -> 60');
});

console.log(`\n${passed} passed`);
