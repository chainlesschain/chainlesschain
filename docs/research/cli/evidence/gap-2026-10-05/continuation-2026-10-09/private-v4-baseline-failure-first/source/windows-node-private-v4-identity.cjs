"use strict";
// Diagnostic contract only. The native custodian supplies the guarded manifest
// and held-handle observations. Parsing these facts never grants authority.
const fs = require("node:fs");
const path = require("node:path").win32;
const { createHash } = require("node:crypto");

const MANIFEST_SCHEMA = "chainlesschain.windows-node-private-manifest/v4";
const IDENTITY_SCHEMA = "chainlesschain.windows-private-identity/v4";
const MANIFEST_PATH = "X:\\control\\windows-node-private-v4.manifest.json";
const RUNTIME_SHA256 =
  "ae1a50511be58e987483fdbc12125407443926d2d394669ade2352776e920dd3";
const NODE_VERSION = "22.22.2";
const MODULES_ABI = "127";
const FILES = Object.freeze({
  identity: "workspace/adapter/windows-node-private-v4-identity.cjs",
  preload: "workspace/adapter/windows-node-private-v4-preload.cjs",
  addon: "workspace/adapter/windows-node-private-v4.node",
});
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const SID = /^S-1-15-2-(?:[0-9]+-){6}[0-9]+$/u;
const insist = (condition, message) => {
  if (!condition) throw new Error("Private v4 identity: " + message);
};
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function parse(value, bound = 65536) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  insist(
    typeof text === "string" && Buffer.byteLength(text) <= bound,
    "bounded JSON required",
  );
  const parsed = JSON.parse(text);
  insist(
    parsed && typeof parsed === "object" && !Array.isArray(parsed),
    "JSON object required",
  );
  return parsed;
}
function exactKeys(value, keys, label) {
  insist(
    value && Object.keys(value).sort().join() === [...keys].sort().join(),
    label + " fields differ",
  );
}
function plainDos(value) {
  insist(
    typeof value === "string" &&
      /^[A-Z]:\\/u.test(value) &&
      path.normalize(value) === value &&
      !/["%<>|?*]/u.test(value) &&
      ![...value].some((character) => character.charCodeAt(0) < 32) &&
      !value.slice(2).includes(":"),
    "canonical local DOS path required",
  );
  for (const component of value.slice(3).split("\\").filter(Boolean)) {
    insist(
      component.length <= 255 &&
        !/[. ]$/u.test(component) &&
        !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu.test(component),
      "ambiguous path component",
    );
  }
  return value;
}
function validateActor(actor, role) {
  exactKeys(
    actor,
    ["registrationId", "pid", "role", "parentRegistrationId"],
    "actor",
  );
  insist(
    ["root", "worker", "report-helper"].includes(role) &&
      actor.role === role &&
      UUID.test(actor.registrationId) &&
      Number.isSafeInteger(actor.pid) &&
      actor.pid > 0 &&
      actor.pid <= 0xffffffff &&
      (role === "root"
        ? actor.parentRegistrationId === null
        : UUID.test(actor.parentRegistrationId) &&
          actor.parentRegistrationId !== actor.registrationId),
    "actor registration differs",
  );
}
function selectManifestPath(value) {
  const selected = value === undefined ? MANIFEST_PATH : value;
  insist(
    typeof selected === "string" &&
      (selected === MANIFEST_PATH ||
        /^X:\\control\\windows-node-private-v4\.(?:worker|report-helper)-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.manifest\.json$/u.test(
          selected,
        )),
    "manifest location is not a fixed actor path",
  );
  return selected;
}
function validateManifestPath(value, manifestInput) {
  const manifest = validateManifest(manifestInput);
  const expected =
    manifest.role !== "root"
      ? `X:\\control\\windows-node-private-v4.${manifest.role}-${manifest.actor.registrationId}.manifest.json`
      : MANIFEST_PATH;
  insist(
    selectManifestPath(value) === expected,
    "manifest location differs from actor registration",
  );
  return expected;
}
function validateManifest(value) {
  const manifest = parse(value, 32768);
  const actors = manifest.stage === "frozen-forks";
  exactKeys(
    manifest,
    [
      "schema",
      "status",
      "experimental",
      "admissionEligible",
      "stage",
      "role",
      "sessionId",
      "generation",
      "appContainerSid",
      "root",
      "runtime",
      "files",
      ...(actors ? ["actor"] : []),
    ],
    "manifest",
  );
  insist(
    manifest.schema === MANIFEST_SCHEMA &&
      manifest.status === "NOT_ADMITTED" &&
      manifest.experimental === true &&
      manifest.admissionEligible === false &&
      (actors || manifest.stage === "same-sid-esbuild-service") &&
      (actors || manifest.role === "root"),
    "scope or role differs",
  );
  if (actors) validateActor(manifest.actor, manifest.role);
  insist(
    UUID.test(manifest.sessionId) &&
      UUID.test(manifest.generation) &&
      SID.test(manifest.appContainerSid),
    "session/generation/SID malformed",
  );
  exactKeys(manifest.root, ["physical", "logical"], "root");
  plainDos(manifest.root.physical);
  insist(
    manifest.root.physical.startsWith("C:\\") &&
      manifest.root.physical.length > 3 &&
      !manifest.root.physical.endsWith("\\") &&
      manifest.root.logical === "X:\\",
    "paired private roots differ",
  );
  exactKeys(
    manifest.runtime,
    ["physical", "logical", "sha256", "bytes", "nodeVersion", "modulesAbi"],
    "runtime",
  );
  insist(
    manifest.runtime.physical ===
      path.join(manifest.root.physical, "control", "node.exe") &&
      manifest.runtime.logical === "X:\\control\\node.exe" &&
      manifest.runtime.sha256 === RUNTIME_SHA256 &&
      Number.isSafeInteger(manifest.runtime.bytes) &&
      manifest.runtime.bytes > 0 &&
      manifest.runtime.bytes <= 256 * 1024 * 1024 &&
      manifest.runtime.nodeVersion === NODE_VERSION &&
      manifest.runtime.modulesAbi === MODULES_ABI,
    "fixed runtime identity differs",
  );
  exactKeys(manifest.files, Object.keys(FILES), "files");
  for (const [name, relative] of Object.entries(FILES)) {
    const file = manifest.files[name];
    exactKeys(file, ["path", "sha256", "bytes"], name);
    insist(
      file.path === relative &&
        SHA256.test(file.sha256) &&
        Number.isSafeInteger(file.bytes) &&
        file.bytes > 0 &&
        file.bytes <= (name === "addon" ? 32 * 1024 * 1024 : 128 * 1024),
      "listed artifact differs: " + name,
    );
  }
  return freeze(manifest);
}
// Host-side description builder. The returned object alone is never a guarded
// authority; the native supervisor must create and hold the actual files.
function createPrivateManifest({
  physicalRoot,
  sessionId,
  generation,
  appContainerSid,
  runtimeBytes,
  files,
  actor,
}) {
  return validateManifest({
    schema: MANIFEST_SCHEMA,
    status: "NOT_ADMITTED",
    experimental: true,
    admissionEligible: false,
    stage: actor ? "frozen-forks" : "same-sid-esbuild-service",
    role: actor?.role ?? "root",
    ...(actor ? { actor } : {}),
    sessionId,
    generation,
    appContainerSid,
    root: { physical: physicalRoot, logical: "X:\\" },
    runtime: {
      physical: path.join(physicalRoot, "control", "node.exe"),
      logical: "X:\\control\\node.exe",
      sha256: RUNTIME_SHA256,
      bytes: runtimeBytes,
      nodeVersion: NODE_VERSION,
      modulesAbi: MODULES_ABI,
    },
    files: Object.fromEntries(
      Object.entries(FILES).map(([name, relative]) => [
        name,
        { path: relative, ...files[name] },
      ]),
    ),
  });
}
function inspectObject(value, expectedPath, directory, physical) {
  insist(
    value &&
      value.path === expectedPath &&
      value.directory === directory &&
      value.reparse === false &&
      Number.isSafeInteger(value.links) &&
      value.links > 0 &&
      (directory || value.links === 1),
    "plain pinned object differs",
  );
  insist(
    physical
      ? ["globalroot", "host-inherited-handle"].includes(value.accessMode)
      : value.accessMode === "logical-dos",
    "physical access provenance or logical open differs",
  );
  insist(
    typeof value.ntPath === "string" &&
      /^\\Device\\HarddiskVolume[1-9][0-9]*\\/u.test(value.ntPath) &&
      !value.ntPath.includes("\\..") &&
      !value.ntPath.includes("\\.\\") &&
      !value.ntPath.includes("/") &&
      ![...value.ntPath].some((character) => character.charCodeAt(0) < 32),
    "canonical NT identity missing",
  );
  insist(
    typeof value.volumeSerial === "string" &&
      /^[1-9][0-9]{0,19}$/u.test(value.volumeSerial) &&
      BigInt(value.volumeSerial) <= 0xffffffffffffffffn &&
      typeof value.fileId === "string" &&
      /^[a-f0-9]{32}$/u.test(value.fileId) &&
      !/^0+$/u.test(value.fileId),
    "kernel object identity malformed",
  );
}
function inspectPair(pair, physical, logical, directory) {
  insist(
    pair?.handlesHeldTogether === true && pair?.componentsGuarded === true,
    "simultaneous held handles and guarded components required",
  );
  inspectObject(pair.physical, physical, directory, true);
  inspectObject(pair.logical, logical, directory, false);
  for (const field of ["ntPath", "volumeSerial", "fileId", "links"])
    insist(
      pair.physical[field] === pair.logical[field],
      "C/X objects differ: " + field,
    );
}
function inspectPrivateIdentity(raw, manifestInput) {
  const manifest = validateManifest(manifestInput),
    native = parse(raw);
  insist(
    native.schema === IDENTITY_SCHEMA &&
      native.status === "NOT_ADMITTED" &&
      native.role === manifest.role &&
      native.sessionId === manifest.sessionId &&
      native.generation === manifest.generation &&
      native.nodeVersion === NODE_VERSION &&
      native.modulesAbi === MODULES_ABI,
    "native launch binding differs",
  );
  if (manifest.actor) {
    validateActor(native.actor, manifest.role);
    insist(
      native.brokerBinding === "exclusive-channel-original-creation-handle" &&
        Object.keys(manifest.actor).every(
          (key) => native.actor[key] === manifest.actor[key],
        ),
      "native broker actor binding differs",
    );
  } else
    insist(
      native.actor === undefined && native.brokerBinding === undefined,
      "initial root cannot carry an unbound actor",
    );
  insist(
    native.token?.appContainerSid === manifest.appContainerSid &&
      native.token.capabilityCount === 0 &&
      native.token.inJob === true,
    "native token or Job membership differs",
  );
  inspectPair(native.root, manifest.root.physical, manifest.root.logical, true);
  inspectPair(
    native.runtime,
    manifest.runtime.physical,
    manifest.runtime.logical,
    false,
  );
  insist(
    native.runtime.physical.ntPath ===
      native.root.physical.ntPath + "\\control\\node.exe" &&
      native.runtime.physical.volumeSerial ===
        native.root.physical.volumeSerial &&
      native.runtime.sha256 === manifest.runtime.sha256 &&
      native.runtime.bytes === manifest.runtime.bytes,
    "runtime is not the fixed object beneath the guarded root",
  );
  return freeze({
    status: "NOT_ADMITTED",
    trusted: false,
    admissionEligible: false,
    role: manifest.role,
    scope: "paired-path-diagnostic",
    sameJobAuthority: "host-custodian-only",
    native,
  });
}
function validateProcessContext(context, manifestInput) {
  const manifest = validateManifest(manifestInput);
  if (manifest.actor)
    insist(
      context.pid === manifest.actor.pid,
      "actual PID differs from registered actor",
    );
  insist(
    context.platform === "win32" &&
      context.arch === "x64" &&
      context.nodeVersion === NODE_VERSION &&
      context.modulesAbi === MODULES_ABI,
    "actual runtime or ABI differs",
  );
  insist(
    context.execPath === manifest.runtime.physical ||
      context.execPath === manifest.runtime.logical,
    "actual executable spelling is outside the paired runtime",
  );
}
// These filesystem reads consume only supervisor-listed logical paths. A path
// string, a successful realpath, or this checksum is not a native handle proof.
function readPlain(file, maximumBytes) {
  const before = fs.lstatSync(file, { bigint: true });
  insist(
    before.isFile() &&
      !before.isSymbolicLink() &&
      before.nlink === 1n &&
      before.size > 0n &&
      before.size <= BigInt(maximumBytes),
    "bounded plain file required",
  );
  const descriptor = fs.openSync(file, "r");
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true });
    const fields = ["dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink"];
    insist(
      opened.isFile() &&
        fields.every((field) => before[field] === opened[field]),
      "opened file identity changed",
    );
    const buffer = Buffer.alloc(Number(opened.size) + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = fs.readSync(
        descriptor,
        buffer,
        length,
        buffer.length - length,
        null,
      );
      if (!count) break;
      length += count;
    }
    const after = fs.lstatSync(file, { bigint: true }),
      heldAfter = fs.fstatSync(descriptor, { bigint: true });
    insist(
      length === Number(opened.size) &&
        !after.isSymbolicLink() &&
        fields.every(
          (field) =>
            before[field] === after[field] &&
            before[field] === heldAfter[field],
        ),
      "file changed during bounded read",
    );
    return buffer.subarray(0, length);
  } finally {
    fs.closeSync(descriptor);
  }
}
module.exports = Object.freeze({
  MANIFEST_SCHEMA,
  IDENTITY_SCHEMA,
  MANIFEST_PATH,
  RUNTIME_SHA256,
  NODE_VERSION,
  MODULES_ABI,
  FILES,
  digest,
  validateManifest,
  selectManifestPath,
  validateManifestPath,
  createPrivateManifest,
  inspectPrivateIdentity,
  validateProcessContext,
  readPlain,
});
