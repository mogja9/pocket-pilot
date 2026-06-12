import assert from 'node:assert/strict';
import type { GameState, InPlay, ConcreteEnergy, PlayerState, Card } from './types.js';
import { findCard, findAnyCard, ALL_POKEMON, ALL_CARDS } from './data.js';
import { canPayCost, expectedDamage, legalMoves, applyMove } from './rules.js';
import { recommend, describeMove, summarizeBestLine } from './recommend.js';

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

test('energy-discard rider: stripping the defender can deny their reply', () => {
  const gyarados = findCard('Gyarados');
  const hbIdx = gyarados.attacks.findIndex((a) => a.name === 'Hyper Beam');
  assert.deepEqual(gyarados.attacks[hbIdx]!.discards, [{ target: 'defender', amount: 1 }]);
  const rollout = findCard('Snorlax').attacks.find((a) => a.name === 'Rollout')!;
  const state: GameState = {
    toMove: 0, turn: 6, isFirstPlayerFirstTurn: false,
    players: [
      { name: 'me', active: ip('Gyarados', ['Water', 'Water', 'Water', 'Water']), bench: [], hand: [], deckCount: 10,
        discardCount: 0, points: 0, energyZone: ['Water'], pendingEnergy: null, energyAttachedThisTurn: false },
      { name: 'opp', active: ip('Snorlax', ['Water', 'Water', 'Water', 'Water']), bench: [], hand: [], deckCount: 10,
        discardCount: 0, points: 0, energyZone: ['Water'], pendingEnergy: null, energyAttachedThisTurn: false },
    ],
  };
  assert.ok(canPayCost(['Water', 'Water', 'Water', 'Water'], rollout.cost), 'before: Snorlax can pay Rollout');
  const after = applyMove(state, { type: 'attack', attackIndex: hbIdx });
  assert.equal(after.players[1]!.active!.damage, 100, 'defender took Hyper Beam and survived');
  assert.equal(after.players[1]!.active!.energy.length, 3, 'one energy was discarded off the defender');
  assert.ok(!canPayCost(after.players[1]!.active!.energy, rollout.cost), 'after: can no longer pay its 4-cost attack');
  assert.ok(!legalMoves(after).some((m) => m.type === 'attack'), 'so the defender has no attack on its reply');
});

test('heal rider: a drain attack heals the attacker', () => {
  const vaporeon = findCard('Vaporeon');
  const bdIdx = vaporeon.attacks.findIndex((a) => a.name === 'Bubble Drain');
  assert.deepEqual(vaporeon.attacks[bdIdx]!.heal, { amount: 30, scope: 'self' });
  const active = ip('Vaporeon', ['Water', 'Water', 'Water']);
  active.damage = 50;
  const state: GameState = {
    toMove: 0, turn: 5, isFirstPlayerFirstTurn: false,
    players: [
      { name: 'me', active, bench: [], hand: [], deckCount: 10, discardCount: 0, points: 0,
        energyZone: ['Water'], pendingEnergy: null, energyAttachedThisTurn: false },
      { name: 'opp', active: ip('Pikachu ex', ['Lightning', 'Lightning']), bench: [], hand: [], deckCount: 10,
        discardCount: 0, points: 0, energyZone: ['Lightning'], pendingEnergy: null, energyAttachedThisTurn: false },
    ],
  };
  const after = applyMove(state, { type: 'attack', attackIndex: bdIdx });
  assert.equal(after.players[0]!.active!.damage, 20, 'Bubble Drain healed 30 off the attacker (50 -> 20)');
});

test('summarizeBestLine: reports the point swing and KO of the Crimson Storm line', () => {
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
  const s = summarizeBestLine(state)!;
  assert.ok(s, 'produces a summary');
  assert.equal(s.pointSwing, 2, 'KOing Pikachu ex (an ex) swings 2 points');
  assert.equal(s.kos, true);
  assert.equal(s.myPoints, 2);
  assert.match(s.text, /takes 2 points/);
});

test('summarizeBestLine: predicts the opponent\'s key reply attack', () => {
  // I have no energy and an empty bench (only endTurn is legal), so my turn does
  // nothing; the opponent should be predicted to reply with their attack.
  const state: GameState = {
    toMove: 0, turn: 6, isFirstPlayerFirstTurn: false,
    players: [
      { name: 'You', active: ip('Snorlax'), bench: [], hand: [], deckCount: 12, discardCount: 0, points: 0,
        energyZone: [], pendingEnergy: null, energyAttachedThisTurn: false },
      { name: 'Opp', active: ip('Marowak ex', ['Fighting', 'Fighting']), bench: [], hand: [], deckCount: 12,
        discardCount: 0, points: 0, energyZone: ['Fighting'], pendingEnergy: null, energyAttachedThisTurn: false },
    ],
  };
  const s = summarizeBestLine(state)!;
  assert.ok(s.oppReply, 'predicts a reply');
  assert.match(s.oppReply!.text, /Bonemerang/, 'names the opponent attack');
});

test('explanation: moves are annotated from the state delta (KO, sleep)', () => {
  const crimsonIdx = findCard('Charizard ex').attacks.findIndex((a) => a.name === 'Crimson Storm');
  const koState: GameState = {
    toMove: 0, turn: 5, isFirstPlayerFirstTurn: false,
    players: [
      { name: 'me', active: ip('Charizard ex', ['Fire', 'Fire', 'Fire', 'Fire']), bench: [], hand: [], deckCount: 10,
        discardCount: 0, points: 0, energyZone: ['Fire'], pendingEnergy: null, energyAttachedThisTurn: false },
      { name: 'opp', active: ip('Pikachu ex', ['Lightning']), bench: [], hand: [], deckCount: 10, discardCount: 0,
        points: 0, energyZone: ['Lightning'], pendingEnergy: null, energyAttachedThisTurn: false },
    ],
  };
  assert.match(describeMove(koState, { type: 'attack', attackIndex: crimsonIdx }), /KOs Pikachu ex \(\+2 pts\)/);

  const psIdx = findCard('Frosmoth').attacks.findIndex((a) => a.name === 'Powder Snow');
  const sleepState: GameState = {
    toMove: 0, turn: 5, isFirstPlayerFirstTurn: false,
    players: [
      { name: 'me', active: ip('Frosmoth', ['Water', 'Water']), bench: [], hand: [], deckCount: 10, discardCount: 0,
        points: 0, energyZone: ['Water'], pendingEnergy: null, energyAttachedThisTurn: false },
      { name: 'opp', active: ip('Snorlax'), bench: [], hand: [], deckCount: 10, discardCount: 0,
        points: 0, energyZone: [], pendingEnergy: null, energyAttachedThisTurn: false },
    ],
  };
  assert.match(describeMove(sleepState, { type: 'attack', attackIndex: psIdx }), /sleep/);
});

test('hand: a Potion in hand surfaces as a heal play for a damaged active', () => {
  const potion = findAnyCard('Potion')!;
  const active = ip('Charizard ex', ['Fire', 'Fire', 'Fire']);
  active.damage = 60;
  const state: GameState = {
    toMove: 0, turn: 5, isFirstPlayerFirstTurn: false,
    players: [
      { name: 'You', active, bench: [], hand: [potion], deckCount: 18, discardCount: 0, points: 0,
        energyZone: ['Fire'], pendingEnergy: null, energyAttachedThisTurn: false },
      { name: 'Opp', active: ip('Pikachu ex', ['Lightning']), bench: [], hand: [], deckCount: 18, discardCount: 0,
        points: 0, energyZone: ['Lightning'], pendingEnergy: null, energyAttachedThisTurn: false },
    ],
  };
  const recs = recommend(state);
  const potionPlay = recs.find((r) => r.move.type === 'playTrainer');
  assert.ok(potionPlay, 'Potion in hand yields a playTrainer recommendation');
  assert.match(describeMove(state, potionPlay!.move), /Potion/);
});

test('splash rider: a snipe finishes a damaged benched ex for +2', () => {
  const waIdx = findCard('Seadra').attacks.findIndex((a) => a.name === 'Water Arrow');
  assert.deepEqual(findCard('Seadra').attacks[waIdx]!.splash, { amount: 50, targets: 1, benchOnly: false });
  const benchedEx = ip('Articuno ex'); // 140 HP
  benchedEx.damage = 90;               // 90 + 50 snipe = 140 -> KO
  const state: GameState = {
    toMove: 0, turn: 6, isFirstPlayerFirstTurn: false,
    players: [
      { name: 'me', active: ip('Seadra', ['Water', 'Water', 'Water']), bench: [], hand: [], deckCount: 10,
        discardCount: 0, points: 0, energyZone: ['Water'], pendingEnergy: null, energyAttachedThisTurn: false },
      { name: 'opp', active: ip('Pikachu ex', ['Lightning']), bench: [benchedEx], hand: [], deckCount: 10,
        discardCount: 0, points: 0, energyZone: ['Lightning'], pendingEnergy: null, energyAttachedThisTurn: false },
    ],
  };
  // The snipe should prefer the KO of the benched ex over chipping the active.
  const after = applyMove(state, { type: 'attack', attackIndex: waIdx });
  assert.equal(after.players[0]!.points, 2, 'KOing a benched ex scores 2');
  assert.equal(after.players[1]!.bench.length, 0, 'the benched ex was removed');
  assert.equal(after.players[1]!.active!.card.name, 'Pikachu ex', 'the active is untouched');
  assert.match(describeMove(state, { type: 'attack', attackIndex: waIdx }), /KOs a benched Pokemon \(\+2 pts\)/);
});

test('coin-gated disruption: a 50% paralyze raises the attack value vs vanilla', () => {
  const real = findCard('Articuno'); // Ice Beam: 60, flip a coin -> 50% paralyze
  assert.deepEqual(real.attacks.find((a) => a.name === 'Ice Beam')!.coinInflict, ['paralyzed']);
  // Board where the opponent's reply would KO my 40-HP-left Articuno.
  const mkState = (myCard: typeof real): GameState => ({
    toMove: 0, turn: 8, isFirstPlayerFirstTurn: false,
    players: [
      { name: 'me', active: { card: myCard, energy: ['Water', 'Water', 'Water'], damage: 60, turnPlayedOrEvolved: 0 },
        bench: [], hand: [], deckCount: 12, discardCount: 0, points: 0, energyZone: ['Water'], pendingEnergy: null, energyAttachedThisTurn: false },
      { name: 'opp', active: ip('Pikachu ex', ['Lightning', 'Lightning']), bench: [ip('Pikachu', ['Lightning'])],
        hand: [], deckCount: 12, discardCount: 0, points: 0, energyZone: ['Lightning'], pendingEnergy: null, energyAttachedThisTurn: false },
    ],
  });
  const attackVal = (recs: ReturnType<typeof recommend>) => recs.find((r) => r.move.type === 'attack')!.value;
  const withPara = attackVal(recommend(mkState(real)));
  const vanilla = structuredClone(real);
  vanilla.attacks.find((a) => a.name === 'Ice Beam')!.coinInflict = undefined;
  const without = attackVal(recommend(mkState(vanilla)));
  assert.ok(withPara > without, `50% paralyze should raise the attack EV (${withPara} vs ${without})`);
});

test("opponent Energy Zone drives the predicted reply", () => {
  // Marowak ex has 1 Fighting but Bonemerang costs 2; whether it can attack on
  // its reply depends on what its Energy Zone generates.
  const mk = (zone: ConcreteEnergy[]): GameState => ({
    toMove: 0, turn: 6, isFirstPlayerFirstTurn: false,
    players: [
      { name: 'You', active: ip('Snorlax'), bench: [], hand: [], deckCount: 12, discardCount: 0, points: 0,
        energyZone: [], pendingEnergy: null, energyAttachedThisTurn: false },
      { name: 'Opp', active: ip('Marowak ex', ['Fighting']), bench: [], hand: [], deckCount: 12, discardCount: 0,
        points: 0, energyZone: zone, pendingEnergy: null, energyAttachedThisTurn: false },
    ],
  });
  const withFighting = summarizeBestLine(mk(['Fighting']))!;
  const withNone = summarizeBestLine(mk([]))!;
  assert.match(withFighting.oppReply!.text, /Bonemerang/, 'with a Fighting zone the reply attacks');
  assert.ok(!withNone.oppReply || !/Bonemerang/.test(withNone.oppReply.text), 'with no zone it cannot reach the cost');
});

test('ability: Greninja Water Shuriken snipes 20 and can finish a benched ex', () => {
  const benched = ip('Articuno ex'); benched.damage = 120; // 140 HP, 20 from a KO
  const state: GameState = {
    toMove: 0, turn: 6, isFirstPlayerFirstTurn: false,
    players: [
      { name: 'me', active: ip('Greninja', ['Water', 'Water']), bench: [], hand: [], deckCount: 10, discardCount: 0,
        points: 0, energyZone: ['Water'], pendingEnergy: null, energyAttachedThisTurn: false },
      { name: 'opp', active: ip('Pikachu ex', ['Lightning']), bench: [benched], hand: [], deckCount: 10, discardCount: 0,
        points: 0, energyZone: ['Lightning'], pendingEnergy: null, energyAttachedThisTurn: false },
    ],
  };
  const ab = legalMoves(state).find((m) => m.type === 'useAbility');
  assert.ok(ab, 'Water Shuriken is offered (Greninja has a registered ability)');
  const after = applyMove(state, ab!);
  assert.equal(after.players[0]!.points, 2, 'sniping the benched ex scores 2');
  assert.equal(after.players[1]!.bench.length, 0, "the benched ex was KO'd");
  assert.equal(after.toMove, 0, 'using an ability does not end the turn');
  assert.ok(!legalMoves(after).some((m) => m.type === 'useAbility'), 'and it cannot be used again this turn');
});

test('ability: Pidgeot Drive Off switches out the opponent active', () => {
  const state: GameState = {
    toMove: 0, turn: 6, isFirstPlayerFirstTurn: false,
    players: [
      { name: 'me', active: ip('Pidgeot'), bench: [], hand: [], deckCount: 0, discardCount: 0, points: 0,
        energyZone: [], pendingEnergy: null, energyAttachedThisTurn: false },
      { name: 'opp', active: ip('Pikachu ex', ['Lightning']), bench: [ip('Snorlax')], hand: [], deckCount: 0,
        discardCount: 0, points: 0, energyZone: ['Lightning'], pendingEnergy: null, energyAttachedThisTurn: false },
    ],
  };
  const ab = legalMoves(state).find((m) => m.type === 'useAbility');
  assert.ok(ab, 'Drive Off is offered');
  const after = applyMove(state, ab!);
  assert.equal(after.players[1]!.active!.card.name, 'Snorlax', 'the opponent active was switched to the bench');
  assert.ok(after.players[1]!.bench.some((b) => b.card.name === 'Pikachu ex'), 'the old active is now benched');
});

test('ability: Victreebel Fragrance Trap drags up a benched basic', () => {
  const state: GameState = {
    toMove: 0, turn: 6, isFirstPlayerFirstTurn: false,
    players: [
      { name: 'me', active: ip('Victreebel'), bench: [], hand: [], deckCount: 0, discardCount: 0, points: 0,
        energyZone: [], pendingEnergy: null, energyAttachedThisTurn: false },
      { name: 'opp', active: ip('Snorlax', ['Water']), bench: [ip('Pikachu ex')], hand: [], deckCount: 0,
        discardCount: 0, points: 0, energyZone: ['Lightning'], pendingEnergy: null, energyAttachedThisTurn: false },
    ],
  };
  const ab = legalMoves(state).find((m) => m.type === 'useAbility');
  assert.ok(ab, 'Fragrance Trap is offered (active Victreebel, opponent has a benched basic)');
  const after = applyMove(state, ab!);
  assert.equal(after.players[1]!.active!.card.name, 'Pikachu ex', 'the benched basic was dragged to active');
  assert.ok(after.players[1]!.bench.some((b) => b.card.name === 'Snorlax'), 'the old active was benched');
});

test('passive: Hard Coat reduces incoming damage by 20', () => {
  const snorlax = ip('Snorlax');
  const rollout = snorlax.card.attacks.find((a) => a.name === 'Rollout')!; // flat 70, Colorless (no weakness anywhere)
  const onMelmetal = expectedDamage(rollout, snorlax, ip('Melmetal')); // Hard Coat -20
  const onPlain = expectedDamage(rollout, snorlax, ip('Articuno ex'));
  assert.equal(onPlain, 70);
  assert.equal(onPlain - onMelmetal, 20, 'Hard Coat shaves 20 off the hit');
});

test('passive: Levitate gives the active free retreat while it holds energy', () => {
  const state: GameState = {
    toMove: 0, turn: 6, isFirstPlayerFirstTurn: false,
    players: [
      { name: 'me', active: ip('Giratina', ['Psychic']), bench: [ip('Snorlax')], hand: [], deckCount: 0, discardCount: 0,
        points: 0, energyZone: ['Psychic'], pendingEnergy: null, energyAttachedThisTurn: false },
      { name: 'opp', active: ip('Pikachu ex', ['Lightning']), bench: [], hand: [], deckCount: 0, discardCount: 0,
        points: 0, energyZone: ['Lightning'], pendingEnergy: null, energyAttachedThisTurn: false },
    ],
  };
  // Giratina's retreat cost is 3 but it holds only 1 energy: free retreat makes it legal.
  const retreat = legalMoves(state).find((m) => m.type === 'retreat');
  assert.ok(retreat, 'retreat is legal despite only 1 energy (Levitate)');
  const after = applyMove(state, retreat!);
  assert.equal(after.players[0]!.active!.card.name, 'Snorlax', 'switched in the benched Pokemon');
  assert.equal(after.players[0]!.bench.find((b) => b.card.name === 'Giratina')!.energy.length, 1, 'no energy was discarded');
});

test('evolution timing: cannot evolve a just-played Pokemon, nor evolve twice in a turn', () => {
  const mk = (playedTurn: number): GameState => {
    const active = ip('Charmander');
    active.turnPlayedOrEvolved = playedTurn;
    return {
      toMove: 0, turn: 5, isFirstPlayerFirstTurn: false,
      players: [
        { name: 'me', active, bench: [], hand: [findCard('Charmeleon'), findCard('Charizard')], deckCount: 10,
          discardCount: 0, points: 0, energyZone: ['Fire'], pendingEnergy: null, energyAttachedThisTurn: false },
        { name: 'opp', active: ip('Pikachu ex', ['Lightning']), bench: [], hand: [], deckCount: 10, discardCount: 0,
          points: 0, energyZone: ['Lightning'], pendingEnergy: null, energyAttachedThisTurn: false },
      ],
    };
  };
  // Played THIS turn (turnPlayedOrEvolved == turn) -> no evolve.
  assert.ok(!legalMoves(mk(5)).some((m) => m.type === 'evolve'), 'a Pokemon played this turn cannot evolve');
  // In play since a prior turn -> can evolve to Charmeleon.
  const ready = mk(4);
  const evo = legalMoves(ready).find((m) => m.type === 'evolve');
  assert.ok(evo, 'a Pokemon in play since last turn can evolve');
  const after = applyMove(ready, evo!);
  assert.equal(after.players[0]!.active!.card.name, 'Charmeleon', 'evolved to Charmeleon');
  // The fresh Charmeleon cannot evolve again to Charizard the same turn.
  assert.ok(!legalMoves(after).some((m) => m.type === 'evolve'), 'cannot evolve twice in one turn');
});

test('stadium: one per turn, no same-name replace, shared field', () => {
  const plains = findAnyCard('Starting Plains')!, plaza = findAnyCard('Peculiar Plaza')!;
  assert.equal(plains.kind, 'Stadium', 'Stadium cards load as kind Stadium');
  const mk = (stadium: string | null, hand: Card[]): GameState => ({
    toMove: 0, turn: 5, isFirstPlayerFirstTurn: false, stadium,
    players: [
      { name: 'me', active: ip('Charizard ex'), bench: [], hand, deckCount: 10, discardCount: 0, points: 0,
        energyZone: ['Fire'], pendingEnergy: null, energyAttachedThisTurn: false },
      { name: 'opp', active: ip('Pikachu ex'), bench: [], hand: [], deckCount: 10, discardCount: 0, points: 0,
        energyZone: ['Lightning'], pendingEnergy: null, energyAttachedThisTurn: false },
    ],
  });
  // None in play, one in hand -> playable; playing it sets the shared field.
  const s = mk(null, [plains]);
  const play = legalMoves(s).find((m) => m.type === 'playStadium');
  assert.ok(play, 'a Stadium in hand is playable when none is in play');
  const after = applyMove(s, play!);
  assert.equal(after.stadium, 'Starting Plains', 'playing it sets the shared Stadium');
  assert.equal(after.players[0]!.stadiumPlayedThisTurn, true, 'marks the once-per-turn flag');
  // Same name already in play -> cannot replace with the same card.
  assert.ok(!legalMoves(mk('Starting Plains', [plains])).some((m) => m.type === 'playStadium'), 'cannot replace a Stadium with the same one');
  // A different Stadium can replace it.
  assert.ok(legalMoves(mk('Starting Plains', [plaza])).some((m) => m.type === 'playStadium'), 'a different Stadium can replace it');
  // Already played one this turn -> no second Stadium.
  const s2 = mk(null, [plains, plaza]);
  s2.players[0]!.stadiumPlayedThisTurn = true;
  assert.ok(!legalMoves(s2).some((m) => m.type === 'playStadium'), 'at most one Stadium per turn');
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

test('trainer Cyrus: pulls a damaged benched foe into the Active spot', () => {
  const cyrus = findAnyCard('Cyrus')!;
  const benchedHurt = ip('Articuno ex'); benchedHurt.damage = 100;
  const state: GameState = {
    toMove: 0, turn: 5, isFirstPlayerFirstTurn: false,
    players: [
      { name: 'me', active: ip('Charizard ex', ['Fire']), bench: [], hand: [cyrus], deckCount: 0, discardCount: 0,
        points: 0, energyZone: ['Fire'], pendingEnergy: null, energyAttachedThisTurn: false },
      { name: 'opp', active: ip('Pikachu ex', ['Lightning']), bench: [benchedHurt], hand: [], deckCount: 0,
        discardCount: 0, points: 0, energyZone: ['Lightning'], pendingEnergy: null, energyAttachedThisTurn: false },
    ],
  };
  const play = legalMoves(state).find((m) => m.type === 'playTrainer');
  assert.ok(play, 'Cyrus is legal when the opponent has a damaged bench');
  const after = applyMove(state, play!);
  assert.equal(after.players[1]!.active!.card.name, 'Articuno ex', 'the damaged benched ex is pulled to active');
  assert.ok(after.players[1]!.bench.some((b) => b.card.name === 'Pikachu ex'), 'the old active went to the bench');
});

test('trainer Red: adds +20 only against an ex', () => {
  const attacker = ip('Charizard ex', ['Fire', 'Fire', 'Fire']);
  const slash = attacker.card.attacks.find((a) => a.name === 'Slash')!;
  const mk = (bonus?: number): PlayerState => ({
    name: 'p', active: attacker, bench: [], hand: [], deckCount: 0, discardCount: 0, points: 0,
    energyZone: ['Fire'], pendingEnergy: null, energyAttachedThisTurn: false, attackBonusVsEx: bonus,
  });
  const exDef = ip('Pikachu ex'), nonExDef = ip('Pikachu');
  assert.equal(expectedDamage(slash, attacker, exDef, mk(20), mk()) - expectedDamage(slash, attacker, exDef, mk(), mk()), 20, '+20 vs ex');
  assert.equal(expectedDamage(slash, attacker, nonExDef, mk(20), mk()) - expectedDamage(slash, attacker, nonExDef, mk(), mk()), 0, 'nothing vs a non-ex');
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
