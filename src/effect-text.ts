// Derive STRUCTURED riders from an attack's effect text so the damage model can
// reason about them, instead of hand-curating a per-card table.  This file owns
// the (deliberately conservative) text -> rider mapping; it only claims a match
// when the wording is one of the regular, unambiguous Pokemon-Pocket templates.
//
// Today it covers coin-flip DAMAGE riders (the largest, most regular family).
// Status / energy / heal / draw riders are future work; unmatched text is left
// for display only, never guessed at.
import type {
  CoinFlipEffect, Condition, ConcreteEnergy, EnergyDiscard, SplashDamage,
  ScalingRider, ScaleCounter, ConditionalDamage, DamagePredicate,
} from './types.js';

export interface CoinRider extends CoinFlipEffect {
  // When true the dataset's flat damage number is really the per-heads value
  // (e.g. "50x" = "50 damage for each heads"), so the attack's base is 0.
  zeroBase: boolean;
}

// "Flip a coin until you get tails" has expected heads = 1, identical in
// expectation to flipping exactly 2 coins (2 * 0.5 = 1).  We model it that way
// so the existing flips*0.5*perHeads EV stays exact.
const UNTIL_TAILS_FLIPS = 2;

// Patterns are checked in order; each captures the per-heads damage from the
// TEXT (authoritative) rather than the dataset's "Nx"/"N+" string.
const PATTERNS: { re: RegExp; build: (m: RegExpMatchArray) => CoinRider }[] = [
  // "Flip N coins. This attack does D more damage for each heads."  (base kept)
  { re: /Flip (\d+) coins?\. This attack does (\d+) more damage for each heads\./,
    build: (m) => ({ flips: Number(m[1]), damagePerHeads: Number(m[2]), zeroBase: false }) },
  // "Flip N coins. This attack does D damage for each heads."  (base is per-heads)
  { re: /Flip (\d+) coins?\. This attack does (\d+) damage for each heads\./,
    build: (m) => ({ flips: Number(m[1]), damagePerHeads: Number(m[2]), zeroBase: true }) },
  // "Flip a coin until you get tails. This attack does D more damage for each heads."
  { re: /Flip a coin until you get tails\. This attack does (\d+) more damage for each heads\./,
    build: (m) => ({ flips: UNTIL_TAILS_FLIPS, damagePerHeads: Number(m[1]), zeroBase: false }) },
  // "Flip a coin until you get tails. This attack does D damage for each heads."
  { re: /Flip a coin until you get tails\. This attack does (\d+) damage for each heads\./,
    build: (m) => ({ flips: UNTIL_TAILS_FLIPS, damagePerHeads: Number(m[1]), zeroBase: true }) },
  // "Flip a coin. If heads, this attack does D more damage."  (base kept, +D on heads)
  { re: /Flip a coin\. If heads, this attack does (\d+) more damage/,
    build: (m) => ({ flips: 1, damagePerHeads: Number(m[1]), zeroBase: false }) },
  // "Flip a coin. If tails, this attack does nothing."  (base lands only on heads)
  { re: /Flip a coin\. If tails, this attack does nothing\./,
    build: () => ({ flips: 0, damagePerHeads: 0, zeroBase: false, successProbability: 0.5 }) },
];

export function coinRiderFromText(text: string | undefined): CoinRider | null {
  if (!text) return null;
  for (const { re, build } of PATTERNS) {
    const m = re.exec(text);
    if (m) return build(m);
  }
  return null;
}

const STATUS_WORD: Record<string, Condition> = {
  Asleep: 'asleep', Paralyzed: 'paralyzed', Poisoned: 'poisoned', Burned: 'burned', Confused: 'confused',
};

// Special conditions an attack UNCONDITIONALLY inflicts on the opponent's active.
// The standalone sentence capitalizes "Your" ("Your opponent's Active Pokemon is
// now Poisoned and Asleep."); coin-gated wordings use lowercase "your" after "If
// heads," and are deliberately NOT matched here (applyMove is deterministic, so
// we only commit to guaranteed effects).
function parseStatusWords(phrase: string): Condition[] {
  const out: Condition[] = [];
  for (const word of phrase.split(/\s+and\s+/)) {
    const cond = STATUS_WORD[word.trim()];
    if (cond && !out.includes(cond)) out.push(cond);
  }
  return out;
}

export function defenderConditionsFromText(text: string | undefined): Condition[] {
  if (!text) return [];
  const m = /(?:^|\.\s+)Your opponent's Active Pok[eé]mon is now ([A-Za-z ]+?)\./.exec(text);
  return m ? parseStatusWords(m[1]!) : [];
}

// The coin-gated counterpart: "Flip a coin. If heads, your opponent's Active
// Pokemon is now Paralyzed/Asleep/...".  Distinguished from the guaranteed form
// by the lowercase "your" after "If heads,".  Lands only 50% of the time, so the
// engine blends rather than applying it (see recommend.ts).
export function coinInflictFromText(text: string | undefined): Condition[] {
  if (!text) return [];
  const m = /If heads, your opponent's Active Pok[eé]mon is now ([A-Za-z ]+?)\./.exec(text);
  return m ? parseStatusWords(m[1]!) : [];
}

const ENERGY_LETTER: Record<string, ConcreteEnergy> = {
  G: 'Grass', R: 'Fire', W: 'Water', L: 'Lightning', P: 'Psychic', F: 'Fighting', D: 'Darkness', M: 'Metal',
};

// Energy an attack GUARANTEES it discards.  As with status, only the standalone
// capital "Discard ..." sentences are committed to; coin-gated "If heads,
// discard ..." (lowercase) is left unmodeled for the deterministic applyMove.
export function energyDiscardsFromText(text: string | undefined): EnergyDiscard[] {
  if (!text) return [];
  const out: EnergyDiscard[] = [];
  const re = /(?:^|\.\s+)Discard (.*?) Energy from (this Pok[eé]mon|your opponent's Active Pok[eé]mon)/g;
  for (const m of text.matchAll(re)) {
    const desc = m[1]!;
    const target: EnergyDiscard['target'] = m[2]!.startsWith('this') ? 'self' : 'defender';
    const syms = [...desc.matchAll(/\[([A-Z])\]/g)].map((s) => ENERGY_LETTER[s[1]!]).filter((x): x is ConcreteEnergy => !!x);
    const types = [...new Set(syms)];
    const type = types.length === 1 ? types[0] : undefined; // only a single, unambiguous colour
    let amount: number | 'all';
    if (/\ball\b/.test(desc)) amount = 'all';
    else {
      const num = /(\d+)/.exec(desc);
      amount = num ? Number(num[1]) : Math.max(1, syms.length); // "a"/"an" -> 1; symbol list -> its length
    }
    out.push({ target, amount, ...(type ? { type } : {}) });
  }
  return out;
}

// Damage an attack GUARANTEES it heals off your own side: "this Pokemon" (the
// attacker) or "each of your Pokemon" (the whole board).  Capital "Heal" only,
// so coin-gated heals stay unmodeled.  Player-choice heals ("N of your Pokemon")
// are left out -- we can't know the target.
export function healFromText(text: string | undefined): { amount: number; scope: 'self' | 'team' } | null {
  if (!text) return null;
  const self = /(?:^|\.\s+)Heal (\d+) damage from this Pok[eé]mon\./.exec(text);
  if (self) return { amount: Number(self[1]), scope: 'self' };
  const team = /(?:^|\.\s+)Heal (\d+) damage from each of your Pok[eé]mon\./.exec(text);
  if (team) return { amount: Number(team[1]), scope: 'team' };
  return null;
}

// Flat damage spread onto the opponent's other Pokemon: "does N damage to 1 of
// your opponent's [Benched] Pokemon" (snipe) or "to each of your opponent's
// [Benched] Pokemon" (spread).  Separate from and on top of the attack's main
// hit; bypasses weakness (applied flat).
export function splashFromText(text: string | undefined): SplashDamage | null {
  if (!text) return null;
  const m = /(\d+) damage to (\d+|each) of your opponent's (Benched )?Pok[eé]mon/.exec(text);
  if (!m) return null;
  return {
    amount: Number(m[1]),
    targets: m[2] === 'each' ? 'all' : Number(m[2]),
    benchOnly: !!m[3],
  };
}

// Board-dependent damage scaling: "This attack does N (more) damage for each X."
// Maps the "for each X" tail to a structured ScaleCounter the engine can read off
// the live board.  Conservative: an unrecognised tail (incl. "for each heads",
// which is a coin rider handled above) returns null and the attack keeps its flat
// damage rather than being guessed at.
function counterFromTail(tail: string): ScaleCounter | null {
  // Most specific first (substrings overlap, e.g. "[W] Energy attached to this"
  // also contains "Energy attached to this").
  let m: RegExpMatchArray | null;
  if (/type of Energy attached to this Pok[eé]?mon/.test(tail)) return { kind: 'energyTypesOnSelf' };
  if ((m = /\[(\w)\] Energy attached to this Pok[eé]?mon/.exec(tail))) {
    const t = ENERGY_LETTER[m[1]!];
    return t ? { kind: 'energyOnSelf', energyType: t } : null;
  }
  if (/Energy attached to all of your opponent's Pok[eé]?mon/.test(tail)) return { kind: 'energyOnAllDefenderPokemon' };
  if (/Energy attached to your opponent's Active Pok[eé]?mon/.test(tail)) return { kind: 'energyOnDefender' };
  if (/Energy attached to this Pok[eé]?mon/.test(tail)) return { kind: 'energyOnSelf' };
  if (/Energy in your opponent's Active Pok[eé]?mon's Retreat Cost/.test(tail)) return { kind: 'defenderRetreatCost' };
  if (/Evolution Pok[eé]?mon on your Bench/.test(tail)) return { kind: 'myBench', evolutionOnly: true };
  if ((m = /of your Benched \[(\w)\] Pok[eé]?mon/.exec(tail))) {
    const t = ENERGY_LETTER[m[1]!];
    return t ? { kind: 'myBench', energyType: t } : null;
  }
  if (/of your Benched Pok[eé]?mon/.test(tail)) return { kind: 'myBench' };
  if (/of your opponent's Benched Pok[eé]?mon/.test(tail)) return { kind: 'oppBench' };
  if (/Benched Pok[eé]?mon \(both yours and your opponent's\)/.test(tail)) return { kind: 'allBench' };
  if (/point you have gotten/.test(tail)) return { kind: 'myPoints' };
  return null;
}

export function scalingFromText(text: string | undefined): ScalingRider | null {
  if (!text) return null;
  // "N more damage for each X" keeps the flat base; "N damage for each X" is the
  // whole damage (flat base 0).  The "more" form is checked first so its tail
  // isn't swallowed by the base-replacing pattern.
  const add = /does (\d+) more damage for each ([^.]+?)\./.exec(text);
  if (add) {
    const counter = counterFromTail(add[2]!);
    if (counter) return { perUnit: Number(add[1]), counter, replacesBase: false };
  }
  const rep = /does (\d+) damage for each ([^.]+?)\./.exec(text);
  if (rep) {
    const counter = counterFromTail(rep[2]!);
    if (counter) return { perUnit: Number(rep[1]), counter, replacesBase: true };
  }
  return null;
}

// Conditional damage: "If <predicate>, this attack does N more damage."  Maps the
// predicate clause to a board test.  Coin clauses ("If heads, ...") and predicates
// the board model can't evaluate (Pokemon Tools, deck/discard contents, turn
// history) return null and are left for display only.
function predicateFromPhrase(p: string): DamagePredicate | null {
  if (/heads/.test(p)) return null; // a coin rider, handled by coinRiderFromText
  let m: RegExpMatchArray | null;
  if (/your opponent's Active Pok[eé]?mon is a Pok[eé]?mon ex/.test(p)) return { kind: 'defenderIsEx' };
  if (/your opponent's Active Pok[eé]?mon has damage on it/.test(p)) return { kind: 'defenderHasDamage' };
  if (/this Pok[eé]?mon has no damage on it/.test(p)) return { kind: 'selfNoDamage' };
  if (/this Pok[eé]?mon has damage on it/.test(p)) return { kind: 'selfHasDamage' };
  if (/your opponent's Active Pok[eé]?mon is affected by a Special Condition/.test(p)) return { kind: 'defenderHasCondition' };
  if ((m = /your opponent's Active Pok[eé]?mon is (Asleep|Poisoned|Burned|Confused|Paralyzed)/.exec(p))) {
    return { kind: 'defenderHasCondition', condition: STATUS_WORD[m[1]!]! };
  }
  if (/you played a Supporter card from your hand during this turn/.test(p)) return { kind: 'supporterPlayedThisTurn' };
  if (/your opponent's Active Pok[eé]?mon is a Basic Pok[eé]?mon/i.test(p)) return { kind: 'defenderIsStage', stage: 'Basic' };
  if (/your opponent's Active Pok[eé]?mon is an Evolution Pok[eé]?mon/.test(p)) return { kind: 'defenderIsStage', stage: 'Evolution' };
  if (/your opponent's Active Pok[eé]?mon has an Ability/.test(p)) return { kind: 'defenderHasAbility' };
  if ((m = /this Pok[eé]?mon has at least (\d+) extra \[(\w)\] Energy attached/.exec(p))) {
    const t = ENERGY_LETTER[m[2]!];
    return t ? { kind: 'selfExtraEnergy', energyType: t, threshold: Number(m[1]) } : null;
  }
  if ((m = /this Pok[eé]?mon has any \[(\w)\] Energy attached/.exec(p))) {
    const t = ENERGY_LETTER[m[1]!];
    return t ? { kind: 'selfHasEnergyType', energyType: t } : null;
  }
  if ((m = /this Pok[eé]?mon's remaining HP is (\d+) or less/.exec(p))) return { kind: 'selfHpAtMost', value: Number(m[1]) };
  if (/your opponent's Active Pok[eé]?mon has more remaining HP than this Pok[eé]?mon/.test(p)) return { kind: 'defenderMoreHp' };
  return null;
}

export function conditionalsFromText(text: string | undefined): ConditionalDamage[] {
  if (!text) return [];
  const out: ConditionalDamage[] = [];
  for (const m of text.matchAll(/If ([^.]+?), this attack does (\d+) more damage/g)) {
    const predicate = predicateFromPhrase(m[1]!);
    if (predicate) out.push({ bonus: Number(m[2]), predicate });
  }
  return out;
}
