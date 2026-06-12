import rawCards from '../data/ptcgp-cards.json';
import { buildIndex, type RawCard } from '../src/card-index.js';
import { recommend, describeMove, summarizeBestLine } from '../src/recommend.js';
import { applyMove } from '../src/rules.js';
import type { GameState, InPlay, PlayerState, ConcreteEnergy, EnergyType, Condition } from '../src/types.js';
import { el, clear } from './dom.js';
import { cardImageUrl } from './images.js';
import { cardDetailEl } from './card-view.js';
import { slotTargetFromPoint } from './dnd.js';
import { encodeBoard, decodeBoard } from './share.js';
import { TRAINERS } from '../src/trainers.js';

const { findCard, hasCard, findAnyCard, ALL_POKEMON, ALL_CARDS } = buildIndex(rawCards as RawCard[]);

const ENERGIES: ConcreteEnergy[] = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal'];
const ABBR: Record<ConcreteEnergy, string> = { Grass: 'G', Fire: 'R', Water: 'W', Lightning: 'L', Psychic: 'P', Fighting: 'F', Darkness: 'D', Metal: 'M' };
const CONDITIONS: Condition[] = ['asleep', 'paralyzed', 'poisoned', 'burned', 'confused'];
const CABBR: Record<Condition, string> = { asleep: 'Slp', paralyzed: 'Par', poisoned: 'Psn', burned: 'Brn', confused: 'Cnf' };
const CONCRETE = new Set<string>(ENERGIES);
const concreteOf = (t: EnergyType | undefined): ConcreteEnergy[] => (t && CONCRETE.has(t) ? [t as ConcreteEnergy] : []);

interface Slot { name: string; energy: ConcreteEnergy[]; damage: number; conditions: Condition[]; }
type Side = 'mine' | 'opp';

const STORAGE_KEY = 'pocket-pilot:board2';
const board: { mine: (Slot | null)[]; opp: (Slot | null)[]; hand: string[]; pending: string; myPts: number; oppPts: number; oppZone: ConcreteEnergy[] } = {
  mine: [null, null, null, null], opp: [null, null, null, null], hand: [], pending: '', myPts: 0, oppPts: 0, oppZone: [],
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
function player(name: string, slots: (Slot | null)[], points: number, pending: ConcreteEnergy | null, hand: string[], zone?: ConcreteEnergy[]): PlayerState {
  const active = toInPlay(slots[0]!);
  const bench = slots.slice(1).map(toInPlay).filter((x): x is InPlay => x !== null);
  return {
    name, active, bench,
    hand: hand.map((n) => findAnyCard(n)).filter((c): c is NonNullable<typeof c> => c != null),
    deckCount: 20, discardCount: 0, points,
    // An explicit Energy Zone wins; otherwise fall back to the active's type.
    energyZone: pending ? [pending] : zone && zone.length ? [...zone] : concreteOf(active?.card.type),
    pendingEnergy: pending, energyAttachedThisTurn: false,
  };
}
function buildState(): GameState {
  const pending = (board.pending || null) as ConcreteEnergy | null;
  return {
    toMove: 0, turn: 5, isFirstPlayerFirstTurn: false,
    players: [
      player('You', board.mine, board.myPts, pending, board.hand),
      player('Opponent', board.opp, board.oppPts, null, [], board.oppZone),
    ],
  };
}

// ---- persistence ------------------------------------------------------------
function save(): void { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(board)); } catch { /* ignore */ } }
function load(): void {
  // A shared position in the URL hash takes precedence over localStorage, but is
  // consumed once: persist it as the working board and drop the hash, so later
  // edits + reloads use localStorage rather than the stale shared snapshot.
  const hash = (location.hash || '').replace(/^#/, '');
  if (hash) {
    const shared = decodeBoard(hash);
    if (shared) {
      Object.assign(board, shared);
      save();
      try { history.replaceState(null, '', location.pathname + location.search); } catch { location.hash = ''; }
      return;
    }
  }
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
function changed(): void { save(); renderBoard(); renderEditor(); renderHand(); renderRecs(); }

// ---- hand (cards you hold) --------------------------------------------------
const handEl = el('div', { class: 'card hand' });
const TRAINER_NAMES = Object.keys(TRAINERS).filter((n) => !!findAnyCard(n));

function addToHand(name: string): void {
  if (!findAnyCard(name)) return;
  board.hand.push(name);
  save(); renderHand(); renderRecs();
}
function addByName(query: string): void {
  const q = query.trim();
  if (!q) return;
  const exact = findAnyCard(q);
  const card = exact ?? ALL_CARDS.find((c) => c.name.toLowerCase() === q.toLowerCase())
    ?? ALL_CARDS.find((c) => c.name.toLowerCase().includes(q.toLowerCase()));
  if (card) addToHand(card.name);
}
function removeFromHand(i: number): void { board.hand.splice(i, 1); save(); renderHand(); renderRecs(); }

function renderHand(): void {
  clear(handEl);
  const quick = el('div', { class: 'erow' }, el('span', { class: 'muted' }, 'add trainer:'));
  for (const n of TRAINER_NAMES) quick.append(el('button', { class: 'hb', type: 'button', title: n, onClick: () => addToHand(n) }, n));
  const input = el('input', { class: 'handinput', placeholder: 'add any card by name + Enter', autocomplete: 'off' }) as HTMLInputElement;
  input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') { addByName(input.value); input.value = ''; } });
  const chips = el('div', { class: 'handchips' });
  if (!board.hand.length) chips.append(el('span', { class: 'muted' }, 'empty - add trainers / cards you hold'));
  board.hand.forEach((name, i) => {
    chips.append(el('span', { class: 'hchip' }, name, el('button', { class: 'x', type: 'button', title: 'remove', onClick: () => removeFromHand(i) }, 'x')));
  });
  handEl.append(el('b', {}, 'Your hand'), quick, input, chips);
}

// Touch-drag: drag a card with a finger onto the slot under it.  Complements the
// desktop HTML5 drag and the tap-to-place fallback; both stay working.
function enableTouchDrag(node: HTMLElement, name: string, imgUrl: string | null): void {
  node.addEventListener('touchstart', (ev) => {
    const t = (ev as TouchEvent).touches[0];
    if (!t) return;
    const ghost = el('div', { class: 'dragghost' }, imgUrl ? el('img', { src: imgUrl, alt: name }) : el('div', { class: 'noimg' }, name));
    const moveGhost = (x: number, y: number) => { ghost.style.left = `${x}px`; ghost.style.top = `${y}px`; };
    moveGhost(t.clientX, t.clientY);
    document.body.append(ghost);
    let lastSlot: Element | null = null;

    const onMove = (mv: TouchEvent) => {
      mv.preventDefault(); // hold the page still while dragging
      const tt = mv.touches[0];
      if (!tt) return;
      moveGhost(tt.clientX, tt.clientY);
      ghost.style.visibility = 'hidden';
      const slot = document.elementFromPoint(tt.clientX, tt.clientY)?.closest('.slot') ?? null;
      ghost.style.visibility = '';
      if (slot !== lastSlot) { lastSlot?.classList.remove('drop'); slot?.classList.add('drop'); lastSlot = slot; }
    };
    const onEnd = (en: TouchEvent) => {
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      lastSlot?.classList.remove('drop');
      ghost.remove(); // remove BEFORE hit-testing so the ghost isn't what we hit
      const tt = en.changedTouches[0];
      const tgt = tt ? slotTargetFromPoint(tt.clientX, tt.clientY) : null;
      if (tgt) place(tgt.side, tgt.idx, name);
    };
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
  }, { passive: true });
}

// ---- board rendering --------------------------------------------------------
const boardEl = el('div', { class: 'board' });

function slotEl(side: Side, idx: number, label: string): HTMLElement {
  const s = board[side][idx];
  const node = el('div', { class: `slot${s ? ' filled' : ''}${selected?.side === side && selected.idx === idx ? ' sel' : ''}`, 'data-label': label, 'data-side': side, 'data-idx': String(idx) });
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
  if (hasCard(s.name)) editorEl.append(cardDetailEl(findCard(s.name)));
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
    enableTouchDrag(tile, p.name, url);
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
  const summary = summarizeBestLine(state, recs);
  const verdict = el('div', { class: 'verdict' });
  if (summary) {
    const cls = summary.won ? 'win' : summary.kos ? 'good' : summary.survivesReply ? 'ok' : 'risk';
    verdict.append(el('span', { class: `vchip ${cls}` }, summary.won ? 'WIN' : summary.kos ? `+${summary.pointSwing}` : summary.survivesReply ? 'SAFE' : 'RISK'),
      el('span', { class: 'vtext' }, summary.text));
  }
  const threat = el('div', {});
  if (summary?.oppReply && !summary.won) {
    threat.append(el('span', { class: 'muted' }, 'Opponent likely: '), el('span', { class: 'threat' }, summary.oppReply.text));
  }
  const list = el('ol', {});
  for (const r of recs.slice(0, 6)) list.append(el('li', {}, describeMove(state, r.move), ' ', el('span', { class: 'eq' }, `(${r.value.toFixed(0)})`)));
  const line = el('div', {});
  if (best) { let st = state; best.plan.forEach((m, i) => { line.append(el('div', { class: 'step' }, `${i + 1}. ${describeMove(st, m)}`)); st = applyMove(st, m); }); }
  recsEl.append(verdict, threat, el('div', { class: 'muted' }, `${recs.length} plays, 2-ply`), el('b', {}, 'Best line'), line, el('b', {}, 'Ranked plays'), list);
}

// ---- controls + layout ------------------------------------------------------
function loadExample(): void {
  board.mine = [
    { name: 'Charizard ex', energy: ['Fire', 'Fire', 'Fire'], damage: 0, conditions: [] },
    { name: 'Marowak ex', energy: ['Fighting'], damage: 0, conditions: [] },
    { name: 'Articuno ex', energy: [], damage: 0, conditions: [] }, null,
  ];
  board.opp = [{ name: 'Pikachu ex', energy: ['Lightning', 'Lightning'], damage: 0, conditions: [] }, null, null, null];
  board.pending = 'Fire'; board.myPts = 0; board.oppPts = 0; board.hand = ['Giovanni']; board.oppZone = ['Lightning'];
  pendingSel.value = 'Fire'; myPtsEl.value = '0'; oppPtsEl.value = '0';
  selected = { side: 'mine', idx: 0 };
  changed();
}
function clearBoard(): void {
  board.mine = [null, null, null, null]; board.opp = [null, null, null, null]; board.hand = []; board.pending = ''; board.myPts = 0; board.oppPts = 0; board.oppZone = [];
  selected = null; pendingSel.value = ''; myPtsEl.value = '0'; oppPtsEl.value = '0';
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  try { history.replaceState(null, '', location.pathname + location.search); } catch { location.hash = ''; }
  changed();
}

const pendingSel = el('select', {}, el('option', { value: '' }, 'energy this turn'), ...ENERGIES.map((e) => el('option', { value: e }, e))) as HTMLSelectElement;
pendingSel.addEventListener('change', () => { board.pending = pendingSel.value; save(); renderRecs(); });
const myPtsEl = el('input', { class: 'pts', type: 'number', min: '0', max: '3', value: '0', title: 'your points' }) as HTMLInputElement;
myPtsEl.addEventListener('input', () => { board.myPts = Math.max(0, Math.min(3, Number(myPtsEl.value) || 0)); save(); renderBoard(); renderRecs(); });
const oppPtsEl = el('input', { class: 'pts', type: 'number', min: '0', max: '3', value: '0', title: 'opponent points' }) as HTMLInputElement;
oppPtsEl.addEventListener('input', () => { board.oppPts = Math.max(0, Math.min(3, Number(oppPtsEl.value) || 0)); save(); renderBoard(); renderRecs(); });

// Opponent Energy Zone: the (up to 3) energy types they generate, used to predict
// what they can attach on their reply.  Falls back to the active's type if unset.
const oppZoneEl = el('span', { class: 'oppzone' });
function setOppZone(e: ConcreteEnergy): void {
  const i = board.oppZone.indexOf(e);
  if (i >= 0) board.oppZone.splice(i, 1);
  else if (board.oppZone.length < 3) board.oppZone.push(e);
  save(); renderOppZone(); renderRecs();
}
function renderOppZone(): void {
  clear(oppZoneEl);
  oppZoneEl.append(el('span', { class: 'muted', title: 'energy the opponent generates (default: their active type)' }, 'opp zone'));
  for (const e of ENERGIES) {
    oppZoneEl.append(el('button', { class: `eb${board.oppZone.includes(e) ? ' on' : ''}`, type: 'button', title: e, onClick: () => setOppZone(e) }, ABBR[e]));
  }
}

// Share the current position as a link (URL hash).
const copyBtn = el('button', { type: 'button', title: 'copy a shareable link to this position' }, 'Copy link') as HTMLButtonElement;
copyBtn.addEventListener('click', () => {
  const hash = encodeBoard(board);
  location.hash = hash;
  const url = `${location.origin}${location.pathname}#${hash}`;
  const flash = (label: string) => { copyBtn.textContent = label; setTimeout(() => { copyBtn.textContent = 'Copy link'; }, 1200); };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(() => flash('Copied'), () => flash('Copy failed'));
  else flash('Link in URL');
});

searchInput.addEventListener('input', () => renderSearch(searchInput.value));

// ---- legend / help (collapsible, remembered) --------------------------------
const HELP_KEY = 'pocket-pilot:help';
let helpOpen = false;
try { helpOpen = localStorage.getItem(HELP_KEY) === '1'; } catch { /* ignore */ }
const helpBody = el('div', { class: 'helpbody' });
const helpToggle = el('button', { class: 'helptoggle', type: 'button' }, '?') as HTMLButtonElement;
function renderHelp(): void {
  clear(helpBody);
  helpToggle.textContent = helpOpen ? 'x' : '?';
  helpToggle.title = helpOpen ? 'hide help' : 'how to read this';
  helpBody.style.display = helpOpen ? '' : 'none';
  if (!helpOpen) return;
  helpBody.append(
    el('div', { class: 'helprow' }, el('b', {}, 'Verdict '), 'WIN = reaches 3 points; +N = scores N points this turn; SAFE = your active survives the opponent reply; RISK = your active falls to the reply.'),
    el('div', { class: 'helprow' }, el('b', {}, 'Card tags '), 'coin xN / N% hit = coin-flip attack; sleep / poison / paralyze / burn / confuse = status it inflicts; discard / strip = energy removed; heal = damage healed; snipe / spread = damage to the opponent bench.'),
    el('div', { class: 'helprow' }, el('b', {}, 'Build the board '), 'drag a search tile onto a slot, drag with your finger on mobile, or tap a tile then tap a slot. Click a placed card to set its energy, damage, and conditions; add trainers you hold under Your hand; set the opponent Energy Zone so the threat is accurate.'),
  );
}
helpToggle.addEventListener('click', () => {
  helpOpen = !helpOpen;
  try { localStorage.setItem(HELP_KEY, helpOpen ? '1' : '0'); } catch { /* ignore */ }
  renderHelp();
});
const helpCard = el('div', { class: 'card helpcard' },
  el('div', { class: 'helphead' }, el('span', { class: 'muted' }, 'How to read this'), helpToggle),
  helpBody,
);

const app = document.getElementById('app')!;
app.className = 'appgrid';
app.append(
  helpCard,
  el('div', { class: 'left' },
    boardEl,
    el('div', { class: 'card controls' },
      pendingSel,
      el('label', { class: 'muted' }, 'you ', myPtsEl), el('label', { class: 'muted' }, 'opp ', oppPtsEl),
      el('button', { type: 'button', onClick: loadExample }, 'Example'),
      el('button', { type: 'button', onClick: clearBoard }, 'Clear'),
      copyBtn,
      oppZoneEl,
    ),
    editorEl,
    handEl,
  ),
  el('div', { class: 'right' },
    el('div', { class: 'card' }, searchInput, searchGrid),
    recsEl,
  ),
);

load();
if (!Array.isArray(board.oppZone)) board.oppZone = [];
if (board.pending) pendingSel.value = board.pending;
myPtsEl.value = String(board.myPts); oppPtsEl.value = String(board.oppPts);
renderHelp(); renderBoard(); renderEditor(); renderHand(); renderOppZone(); renderSearch(''); renderRecs();
