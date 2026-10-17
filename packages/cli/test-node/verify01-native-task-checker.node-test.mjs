import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  artifactFile,
  validateNativeCandidate,
  assertFrozenBefore,
  assessFrozenBefore,
} from "../scripts/verify01-native-task-checker.mjs";

test("accepts only exact bounded candidate bytes at the catalog path", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "native-check-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = "packages/cli/__tests__/regression.test.js",
    candidatePath = `verify-01/candidate/${file}`;
  fs.mkdirSync(path.dirname(path.join(root, candidatePath)), {
    recursive: true,
  });
  const bytes = Buffer.from("model delivery\n");
  fs.writeFileSync(path.join(root, candidatePath), bytes);
  const row = {
    sampleId: "verify-01",
    expectedFiles: [file],
    candidates: [
      {
        file,
        path: candidatePath,
        bytes: bytes.length,
        digest: "sha256:" + createHash("sha256").update(bytes).digest("hex"),
      },
    ],
  };
  assert.deepEqual(
    validateNativeCandidate(root, row, { expectedFiles: [file] })[0].bytes,
    bytes,
  );
  fs.appendFileSync(path.join(root, candidatePath), "changed");
  assert.throws(
    () => validateNativeCandidate(root, row, { expectedFiles: [file] }),
    /digest mismatch/u,
  );
  assert.throws(
    () =>
      validateNativeCandidate(
        root,
        { ...row, candidates: [...row.candidates, ...row.candidates] },
        { expectedFiles: [file] },
      ),
    /duplicate/u,
  );
  assert.throws(() =>
    validateNativeCandidate(
      root,
      { ...row, candidates: [{ ...row.candidates[0], path: "other.txt" }] },
      { expectedFiles: [file] },
    ),
  );
});

test("canonical source stays exact and Windows mismatches require archive-derived evidence", () => {
  const frozen = { docs: { type: "directory" } };
  assert.deepEqual(assessFrozenBefore(frozen, frozen, "win32"), {
    exact: true,
    contentVerified: true,
    filenameEncoding: "utf8",
  });
  const extra = { ...frozen, injected: { type: "directory" } };
  assert.throws(() => assessFrozenBefore(frozen, extra, "win32"));
  assert.throws(() =>
    assessFrozenBefore(frozen, extra, "linux", {
      archiveBytes: Buffer.alloc(1024),
      canonicalSnapshot: frozen,
      expectedFiles: [],
    }),
  );
});

test("artifact paths reject traversal and alternate stream syntax", () => {
  for (const file of [
    "../secret",
    "/secret",
    "a/../../secret",
    "a\\secret",
    "C:/secret",
    "a:stream",
    "a//b",
    "./a",
  ])
    assert.throws(() => artifactFile(os.tmpdir(), file), /unsafe/u);
});

test("native initial tree must match all frozen content, permitting platform mode differences", () => {
  const frozen = {
    src: { type: "directory" },
    "src/file.js": {
      type: "file",
      bytes: 4,
      digest: "sha256:abc",
      mode: 0o755,
    },
  };
  const native = structuredClone(frozen);
  native["src/file.js"].mode = 0o644;
  assert.doesNotThrow(() => assertFrozenBefore(frozen, native));
  native["src/file.js"].digest = "sha256:modified";
  assert.throws(
    () => assertFrozenBefore(frozen, native),
    /initial bytes differ/u,
  );
  assert.throws(
    () =>
      assertFrozenBefore(frozen, { ...frozen, extra: { type: "directory" } }),
    /initial tree differs/u,
  );
});
