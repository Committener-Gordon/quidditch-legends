#!/usr/bin/env node
/**
 * Expose the embedded database over the Postgres wire protocol.
 *
 * Only one process can hold a PGlite data directory open. Run this when the worker
 * and the web app need it at the same time, then point both at
 * `postgres://postgres@localhost:5432/postgres` via DATABASE_URL.
 */

import { mkdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { DEFAULT_DATA_DIR } from './client.js';

const port = Number(process.env.PGLITE_PORT ?? 5432);
const dataDir = process.env.PGLITE_DIR ?? DEFAULT_DATA_DIR;

mkdirSync(dataDir, { recursive: true });
const client = await PGlite.create(dataDir);
const server = new PGLiteSocketServer({ db: client, port, host: '127.0.0.1' });

await server.start();
console.log(
  `serving ${dataDir} on postgres://postgres@127.0.0.1:${port}/postgres\n` +
    'point DATABASE_URL at it to run the worker and the web app together.',
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void server.stop().then(() => client.close().then(() => process.exit(0)));
  });
}
