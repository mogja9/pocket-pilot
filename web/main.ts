import rawCards from '../data/ptcgp-cards.json';
import { buildIndex, type RawCard } from '../src/card-index.js';
import { recommend, describeMove } from '../src/recommend.js';
import { applyMove } from '../src/rules.js';
import type { GameState, InPlay, PlayerState, ConcreteEnergy, EnergyType, Condition } from '../src/types.js';
import { el, clear } from './dom.js';
import { cardImageUrl } from './images.js';

const { findCard, hasCard, findAnyCard, ALL_POKEMON } = buildIndex(rawCards as RawCard[]);

const ENERGIES: ConcreteEnergy[] = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal'];
const ABBR: Record<ConcreteEnergy, string> = { Grass: 'G', Fire: 'R', Water: 'W', Lightning: 'L', Psychic: 'P', Fighting: 'F', Darkness: 'D', Metal: 'M' };
const CONDITIONS: Condition[] = ['asleep', 'paralyzed', 'poisoned', 'burned', 'confused'];
const CABBR: Record<Condition, string> = { asleep: 'Slp', paralyzed: 'Par', poisoned: 'Psn', burned: 'Brn', confused: 'Cnf' };
const CONCRETE = new Set<string>(ENERGIES);
const concreteOf = (t: EnergyType | undefined): ConcreteEnergy[] => (t && CONCRETE.has(t) ? [t as ConcreteEnergy] : []);

interface Slot { name: string; energy: ConcreteEnergy[]; damage: number; conditions: Condition[]; }
type Side = 'mine' | 'opp';

const STORAGE_KEY = 'pocket-pilot:board2';
const board: { mine: (Slot | null)[]; opp: (Slot | null)[]; hand: string[]; pending: string; myPts: number; oppPts: number } = {
  mine: [null, null, null, null], opp: [null, null, null, null], hand: [], pending: '', myPts: 0, oppPts: 0,
};
let selected: { side: Side; idx: number } | null = null;
let placePending: string | null = null;

// ---- helpers ----------------------------------------------------------------
const imgFor = (name: string): string | null => (hasCard(name) ? cardImageUrl(findCard(name).id) : null);

function toInPlay(s: Slot | null): InPlay | null {
  if (!s || !hasCard(s.name)) return null;
  const ip: InPlay = { card: findCard(s.name), energy: [...s.energy], damage: Math.max(0, s.damage), turnPlayedOrEvolved: 0 };
  if (s.conditions.length) ip.conditions = [...s.conditions];
  return ip;
}
function player(name: string, slots: (Slot | null)[], points: number, pending: ConcreteEnergy | null, hand: string[]): PlayerState {
  const active = toInPlay(slots[0]!);
  const bench = slots.slice(1).map(toInPlay).filter((x): x is InPlay => x !== null);
  return {
    name, active, bench,
    hand: hand.map((n) => findAnyCard(n)).filter((c): c is NonNullable<typeof c> => c != null),
    deckCount: 20, discardCount: 0, points,
    energyZone: pending ? [pending] : concreteOf(active?.card.type),
    pendingEnergy: pending, energyAttachedThisTurn: false,
  };
}
function buildState(): GameState {
  const pending = (board.pending || null) as ConcreteEnergy | null;
  return {
    toMove: 0, turn: 5, isFirstPlayerFirstTurn: false,
    players: [
      player('You', board.mine, board.myPts, pending, board.hand),
      player('Opponent', board.opp, board.oppPts, null, []),
    ],
  };
}

// ---- persistence ------------------------------------------------------------
function save(): void { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(board)); } catch { /* ignore */ } }
function load(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    Object.assign(board, JSON.parse(raw));
    board.mine = (board.mine ?? []).slice(0, 4); while (board.mine.length < 4) board.mine.push(null);
    board.opp = (board.opp ?? []).slice(0, 4); while (board.opp.length < 4) board.opp.push(null);
  } catch { /* ignore */ }
}

// ---- mutations --------------------------------------------------------------
function place(side: Side, idx: number, name: string): void {
  if (!hasCard(name)) return;
  board[side][idx] = { name, energy: [], damage: 0, conditions: [] };
  selected = { side, idx };
  changed();
}
function removeSlot(side: Side, idx: number): void { board[side][idx] = null; if (selected?.side === side && selected.idx === idx) selected = null; changed(); }
function changed(): void { save(); renderBoard(); renderEditor(); renderRecs(); }

// ---- board rendering --------------------------------------------------------
const boardEl = el('div', { class: 'board' });

function slotEl(side: Side, idx: number, label: string): HTMLElement {
  const s = board[side][idx];
  const node = el('div', { class: `slot${s ? ' filled' : ''}${selected?.side === side && selected.idx === idx ? ' sel' : ''}`, 'data-label': label });
  node.addEventListener('dragover', (e) => { e.preventDefault(); node.classList.add('drop'); });
  node.addEventListener('dragleave', () => node.classList.remove('drop'));
  node.addEventListener('drop', (e) => {
    e.preventDefault(); node.classList.remove('drop');
    const name = (e as DragEvent).dataTransfer?.getData('text/plain');
    if (name) place(side, idx, name);
  });
  node.addEventListener('click', () => {
    if (placePending) { place(side, idx, placePending); placePending = null; renderSearchSelection(); return; }
    if (s) { selected = { side, idx }; renderBoard(); renderEditor(); }
  });
  if (s) {
    const url = imgFor(s.name);
    node.append(url ? el('img', { class: 'cardimg', src: url, alt: s.name, loading: 'lazy' }) : el('div', { class: 'noimg' }, s.name));
    const badges = el('div', { class: 'badges' });
    if (s.energy.length) badges.append(el('span', { class: 'b en' }, s.energy.map((e) => ABBR[e]).join('')));
    if (s.damage) badges.append(el('span', { class: 'b dmg' }, `-${s.damage}`));
    if (s.conditions.length) badges.append(el('span', { class: 'b cond' }, s.conditions.map((c) => CABBR[c]).join(' ')));
    node.append(badges);
  } else {
    node.append(el('span', { class: 'ph' }, label));
  }
  return node;
}

function renderBoard(): void {
  clear(boardEl);
  boardEl.append(
    el('div', { class: 'side opp' },
      el('div', { class: 'benchrow' }, slotEl('opp', 1, 'bench'), slotEl('opp', 2, 'bench'), slotEl('opp', 3, 'bench')),
      el('div', { class: 'activerow' }, el('span', { class: 'tag' }, `Opp - ${board.oppPts} pts`), slotEl('opp', 0, 'opp active')),
    ),
    el('div', { class: 'side you' },
      el('div', { class: 'activerow' }, el('span', { class: 'tag' }, `You - ${board.myPts} pts`), slotEl('mine', 0, 'your active')),
      el('div', { class: 'benchrow' }, slotEl('mine', 1, 'bench'), slotEl('mine', 2, 'bench'), slotEl('mine', 3, 'bench')),
    ),
  );
}

// ---- per-card editor --------------------------------------------------------
const editorEl = el('div', { class: 'card editor' });

function renderEditor(): void {
  clear(editorEl);
  if (!selected) { editorEl.append(el('span', { class: 'muted' }, 'Click a placed card to edit its energy / damage / conditions.')); return; }
  const s = board[selected.side][selected.idx];
  if (!s) { editorEl.append(el('span', { class: 'muted' }, 'Empty slot.')); return; }
  const energyView = el('span', { class: 'energy' }, s.energy.length ? s.energy.map((e) => ABBR[e]).join(' ') : '-');
  const eBtns = ENERGIES.map((e) => el('button', { class: 'eb', type: 'button', title: e, onClick: () => { s.energy.push(e); changed(); } }, ABBR[e]));
  const clr = el('button', { class: 'eb clr', type: 'button', title: 'clear energy', onClick: () => { s.energy = []; changed(); } }, 'x');
  const dmg = el('input', { class: 'pts', type: 'number', min: '0', value: String(s.damage), title: 'damage' }) as HTMLInputElement;
  dmg.addEventListener('input', () => { s.damage = Math.max(0, Number(dmg.value) || 0); save(); renderBoard(); renderRecs(); });
  const cBtns = CONDITIONS.map((c) => el('button', { class: `cb${s.conditions.includes(c) ? ' on' : ''}`, type: 'button', title: c, onClick: () => {
    s.conditions = s.conditions.includes(c) ? s.conditions.filter((x) => x !== c) : [...s.conditions, c]; changed();
  } }, CABBR[c]));
  editorEl.append(
    el('div', { class: 'erow' }, el('b', {}, s.name), el('button', { class: 'rm', type: 'button', onClick: () => removeSlot(selected!.side, selected!.idx) }, 'remove')),
    el('div', { class: 'erow' }, energyView, ...eBtns, clr),
    el('div', { class: 'erow' }, el('span', { class: 'muted' }, 'dmg'), dmg, ...cBtns),
  );
}

// ---- search panel -----------------------------------------------------------
const searchInput = el('input', { class: 'search', placeholder: 'search a Pokemon to place...', autocomplete: 'off' }) as HTMLInputElement;
const searchGrid = el('div', { class: 'searchgrid' });

function renderSearch(query: string): void {
  clear(searchGrid);
  const q = query.trim().toLowerCase();
  if (!q) { searchGrid.append(el('span', { class: 'muted' }, 'Type to search; drag a card onto a slot, or click it then click a slot.')); return; }
  const hits = ALL_POKEMON.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 36);
  const seen = new Set<string>();
  for (const p of hits) {
    if (seen.has(p.name)) continue;
    seen.add(p.name);
    const url = cardImageUrl(p.id);
    const tile = el('div', { class: `tile${placePending === p.name ? ' picked' : ''}`, title: p.name, draggable: 'true' });
    tile.append(url ? el('img', { class: 'thumb', src: url, alt: p.name, loading: 'lazy' }) : el('div', { class: 'noimg' }, p.name), el('span', { class: 'tn' }, p.name));
    tile.addEventListener('dragstart', (e) => { (e as DragEvent).dataTransfer?.setData('text/plain', p.name); });
    tile.addEventListener('click', () => { placePending = placePending === p.name ? null : p.name; renderSearchSelection(); });
    searchGrid.append(tile);
  }
}
function renderSearchSelection(): void {
  searchGrid.querySelectorAll('.tile').forEach((t) => t.classList.toggle('picked', t.getAttribute('title') === placePending));
}

// ---- recommendations --------------------------------------------------------
const recsEl = el('div', { class: 'card recs' });

function renderRecs(): void {
  clear(recsEl);
  if (!board.mine[0]) { recsEl.append(el('span', { class: 'muted' }, 'Place your active Pokemon to get recommendations.')); return; }
  if (!board.opp[0]) { recsEl.append(el('span', { class: 'muted' }, "Place the opponent's active Pokemon.")); return; }
  const state = buildState();
  const recs = recommend(state);
  const best = recs[0];
  const list = el('ol', {});
  for (const r of recs.slice(0, 6)) list.append(el('li', {}, describeMove(state, r.move), ' ', el('span', { class: 'eq' }, `(${r.value.toFixed(0)})`)));
  const line = el('div', {});
  if (best) { let st = state; best.plan.forEach((m, i) => { line.append(el('div', { class: 'step' }, `${i + 1}. ${describeMove(st, m)}`)); st = applyMove(st, m); }); }
  recsEl.append(el('div', { class: 'muted' }, `${recs.length} plays, 2-ply`), el('b', {}, 'Best line'), line, el('b', {}, 'Ranked plays'), list);
}

// ---- controls + layout ------------------------------------------------------
function loadExample(): void {
  board.mine = [
    { name: 'Charizard ex', energy: ['Fire', 'Fire', 'Fire'], damage: 0, conditions: [] },
    { name: 'Marowak ex', energy: ['Fighting'], damage: 0, conditions: [] },
    { name: 'Articuno ex', energy: [], damage: 0, conditions: [] }, null,
  ];
  board.opp = [{ name: 'Pikachu ex', energy: ['Lightning', 'Lightning'], damage: 0, conditions: [] }, null, null, null];
  board.pending = 'Fire'; board.myPts = 0; board.oppPts = 0; board.hand = [];
  pendingSel.value = 'Fire'; myPtsEl.value = '0'; oppPtsEl.value = '0';
  selected = { side: 'mine', idx: 0 };
  changed();
}
function clearBoard(): void {
  board.mine = [null, null, null, null]; board.opp = [null, null, null, null]; board.hand = []; board.pending = ''; board.myPts = 0; board.oppPts = 0;
  selected = null; pendingSel.value = ''; myPtsEl.value = '0'; oppPtsEl.value = '0';
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  changed();
}

const pendingSel = el('select', {}, el('option', { value: '' }, 'energy this turn'), ...ENERGIES.map((e) => el('option', { value: e }, e))) as HTMLSelectElement;
pendingSel.addEventListener('change', () => { board.pending = pendingSel.value; save(); renderRecs(); });
const myPtsEl = el('input', { class: 'pts', type: 'number', min: '0', max: '3', value: '0', title: 'your points' }) as HTMLInputElement;
myPtsEl.addEventListener('input', () => { board.myPts = Math.max(0, Math.min(3, Number(myPtsEl.value) || 0)); save(); renderBoard(); renderRecs(); });
const oppPtsEl = el('input', { class: 'pts', type: 'number', min: '0', max: '3', value: '0', title: 'opponent points' }) as HTMLInputElement;
oppPtsEl.addEventListener('input', () => { board.oppPts = Math.max(0, Math.min(3, Number(oppPtsEl.value) || 0)); save(); renderBoard(); renderRecs(); });

searchInput.addEventListener('input', () => renderSearch(searchInput.value));

const app = document.getElementById('app')!;
app.className = 'appgrid';
app.append(
  el('div', { class: 'left' },
    boardEl,
    el('div', { class: 'card controls' },
      pendingSel,
      el('label', { class: 'muted' }, 'you ', myPtsEl), el('label', { class: 'muted' }, 'opp ', oppPtsEl),
      el('button', { type: 'button', onClick: loadExample }, 'Example'),
      el('button', { type: 'button', onClick: clearBoard }, 'Clear'),
    ),
    editorEl,
  ),
  el('div', { class: 'right' },
    el('div', { class: 'card' }, searchInput, searchGrid),
    recsEl,
  ),
);

load();
if (board.pending) pendingSel.value = board.pending;
myPtsEl.value = String(board.myPts); oppPtsEl.value = String(board.oppPts);
renderBoard(); renderEditor(); renderSearch(''); renderRecs();
