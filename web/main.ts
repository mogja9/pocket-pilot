import rawCards from '../data/ptcgp-cards.json';
import { buildIndex, type RawCard } from '../src/card-index.js';
import { recommend, describeMove } from '../src/recommend.js';
import { applyMove } from '../src/rules.js';
import type { GameState, InPlay, PlayerState, ConcreteEnergy } from '../src/types.js';

const { findCard } = buildIndex(rawCards as RawCard[]);

function inPlay(name: string, energy: ConcreteEnergy[] = [], damage = 0): InPlay {
  return { card: findCard(name), energy, damage, turnPlayedOrEvolved: 1 };
}
function player(name: string, p: Partial<PlayerState>): PlayerState {
  return {
    name, active: null, bench: [], hand: [], deckCount: 20, discardCount: 0,
    points: 0, energyZone: ['Fire'], pendingEnergy: null, energyAttachedThisTurn: false, ...p,
  };
}

// Same hardcoded sample situation as the CLI; interactive board-entry is next.
// This proves the engine runs entirely in the browser.
const state: GameState = {
  toMove: 0, turn: 5, isFirstPlayerFirstTurn: false,
  players: [
    player('You', {
      active: inPlay('Charizard ex', ['Fire', 'Fire', 'Fire']),
      bench: [inPlay('Marowak ex', ['Fighting']), inPlay('Articuno ex')],
      hand: [findCard('Charmander')],
      energyZone: ['Fire'], pendingEnergy: 'Fire',
    }),
    player('Opponent', {
      active: inPlay('Pikachu ex', ['Lightning', 'Lightning']),
      bench: [inPlay('Articuno ex')], energyZone: ['Lightning'],
    }),
  ],
};

const me = state.players[state.toMove];
const opp = state.players[(state.toMove ^ 1) as 0 | 1];
const recs = recommend(state);
const best = recs[0];

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function pokeLine(ip: InPlay | null): string {
  if (!ip) return '(none)';
  return esc(`${ip.card.name} [${ip.card.hp - ip.damage}/${ip.card.hp} HP, ${ip.energy.join('+') || 'no'} energy]`);
}

// Label each plan step against the evolving state for accurate descriptions.
function planSteps(): string[] {
  if (!best) return [];
  const out: string[] = [];
  let s = state;
  for (const m of best.plan) {
    out.push(esc(describeMove(s, m)));
    s = applyMove(s, m);
  }
  return out;
}

const app = document.getElementById('app')!;
app.className = '';
app.innerHTML = `
  <div class="card">
    <div>Your active: <b>${pokeLine(me.active)}</b></div>
    <div>Your bench: ${esc(me.bench.map((b) => b.card.name).join(', ') || '(empty)')}</div>
    <div>Energy this turn: ${esc(me.pendingEnergy ?? '(none)')} | Opponent active: <b>${pokeLine(opp.active)}</b></div>
    <div class="muted">Points: you ${me.points} - ${opp.points} opp &middot; ${recs.length} legal plays evaluated 2-ply</div>
  </div>
  <div class="card">
    <b>Recommended plays</b>
    <ol>${recs.slice(0, 6).map((r) => `<li>${esc(describeMove(state, r.move))} <span class="eq">(equity ${r.value.toFixed(0)})</span></li>`).join('')}</ol>
  </div>
  ${best ? `<div class="card"><b>Best line this turn</b><div>${planSteps().map((t, i) => `<span class="step">${i + 1}. ${t}</span>`).join('<br>')}</div></div>` : ''}
`;
