import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  validateArtifact,
  npmEntrypoint,
} from "../scripts/verify01-public-cli-matrix-diagnostic.mjs";

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
