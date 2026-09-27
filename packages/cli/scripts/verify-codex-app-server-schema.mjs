#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE_ROOT = fileURLToPath(
  new URL("../__tests__/fixtures/external-agent/", import.meta.url),
);
const FILES = Object.freeze({
  "ClientRequest.json": "codex-app-server-0.157.1-request.schema.json",
  "ServerNotification.json":
    "codex-app-server-0.157.1-notification.schema.json",
  "ServerRequest.json": "codex-app-server-0.157.1-server-request.schema.json",
  "CommandExecutionRequestApprovalResponse.json":
    "codex-app-server-0.157.1-approval-response.schema.json",
});

export function verifyGeneratedCodexSchemas(
  schemaDir,
  fixtureRoot = FIXTURE_ROOT,
) {
  const files = {};
  for (const [upstream, fixture] of Object.entries(FILES)) {
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
    upstreamVersion: "0.157.1",
    schemaMatches: true,
    productionAdmission: false,
    files,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  assert.equal(
    process.argv.length,
    4,
    "usage: verify-codex-app-server-schema.mjs --schema-dir <directory>",
  );
  assert.equal(process.argv[2], "--schema-dir");
  process.stdout.write(
    `${JSON.stringify(verifyGeneratedCodexSchemas(process.argv[3]))}\n`,
  );
}
