#!/usr/bin/env node
/**
 * The read-only league site.
 *
 * Plain node:http with no framework and no client-side JavaScript, because every
 * page here is a read. The database is opened once at boot; if DATABASE_URL is not
 * set that is the embedded PGlite instance, which only one process can hold open
 * at a time -- so run the worker's jobs first, or `npm run db:serve` to share it.
 */

import { createServer } from 'node:http';
import { openDatabase, schemaExists, type DbHandle } from '@ql/db';
import { page } from './layout.js';
import { handle as route } from './router.js';

const PORT = Number(process.env.PORT ?? 3000);

async function main(): Promise<void> {
  // Bind the port before opening the database. Both can fail, and doing it in this
  // order means each failure reports itself: a port clash says the port is taken,
  // rather than the database lock complaining about whoever holds it.
  let handle: DbHandle | null = null;
  let resolveReady: (value: DbHandle) => void = () => {};
  let rejectReady: (reason: unknown) => void = () => {};
  const ready = new Promise<DbHandle>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  ready.catch(() => {}); // nothing else awaits it on the failure path

  // Requests in flight when a shutdown starts. Closing an embedded database
  // mid-query aborts its wasm runtime and can leave the data directory unusable,
  // so shutdown drains before it closes.
  let inFlight = 0;
  let draining = false;

  const server = createServer((request, response) => {
    inFlight += 1;
    response.on('close', () => {
      inFlight -= 1;
    });

    ready
      .then((open) => route(open.db, request, response, { port: PORT }))
      .catch((error: unknown) => {
        // A read path should never throw. If it does, say so plainly rather than
        // serving a half-rendered page.
        console.error(error);
        if (!response.headersSent) {
          response.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
          response.end(
            page(
              { title: 'Something broke' },
              `<section><div class="card"><p class="note">${
                error instanceof Error ? error.message : 'Unknown error'
              }</p></div></section>`,
            ),
          );
        }
      });
  });

  const shutdown = async (code = 0): Promise<void> => {
    if (draining) return;
    draining = true;
    server.close();

    // Give anything already running a moment to finish, then close for real.
    const deadline = Date.now() + 5000;
    while (inFlight > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (handle) await handle.close();
    process.exit(code);
  };

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `port ${PORT} is already in use -- most likely another copy of this server.\n` +
          `  PORT=${PORT + 1} npm run web        start on another port, or\n` +
          `  ss -ltnp | grep :${PORT}           find what is holding it`,
      );
    } else {
      console.error(error.message);
    }
    void shutdown(1);
  });

  server.listen(PORT, () => {
    openDatabase()
      .then(async (open) => {
        // A read-only process does not migrate. If the schema is not there, say
        // what to run rather than creating it from under the worker.
        if (!(await schemaExists(open.db))) {
          console.error(
            'no schema in this database yet.\n' +
              '  npm run db:migrate     create the tables\n' +
              '  npm run world:new      then build a league to look at',
          );
          await open.close();
          process.exit(1);
        }
        handle = open;
        resolveReady(open);
        console.log(`league site on http://localhost:${PORT}  (database: ${open.backend})`);
      })
      .catch((error: unknown) => {
        rejectReady(error);
        const message = error instanceof Error ? error.message : String(error);
        if (/Aborted\(\)/.test(message)) {
          console.error(
            'the embedded database in .data/pgdata could not be opened.\n' +
              'it is usually a process that was killed mid-write. the world is generated\n' +
              'from seeds, so rebuilding costs nothing:\n' +
              '  rm -rf .data && npm run db:migrate && npm run world:new && npm run season:new && npm run season:run',
          );
        } else {
          console.error(message);
        }
        server.close();
        process.exit(1);
      });
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void shutdown(0);
    });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
