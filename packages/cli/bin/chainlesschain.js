#!/usr/bin/env node

// Ensure UTF-8 encoding on Windows to prevent Chinese character garbling (乱码)
import { ensureUtf8 } from "../src/lib/ensure-utf8.js";
ensureUtf8();

// Force blocking stdio when piped, so process.exit() flushes the full output
// before the process tears down. Without this, macOS (and occasionally Linux)
// can drop tail bytes from large outputs like `chainlesschain --help` (~13KB
// across 155 commands) when consumed via execSync/spawnSync `stdio: pipe`.
// No-op on TTY — terminals are already line-buffered. Idiomatic for Node
// CLIs (npm, yarn, eslint all do the equivalent).
if (!process.stdout.isTTY && process.stdout._handle?.setBlocking) {
  process.stdout._handle.setBlocking(true);
}
if (!process.stderr.isTTY && process.stderr._handle?.setBlocking) {
  process.stderr._handle.setBlocking(true);
}

import { createProgram } from "../src/index.js";

// Centralized friendly-error boundary. An uncaught error thrown from a command
// action (e.g. malformed --json input, a failed DB op) otherwise surfaces as a
// raw stack trace via Node's default unhandledRejection. Turn it into a clean
// one-line `error: <message>` instead; restore the full stack under --verbose
// or CC_DEBUG/DEBUG for debugging.
function reportFatal(err) {
  const verbose =
    process.argv.includes("--verbose") ||
    Boolean(process.env.CC_DEBUG) ||
    Boolean(process.env.DEBUG);
  if (verbose && err && err.stack) {
    process.stderr.write(`${err.stack}\n`);
  } else {
    const msg = err && err.message ? err.message : String(err);
    process.stderr.write(`error: ${msg}\n`);
  }
  process.exit(1);
}

const program = createProgram();
program.parseAsync(process.argv).catch(reportFatal);
