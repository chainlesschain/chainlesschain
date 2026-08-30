#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { _resolveShellTimeout } from "../src/runtime/agent-core.js";
import { _resolveWindowsAclTimeout } from "../src/lib/secure-fs.js";
import { ensureHomeDir, getHomeDir } from "../src/lib/paths.js";

const configuredHome = String(process.env.CHAINLESSCHAIN_HOME || "").trim();
const expectedHome = configuredHome ? path.resolve(configuredHome) : null;
if (!expectedHome || path.resolve(getHomeDir()) !== expectedHome) {
  throw new Error(
    "formal quality runtime did not bind the isolated config home",
  );
}
if (_resolveShellTimeout(15_000) < 60_000) {
  throw new Error(
    "formal quality runtime did not apply the shell timeout floor",
  );
}
if (
  process.platform === "win32" &&
  _resolveWindowsAclTimeout(15_000) < 60_000
) {
  throw new Error(
    "formal quality runtime did not apply the Windows ACL timeout floor",
  );
}

// This intentionally performs the same owner-only home initialization that a
// real control/candidate child performs. It runs before any provider call, so a
// platform ACL regression fails without spending model budget.
ensureHomeDir();
process.stdout.write(
  `${JSON.stringify({ status: "passed", home: expectedHome })}\n`,
);
