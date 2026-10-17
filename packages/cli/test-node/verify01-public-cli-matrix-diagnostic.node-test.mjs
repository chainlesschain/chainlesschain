import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  validateArtifact,
  npmEntrypoint,
  AUTHENTICATION_NODE_FLAGS,
} from "../scripts/verify01-public-cli-matrix-diagnostic.mjs";

test("authentication flags change only Node connection establishment defaults", () => {
  const observed = JSON.parse(
    execFileSync(
      process.execPath,
      [
        ...AUTHENTICATION_NODE_FLAGS,
        "--input-type=module",
        "--eval",
        "import net from 'node:net';console.log(JSON.stringify({autoSelectFamily:net.getDefaultAutoSelectFamily(),attemptTimeoutMs:net.getDefaultAutoSelectFamilyAttemptTimeout(),argv:process.argv.slice(1)}))",
        "--",
        "llm",
        "test",
        "--json",
      ],
      { encoding: "utf8" },
    ),
  );
  assert.deepEqual(observed, {
    autoSelectFamily: true,
    attemptTimeoutMs: 2000,
    argv: ["llm", "test", "--json"],
  });
});

test("artifact acceptance rejects wrong nonce, arithmetic and added fields", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-matrix-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (value) =>
    fs.writeFileSync(path.join(root, "result.json"), JSON.stringify(value));
  const correct = { nonce: "unique", sum: 23, sorted: [2, 4, 8, 9] };
  write(correct);
  assert.equal(validateArtifact(root, "unique").passed, true);
  for (const invalid of [
    { ...correct, nonce: "old" },
    { ...correct, sum: 24 },
    { ...correct, sorted: [9, 2, 8, 4] },
    { ...correct, extra: true },
  ]) {
    write(invalid);
    assert.throws(() => validateArtifact(root, "unique"));
  }
});

test("npm execution uses a real JS entrypoint without a shell wrapper", () => {
  assert.ok(fs.existsSync(npmEntrypoint()));
  assert.match(npmEntrypoint(), /npm-cli\.js$/u);
});
