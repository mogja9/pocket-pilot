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
}

export interface Attack {
  name: string;
  cost: EnergyType[];      // e.g. ['Fire','Fire','Colorless']
  damage: number;          // base damage before weakness / coin flips
  coin?: CoinFlipEffect;   // optional coin-flip rider
  variable?: boolean;      // damage string had a + or x (conditional/scaling); base is a floor
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
}

// A minimal trainer model; effects are resolved by id in rules.ts.
export interface TrainerCard {
  id: string;
  name: string;
  kind: 'Item' | 'Supporter';
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
  attackBonus?: number;            // +damage to this player's attacks this turn (Giovanni)
  retreatReduction?: number;       // reduced retreat cost this turn (X Speed)
}

export interface GameState {
  players: [PlayerState, PlayerState];
  toMove: 0 | 1;             // index of the player whose turn it is (the one we advise)
  turn: number;             // 1-based; turn 1 = first player's first turn
  isFirstPlayerFirstTurn: boolean; // no energy generated, no attack allowed for some setups
}

export const BENCH_SIZE = 3;
export const POINTS_TO_WIN = 3;
export const WEAKNESS_BONUS = 20;
