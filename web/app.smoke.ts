import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body><div id="app">loading engine...</div></body>', { url: 'http://localhost/' });
const g = globalThis as unknown as { document: Document; localStorage: Storage; location: Location; history: History };
g.document = dom.window.document as unknown as Document;
g.localStorage = dom.window.localStorage as unknown as Storage;
g.location = dom.window.location as unknown as Location;
g.history = dom.window.history as unknown as History;

await import('./main.js'); // entry runs on import

const app = dom.window.document.getElementById('app')!;
assert.notEqual(app.textContent?.trim(), 'loading engine...', 'app should render past the loading state');
assert.ok(app.querySelector('input'), 'form inputs should be present');
assert.ok(app.querySelector('button'), 'buttons should be present');
console.log(`app smoke ok: #app rendered ${app.querySelectorAll('input').length} inputs, ${app.querySelectorAll('button').length} buttons`);
