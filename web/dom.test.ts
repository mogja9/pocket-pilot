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
console.log(`\n${passed} passed`);
