# Pocket Pilot

A move-optimizer engine for **Pokemon TCG Pocket**.  Given a live board state,
it ranks the legal plays by win-equity, reasoning over the game's randomness
(coin flips, random energy generation) and its win condition (first to 3 points;
KOing a Pokemon *ex* is worth 2).

This is a game engine in the same spirit as a chess engine, but for an
imperfect-information card game: enumerate the legal actions for the turn, search
the action sequences (setup plays then an attack), and score the resulting
positions with a heuristic evaluator.

## Status: v0.2 (engine core + real card data)

Working:

- **Real card data** (`src/data.ts`, `data/ptcgp-cards.json`): all 2759 cards
  (2520 Pokemon + 239 trainers) vendored from
  `hugoburguete/pokemon-tcg-pocket-card-database`, mapped to the engine model.
  That dataset has no attack effect text, so conditional ("40+") and scaling
  ("30x") damage is parsed as a base floor + a `variable` flag, and a small
  hand-curated `COIN_OVERRIDES` table restores real coin-flip riders (e.g.
  Marowak ex Bonemerang) so the probability modeling stays intact.

- Domain model (`src/types.ts`): energy, cards, in-play Pokemon, both players.
- Rules (`src/rules.ts`): legal-move generation (attach energy, play/evolve,
  retreat, attack, pass), Colorless-as-wildcard cost matching, and expected
  damage (coin-flip EV + Pocket weakness).
- Evaluator (`src/evaluate.ts`): points-first heuristic over board HP, active
  pressure, energy tempo, and board presence.
- Recommender (`src/recommend.ts`): bounded full-turn search that ranks each
  first move by the best turn-equity reachable after it.
- A small hand-entered seed of real cards (`src/cards.ts`).

## Try it

```bash
npm install
npm run demo       # ranked plays for a sample live situation
npm run test       # engine assertions
npm run typecheck
```

The demo shows the engine discovering that "attach Fire, then Crimson Storm"
(KO an opposing ex for 2 points) beats attacking immediately.

## Roadmap (next loop iterations)

1. Done: real card dataset integrated (see Status). Next data step: enrich
   attack effect text (the `+`/`x` riders and abilities) from a fuller source.
2. Model the opponent's reply (2-ply: my best turn vs their best response) and
   special conditions (sleep/paralysis/poison) and ability/trainer effects.
3. Board-dependent attacks (e.g. Pikachu ex scaling per benched Lightning).
4. Imperfect-information search: determinize the hidden hand/deck and run
   ISMCTS instead of the heuristic 1-turn lookahead.
5. A web UI for entering a live situation and reading the recommendation.
