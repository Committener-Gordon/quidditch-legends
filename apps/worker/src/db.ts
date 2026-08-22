/**
 * Opening the database for a job run, and a place to record that the run happened.
 */
import { eq } from 'drizzle-orm';
import { openDatabase, pendingMigrations, jobRuns, type Database, type DbHandle } from '@ql/db';

/**
 * The worker owns the schema, so it brings it up to date -- but only when
 * something is actually outstanding. Attempting a migration on every read command
 * is a write the embedded database does not need to take.
 */
export async function connect(): Promise<DbHandle> {
  const handle = await openDatabase();
  const state = await pendingMigrations(handle.db);
  if (state.pending.length > 0) {
    console.log(
      `applying ${state.pending.length} migration(s): ${state.pending.join(', ')}`,
    );
    await handle.migrate();
  }
  return handle;
}

export async function recordJob(
  db: Database,
  job: string,
  subject: string,
  run: () => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const [started] = await db.insert(jobRuns).values({ job, subject }).returning({ id: jobRuns.id });

  try {
    const detail = await run();
    if (started) {
      await db
        .update(jobRuns)
        .set({ finishedAt: new Date(), ok: true, detail })
        .where(eq(jobRuns.id, started.id));
    }
    return detail;
  } catch (error) {
    if (started) {
      await db
        .update(jobRuns)
        .set({
          finishedAt: new Date(),
          ok: false,
          detail: { error: error instanceof Error ? error.message : String(error) },
        })
        .where(eq(jobRuns.id, started.id));
    }
    throw error;
  }
}
