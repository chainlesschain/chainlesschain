import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

// Observe genuine ACL operations before private-storage captures its ports.
// Never replace their results or permissions with test evidence.
const require = createRequire(import.meta.url);
const cp = require("node:child_process");
const originalSpawn = cp.spawnSync;
const calls = [];
cp.spawnSync = function (executable, args, options) {
  let request;
  try {
    request = JSON.parse(options?.input);
  } catch {
    request = null;
  }
  const result = Reflect.apply(originalSpawn, this, [
    executable,
    args,
    options,
  ]);
  calls.push({
    shell: /^(?:powershell|pwsh)\.exe$/iu.test(path.basename(executable)),
    native: args?.some((arg) =>
      String(arg).endsWith("private-storage-windows-worker.cjs"),
    ),
    fileRepair:
      request?.operation === "repair" && request?.expectedKind === "file",
    succeeded: result.status === 0,
  });
  return result;
};
// Production ACL requests now reuse an isolated child through a bridge rather
// than starting one spawnSync per operation. Delegate through its real client
// and count completed requests, retaining independent live ACL checks below.
const nativeClient = require(
  path.join(
    path.dirname(
      require.resolve("@chainlesschain/session-core/private-storage"),
    ),
    "private-storage-windows-client.cjs",
  ),
);
const originalNativeRun = nativeClient.run;
nativeClient.run = function (request, ...args) {
  const result = Reflect.apply(originalNativeRun, this, [request, ...args]);
  calls.push({
    shell: false,
    native: true,
    fileRepair:
      request.operation === "repair" && request.expectedKind === "file",
    succeeded: result.status === 0,
  });
  return result;
};

const { createEvolutionLedgerFileManifestCatalogBackend: catalog } =
  await import(
    "../../src/lib/evolution/evolution-ledger-file-manifest-catalog.js"
  );
const { createEvolutionLedgerFileManifestHeadBackend: head } = await import(
  "../../src/lib/evolution/evolution-ledger-file-manifest-head-store.js"
);
const { createEvolutionFileWitness: witness } = await import(
  "../../src/lib/evolution/evolution-file-witness.js"
);
const { inspectPrivatePath } = await import("../../src/lib/secure-fs.js");
const { createLocalUiEvolutionFileSystem } = await import(
  "../../src/lib/evolution/evolution-windows-directory-durability.js"
);

const mode = process.argv[2];
assert.ok(
  [
    "default",
    "explicit-default",
    "custom",
    "local-ui",
    "custom-local-ui",
  ].includes(mode),
);
let customReads = 0;
const customFs = {
  ...fs,
  lstatSync(...args) {
    customReads++;
    return fs.lstatSync(...args);
  },
};
const localUiFs = createLocalUiEvolutionFileSystem();
if (mode === "custom-local-ui") localUiFs.lstatSync = customFs.lstatSync;
const ports =
  mode === "default"
    ? {}
    : {
        fsImpl:
          mode === "custom"
            ? customFs
            : mode.includes("local-ui")
              ? localUiFs
              : fs,
      };
const temporaryRoot = fs.realpathSync.native(os.tmpdir());
const root = fs.mkdtempSync(path.join(temporaryRoot, "cc-evolution-acl-"));
const digest = (value) =>
  `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
const trust = {
  algorithm: "hmac-sha256",
  keyId: "key://test/storage-acl",
  trustPolicyDigest: digest("storage-acl-policy"),
};
const signature = (message) =>
  crypto
    .createHmac("sha256", "test-storage-acl-key")
    .update(message)
    .digest("base64url");
const id = "storage-acl-witness";
const witnessOptions = {
  ...ports,
  filePath: path.join(root, "witness", "state.json"),
  id,
  trust,
  signer: { sign: ({ message }) => ({ ...trust, value: signature(message) }) },
  verifier: {
    verify: ({ message, signature: signed }) =>
      signed.value === signature(message),
  },
};

try {
  const observations = [];
  for (const kind of ["catalog", "head", "witness"]) {
    const start = calls.length;
    const directoryPath = path.join(root, kind);
    let publishedFile;
    if (kind === "catalog") {
      const options = { ...ports, directoryPath };
      const manifest = { manifestDigest: digest("manifest") };
      assert.equal(
        catalog(options).compareAndAppend({
          expectedManifestDigest: null,
          manifest,
        }).appended,
        true,
      );
      assert.deepEqual(catalog(options).loadLatest(), manifest);
      publishedFile = path.join(directoryPath, "manifest-catalog.json");
    } else if (kind === "head") {
      const options = { ...ports, directoryPath };
      const nextHead = { headDigest: digest("head") };
      assert.equal(
        head(options).compareAndSet({ expectedHeadDigest: null, nextHead })
          .committed,
        true,
      );
      assert.deepEqual(head(options).load(), nextHead);
      publishedFile = path.join(directoryPath, "manifest-head.json");
    } else {
      const store = witness(witnessOptions);
      const snapshot = {
        ...trust,
        anchorDigest: digest("anchor"),
        epoch: "storage-acl-epoch",
        headDigest: null,
        identityDigest: digest("identity"),
        ledgerId: "storage-acl-ledger",
        payloadDigest: digest("payload"),
        segmentDigest: null,
        sequence: 0,
        storeMarkerDigest: digest("marker"),
        storeMarkerEntryDigest: digest("marker-entry"),
        storeMarkerId: "storage-acl-marker",
        witnessId: id,
      };
      const initialized = store.initialize({
        expected: store.read(),
        snapshot,
      });
      assert.deepEqual(witness(witnessOptions).read(), initialized);
      publishedFile = witnessOptions.filePath;
    }
    const operations = calls.slice(start);
    const fileAclRepairs = operations.filter(
      (row) => row.fileRepair && row.succeeded,
    ).length;
    assert.ok(fileAclRepairs > 0, `${kind} must explicitly secure its files`);
    // Check independently after measuring backend calls; do not expose SIDs.
    for (const [label, target] of [
      ["directory", directoryPath],
      ["file", publishedFile],
    ]) {
      const inspection = inspectPrivatePath(target);
      assert.equal(
        inspection.ok,
        true,
        JSON.stringify({
          kind,
          label,
          exists: inspection.exists,
          errorCode: inspection.errorCode,
          ownerMatchesCurrent:
            typeof inspection.details?.currentSid === "string" &&
            inspection.details?.ownerSid === inspection.details?.currentSid,
          protected: inspection.details?.protected,
          aceCount: inspection.details?.aceCount,
        }),
      );
    }
    observations.push({
      kind,
      fileAclRepairs,
      shellCalls: operations.filter((row) => row.shell).length,
      nativeCalls: operations.filter((row) => row.native).length,
      ownerOnly: true,
      durableReadback: true,
    });
  }
  console.log(JSON.stringify({ mode, customReads, observations }));
} finally {
  cp.spawnSync = originalSpawn;
  nativeClient.run = originalNativeRun;
  const actual = fs.realpathSync.native(root);
  assert.equal(path.dirname(actual), temporaryRoot);
  assert.ok(path.basename(actual).startsWith("cc-evolution-acl-"));
  fs.rmSync(actual, { recursive: true, force: true });
}
