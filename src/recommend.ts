import type { GameState, Condition } from './types.js';
import { legalMoves, applyMove, isTerminal, type Move } from './rules.js';
import { evaluate } from './evaluate.js';

const MY_TURN_DEPTH = 4;   // a turn is a few setup actions then an attack/pass
const OPP_TURN_DEPTH = 3;  // the opponent's reply: attach + attack is the core
const DECIDED = 1e5;        // |eval| above this means the game is already won/lost

type TurnResult = { value: number; plan: Move[]; state: GameState };

// Search the player-to-move's full turn (action sequences ending in attack or
// endTurn) and return the sequence that MAXIMIZES `scoreTerminal`, along with
// the resulting state.  `scoreTerminal` is what that player is trying to make
// large -- for the opponent it is their own eval; for us it is the post-reply
// (2-ply) value, so our search is defensively aware.
function searchTurn(state: GameState, scoreTerminal: (s: GameState) => number, depth: number): TurnResult {
  let best: TurnResult | null = null;
  for (const move of legalMoves(state)) {
    const after = applyMove(state, move);
    let cand: TurnResult;
    if (isTerminal(move) || depth <= 1) {
      cand = { value: scoreTerminal(after), plan: [move], state: after };
    } else {
      const rec = searchTurn(after, scoreTerminal, depth - 1);
      cand = { value: rec.value, plan: [move, ...rec.plan], state: rec.state };
    }
    if (!best || cand.value > best.value) best = cand;
  }
  if (best) return best;
  const after = applyMove(state, { type: 'endTurn' });
  return { value: scoreTerminal(after), plan: [{ type: 'endTurn' }], state: after };
}

// The state after the opponent plays their best reply to a state where MY turn
// just ended.  Returns the input unchanged when the game is already decided.
function bestReplyState(stateAfterMyTurn: GameState, me: 0 | 1): GameState {
  if (Math.abs(evaluate(stateAfterMyTurn, me)) >= DECIDED) return stateAfterMyTurn;
  const opp = (me ^ 1) as 0 | 1;
  // Give the opponent a plausible generated energy to use on their reply.
  const oppP = stateAfterMyTurn.players[opp];
  if (!oppP.pendingEnergy && !oppP.energyAttachedThisTurn && oppP.energyZone[0]) {
    oppP.pendingEnergy = oppP.energyZone[0];
  }
  return searchTurn(stateAfterMyTurn, (s) => evaluate(s, opp), OPP_TURN_DEPTH).state;
}

// Value to `me` of a state where MY turn just ended (opponent to move), after
// the opponent plays their best reply.  This is what makes the engine avoid
// hanging a Pokemon to a lethal counterattack.
function postReplyValue(stateAfterMyTurn: GameState, me: 0 | 1): number {
  return evaluate(bestReplyState(stateAfterMyTurn, me), me);
}

export interface Recommendation {
  move: Move;
  value: number;       // 2-ply equity (after the opponent's best reply)
  plan: Move[];        // the full planned turn beginning with `move`
}

// Rank every legal first move by its 2-ply equity.
export function recommend(state: GameState): Recommendation[] {
  const me = state.toMove;
  const scoreMyTerminal = (s: GameState) => postReplyValue(s, me);
  const recs: Recommendation[] = legalMoves(state).map((move) => {
    const after = applyMove(state, move);
    if (isTerminal(move)) return { move, value: scoreMyTerminal(after), plan: [move] };
    const rec = searchTurn(after, scoreMyTerminal, MY_TURN_DEPTH - 1);
    return { move, value: rec.value, plan: [move, ...rec.plan] };
  });
  // Rank by equity; break exact ties toward the decisive move (a retreat/attack
  // is more informative to surface than a bare energy attach that merely sets
  // up the same line).
  const PRIORITY: Record<Move['type'], number> = {
    attack: 3, retreat: 3, playTrainer: 2, evolve: 2, attachEnergy: 1, playBasic: 1, endTurn: 0,
  };
  recs.sort((a, b) =>
    Math.abs(a.value - b.value) > 1e-6 ? b.value - a.value : PRIORITY[b.move.type] - PRIORITY[a.move.type],
  );
  return recs;
}

function baseLabel(state: GameState, m: Move): string {
  const me = state.players[state.toMove];
  switch (m.type) {
    case 'attachEnergy':
      return `Attach ${me.pendingEnergy ?? 'energy'} to ${m.target === 'active' ? me.active?.card.name ?? 'active' : `bench ${me.bench[m.target]?.card.name ?? m.target}`}`;
    case 'playBasic':
      return `Play ${me.hand[m.handIndex]?.name ?? '?'} to bench`;
    case 'evolve':
      return `Evolve into ${me.hand[m.handIndex]?.name ?? '?'} (${m.target === 'active' ? 'active' : `bench ${m.target}`})`;
    case 'retreat':
      return `Retreat ${me.active?.card.name ?? 'active'} -> ${me.bench[m.benchIndex]?.card.name ?? m.benchIndex}`;
    case 'playTrainer':
      return `Play ${me.hand[m.handIndex]?.name ?? 'trainer'}`;
    case 'attack':
      return `Attack: ${me.active?.card.attacks[m.attackIndex]?.name ?? '?'}`;
    case 'endTurn':
      return 'End turn';
  }
}

const COND_LABEL: Record<Condition, string> = {
  asleep: 'puts it to sleep', paralyzed: 'paralyzes it', poisoned: 'poisons it', burned: 'burns it', confused: 'confuses it',
};

// What a move accomplishes, read off the before/after delta (not hardcoded per
// card): a KO and the points it scores, status it lands, energy it strips off
// the defender, and damage it heals on your own active.
export function moveAnnotation(state: GameState, m: Move): string {
  const me = state.toMove;
  const opp = (me ^ 1) as 0 | 1;
  let after: GameState;
  try { after = applyMove(state, m); } catch { return ''; }
  const parts: string[] = [];

  const ptsGain = after.players[me]!.points - state.players[me]!.points;
  const defBefore = state.players[opp]!.active;
  const defAfter = after.players[opp]!.active;
  if (ptsGain > 0 && defBefore) {
    parts.push(`KOs ${defBefore.card.name} (+${ptsGain} pt${ptsGain > 1 ? 's' : ''})`);
  } else if (defBefore && defAfter && defBefore.card.id === defAfter.card.id) {
    // The same defender survived: report what stuck to it.
    const dealt = Math.round(defAfter.damage - defBefore.damage);
    if (m.type === 'attack' && dealt > 0) parts.push(`deals ${dealt}`);
    for (const c of defAfter.conditions ?? []) {
      if (!(defBefore.conditions ?? []).includes(c)) parts.push(COND_LABEL[c]);
    }
    const stripped = defBefore.energy.length - defAfter.energy.length;
    if (stripped > 0) parts.push(`strips ${stripped} energy`);
  }

  const myBefore = state.players[me]!.active;
  const myAfter = after.players[me]!.active;
  if (myBefore && myAfter && myBefore.card.id === myAfter.card.id) {
    const healed = myBefore.damage - myAfter.damage;
    if (healed > 0) parts.push(`heals ${healed}`);
  }
  return parts.join(', ');
}

export function describeMove(state: GameState, m: Move): string {
  const label = baseLabel(state, m);
  const note = moveAnnotation(state, m);
  return note ? `${label} (${note})` : label;
}

export interface BestLineSummary {
  move: Move;          // the recommended first move
  plan: Move[];        // the full planned turn
  pointSwing: number;  // points you gain this turn
  kos: boolean;        // does the line knock something out
  survivesReply: boolean; // does your active live through the opponent's best reply
  myPoints: number;    // your points after the line
  oppPoints: number;   // opponent points after their reply
  won: boolean;        // the line reaches game point (>=3)
  text: string;        // one-line plain-language verdict
}

// Simulate the recommended line and the opponent's best reply into a plain
// verdict: what it scores, whether your active survives, and the resulting
// standing.  Reuses the same 2-ply the ranking is built on.
export function summarizeBestLine(state: GameState, recs: Recommendation[] = recommend(state)): BestLineSummary | null {
  const best = recs[0];
  if (!best) return null;
  const me = state.toMove;
  const opp = (me ^ 1) as 0 | 1;

  let s = state;
  for (const mv of best.plan) s = applyMove(s, mv);
  if (s.toMove === me) s = applyMove(s, { type: 'endTurn' }); // make sure the turn passed
  const pointSwing = s.players[me]!.points - state.players[me]!.points;
  const myPoints = s.players[me]!.points;
  const won = myPoints >= 3;

  const reply = bestReplyState(s, me);
  const oppPoints = reply.players[opp]!.points;
  const survivesReply = oppPoints === s.players[opp]!.points; // opponent scored nothing on the reply

  const bits: string[] = [describeMove(state, best.move)];
  if (won) bits.push('wins the game');
  else if (pointSwing > 0) bits.push(`takes ${pointSwing} point${pointSwing > 1 ? 's' : ''}`);
  if (!won) bits.push(survivesReply ? 'your active survives the reply' : 'but your active falls to the reply');
  const standing = myPoints === oppPoints ? `tied ${myPoints}-${oppPoints}`
    : myPoints > oppPoints ? `you lead ${myPoints}-${oppPoints}` : `you trail ${myPoints}-${oppPoints}`;
  bits.push(standing);

  return { move: best.move, plan: best.plan, pointSwing, kos: pointSwing > 0, survivesReply, myPoints, oppPoints, won, text: bits.join('; ') };
}
