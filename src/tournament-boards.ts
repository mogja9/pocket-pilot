// A reusable set of diverse starting boards for eval A/B tournaments (varied
// types, HP, stages, and bench).  Returned by a factory so each call yields
// fresh, unshared InPlay objects.
import type { GameState, InPlay, ConcreteEnergy, PlayerState } from './types.js';
import { findCard } from './data.js';

const ip = (name: string): InPlay => ({ card: findCard(name), energy: [], damage: 0, turnPlayedOrEvolved: 0 });
const side = (active: InPlay, bench: InPlay[], zone: ConcreteEnergy[]): PlayerState =>
  ({ name: 'p', active, bench, hand: [], deckCount: 20, discardCount: 0, points: 0, energyZone: zone, pendingEnergy: null, energyAttachedThisTurn: false });
const game = (p0: PlayerState, p1: PlayerState): GameState =>
  ({ toMove: 0, turn: 1, isFirstPlayerFirstTurn: false, players: [p0, p1] });

export function diverseBoards(): GameState[] {
  return [
    game(side(ip('Charizard ex'), [ip('Marowak ex')], ['Fire']), side(ip('Pikachu ex'), [ip('Articuno ex')], ['Lightning'])),
    game(side(ip('Greninja'), [ip('Snorlax')], ['Water']), side(ip('Marowak ex'), [ip('Pikachu ex')], ['Fighting'])),
    game(side(ip('Gyarados'), [ip('Vaporeon')], ['Water']), side(ip('Melmetal'), [ip('Cloyster')], ['Metal'])),
    game(side(ip('Seadra'), [ip('Articuno ex')], ['Water']), side(ip('Pikachu ex'), [ip('Jolteon')], ['Lightning'])),
    game(side(ip('Abomasnow'), [ip('Snorlax')], ['Water']), side(ip('Exeggutor ex'), [ip('Pinsir')], ['Grass'])),
    game(side(ip('Frosmoth'), [ip('Tentacruel')], ['Water']), side(ip('Marowak ex'), [ip('Hitmonlee')], ['Fighting'])),
    game(side(ip('Mew ex'), [ip('Hypno')], ['Psychic']), side(ip('Snorlax'), [ip('Charizard ex')], ['Fire'])),
    game(side(ip('Pikachu ex'), [ip('Electrode')], ['Lightning']), side(ip('Charizard ex'), [ip('Moltres')], ['Fire'])),
    game(side(ip('Articuno ex'), [ip('Seadra')], ['Water']), side(ip('Marowak ex'), [ip('Golem')], ['Fighting'])),
    game(side(ip('Venusaur'), [ip('Butterfree')], ['Grass']), side(ip('Charizard ex'), [ip('Ninetales')], ['Fire'])),
    game(side(ip('Machamp ex'), [ip('Hitmonlee')], ['Fighting']), side(ip('Mew ex'), [ip('Gardevoir')], ['Psychic'])),
    game(side(ip('Snorlax'), [ip('Wigglytuff')], ['Grass']), side(ip('Gyarados'), [ip('Cloyster')], ['Water'])),
  ];
}
