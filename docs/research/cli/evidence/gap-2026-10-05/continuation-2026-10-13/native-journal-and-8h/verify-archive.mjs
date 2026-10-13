import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import zlib from "node:zlib";

const directory = new URL("./", import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL("manifest.json", directory)));
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
assert.equal(manifest.artifacts.length, manifest.artifactCount);
for (const entry of manifest.artifacts) {
  assert.match(entry.path, /^objects\/[a-f0-9]{64}\.gz$/u);
  const bytes = fs.readFileSync(new URL(entry.path, directory));
  assert.equal(bytes.length, entry.storedBytes, entry.label);
  assert.equal(sha256(bytes), entry.storedSha256, entry.label);
  const original = zlib.gunzipSync(bytes, { maxOutputLength: 16 * 1024 * 1024 });
  assert.equal(original.length, entry.sourceBytes, entry.label);
  assert.equal(sha256(original), entry.sourceSha256, entry.label);
}
console.log(JSON.stringify({ valid: true, artifacts: manifest.artifactCount }));
