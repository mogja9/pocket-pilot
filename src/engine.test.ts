import assert from 'node:assert/strict';
import type { GameState, InPlay, ConcreteEnergy, PlayerState } from './types.js';
import { findCard, findAnyCard, ALL_POKEMON } from './data.js';
import { canPayCost, expectedDamage, legalMoves, applyMove } from './rules.js';
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

test('condition: paralyzed active cannot attack or retreat', () => {
  const active = ip('Charizard ex', ['Fire', 'Fire', 'Fire']);
  active.conditions = ['paralyzed'];
  const state: GameState = {
    toMove: 0, turn: 5, isFirstPlayerFirstTurn: false,
    players: [
      { name: 'me', active, bench: [ip('Articuno ex')], hand: [], deckCount: 0, discardCount: 0,
        points: 0, energyZone: ['Fire'], pendingEnergy: null, energyAttachedThisTurn: false },
      { name: 'opp', active: ip('Pikachu ex', ['Lightning', 'Lightning']), bench: [], hand: [],
        deckCount: 0, discardCount: 0, points: 0, energyZone: ['Lightning'], pendingEnergy: null, energyAttachedThisTurn: false },
    ],
  };
  const moves = legalMoves(state);
  assert.ok(!moves.some((m) => m.type === 'attack'), 'paralyzed cannot attack');
  assert.ok(!moves.some((m) => m.type === 'retreat'), 'paralyzed cannot retreat');
  assert.ok(moves.some((m) => m.type === 'endTurn'), 'can still end turn');
});

test('condition: poison ticks 10 damage at the between-turn checkup', () => {
  const active = ip('Charizard ex');
  active.conditions = ['poisoned'];
  const state: GameState = {
    toMove: 0, turn: 5, isFirstPlayerFirstTurn: false,
    players: [
      { name: 'me', active, bench: [], hand: [], deckCount: 0, discardCount: 0, points: 0,
        energyZone: ['Fire'], pendingEnergy: null, energyAttachedThisTurn: false },
      { name: 'opp', active: ip('Pikachu ex'), bench: [], hand: [], deckCount: 0, discardCount: 0,
        points: 0, energyZone: ['Lightning'], pendingEnergy: null, energyAttachedThisTurn: false },
    ],
  };
  const after = applyMove(state, { type: 'endTurn' });
  assert.equal(after.players[0]!.active!.damage, 10, 'poisoned active takes 10 at checkup');
  assert.equal(after.players[1]!.active!.damage, 0, 'un-poisoned active unaffected');
});

test('trainer: Sabrina switches the opponent active', () => {
  const sabrina = findAnyCard('Sabrina');
  assert.ok(sabrina && sabrina.kind === 'Supporter', 'Sabrina is a Supporter');
  const state: GameState = {
    toMove: 0, turn: 5, isFirstPlayerFirstTurn: false,
    players: [
      { name: 'me', active: ip('Charizard ex'), bench: [], hand: [sabrina], deckCount: 0, discardCount: 0,
        points: 0, energyZone: ['Fire'], pendingEnergy: null, energyAttachedThisTurn: false },
      { name: 'opp', active: ip('Pikachu ex'), bench: [ip('Charmander')], hand: [], deckCount: 0,
        discardCount: 0, points: 0, energyZone: ['Lightning'], pendingEnergy: null, energyAttachedThisTurn: false },
    ],
  };
  const play = legalMoves(state).find((m) => m.type === 'playTrainer');
  assert.ok(play, 'Sabrina is a legal play (opponent has a bench)');
  const after = applyMove(state, play!);
  assert.equal(after.players[1]!.active!.card.name, 'Charmander', 'opponent active was switched to the bench');
});

test('trainer: Giovanni adds +10 to a damaging attack', () => {
  const attacker = ip('Charizard ex', ['Fire', 'Fire', 'Fire']);
  const defender = ip('Pikachu ex'); // Lightning, not weak to Fire
  const slash = attacker.card.attacks.find((a) => a.name === 'Slash')!;
  const mk = (bonus?: number): PlayerState => ({
    name: 'p', active: attacker, bench: [], hand: [], deckCount: 0, discardCount: 0, points: 0,
    energyZone: ['Fire'], pendingEnergy: null, energyAttachedThisTurn: false, attackBonus: bonus,
  });
  const base = expectedDamage(slash, attacker, defender, mk(), mk());
  const boosted = expectedDamage(slash, attacker, defender, mk(10), mk());
  assert.equal(boosted - base, 10, 'Giovanni adds +10');
});

console.log(`\n${passed} passed`);
