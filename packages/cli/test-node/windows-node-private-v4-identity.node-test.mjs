import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import identity from "../scripts/diagnostics/windows-node-private-v4-identity.cjs";

const sessionId = "67271425-103d-407f-ad04-36fa5a6c7611";
const generation = "57271425-103d-407f-ad04-36fa5a6c7611";
const appContainerSid = "S-1-15-2-1-2-3-4-5-6-7";
function manifest(actor) {
  return identity.createPrivateManifest({
    actor,
    physicalRoot: "C:\\private-v4-root",
    sessionId,
    generation,
    appContainerSid,
    runtimeBytes: 123456,
    files: Object.fromEntries(
      Object.keys(identity.FILES).map((name) => [
        name,
        { sha256: "a".repeat(64), bytes: 1234 },
      ]),
    ),
  });
}
function native() {
  const makePair = (directory) => {
    const suffix = directory ? "" : "\\control\\node.exe";
    const physical = {
      path: "C:\\private-v4-root" + suffix,
      accessMode: "globalroot",
      ntPath: "\\Device\\HarddiskVolume3\\private-v4-root" + suffix,
      volumeSerial: "12345",
      fileId: (directory ? "1" : "2").repeat(32),
      directory,
      reparse: false,
      links: directory ? 2 : 1,
    };
    return {
      physical,
      logical: {
        ...physical,
        path: "X:\\" + suffix.replace(/^\\/u, ""),
        accessMode: "logical-dos",
      },
      handlesHeldTogether: true,
      componentsGuarded: true,
    };
  };
  return {
    schema: identity.IDENTITY_SCHEMA,
    status: "NOT_ADMITTED",
    sessionId,
    generation,
    role: "root",
    nodeVersion: identity.NODE_VERSION,
    modulesAbi: identity.MODULES_ABI,
    token: { appContainerSid, capabilityCount: 0, inJob: true },
    root: makePair(true),
    runtime: {
      ...makePair(false),
      sha256: identity.RUNTIME_SHA256,
      bytes: 123456,
    },
  };
}
test("GLOBALROOT-backed physical identity and logical X refer to the same held object", () => {
  const result = identity.inspectPrivateIdentity(
    JSON.stringify(native()),
    manifest(),
  );
  assert.equal(result.trusted, false);
  assert.equal(result.admissionEligible, false);
  assert.equal(result.status, "NOT_ADMITTED");
  assert.equal(result.sameJobAuthority, "host-custodian-only");
  assert.ok(Object.isFrozen(result.native.root.physical));
  assert.equal(result.native.root.physical.links, 2); // Directory nlink is not file hard-link authority.
});
test("physical inherited file handles do not claim that C paths can be opened in the child", () => {
  const proof = native();
  proof.root.physical.accessMode = "host-inherited-handle";
  proof.runtime.physical.accessMode = "host-inherited-handle";
  assert.equal(
    identity.inspectPrivateIdentity(proof, manifest()).native.root.physical
      .accessMode,
    "host-inherited-handle",
  );
});
for (const [name, mutate] of [
  [
    "different root FileID",
    (n) => {
      n.root.logical.fileId = "3".repeat(32);
    },
  ],
  [
    "same FileID on different volume",
    (n) => {
      n.root.logical.volumeSerial = "987";
    },
  ],
  [
    "different NT root with equal IDs",
    (n) => {
      n.root.logical.ntPath += "-other";
    },
  ],
  [
    "root pair not held together",
    (n) => {
      n.root.handlesHeldTogether = false;
    },
  ],
  [
    "unguarded ancestors",
    (n) => {
      n.runtime.componentsGuarded = false;
    },
  ],
  [
    "logical root uses drive-relative X",
    (n) => {
      n.root.logical.path = "X:";
    },
  ],
  [
    "physical side pretends to open DOS C",
    (n) => {
      n.root.physical.accessMode = "physical-dos";
    },
  ],
  [
    "logical root is only a claimed alias",
    (n) => {
      n.root.logical.accessMode = "string-alias";
    },
  ],
  [
    "root is a reparse point",
    (n) => {
      n.root.logical.reparse = true;
    },
  ],
  [
    "runtime has additional hard links",
    (n) => {
      n.runtime.physical.links = n.runtime.logical.links = 2;
    },
  ],
  [
    "runtime is outside guarded root",
    (n) => {
      n.runtime.physical.ntPath = n.runtime.logical.ntPath =
        "\\Device\\HarddiskVolume3\\outside\\node.exe";
    },
  ],
  [
    "runtime bytes changed",
    (n) => {
      n.runtime.sha256 = "b".repeat(64);
    },
  ],
  [
    "runtime length changed",
    (n) => {
      n.runtime.bytes++;
    },
  ],
  [
    "runtime alias targets another file",
    (n) => {
      n.runtime.logical.fileId = "4".repeat(32);
    },
  ],
  [
    "ABI changed",
    (n) => {
      n.modulesAbi = "128";
    },
  ],
  [
    "runtime version changed",
    (n) => {
      n.nodeVersion = "22.12.0";
    },
  ],
  [
    "different AppContainer",
    (n) => {
      n.token.appContainerSid += "0";
    },
  ],
  [
    "network capability added",
    (n) => {
      n.token.capabilityCount = 1;
    },
  ],
  [
    "no Job membership",
    (n) => {
      n.token.inJob = false;
    },
  ],
  [
    "another broker session",
    (n) => {
      n.sessionId = generation;
    },
  ],
  [
    "replayed generation",
    (n) => {
      n.generation = sessionId;
    },
  ],
  [
    "fork role not wired",
    (n) => {
      n.role = "fork";
    },
  ],
  [
    "admitted status",
    (n) => {
      n.status = "ADMITTED";
    },
  ],
  [
    "zero object ID",
    (n) => {
      n.root.logical.fileId = n.root.physical.fileId = "0".repeat(32);
    },
  ],
  [
    "out of range volume",
    (n) => {
      n.root.logical.volumeSerial = n.root.physical.volumeSerial =
        "18446744073709551616";
    },
  ],
])
  test("rejects " + name, () => {
    const value = native();
    mutate(value);
    assert.throws(() => identity.inspectPrivateIdentity(value, manifest()));
  });
for (const [name, mutate] of [
  [
    "full review inferred",
    (m) => {
      m.stage = "full-frozen-review";
    },
  ],
  [
    "sandbox-generated authority flag",
    (m) => {
      m.authority = true;
    },
  ],
  [
    "unlisted preload file",
    (m) => {
      m.files.preload.path = "scratch/other.cjs";
    },
  ],
  [
    "root with traversal",
    (m) => {
      m.root.physical = "C:\\private-v4-root\\..\\other";
    },
  ],
  [
    "root with UNC alias",
    (m) => {
      m.root.physical = "\\\\?\\C:\\private-v4-root";
    },
  ],
  [
    "runtime digest chosen by caller",
    (m) => {
      m.runtime.sha256 = "b".repeat(64);
    },
  ],
  [
    "fork role in manifest",
    (m) => {
      m.role = "fork";
    },
  ],
  [
    "relative X root in manifest",
    (m) => {
      m.root.logical = "X:";
    },
  ],
])
  test("rejects manifest " + name, () => {
    const value = structuredClone(manifest());
    mutate(value);
    assert.throws(() => identity.validateManifest(value));
  });
test("only both exact executable spellings and the fixed runtime ABI are accepted", () => {
  const value = manifest();
  const context = {
    platform: "win32",
    arch: "x64",
    nodeVersion: identity.NODE_VERSION,
    modulesAbi: identity.MODULES_ABI,
  };
  for (const execPath of [value.runtime.physical, value.runtime.logical])
    assert.doesNotThrow(() =>
      identity.validateProcessContext({ ...context, execPath }, value),
    );
  for (const execPath of [
    "C:\\outside\\node.exe",
    "X:control\\node.exe",
    "x:\\control\\node.exe",
  ])
    assert.throws(() =>
      identity.validateProcessContext({ ...context, execPath }, value),
    );
  assert.throws(() =>
    identity.validateProcessContext(
      { ...context, execPath: value.runtime.physical, modulesAbi: "128" },
      value,
    ),
  );
});
test("bounded reads reject hard links and oversize files, and return actual bytes", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-v4-identity-"));
  try {
    const file = path.join(directory, "file");
    fs.writeFileSync(file, "fixed bytes");
    assert.equal(identity.readPlain(file, 20).toString(), "fixed bytes");
    assert.throws(() => identity.readPlain(file, 2));
    fs.linkSync(file, path.join(directory, "alias"));
    assert.throws(() => identity.readPlain(file, 20));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
test("malformed or oversized native JSON cannot supply identity", () => {
  for (const value of [null, [], "{", " ".repeat(65537)])
    assert.throws(() => identity.inspectPrivateIdentity(value, manifest()));
});

const rootRegistrationId = "77271425-103d-407f-ad04-36fa5a6c7611";
const workerRegistrationId = "87271425-103d-407f-ad04-36fa5a6c7611";
function actor(role = "worker") {
  return {
    registrationId: role === "root" ? rootRegistrationId : workerRegistrationId,
    pid: role === "root" ? 4200 : 4300,
    role,
    parentRegistrationId: role === "root" ? null : rootRegistrationId,
  };
}
function registeredNative(role = "worker") {
  return {
    ...native(),
    role,
    actor: actor(role),
    brokerBinding: "exclusive-channel-original-creation-handle",
  };
}
const workerPath = `X:\\control\\windows-node-private-v4.worker-${workerRegistrationId}.manifest.json`;
test("root and worker retain distinct native registrations under one session", () => {
  for (const role of ["root", "worker"]) {
    const value = manifest(actor(role));
    const result = identity.inspectPrivateIdentity(
      registeredNative(role),
      value,
    );
    assert.equal(result.role, role);
    assert.equal(result.native.actor.pid, actor(role).pid);
    assert.equal(result.trusted, false);
    assert.ok(Object.isFrozen(result.native.actor));
    assert.equal(
      identity.validateManifestPath(
        role === "root" ? identity.MANIFEST_PATH : workerPath,
        value,
      ),
      role === "root" ? identity.MANIFEST_PATH : workerPath,
    );
    identity.validateProcessContext(
      {
        platform: "win32",
        arch: "x64",
        execPath: value.runtime.logical,
        nodeVersion: identity.NODE_VERSION,
        modulesAbi: identity.MODULES_ABI,
        pid: actor(role).pid,
      },
      value,
    );
  }
});
for (const [name, mutate] of [
  [
    "another registration",
    (n) => {
      n.actor.registrationId = sessionId;
    },
  ],
  [
    "another creation PID",
    (n) => {
      n.actor.pid++;
    },
  ],
  [
    "root parent registration",
    (n) => {
      n.actor.parentRegistrationId = generation;
    },
  ],
  [
    "worker called root",
    (n) => {
      n.role = "root";
    },
  ],
  [
    "actor called root",
    (n) => {
      n.actor.role = "root";
    },
  ],
  [
    "environment-only authority",
    (n) => {
      n.brokerBinding = "environment";
    },
  ],
  [
    "missing broker response",
    (n) => {
      delete n.brokerBinding;
    },
  ],
  [
    "missing actor",
    (n) => {
      delete n.actor;
    },
  ],
  [
    "extra actor authority",
    (n) => {
      n.actor.trusted = true;
    },
  ],
])
  test("rejects registered native " + name, () => {
    const proof = registeredNative();
    mutate(proof);
    assert.throws(() =>
      identity.inspectPrivateIdentity(proof, manifest(actor())),
    );
  });
for (const [name, mutate] of [
  [
    "root without actor",
    (m) => {
      delete m.actor;
    },
  ],
  [
    "worker without parent",
    (m) => {
      m.actor.parentRegistrationId = null;
    },
  ],
  [
    "self parent",
    (m) => {
      m.actor.parentRegistrationId = m.actor.registrationId;
    },
  ],
  [
    "zero PID",
    (m) => {
      m.actor.pid = 0;
    },
  ],
  [
    "oversize PID",
    (m) => {
      m.actor.pid = 0x100000000;
    },
  ],
  [
    "string PID",
    (m) => {
      m.actor.pid = "4300";
    },
  ],
  [
    "role mismatch",
    (m) => {
      m.role = "root";
    },
  ],
  [
    "legacy worker role",
    (m) => {
      m.stage = "same-sid-esbuild-service";
      delete m.actor;
    },
  ],
  [
    "legacy actor extension",
    (m) => {
      m.stage = "same-sid-esbuild-service";
      m.role = "root";
    },
  ],
])
  test("rejects registered manifest " + name, () => {
    const value = structuredClone(manifest(actor()));
    mutate(value);
    assert.throws(() => identity.validateManifest(value));
  });
test("legacy root proof cannot import worker actor authority", () => {
  assert.throws(() =>
    identity.inspectPrivateIdentity(registeredNative("root"), manifest()),
  );
  assert.equal(identity.selectManifestPath(undefined), identity.MANIFEST_PATH);
});
test("manifest selection binds an exact worker filename to its registration", () => {
  for (const location of [
    "",
    "X:control\\manifest.json",
    "x:\\control\\windows-node-private-v4.manifest.json",
    "C:\\control\\windows-node-private-v4.manifest.json",
    workerPath + ":stream",
    workerPath.replace("control", "scratch"),
    workerPath.replace("control", "control\\..\\control"),
    workerPath.replace(
      workerRegistrationId,
      workerRegistrationId.toUpperCase(),
    ),
    null,
  ])
    assert.throws(() => identity.selectManifestPath(location));
  assert.throws(() =>
    identity.validateManifestPath(identity.MANIFEST_PATH, manifest(actor())),
  );
  assert.throws(() =>
    identity.validateManifestPath(workerPath, manifest(actor("root"))),
  );
  assert.throws(() =>
    identity.validateManifestPath(
      workerPath.replace(workerRegistrationId, rootRegistrationId),
      manifest(actor()),
    ),
  );
});
test("actual process PID must equal host registered creation PID", () => {
  const value = manifest(actor());
  for (const pid of [undefined, 4200, "4300"])
    assert.throws(() =>
      identity.validateProcessContext(
        {
          platform: "win32",
          arch: "x64",
          execPath: value.runtime.logical,
          nodeVersion: identity.NODE_VERSION,
          modulesAbi: identity.MODULES_ABI,
          pid,
        },
        value,
      ),
    );
});
test("fixed report helper has a separate role and manifest namespace", () => {
  const helperActor = { ...actor(), role: "report-helper" };
  const value = manifest(helperActor);
  const proof = {
    ...registeredNative(),
    role: "report-helper",
    actor: helperActor,
  };
  const helperPath = workerPath.replace(".worker-", ".report-helper-");
  assert.equal(
    identity.inspectPrivateIdentity(proof, value).role,
    "report-helper",
  );
  assert.equal(identity.validateManifestPath(helperPath, value), helperPath);
  assert.throws(() => identity.validateManifestPath(workerPath, value));
  assert.throws(() =>
    identity.validateManifestPath(helperPath, manifest(actor())),
  );
  assert.throws(() =>
    identity.inspectPrivateIdentity(proof, manifest(actor())),
  );
  assert.throws(() =>
    identity.inspectPrivateIdentity(registeredNative(), value),
  );
});
test("actor roles cannot expand to arbitrary helpers", () => {
  for (const role of ["helper", "fork", "service", "shell", "esbuild"]) {
    assert.throws(() => manifest({ ...actor(), role }));
    assert.throws(() =>
      identity.selectManifestPath(workerPath.replace(".worker-", `.${role}-`)),
    );
  }
});
