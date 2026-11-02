import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function sha256(file) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export async function prepareMetadata(assets, producer, expectedDigest) {
  assert.match(expectedDigest, /^[a-f0-9]{64}$/);
  const archive = path.join(assets, "cc-cli.tgz");
  const metadataFile = path.join(producer, "android-cli-bundle.json");
  const metadataBytes = fs.readFileSync(metadataFile);
  const metadata = JSON.parse(metadataBytes);
  assert.equal(
    metadata.schema,
    "chainlesschain.android-cli-registry-refresh.v1",
  );
  assert.equal(metadata.artifact.name, "cc-cli.tgz");
  assert.equal(metadata.artifact.sha256, expectedDigest);
  assert.equal(await sha256(archive), expectedDigest);
  assert.equal(metadata.artifact.bytes, fs.statSync(archive).size);
  assert.match(metadata.expectedCliSha, /^[a-f0-9]{40}$/);
  assert.equal(metadata.cliProvenance.commit, metadata.expectedCliSha);
  assert.equal(metadata.cliProvenance.version, metadata.cliVersion);
  assert.equal(metadata.cliProvenance.audit.invalid, 0);
  assert.equal(metadata.cliProvenance.audit.missing, 0);
  fs.writeFileSync(path.join(assets, "android-cli-bundle.json"), metadataBytes);
  const checksums = [];
  for (const entry of fs.readdirSync(assets).sort()) {
    if (entry === "SHA256SUMS") continue;
    assert.ok(!/[\r\n\\]/.test(entry), "Invalid checksum filename");
    const file = path.join(assets, entry);
    assert.ok(
      fs.lstatSync(file).isFile(),
      "Only regular release assets are allowed",
    );
    checksums.push(`${await sha256(file)}  ${entry}`);
  }
  fs.writeFileSync(
    path.join(assets, "SHA256SUMS"),
    `${checksums.join("\n")}\n`,
  );
  return {
    cliVersion: metadata.cliVersion,
    source: metadata.expectedCliSha,
    sha256: expectedDigest,
    checksummedAssets: checksums.length,
  };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  prepareMetadata(...process.argv.slice(2)).then(
    (result) => console.log(JSON.stringify(result)),
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
}
