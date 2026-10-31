import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  nativePluginArtifactBinding,
  verifyNativePluginArtifactMetadata,
  readNativePluginArtifact,
} from "../scripts/verify01-native-plugin-artifact.mjs";

const payload = Buffer.alloc(100001, 7);
const manifest = {
  versions: { jetbrains: "0.4.189" },
  origin: {
    jetbrains: {
      distribution: "github-actions-artifact",
      repository: "chainlesschain/chainlesschain",
      sourceCommit: "a".repeat(40),
      artifactDigest: `sha256:${"b".repeat(64)}`,
      runId: 123,
      artifactId: 456,
      artifactName: "chainlesschain-ide-jetbrains-1",
      tag: "ide-jetbrains-v0.4.189",
      file: "chainlesschain-ide-bridge-0.4.189.zip",
      workflow: ".github/workflows/ide-extensions.yml",
    },
  },
  publicArtifacts: {
    jetbrains: {
      digest: `sha256:${createHash("sha256").update(payload).digest("hex")}`,
      bytes: payload.length,
    },
  },
};
const run = {
  id: 123,
  head_sha: "a".repeat(40),
  head_branch: "ide-jetbrains-v0.4.189",
  path: ".github/workflows/ide-extensions.yml",
  event: "push",
  status: "completed",
  conclusion: "success",
  repository: { id: 789, full_name: "chainlesschain/chainlesschain" },
};
const artifact = {
  id: 456,
  name: "chainlesschain-ide-jetbrains-1",
  expired: false,
  digest: `sha256:${"b".repeat(64)}`,
  workflow_run: { id: 123, head_sha: "a".repeat(40), repository_id: 789 },
};

test("exact tested build is accepted without claiming Marketplace approval", () => {
  const binding = nativePluginArtifactBinding(manifest);
  assert.equal(binding.distribution, "github-actions-artifact");
  assert.equal(
    verifyNativePluginArtifactMetadata(binding, run, artifact),
    true,
  );
  assert.equal(
    nativePluginArtifactBinding({ origin: { jetbrains: { approved: true } } }),
    null,
  );
});

test("build selection rejects unknown channels, sources, paths and versions", () => {
  for (const mutation of [
    (x) => (x.origin.jetbrains.distribution = "unverified-local"),
    (x) => (x.origin.jetbrains.repository = "other/repository"),
    (x) => (x.origin.jetbrains.sourceCommit = "main"),
    (x) => (x.origin.jetbrains.runId = 0),
    (x) => (x.origin.jetbrains.artifactId = "456"),
    (x) => (x.origin.jetbrains.file = "../plugin.zip"),
    (x) => (x.versions.jetbrains = "0.4.190"),
    (x) => (x.publicArtifacts.jetbrains.digest = "unknown"),
    (x) => (x.publicArtifacts.jetbrains.bytes = 999999999),
  ]) {
    const candidate = structuredClone(manifest);
    mutation(candidate);
    assert.throws(() => nativePluginArtifactBinding(candidate));
  }
});

test("metadata rejects failed, unrelated, expired or substituted official artifacts", () => {
  const binding = nativePluginArtifactBinding(manifest);
  for (const mutation of [
    (r) => (r.conclusion = "failure"),
    (r) => (r.status = "in_progress"),
    (r) => (r.event = "pull_request"),
    (r) => (r.head_sha = "c".repeat(40)),
    (r) => (r.head_branch = "other-tag"),
    (r) => (r.path = ".github/workflows/other.yml"),
    (r, a) => (a.expired = true),
    (r, a) => (a.id = 457),
    (r, a) => (a.digest = `sha256:${"c".repeat(64)}`),
    (r, a) => (a.workflow_run.id = 124),
    (r, a) => (a.workflow_run.head_sha = "c".repeat(40)),
    (r, a) => (a.workflow_run.repository_id = 790),
  ]) {
    const r = structuredClone(run),
      a = structuredClone(artifact);
    mutation(r, a);
    assert.throws(() => verifyNativePluginArtifactMetadata(binding, r, a));
  }
});

test("installed archive requires explicit binding and exact original payload bytes", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "native-plugin-build-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const file = path.join(root, "plugin.zip");
  fs.writeFileSync(file, payload);
  assert.deepEqual(readNativePluginArtifact(manifest, file).bytes, payload);
  assert.throws(() => readNativePluginArtifact(manifest));
  assert.throws(() => readNativePluginArtifact({}, file));
  assert.equal(readNativePluginArtifact({}, undefined), null);
  const changed = Buffer.from(payload);
  changed[100000] ^= 1;
  fs.writeFileSync(file, changed);
  assert.throws(
    () => readNativePluginArtifact(manifest, file),
    /digest mismatch/u,
  );
  fs.writeFileSync(file, payload.subarray(0, -1));
  assert.throws(() => readNativePluginArtifact(manifest, file));
});
