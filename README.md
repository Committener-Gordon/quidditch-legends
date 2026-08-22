# Quidditch Legends

A browser-based Quidditch manager game. Three phases are built:

- **Phase one — the sport.** A pure match engine and a balance harness.
- **Phase two — a world with nobody in it.** Postgres, twelve AI-managed clubs, a
  matchday job, an off-season, and read-only league pages. The league runs and
  publishes on its own for a full season.
- **Phase three — claim a club.** Accounts, taking over an AI club, picking a team,
  and the Galleon economy: wages, gate receipts, facilities and training. A human
  decision now changes a published result.

It is a single-player game at the moment, which means **you own the clock**: claim
a club, pick your team, and press play when you are ready.

## The rules this engine plays

Two deliberate departures from canon, which together turn Quidditch from a
lottery into a sport:

- **A snitch catch is worth 30 points, not 150.**
- **Catching it does not end the match.** A new snitch is released immediately
  and the seekers go again — about four times in a match.

Because catches repeat, seeker *quality* compounds over 80 minutes instead of
resolving in a single coin flip. That is what makes squad-building matter. The
cost is that nothing stops the match any more, so the engine plays a **fixed
80-minute clock** and allows draws.

## Quick start

```bash
npm install
npm run db:migrate         # create the tables

# build a league and play a season
npm run world:new          # twelve AI clubs, 168 players, from a seed
npm run season:new         # a division, 22 matchdays, 132 fixtures
npm run season:run         # play all of it (about 4 seconds)
npm run offseason          # develop, decline, retire, refill

npm run table              # the league table
npm run finances           # who is solvent, and who is pulling away
npm run report             # re-render the last match from its stored event log
npm run web                # the league site on http://localhost:3000
```

Then open http://localhost:3000, create an account, take over a club, pick your
team, and hit **Play matchday 1**. Every club in the division plays at the same
time — a league where only your own fixture resolves is not a league. When the
season runs out of fixtures the dashboard offers to run the off-season and start
the next one.

Nothing else has to be running. The site plays the matchday itself.

### The guide

The game explains itself at **/guide** — the play loop, what a scoreline is made
of, the three contests inside a match, what each attribute does, where the money
goes, and what is deliberately missing. Four hand-authored inline SVG diagrams
that follow the site's light and dark themes.

It lives in `apps/web/src/guide.ts`, so it ships with the code and is version
controlled alongside the rules it describes. Every number in it is measured rather
than designed — if you retune the sport, check they still hold.

### Watching a match

A matchday can play out over real time — three minutes by default, or whatever you
pick when you press play. You land on a live feed: goals with the scorer and who
set them up, snitch catches, the saves worth mentioning, injuries and substitutions,
with a running score and a clock.

The match is still simulated in a few milliseconds. What takes three minutes is
**telling you about it**. Two things follow from that, and both are deliberate:

- Nothing can go wrong halfway through. The result exists before the first line
  of the feed appears, so a crash, a reload or a closed laptop costs you nothing.
- The league table does not move until the match finishes, and neither do the
  scorer charts. Both already filter on `matches.published_at`, which stays null
  while a match is being revealed — so a match in progress cannot spoil itself
  from the results page.

Pick `no wait` on the play form to skip it, which is also what the bulk CLI
commands do.

### Who owns the clock

A season is created with one of two pacings, and it changes nothing about the
fixtures, the engine or the results — only what makes a match start.

| | |
| --- | --- |
| `manual` (default) | You press play. Lineups stay open until you do. For one player. |
| `scheduled` | Kickoff times are real and `npm run serve` plays each matchday when its time arrives. Lineups lock shortly before. For a league full of people. |

```bash
npm run season:new                                   # manual, starting now
npm run season:new -- --pacing scheduled             # Tue/Thu/Sat, 20:00 UTC
npm run season:new -- --pacing scheduled --interval 5m --deadline 1m
npm run serve                                        # the scheduler, for scheduled seasons
npm run reschedule -- --interval 10m                 # move an unplayed season onto a faster clock
```

`--interval` accepts `5m`, `2h`, `1d`. The lineup deadline defaults to a quarter of
the gap, capped at fifteen minutes — fifteen minutes is right for a two-day gap and
absurd for a five-minute one.

### Running the site and the worker at the same time

Only needed for a `scheduled` season, or if you prefer the CLI. The embedded
database takes one process at a time, so either stop the site first, or share one
instance:

```bash
npm run db:serve            # terminal 1: embedded database on the wire protocol
npm run web:shared          # terminal 2: the site
npm run worker:shared -- matchday    # terminal 3: play a matchday while it serves
```

The `:shared` scripts set `PG_POOL_MAX=1` and a short idle timeout, which matters:
`db:serve` serialises connections, so a pool that holds one open while idle starves
every other process. Against a real Postgres server none of this applies — set
`DATABASE_URL` and run whatever you like concurrently.

Everything is seeded, so `world:new --seed launch` twice builds the same league
twice.

## The commands

| | |
| --- | --- |
| **The world** | |
| `npm run world:new` | Twelve clubs with rosters and their own tactical habits |
| `npm run season:new` | A season, its division, its fixture list, a table of zeroes |
| `npm run matchday` | Play one matchday (defaults to the next unplayed) |
| `npm run serve` | The scheduler: plays a matchday when its kickoff arrives |
| `npm run reschedule -- --interval 10m` | Move the unplayed part of a season onto a new clock |
| `npm run season:run` | Play every remaining matchday |
| `npm run offseason` | Development, decline, retirement, youth intake |
| `npm run cycle -- --seasons 3` | Whole seasons back to back |
| `npm run status` / `world:reset -- --yes` | Where the world is / delete it |
| **Reading it** | |
| `npm run table` | The table, with squad strength and the rank correlation |
| `npm run clubs` / `seekers` | Records next to the tactics that produced them |
| `npm run fixtures` / `leaders` | Fixture list / leading scorers |
| `npm run report` | A stored match, re-rendered from its event log |
| `npm run web` | The read-only league site |
| **The sport** | |
| `npm run match` | Simulate one match and print the report |
| `npm run balance -- --n 100000` | Eleven targets, checked by histogram |
| `npm run matrix` | Archetype round robin: is a squad shape a shortcut? |
| `npm run tactics` | Tactics round robin: is a setting simply correct? |
| `npm run test` / `typecheck` | 73 tests |
| **The economy** | |
| `npm run finances` | Balances, wage bills, upkeep, and the snowball metric |
| `npm run claim -- --email you@example.com --club ASH` | Hand a club to an account from the CLI |
| `npm run reprice` | Recompute every wage from current ratings |

## Money

One currency, Galleons, earned only. Nothing is for sale for real money, so the
economy's whole job is to force choices. The scale is anchored on one benchmark
taken from real football: **a healthy club spends 55–65% of income on wages.**
Everything else is derived from it.

| | |
| --- | --- |
| Wages | Exponential in rating: a 70 costs about twice a 60, a 90 four times a 70 |
| Gate receipts | Capacity × attendance, and attendance follows league position and form |
| Sponsorship | Weekly, by division tier |
| Prize money | 70,000 down to 20,000 — deliberately flat, see below |
| Facilities | Six trees, `base × growth^level`, upkeep 1.2% of capital invested per week |
| Training | One order per season, charged weekly, gated on minutes played |

Facilities are the sink that makes saving worth it, and they reach into the match:
the broom store is a squad-wide Flying bonus, the medical wing shortens injuries,
the academy improves youth intake, the training ground multiplies development, and
the scouting network narrows the potential range you are shown for a young player.
Potential itself is never displayed — a manager sees a scout's estimate, and that
fog is what will turn the phase-four transfer market from arithmetic into judgement.

## The database

`DATABASE_URL` uses a real Postgres server. Without it, an embedded
[PGlite](https://pglite.dev) instance in `.data/pgdata` — genuinely Postgres
(18.3, compiled to wasm), so the schema and every query are the real thing rather
than a SQLite approximation, and the migrations that run against one run
unchanged against the other.

One sharp caveat. PGlite does **not** stop a second process from opening the same
data directory — it has no lock of its own, two writers are simply allowed, and
the result is a corrupted directory whose next write aborts the wasm runtime. So
`openDatabase()` takes the lock PGlite does not: a pid file in the data
directory, refused while the holder is alive and reclaimed once it is not. If you
see it refuse, either stop the other process or share one instance:

```bash
npm run db:serve                                            # Postgres wire protocol
DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres npm run web
```

`PGLITE_FORCE_UNLOCK=1` overrides it, if you are certain the lock is stale. None
of this applies to a real Postgres server, which is what phase three moves to.

## Where the sport is measured

Balance is judged by histogram, not by playing it. `npm run balance` checks
eleven targets; all green at 100,000 matches, 0.31 ms per match:

| Target | Measured | Band |
| --- | --- | --- |
| Snitch share of points | 28.2% | 25–32% |
| Catches per match | 4.00 | 3.5–4.5 |
| Goals per team | 15.3 | 13–17 |
| Points per team | 213 | 190–230 |
| Draw rate | 3.9% | 0–6% |
| Snitch flips the quaffle result | 19.8% | 12–25% |
| Favourite wins, rating gap 0–2 | 51.5% | 50–57% |
| Favourite wins, rating gap 2–5 | 58.3% | 54–63% |
| Favourite wins, rating gap 5–10 | 69.5% | 62–72% |
| Favourite wins, rating gap 10+ | 83.6% | 75–88% |

The favourite win rate is specified as a **curve by rating gap**, not as one
pooled number: a single figure only means something relative to how wide the club
pool is.

Two round robins ask whether anything is a shortcut, at equal squad strength:

- `npm run matrix` — squad shapes. Every archetype concentrates the same 18
  rating points on its favoured position. All five land between 48.0% and 51.4%
  against a ±0.5% noise floor; `chaserHeavy` is weakest and `seekerHeavy`
  strongest, both by about 1.5 points.
- `npm run tactics` — tactical settings, with identical squads. All three
  `beaterFocus` options and all three `seekerCommitment` options are inside the
  noise floor. This one was added *after* a simulated season showed two settings
  were not decisions but answers; see below.

And once a season has been played, `npm run table` prints the Spearman rank
correlation between squad strength and final position. Across seasons it runs
**0.7–0.9**: the better squad usually wins, not always. That is the number that
says the league works.

## Layout

```
packages/domain/      the Club aggregate: rules spanning money and squad membership
  src/club.ts         balance, squad and facility rules; no I/O
  src/transfer.ts     one definition of what a transfer is
packages/sim/         the engine: pure, dependency-free, no I/O
  src/rules.ts        every balance dial, versioned  <-- tune here
  src/quaffle.ts      possession, shot, save
  src/bludgers.ts     hits, debuffs, injuries, seeker suppression
  src/snitch.ts       the hazard cycle and the respawn
  src/simulate.ts     the tick loop and post-match effects
packages/db/          schema, migrations, typed queries
  src/schema.ts       the relational model
  src/mapping.ts      the seam between rows and the engine
  src/queries.ts      read paths, plus replayMatch()
  src/repositories.ts the seam between rows and the Club aggregate
packages/harness/     the balance CLI
apps/worker/          scheduled jobs: matchdays, standings, the off-season
  src/jobs/matchday.ts  the state machine
  src/world-rules.ts    recovery, ageing, retirement -- NOT match rules
apps/web/             read-only league site, server-rendered, no client JS
```

## Four invariants worth not breaking

1. **The engine is pure.** `simulate({home, away, seed}, {rules})` takes squads, a
   seed and a rule set and returns an event log. No database, no clock, no
   network, no `Math.random` — a test asserts it is never called.

2. **A published match is reproducible, and that takes three things.** The seed
   and the rules version are *not* sufficient on their own: `simulate()` is pure,
   but its inputs include the squads, and a player's stamina and form move the
   instant a match is applied. So `matches.squads` stores both teams exactly as
   they lined up. `replayMatch()` reproduces any published match event for event,
   and a test holds it to that.

3. **Rules are versioned and pinned per match.** Retuning the sport means
   publishing a new `RuleSet`. `v1` is kept unchanged next to `v2` for exactly
   this reason — a match played under v1 still replays to the same result.

4. **The event log is the match.** The score is a fold over it. The CLI report,
   the web timeline, the box score and the leaders table are all renders of the
   same stored events, and none of them re-simulates anything.

## What the economy found

Phase three got the same treatment as the sport: build the thing, then measure it
over several seasons rather than trusting the arithmetic.

The first pass ran four seasons and looked fine on the obvious metric — nobody went
bankrupt, and the median balance was stable. But the **spread** was not: by season
four the top clubs had twelve facility levels to the bottom clubs' five, a 2.4×
gap, and rising. Facility levels are the durable advantage — cash gets spent,
buildings do not — so that ratio is the real snowball measure, and above about
2.5× a new manager cannot realistically catch up.

The cause was prize money at **12:1** between first and last. The champion was
banking more in prize money alone than a whole season's operating surplus.
Flattening it to 3.5:1 changed the shape completely: the facility ratio now runs
2.00× → 1.75× → 1.67× → 1.57× across four seasons — **converging rather than
diverging**, because the upkeep charge on invested capital finally outweighs the
income advantage. `npm run finances` prints that ratio every time.

Worth being clear about what is *not* solved: the designed brakes on snowball are
the reverse-standings draft (phase four) and relegation (phase five). What phase
three has is upkeep and a flat prize curve, and those turned out to be enough to
hold the line for four seasons in a twelve-club division with no transfers.

## What the season found

Phase two paid for itself the same way phase one did. Running twelve AI clubs
with *different tactics* through a full season exposed something 100,000 harness
matches never could, because the harness ran every club on the defaults:
`beaterFocus: 'seeker'` and `seekerCommitment: 'support'` were not decisions, they
were the answer. The club with the league's weakest squad finished fifth on the
strength of one tactical setting.

The fix was a measurement tool first — `npm run tactics`, a round robin over each
tactical dimension at identical squad strength — and only then a retune, which
became rules `v2`. Two things are worth noting about it. The matrix contradicted
the arithmetic that predicted `support` would be *weak*: lending the seeker to open
play compounds through possession, shot and save the same way a rating gap does.
And the season on its own was not enough to diagnose it, because squad quality and
tactics were confounded — the clean measurement had to come from the harness.

## Troubleshooting

**`Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"`, or any `Aborted()` from
wasm.** The embedded data directory is damaged, almost always because a process
was killed mid-write — PGlite is far less forgiving of that than a Postgres
server. The world is generated from seeds, so rebuilding costs nothing:

```bash
rm -rf .data
npm run db:migrate && npm run world:new && npm run season:new && npm run season:run
```

Three things now guard against it: the data directory is locked so two processes
cannot write to it at once, the web server drains in-flight requests before
closing the database, and only the worker (or `npm run db:migrate`) ever
migrates — a read-only process that migrates on boot is how two processes end up
racing to write the same schema.

**`no schema in this database yet`.** Expected on a fresh checkout. Run
`npm run db:migrate`, then `npm run world:new`.

**`the embedded database ... is already open in process N`.** The lock working as
intended. Stop that process, or use `npm run db:serve` to share one instance.

**`port 3000 is already in use`.** Another copy of the site is running.
`PORT=3001 npm run web`, or `ss -ltnp | grep :3000` to find it.

## Two more invariants, from phase three

5. **A balance is never stored.** It is always `sum(ledger_entries.amount)`. Every
   posting is idempotent on `(club, kind, reference)`, and that unique index is
   what makes a payday job safe to run twice — there is a test that runs one twice
   and asserts the balance does not move.

6. **A match in progress cannot spoil itself.** A live match is fully simulated
   and stored, but `published_at` stays null until its playback window runs out.
   The table, the scorer charts and the results list all key off that, so the only
   way to see the score early is to watch the feed. `settleWorld()` promotes
   finished matches lazily on any request, so the world settles itself whenever
   anyone looks — no process has to be running for a match to end.

7. **A lineup closes on the server, once.** The form disables itself, but that is
   a courtesy; the rule lives in the POST handler. Under `manual` pacing the only
   thing that closes a lineup is the match having been played — there is no clock to
   beat. Under `scheduled` pacing the deadline applies. Either way a submitted
   lineup is honoured exactly, out of position or not: if it names a player who has
   since been injured, that slot is filled with the best available replacement
   rather than forfeiting the match.

## What is deliberately not here yet

No transfer *market*, though the machinery is built and tested: `executeTransfer`
moves a player and the money in a single transaction through the `Club` aggregate,
with a 5% levy that leaves the economy rather than moving between clubs. What is
missing is the market around it — listings, valuations, AI buyers, screens. The
design note is `docs/aggregates.md`. Phase four is the meta-game: an NPC-priced market
first, the off-season draft, scout reports you pay for, and contract renewals —
then player-to-player bidding once the valuation model has survived a season.
Phase five is the division pyramid, promotion and relegation, and a cup.
