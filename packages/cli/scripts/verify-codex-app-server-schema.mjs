#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CODEX_APP_SERVER_SCHEMA_PROBE_VERSION as PROBE_VERSION,
  CODEX_APP_SERVER_SCHEMA_PROBE_VERSIONS,
} from "../src/lib/codex-app-server-support.js";

const FIXTURE_ROOT = fileURLToPath(
  new URL("../__tests__/fixtures/external-agent/", import.meta.url),
);
const FILES = Object.freeze({
  "ClientRequest.json": "request",
  "ServerNotification.json": "notification",
  "ServerRequest.json": "server-request",
  "CommandExecutionRequestApprovalResponse.json": "approval-response",
});

export function verifyGeneratedCodexSchemas(
  schemaDir,
  fixtureRoot = FIXTURE_ROOT,
  version = PROBE_VERSION,
) {
  assert.ok(
    CODEX_APP_SERVER_SCHEMA_PROBE_VERSIONS.includes(version),
    "Unconfigured Codex schema probe version",
  );
  const files = {};
  for (const [upstream, kind] of Object.entries(FILES)) {
    const fixture = `codex-app-server-${version}-${kind}.schema.json`;
    const actual = readFileSync(resolve(schemaDir, upstream));
    const expected = readFileSync(resolve(fixtureRoot, fixture));
    assert.ok(
      actual.equals(expected),
      `Generated Codex schema differs: ${upstream}`,
    );
    files[upstream] = {
      bytes: actual.length,
      sha256: createHash("sha256").update(actual).digest("hex"),
    };
  }
  return {
    upstreamVersion: version,
    schemaMatches: true,
    productionAdmission: false,
    files,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  assert.ok(
    process.argv.length === 4 || process.argv.length === 6,
    "usage: verify-codex-app-server-schema.mjs --schema-dir <directory> [--version <version>]",
  );
  assert.equal(process.argv[2], "--schema-dir");
  if (process.argv.length === 6) assert.equal(process.argv[4], "--version");
  process.stdout.write(
    `${JSON.stringify(verifyGeneratedCodexSchemas(process.argv[3], FIXTURE_ROOT, process.argv[5] || PROBE_VERSION))}\n`,
  );
}
