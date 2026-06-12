# Pocket Pilot

A move-optimizer engine for **Pokemon TCG Pocket**. Given a live board state, it
ranks the legal plays by win-equity, reasoning over the game's randomness (coin
flips, random energy generation) and its win condition (first to 3 points; KOing
a Pokemon *ex* is worth 2).

This is a game engine in the spirit of a chess engine, but for an
imperfect-information card game: enumerate the legal actions for the turn, search
the action sequences (setup plays then an attack), and score the resulting
positions with a heuristic evaluator, looking one reply deep so it plays
defensively.

## What it does

- **Complete card data with effect text.** `data/ptcgp-cards.json` is the full
  pool of **3406 cards** (3129 Pokemon + 277 trainers) across all 20 sets
  including every promo, scraped from `pocket.limitlesstcg.com` (the de-facto
  competitive database; same org whose CDN serves the card art, so ids line up
  1:1). Crucially it carries real **attack and ability effect text**, which the
  engine parses into structured behavior. Regenerate with `npm run build:data`
  (runs `scripts/scrape-limitless.mjs`); the trimmed JSON is ~120 KB gzipped in
  the web bundle.

- **Effect text to structured riders** (`src/effect-text.ts`). Rather than
  hand-curating per card, the regular Pokemon-Pocket wordings are parsed into
  riders the model acts on. Deliberately conservative: only the guaranteed
  (standalone, capitalized) sentences are committed to; coin-gated "If heads,
  ..." wordings are left for display, never guessed at.
  - **Coin damage** (225 attacks): "Flip N coins ... D damage / more damage for
    each heads", "Flip a coin until you get tails ...", and "If tails, this
    attack does nothing" (a `successProbability`). Fed into the expected-damage
    EV in `src/rules.ts`.
  - **Status infliction** (137): "Your opponent's Active Pokemon is now
    Poisoned / Asleep / Paralyzed / Burned / Confused" (incl. combined). Applied
    to the defender in `applyMove`, so the 2-ply reply sees a slept/paralyzed
    attacker that cannot strike back, poison/burn that ticks, confusion that
    halves.
  - **Energy discard** (134 self, 12 defender): "Discard N [type] Energy from
    this Pokemon / your opponent's Active Pokemon". The defender variant strips
    energy so its reply may become unaffordable.
  - **Heal / drain** (46 self, 6 team): "Heal N damage from this Pokemon / each
    of your Pokemon".

- **Damage model** (`src/rules.ts`): coin-flip EV, Pocket weakness (+20), and
  board-dependent scaling via `src/effects.ts` (e.g. Pikachu ex Circle Circuit =
  30 x benched Lightning), plus a Giovanni-style flat boost.

- **2-ply defensive search** (`src/recommend.ts`): plans my full turn and scores
  each line by my equity AFTER the opponent's best reply, so it retreats a
  threatened ex rather than hanging it to a lethal 2-point KO instead of greedily
  maximizing this turn's board.

- **Plain-language output**: `describeMove` annotates each play from the
  before/after state delta ("KOs Pikachu ex (+2 pts)", "puts it to sleep",
  "strips 1 energy", "heals 30"). `summarizeBestLine` returns a verdict
  (`pointSwing`, `kos`, `survivesReply`, standing, one-line text) and the
  opponent's predicted reply, so the recommendation reads as an actionable call.

- **Trainers** (`src/trainers.ts`): a registry of combat-relevant trainers
  (Giovanni +10, Sabrina switch, Potion heal 20, X Speed retreat -1, Professor's
  Research draw), with the one-Supporter-per-turn rule.

- **Web app** (`web/`, Vite): a visual battle board. Search a Pokemon and drag it
  onto a slot (HTML5 drag on desktop, **touch drag** on mobile via `web/dnd.ts`,
  or tap-to-place), set each Pokemon's energy / damage / conditions, add the
  cards in **your hand**, and read live recommendations: a color-coded verdict
  chip, the opponent's likely reply, the best line, and the ranked plays. The
  selected card shows a detail panel (`web/card-view.ts`) with its effect text
  and color-coded rider tag chips. State persists in localStorage. All DOM is
  built through a tiny `el()` helper (`web/dom.ts`) that text-node-appends card
  strings, so card text is never interpreted as HTML.

The engine is browser-runnable because the pure card adapter
(`src/card-index.ts`) is split from the node-only `fs` loader (`src/data.ts`);
the web app builds the same card index from a bundled JSON import.

## Try it

```bash
npm install
npm run demo        # CLI: verdict + ranked plays for a sample live situation
npm run test        # engine + DOM + app-render assertions (26 tests)
npm run typecheck
npm run web:dev      # web app at http://localhost:5173
npm run web:build    # production build into dist-web/
npm run build:data   # re-scrape the card dataset from Limitless
```

The demo shows the engine finding the line "Giovanni (+10), attach Fire, then
Crimson Storm" to KO an opposing ex for 2 points, and reporting that your active
survives the reply.

## Roadmap and known gaps

- **Coin-gated effects.** "Flip a coin. If heads, paralyze / discard ..." is
  parsed-aware but not applied, because `applyMove` is deterministic; modeling
  these needs a probabilistic resolution (or an EV approximation in the
  evaluator).
- **Bench and spread damage.** Attacks that hit "1 of" or "each of your
  opponent's Pokemon" are treated as active-only for now; the 2-ply horizon
  centers on the active exchange.
- **Imperfect information.** The hidden hand/deck is not searched; a determinized
  ISMCTS would replace the heuristic single-turn lookahead.
- **Evaluator tuning.** The heuristic is points-first; a measurement harness
  (self-play or labeled positions) would let its weights be tuned rather than
  hand-set.
