# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm run db:migrate      # create/update the schema; only this and the worker may migrate
npm run typecheck       # all seven packages, plus the test files
npm run test            # 86 tests

# a playable world from nothing
npm run world:new       # 12 AI clubs, 168 players, from a seed
npm run season:new      # 22 matchdays, 132 fixtures
npm run web             # the game, http://localhost:3000

# measuring the sport (no database involved)
npm run balance -- --n 100000    # 11 targets, checked by histogram
npm run matrix                   # is any squad shape a shortcut?
npm run tactics                  # is any tactical setting simply correct?
npm run match -- --seed x        # one match, printed
```

Run a single test file with `npx tsx --test apps/worker/test/manage.test.ts`.
Tests use `node:test`; there is no test framework to configure. Test files sit
outside every package's `rootDir`, so they are typechecked separately by
`tsconfig.tests.json` — which `npm run typecheck` runs. Do not skip it: without it,
a wrong argument count in a test compiles happily.

After changing `packages/db/src/schema.ts`, run `npm run db:generate` (drizzle-kit)
and commit the generated SQL in `packages/db/drizzle/`.

## Architecture

Seven workspaces. The dependency direction is strictly one-way and worth preserving:

```
packages/sim       pure engine: squads + seed + rules -> event log. No I/O at all.
packages/economy   pure: wages, income, facility costs, training. No I/O.
packages/domain    pure: the Club aggregate -- rules spanning money and squad
packages/db        schema, migrations, queries, auth, mapping, and the repository seam
packages/harness   balance CLI; imports sim only, never db
apps/worker        jobs: matchday, standings, payday, off-season; owns the schema
apps/web           server-rendered site, no client-side JavaScript
```

`apps/web` imports jobs from `@ql/worker/jobs` so a single player pressing "play"
runs the same `runMatchday` the CLI does.

### Six invariants that hold the design together

1. **`packages/sim` is pure.** `simulate({home, away, seed}, {rules})` returns an
   event log. No database, no clock, no network, and `Math.random` is banned — a
   test asserts it is never called. This is what lets the same code play a league,
   run 100k harness matches, and replay history.

2. **A published match is reproducible from three things, not two.** Seed and
   rules version are *not* enough: `simulate()` is pure but its inputs include the
   squads, and stamina/form move the instant a match is applied. `matches.squads`
   stores both teams as they lined up. `replayMatch()` reproduces any match event
   for event, under test.

3. **Rules are versioned and pinned per match.** Retuning the sport means adding a
   new `RuleSet` to `RULE_SETS`, never editing an existing one. `v1` is kept
   unchanged beside `v2` for exactly this reason.

4. **The event log is the match.** The score is a fold over it. The CLI report, the
   web timeline, the box score and the leaders table all render the same stored
   events; nothing re-simulates.

5. **A balance is never stored.** It is `sum(ledger_entries.amount)`. Every posting
   is idempotent on `(club, kind, reference)` — that unique index is what makes
   payday safe to run twice.

6. **Anything spanning money and squad membership goes through the `Club`
   aggregate.** `packages/domain` owns those rules; `packages/db/src/repositories.ts`
   is the only place that translates them into rows. A transfer has exactly one
   definition (`agreeTransfer`) and cannot be reinvented elsewhere. Aggregates ask
   every question (`canAfford`, `canRelease`, `canSign`) before changing anything, so
   a refusal costs a discarded object rather than a rollback. `apps/web` imports no
   ORM at all — if you find yourself reaching for one there, add a query to
   `packages/db/src/queries.ts` instead.

### Match rules vs world rules

`RuleSet` (`packages/sim/src/rules.ts`) governs what happens inside 80 minutes and
must be versioned. `WorldRules` (`apps/worker/src/world-rules.ts`) governs recovery,
ageing, retirement and intake — it only affects the future, so it is not versioned.
Keep new dials on the correct side of that line.

### Live playback

Matches are simulated in full immediately, then *revealed* over real time.
`matches.kicked_off_at` + `playback_seconds` decide which events are visible;
`published_at` stays null until the window elapses, which is what keeps the league
table and scorer charts from spoiling a match in progress (both already filter on
it). `settleWorld()` promotes finished matches lazily on any web request, so no
process needs to be running for a match to end. Never read the final score off the
match row while a match is live — fold the revealed events instead.

## Working in this codebase

**Balance is measured, never argued.** Every tuning decision here came from a
histogram, and several contradicted the arithmetic that preceded them. If you
change a dial in `rules.ts`, run `npm run balance`, `npm run matrix` and
`npm run tactics` and report the numbers. The harness prints its own noise floor;
never read an edge smaller than it.

Watch for balance claims that only hold for the current dials. Thresholds should be
relative (e.g. "the hardest three saves this match"), because absolute cut-offs
break silently on the next retune — one such threshold once matched zero events out
of 1,537.

## Traps specific to this repo

- **The embedded database takes one process at a time.** PGlite has no lock of its
  own — two writers corrupt the directory — so `openDatabase()` adds a pid-file
  lock. Stop the web server before running a worker command. `npm run db:serve` +
  the `:shared` scripts run both at once (they set `PG_POOL_MAX=1`, without which
  the site's idle pooled connection starves the worker).
- **A damaged `.data` directory is disposable.** Worlds are seed-generated:
  `rm -rf .data && npm run db:migrate && npm run world:new`.
- **`tsx` spawns a grandchild.** Killing the wrapper PID leaves the real server
  running and holding port 3000. Kill by the listening PID (`ss -ltnp`), or you
  will spend a while debugging a stale server serving pre-change code.
- **`pkill -f 'src/server.ts'` matches your own shell command.** Filter by PID.
- **Readers must not migrate.** `apps/web` refuses to boot on a schema behind the
  code and says what to run; the worker applies outstanding migrations itself.
- Root-level `.ts` scripts are treated as CJS (no `"type": "module"` at the root).
  Put throwaway scripts inside a workspace package instead.
- **Never write through the outer `db` handle inside a `uow.run` block.** One
  physical connection means a write on `db` while a transaction is open on `tx` does
  not error — it stops making progress. Use the aggregate or the scoped repositories.
- **Aggregate loads must stay cheap.** `clubs.get()` is called in loops; it once
  upserted six facility rows per load and turned a four-second season into a
  six-minute one.
- **A new season must start after the previous one ends** (`nextSeasonStart`).
  Seasons that share calendar dates share injury dates, and a club can arrive at its
  opening fixture with nine players unavailable.

## Conventions

- Comments explain *why*, especially where a value was measured or a simpler
  approach was rejected. Match the surrounding density; do not annotate the obvious.
- Player names are generated and carry no gender — never use gendered pronouns in
  user-facing copy about them.
- `apps/web` has no client-side JavaScript. Mutations are plain form POSTs answering
  with a redirect; a live match page auto-updates with `<meta http-equiv="refresh">`.
- Money is integer Galleons. Nothing is purchasable with real money by design.

### The market

Priced against a valuation, never negotiated. Listings, free agents (from expired
contracts), paid scout reports with a deliberately imperfect estimate, and contract
renewals that re-strike the wage. Every write goes through the `Club` aggregate —
including `expireContracts`, which was first written as a bulk update and could
strip a squad below the seven it needs to field a side.

`aiMarket` runs each payday: AI clubs renew, list surplus, sign free agents and buy
from each other, both to fill gaps and to upgrade. Without the upgrade rule nothing
anybody lists ever sells, because youth intake keeps every club at full shape.

## Not built yet

No bidding between managers, and no youth draft — the catch-up mechanism the league
still lacks. No promotion/relegation or cup (phase five). See `docs/aggregates.md`.
