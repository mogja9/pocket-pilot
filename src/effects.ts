import type {
  InPlay, PlayerState, Attack, ScaleCounter, DamagePredicate,
} from './types.js';

// Board-dependent attack damage.
//
// Most variable attacks ("N (more) damage for each X", "If <predicate>, N more
// damage") are now derived GENERICALLY from the dataset's effect text into the
// Attack's `scaling` / `conditional` riders (see effect-text.ts); this module
// resolves those riders against the live board.  The hardcoded SCALING registry
// below remains only as an override hook for the rare attack whose wording the
// text parser can't safely template (empty today -- e.g. Pikachu ex Circle
// Circuit is handled by the generic path now).

export interface ScaleCtx {
  attacker: InPlay;
  defender: InPlay;
  me: PlayerState;   // the attacking player (their bench, energy, etc.)
  opp: PlayerState;  // the defending player
}
export type ScaleFn = (ctx: ScaleCtx) => number;

export const SCALING: Record<string, ScaleFn> = {};

export function scalingFor(cardName: string, attackName: string): ScaleFn | undefined {
  return SCALING[`${cardName}::${attackName}`];
}

function energyTotal(p: PlayerState): number {
  let n = 0;
  for (const ip of [p.active, ...p.bench]) if (ip) n += ip.energy.length;
  return n;
}

// How many units a scaling counter is worth on the live board.  Damage added is
// the rider's perUnit times this count.
export function resolveCounter(counter: ScaleCounter, ctx: ScaleCtx): number {
  const { attacker, defender, me, opp } = ctx;
  switch (counter.kind) {
    case 'energyOnDefender': return defender.energy.length;
    case 'energyOnAllDefenderPokemon': return energyTotal(opp);
    case 'energyOnSelf':
      return counter.energyType ? attacker.energy.filter((e) => e === counter.energyType).length : attacker.energy.length;
    case 'energyTypesOnSelf': return new Set(attacker.energy).size;
    case 'myBench': {
      let pool = me.bench;
      if (counter.energyType) pool = pool.filter((ip) => ip.card.type === counter.energyType);
      if (counter.evolutionOnly) pool = pool.filter((ip) => ip.card.stage !== 'Basic');
      return pool.length;
    }
    case 'oppBench': return opp.bench.length;
    case 'allBench': return me.bench.length + opp.bench.length;
    case 'defenderRetreatCost': return defender.card.retreatCost;
    case 'myPoints': return me.points;
  }
}

// Does the board satisfy a conditional-damage predicate?  `attack` is needed for
// "extra energy" predicates (how much beyond the attack's own cost is attached).
export function resolvePredicate(pred: DamagePredicate, ctx: ScaleCtx, attack: Attack): boolean {
  const { attacker, defender, me } = ctx;
  const remHp = (ip: InPlay) => ip.card.hp - ip.damage;
  switch (pred.kind) {
    case 'defenderIsEx': return defender.card.isEx;
    case 'defenderHasDamage': return defender.damage > 0;
    case 'selfHasDamage': return attacker.damage > 0;
    case 'selfNoDamage': return attacker.damage === 0;
    case 'defenderHasCondition': {
      const cs = defender.conditions ?? [];
      return pred.condition ? cs.includes(pred.condition) : cs.length > 0;
    }
    case 'supporterPlayedThisTurn': return !!me.supporterUsedThisTurn;
    case 'defenderIsStage':
      return pred.stage === 'Basic' ? defender.card.stage === 'Basic' : defender.card.stage !== 'Basic';
    case 'defenderHasAbility': return !!defender.card.ability;
    case 'selfHasEnergyType': return attacker.energy.includes(pred.energyType);
    case 'selfExtraEnergy': {
      const need = attack.cost.filter((c) => c === pred.energyType).length;
      const have = attacker.energy.filter((e) => e === pred.energyType).length;
      return have >= need + pred.threshold;
    }
    case 'selfHpAtMost': return remHp(attacker) <= pred.value;
    case 'defenderMoreHp': return remHp(defender) > remHp(attacker);
  }
}
