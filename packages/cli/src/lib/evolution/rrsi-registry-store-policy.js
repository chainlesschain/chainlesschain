/** Authenticated fresh store provisioning, before any Registry is constructed.
 * This installs a writer floor, not content-origin or business admission.
 * Existing stores and ambiguous partial publication are never adopted.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isProxy } from "node:util/types";
import {
  repairPrivatePath,
  ensurePrivateFile,
  inspectPrivatePath,
} from "../secure-fs.js";
import { withFileLock } from "../with-file-lock.js";
import { withEvolutionFileIdentity } from "./evolution-file-identity.js";
import { readBoundedDescriptor } from "./bounded-descriptor-read.js";
import {
  captureEvolutionLedgerFileBackend,
  captureEvolutionLedgerFileBackendBinding,
} from "./evolution-ledger-file-backend.js";
import { isEvolutionLedgerV2Journal } from "./evolution-ledger-v2-journal.js";
import {
  EVOLUTION_LEDGER_MAX_EVENTS,
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
  EVOLUTION_ARTIFACT_REF_SCHEMA,
} from "./evolution-ledger.js";
import {
  EvolutionArtifactPorts,
  EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
  captureEvolutionLedgerArtifactResolverBinding,
} from "./evolution-artifact-ports.js";
import { deriveSkillCandidateTenantKey } from "./skill-candidate-registry.js";
import { deriveSkillReleaseTenantKey } from "./skill-release-registry.js";
import { captureSkillReleaseOperationReader } from "./evolution-ledger-ports.js";
import {
  snapshotRrsiData,
  rrsiExact,
  rrsiId,
  rrsiHash,
  rrsiCanonical,
  rrsiEnvelope,
  freezeRrsiData,
  rrsiFail,
} from "./rrsi-data.js";

export const RRSI_REGISTRY_STORE_POLICY_SCHEMA =
  "chainlesschain.rrsi-registry-store-policy/v1";
export const RRSI_REGISTRY_STORE_POLICY_EVENT_TYPE =
  "rrsi.registry-store-policy.committed";
export const RRSI_REGISTRY_STORE_POLICY_ARTIFACT_TYPE =
  "skill-registry-store-policy";
export const RRSI_REGISTRY_STORE_POLICY_HOLD_CODE =
  "CC_RRSI_REGISTRY_STORE_POLICY_HOLD";
export const RRSI_REGISTRY_STORE_WRITER_FLOOR = 2;
const EVENT_SCHEMA = "chainlesschain.rrsi-registry-store-policy-event/v1";
const PREPARED_SCHEMA = "chainlesschain.rrsi-registry-store-prepared/v1";
const PHASES = ["prepared", "markers-installed", "committed"];
const POLICIES = new WeakMap();
const COMPONENT_BINDINGS = new WeakMap();
const ORIGIN_POLICY = freezeRrsiData({
  schema: "chainlesschain.rrsi-registry-origin-policy/v1",
  revision: 1,
  writerFloor: RRSI_REGISTRY_STORE_WRITER_FLOOR,
  unknownContent: "hold",
  contentKey: "tenant-and-content-digest",
  originAdmissionImplemented: false,
});
const ORIGIN_POLICY_DIGEST = rrsiHash(ORIGIN_POLICY.schema, ORIGIN_POLICY);
function hold(message, cause) {
  try {
    rrsiFail(message, RRSI_REGISTRY_STORE_POLICY_HOLD_CODE);
  } catch (error) {
    if (cause) error.cause = cause;
    throw error;
  }
}
const canonicalPath = (value) =>
  process.platform === "win32" ? value.toLowerCase() : value;
const physicalIdentity = (stat) => `${String(stat.dev)}:${String(stat.ino)}`;
const headFields = [
  "ledgerId",
  "identityDigest",
  "epoch",
  "sequence",
  "headDigest",
];
const headData = (head) =>
  Object.fromEntries(headFields.map((key) => [key, head[key]]));
const journalIdentity = (head) =>
  Object.fromEntries(headFields.slice(0, 3).map((key) => [key, head[key]]));
const equal = (left, right) => rrsiCanonical(left) === rrsiCanonical(right);
const bytesFor = (value) => Buffer.from(`${rrsiCanonical(value)}\n`, "utf8");
function ownOptions(input, names) {
  if (
    !input ||
    isProxy(input) ||
    Object.getPrototypeOf(input) !== Object.prototype ||
    Reflect.ownKeys(input).length !== names.length
  )
    rrsiFail("store policy requires plain own composition fields");
  return Object.fromEntries(
    names.map((name) => {
      const field = Object.getOwnPropertyDescriptor(input, name);
      if (!field?.enumerable || !("value" in field))
        rrsiFail("store policy cannot use option accessors");
      return [name, field.value];
    }),
  );
}
function directory(value) {
  const stat = fs.lstatSync(value);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    canonicalPath(path.resolve(fs.realpathSync.native(value))) !==
      canonicalPath(value)
  )
    hold("store directory is not a canonical physical directory");
  return { path: value, identity: physicalIdentity(stat) };
}
function assertDirectory(expected) {
  if (!equal(directory(expected.path), expected))
    hold("store directory identity changed");
}
function assertPrivateParent(expected) {
  assertDirectory(expected);
  const permission = inspectPrivatePath(expected.path);
  if (permission?.ok !== true || permission.exists !== true)
    hold("provisioning parent must have verified owner-only permissions");
  assertDirectory(expected);
}
function syncDirectory(value) {
  let fd;
  try {
    fd = fs.openSync(value, "r");
    fs.fsyncSync(fd);
    return true;
  } catch (error) {
    // Node cannot flush directory handles on these Windows filesystems. The
    // authenticated journal and reopen checks do not imply power-loss proof.
    if (
      process.platform !== "win32" ||
      !["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code)
    )
      throw error;
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
function readMarker(file, linkCount = 1) {
  return withEvolutionFileIdentity(fs, file, (samePathHandle) => {
    const before = fs.lstatSync(file);
    const safe = (stat) =>
      stat.isFile() &&
      !stat.isSymbolicLink() &&
      Number(stat.nlink) === linkCount &&
      stat.size > 0 &&
      stat.size <= 4096;
    if (
      !safe(before) ||
      canonicalPath(fs.realpathSync.native(file)) !== canonicalPath(file)
    )
      hold("store marker is not a bounded regular file");
    const fd = fs.openSync(
      file,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
    );
    try {
      const opened = fs.fstatSync(fd);
      if (!safe(opened) || !samePathHandle(before, opened))
        hold("store marker changed while opening");
      const bytes = readBoundedDescriptor(fs, fd, before.size, 4096);
      const after = fs.lstatSync(file);
      if (
        !samePathHandle(after, fs.fstatSync(fd)) ||
        !equal(
          [
            physicalIdentity(before),
            before.size,
            before.mtimeMs,
            before.ctimeMs,
          ],
          [physicalIdentity(after), after.size, after.mtimeMs, after.ctimeMs],
        ) ||
        !safe(after)
      )
        hold("store marker changed while reading");
      return { bytes, identity: physicalIdentity(after) };
    } finally {
      fs.closeSync(fd);
    }
  });
}
function copyRef(value) {
  const ref = Object.fromEntries(
    ["schema", "ref", "digest"].map((key) => {
      const field = Object.getOwnPropertyDescriptor(value, key);
      if (!field?.enumerable || !("value" in field))
        hold("policy artifact reference differs");
      return [key, field.value];
    }),
  );
  if (ref.schema !== EVOLUTION_ARTIFACT_REF_SCHEMA)
    hold("policy artifact reference schema differs");
  return ref;
}
function storePaths(parent, namespaceId, tenantId) {
  const namespace = path.join(parent, namespaceId);
  const stores = Object.fromEntries(
    ["candidate", "release"].map((name) => {
      const tenantKey =
        name === "candidate"
          ? deriveSkillCandidateTenantKey(tenantId)
          : deriveSkillReleaseTenantKey(tenantId);
      const baseDir = path.join(namespace, name);
      return [
        name,
        {
          baseDir,
          tenantKey,
          rootDir: path.join(baseDir, "tenants", tenantKey),
        },
      ];
    }),
  );
  const paths = [namespace];
  for (const name of ["candidate", "release"])
    paths.push(
      stores[name].baseDir,
      path.dirname(stores[name].rootDir),
      stores[name].rootDir,
    );
  return { namespace, stores, paths };
}
function markerFor(prepared, component) {
  const store = prepared[component],
    peer = prepared[component === "candidate" ? "release" : "candidate"];
  const core = {
    schema: `chainlesschain.skill-${component}-tenant-marker/v2`,
    component: `skill-${component}-registry`,
    tenantId: prepared.tenantId,
    tenantKey: store.tenantKey,
    storeId: store.storeId,
    peerStoreId: peer.storeId,
    namespaceId: prepared.namespaceId,
    operationId: prepared.operationId,
    journalIdentity: prepared.journalIdentity,
    storeEpoch: 1,
    writerFloor: RRSI_REGISTRY_STORE_WRITER_FLOOR,
    originPolicyDigest: ORIGIN_POLICY_DIGEST,
    provisionDigest: rrsiHash(PREPARED_SCHEMA, prepared),
  };
  return { ...core, markerDigest: rrsiHash(core.schema, core) };
}
function normalizePrepared(value, descriptor, identity) {
  rrsiExact(
    value,
    [
      "operationId",
      "tenantId",
      "namespaceId",
      "parent",
      "directories",
      "candidate",
      "release",
      "journalIdentity",
      "originPolicy",
      "bootstrapDirectoryFsyncVerified",
    ],
    "prepared store",
  );
  rrsiId(value.operationId, "provision operation ID");
  if (
    value.tenantId !== descriptor.tenantId ||
    !equal(value.journalIdentity, identity) ||
    !equal(value.originPolicy, ORIGIN_POLICY) ||
    typeof value.bootstrapDirectoryFsyncVerified !== "boolean" ||
    !/^pair\.[a-f0-9-]{36}$/u.test(value.namespaceId)
  )
    hold("prepared store identity or policy differs");
  const uuid =
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
  if (!uuid.test(value.namespaceId.slice(5)))
    hold("prepared namespace ID is invalid");
  const validateDirectory = (entry) => {
    rrsiExact(entry, ["path", "identity"], "prepared directory");
    if (
      typeof entry.path !== "string" ||
      path.resolve(entry.path) !== entry.path ||
      !/^[0-9]+:[0-9]+$/u.test(entry.identity)
    )
      hold("prepared directory identity is invalid");
  };
  validateDirectory(value.parent);
  const expected = storePaths(
    value.parent.path,
    value.namespaceId,
    value.tenantId,
  );
  if (
    !Array.isArray(value.directories) ||
    value.directories.length !== expected.paths.length
  )
    hold("prepared directory inventory differs");
  value.directories.forEach((entry, index) => {
    validateDirectory(entry);
    if (entry.path !== expected.paths[index])
      hold("prepared directory path differs");
  });
  if (
    new Set([
      value.parent.identity,
      ...value.directories.map((entry) => entry.identity),
    ]).size !== 8
  )
    hold("prepared directories are not independent");
  for (const name of ["candidate", "release"]) {
    rrsiExact(
      value[name],
      ["baseDir", "rootDir", "tenantKey", "storeId"],
      "prepared store component",
    );
    if (
      !equal(value[name], {
        ...expected.stores[name],
        storeId: value[name].storeId,
      }) ||
      typeof value[name].storeId !== "string" ||
      !value[name].storeId.startsWith("store.") ||
      !uuid.test(value[name].storeId.slice(6))
    )
      hold("prepared component binding differs");
  }
  if (value.candidate.storeId === value.release.storeId)
    hold("store identities must be independent");
  for (const name of ["candidate", "release"])
    if (bytesFor(markerFor(value, name)).length > 4096)
      hold("store marker exceeds byte limit");
  return value;
}
function assertLayout(prepared, markerPresence, ownTemporary = null) {
  assertDirectory(prepared.parent);
  prepared.directories.forEach(assertDirectory);
  const roots = [prepared.candidate.rootDir, prepared.release.rootDir];
  for (const entry of prepared.directories) {
    const children = prepared.directories
      .filter((other) => path.dirname(other.path) === entry.path)
      .map((other) => path.basename(other.path));
    const rootIndex = roots.indexOf(entry.path);
    if (rootIndex !== -1 && markerPresence[rootIndex])
      children.push("_tenant.json");
    if (ownTemporary && path.dirname(ownTemporary) === entry.path)
      children.push(path.basename(ownTemporary));
    const actual = fs.readdirSync(entry.path);
    if (actual.length > 8 || !equal(actual.sort(), children.sort()))
      hold(
        "fresh store bootstrap inventory changed or contains publication debris",
      );
  }
  prepared.directories.forEach(assertDirectory);
}
function assertImmutableBoundary(prepared) {
  assertDirectory(prepared.parent);
  prepared.directories.forEach(assertDirectory);
}
function markerProof(prepared, boundaryOnly = false) {
  const check = () =>
    boundaryOnly
      ? assertImmutableBoundary(prepared)
      : assertLayout(prepared, [true, true]);
  check();
  const markers = Object.fromEntries(
    ["candidate", "release"].map((name) => {
      const expected = markerFor(prepared, name);
      const stored = readMarker(
        path.join(prepared[name].rootDir, "_tenant.json"),
      );
      if (!stored.bytes.equals(bytesFor(expected)))
        hold("store marker bytes or writer floor differ");
      return [
        name,
        { markerDigest: expected.markerDigest, identity: stored.identity },
      ];
    }),
  );
  check();
  return markers;
}

export function createRrsiRegistryStorePolicy(input) {
  const options = ownOptions(input, [
    "backend",
    "artifactPorts",
    "ledgerArtifactResolver",
    "descriptor",
  ]);
  const backend = captureEvolutionLedgerFileBackend(options.backend);
  const binding = captureEvolutionLedgerFileBackendBinding(backend);
  const ledger = backend.ledger;
  if (!isEvolutionLedgerV2Journal(ledger) || !binding.matchesLedger(ledger))
    rrsiFail("store policy requires the genuine original retained v2 journal");
  const resolver = options.ledgerArtifactResolver;
  const resolverBinding =
    captureEvolutionLedgerArtifactResolverBinding(resolver);
  if (
    !binding.matchesArtifactResolver(resolver) ||
    !resolverBinding.matchesArtifactPorts(options.artifactPorts) ||
    isProxy(options.artifactPorts) ||
    Object.getPrototypeOf(options.artifactPorts) !==
      EvolutionArtifactPorts.prototype
  )
    rrsiFail("store policy requires the original artifact ports and resolver");
  const configured = snapshotRrsiData(options.descriptor);
  rrsiExact(
    configured,
    ["tenantId", "artifactTenantId", "audience", "purpose"],
    "store policy descriptor",
  );
  Object.entries(configured).forEach(([key, value]) => rrsiId(value, key));
  if (
    configured.purpose !== "evolution-ledger" ||
    configured.tenantId !== ledger.descriptor.tenantId ||
    configured.artifactTenantId !== ledger.descriptor.artifactTenantId ||
    configured.audience !== ledger.descriptor.audience ||
    configured.artifactTenantId !== resolverBinding.tenantId ||
    configured.audience !== resolverBinding.audience ||
    configured.purpose !== resolverBinding.purpose
  )
    rrsiFail("store policy journal and artifact scope differ");
  const descriptor = freezeRrsiData({
    ...configured,
    schema: RRSI_REGISTRY_STORE_POLICY_SCHEMA,
    scopeId: `registry-policy.${rrsiHash(RRSI_REGISTRY_STORE_POLICY_SCHEMA, configured).slice(7)}`,
    writerFloor: RRSI_REGISTRY_STORE_WRITER_FLOOR,
    originPolicyDigest: ORIGIN_POLICY_DIGEST,
    existingStoreUpgradeImplemented: false,
    originAdmissionImplemented: false,
    grantsMutationOrPromotionAuthority: false,
  });
  const methods = Object.fromEntries(
    ["read", "verify", "appendDomainEvent"].map((name) => {
      const method = Object.getOwnPropertyDescriptor(ledger, name)?.value;
      if (typeof method !== "function" || !Object.isFrozen(ledger))
        rrsiFail("store policy journal method is missing or mutable");
      return [name, (...args) => Reflect.apply(method, ledger, args)];
    }),
  );
  const lockTarget = path.join(
    backend.descriptor.authorityRootDir,
    "rrsi-registry-store-policy-operations",
  );
  let active = false;
  const locked = (operation) => {
    if (active) hold("store policy operation is already active");
    active = true;
    try {
      return withFileLock(
        lockTarget,
        (context) => {
          if (context.locked !== true)
            hold("store policy lock was not acquired");
          context.assertOwnership();
          const result = operation(context.assertOwnership);
          context.assertOwnership();
          return result;
        },
        { failIfUnavailable: true, timeoutMs: 0 },
      );
    } finally {
      active = false;
    }
  };
  const eventId = (operationId, phase) =>
    `registry-policy.${rrsiHash(EVENT_SCHEMA, { operationId, phase }).slice(7)}`;
  function resolveRecord(ref, identity) {
    const resolution = Reflect.apply(resolver, undefined, [
      {
        ledgerId: identity.ledgerId,
        epoch: identity.epoch,
        ref: copyRef(ref),
        tenantId: descriptor.artifactTenantId,
      },
    ]);
    if (
      resolution?.schema !== EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA ||
      resolution.authenticated !== true ||
      resolution.found !== true ||
      resolution.ref !== ref.ref ||
      resolution.digest !== ref.digest ||
      !Buffer.isBuffer(resolution.bytes) ||
      resolution.bytes.length > 1024 * 1024
    )
      hold("store policy artifact cannot be authenticated");
    const stored = snapshotRrsiData(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(resolution.bytes),
      ),
    );
    if (
      stored.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
      stored.tenantId !== descriptor.artifactTenantId ||
      stored.audience !== descriptor.audience ||
      stored.purpose !== descriptor.purpose ||
      stored.type !== RRSI_REGISTRY_STORE_POLICY_ARTIFACT_TYPE ||
      stored.retention !== "ledger"
    )
      hold("store policy artifact retention scope differs");
    if (!Buffer.from(rrsiCanonical(stored), "utf8").equals(resolution.bytes))
      hold("store policy artifact bytes are not canonical");
    return stored.value;
  }
  function load() {
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = methods.verify();
      if (
        before.authenticated !== true ||
        before.durable !== true ||
        before.status !== "verified"
      )
        hold("store policy journal head is unauthenticated");
      const events = methods.read({
        afterSequence: 0,
        limit: EVOLUTION_LEDGER_MAX_EVENTS,
      });
      if (events.length !== before.sequence) {
        if (!equal(headData(before), headData(methods.verify()))) continue;
        hold("store policy requires complete contiguous journal coverage");
      }
      if (events.some((event, index) => event.sequence !== index + 1))
        hold("store policy requires complete contiguous journal coverage");
      const identity = journalIdentity(before),
        records = [];
      let prepared = null,
        proof = null;
      for (const event of events) {
        if (event.type !== RRSI_REGISTRY_STORE_POLICY_EVENT_TYPE) continue;
        if (
          records.length >= 3 ||
          event.schema !== EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA ||
          event.tenantId !== descriptor.tenantId ||
          event.artifactTenantId !== descriptor.artifactTenantId ||
          event.correlationId !== descriptor.scopeId ||
          event.skillName !== null ||
          event.decision !== "committed"
        )
          hold("store policy event scope or phase count differs");
        const record = resolveRecord(event.subjectRef, identity);
        const coreNames = [
          "descriptor",
          "journalIdentity",
          "operationId",
          "phase",
          "preparedDigest",
          "previousRecordDigest",
          "observedHead",
          "payload",
        ];
        rrsiExact(
          record,
          [
            "schema",
            ...coreNames,
            "recordDigest",
            "structuralOnly",
            "authenticated",
            "readyForExecution",
            "qualifiesForPromotion",
          ],
          "store policy event record",
        );
        const rebuilt = rrsiEnvelope(
          EVENT_SCHEMA,
          "recordDigest",
          Object.fromEntries(coreNames.map((name) => [name, record[name]])),
        );
        const previous = records.at(-1);
        if (
          !equal(record, rebuilt) ||
          !equal(record.descriptor, descriptor) ||
          !equal(record.journalIdentity, identity) ||
          record.phase !== PHASES[records.length] ||
          record.previousRecordDigest !==
            (previous?.record.recordDigest ?? null) ||
          !equal(record.observedHead, {
            ...identity,
            sequence: event.sequence - 1,
            headDigest: event.prevDigest,
          }) ||
          event.eventId !== eventId(record.operationId, record.phase) ||
          !equal(event.sourceRefs.map(copyRef), previous ? [previous.ref] : [])
        )
          hold("store policy record identity, order or predecessor differs");
        if (!prepared)
          prepared = normalizePrepared(record.payload, descriptor, identity);
        if (
          record.operationId !== prepared.operationId ||
          record.preparedDigest !== rrsiHash(PREPARED_SCHEMA, prepared)
        )
          hold("store policy operation or prepared bytes differ");
        if (record.phase === "markers-installed") {
          proof = record.payload;
          rrsiExact(proof, ["candidate", "release"], "installed markers");
          for (const name of ["candidate", "release"]) {
            rrsiExact(
              proof[name],
              ["markerDigest", "identity"],
              "installed marker",
            );
            if (
              proof[name].markerDigest !==
                markerFor(prepared, name).markerDigest ||
              !/^[0-9]+:[0-9]+$/u.test(proof[name].identity)
            )
              hold("installed marker identity differs");
          }
          if (proof.candidate.identity === proof.release.identity)
            hold("marker files must be independent");
        }
        if (
          record.phase === "committed" &&
          !equal(record.payload, {
            installedRecordDigest: previous.record.recordDigest,
            markers: proof,
          })
        )
          hold("committed provisioning differs from installed proof");
        records.push({
          record,
          ref: copyRef(event.subjectRef),
          sequence: event.sequence,
        });
      }
      const after = methods.verify();
      if (!equal(headData(before), headData(after))) continue;
      return { head: headData(after), identity, records, prepared, proof };
    }
    hold("store policy journal changed repeatedly while reading");
  }
  function append(state, phase, payload, assertOwnership) {
    assertOwnership();
    const prepared = phase === "prepared" ? payload : state.prepared;
    const previous = state.records.at(-1);
    const record = rrsiEnvelope(EVENT_SCHEMA, "recordDigest", {
      descriptor,
      journalIdentity: state.identity,
      operationId: prepared.operationId,
      phase,
      preparedDigest: rrsiHash(PREPARED_SCHEMA, prepared),
      previousRecordDigest: previous?.record.recordDigest ?? null,
      observedHead: state.head,
      payload,
    });
    const published = Reflect.apply(
      EvolutionArtifactPorts.prototype.putCanonical,
      options.artifactPorts,
      [
        RRSI_REGISTRY_STORE_POLICY_ARTIFACT_TYPE,
        record,
        {
          audience: descriptor.audience,
          purpose: descriptor.purpose,
          retention: "ledger",
        },
      ],
    );
    if (
      published?.receipt?.persisted !== true ||
      published.receipt.readbackVerified !== true ||
      published.receipt.integrityVerified !== true ||
      published.receipt.retention !== "ledger" ||
      !equal(resolveRecord(published.ref, state.identity), record)
    )
      hold("store policy artifact retention failed");
    assertOwnership();
    if (phase !== "prepared") {
      const actual = markerProof(prepared);
      if (!equal(actual, phase === "markers-installed" ? payload : state.proof))
        hold("store marker identities changed before policy append");
    } else assertLayout(prepared, [false, false]);
    assertOwnership();
    try {
      const receipt = methods.appendDomainEvent(
        {
          type: RRSI_REGISTRY_STORE_POLICY_EVENT_TYPE,
          eventId: eventId(prepared.operationId, phase),
          tenantId: descriptor.tenantId,
          artifactTenantId: descriptor.artifactTenantId,
          correlationId: descriptor.scopeId,
          skillName: null,
          decision: "committed",
          reason:
            "Authenticated fresh Registry provisioning; independent business admission remains required",
          sourceRefs: previous ? [previous.ref] : [],
          subjectRef: copyRef(published.ref),
        },
        {
          expectedHeadDigest: state.head.headDigest,
          expectedSequence: state.head.sequence,
        },
      );
      if (receipt?.authenticated !== true || receipt.durable !== true)
        hold("store policy append is uncertain");
    } catch (cause) {
      throw Object.assign(
        new Error(
          "store policy commit is uncertain; recover the original operation",
          { cause },
        ),
        {
          code: "CC_RRSI_REGISTRY_STORE_POLICY_COMMIT_UNKNOWN",
          operationId: prepared.operationId,
        },
      );
    }
    assertOwnership();
    const readback = load();
    if (readback.records.at(-1)?.record.recordDigest !== record.recordDigest)
      hold("store policy committed record cannot be read back");
    return readback;
  }
  function allocate(request, state, assertOwnership) {
    const parent = directory(request.parentDir);
    for (const protectedRoot of [
      backend.descriptor.rootDir,
      backend.descriptor.authorityRootDir,
      path.dirname(backend.descriptor.witnessFilePath),
    ]) {
      const relation = path.relative(protectedRoot, parent.path);
      if (
        relation === "" ||
        (!relation.startsWith(`..${path.sep}`) &&
          relation !== ".." &&
          !path.isAbsolute(relation))
      )
        hold("fresh stores cannot be provisioned inside journal storage");
    }
    const present = (target) => {
      try {
        fs.lstatSync(target);
        return true;
      } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
      }
    };
    const assertOutsideRegistry = () => {
      for (let ancestor = parent.path; ; ancestor = path.dirname(ancestor)) {
        if (
          present(path.join(ancestor, "_tenant.json")) ||
          present(path.join(ancestor, "tenants")) ||
          (present(path.join(ancestor, "candidate")) &&
            present(path.join(ancestor, "release")))
        )
          hold("fresh stores cannot be nested inside a Registry tenant root");
        if (ancestor === path.dirname(ancestor)) break;
      }
    };
    // Invalid existing layouts need no permission helper. A valid allocation
    // still verifies its original parent and repeats the ancestor check after
    // that potentially slow read, before it creates any namespace.
    assertOutsideRegistry();
    assertPrivateParent(parent);
    assertOutsideRegistry();
    const namespaceId = `pair.${randomUUID()}`;
    const layout = storePaths(parent.path, namespaceId, descriptor.tenantId);
    let bootstrapDirectoryFsyncVerified = true;
    const captured = [];
    // No recursive creation, existence fallback, caller RNG or orphan adoption.
    for (const target of layout.paths) {
      assertOwnership();
      assertDirectory(parent);
      captured.forEach(assertDirectory);
      assertOwnership();
      fs.mkdirSync(target, { mode: 0o700 });
      const original = directory(target);
      assertOwnership();
      assertDirectory(parent);
      captured.forEach(assertDirectory);
      assertDirectory(original);
      assertOwnership();
      repairPrivatePath(target, {
        failIfUnavailable: true,
        applyWindowsAcl: true,
      });
      assertDirectory(original);
      captured.push(original);
      bootstrapDirectoryFsyncVerified =
        syncDirectory(path.dirname(target)) && bootstrapDirectoryFsyncVerified;
    }
    const prepared = {
      operationId: request.operationId,
      tenantId: descriptor.tenantId,
      namespaceId,
      parent,
      directories: captured,
      candidate: {
        ...layout.stores.candidate,
        storeId: `store.${randomUUID()}`,
      },
      release: { ...layout.stores.release, storeId: `store.${randomUUID()}` },
      journalIdentity: state.identity,
      originPolicy: ORIGIN_POLICY,
      bootstrapDirectoryFsyncVerified,
    };
    normalizePrepared(prepared, descriptor, state.identity);
    assertLayout(prepared, [false, false]);
    return prepared;
  }
  function install(prepared, name, presence, assertOwnership) {
    assertOwnership();
    assertLayout(prepared, presence);
    assertOwnership();
    const root = prepared[name].rootDir;
    const target = path.join(root, "_tenant.json");
    const temporary = path.join(root, `.rrsi-marker-${randomUUID()}.tmp`);
    const bytes = bytesFor(markerFor(prepared, name));
    const fd = fs.openSync(temporary, "wx", 0o600);
    let written;
    try {
      assertOwnership();
      assertLayout(prepared, presence, temporary);
      assertOwnership();
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
      written = fs.fstatSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    // Failures deliberately retain private debris. Never delete or overwrite a
    // canonical marker or clean a path after ownership/identity has changed.
    const staged = readMarker(temporary);
    if (
      !staged.bytes.equals(bytes) ||
      String(written.ino) !== staged.identity.split(":")[1]
    )
      hold("store marker temporary identity differs");
    assertOwnership();
    assertLayout(prepared, presence, temporary);
    assertOwnership();
    ensurePrivateFile(temporary, {
      failIfUnavailable: true,
      applyWindowsAcl: true,
    });
    if (!equal(readMarker(temporary), staged))
      hold("store marker changed during permission hardening");
    assertOwnership();
    assertLayout(prepared, presence, temporary);
    assertOwnership();
    fs.linkSync(temporary, target); // A v1 winner is never replaced.
    const linked = readMarker(target, 2),
      source = readMarker(temporary, 2);
    if (
      linked.identity !== staged.identity ||
      source.identity !== staged.identity ||
      !linked.bytes.equals(bytes) ||
      !source.bytes.equals(bytes)
    )
      hold("store marker publication identity differs");
    presence[name === "candidate" ? 0 : 1] = true;
    assertOwnership();
    assertLayout(prepared, presence, temporary);
    if (readMarker(temporary, 2).identity !== staged.identity)
      hold("store marker temporary was replaced");
    assertOwnership();
    fs.unlinkSync(temporary);
    syncDirectory(root);
    assertLayout(prepared, presence);
    const final = readMarker(target);
    if (final.identity !== staged.identity || !final.bytes.equals(bytes))
      hold("store marker final readback differs");
  }
  function status(
    state,
    operationId,
    { boundaryOnly = false, verifyPermissions = true } = {},
  ) {
    if (!state.prepared || state.prepared.operationId !== operationId)
      hold("store provisioning operation is unregistered");
    if (verifyPermissions) assertPrivateParent(state.prepared.parent);
    else assertDirectory(state.prepared.parent);
    const actual = markerProof(state.prepared, boundaryOnly);
    if (state.proof && !equal(actual, state.proof))
      hold("installed marker physical identity changed");
    if (!equal(state.head, headData(methods.verify())))
      hold("store policy journal changed during physical readback");
    return freezeRrsiData({
      schema: "chainlesschain.rrsi-registry-store-policy-readback/v1",
      phase: state.records.at(-1).record.phase,
      operationId,
      prepared: state.prepared,
      markers: actual,
      records: state.records.map(({ record, ref, sequence }) => ({
        phase: record.phase,
        recordDigest: record.recordDigest,
        ref,
        sequence,
      })),
      currentHead: state.head,
      historyAuthenticated: true,
      freshPhysicalPairProvisioningCommitted: state.records.length === 3,
      writerFloorInstalled: true,
      bootstrapDirectoryFsyncVerified:
        state.prepared.bootstrapDirectoryFsyncVerified,
      markerDirectoryFsyncAttested: false,
      originCutoverAuthenticated: false,
      originClassificationAvailable: false,
      legacyWriterDrainVerified: false,
      productionAuthorityVerified: false,
      grantsMutationOrPromotionAuthority: false,
      readyForExecution: false,
      qualifiesForPromotion: false,
    });
  }
  function finish(state, operationId, assertOwnership) {
    const verified = status(state, operationId); // Missing marker or debris never triggers repair.
    // A committed operation performs no mutation. Its complete bookended
    // readback already has the same checks as read(), with the outer ownership
    // check still required before returning from the operation lock.
    if (state.records.length === 3) return verified;
    if (state.records.length === 1)
      state = append(
        state,
        "markers-installed",
        markerProof(state.prepared),
        assertOwnership,
      );
    if (state.records.length === 2)
      state = append(
        state,
        "committed",
        {
          installedRecordDigest: state.records[1].record.recordDigest,
          markers: state.proof,
        },
        assertOwnership,
      );
    return status(state, operationId);
  }
  // Constructor verifies retained history but never installs missing markers.
  load();
  const policy = Object.freeze({
    descriptor,
    bindComponent(input) {
      const request = snapshotRrsiData(input);
      rrsiExact(
        request,
        ["operationId", "component"],
        "Registry component binding",
      );
      rrsiId(request.operationId, "provision operation ID");
      if (!["candidate", "release"].includes(request.component))
        rrsiFail("Registry binding component is invalid");
      // Do not take a policy operation lock or repair any Registry path. The
      // retained head and both physical markers bookend this read-only open.
      let original;
      try {
        original = status(load(), request.operationId);
      } catch (cause) {
        if (["ENOENT", "ENOTDIR"].includes(cause?.code))
          hold("an authenticated Registry binding boundary is missing", cause);
        throw cause;
      }
      if (!original.freshPhysicalPairProvisioningCommitted)
        hold("Registry requires committed fresh store provisioning");
      const prepared = original.prepared;
      const component = request.component;
      const store = prepared[component];
      const peer =
        prepared[component === "candidate" ? "release" : "candidate"];
      const componentDescriptor = freezeRrsiData({
        schema: "chainlesschain.rrsi-registry-component-binding/v1",
        operationId: request.operationId,
        component: `skill-${component}-registry`,
        tenantId: prepared.tenantId,
        ...store,
        peerStoreId: peer.storeId,
        journalIdentity: prepared.journalIdentity,
        committedRecordDigest: original.records.at(-1).recordDigest,
        writerFloor: RRSI_REGISTRY_STORE_WRITER_FLOOR,
        registryRuntimeMode: "uninitialized-read-only",
        persistentStoreIdentityAuthenticated: true,
        originCutoverAuthenticated: false,
        originClassificationAvailable: false,
        grantsMutationOrPromotionAuthority: false,
      });
      function recheckUnchecked() {
        // Invalid existing physical state needs no journal recovery or locks.
        assertLayout(prepared, [true, true]);
        if (!equal(markerProof(prepared, true), original.markers))
          hold("Registry marker identity changed after capture");
        const result = status(load(), request.operationId, {
          boundaryOnly: true,
          verifyPermissions: false,
        });
        if (
          !equal(result.prepared, prepared) ||
          !equal(result.markers, original.markers) ||
          !equal(result.records, original.records)
        )
          hold("Registry component binding changed after capture");
        // No origin or runtime attachment exists yet. Unknown content and
        // even empty runtime containers remain HOLD, with no adoption/cleanup.
        assertLayout(prepared, [true, true]);
        if (!equal(markerProof(prepared, true), original.markers))
          hold("Registry markers changed during uninitialized inventory read");
        if (!equal(result.currentHead, headData(methods.verify())))
          hold("Registry journal changed during uninitialized inventory read");
        return result;
      }
      function recheck() {
        try {
          return recheckUnchecked();
        } catch (cause) {
          if (["ENOENT", "ENOTDIR"].includes(cause?.code))
            hold("an authenticated Registry boundary is missing", cause);
          throw cause;
        }
      }
      const componentBinding = Object.freeze({
        descriptor: componentDescriptor,
      });
      COMPONENT_BINDINGS.set(
        componentBinding,
        Object.freeze({
          descriptor: componentDescriptor,
          boundaries: freezeRrsiData({
            base: prepared.directories.find(
              (entry) => entry.path === store.baseDir,
            ),
            tenants: prepared.directories.find(
              (entry) => entry.path === path.dirname(store.rootDir),
            ),
            tenantRoot: prepared.directories.find(
              (entry) => entry.path === store.rootDir,
            ),
          }),
          marker: freezeRrsiData({
            identity: original.markers[component].identity,
            marker: markerFor(prepared, component),
          }),
          recheck,
          recheckForOpen() {
            try {
              assertPrivateParent(prepared.parent);
              return recheck();
            } catch (cause) {
              if (["ENOENT", "ENOTDIR"].includes(cause?.code))
                hold(
                  "an authenticated Registry open boundary is missing",
                  cause,
                );
              throw cause;
            }
          },
          matchesPolicy: (value) => value === policy,
          assertTransactionLedger(value) {
            let reader;
            try {
              reader = captureSkillReleaseOperationReader(value);
            } catch (cause) {
              hold("a genuine Registry transaction port is required", cause);
            }
            if (
              !reader.matchesLedger(ledger) ||
              !reader.matchesArtifactPorts(options.artifactPorts) ||
              !equal(reader.scope, {
                artifactTenantId: descriptor.artifactTenantId,
                audience: descriptor.audience,
                purpose: descriptor.purpose,
              })
            )
              hold(
                "Registry transaction ports require the original journal, artifact ports and exact scope",
              );
          },
          assertMutationAllowed() {
            hold(
              "Registry origin admission and runtime initialization are not implemented",
            );
          },
        }),
      );
      return componentBinding;
    },
    provisionFresh(input) {
      const request = snapshotRrsiData(input);
      rrsiExact(
        request,
        ["parentDir", "operationId"],
        "fresh provisioning request",
      );
      rrsiId(request.operationId, "provision operation ID");
      if (
        typeof request.parentDir !== "string" ||
        path.resolve(request.parentDir) !== request.parentDir
      )
        rrsiFail(
          "provision parent must be an existing absolute canonical directory",
        );
      return locked((assertOwnership) => {
        let state = load();
        if (state.prepared) {
          if (
            state.prepared.operationId !== request.operationId ||
            state.prepared.parent.path !== request.parentDir
          )
            hold(
              "this tenant already has a bound store provisioning operation",
            );
          return finish(state, request.operationId, assertOwnership);
        }
        const prepared = allocate(request, state, assertOwnership);
        state = append(state, "prepared", prepared, assertOwnership);
        const presence = [false, false];
        install(prepared, "candidate", presence, assertOwnership);
        install(prepared, "release", presence, assertOwnership);
        return finish(state, request.operationId, assertOwnership);
      });
    },
    recover(operationId) {
      rrsiId(operationId, "provision operation ID");
      return locked((assertOwnership) =>
        finish(load(), operationId, assertOwnership),
      );
    },
    read(operationId) {
      rrsiId(operationId, "provision operation ID");
      return locked(() => status(load(), operationId));
    },
  });
  POLICIES.set(
    policy,
    Object.freeze({
      descriptor,
      matchesBackend: (value) => value === backend,
      matchesArtifactPorts: (value) => value === options.artifactPorts,
      matchesArtifactResolver: (value) => value === resolver,
      read: policy.read,
    }),
  );
  return policy;
}

export function captureRrsiRegistryStorePolicy(value) {
  const captured = POLICIES.get(value);
  if (!captured) rrsiFail("a genuine Registry store policy is required");
  return captured;
}

export function captureRrsiRegistryComponentBinding(value) {
  const captured = COMPONENT_BINDINGS.get(value);
  if (!captured) hold("a genuine Registry component binding is required");
  return captured;
}

/** Current v1 constructors must never bootstrap in the reserved fresh namespace,
 * including after marker loss and through a canonical filesystem alias. */
export function assertOutsideRrsiRegistryNamespace(baseDir) {
  const reserved = (value) =>
    value.split(/[\\/]/u).some((part) => /^pair\.[a-f0-9-]{36}$/iu.test(part));
  const requested = path.resolve(baseDir);
  if (reserved(requested))
    hold(
      "reserved v2 Registry namespace requires its genuine component binding",
    );
  for (let current = requested; ; current = path.dirname(current)) {
    try {
      const target = path.resolve(
        fs.realpathSync.native(current),
        path.relative(current, requested),
      );
      if (reserved(target))
        hold(
          "reserved v2 Registry namespace cannot be opened through an unbound alias",
        );
      return target;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      if (current === path.dirname(current)) throw error;
    }
  }
}
