// AC18: 100% of api's stdout/stderr lines must be JSON.
//
// `pnpm --filter @myflix/db migrate` (i.e. `prisma migrate deploy`) prints a
// pnpm script header, prisma's human-readable progress, and libssl-detection
// warnings -- none of it JSON. None of that is useful on a successful run, so
// it is captured and discarded. On failure it is still surfaced in full, as a
// single JSON line, and the process exits non-zero so a broken migration
// still stops `api` from starting (AC11).
//
// Plain CommonJS entrypoint run directly by Docker (`node apps/api/scripts/start.js`),
// outside the tsconfig `include` this repo's eslint config type-checks against, so
// the Node globals it needs aren't otherwise recognized.
/* eslint-disable no-undef, @typescript-eslint/no-require-imports -- Node CJS globals (require/process), see note above */
"use strict";

const os = require("node:os");
const { spawnSync, spawn } = require("node:child_process");

const migrate = spawnSync(
  "pnpm",
  ["--filter", "@myflix/db", "exec", "prisma", "migrate", "deploy"],
  { encoding: "utf8" },
);

if (migrate.error || migrate.status !== 0) {
  const output = `${migrate.stdout ?? ""}${migrate.stderr ?? ""}`.trim();
  process.stderr.write(
    `${JSON.stringify({
      level: 50,
      time: Date.now(),
      pid: process.pid,
      msg: "database migration failed",
      output,
      error: migrate.error ? migrate.error.message : undefined,
    })}\n`,
  );
  process.exit(migrate.status ?? 1);
}

const api = spawn(process.execPath, ["apps/api/dist/main.js"], {
  stdio: "inherit",
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => api.kill(signal));
}

api.on("exit", (code, signal) => {
  // 128 + signal number (e.g. 143 for SIGTERM) is the conventional shell
  // exit code for a signal-terminated process -- a flat 1 would make a
  // normal `docker stop` look like a crash.
  process.exit(code ?? (signal ? 128 + os.constants.signals[signal] : 0));
});
