"use strict";
// Actor files are guarded by the native supervisor. This
// preload validates observations; it is not the broker or a production gate.
const fs = require("node:fs");
const { isMainThread, threadId } = require("node:worker_threads");
const path = require("node:path").win32;
const identity = require("./windows-node-private-v4-identity.cjs");
const insist = (condition, message) => {
  if (!condition) throw new Error("Private v4 preload: " + message);
};
const manifestPath = identity.selectManifestPath(
  process.env.CC_PRIVATE_V4_MANIFEST,
);
const manifestBytes = identity.readPlain(manifestPath, 32768);
const manifest = identity.validateManifest(manifestBytes.toString("utf8"));
identity.validateManifestPath(manifestPath, manifest);
identity.validateProcessContext(
  {
    platform: process.platform,
    arch: process.arch,
    execPath: process.execPath,
    nodeVersion: process.versions.node,
    modulesAbi: process.versions.modules,
    pid: process.pid,
  },
  manifest,
);
const files = Object.fromEntries(
  Object.entries(manifest.files).map(([name, file]) => {
    const logical = path.join(manifest.root.logical, file.path);
    const bytes = identity.readPlain(
      logical,
      name === "addon" ? 32 * 1024 * 1024 : 128 * 1024,
    );
    insist(
      bytes.length === file.bytes && identity.digest(bytes) === file.sha256,
      "guarded artifact digest differs: " + name,
    );
    return [name, logical];
  }),
);
insist(
  __filename === files.preload &&
    path.join(__dirname, "windows-node-private-v4-identity.cjs") ===
      files.identity,
  "preload must use its fixed logical location",
);
// In particular, do not open process.execPath through C: and then treat access
// denial as a reason to skip validation. Read X: and verify the held C/X pair.
const runtimeBytes = identity.readPlain(
  manifest.runtime.logical,
  256 * 1024 * 1024,
);
insist(
  runtimeBytes.length === manifest.runtime.bytes &&
    identity.digest(runtimeBytes) === manifest.runtime.sha256,
  "guarded logical runtime digest differs",
);
const addon = require(files.addon);
insist(
  typeof addon.install === "function" &&
    typeof addon.snapshot === "function" &&
    typeof addon.inspectPrivateIdentity === "function",
  "active native v4 interface missing",
);
function inspectAdapter(raw) {
  const value = JSON.parse(raw);
  insist(
    value.state === 2 &&
      value.patches === (manifest.stage === "frozen-forks" ? 6 : 5) &&
      value.installError === 0 &&
      value.pid === process.pid &&
      value.appContainerSid === manifest.appContainerSid &&
      value.capabilityCount === 0 &&
      value.inJob === true,
    "native adapter installation differs",
  );
  return value;
}
const installed = inspectAdapter(
  isMainThread
    ? addon.install(manifest.appContainerSid, process.pid)
    : addon.snapshot(),
);
const firstIdentity = identity.inspectPrivateIdentity(
  addon.inspectPrivateIdentity(),
  manifest,
);
// AppContainer startup rewrites TEMP despite the host's explicit environment.
// Restore the guarded launch's intended scratch after proving its private map.
process.env.TEMP = "X:\\scratch";
process.env.TMP = "X:\\scratch";
// The host creates a child with its physical cwd because only the child has
// X:. Switch after the paired proof and actor handshake bind that private map.
if (
  isMainThread &&
  manifest.stage === "frozen-forks" &&
  manifest.role !== "root"
) {
  process.chdir("X:\\workspace\\tree\\packages\\cli");
}
const binding = JSON.stringify(firstIdentity);
const manifestSha256 = identity.digest(manifestBytes);
const receiptDirectory = "X:\\scratch\\adapter-receipts";
const receiptStat = fs.lstatSync(receiptDirectory);
insist(
  receiptStat.isDirectory() && !receiptStat.isSymbolicLink(),
  "fixed receipt directory required",
);
function observe() {
  const paired = identity.inspectPrivateIdentity(
    addon.inspectPrivateIdentity(),
    manifest,
  );
  insist(JSON.stringify(paired) === binding, "native paired identity changed");
  insist(
    identity.digest(identity.readPlain(manifestPath, 32768)) === manifestSha256,
    "guarded manifest changed",
  );
  return { paired, adapter: inspectAdapter(addon.snapshot()) };
}
function record(phase, observation, exitCode) {
  const receipt = {
    schema: "chainlesschain.windows-node-private-preload/v4",
    status: "NOT_ADMITTED",
    trusted: false,
    admissionEligible: false,
    stage: manifest.stage,
    role: manifest.role,
    ...(manifest.actor ? { actor: manifest.actor } : {}),
    phase,
    pid: process.pid,
    ppid: process.ppid,
    parentage: "host-broker-created",
    manifestSha256,
    manifestPath,
    sessionId: manifest.sessionId,
    generation: manifest.generation,
    ...observation,
    ...(exitCode === undefined
      ? {}
      : { exitCode, exitDisposition: "process-exit-intent" }),
  };
  fs.writeFileSync(
    path.join(receiptDirectory, `private-v4-${process.pid}-${phase}.json`),
    JSON.stringify(receipt) + "\n",
    { flag: "wx" },
  );
  return receipt;
}
// A WorkerThread shares this process's native installation and creation actor.
// It neither installs hooks again nor writes a second process lifecycle receipt.
const installation = isMainThread
  ? record("installed", {
      paired: firstIdentity,
      adapter: installed,
    })
  : Object.freeze({
      status: "NOT_ADMITTED",
      trusted: false,
      scope: "worker-thread-observation",
      pid: process.pid,
      threadId,
      paired: firstIdentity,
      adapter: installed,
    });
if (isMainThread)
  process.once("exit", (exitCode) => record("exit", observe(), exitCode));
module.exports = Object.freeze({
  status: "NOT_ADMITTED",
  admissionEligible: false,
  installation,
  snapshot: observe,
  unsupported: Object.freeze([
    ...(manifest.actor
      ? ["unregistered-node-fork"]
      : ["node-fork-broker-operation"]),
    "full-frozen-review",
    "durable-recovery",
  ]),
});
