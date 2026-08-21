/**
 * Recomputing the league table.
 *
 * Derived entirely from published matches, so it can be thrown away and rebuilt
 * at any time. Three points for a win, one for a draw; points scored break ties,
 * the way goal difference does in football.
 */

import { and, eq, isNotNull } from 'drizzle-orm';
import { fixtures, matches, standings, type Database } from '@ql/db';

export interface TableRow {
  clubId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  pointsFor: number;
  pointsAgainst: number;
  goalsFor: number;
  catchesFor: number;
  tablePoints: number;
}

export async function computeTable(db: Database, divisionId: string): Promise<TableRow[]> {
  const rows = await db
    .select({
      homeClubId: fixtures.homeClubId,
      awayClubId: fixtures.awayClubId,
      homePoints: matches.homePoints,
      awayPoints: matches.awayPoints,
      homeGoals: matches.homeGoals,
      awayGoals: matches.awayGoals,
      homeCatches: matches.homeCatches,
      awayCatches: matches.awayCatches,
    })
    .from(matches)
    .innerJoin(fixtures, eq(matches.fixtureId, fixtures.id))
    .where(and(eq(fixtures.divisionId, divisionId), isNotNull(matches.publishedAt)));

  const table = new Map<string, TableRow>();
  const blank = (clubId: string): TableRow => ({
    clubId,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    goalsFor: 0,
    catchesFor: 0,
    tablePoints: 0,
  });
  const rowFor = (clubId: string): TableRow => {
    const found = table.get(clubId) ?? blank(clubId);
    table.set(clubId, found);
    return found;
  };

  for (const match of rows) {
    const home = rowFor(match.homeClubId);
    const away = rowFor(match.awayClubId);

    home.played += 1;
    away.played += 1;
    home.pointsFor += match.homePoints;
    home.pointsAgainst += match.awayPoints;
    away.pointsFor += match.awayPoints;
    away.pointsAgainst += match.homePoints;
    home.goalsFor += match.homeGoals;
    away.goalsFor += match.awayGoals;
    home.catchesFor += match.homeCatches;
    away.catchesFor += match.awayCatches;

    if (match.homePoints > match.awayPoints) {
      home.won += 1;
      away.lost += 1;
      home.tablePoints += 3;
    } else if (match.homePoints < match.awayPoints) {
      away.won += 1;
      home.lost += 1;
      away.tablePoints += 3;
    } else {
      home.drawn += 1;
      away.drawn += 1;
      home.tablePoints += 1;
      away.tablePoints += 1;
    }
  }

  return [...table.values()].sort(sortTable);
}

export function sortTable(left: TableRow, right: TableRow): number {
  return (
    right.tablePoints - left.tablePoints ||
    right.pointsFor - right.pointsAgainst - (left.pointsFor - left.pointsAgainst) ||
    right.pointsFor - left.pointsFor
  );
}

export async function recomputeStandings(db: Database, divisionId: string): Promise<number> {
  const table = await computeTable(db, divisionId);
  for (const row of table) {
    await db
      .update(standings)
      .set({ ...row, updatedAt: new Date() })
      .where(and(eq(standings.divisionId, divisionId), eq(standings.clubId, row.clubId)));
  }
  return table.length;
}
