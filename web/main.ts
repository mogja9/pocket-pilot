import rawCards from '../data/ptcgp-cards.json';
import { buildIndex, type RawCard } from '../src/card-index.js';
import { recommend, describeMove } from '../src/recommend.js';
import { applyMove } from '../src/rules.js';
import type { GameState, InPlay, PlayerState, ConcreteEnergy, EnergyType, Condition, Card } from '../src/types.js';
import { el, clear } from './dom.js';

const { findCard, hasCard, findAnyCard, ALL_CARDS } = buildIndex(rawCards as RawCard[]);

const ENERGIES: ConcreteEnergy[] = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal'];
const ABBR: Record<ConcreteEnergy, string> = {
  Grass: 'G', Fire: 'R', Water: 'W', Lightning: 'L', Psychic: 'P', Fighting: 'F', Darkness: 'D', Metal: 'M',
};
const CONCRETE = new Set<string>(ENERGIES);
const concreteOf = (t: EnergyType | undefined): ConcreteEnergy[] => (t && CONCRETE.has(t) ? [t as ConcreteEnergy] : []);

// A datalist of every unique card name (Pokemon + trainers) for autocomplete.
const names = [...new Set(ALL_CARDS.map((c) => c.name))].sort();
const datalist = el('datalist', { id: 'cards' }, ...names.map((n) => el('option', { value: n })));

const CONDITIONS: Condition[] = ['asleep', 'paralyzed', 'poisoned', 'burned', 'confused'];
const CABBR: Record<Condition, string> = { asleep: 'Slp', paralyzed: 'Par', poisoned: 'Psn', burned: 'Brn', confused: 'Cnf' };

interface SlotData { name: string; energy: ConcreteEnergy[]; damage: number; conditions: Condition[]; }
interface Slot { root: HTMLElement; read: () => InPlay | null; getData: () => SlotData; setData: (d: SlotData) => void; }

function createSlot(label: string): Slot {
  let energy: ConcreteEnergy[] = [];
  const conds = new Set<Condition>();
  const nameInput = el('input', { class: 'name', list: 'cards', placeholder: label, autocomplete: 'off' }) as HTMLInputElement;
  const dmgInput = el('input', { class: 'pts', type: 'number', min: '0', value: '0', title: 'damage taken' }) as HTMLInputElement;
  const energyView = el('span', { class: 'energy' });
  const render = () => { clear(energyView); energyView.append(energy.length ? energy.map((e) => ABBR[e]).join(' ') : '-'); };
  const eBtns = ENERGIES.map((e) =>
    el('button', { class: 'eb', type: 'button', title: e, onClick: () => { energy.push(e); render(); } }, ABBR[e]),
  );
  const clr = el('button', { class: 'eb clr', type: 'button', title: 'clear energy', onClick: () => { energy = []; render(); } }, 'x');
  const cBtns = CONDITIONS.map((c) =>
    el('button', { class: 'cb', type: 'button', title: c, onClick: () => { if (conds.has(c)) conds.delete(c); else conds.add(c); syncConds(); } }, CABBR[c]));
  const syncConds = () => CONDITIONS.forEach((c, i) => cBtns[i]!.classList.toggle('on', conds.has(c)));
  render();
  const root = el('div', { class: 'slot' },
    el('label', {}, label),
    nameInput,
    el('div', { class: 'erow' }, energyView, ...eBtns, clr),
    el('div', { class: 'erow' }, el('span', { class: 'muted', title: 'damage' }, 'dmg'), dmgInput, ...cBtns),
  );
  return {
    root,
    read: () => {
      const n = nameInput.value.trim();
      if (!n || !hasCard(n)) return null;
      const ip: InPlay = { card: findCard(n), energy: [...energy], damage: Math.max(0, Number(dmgInput.value) || 0), turnPlayedOrEvolved: 0 };
      if (conds.size) ip.conditions = [...conds];
      return ip;
    },
    getData: () => ({ name: nameInput.value.trim(), energy: [...energy], damage: Math.max(0, Number(dmgInput.value) || 0), conditions: [...conds] }),
    setData: (d) => {
      nameInput.value = d.name;
      energy = [...d.energy];
      dmgInput.value = String(d.damage);
      conds.clear();
      d.conditions.forEach((c) => conds.add(c));
      render();
      syncConds();
    },
  };
}

const mySlots = [createSlot('Your active'), createSlot('Bench 1'), createSlot('Bench 2'), createSlot('Bench 3')];
const oppSlots = [createSlot('Opp active'), createSlot('Opp bench 1'), createSlot('Opp bench 2'), createSlot('Opp bench 3')];

const pendingSel = el('select', {}, el('option', { value: '' }, '(none)'), ...ENERGIES.map((e) => el('option', { value: e }, e))) as HTMLSelectElement;
const myPts = el('input', { type: 'number', min: '0', max: '3', value: '0', class: 'pts' }) as HTMLInputElement;
const oppPts = el('input', { type: 'number', min: '0', max: '3', value: '0', class: 'pts' }) as HTMLInputElement;

// Your hand (playable cards this turn: trainers, basics to bench, evolutions).
const handInputs = Array.from({ length: 4 }, () =>
  el('input', { class: 'hand-input', list: 'cards', placeholder: 'hand card', autocomplete: 'off' }) as HTMLInputElement);
function readHand(): Card[] {
  const out: Card[] = [];
  for (const inp of handInputs) {
    const n = inp.value.trim();
    if (!n) continue;
    const c = findAnyCard(n);
    if (c) out.push(c);
  }
  return out;
}

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
  const me = player('You', mySlots, clamp(myPts.value), pending);
  me.hand = readHand();
  return {
    toMove: 0, turn: 5, isFirstPlayerFirstTurn: false,
    players: [me, player('Opponent', oppSlots, clamp(oppPts.value), null)],
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
  saveState();
}

const STORAGE_KEY = 'pocket-pilot:board';

function saveState(): void {
  const data = {
    my: mySlots.map((s) => s.getData()),
    opp: oppSlots.map((s) => s.getData()),
    hand: handInputs.map((i) => i.value.trim()),
    pending: pendingSel.value, myPts: myPts.value, oppPts: oppPts.value,
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* storage unavailable */ }
}

function loadStored(): void {
  let d: { my?: SlotData[]; opp?: SlotData[]; hand?: string[]; pending?: string; myPts?: string; oppPts?: string };
  try { const raw = localStorage.getItem(STORAGE_KEY); if (!raw) return; d = JSON.parse(raw); } catch { return; }
  (d.my ?? []).forEach((sd, i) => mySlots[i]?.setData(sd));
  (d.opp ?? []).forEach((sd, i) => oppSlots[i]?.setData(sd));
  (d.hand ?? []).forEach((v, i) => { const h = handInputs[i]; if (h) h.value = v; });
  if (d.pending != null) pendingSel.value = d.pending;
  if (d.myPts != null) myPts.value = d.myPts;
  if (d.oppPts != null) oppPts.value = d.oppPts;
}

function clearAll(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  const empty: SlotData = { name: '', energy: [], damage: 0, conditions: [] };
  [...mySlots, ...oppSlots].forEach((s) => s.setData(empty));
  handInputs.forEach((i) => { i.value = ''; });
  pendingSel.value = ''; myPts.value = '0'; oppPts.value = '0';
  clear(results);
  results.append(el('span', { class: 'muted' }, 'Cleared.'));
}

function loadExample() {
  mySlots[0]!.setData({ name: 'Charizard ex', energy: ['Fire', 'Fire', 'Fire'], damage: 0, conditions: [] });
  mySlots[1]!.setData({ name: 'Marowak ex', energy: ['Fighting'], damage: 0, conditions: [] });
  mySlots[2]!.setData({ name: 'Articuno ex', energy: [], damage: 0, conditions: [] });
  oppSlots[0]!.setData({ name: 'Pikachu ex', energy: ['Lightning', 'Lightning'], damage: 0, conditions: [] });
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
  el('div', { class: 'card' },
    el('label', { class: 'muted' }, 'Your hand (playable this turn: trainers, basics, evolutions)'),
    el('div', { class: 'erow' }, ...handInputs),
  ),
  el('div', { class: 'card controls' },
    el('label', {}, 'Energy this turn ', pendingSel),
    el('label', {}, ' Your points ', myPts),
    el('label', {}, ' Opp points ', oppPts),
    el('button', { class: 'primary', type: 'button', onClick: runRecommend }, 'Recommend'),
    el('button', { type: 'button', onClick: loadExample }, 'Load example'),
    el('button', { type: 'button', onClick: clearAll }, 'Clear'),
  ),
  results,
);

loadStored();                          // restore the last entered board
app.addEventListener('input', saveState); // autosave on text/number/select edits
