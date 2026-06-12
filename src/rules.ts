import type {
  GameState, PlayerState, InPlay, Attack, ConcreteEnergy, EnergyType,
} from './types.js';
import { BENCH_SIZE, WEAKNESS_BONUS } from './types.js';
import { scalingFor } from './effects.js';

// A single legal action a player can take.  Attacks and endTurn are terminal
// (they end the turn); the rest can be chained within a turn.
export type Move =
  | { type: 'attachEnergy'; target: 'active' | number }   // bench index
  | { type: 'evolve'; handIndex: number; target: 'active' | number }
  | { type: 'playBasic'; handIndex: number }
  | { type: 'retreat'; benchIndex: number }
  | { type: 'attack'; attackIndex: number }
  | { type: 'endTurn' };

export function isTerminal(m: Move): boolean {
  return m.type === 'attack' || m.type === 'endTurn';
}

// Can `have` (concrete attached energy) pay `cost` (which may include Colorless
// = any)?  Specific colors must be matched by that color; Colorless by anything
// left over.
export function canPayCost(have: ConcreteEnergy[], cost: EnergyType[]): boolean {
  const pool = [...have];
  let colorless = 0;
  for (const c of cost) {
    if (c === 'Colorless' || c === 'Dragon') { colorless++; continue; }
    const i = pool.indexOf(c as ConcreteEnergy);
    if (i === -1) return false;
    pool.splice(i, 1);
  }
  return pool.length >= colorless;
}

// Expected damage of `attack` from `attacker` onto `defender`, averaging over
// coin flips and applying Pokemon-Pocket weakness (+20 to a damaging hit).  When
// the attacking/defending players are supplied, board-dependent attacks (e.g.
// Pikachu ex Circle Circuit = 30 x benched Lightning) compute their real base
// from the live board via the scaling registry; otherwise the dataset's flat
// base is used as a floor.
export function expectedDamage(
  attack: Attack, attacker: InPlay, defender: InPlay,
  me?: PlayerState, opp?: PlayerState,
): number {
  let base = attack.damage;
  if (me && opp) {
    const scale = scalingFor(attacker.card.name, attack.name);
    if (scale) base = scale({ attacker, defender, me, opp });
  }
  const coinEV = attack.coin ? attack.coin.flips * 0.5 * attack.coin.damagePerHeads : 0;
  let dmg = base + coinEV;
  if (dmg > 0 && defender.card.weakness && attacker.card.type === defender.card.weakness) {
    dmg += WEAKNESS_BONUS;
  }
  return dmg;
}

function freeBench(p: PlayerState): boolean {
  return p.bench.length < BENCH_SIZE;
}

export function legalMoves(state: GameState): Move[] {
  const me = state.players[state.toMove];
  const moves: Move[] = [];

  // Attach the turn's generated energy (once per turn) to any of my Pokemon.
  if (me.pendingEnergy && !me.energyAttachedThisTurn) {
    if (me.active) moves.push({ type: 'attachEnergy', target: 'active' });
    me.bench.forEach((_, i) => moves.push({ type: 'attachEnergy', target: i }));
  }

  // Play / evolve from hand.
  me.hand.forEach((c, handIndex) => {
    if (c.kind !== 'Pokemon') return;
    if (c.stage === 'Basic') {
      if (freeBench(me)) moves.push({ type: 'playBasic', handIndex });
    } else if (c.evolvesFrom) {
      const evolvable = (ip: InPlay | null) =>
        ip && ip.card.name === c.evolvesFrom && ip.turnPlayedOrEvolved < state.turn;
      if (evolvable(me.active)) moves.push({ type: 'evolve', handIndex, target: 'active' });
      me.bench.forEach((ip, i) => {
        if (evolvable(ip)) moves.push({ type: 'evolve', handIndex, target: i });
      });
    }
  });

  // Retreat (swap active with a benched Pokemon), if we can pay the cost.
  if (me.active && me.bench.length > 0 && me.active.energy.length >= me.active.card.retreatCost) {
    me.bench.forEach((_, i) => moves.push({ type: 'retreat', benchIndex: i }));
  }

  // Attack with the active Pokemon (terminal).
  if (me.active) {
    me.active.card.attacks.forEach((atk, attackIndex) => {
      if (canPayCost(me.active!.energy, atk.cost)) moves.push({ type: 'attack', attackIndex });
    });
  }

  moves.push({ type: 'endTurn' });
  return moves;
}

// Apply a move and return the resulting state.  Attacks resolve to EXPECTED
// damage (the optimizer ranks on equity, not a single sampled outcome).
export function applyMove(state: GameState, move: Move): GameState {
  const next: GameState = structuredClone(state);
  const me = next.players[next.toMove];
  const opp = next.players[(next.toMove ^ 1) as 0 | 1];

  switch (move.type) {
    case 'attachEnergy': {
      const tgt = move.target === 'active' ? me.active : me.bench[move.target];
      if (tgt && me.pendingEnergy) {
        tgt.energy.push(me.pendingEnergy);
        me.pendingEnergy = null;
        me.energyAttachedThisTurn = true;
      }
      break;
    }
    case 'playBasic': {
      const c = me.hand[move.handIndex];
      if (c && c.kind === 'Pokemon') {
        me.bench.push({ card: c, energy: [], damage: 0, turnPlayedOrEvolved: next.turn });
        me.hand.splice(move.handIndex, 1);
      }
      break;
    }
    case 'evolve': {
      const c = me.hand[move.handIndex];
      const tgt = move.target === 'active' ? me.active : me.bench[move.target];
      if (c && c.kind === 'Pokemon' && tgt) {
        tgt.card = c;             // damage/energy carry over
        tgt.turnPlayedOrEvolved = next.turn;
        me.hand.splice(move.handIndex, 1);
      }
      break;
    }
    case 'retreat': {
      const benched = me.bench[move.benchIndex];
      if (me.active && benched) {
        me.active.energy.splice(0, me.active.card.retreatCost); // pay cost
        me.bench[move.benchIndex] = me.active;
        me.active = benched;
      }
      break;
    }
    case 'attack': {
      const atk = me.active?.card.attacks[move.attackIndex];
      if (me.active && atk && opp.active) {
        opp.active.damage += expectedDamage(atk, me.active, opp.active, me, opp);
        if (opp.active.damage >= opp.active.card.hp) {
          me.points += opp.active.card.isEx ? 2 : 1; // KO scores points
          opp.active = opp.bench.shift() ?? null;    // promote a benched Pokemon
        }
      }
      endTurn(next);
      break;
    }
    case 'endTurn':
      endTurn(next);
      break;
  }
  return next;
}

function endTurn(state: GameState): void {
  state.toMove = (state.toMove ^ 1) as 0 | 1;
  state.turn += 1;
  state.isFirstPlayerFirstTurn = false;
  const p = state.players[state.toMove];
  p.energyAttachedThisTurn = false;
  // The new player's energy generation is modeled at advise-time, not here.
}
