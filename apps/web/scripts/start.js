// AC18: 100% of web's stdout/stderr lines must be JSON.
//
// The Next.js standalone server prints a startup banner (version, URLs,
// "Starting...", "Ready in Nms") straight to stdout, not through the app's
// pino logger -- running it via `next start` also adds a "non-standard
// NODE_ENV" warning and a warning to use this very standalone server instead.
// Running `.next/standalone/.../server.js` directly (as that second warning
// itself recommends) drops both warnings; the banner lines are wrapped as
// JSON here rather than dropped, so nothing -- including a real startup
// error -- is silently discarded.
//
// Plain CommonJS entrypoint run directly by Docker (`node apps/web/scripts/start.js`),
// outside the tsconfig `include` this repo's eslint config type-checks against, so
// the Node globals it needs aren't otherwise recognized.
/* eslint-disable no-undef, @typescript-eslint/no-require-imports -- Node CJS globals (require/process/__dirname), see note above */
"use strict";

const path = require("node:path");
const readline = require("node:readline");
const { spawn } = require("node:child_process");

const serverPath = path.join(
  __dirname,
  "..",
  ".next",
  "standalone",
  "apps",
  "web",
  "server.js",
);

function relayAsJson(input, output) {
  readline.createInterface({ input }).on("line", (line) => {
    if (line.length === 0) return; // blank banner separator, no content to keep
    try {
      JSON.parse(line);
      output.write(`${line}\n`);
    } catch {
      output.write(
        `${JSON.stringify({ level: 30, time: Date.now(), msg: line })}\n`,
      );
    }
  });
}

const web = spawn(process.execPath, [serverPath], {
  stdio: ["inherit", "pipe", "pipe"],
  env: {
    ...process.env,
    NODE_ENV: "production",
    // Docker sets HOSTNAME to the container id; server.js binds to
    // process.env.HOSTNAME if set, which would make it listen on that id
    // instead of all interfaces and break the container-internal healthcheck.
    HOSTNAME: "0.0.0.0",
  },
});

relayAsJson(web.stdout, process.stdout);
relayAsJson(web.stderr, process.stderr);

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => web.kill(signal));
}

web.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
