#!/usr/bin/env node
/**
 * Apply migrations. This is the only entry point that should ever do it.
 *
 * Read paths must not migrate on boot: two processes racing to create the same
 * schema is how an embedded database ends up mid-write when one of them exits.
 */

import { openDatabase } from './client.js';

const handle = await openDatabase();
try {
  await handle.migrate();
  console.log(`migrations applied (${handle.backend})`);
} finally {
  await handle.close();
}
