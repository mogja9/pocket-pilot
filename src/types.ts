// Core domain model for Pokemon TCG Pocket.
//
// Scope of this v0: enough of the rules to reason about the most common live
// decision -- "what should I do on my turn" -- under the game's randomness.
// Deliberately simplified (no full trainer-card catalog, no special conditions
// beyond a flag, single-attack lookahead) but structured so each piece can grow.

export type EnergyType =
  | 'Grass' | 'Fire' | 'Water' | 'Lightning' | 'Psychic'
  | 'Fighting' | 'Darkness' | 'Metal' | 'Dragon' | 'Colorless';

// Energy that actually exists on a Pokemon / in the Energy Zone is always a
// concrete element; `Colorless` only appears in attack/retreat COSTS as "any".
export type ConcreteEnergy = Exclude<EnergyType, 'Colorless' | 'Dragon'>;

export type Stage = 'Basic' | 'Stage1' | 'Stage2';

export interface CoinFlipEffect {
  // Extra damage applied per heads (e.g. "flip 2 coins, +30 per heads").
  flips: number;
  damagePerHeads: number;
  // Probability the attack's base damage lands at all (e.g. "if tails, this
  // attack does nothing" -> 0.5).  Undefined means the base always lands.
  successProbability?: number;
}

// Energy an attack discards as part of resolving: from the attacker itself
// (a cost, e.g. Crimson Storm) or from the defender (strips their energy).
export interface EnergyDiscard {
  target: 'self' | 'defender';
  amount: number | 'all';
  type?: ConcreteEnergy; // a specific colour to remove; undefined = any
}

// Flat damage an attack spreads onto the opponent's other Pokemon (snipe / bench
// damage), separate from and on top of its main hit on the Active.  Bypasses
// weakness in Pocket, so it is applied flat.
export interface SplashDamage {
  amount: number;
  targets: number | 'all'; // how many opponent Pokemon (snipe count) or every one
  benchOnly: boolean;       // restrict to the opponent's bench
}

// A board "counter": a quantity read off the live game state that an attack's
// damage scales with ("... for each X").  expectedDamage adds perUnit * count.
export type ScaleCounter =
  | { kind: 'energyOnDefender' }                  // Energy attached to opp's Active
  | { kind: 'energyOnAllDefenderPokemon' }        // Energy on ALL of opp's Pokemon
  | { kind: 'energyOnSelf'; energyType?: ConcreteEnergy } // [E] / any Energy on this
  | { kind: 'energyTypesOnSelf' }                 // distinct types of Energy on this
  | { kind: 'myBench'; energyType?: ConcreteEnergy; evolutionOnly?: boolean } // your Benched (of a type / Evolutions)
  | { kind: 'oppBench' }                          // opponent's Benched
  | { kind: 'allBench' }                          // both Benches
  | { kind: 'defenderRetreatCost' }              // Energy in opp Active's Retreat Cost
  | { kind: 'myPoints' };                        // points you have gotten

// "This attack does N (more) damage for each X."  `replacesBase` is true for the
// "N damage for each" wording (the attack's flat base is 0, the damage IS the
// scaling); false for "N more damage for each" (the flat base is kept and this
// adds on top).
export interface ScalingRider {
  perUnit: number;
  counter: ScaleCounter;
  replacesBase: boolean;
}

// A boolean board predicate; when true the attack does `bonus` more damage
// ("If <predicate>, this attack does N more damage.").
export type DamagePredicate =
  | { kind: 'defenderIsEx' }
  | { kind: 'defenderHasDamage' }
  | { kind: 'selfHasDamage' }
  | { kind: 'selfNoDamage' }
  | { kind: 'defenderHasCondition'; condition?: Condition } // a specific condition, or any (undefined)
  | { kind: 'supporterPlayedThisTurn' }
  | { kind: 'defenderIsStage'; stage: 'Basic' | 'Evolution' }
  | { kind: 'defenderHasAbility' }
  | { kind: 'selfHasEnergyType'; energyType: ConcreteEnergy }
  | { kind: 'selfExtraEnergy'; energyType: ConcreteEnergy; threshold: number } // >= N [E] beyond the attack's cost
  | { kind: 'selfHpAtMost'; value: number }
  | { kind: 'defenderMoreHp' };                  // opp Active has more remaining HP than this

export interface ConditionalDamage {
  bonus: number;
  predicate: DamagePredicate;
}

export interface Attack {
  name: string;
  cost: EnergyType[];      // e.g. ['Fire','Fire','Colorless']
  damage: number;          // base damage before weakness / coin flips
  coin?: CoinFlipEffect;   // optional coin-flip rider
  variable?: boolean;      // damage string had a + or x (conditional/scaling); base is a floor
  scaling?: ScalingRider;  // board-dependent "N (more) damage for each X" damage
  conditional?: ConditionalDamage[]; // "If <board predicate>, this attack does N more damage"
  inflicts?: Condition[];  // special conditions this attack puts on the defender (guaranteed)
  discards?: EnergyDiscard[]; // energy this attack discards (from self and/or the defender)
  heal?: { amount: number; scope: 'self' | 'team' }; // damage healed off your side
  splash?: SplashDamage;   // snipe / bench / spread damage on top of the main hit
  coinInflict?: Condition[]; // conditions inflicted on the defender on a coin heads (50%)
  text?: string;
}

export interface PokemonCard {
  id: string;
  name: string;
  kind: 'Pokemon';
  type: EnergyType;        // element (may be Colorless or Dragon)
  hp: number;
  stage: Stage;
  evolvesFrom?: string;    // name of the pre-evolution
  isEx: boolean;           // ex Pokemon give the opponent 2 points when KO'd
  retreatCost: number;     // number of any energy to retreat
  weakness?: ConcreteEnergy; // +20 damage from this type in Pocket
  attacks: Attack[];
  ability?: { name: string; text: string }; // passive/activated ability (text only for now)
}

// A minimal trainer model; effects are resolved by id in rules.ts.
export interface TrainerCard {
  id: string;
  name: string;
  kind: 'Item' | 'Supporter' | 'Stadium';
  text?: string;
}

export type Card = PokemonCard | TrainerCard;

// Special conditions.  asleep/paralyzed lock the active out of attacking and
// retreating; poisoned/burned tick damage between turns; confused makes an
// attack a coin flip.  They can co-exist (e.g. poisoned AND asleep).
export type Condition = 'asleep' | 'paralyzed' | 'poisoned' | 'burned' | 'confused';

// An instance of a Pokemon in play (active or benched).
export interface InPlay {
  card: PokemonCard;
  energy: ConcreteEnergy[];  // attached energy
  damage: number;            // damage taken (KO when damage >= hp)
  turnPlayedOrEvolved: number; // for evolution / summoning-sickness timing
  conditions?: Condition[];  // special conditions (undefined = none)
  // Transient: conditions a just-resolved attack MIGHT inflict on this Pokemon on
  // a coin heads.  Set by applyMove (not yet a real condition); the 2-ply reply
  // (recommend.ts) blends over the 50% rather than committing in a single state.
  pendingCoinConditions?: Condition[];
  abilityUsedThisTurn?: boolean; // an activated ability is once per turn per Pokemon
}

export interface PlayerState {
  name: string;
  active: InPlay | null;
  bench: InPlay[];           // up to 3
  hand: Card[];
  deckCount: number;         // we usually don't know exact order; track size
  discardCount: number;
  points: number;            // first to 3 wins
  energyZone: ConcreteEnergy[];   // the (up to 3) registered energy types
  pendingEnergy: ConcreteEnergy | null; // energy generated this turn, not yet attached
  energyAttachedThisTurn: boolean;
  // Per-turn trainer state / modifiers (undefined = 0 / false):
  supporterUsedThisTurn?: boolean; // at most one Supporter per turn
  stadiumPlayedThisTurn?: boolean; // at most one Stadium played per turn
  attackBonus?: number;            // +damage to this player's attacks this turn (Giovanni)
  attackBonusVsEx?: number;        // +damage but only when the defender is an ex (Red)
  retreatReduction?: number;       // reduced retreat cost this turn (X Speed / Leaf)
}

export interface GameState {
  players: [PlayerState, PlayerState];
  toMove: 0 | 1;             // index of the player whose turn it is (the one we advise)
  turn: number;             // 1-based; turn 1 = first player's first turn
  isFirstPlayerFirstTurn: boolean; // no energy generated, no attack allowed for some setups
  stadium?: string | null;  // the Stadium card in play (shared by both players), by name
}

export const BENCH_SIZE = 3;
export const POINTS_TO_WIN = 3;
export const WEAKNESS_BONUS = 20;
