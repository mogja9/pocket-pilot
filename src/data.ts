import { readFileSync } from 'node:fs';
import { buildIndex, type RawCard } from './card-index.js';

// Node-only loader: read the vendored dataset from disk and build the card index.
// The browser builds the same index from a bundler JSON import (see web/main.ts);
// both share the pure adapter in card-index.ts.
const RAW: RawCard[] = JSON.parse(
  readFileSync(new URL('../data/ptcgp-cards.json', import.meta.url), 'utf8'),
);

const index = buildIndex(RAW);

export const { ALL_CARDS, ALL_POKEMON, findCard, hasCard } = index;
