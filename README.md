# Pocket Pilot

A move-optimizer engine for **Pokemon TCG Pocket**. Given a live board state, it
ranks the legal plays by win-equity, reasoning over the game's randomness (coin
flips, random energy generation) and its win condition (first to 3 points; KOing
a Pokemon *ex* is worth 2).

This is a game engine in the spirit of a chess engine, but for an
imperfect-information card game: enumerate the legal actions for the turn, search
the action sequences (setup plays, abilities, then an attack), and score the
resulting positions with a heuristic evaluator, looking one reply deep so it
plays defensively.

## Card data

`data/ptcgp-cards.json` is the full pool of **3406 cards** across all 20 sets
including every promo, scraped from `pocket.limitlesstcg.com` (the de-facto
competitive database; same org whose CDN serves the card art, so ids line up
1:1). It carries real **attack and ability effect text**, which the engine
parses into structured behavior. Regenerate with `npm run build:data` (runs
`scripts/scrape-limitless.mjs`).

## What the engine models

Effect text is parsed into structured riders (`src/effect-text.ts`), applied in
`src/rules.ts`. Deliberately conservative: only the guaranteed (standalone,
capitalized) wordings are committed to in the deterministic `applyMove`;
coin-gated wordings are valued by expected value in the search instead.

- **Damage**: coin-flip EV (multi-coin per-heads, flip-until-tails, and "if
  tails nothing" via a `successProbability`), Pocket weakness (+20),
  board-dependent scaling (`src/effects.ts`, e.g. Pikachu ex Circle Circuit = 30
  x benched Lightning), the Giovanni flat boost, and Red's +20 vs ex.
- **Status** (137 attacks): Poisoned / Asleep / Paralyzed / Burned / Confused
  applied to the defender; **coin-gated** "if heads, ... Paralyzed/Asleep" (39)
  is valued as a 0.5 EV blend in the 2-ply reply (a slept/paralyzed attacker
  often cannot strike back).
- **Energy discard** (134 self, 12 defender): a self-cost, or stripping the
  defender so its reply may become unaffordable.
- **Heal / drain** (46 self, 6 team).
- **Snipe / spread** (140): "N damage to 1 / each of your opponent's [Benched]
  Pokemon"; `resolveKO` scores benched knockouts, so finishing a damaged benched
  ex is seen and valued.
- **Trainers** (`src/trainers.ts`, 10): Potion, X Speed, Giovanni, Sabrina,
  Professor's Research, Cyrus (pull a damaged benched foe up), Red (+20 vs ex),
  Leaf (retreat -2), Dawn (energy bench to active), Erika (heal a Grass Pokemon).
- **Abilities** (`src/abilities.ts`): 9 **activated** once-per-turn abilities via
  a `useAbility` move that does not end the turn (Greninja Water Shuriken snipe,
  Gardevoir Psy Shadow and Magneton Volt Charge energy accel, Butterfree Powder
  Heal, Weezing Gas Leak, Pidgeot Drive Off and Victreebel Fragrance Trap switch
  disruption, Wigglytuff Comforting Song heal, Hypno Sleep Pendulum), and 4
  **passive** abilities (Hard Coat / Shell Armor damage reduction in
  `expectedDamage`, Fluffy Flight / Levitate free retreat).

## Search and output

- **2-ply defensive search** (`src/recommend.ts`): plans my full turn and scores
  each line by my equity AFTER the opponent's best reply, so it retreats a
  threatened ex rather than hanging it to a lethal 2-point KO.
- **Plain-language output**: `describeMove` annotates each play from the
  before/after delta ("KOs Pikachu ex (+2 pts)", "puts it to sleep", "strips 1
  energy", "heals 30"). `summarizeBestLine` returns a verdict (point swing, KO,
  survives-reply, standing, one-line text) and the opponent's predicted reply.

## Web app (`web/`, Vite)

A visual battle board. Search a Pokemon and drag it onto a slot (HTML5 drag on
desktop, **touch drag** on mobile, or tap-to-place), set each Pokemon's energy /
damage / conditions, set the **opponent's Energy Zone** (so the threat uses the
energy they actually run), add the cards in **your hand** (trainers surface as
plays), and read live recommendations: a color-coded verdict chip, the
opponent's likely reply, the best line, and the ranked plays. The selected card
shows a detail panel (`web/card-view.ts`) with its effect text, ability, and
color-coded rider tag chips. State persists in localStorage. All DOM is built
through a tiny `el()` helper that text-node-appends card strings, so card text is
never interpreted as HTML.

The engine is browser-runnable because the pure card adapter
(`src/card-index.ts`) is split from the node-only `fs` loader (`src/data.ts`).

## Try it

```bash
npm install
npm run demo        # CLI: verdict + ranked plays for a sample live situation
npm run test        # engine + scenario + self-play + DOM + app-render assertions
npm run typecheck
npm run web:dev      # web app at http://localhost:5173
npm run web:build    # production build into dist-web/
npm run build:data   # re-scrape the card dataset from Limitless
```

Tests are layered: `src/engine.test.ts` (mechanics), `src/scenarios.test.ts`
(decision quality: a table of tactical positions asserting the top pick),
`src/selfplay.test.ts` (the engine plays both sides to a finish, incl. a mirror,
to catch multi-turn stalls), and `web/dom.test.ts` + `web/app.smoke.ts`.

## What is approximated

- Coin-gated abilities (Sleep Pendulum) are valued by EV, not resolved.
- "Opponent chooses" switches (Sabrina, Cyrus, Drive Off) promote the first /
  most-relevant benched Pokemon rather than searching the opponent's choice.
- "1 less" retreat passives and Pokemon Tools are not modeled yet.
- The opponent's hand and deck are hidden, so the reply assumes only what is on
  the board plus one generated energy.

## Remaining gaps

- **Evaluator tuning.** The evaluator is a points-first heuristic. There is an
  A/B tournament harness (`src/tournament.ts`, `runTournament` over
  `diverseBoards()`), but full-game self-play turns out to be insensitive to
  small weight tweaks: the points-dominated KO race decides games, so a small
  heuristic term rarely changes a winner (a KO-proximity term changed 0 of 24
  games even when scaled up). The sensitive instrument for eval quality is the
  decision-scenario suite, which the current eval passes; meaningfully advancing
  the evaluator would need larger structural changes measured against it.
- **Long-tail coverage.** More trainers and abilities can be added to their
  registries as needed; the highest-impact ones are in.
- **Imperfect information.** A determinized ISMCTS over the hidden hand/deck
  would replace the heuristic single-turn lookahead.
