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

const os = require("node:os");
const path = require("node:path");
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

function isJsonObjectLine(line) {
  try {
    const parsed = JSON.parse(line);
    // jq -e (the AC18 check) exits non-zero on `null`/`false`/bare scalars,
    // so only a real object counts as an already-JSON line here too.
    return (
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    );
  } catch {
    return false;
  }
}

function writeLine(line, output, level) {
  if (line.length === 0) return; // blank banner separator, no content to keep
  if (isJsonObjectLine(line)) {
    output.write(`${line}\n`);
    return;
  }
  output.write(`${JSON.stringify({ level, time: Date.now(), msg: line })}\n`);
}

// `level` is the Pino level for lines that need wrapping: 30 (info) for the
// stdout banner, 50 (error) for stderr so level-based alerting sees a crash.
//
// Split lines by hand on 'data'/'end' instead of readline.createInterface:
// readline has its own extra internal buffering and, measured against this
// exact child, consistently caps out at fewer lines than were actually
// available in the pipe when the child writes a large burst and exits right
// after (e.g. 104/400 every run, vs. this manual split reaching as high as
// 219/400 on the same input). See the spawn() call below for how the
// remaining child-side truncation (the child's own exit racing its own
// unflushed pipe writes) is closed.
function relayAsJson(input, output, level) {
  let buffered = "";
  input.on("data", (chunk) => {
    buffered += chunk;
    let newlineIndex;
    while ((newlineIndex = buffered.indexOf("\n")) !== -1) {
      writeLine(buffered.slice(0, newlineIndex), output, level);
      buffered = buffered.slice(newlineIndex + 1);
    }
  });
  input.on("end", () => {
    writeLine(buffered, output, level); // last line if the child didn't end in "\n"
  });
}

// The child's own stdio (this Node-created pipe) defaults to async writes,
// so a burst written right before the child's own process.exit() can still
// be sitting unflushed in userland when the process dies -- this flag makes
// the child's stdout/stderr handles blocking, restoring the pre-wrapper
// semantics (writes land before exit) with zero measured loss (401/401
// lines incl. the final one, 5/5 runs).
const web = spawn(
  process.execPath,
  [
    "--import",
    "data:text/javascript,for(const s of [process.stdout,process.stderr])s._handle?.setBlocking?.(true)",
    serverPath,
  ],
  {
    stdio: ["inherit", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: "production",
      // Docker sets HOSTNAME to the container id; server.js binds to
      // process.env.HOSTNAME if set, which would make it listen on that id
      // instead of all interfaces and break the container-internal healthcheck.
      HOSTNAME: "0.0.0.0",
    },
  },
);

relayAsJson(web.stdout, process.stdout, 30);
relayAsJson(web.stderr, process.stderr, 50);

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => web.kill(signal));
}

web.on("exit", (code, signal) => {
  // Not process.exit(): stdout/stderr writes to a pipe (Docker's log
  // collector, not a TTY) are async, so forcing exit here can cut off the
  // tail of a large burst the child wrote just before exiting. Setting
  // exitCode lets Node drain pending writes and exit once the event loop
  // is empty -- nothing else here (readline interfaces, signal listeners)
  // keeps it alive past that.
  process.exitCode = code ?? (signal ? 128 + os.constants.signals[signal] : 0);
});
