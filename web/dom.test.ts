import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>');
(globalThis as unknown as { document: Document }).document = dom.window.document as unknown as Document;

const { el } = await import('./dom.js');

let passed = 0;
const t = (name: string, fn: () => void) => { fn(); passed++; console.log(`  ok  ${name}`); };

console.log('dom tests:');
t('el() sets a read-only property (input.list) via setAttribute, no throw', () => {
  const input = el('input', { class: 'name', list: 'cards', placeholder: 'card' }) as HTMLInputElement;
  assert.equal(input.getAttribute('list'), 'cards');
  assert.equal(input.className, 'name');
  assert.equal(input.placeholder, 'card');
});
t('el() builds a datalist with options', () => {
  const dl = el('datalist', { id: 'cards' }, el('option', { value: 'Pikachu ex' })) as HTMLDataListElement;
  assert.equal(dl.id, 'cards');
  assert.equal(dl.querySelectorAll('option').length, 1);
});
t('el() append escapes text (no HTML injection)', () => {
  const span = el('span', {}, '<img src=x onerror=alert(1)>');
  assert.equal(span.children.length, 0);
  assert.ok(span.textContent?.includes('<img'));
});

const { cardDetailEl } = await import('./card-view.js');
const { findCard } = await import('../src/data.js');
t('cardDetailEl renders attacks with real effect text', () => {
  const node = cardDetailEl(findCard('Charizard ex'));
  const txt = node.textContent ?? '';
  assert.ok(txt.includes('Crimson Storm'), 'attack name shown');
  assert.ok(txt.includes('Discard 2 [R] Energy'), 'attack effect text shown');
  assert.ok(txt.includes('180 HP'), 'meta line shown');
  // effect text is a text node, never parsed as markup
  assert.equal(node.querySelectorAll('img').length, 0);
});
t('cardDetailEl renders an ability with its text', () => {
  const node = cardDetailEl(findCard('Greninja'));
  const txt = node.textContent ?? '';
  assert.ok(txt.includes('Ability: Water Shuriken'), 'ability name shown');
  assert.ok(txt.includes('20 damage'), 'ability text shown');
});
t('cardDetailEl shows compact rider tags for parsed mechanics', () => {
  const sleepTags = [...cardDetailEl(findCard('Frosmoth')).querySelectorAll('.ci-tag')].map((e) => e.textContent);
  assert.ok(sleepTags.includes('sleep'), `expected a sleep tag, got ${sleepTags}`);
  const healTags = [...cardDetailEl(findCard('Vaporeon')).querySelectorAll('.ci-tag')].map((e) => e.textContent);
  assert.ok(healTags.includes('heal 30'), `expected a heal tag, got ${healTags}`);
});

const { cardImageUrl } = await import('./images.js');
t('cardImageUrl keeps sub-set suffixes lowercase (a4b -> A4b, not A4B)', () => {
  assert.ok(cardImageUrl('a4b-245')!.includes('/A4b/A4b_245_EN.webp'), 'sub-set suffix stays lowercase');
  assert.ok(cardImageUrl('a2-110')!.includes('/A2/A2_110_EN.webp'), 'plain set uppercased');
  assert.ok(cardImageUrl('p-a-042')!.includes('/P-A/P-A_042_EN.webp'), 'promo uppercased whole');
});

const { slotTargetFromEl } = await import('./dnd.js');
t('slotTargetFromEl resolves the slot under a touch point', () => {
  const slot = el('div', { class: 'slot', 'data-side': 'opp', 'data-idx': '2' }, el('img', { class: 'cardimg', alt: 'x' }));
  document.body.append(slot);
  const inner = slot.querySelector('img')!;
  assert.deepEqual(slotTargetFromEl(inner), { side: 'opp', idx: 2 }, 'walks up to the .slot and reads its coords');
  assert.equal(slotTargetFromEl(el('div', {})), null, 'a non-slot element resolves to null');
  slot.remove();
});
const { encodeBoard, decodeBoard } = await import('./share.js');
t('share: encodeBoard/decodeBoard round-trips a board', () => {
  const board = {
    mine: [{ name: 'Charizard ex', energy: ['Fire', 'Fire'], damage: 60, conditions: ['poisoned'] }, null, null, null],
    opp: [{ name: 'Pikachu ex', energy: ['Lightning'], damage: 0, conditions: [] }, null, null, null],
    hand: ['Giovanni'], pending: 'Fire', myPts: 1, oppPts: 2, oppZone: ['Lightning'],
  };
  const round = decodeBoard(encodeBoard(board));
  assert.deepEqual(round, board, 'round-trip preserves the board');
});
t('share: decodeBoard sanitizes and rejects bad input', () => {
  assert.equal(decodeBoard('not-base64-$$$'), null, 'malformed string -> null');
  assert.equal(decodeBoard(''), null, 'empty -> null');
  // Oversized arrays clamp, bad energy/conditions/points are filtered.
  const dirty = encodeBoard({
    mine: [null, null, null, null, { name: 'X', energy: ['Bogus'], damage: -5, conditions: ['hexed'] }] as never,
    opp: [], hand: [], pending: 'Nonsense', myPts: 9, oppPts: -1, oppZone: ['Water', 'Bad'],
  } as never);
  const d = decodeBoard(dirty)!;
  assert.equal(d.mine.length, 4, 'mine clamped to 4 slots');
  assert.equal(d.pending, '', 'invalid pending energy dropped');
  assert.equal(d.myPts, 3, 'points clamped to 3');
  assert.equal(d.oppPts, 0, 'negative points clamped to 0');
  assert.deepEqual(d.oppZone, ['Water'], 'invalid energy filtered from oppZone');
});
console.log(`\n${passed} passed`);
