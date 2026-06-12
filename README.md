# Pocket Pilot

A move-optimizer engine for **Pokemon TCG Pocket**.  Given a live board state,
it ranks the legal plays by win-equity, reasoning over the game's randomness
(coin flips, random energy generation) and its win condition (first to 3 points;
KOing a Pokemon *ex* is worth 2).

This is a game engine in the same spirit as a chess engine, but for an
imperfect-information card game: enumerate the legal actions for the turn, search
the action sequences (setup plays then an attack), and score the resulting
positions with a heuristic evaluator.

## Status: v0.8 (engine + 2-ply defense + scaling + conditions + trainers + web app)

Models special conditions (asleep/paralyzed lock the active; poison/burn tick at
the checkup; confusion halves attacks) and a small registry of combat-relevant
trainers (`src/trainers.ts`: Giovanni +10, Sabrina switch, Potion heal, X Speed,
Professor's Research), with the one-Supporter-per-turn rule. The web UI takes
per-Pokemon damage + conditions and your hand, so `playTrainer` lines surface in
the recommendations.

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
  damage (coin-flip EV + Pocket weakness + board-dependent scaling via
  `src/effects.ts`, e.g. Pikachu ex Circle Circuit = 30 x benched Lightning).
- Evaluator (`src/evaluate.ts`): points-first heuristic over board HP, active
  pressure, energy tempo, and board presence.
- Recommender (`src/recommend.ts`): **2-ply** search. It plans my full turn and
  scores each line by my equity AFTER the opponent's best reply, so it plays
  defensively (e.g. retreats a threatened ex rather than hanging it to a lethal
  2-point KO) instead of greedily maximizing this turn's board.
- **Web app** (`web/`, Vite): the engine is browser-runnable. The pure card
  adapter (`src/card-index.ts`) is split from the node-only `fs` loader
  (`src/data.ts`) so the browser builds the same card index from a bundled JSON
  import. `web/main.ts` runs `recommend()` client-side and renders the ranked
  plays + best line. Interactive board-entry is the next iteration.

## Try it

```bash
npm install
npm run demo       # CLI: ranked plays for a sample live situation
npm run test       # engine assertions
npm run typecheck
npm run web:dev     # web app at http://localhost:5173
npm run web:build   # production build into dist-web/
```

The demo shows the engine discovering that "attach Fire, then Crimson Storm"
(KO an opposing ex for 2 points) beats attacking immediately.

## Roadmap (next loop iterations)

1. Done: real card dataset integrated (see Status). Next data step: enrich
   attack effect text (the `+`/`x` riders and abilities) from a fuller source.
2. Done: 2-ply opponent-reply modeling (see Status). Next: special conditions
   (sleep/paralysis/poison) and ability/trainer effects.
3. Board-dependent attacks (e.g. Pikachu ex scaling per benched Lightning).
4. Imperfect-information search: determinize the hidden hand/deck and run
   ISMCTS instead of the heuristic 1-turn lookahead.
5. A web UI for entering a live situation and reading the recommendation.
