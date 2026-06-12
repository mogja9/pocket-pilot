import type {
  GameState, PlayerState, InPlay, Attack, ConcreteEnergy, EnergyType, EnergyDiscard,
} from './types.js';
import { BENCH_SIZE, WEAKNESS_BONUS } from './types.js';
import { scalingFor } from './effects.js';
import { trainerEffect } from './trainers.js';

// A single legal action a player can take.  Attacks and endTurn are terminal
// (they end the turn); the rest can be chained within a turn.
export type Move =
  | { type: 'attachEnergy'; target: 'active' | number }   // bench index
  | { type: 'evolve'; handIndex: number; target: 'active' | number }
  | { type: 'playBasic'; handIndex: number }
  | { type: 'retreat'; benchIndex: number }
  | { type: 'playTrainer'; handIndex: number }
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
  // Giovanni-style flat boost applies to damaging attacks only.
  if (me && (base > 0 || attack.coin)) base += me.attackBonus ?? 0;
  // "If tails, this attack does nothing" lands the base only some of the time.
  const successProbability = attack.coin?.successProbability ?? 1;
  const coinEV = attack.coin ? attack.coin.flips * 0.5 * attack.coin.damagePerHeads : 0;
  let dmg = base * successProbability + coinEV;
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
  // An asleep or paralyzed active cannot attack or retreat.
  const activeLocked = !!me.active && (me.active.conditions ?? []).some((c) => c === 'asleep' || c === 'paralyzed');

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

  // Retreat (swap active with a benched Pokemon), if we can pay the cost
  // (reduced by X Speed this turn).
  const retreatCost = me.active ? Math.max(0, me.active.card.retreatCost - (me.retreatReduction ?? 0)) : 0;
  if (me.active && !activeLocked && me.bench.length > 0 && me.active.energy.length >= retreatCost) {
    me.bench.forEach((_, i) => moves.push({ type: 'retreat', benchIndex: i }));
  }

  // Play a combat-relevant trainer card from hand (one Supporter per turn).
  me.hand.forEach((c, handIndex) => {
    if (c.kind === 'Pokemon') return;
    const eff = trainerEffect(c.name);
    if (!eff) return;
    if (eff.kind === 'Supporter' && me.supporterUsedThisTurn) return;
    if (eff.usable && !eff.usable(state, state.toMove)) return;
    moves.push({ type: 'playTrainer', handIndex });
  });

  // Attack with the active Pokemon (terminal).
  if (me.active && !activeLocked) {
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
        const cost = Math.max(0, me.active.card.retreatCost - (me.retreatReduction ?? 0));
        me.active.energy.splice(0, cost); // pay cost
        me.bench[move.benchIndex] = me.active;
        me.active = benched;
      }
      break;
    }
    case 'playTrainer': {
      const c = me.hand[move.handIndex];
      if (c && c.kind !== 'Pokemon') {
        const eff = trainerEffect(c.name);
        if (eff) {
          eff.apply(next, next.toMove);
          if (eff.kind === 'Supporter') me.supporterUsedThisTurn = true;
          me.hand.splice(move.handIndex, 1);
        }
      }
      break;
    }
    case 'attack': {
      const atk = me.active?.card.attacks[move.attackIndex];
      if (me.active && atk && opp.active) {
        let dmg = expectedDamage(atk, me.active, opp.active, me, opp);
        if ((me.active.conditions ?? []).includes('confused')) dmg *= 0.5; // 50% the attack fails
        opp.active.damage += dmg;
        // Guaranteed status infliction lands on the surviving defender, where the
        // 2-ply search then sees it (asleep/paralyzed lock the reply; poison/burn
        // tick at the checkup; confused halves the reply).
        if (atk.inflicts?.length) {
          opp.active.conditions = [...new Set([...(opp.active.conditions ?? []), ...atk.inflicts])];
        }
        // Energy discards: from the attacker (a cost) and/or off the defender,
        // so canPayCost in the opponent's reply sees the stripped energy.
        for (const dsc of atk.discards ?? []) {
          const tgt = dsc.target === 'self' ? me.active : opp.active;
          if (tgt) discardEnergy(tgt, dsc);
        }
        resolveKO(next, (next.toMove ^ 1) as 0 | 1); // the defender may be KO'd
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

// Remove energy from a Pokemon per a discard rider.  A specific colour removes
// only that colour (the game can't discard energy you don't have); an
// unspecified discard takes from the front.
function discardEnergy(ip: InPlay, dsc: EnergyDiscard): void {
  if (dsc.amount === 'all') {
    ip.energy = dsc.type ? ip.energy.filter((e) => e !== dsc.type) : [];
    return;
  }
  if (dsc.type) {
    let n = dsc.amount;
    for (let i = ip.energy.length - 1; i >= 0 && n > 0; i--) {
      if (ip.energy[i] === dsc.type) { ip.energy.splice(i, 1); n--; }
    }
  } else {
    ip.energy.splice(0, Math.min(dsc.amount, ip.energy.length));
  }
}

// If player `ownerIdx`'s active is KO'd, award points to the other player
// (2 for an ex) and promote a benched Pokemon.
function resolveKO(state: GameState, ownerIdx: 0 | 1): void {
  const owner = state.players[ownerIdx];
  const other = state.players[(ownerIdx ^ 1) as 0 | 1];
  if (owner.active && owner.active.damage >= owner.active.card.hp) {
    other.points += owner.active.card.isEx ? 2 : 1;
    owner.active = owner.bench.shift() ?? null;
  }
}

function endTurn(state: GameState): void {
  // Between-turn checkup: poison (10) and burn (20) tick on conditioned actives.
  // (Wake/recover/heal flips are not modeled over the short search horizon yet.)
  ([0, 1] as const).forEach((idx) => {
    const a = state.players[idx].active;
    if (!a) return;
    const c = a.conditions ?? [];
    if (c.includes('poisoned')) a.damage += 10;
    if (c.includes('burned')) a.damage += 20;
    resolveKO(state, idx);
  });
  state.toMove = (state.toMove ^ 1) as 0 | 1;
  state.turn += 1;
  state.isFirstPlayerFirstTurn = false;
  const p = state.players[state.toMove];
  p.energyAttachedThisTurn = false;
  p.supporterUsedThisTurn = false; // fresh turn: reset per-turn trainer modifiers
  p.attackBonus = 0;
  p.retreatReduction = 0;
  // The new player's energy generation is modeled at advise-time, not here.
}
