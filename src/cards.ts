import type { PokemonCard } from './types.js';

// Hand-entered SEED of a few real Pokemon TCG Pocket cards, chosen to exercise
// every engine feature (evolution line, ex, weakness, a coin-flip attack, a
// board-dependent attack).  Stats are approximate from memory; a later loop
// iteration replaces this with the flibustier/pokemon-tcg-pocket-database JSON.
// Do not treat these numbers as authoritative.

export const CARDS: Record<string, PokemonCard> = {
  charmander: {
    id: 'charmander', name: 'Charmander', kind: 'Pokemon', type: 'Fire',
    hp: 60, stage: 'Basic', isEx: false, retreatCost: 1, weakness: 'Water',
    attacks: [{ name: 'Ember', cost: ['Fire'], damage: 30, text: 'Discard a Fire Energy.' }],
  },
  charmeleon: {
    id: 'charmeleon', name: 'Charmeleon', kind: 'Pokemon', type: 'Fire',
    hp: 90, stage: 'Stage1', evolvesFrom: 'Charmander', isEx: false, retreatCost: 2,
    weakness: 'Water',
    attacks: [{ name: 'Fire Claws', cost: ['Fire', 'Colorless', 'Colorless'], damage: 60 }],
  },
  charizard_ex: {
    id: 'charizard_ex', name: 'Charizard ex', kind: 'Pokemon', type: 'Fire',
    hp: 180, stage: 'Stage2', evolvesFrom: 'Charmeleon', isEx: true, retreatCost: 2,
    weakness: 'Water',
    attacks: [
      { name: 'Slash', cost: ['Fire', 'Colorless', 'Colorless'], damage: 60 },
      { name: 'Crimson Storm', cost: ['Fire', 'Fire', 'Colorless', 'Colorless'], damage: 200,
        text: 'Discard 2 Fire Energy from this Pokemon.' },
    ],
  },
  pikachu_ex: {
    id: 'pikachu_ex', name: 'Pikachu ex', kind: 'Pokemon', type: 'Lightning',
    hp: 120, stage: 'Basic', isEx: true, retreatCost: 1, weakness: 'Fighting',
    // Real card scales +30 per benched Lightning; v0 models the base hit.
    attacks: [{ name: 'Circle Circuit', cost: ['Lightning'], damage: 30,
      text: '30x for each of your Benched Lightning Pokemon (base modeled in v0).' }],
  },
  marowak_ex: {
    id: 'marowak_ex', name: 'Marowak ex', kind: 'Pokemon', type: 'Fighting',
    hp: 150, stage: 'Basic', isEx: true, retreatCost: 1, weakness: 'Grass',
    attacks: [{ name: 'Bonemerang', cost: ['Fighting', 'Colorless'], damage: 0,
      coin: { flips: 2, damagePerHeads: 80 }, text: 'Flip 2 coins, 80 damage per heads.' }],
  },
  articuno_ex: {
    id: 'articuno_ex', name: 'Articuno ex', kind: 'Pokemon', type: 'Water',
    hp: 140, stage: 'Basic', isEx: true, retreatCost: 2, weakness: 'Lightning',
    attacks: [{ name: 'Ice Wing', cost: ['Water', 'Water', 'Colorless'], damage: 80 }],
  },
};

export function card(id: keyof typeof CARDS): PokemonCard {
  const c = CARDS[id];
  if (!c) throw new Error(`unknown seed card: ${id}`);
  return c;
}
