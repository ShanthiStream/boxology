#!/usr/bin/env node
/**
 * npm entry point.
 *
 * `dist/server.mjs` stays importable rather than self-starting so this wrapper
 * owns process-level concerns (missing build, exit codes). Global installs and
 * `npx boxology` both land here.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const server = new URL('../dist/server.mjs', import.meta.url);

if (!existsSync(server)) {
  console.error(
    `Boxology is missing its build (${fileURLToPath(server)}).\n` +
      'If you are running from a checkout, run `bun run build` first.',
  );
  process.exit(1);
}

const { main } = await import(server);

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
