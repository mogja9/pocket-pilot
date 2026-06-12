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
console.log(`\n${passed} passed`);
