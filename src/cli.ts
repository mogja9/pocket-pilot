import type { GameState, InPlay, PlayerState, ConcreteEnergy } from './types.js';
import { findCard, findAnyCard } from './data.js';
import { applyMove } from './rules.js';
import { recommend, describeMove, summarizeBestLine } from './recommend.js';

function inPlay(name: string, energy: ConcreteEnergy[] = [], damage = 0): InPlay {
  return { card: findCard(name), energy, damage, turnPlayedOrEvolved: 1 };
}

function player(name: string, p: Partial<PlayerState>): PlayerState {
  return {
    name, active: null, bench: [], hand: [], deckCount: 20, discardCount: 0,
    points: 0, energyZone: ['Fire'], pendingEnergy: null, energyAttachedThisTurn: false, ...p,
  };
}

// Sample live situation: my Charizard ex has 3 Fire and just generated a 4th in
// the Energy Zone -- one short of Crimson Storm (200) before the attach.  The
// opponent's active is a healthy Pikachu ex (an ex -> worth 2 points).
const state: GameState = {
  toMove: 0,
  turn: 5,
  isFirstPlayerFirstTurn: false,
  players: [
    player('You', {
      active: inPlay('Charizard ex', ['Fire', 'Fire', 'Fire']),
      bench: [inPlay('Marowak ex', ['Fighting']), inPlay('Articuno ex')],
      hand: [findCard('Charmander'), findAnyCard('Giovanni')!],
      energyZone: ['Fire'],
      pendingEnergy: 'Fire',
    }),
    player('Opponent', {
      active: inPlay('Pikachu ex', ['Lightning', 'Lightning']),
      bench: [inPlay('Articuno ex')],
      energyZone: ['Lightning'],
    }),
  ],
};

function fmtPokemon(ip: InPlay | null): string {
  if (!ip) return '(none)';
  return `${ip.card.name} [${ip.card.hp - ip.damage}/${ip.card.hp} HP, ${ip.energy.join('+') || 'no'} energy]`;
}

const me = state.players[state.toMove];
const opp = state.players[(state.toMove ^ 1) as 0 | 1];
console.log('=== Pocket Pilot: live situation ===');
console.log(`Your active:     ${fmtPokemon(me.active)}`);
console.log(`Your bench:      ${me.bench.map((b) => b.card.name).join(', ') || '(empty)'}`);
console.log(`Energy this turn: ${me.pendingEnergy ?? '(none)'} (zone: ${me.energyZone.join('/')})`);
console.log(`Opponent active: ${fmtPokemon(opp.active)}`);
console.log(`Points:          you ${me.points} - ${opp.points} opp\n`);

const recs = recommend(state);
const summary = summarizeBestLine(state, recs);
if (summary) {
  const tag = summary.won ? 'WIN' : summary.kos ? `+${summary.pointSwing}` : summary.survivesReply ? 'SAFE' : 'RISK';
  console.log(`Verdict [${tag}]: ${summary.text}`);
  if (summary.oppReply && !summary.won) console.log(`Opponent likely: ${summary.oppReply.text}`);
  console.log('');
}

console.log('Recommended plays (ranked by win-equity):');
recs.slice(0, 5).forEach((r, i) => {
  console.log(`  ${i + 1}. ${describeMove(state, r.move).padEnd(48)} equity ${r.value.toFixed(0)}`);
});

const best = recs[0];
if (best) {
  console.log('\nBest line this turn:');
  // Re-describe each step against the evolving state for accurate labels.
  let s = state;
  for (const m of best.plan) {
    console.log(`  -> ${describeMove(s, m)}`);
    s = applyMove(s, m);
  }
}
