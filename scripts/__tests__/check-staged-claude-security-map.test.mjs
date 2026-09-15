import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  MAP_PATH,
  checkStagedSecurityMap,
} from "../check-staged-claude-security-map.mjs";

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function mapBytes(source, testId = "protects the main checkout") {
  return Buffer.from(
    JSON.stringify({
      rows: [
        {
          id: "cc-test",
          testId,
          producer: {
            path: "packages/cli/__tests__/unit/security.test.js",
            sha256: digest(source),
          },
        },
      ],
    }),
  );
}

test("skips unrelated staged changes", () => {
  const result = checkStagedSecurityMap({
    mapBytes: mapBytes("it('protects the main checkout', () => {})"),
    readBlob: () => Buffer.from("ignored"),
    stagedPaths: ["docs/readme.md"],
  });
  assert.deepEqual(result, { checked: false, issues: [] });
});

test("rejects a changed mapped producer with a stale staged digest", () => {
  const source = "it('protects the main checkout', () => {})";
  const result = checkStagedSecurityMap({
    mapBytes: mapBytes(source),
    readBlob: () => Buffer.from(`${source}\n// changed`),
    stagedPaths: ["packages/cli/__tests__/unit/security.test.js"],
  });
  assert.deepEqual(result, {
    checked: true,
    issues: [
      {
        id: "cc-test",
        kind: "digest",
        producerPath: "packages/cli/__tests__/unit/security.test.js",
        expected: digest(source),
        actual: digest(`${source}\n// changed`),
      },
    ],
  });
});

test("rejects a digest update that no longer protects the mapped test", () => {
  const source = "it('other behavior', () => {})";
  const result = checkStagedSecurityMap({
    mapBytes: mapBytes(source),
    readBlob: () => Buffer.from(source),
    stagedPaths: [MAP_PATH],
  });
  assert.deepEqual(result, {
    checked: true,
    issues: [
      {
        id: "cc-test",
        kind: "missing-test-id",
        producerPath: "packages/cli/__tests__/unit/security.test.js",
        testId: "protects the main checkout",
      },
    ],
  });
});
