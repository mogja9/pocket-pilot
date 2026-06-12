// Decision-quality scenarios: labeled tactical positions where the right play is
// clear, asserting the engine's TOP recommendation (or best-line summary) matches.
// This is the regression harness that makes evaluator tuning safe -- if a weight
// change breaks a tactic, a scenario here fails.  Distinct from engine.test.ts,
// which checks mechanics; these check judgement.
import assert from 'node:assert/strict';
import { findCard, findAnyCard } from './data.js';
import { recommend, summarizeBestLine, describeMove, type Recommendation, type BestLineSummary } from './recommend.js';
import type { GameState, InPlay, PlayerState, ConcreteEnergy } from './types.js';

const ip = (name: string, energy: ConcreteEnergy[] = [], damage = 0): InPlay =>
  ({ card: findCard(name), energy, damage, turnPlayedOrEvolved: 0 });
const side = (active: InPlay | null, o: Partial<PlayerState> = {}): PlayerState =>
  ({ name: 'p', active, bench: [], hand: [], deckCount: 15, discardCount: 0, points: 0, energyZone: [], pendingEnergy: null, energyAttachedThisTurn: false, ...o });
const game = (p0: PlayerState, p1: PlayerState): GameState =>
  ({ toMove: 0, turn: 6, isFirstPlayerFirstTurn: false, players: [p0, p1] });
const damaged = (i: InPlay, d: number): InPlay => { i.damage = d; return i; };

interface Scenario {
  name: string;
  state: GameState;
  check: (recs: Recommendation[], summary: BestLineSummary) => void;
}

const SCENARIOS: Scenario[] = [
  {
    name: 'takes the KO of an opposing ex (+2)',
    state: game(
      side(ip('Charizard ex', ['Fire', 'Fire', 'Fire']), { energyZone: ['Fire'], pendingEnergy: 'Fire' }),
      side(ip('Pikachu ex', ['Lightning']))),
    check: (_r, s) => { assert.equal(s.kos, true); assert.equal(s.pointSwing, 2); },
  },
  {
    name: 'setup line: attach the missing energy, then Crimson Storm',
    state: game(
      side(ip('Charizard ex', ['Fire', 'Fire', 'Fire']), { energyZone: ['Fire'], pendingEnergy: 'Fire' }),
      side(ip('Pikachu ex', ['Lightning']))),
    check: (recs, _s) => {
      const plan = recs[0]!.plan;
      assert.ok(plan.some((m) => m.type === 'attachEnergy'), 'plan attaches energy');
      assert.ok(plan.some((m) => m.type === 'attack'), 'plan ends in an attack');
    },
  },
  {
    name: 'wins the game by taking the third point',
    state: game(
      side(ip('Charizard ex', ['Fire', 'Fire', 'Fire']), { points: 1, energyZone: ['Fire'], pendingEnergy: 'Fire' }),
      side(ip('Pikachu ex', ['Lightning']))),
    check: (_r, s) => assert.equal(s.won, true),
  },
  {
    name: 'retreats a threatened ex instead of hanging it to a lethal reply',
    state: game(
      side(ip('Pikachu ex', ['Lightning', 'Lightning']), { bench: [ip('Snorlax')], energyZone: ['Lightning'], pendingEnergy: 'Lightning' }),
      side(ip('Abomasnow', ['Water', 'Water', 'Water', 'Water']), { energyZone: ['Water'] })),
    check: (recs, _s) => assert.ok(recs[0]!.plan.some((m) => m.type === 'retreat'), 'best line retreats'),
  },
  {
    name: 'snipes a damaged benched ex for +2 over chipping the active',
    state: game(
      side(ip('Seadra', ['Water', 'Water', 'Water'])),
      side(ip('Pikachu ex', ['Lightning']), { bench: [damaged(ip('Articuno ex'), 90)] })),
    check: (_r, s) => assert.equal(s.pointSwing, 2),
  },
  {
    name: 'plays Potion to heal a damaged active when nothing better is on',
    state: game(
      side(damaged(ip('Charizard ex', ['Fire', 'Fire', 'Fire']), 60), { hand: [findAnyCard('Potion')!], energyZone: ['Fire'] }),
      side(ip('Pikachu ex', ['Lightning']))),
    check: (recs, _s) => assert.equal(recs[0]!.move.type, 'playTrainer', `top should be Potion, got "${describeMove(SCENARIOS[5]!.state, recs[0]!.move)}"`),
  },
  {
    name: 'strips the defender energy so it cannot reply (survives)',
    state: game(
      side(ip('Gyarados', ['Water', 'Water', 'Water', 'Water'])),
      side(ip('Snorlax', ['Water', 'Water', 'Water', 'Water']), { energyZone: ['Water'] })),
    check: (recs, s) => {
      assert.equal(recs[0]!.move.type, 'attack', 'top play is the attack');
      assert.equal(s.survivesReply, true, 'after the strip the opponent cannot KO back');
    },
  },
];

let passed = 0;
const failures: string[] = [];
console.log('scenario tests:');
for (const sc of SCENARIOS) {
  try {
    const recs = recommend(sc.state);
    const summary = summarizeBestLine(sc.state, recs);
    assert.ok(summary, 'a summary is produced');
    sc.check(recs, summary!);
    passed++;
    console.log(`  ok  ${sc.name}`);
  } catch (e) {
    failures.push(`${sc.name}: ${(e as Error).message}`);
    console.log(`  FAIL ${sc.name}: ${(e as Error).message}`);
  }
}
console.log(`\n${passed}/${SCENARIOS.length} scenarios passed`);
if (failures.length) process.exit(1);
