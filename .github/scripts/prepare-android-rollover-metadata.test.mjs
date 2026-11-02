import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareMetadata } from "./prepare-android-rollover-metadata.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-rollover-metadata-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const assets = path.join(root, "assets"),
    producer = path.join(root, "producer");
  fs.mkdirSync(assets);
  fs.mkdirSync(producer);
  const archive = Buffer.from("new verified public CLI archive");
  const digest = crypto.createHash("sha256").update(archive).digest("hex");
  fs.writeFileSync(path.join(assets, "cc-cli.tgz"), archive);
  fs.writeFileSync(path.join(assets, "libnode.so"), "retained native runtime");
  fs.writeFileSync(
    path.join(assets, "android-cli-bundle.json"),
    '{"cliVersion":"old"}',
  );
  fs.writeFileSync(path.join(assets, "SHA256SUMS"), "stale checksum list\n");
  const metadata = {
    schema: "chainlesschain.android-cli-registry-refresh.v1",
    cliVersion: "0.166.139",
    expectedCliSha: "e".repeat(40),
    artifact: { name: "cc-cli.tgz", sha256: digest, bytes: archive.length },
    cliProvenance: {
      commit: "e".repeat(40),
      version: "0.166.139",
      audit: { invalid: 0, missing: 0 },
    },
  };
  fs.writeFileSync(
    path.join(producer, "android-cli-bundle.json"),
    JSON.stringify(metadata),
  );
  return { assets, producer, digest, metadata };
}

test("replaces stale carried metadata and regenerates valid checksums for every asset", async (t) => {
  const f = fixture(t);
  const result = await prepareMetadata(f.assets, f.producer, f.digest);
  assert.equal(result.cliVersion, "0.166.139");
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(f.assets, "android-cli-bundle.json"))),
    f.metadata,
  );
  const rows = fs
    .readFileSync(path.join(f.assets, "SHA256SUMS"), "utf8")
    .trim()
    .split("\n");
  assert.equal(rows.length, 3);
  for (const row of rows) {
    const [digest, name] = row.split("  ");
    assert.equal(
      digest,
      crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(f.assets, name)))
        .digest("hex"),
    );
  }
  assert.equal(
    fs.readFileSync(path.join(f.assets, "libnode.so"), "utf8"),
    "retained native runtime",
  );
});

test("rejects fresh metadata for another archive before replacing the old record", async (t) => {
  const f = fixture(t);
  f.metadata.artifact.sha256 = "a".repeat(64);
  fs.writeFileSync(
    path.join(f.producer, "android-cli-bundle.json"),
    JSON.stringify(f.metadata),
  );
  await assert.rejects(prepareMetadata(f.assets, f.producer, f.digest));
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(f.assets, "android-cli-bundle.json")))
      .cliVersion,
    "old",
  );
});

test("rejects a producer without fresh metadata instead of carrying stale metadata", async (t) => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.producer, "android-cli-bundle.json"));
  await assert.rejects(prepareMetadata(f.assets, f.producer, f.digest));
});
