/**
 * One database handle, two backends.
 *
 * With DATABASE_URL set, this is a real Postgres server. Without it, an embedded
 * PGlite instance in `.data/pgdata` -- genuinely Postgres (18.3, compiled to
 * wasm), so the schema and every query are the real thing rather than a SQLite
 * approximation. The migrations that run against one run unchanged against the
 * other.
 *
 * The catch, and it is a sharp one: PGlite does NOT stop a second process from
 * opening the same data directory. It has no lock of its own -- two writers are
 * simply allowed, and the result is a corrupted directory whose next write aborts
 * the wasm runtime. So this module takes the lock PGlite does not: a pid file in
 * the data directory, refused if the holder is still alive and reclaimed if it is
 * not. Run `npm run db:serve` to share one instance over the wire protocol when
 * the worker and the web app genuinely need it at once.
 */

import nodeFs from 'node:fs';
import { sql } from 'drizzle-orm';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { drizzle as drizzleNode, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

/**
 * One concrete type, not a union of the two backends.
 *
 * The PGlite and node-postgres query builders are structurally identical, but a
 * union of them collapses Drizzle's overloads -- `.returning({ id })` stops
 * type-checking at every call site. So the type is the node-postgres one and the
 * embedded handle is cast once, here, rather than papered over everywhere else.
 */
export type Database = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Database;
  /** Which backend we ended up on, for the CLI to report. */
  backend: 'postgres' | 'pglite';
  migrate(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Has the schema been created yet?
 *
 * Cheaper and safer than migrating on boot, which is what a read-only process
 * should be doing: ask, and if the answer is no, say what to run.
 */
export async function schemaExists(db: Database): Promise<boolean> {
  const result = await db.execute<{ ok: boolean }>(
    sql`select exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'clubs'
    ) as ok`,
  );
  const rows = (result as unknown as { rows?: { ok: boolean }[] }).rows ?? [];
  return rows[0]?.ok === true;
}

export const DEFAULT_DATA_DIR = '.data/pgdata';
const LOCK_FILE = '.ql-lock';

function processAlive(pid: number): boolean {
  try {
    // Signal 0 checks for existence without delivering anything.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists and belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Claim the data directory, or explain who already has it.
 *
 * Returns the release function. A lock left behind by a process that has since
 * died is reclaimed rather than treated as fatal, because a hard kill is exactly
 * the case that leaves one.
 */
function acquireLock(dataDir: string): () => void {
  const { closeSync, openSync, readFileSync, unlinkSync, writeSync } = nodeFs;
  const lockPath = `${dataDir}/${LOCK_FILE}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = openSync(lockPath, 'wx');
      writeSync(handle, String(process.pid));
      closeSync(handle);

      let released = false;
      const release = (): void => {
        if (released) return;
        released = true;
        try {
          unlinkSync(lockPath);
        } catch {
          // Already gone. Nothing to do.
        }
      };
      process.once('exit', release);
      return release;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;

      const holder = Number(String(readFileSync(lockPath, 'utf8')).trim());
      if (holder && holder !== process.pid && processAlive(holder) && !process.env.PGLITE_FORCE_UNLOCK) {
        throw new Error(
          `the embedded database at ${dataDir} is already open in process ${holder}.\n` +
            'PGlite has no lock of its own, and two writers corrupt the directory, so this is refused.\n' +
            `  stop that process, or\n` +
            `  npm run db:serve   to share one instance over the Postgres wire protocol, or\n` +
            `  PGLITE_FORCE_UNLOCK=1 ...   if you are certain the lock is stale`,
        );
      }
      // Stale, or forced: take it.
      unlinkSync(lockPath);
    }
  }

  throw new Error(`could not claim the embedded database at ${dataDir}`);
}
const MIGRATIONS_FOLDER = new URL('../drizzle', import.meta.url).pathname;

export async function openDatabase(options: { url?: string; dataDir?: string } = {}): Promise<DbHandle> {
  const url = options.url ?? process.env.DATABASE_URL;

  if (url) {
    const { Pool } = await import('pg');

    // Pool sizing matters more than usual here. `npm run db:serve` puts the
    // embedded database behind the Postgres wire protocol, but it serialises
    // connections -- so a pool that holds one open while idle starves every other
    // process until it times out. Against that, use PG_POOL_MAX=1 with a short
    // idle timeout; against a real server the defaults are fine.
    const pool = new Pool({
      connectionString: url,
      max: Number(process.env.PG_POOL_MAX ?? 4),
      idleTimeoutMillis: Number(process.env.PG_POOL_IDLE_MS ?? 10_000),
    });
    const db = drizzleNode(pool, { schema });
    return {
      db,
      backend: 'postgres',
      migrate: async () => {
        const { migrate } = await import('drizzle-orm/node-postgres/migrator');
        await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
      },
      close: async () => {
        await pool.end();
      },
    };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const dataDir = options.dataDir ?? process.env.PGLITE_DIR ?? DEFAULT_DATA_DIR;

  // PGlite's node filesystem layer calls mkdir without `recursive`, so the parent
  // has to exist before it opens.
  nodeFs.mkdirSync(dataDir, { recursive: true });

  const releaseLock = acquireLock(dataDir);
  const client = new PGlite(dataDir);
  const embedded: PgliteDatabase<typeof schema> = drizzlePglite(client, { schema });
  const db = embedded as unknown as Database;
  return {
    db,
    backend: 'pglite',
    migrate: async () => {
      const { migrate } = await import('drizzle-orm/pglite/migrator');
      await migrate(embedded, { migrationsFolder: MIGRATIONS_FOLDER });
    },
    close: async () => {
      // Close before releasing: the lock must outlive the last write.
      await client.close();
      releaseLock();
    },
  };
}
