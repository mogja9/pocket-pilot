import assert from 'node:assert/strict';
import type { GameState, InPlay, ConcreteEnergy, PlayerState } from './types.js';
import { findCard, findAnyCard, ALL_POKEMON, ALL_CARDS } from './data.js';
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

test('dataset is the complete Limitless pool with effect text', () => {
  // All 20 sets incl. promos = 3406 cards (the live count on the database).
  assert.equal(ALL_CARDS.length, 3406, `expected 3406 cards, got ${ALL_CARDS.length}`);
  // The upgrade over the old source: real attack + ability effect text.
  const crimson = findCard('Charizard ex').attacks.find((a) => a.name === 'Crimson Storm')!;
  assert.match(crimson.text ?? '', /Discard 2 \[R\] Energy/, 'attack effect text is carried');
  const greninja = findCard('Greninja');
  assert.equal(greninja.ability?.name, 'Water Shuriken');
  assert.match(greninja.ability?.text ?? '', /20 damage/, 'ability effect text is carried');
  // Promos resolve too (p-a / p-b ids).
  assert.ok(findAnyCard('Potion'), 'promo trainer Potion is in the pool');
  assert.ok(ALL_CARDS.length > 0 && ALL_CARDS.some((c) => c.id.startsWith('p-b-')), 'P-B promos present');
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

test('coin riders: derived from attack effect text (no hand-coding)', () => {
  const grassDefender = ip('Charmander'); // Fire, not weak to Grass -> no weakness noise
  // P1 "Flip 2 coins. This attack does 50 damage for each heads." -> base 0, EV 50.
  const pinsir = ip('Pinsir');
  const doubleHorn = pinsir.card.attacks.find((a) => a.name === 'Double Horn')!;
  assert.deepEqual(doubleHorn.coin, { flips: 2, damagePerHeads: 50 });
  assert.equal(doubleHorn.damage, 0, 'per-heads rider zeroes the flat base');
  assert.equal(expectedDamage(doubleHorn, pinsir, grassDefender), 50);
  // P2 "Flip a coin. If heads, this attack does 30 more damage." -> base 30 + EV 15.
  const exeggutor = ip('Exeggutor');
  const stomp = exeggutor.card.attacks.find((a) => a.name === 'Stomp')!;
  assert.deepEqual(stomp.coin, { flips: 1, damagePerHeads: 30 });
  assert.equal(stomp.damage, 30, 'heads-bonus rider keeps the flat base');
  assert.equal(expectedDamage(stomp, exeggutor, grassDefender), 45);
  // "Flip a coin. If tails, this attack does nothing." -> base lands 50%.
  const moltres = findCard('Moltres');
  const sky = moltres.attacks.find((a) => a.name === 'Sky Attack')!;
  assert.equal(sky.coin?.successProbability, 0.5);
  assert.equal(sky.damage, 130, 'success-probability rider keeps the flat base');
  // Snorlax (Colorless) is not weak to Fire -> clean 130 x 0.5 = 65.
  assert.equal(expectedDamage(sky, ip('Moltres'), ip('Snorlax')), 65);
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
  // My Pikachu ex (120 HP) is active and CAN attack, but the opponent's Abomasnow
  // can Frost Breath for a flat 120 next turn -> a 2-point KO.  Snorlax (150 HP)
  // survives 120.  A 1-ply engine attacks (deals damage now); a 2-ply engine must
  // retreat.  (A genuinely flat attacker, not a coin-flip one, so the threat is
  // unconditional.)
  const abomasnow = findCard('Abomasnow');
  const lethal = abomasnow.attacks.find((a) => a.damage >= 120 && !a.coin);
  assert.ok(lethal, 'test setup: expected an Abomasnow with a flat >=120 attack');
  const state: GameState = {
    toMove: 0, turn: 8, isFirstPlayerFirstTurn: false,
    players: [
      { name: 'You', active: ip('Pikachu ex', ['Lightning', 'Lightning']),
        bench: [ip('Snorlax')], hand: [], deckCount: 15, discardCount: 0, points: 0,
        energyZone: ['Lightning'], pendingEnergy: 'Lightning', energyAttachedThisTurn: false },
      { name: 'Opp', active: ip('Abomasnow', ['Water', 'Water', 'Water', 'Water']),
        bench: [ip('Articuno ex')], hand: [], deckCount: 15, discardCount: 0, points: 0,
        energyZone: ['Water'], pendingEnergy: null, energyAttachedThisTurn: false },
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

test('status rider: an attack that sleeps the defender blocks their reply', () => {
  const frosmoth = findCard('Frosmoth');
  const psIdx = frosmoth.attacks.findIndex((a) => a.name === 'Powder Snow');
  assert.ok(frosmoth.attacks[psIdx]!.inflicts?.includes('asleep'), 'Powder Snow inflicts asleep (from text)');
  const state: GameState = {
    toMove: 0, turn: 5, isFirstPlayerFirstTurn: false,
    players: [
      { name: 'me', active: ip('Frosmoth', ['Water', 'Water']), bench: [], hand: [], deckCount: 10, discardCount: 0,
        points: 0, energyZone: ['Water'], pendingEnergy: null, energyAttachedThisTurn: false },
      { name: 'opp', active: ip('Pikachu ex', ['Lightning', 'Lightning']), bench: [], hand: [], deckCount: 10, discardCount: 0,
        points: 0, energyZone: ['Lightning'], pendingEnergy: null, energyAttachedThisTurn: false },
    ],
  };
  const after = applyMove(state, { type: 'attack', attackIndex: psIdx });
  assert.equal(after.toMove, 1, 'now the opponent to move');
  assert.ok((after.players[1]!.active!.conditions ?? []).includes('asleep'), 'defender was put to sleep');
  assert.equal(after.players[1]!.active!.damage, 40, 'and still took Powder Snow damage');
  assert.ok(!legalMoves(after).some((m) => m.type === 'attack'), 'asleep defender cannot attack back');
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
