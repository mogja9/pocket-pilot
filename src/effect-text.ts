// Derive STRUCTURED riders from an attack's effect text so the damage model can
// reason about them, instead of hand-curating a per-card table.  This file owns
// the (deliberately conservative) text -> rider mapping; it only claims a match
// when the wording is one of the regular, unambiguous Pokemon-Pocket templates.
//
// Today it covers coin-flip DAMAGE riders (the largest, most regular family).
// Status / energy / heal / draw riders are future work; unmatched text is left
// for display only, never guessed at.
import type { CoinFlipEffect } from './types.js';

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
];

export function coinRiderFromText(text: string | undefined): CoinRider | null {
  if (!text) return null;
  for (const { re, build } of PATTERNS) {
    const m = re.exec(text);
    if (m) return build(m);
  }
  return null;
}
