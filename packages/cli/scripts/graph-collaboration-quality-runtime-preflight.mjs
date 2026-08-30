#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { _resolveShellTimeout } from "../src/runtime/agent-core.js";
import { _resolveWindowsAclTimeout } from "../src/lib/secure-fs.js";
import { getHomeDir } from "../src/lib/paths.js";
import {
  formalQualityProvider,
  isFormalQualityHermeticRuntime,
} from "../src/lib/formal-quality-eval-runtime.js";

const configuredHome = String(process.env.CHAINLESSCHAIN_HOME || "").trim();
const expectedHome = configuredHome ? path.resolve(configuredHome) : null;
if (!expectedHome || path.resolve(getHomeDir()) !== expectedHome) {
  throw new Error(
    "formal quality runtime did not bind the isolated config home",
  );
}
if (!isFormalQualityHermeticRuntime(process.env)) {
  throw new Error(
    "formal quality runtime did not enable hermetic headless mode",
  );
}
const provider = formalQualityProvider(process.env);
if (!provider || provider !== String(process.env.LLM_PROVIDER || "")) {
  throw new Error("formal quality runtime did not bind the exact provider");
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

process.stdout.write(
  `${JSON.stringify({ status: "passed", home: expectedHome, hermetic: true, provider })}\n`,
);
