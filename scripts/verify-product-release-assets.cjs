#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function releaseIdentity(version, sourceSha) {
  assert.match(version, /^v\d+\.\d+\.\d+\.\d+$/, "Invalid product version");
  assert.match(sourceSha, /^[a-f0-9]{40}$/, "Invalid product source SHA");
  return version.slice(1).replace(/\.(\d+)$/, "-alpha.$1");
}

function requiredAssets(version, sourceSha, linuxName) {
  const desktop = releaseIdentity(version, sourceSha);
  assert.match(linuxName, /^[a-z0-9-]+$/, "Invalid Linux package name");
  const windows = `ChainlessChain-Setup-${desktop}.exe`;
  const macIntel = `ChainlessChain-${desktop}.dmg`;
  const macArm = `ChainlessChain-${desktop}-arm64.dmg`;
  return [
    windows,
    `${windows}.blockmap`,
    `ChainlessChain-Portable-${desktop}.exe`,
    "latest.yml",
    macIntel,
    `${macIntel}.blockmap`,
    macArm,
    `${macArm}.blockmap`,
    `ChainlessChain-${desktop}-mac.zip`,
    `ChainlessChain-${desktop}-mac.zip.blockmap`,
    `ChainlessChain-${desktop}-arm64-mac.zip`,
    `ChainlessChain-${desktop}-arm64-mac.zip.blockmap`,
    "latest-mac.yml",
    `ChainlessChain-${desktop}.AppImage`,
    `${linuxName}_${desktop}_amd64.deb`,
    `${linuxName}-${desktop}.x86_64.rpm`,
    "latest-linux.yml",
    "app-arm64-v8a-release.apk",
    "app-armeabi-v7a-release.apk",
    "app-universal-release.apk",
    "app-release.aab",
    "ChainlessChain.ipa",
  ];
}

function verifyLocalAssets(directory, version, sourceSha, linuxName) {
  const yaml = require("yaml");
  const desktop = releaseIdentity(version, sourceSha);
  const required = requiredAssets(version, sourceSha, linuxName);
  const allowed = new Set(required);
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const assets = entries
    .map((entry) => {
      assert.ok(entry.isFile(), `Unexpected non-file asset: ${entry.name}`);
      assert.ok(
        allowed.has(entry.name),
        `Unexpected product asset: ${entry.name}`,
      );
      const filename = path.join(directory, entry.name);
      const size = fs.statSync(filename).size;
      assert.ok(size > 0, `Empty product asset: ${entry.name}`);
      const sha256 = crypto.createHash("sha256");
      const sha512 = crypto.createHash("sha512");
      const buffer = Buffer.alloc(1024 * 1024);
      const fd = fs.openSync(filename, "r");
      try {
        for (let bytes; (bytes = fs.readSync(fd, buffer)) > 0;) {
          sha256.update(buffer.subarray(0, bytes));
          sha512.update(buffer.subarray(0, bytes));
        }
      } finally {
        fs.closeSync(fd);
      }
      return {
        name: entry.name,
        size,
        sha256: sha256.digest("hex"),
        sha512: sha512.digest("base64"),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const byName = new Map(assets.map((asset) => [asset.name, asset]));
  for (const name of required)
    assert.ok(byName.has(name), `Missing product asset: ${name}`);

  const metadataTargets = {
    "latest.yml": [`ChainlessChain-Setup-${desktop}.exe`],
    "latest-mac.yml": [
      `ChainlessChain-${desktop}-mac.zip`,
      `ChainlessChain-${desktop}-arm64-mac.zip`,
    ],
    "latest-linux.yml": [`ChainlessChain-${desktop}.AppImage`],
  };
  for (const [name, targets] of Object.entries(metadataTargets)) {
    const metadata = yaml.parse(
      fs.readFileSync(path.join(directory, name), "utf8"),
    );
    assert.equal(metadata?.version, desktop, `${name}: wrong update version`);
    assert.ok(
      Array.isArray(metadata.files) && metadata.files.length > 0,
      `${name}: missing update entries`,
    );
    const referenced = new Set();
    for (const file of metadata.files) {
      assert.equal(typeof file.url, "string", `${name}: invalid update URL`);
      const filename = decodeURIComponent(file.url);
      assert.equal(
        path.basename(filename),
        filename,
        `${name}: update URL must name a local asset`,
      );
      assert.ok(
        !referenced.has(filename),
        `${name}: duplicate update entry ${filename}`,
      );
      referenced.add(filename);
      const asset = byName.get(filename);
      assert.ok(asset, `${name}: missing referenced file ${filename}`);
      assert.equal(file.size, asset.size, `${name}: size mismatch ${filename}`);
      assert.equal(
        file.sha512,
        asset.sha512,
        `${name}: hash mismatch ${filename}`,
      );
      if (filename.endsWith(".AppImage")) {
        assert.ok(
          Number.isSafeInteger(file.blockMapSize) &&
            file.blockMapSize > 0 &&
            file.blockMapSize < asset.size,
          `${name}: invalid embedded blockmap ${filename}`,
        );
      }
    }
    for (const target of targets)
      assert.ok(
        referenced.has(target),
        `${name}: missing updater target ${target}`,
      );
    assert.ok(
      referenced.has(metadata.path),
      `${name}: legacy update path is absent`,
    );
    assert.equal(
      metadata.sha512,
      byName.get(metadata.path).sha512,
      `${name}: legacy update hash mismatch`,
    );
  }
  return { schema: 1, version, sourceSha, linuxName, required, assets };
}

function verifyRemoteAssets(receipt, release, version, sourceSha) {
  releaseIdentity(version, sourceSha);
  assert.equal(receipt.schema, 1, "Unsupported asset receipt");
  assert.equal(receipt.version, version, "Receipt version mismatch");
  assert.equal(receipt.sourceSha, sourceSha, "Receipt source mismatch");
  assert.equal(release.tag_name, version, "Release tag mismatch");
  const required = requiredAssets(version, sourceSha, receipt.linuxName);
  const expected = new Map(receipt.assets.map((asset) => [asset.name, asset]));
  assert.equal(
    expected.size,
    receipt.assets.length,
    "Duplicate receipt assets",
  );
  for (const name of required)
    assert.ok(expected.has(name), `Incomplete asset receipt: ${name}`);
  assert.equal(
    release.assets.length,
    expected.size,
    "Remote release asset count mismatch",
  );
  const seen = new Set();
  for (const asset of release.assets) {
    assert.ok(!seen.has(asset.name), `Duplicate remote asset: ${asset.name}`);
    seen.add(asset.name);
    const verified = expected.get(asset.name);
    assert.ok(verified, `Unexpected remote asset: ${asset.name}`);
    assert.ok(verified.size > 0, `Empty receipt asset: ${asset.name}`);
    assert.equal(
      asset.state,
      "uploaded",
      `Remote asset upload incomplete: ${asset.name}`,
    );
    assert.equal(
      asset.size,
      verified.size,
      `Remote asset size mismatch: ${asset.name}`,
    );
    assert.equal(
      asset.digest,
      `sha256:${verified.sha256}`,
      `Remote asset digest mismatch: ${asset.name}`,
    );
  }
  return {
    version,
    sourceSha,
    verifiedAssets: seen.size,
    draft: release.draft,
  };
}

if (require.main === module) {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "local") {
    const [directory, version, sourceSha, output] = args;
    const linuxName = require("../desktop-app-vue/package.json").name;
    const receipt = verifyLocalAssets(directory, version, sourceSha, linuxName);
    fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
    console.log(
      `Verified complete product release: ${receipt.assets.length} assets`,
    );
  } else if (mode === "remote") {
    const [input, second, version, sourceSha] = args;
    const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
    console.log(
      JSON.stringify(
        verifyRemoteAssets(
          readJson(input),
          readJson(second),
          version,
          sourceSha,
        ),
      ),
    );
  } else {
    throw new Error(
      "Usage: verify-product-release-assets.cjs local <dir> <version> <sha> <receipt> | remote <receipt> <release> <version> <sha>",
    );
  }
}

module.exports = { requiredAssets, verifyLocalAssets, verifyRemoteAssets };
