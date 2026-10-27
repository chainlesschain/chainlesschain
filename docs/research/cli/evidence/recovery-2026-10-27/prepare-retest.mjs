// Account-free public readback for the remaining 36+9 samples. No package code
// is executed, no candidate is edited, and no workflow or model is dispatched.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  createNativeRetestPlan,
  loadVerifiedNativeAcceptedSamples,
} from "../../../../../packages/cli/scripts/verify01-native-retest-plan.mjs";

const repository = fileURLToPath(new URL("../../../../../", import.meta.url));
const evidence = path.dirname(fileURLToPath(import.meta.url));
const readback = path.join(
  repository,
  ".work/verify01-remaining-20261027/public",
);
const publicationPath =
  "docs/research/cli/evidence/release127-public/publication.json";
const publicationBytes = fs.readFileSync(
  path.join(repository, publicationPath),
);
const publication = JSON.parse(publicationBytes);
const vscodeReceiptPath =
  "docs/research/cli/evidence/release127-public/open-vsx.json";
const vscodeReceiptBytes = fs.readFileSync(
  path.join(repository, vscodeReceiptPath),
);
const vscodeReceipt = JSON.parse(vscodeReceiptBytes);
const hash = (bytes, algorithm = "sha256") =>
  createHash(algorithm).update(bytes).digest("hex");
const digest = (bytes) => `sha256:${hash(bytes)}`;
const encoded = (value) => Buffer.from(JSON.stringify(value, null, 2) + "\n");

function writeExclusiveOrEqual(file, bytes) {
  if (fs.existsSync(file)) assert.deepEqual(fs.readFileSync(file), bytes, file);
  else fs.writeFileSync(file, bytes, { flag: "wx" });
}

fs.mkdirSync(readback, { recursive: true });
const records = [];
async function download(name, url, maximumBytes) {
  const target = path.join(readback, name);
  let bytes;
  if (fs.existsSync(target)) bytes = fs.readFileSync(target);
  else {
    assert.equal(new URL(url).protocol, "https:");
    const response = await fetch(url, { signal: AbortSignal.timeout(45000) });
    assert.equal(response.status, 200, name);
    const chunks = [];
    let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      assert.ok(length <= maximumBytes, `oversized response: ${name}`);
      chunks.push(chunk);
    }
    bytes = Buffer.concat(chunks);
    writeExclusiveOrEqual(target, bytes);
  }
  assert.ok(bytes.length > 0 && bytes.length <= maximumBytes, name);
  records.push({ file: name, url, bytes: bytes.length, digest: digest(bytes) });
  return bytes;
}

const metadataLimit = 16 * 1024 * 1024;
const npmUrl = "https://registry.npmjs.org/chainlesschain/latest";
const vscodeUrl =
  "https://open-vsx.org/api/chainlesschain/chainlesschain-ide/latest";
const jetbrainsUrl =
  "https://plugins.jetbrains.com/api/plugins/32208/updates?size=100";
const npm = JSON.parse(await download("npm.json", npmUrl, metadataLimit));
const vscode = JSON.parse(
  await download("open-vsx.json", vscodeUrl, metadataLimit),
);
const updates = JSON.parse(
  await download("jetbrains.json", jetbrainsUrl, metadataLimit),
);
assert.equal(npm.version, publication.channels.cli.version);
assert.equal(vscode.version, publication.channels.openVsx.version);
const matches = updates.filter(
  (item) => item.version === publication.channels.jetbrains.version,
);
assert.equal(matches.length, 1);
const jetbrains = matches[0];
assert.equal(jetbrains.approve, true);
assert.equal(jetbrains.listed, true);
assert.equal(jetbrains.hidden, false);
const visible = updates.filter(
  (item) =>
    item.approve === true &&
    item.listed === true &&
    item.hidden === false &&
    /^\d+\.\d+\.\d+$/u.test(item.version),
);
const sorted = visible
  .map((item) => item.version)
  .sort((left, right) => {
    const a = left.split(".").map(Number),
      b = right.split(".").map(Number);
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  });
assert.equal(sorted.at(-1), jetbrains.version);
const cliUrl = `https://registry.npmjs.org/chainlesschain/-/chainlesschain-${npm.version}.tgz`;
assert.equal(npm.dist.tarball, cliUrl);
const cliBytes = await download(
  "chainlesschain.tgz",
  cliUrl,
  128 * 1024 * 1024,
);
assert.equal(hash(cliBytes), publication.channels.cli.sha256);
assert.equal(hash(cliBytes, "sha512"), publication.channels.cli.sha512);
assert.equal(
  npm.dist.integrity,
  `sha512-${createHash("sha512").update(cliBytes).digest("base64")}`,
);
const vsixUrl = `https://open-vsx.org/api/chainlesschain/chainlesschain-ide/${vscode.version}/file/chainlesschain.chainlesschain-ide-${vscode.version}.vsix`;
assert.equal(vscode.files.download, vsixUrl);
assert.equal(
  hash(await download("chainlesschain.vsix", vsixUrl, 128 * 1024 * 1024)),
  vscodeReceipt.registryArchiveSha256,
);
assert.equal(jetbrains.id, 1203654);
assert.equal(
  jetbrains.file,
  `32208/${jetbrains.id}/chainlesschain-ide-bridge-${jetbrains.version}.zip`,
);
const zipUrl = `https://plugins.jetbrains.com/files/${jetbrains.file}`;
assert.equal(
  hash(
    await download("chainlesschain-jetbrains.zip", zipUrl, 128 * 1024 * 1024),
  ),
  publication.channels.jetbrains.publicSha256,
);

const baseline = loadVerifiedNativeAcceptedSamples();
assert.equal(baseline.acceptedIds.size, 32);
const manifestPath =
  "docs/research/cli/verify01-package-sets/2026-10-27-remaining-127.json";
const previous = JSON.parse(
  fs.readFileSync(
    path.join(
      repository,
      "docs/research/cli/verify01-package-sets/2026-10-18-task-quality-106.json",
    ),
  ),
);
const versions = {
  cli: npm.version,
  vscode: vscode.version,
  jetbrains: jetbrains.version,
  vscodeHost: previous.versions.vscodeHost,
  jetbrainsHost: previous.versions.jetbrainsHost,
};
const observationFile = path.join(readback, "observed-at.txt");
if (!fs.existsSync(observationFile))
  fs.writeFileSync(observationFile, new Date().toISOString() + "\n", {
    flag: "wx",
  });
const observedAt = fs.readFileSync(observationFile, "utf8").trim();
const manifest = {
  schema: "chainlesschain.native-package-set/v1",
  resolvedAt: observedAt,
  versions,
  origin: {
    cli: {
      url: npmUrl,
      integrity: npm.dist.integrity,
      tarball: npm.dist.tarball,
    },
    vscode: { url: vscodeUrl, download: vscode.files.download },
    jetbrains: {
      url: jetbrainsUrl,
      updateId: jetbrains.id,
      file: jetbrains.file,
      approved: true,
      listed: true,
      hidden: false,
    },
  },
};
writeExclusiveOrEqual(path.join(repository, manifestPath), encoded(manifest));
const roundName = "next-package-127-20261027";
const planPath = `docs/research/cli/evidence/implementation-plan-2026-10-15/task-campaign-2026-10-18/${roundName}-plan.json`;
const plan = fs.existsSync(path.join(repository, planPath))
  ? JSON.parse(fs.readFileSync(path.join(repository, planPath)))
  : createNativeRetestPlan({ versionsFile: manifestPath, roundName });
assert.equal(plan.plannedNewSamples, 13);
assert.equal(plan.reusedAcceptedSampleIds.length, 32);
assert.deepEqual(plan.versions, versions);
const receipt = {
  schema: "chainlesschain.remaining-native-public-readback/v1",
  observedAt,
  status: "PUBLIC_BYTES_VERIFIED_NOT_DISPATCHED",
  versions,
  publication: { path: publicationPath, digest: digest(publicationBytes) },
  vscodePublication: {
    path: vscodeReceiptPath,
    digest: digest(vscodeReceiptBytes),
  },
  packageSet: { path: manifestPath, digest: digest(encoded(manifest)) },
  plan: {
    path: planPath,
    digest: digest(fs.readFileSync(path.join(repository, planPath))),
  },
  records,
  reusedAcceptedDeliverables: 32,
  plannedNewSamples: 13,
  newModelCalls: 0,
  newAcceptedSamples: 0,
  limitations: [
    "Public package bytes match existing release receipts; package code was not executed.",
    "No native host, model generation, billing reconciliation, or formal sample admission is asserted.",
  ],
};
writeExclusiveOrEqual(
  path.join(evidence, "public-readback.json"),
  encoded(receipt),
);
const metadata = records
  .filter((record) => record.file.endsWith(".json"))
  .map((record) => {
    const archivedFile = `${record.file}.gz`;
    const compressed = gzipSync(
      fs.readFileSync(path.join(readback, record.file)),
    );
    writeExclusiveOrEqual(path.join(evidence, archivedFile), compressed);
    return { ...record, archivedFile, archivedDigest: digest(compressed) };
  });
writeExclusiveOrEqual(
  path.join(evidence, "public-metadata-index.json"),
  encoded({
    schema: "chainlesschain.remaining-native-public-metadata/v1",
    observedAt,
    records: metadata,
  }),
);
console.log(
  JSON.stringify({
    status: receipt.status,
    versions,
    planPath,
    reusedAcceptedDeliverables: 32,
    plannedNewSamples: 13,
    newModelCalls: 0,
  }),
);
