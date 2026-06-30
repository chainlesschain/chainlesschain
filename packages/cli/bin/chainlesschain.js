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

// Lazy dispatch: import only the ONE command's module instead of eagerly
// loading all ~154 command modules (the ~2.7s cold-start cost). runCli falls
// back to the full eager program for --help / no-args / unknown commands.
import { runCli } from "../src/lazy-dispatch.js";
import {
  reportFatal,
  installGlobalErrorHandlers,
} from "../src/lib/fatal-handler.js";

// Funnel rejections/exceptions that escape a command action (async event
// handlers, detached tasks, third-party libs) through the same friendly
// boundary as the top-level parse, instead of Node's default ugly-stack crash.
installGlobalErrorHandlers();

runCli(process.argv).catch(reportFatal);
