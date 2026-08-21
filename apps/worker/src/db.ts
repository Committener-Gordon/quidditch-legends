/**
 * Opening the database for a job run, and a place to record that the run happened.
 */
import { eq } from 'drizzle-orm';
import { openDatabase, schemaExists, jobRuns, type Database, type DbHandle } from '@ql/db';

/**
 * The worker owns the schema, so it may create it -- but only when it is actually
 * missing. Attempting a migration on every read command is a write the embedded
 * database does not need to take.
 */
export async function connect(): Promise<DbHandle> {
  const handle = await openDatabase();
  if (!(await schemaExists(handle.db))) await handle.migrate();
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
