"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const yaml = require("yaml");
const {
  requiredAssets,
  verifyLocalAssets,
  verifyRemoteAssets,
} = require("../verify-product-release-assets.cjs");

const version = "v5.0.3.140";
const desktop = "5.0.3-alpha.140";
const sourceSha = "a".repeat(40);
const linuxName = "chainlesschain-desktop-vue";

function fixture(t) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "product-release-assets-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const name of requiredAssets(version, sourceSha, linuxName)) {
    fs.writeFileSync(path.join(directory, name), `fixture ${name}\n`);
  }
  const files = {
    "latest.yml": [`ChainlessChain-Setup-${desktop}.exe`],
    "latest-mac.yml": [
      `ChainlessChain-${desktop}-mac.zip`,
      `ChainlessChain-${desktop}-arm64-mac.zip`,
    ],
    "latest-linux.yml": [`ChainlessChain-${desktop}.AppImage`],
  };
  for (const [name, targets] of Object.entries(files)) {
    const entries = targets.map((target) => {
      const data = fs.readFileSync(path.join(directory, target));
      return {
        url: target,
        sha512: crypto.createHash("sha512").update(data).digest("base64"),
        size: data.length,
        ...(target.endsWith(".AppImage") ? { blockMapSize: 8 } : {}),
      };
    });
    fs.writeFileSync(
      path.join(directory, name),
      yaml.stringify({
        version: desktop,
        files: entries,
        path: entries[0].url,
        sha512: entries[0].sha512,
      }),
    );
  }
  return directory;
}

function local(directory) {
  return verifyLocalAssets(directory, version, sourceSha, linuxName);
}

function editMetadata(directory, name, edit) {
  const file = path.join(directory, name);
  const metadata = yaml.parse(fs.readFileSync(file, "utf8"));
  edit(metadata);
  fs.writeFileSync(file, yaml.stringify(metadata));
}

function remote(receipt) {
  return {
    tag_name: version,
    draft: true,
    assets: receipt.assets.map((asset) => ({
      name: asset.name,
      size: asset.size,
      digest: `sha256:${asset.sha256}`,
      state: "uploaded",
    })),
  };
}

test("complete desktop/mobile assets bind metadata and remote upload digests", (t) => {
  const receipt = local(fixture(t));
  assert.equal(receipt.assets.length, 22);
  assert.equal(
    verifyRemoteAssets(receipt, remote(receipt), version, sourceSha)
      .verifiedAssets,
    22,
  );
});

for (const name of [
  "ChainlessChain.ipa",
  "app-release.aab",
  "app-arm64-v8a-release.apk",
  `ChainlessChain-${desktop}-arm64-mac.zip`,
  `ChainlessChain-${desktop}-mac.zip.blockmap`,
  `ChainlessChain-${desktop}-arm64-mac.zip.blockmap`,
]) {
  test(`missing release target is rejected: ${name}`, (t) => {
    const directory = fixture(t);
    fs.unlinkSync(path.join(directory, name));
    assert.throws(() => local(directory), /Missing product asset/);
  });
}

test("simulator archive cannot substitute for signed iOS distribution", (t) => {
  const directory = fixture(t);
  fs.renameSync(
    path.join(directory, "ChainlessChain.ipa"),
    path.join(directory, "ChainlessChain-ios-simulator.zip"),
  );
  assert.throws(() => local(directory), /Unexpected product asset/);
});

test("both mac architectures must be discoverable through update metadata", (t) => {
  const directory = fixture(t);
  editMetadata(directory, "latest-mac.yml", (metadata) => metadata.files.pop());
  assert.throws(() => local(directory), /missing updater target/);
});

test("corrupt update bytes are rejected despite file presence and correct size", (t) => {
  const directory = fixture(t);
  const file = path.join(directory, `ChainlessChain-Setup-${desktop}.exe`);
  const data = fs.readFileSync(file);
  data[0] ^= 1;
  fs.writeFileSync(file, data);
  assert.throws(() => local(directory), /hash mismatch/);
});

test("stale metadata version and external update URLs are rejected", (t) => {
  const directory = fixture(t);
  editMetadata(directory, "latest.yml", (metadata) => {
    metadata.version = "5.0.3-alpha.139";
  });
  assert.throws(() => local(directory), /wrong update version/);
  editMetadata(directory, "latest.yml", (metadata) => {
    metadata.version = desktop;
    metadata.files[0].url = `https://example.com/${metadata.files[0].url}`;
  });
  assert.throws(() => local(directory), /must name a local asset/);
});

test("empty metadata and missing AppImage blockmap are rejected", (t) => {
  const directory = fixture(t);
  editMetadata(directory, "latest-linux.yml", (metadata) => {
    delete metadata.files[0].blockMapSize;
  });
  assert.throws(() => local(directory), /invalid embedded blockmap/);
  editMetadata(directory, "latest-linux.yml", (metadata) => {
    metadata.files = [];
  });
  assert.throws(() => local(directory), /missing update entries/);
});

test("empty mac ZIP sidecars block release", (t) => {
  const directory = fixture(t);
  fs.writeFileSync(
    path.join(directory, `ChainlessChain-${desktop}-mac.zip.blockmap`),
    "",
  );
  assert.throws(() => local(directory), /Empty product asset/);
});

test("remote digest mismatch, stale source, extra or incomplete uploads block finalization", (t) => {
  const receipt = local(fixture(t));
  let release = remote(receipt);
  release.assets[0].digest = `sha256:${"0".repeat(64)}`;
  assert.throws(
    () => verifyRemoteAssets(receipt, release, version, sourceSha),
    /digest mismatch/,
  );
  assert.throws(
    () => verifyRemoteAssets(receipt, remote(receipt), version, "b".repeat(40)),
    /source mismatch/,
  );
  release = remote(receipt);
  release.assets.push({ ...release.assets[0], name: "obsolete.apk" });
  assert.throws(
    () => verifyRemoteAssets(receipt, release, version, sourceSha),
    /count mismatch/,
  );
  release = remote(receipt);
  release.assets[0].state = "new";
  assert.throws(
    () => verifyRemoteAssets(receipt, release, version, sourceSha),
    /upload incomplete/,
  );
});
