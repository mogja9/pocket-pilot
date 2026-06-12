import rawCards from '../data/ptcgp-cards.json';
import { buildIndex, type RawCard } from '../src/card-index.js';
import { recommend, describeMove } from '../src/recommend.js';
import { applyMove } from '../src/rules.js';
import type { GameState, InPlay, PlayerState, ConcreteEnergy, EnergyType } from '../src/types.js';
import { el, clear } from './dom.js';

const { findCard, hasCard, ALL_POKEMON } = buildIndex(rawCards as RawCard[]);

const ENERGIES: ConcreteEnergy[] = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal'];
const ABBR: Record<ConcreteEnergy, string> = {
  Grass: 'G', Fire: 'R', Water: 'W', Lightning: 'L', Psychic: 'P', Fighting: 'F', Darkness: 'D', Metal: 'M',
};
const CONCRETE = new Set<string>(ENERGIES);
const concreteOf = (t: EnergyType | undefined): ConcreteEnergy[] => (t && CONCRETE.has(t) ? [t as ConcreteEnergy] : []);

// A datalist of every unique Pokemon name for native autocomplete on inputs.
const names = [...new Set(ALL_POKEMON.map((p) => p.name))].sort();
const datalist = el('datalist', { id: 'cards' }, ...names.map((n) => el('option', { value: n })));

interface Slot { root: HTMLElement; read: () => InPlay | null; set: (name: string, energy: ConcreteEnergy[]) => void; }

function createSlot(label: string): Slot {
  let energy: ConcreteEnergy[] = [];
  const nameInput = el('input', { class: 'name', list: 'cards', placeholder: label, autocomplete: 'off' }) as HTMLInputElement;
  const energyView = el('span', { class: 'energy' });
  const render = () => { clear(energyView); energyView.append(energy.length ? energy.map((e) => ABBR[e]).join(' ') : '-'); };
  const btns = ENERGIES.map((e) =>
    el('button', { class: 'eb', type: 'button', title: e, onClick: () => { energy.push(e); render(); } }, ABBR[e]),
  );
  const clr = el('button', { class: 'eb clr', type: 'button', title: 'clear energy', onClick: () => { energy = []; render(); } }, 'x');
  render();
  const root = el('div', { class: 'slot' },
    el('label', {}, label),
    nameInput,
    el('div', { class: 'erow' }, energyView, ...btns, clr),
  );
  return {
    root,
    read: () => {
      const n = nameInput.value.trim();
      if (!n || !hasCard(n)) return null;
      return { card: findCard(n), energy: [...energy], damage: 0, turnPlayedOrEvolved: 0 };
    },
    set: (name, e) => { nameInput.value = name; energy = [...e]; render(); },
  };
}

const mySlots = [createSlot('Your active'), createSlot('Bench 1'), createSlot('Bench 2'), createSlot('Bench 3')];
const oppSlots = [createSlot('Opp active'), createSlot('Opp bench 1'), createSlot('Opp bench 2'), createSlot('Opp bench 3')];

const pendingSel = el('select', {}, el('option', { value: '' }, '(none)'), ...ENERGIES.map((e) => el('option', { value: e }, e))) as HTMLSelectElement;
const myPts = el('input', { type: 'number', min: '0', max: '3', value: '0', class: 'pts' }) as HTMLInputElement;
const oppPts = el('input', { type: 'number', min: '0', max: '3', value: '0', class: 'pts' }) as HTMLInputElement;

function player(name: string, slots: Slot[], points: number, pending: ConcreteEnergy | null): PlayerState {
  const active = slots[0]!.read();
  const bench = slots.slice(1).map((s) => s.read()).filter((x): x is InPlay => x !== null);
  const zone = pending ? [pending] : concreteOf(active?.card.type);
  return {
    name, active, bench, hand: [], deckCount: 20, discardCount: 0, points,
    energyZone: zone, pendingEnergy: pending, energyAttachedThisTurn: false,
  };
}

function readState(): GameState | string {
  if (!mySlots[0]!.read()) return 'Enter your active Pokemon (top-left).';
  if (!oppSlots[0]!.read()) return "Enter the opponent's active Pokemon.";
  const pending = (pendingSel.value || null) as ConcreteEnergy | null;
  const clamp = (v: string) => Math.max(0, Math.min(3, Number(v) || 0));
  return {
    toMove: 0, turn: 5, isFirstPlayerFirstTurn: false,
    players: [
      player('You', mySlots, clamp(myPts.value), pending),
      player('Opponent', oppSlots, clamp(oppPts.value), null),
    ],
  };
}

const results = el('div', { class: 'card', id: 'results' }, el('span', { class: 'muted' }, 'Enter a board and hit Recommend.'));

function pokeLine(ip: InPlay | null): string {
  return ip ? `${ip.card.name} [${ip.card.hp - ip.damage}/${ip.card.hp} HP${ip.energy.length ? ', ' + ip.energy.join('+') : ''}]` : '(none)';
}

function runRecommend() {
  const s = readState();
  clear(results);
  if (typeof s === 'string') { results.append(el('span', { class: 'muted' }, s)); return; }
  const recs = recommend(s);
  const best = recs[0];
  const list = el('ol', {});
  for (const r of recs.slice(0, 6)) {
    list.append(el('li', {}, describeMove(s, r.move), ' ', el('span', { class: 'eq' }, `(equity ${r.value.toFixed(0)})`)));
  }
  const lineDiv = el('div', {});
  if (best) {
    let st = s;
    best.plan.forEach((m, i) => { lineDiv.append(el('div', { class: 'step' }, `${i + 1}. ${describeMove(st, m)}`)); st = applyMove(st, m); });
  }
  results.append(
    el('div', { class: 'muted' }, `${recs.length} legal plays, evaluated 2-ply (after the opponent's best reply)`),
    el('b', {}, 'Recommended plays'), list,
    el('b', {}, 'Best line this turn'), lineDiv,
  );
}

function loadExample() {
  mySlots[0]!.set('Charizard ex', ['Fire', 'Fire', 'Fire']);
  mySlots[1]!.set('Marowak ex', ['Fighting']);
  mySlots[2]!.set('Articuno ex', []);
  oppSlots[0]!.set('Pikachu ex', ['Lightning', 'Lightning']);
  pendingSel.value = 'Fire';
}

const app = document.getElementById('app')!;
app.className = '';
app.append(
  datalist,
  el('div', { class: 'card' },
    el('div', { class: 'grid' }, ...mySlots.map((s) => s.root)),
  ),
  el('div', { class: 'card' },
    el('div', { class: 'grid' }, ...oppSlots.map((s) => s.root)),
  ),
  el('div', { class: 'card controls' },
    el('label', {}, 'Energy this turn ', pendingSel),
    el('label', {}, ' Your points ', myPts),
    el('label', {}, ' Opp points ', oppPts),
    el('button', { class: 'primary', type: 'button', onClick: runRecommend }, 'Recommend'),
    el('button', { type: 'button', onClick: loadExample }, 'Load example'),
  ),
  results,
);
