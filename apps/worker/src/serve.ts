#!/usr/bin/env node
/**
 * The scheduler.
 *
 * This is the cron the design always called for, as a process: it wakes up, looks
 * for a matchday whose kickoff has passed and whose fixtures are unplayed, plays
 * it, and goes back to sleep. Nothing else in the system decides when a match
 * happens.
 *
 * Pair it with a season created on a fixed clock (`--interval 5m`) and a whole
 * season plays out in a couple of hours while you watch the table move.
 */

import { and, asc, eq, lte } from 'drizzle-orm';
import { currentSeason, fixtures, type Database } from '@ql/db';
import { connect } from './db.js';
import { runMatchday } from './jobs/matchday.js';

const POLL_SECONDS = Number(process.env.QL_POLL_SECONDS ?? 10);

/** The earliest matchday that is due and not yet played. */
export async function dueMatchday(db: Database, now = new Date()): Promise<number | null> {
  const season = await currentSeason(db);
  if (!season || season.state === 'complete') return null;

  const [row] = await db
    .select({ matchday: fixtures.matchday })
    .from(fixtures)
    .where(
      and(
        eq(fixtures.seasonId, season.id),
        eq(fixtures.status, 'scheduled'),
        lte(fixtures.kickoffAt, now),
      ),
    )
    .orderBy(asc(fixtures.matchday))
    .limit(1);

  return row?.matchday ?? null;
}

async function main(): Promise<void> {
  const handle = await connect();
  const { db } = handle;
  let running = true;

  const stop = async (): Promise<void> => {
    if (!running) return;
    running = false;
    await handle.close();
    process.exit(0);
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => void stop());
  }

  console.log(
    `scheduler running on ${handle.backend}, checking every ${POLL_SECONDS}s. ctrl-c to stop.`,
  );

  while (running) {
    try {
      const season = await currentSeason(db);
      const matchday = await dueMatchday(db);

      if (season && matchday !== null) {
        const result = await runMatchday(db, { seasonNumber: season.number, matchday });
        const stamp = new Date().toISOString().slice(11, 19);
        console.log(`[${stamp}] season ${season.number}, matchday ${matchday}:`);
        for (const line of result.lines) {
          const picked = line.homeSubmitted || line.awaySubmitted ? '  *' : '';
          console.log(
            `    ${line.home} ${String(line.homePoints).padStart(3)} - ${String(line.awayPoints).padEnd(3)} ${line.away}${picked}`,
          );
        }
        if (result.payday.length > 0) {
          const broke = result.payday.filter((line) => line.unpaid).length;
          console.log(`    payday: wages and upkeep charged${broke > 0 ? `, ${broke} club(s) in the red` : ''}`);
        }
        continue; // check again straight away in case more than one is due
      }
    } catch (error) {
      console.error(`scheduler error: ${error instanceof Error ? error.message : error}`);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_SECONDS * 1000));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
