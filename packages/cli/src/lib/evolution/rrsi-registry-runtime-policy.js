/** Authenticated empty runtime containers; never content-origin admission. */
import fs from "node:fs";
import path from "node:path";
import { isProxy } from "node:util/types";
import { inspectPrivatePaths, repairPrivatePath } from "../secure-fs.js";
import { captureRrsiRegistryStorePolicy } from "./rrsi-registry-store-policy.js";
import { captureEvolutionLedgerFileBackend } from "./evolution-ledger-file-backend.js";
import {
  EvolutionArtifactPorts,
  EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
} from "./evolution-artifact-ports.js";
import {
  EVOLUTION_LEDGER_MAX_EVENTS,
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
} from "./evolution-ledger.js";
import {
  rrsiCanonical,
  rrsiHash,
  rrsiEnvelope,
  rrsiExact,
  rrsiId,
  rrsiFail,
  snapshotRrsiData,
  freezeRrsiData,
} from "./rrsi-data.js";

export const RRSI_REGISTRY_RUNTIME_POLICY_SCHEMA =
  "chainlesschain.rrsi-registry-runtime-policy/v1";
export const RRSI_REGISTRY_RUNTIME_EVENT_TYPE =
  "rrsi.registry-runtime.initialized";
export const RRSI_REGISTRY_RUNTIME_ARTIFACT_TYPE =
  "skill-registry-runtime-policy";
export const RRSI_REGISTRY_RUNTIME_HOLD_CODE =
  "CC_RRSI_REGISTRY_STORE_POLICY_HOLD";
const EVENT_SCHEMA = "chainlesschain.rrsi-registry-runtime-event/v1";
const AREAS = [
  "artifacts",
  "active",
  "journals",
  "locks",
  "state-migrations",
  "staging",
];
const PHASES = [
  "prepared",
  ...AREAS.map((name) => `${name}-installed`),
  "committed",
];
const RUNTIMES = new WeakMap();
const same = (left, right) => rrsiCanonical(left) === rrsiCanonical(right);
const head = (value) =>
  Object.fromEntries(
    ["ledgerId", "identityDigest", "epoch", "sequence", "headDigest"].map(
      (key) => [key, value[key]],
    ),
  );
const identity = (stat) => `${stat.dev}:${stat.ino}`;
function hold(message, cause) {
  try {
    rrsiFail(message, RRSI_REGISTRY_RUNTIME_HOLD_CODE);
  } catch (error) {
    if (cause) error.cause = cause;
    throw error;
  }
}
function copyRef(value) {
  return Object.fromEntries(
    ["schema", "ref", "digest"].map((name) => {
      const field = Object.getOwnPropertyDescriptor(value, name);
      if (!field?.enumerable || !("value" in field))
        hold("runtime artifact reference is not original own data");
      return [name, field.value];
    }),
  );
}
function own(input, names) {
  if (
    !input ||
    isProxy(input) ||
    Object.getPrototypeOf(input) !== Object.prototype ||
    Reflect.ownKeys(input).length !== names.length
  )
    hold("runtime requires plain own composition fields");
  return Object.fromEntries(
    names.map((name) => {
      const field = Object.getOwnPropertyDescriptor(input, name);
      if (!field?.enumerable || !("value" in field))
        hold("runtime composition cannot use accessors");
      return [name, field.value];
    }),
  );
}
function directory(target) {
  const stat = fs.lstatSync(target);
  const canonical = fs.realpathSync.native(target);
  const equalPath = (left, right) =>
    process.platform === "win32"
      ? left.toLowerCase() === right.toLowerCase()
      : left === right;
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    !equalPath(path.resolve(canonical), target)
  )
    hold("runtime directory must be canonical and non-linked");
  return { path: target, identity: identity(stat) };
}
function names(target) {
  const result = [],
    handle = fs.opendirSync(target);
  try {
    for (;;) {
      const entry = handle.readSync();
      if (entry === null) break;
      if (result.length >= 8)
        hold("runtime inventory exceeded its empty-layout bound");
      result.push(entry.name);
    }
  } finally {
    handle.closeSync();
  }
  return result.sort();
}
function privateDirectories(entries) {
  if (entries.length === 0) return;
  entries.forEach((entry) => {
    if (!same(directory(entry.path), entry))
      hold("runtime permission boundary identity changed");
  });
  const inspected = inspectPrivatePaths(entries.map((entry) => entry.path));
  if (
    inspected.length !== entries.length ||
    inspected.some((entry) => entry.ok !== true || entry.exists !== true)
  )
    hold(
      "runtime directories require verified owner-only permissions",
      new Error(
        inspected.find((entry) => entry.ok !== true || entry.exists !== true)
          ?.error || "owner-only permission inspection was not successful",
      ),
    );
  entries.forEach((entry) => {
    if (!same(directory(entry.path), entry))
      hold("runtime identity changed during permission inspection");
  });
}
function syncDirectory(target) {
  let fd;
  try {
    fd = fs.openSync(target, "r");
    fs.fsyncSync(fd);
    return true;
  } catch (error) {
    if (
      process.platform !== "win32" ||
      !["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error.code)
    )
      throw error;
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

export function createRrsiRegistryRuntimePolicy(input) {
  const options = own(input, [
    "storePolicy",
    "backend",
    "artifactPorts",
    "ledgerArtifactResolver",
  ]);
  const policy = captureRrsiRegistryStorePolicy(options.storePolicy);
  const backend = captureEvolutionLedgerFileBackend(options.backend);
  if (
    !policy.matchesBackend(backend) ||
    !policy.matchesArtifactPorts(options.artifactPorts) ||
    !policy.matchesArtifactResolver(options.ledgerArtifactResolver)
  )
    hold(
      "runtime requires the original store policy backend, ports and resolver",
    );
  const ledger = backend.ledger,
    descriptor = freezeRrsiData({
      schema: RRSI_REGISTRY_RUNTIME_POLICY_SCHEMA,
      tenantId: policy.descriptor.tenantId,
      artifactTenantId: policy.descriptor.artifactTenantId,
      audience: policy.descriptor.audience,
      purpose: policy.descriptor.purpose,
      scopeId: `${policy.descriptor.scopeId}.runtime`,
      originAdmissionImplemented: false,
      grantsMutationOrPromotionAuthority: false,
    });
  const methods = Object.fromEntries(
    ["verify", "read", "appendDomainEvent"].map((name) => {
      const method = Object.getOwnPropertyDescriptor(ledger, name)?.value;
      if (typeof method !== "function" || !Object.isFrozen(ledger))
        hold("runtime requires original frozen journal methods");
      return [name, (...args) => Reflect.apply(method, ledger, args)];
    }),
  );
  const eventId = (operationId, phase) =>
    `registry-runtime.${rrsiHash(EVENT_SCHEMA, { operationId, phase }).slice(7)}`;
  const paths = (provision) =>
    Object.fromEntries(
      AREAS.map((name) => [
        name,
        path.join(provision.prepared.release.rootDir, name),
      ]),
    );
  function recordFor(ref, provision) {
    const resolution = Reflect.apply(
      options.ledgerArtifactResolver,
      undefined,
      [
        {
          ledgerId: provision.prepared.journalIdentity.ledgerId,
          epoch: provision.prepared.journalIdentity.epoch,
          ref,
          tenantId: descriptor.artifactTenantId,
        },
      ],
    );
    if (
      resolution?.schema !== EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA ||
      resolution.authenticated !== true ||
      resolution.found !== true ||
      resolution.ref !== ref.ref ||
      resolution.digest !== ref.digest ||
      !Buffer.isBuffer(resolution.bytes) ||
      resolution.bytes.length > 1024 * 1024
    )
      hold("runtime retained artifact cannot be authenticated");
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
      stored.type !== RRSI_REGISTRY_RUNTIME_ARTIFACT_TYPE ||
      stored.retention !== "ledger" ||
      !Buffer.from(rrsiCanonical(stored)).equals(resolution.bytes)
    )
      hold("runtime artifact bytes or retention scope differ");
    return stored.value;
  }
  function load(operationId) {
    rrsiId(operationId, "provision operation ID");
    for (let attempt = 0; attempt < 3; attempt++) {
      const captured = policy.captureCommittedBoundary(operationId),
        provision = captured.snapshot,
        before = provision.currentHead;
      const events = methods.read({
        afterSequence: 0,
        limit: EVOLUTION_LEDGER_MAX_EVENTS,
      });
      if (!same(before, head(methods.verify()))) continue;
      if (
        events.length !== before.sequence ||
        events.some((event, index) => event.sequence !== index + 1)
      )
        hold("runtime needs complete contiguous history");
      const records = [],
        directories = {},
        fsync = {};
      for (const event of events) {
        if (event.type !== RRSI_REGISTRY_RUNTIME_EVENT_TYPE) continue;
        if (
          records.length >= PHASES.length ||
          event.schema !== EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA ||
          event.tenantId !== descriptor.tenantId ||
          event.artifactTenantId !== descriptor.artifactTenantId ||
          event.correlationId !== descriptor.scopeId ||
          event.skillName !== null ||
          event.decision !== "committed"
        )
          hold("runtime event scope differs");
        const record = recordFor(event.subjectRef, provision),
          previous = records.at(-1);
        const coreNames = [
          "descriptor",
          "operationId",
          "provisionRecordDigest",
          "journalIdentity",
          "phase",
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
          "runtime event record",
        );
        const rebuilt = rrsiEnvelope(
          EVENT_SCHEMA,
          "recordDigest",
          Object.fromEntries(coreNames.map((name) => [name, record[name]])),
        );
        const predecessor = previous
          ? previous.ref
          : provision.records.at(-1).ref;
        if (
          !same(record, rebuilt) ||
          !same(record.descriptor, descriptor) ||
          record.operationId !== operationId ||
          record.provisionRecordDigest !==
            provision.records.at(-1).recordDigest ||
          !same(record.journalIdentity, provision.prepared.journalIdentity) ||
          record.phase !== PHASES[records.length] ||
          record.previousRecordDigest !==
            (previous?.record.recordDigest ?? null) ||
          !same(record.observedHead, {
            ...provision.prepared.journalIdentity,
            sequence: event.sequence - 1,
            headDigest: event.prevDigest,
          }) ||
          event.eventId !== eventId(operationId, record.phase) ||
          !same(event.sourceRefs.map(copyRef), [predecessor]) ||
          event.sequence <= provision.records.at(-1).sequence
        )
          hold("runtime phase, original provisioning or predecessor differs");
        if (record.phase === "prepared") {
          if (!same(record.payload, { paths: paths(provision) }))
            hold("runtime prepared paths differ");
        } else if (record.phase === "committed") {
          if (
            !same(record.payload, {
              directories,
              directoryFsyncVerified: fsync,
            })
          )
            hold("runtime committed inventory differs");
        } else {
          const name = AREAS[records.length - 1],
            entry = record.payload;
          rrsiExact(
            entry,
            ["name", "directory", "directoryFsyncVerified"],
            "runtime installed directory",
          );
          rrsiExact(
            entry.directory,
            ["path", "identity"],
            "runtime directory identity",
          );
          if (
            entry.name !== name ||
            entry.directory.path !== paths(provision)[name] ||
            !/^[0-9]+:[0-9]+$/u.test(entry.directory.identity) ||
            typeof entry.directoryFsyncVerified !== "boolean" ||
            [
              ...provision.prepared.directories,
              ...Object.values(directories),
            ].some((value) => value.identity === entry.directory.identity)
          )
            hold("runtime directory identity or order differs");
          directories[name] = entry.directory;
          fsync[name] = entry.directoryFsyncVerified;
        }
        records.push({
          record,
          ref: copyRef(event.subjectRef),
          sequence: event.sequence,
        });
      }
      const after = captured.recheck();
      if (!same(before, after.currentHead)) continue;
      return {
        provision: after,
        recheckBoundary: captured.recheck,
        head: before,
        records,
        directories,
        fsync,
      };
    }
    hold("runtime journal changed repeatedly during readback");
  }
  function layout(state, ownDirectory = null) {
    const original = state.provision,
      current = state.recheckBoundary();
    if (!same(current.currentHead, state.head))
      hold("runtime head changed after authenticated state capture");
    if (
      !same(original.prepared, current.prepared) ||
      !same(original.markers, current.markers) ||
      !same(original.records, current.records)
    )
      hold("runtime original provisioning changed");
    const prepared = current.prepared,
      all = {
        ...state.directories,
        ...(ownDirectory
          ? { [ownDirectory.name]: ownDirectory.directory }
          : {}),
      };
    for (const entry of prepared.directories) {
      const expected = prepared.directories
        .filter((other) => path.dirname(other.path) === entry.path)
        .map((other) => path.basename(other.path));
      if (
        [prepared.candidate.rootDir, prepared.release.rootDir].includes(
          entry.path,
        )
      )
        expected.push("_tenant.json");
      if (entry.path === prepared.release.rootDir)
        expected.push(...Object.keys(all));
      if (!same(names(entry.path), expected.sort()))
        hold(
          "runtime inventory contains unknown or unrecorded directories/content",
        );
    }
    for (const entry of Object.values(all))
      if (!same(directory(entry.path), entry) || names(entry.path).length !== 0)
        hold(
          "runtime registered directory changed or contains business content",
        );
    for (const entry of Object.values(all))
      if (!same(directory(entry.path), entry))
        hold("runtime directory identity changed during inventory read");
    const after = state.recheckBoundary();
    if (
      !same(after.markers, current.markers) ||
      !same(after.currentHead, state.head)
    )
      hold("runtime marker or journal changed during inventory read");
    return after;
  }
  function append(state, phase, payload, assertOwnership, ownDirectory = null) {
    assertOwnership();
    const current = layout(state, ownDirectory);
    const previous = state.records.at(-1),
      operationId = current.operationId;
    const record = rrsiEnvelope(EVENT_SCHEMA, "recordDigest", {
      descriptor,
      operationId,
      provisionRecordDigest: current.records.at(-1).recordDigest,
      journalIdentity: current.prepared.journalIdentity,
      phase,
      previousRecordDigest: previous?.record.recordDigest ?? null,
      observedHead: current.currentHead,
      payload,
    });
    assertOwnership();
    const publication = Reflect.apply(
      EvolutionArtifactPorts.prototype.putCanonical,
      options.artifactPorts,
      [
        RRSI_REGISTRY_RUNTIME_ARTIFACT_TYPE,
        record,
        {
          audience: descriptor.audience,
          purpose: descriptor.purpose,
          retention: "ledger",
        },
      ],
    );
    if (
      publication?.receipt?.persisted !== true ||
      publication.receipt.integrityVerified !== true ||
      publication.receipt.readbackVerified !== true ||
      publication.receipt.retention !== "ledger" ||
      !same(recordFor(publication.ref, current), record)
    )
      hold("runtime artifact was not retained exactly");
    assertOwnership();
    layout(state, ownDirectory);
    privateDirectories([
      ...Object.values(state.directories),
      ...(ownDirectory ? [ownDirectory.directory] : []),
    ]);
    layout(state, ownDirectory);
    assertOwnership();
    try {
      const receipt = methods.appendDomainEvent(
        {
          type: RRSI_REGISTRY_RUNTIME_EVENT_TYPE,
          eventId: eventId(operationId, phase),
          tenantId: descriptor.tenantId,
          artifactTenantId: descriptor.artifactTenantId,
          correlationId: descriptor.scopeId,
          skillName: null,
          decision: "committed",
          reason:
            "Authenticated empty runtime initialization; origin and business admission remain unavailable",
          sourceRefs: [previous ? previous.ref : current.records.at(-1).ref],
          subjectRef: copyRef(publication.ref),
        },
        {
          expectedHeadDigest: current.currentHead.headDigest,
          expectedSequence: current.currentHead.sequence,
        },
      );
      if (receipt?.authenticated !== true || receipt.durable !== true)
        hold("runtime commit receipt is uncertain");
    } catch (cause) {
      throw Object.assign(
        new Error(
          "runtime commit is uncertain; recover the original operation",
          { cause },
        ),
        { code: "CC_RRSI_REGISTRY_RUNTIME_COMMIT_UNKNOWN", operationId },
      );
    }
    assertOwnership();
    const readback = load(operationId);
    if (readback.records.at(-1)?.record.recordDigest !== record.recordDigest)
      hold("runtime phase cannot be read back");
    layout(readback);
    return readback;
  }
  function read(operationId) {
    try {
      const state = load(operationId);
      if (state.records.length !== PHASES.length)
        hold("runtime initialization is unregistered or incomplete");
      const current = layout(state);
      return freezeRrsiData({
        schema: "chainlesschain.rrsi-registry-runtime-readback/v1",
        operationId,
        directories: state.directories,
        directoryFsyncVerified: state.fsync,
        committedRecordDigest: state.records.at(-1).record.recordDigest,
        currentHead: current.currentHead,
        historyAuthenticated: true,
        runtimeDirectoryIdentityAuthenticated: true,
        originCutoverAuthenticated: false,
        grantsMutationOrPromotionAuthority: false,
      });
    } catch (cause) {
      if (["ENOENT", "ENOTDIR"].includes(cause?.code))
        hold("an authenticated runtime boundary is missing", cause);
      throw cause;
    }
  }
  function initialize(operationId) {
    rrsiId(operationId, "provision operation ID");
    try {
      return policy.maintain((assertOwnership) => {
        let state = load(operationId);
        layout(state);
        privateDirectories([
          state.provision.prepared.parent,
          ...state.provision.prepared.directories,
          ...Object.values(state.directories),
        ]);
        layout(state);
        if (state.records.length === PHASES.length) return read(operationId);
        if (state.records.length === 0)
          state = append(
            state,
            "prepared",
            { paths: paths(state.provision) },
            assertOwnership,
          );
        while (Object.keys(state.directories).length < AREAS.length) {
          const name = AREAS[Object.keys(state.directories).length],
            target = paths(state.provision)[name];
          assertOwnership();
          layout(state);
          assertOwnership();
          fs.mkdirSync(target, { mode: 0o700 });
          const entry = directory(target),
            ownDirectory = { name, directory: entry };
          assertOwnership();
          layout(state, ownDirectory);
          assertOwnership();
          repairPrivatePath(target, {
            failIfUnavailable: true,
            applyWindowsAcl: true,
          });
          privateDirectories([entry]);
          assertOwnership();
          layout(state, ownDirectory);
          assertOwnership();
          const flushed = syncDirectory(
            state.provision.prepared.release.rootDir,
          );
          state = append(
            state,
            `${name}-installed`,
            { ...ownDirectory, directoryFsyncVerified: flushed },
            assertOwnership,
            ownDirectory,
          );
        }
        state = append(
          state,
          "committed",
          {
            directories: state.directories,
            directoryFsyncVerified: state.fsync,
          },
          assertOwnership,
        );
        assertOwnership();
        return read(operationId);
      });
    } catch (cause) {
      if (["ENOENT", "ENOTDIR"].includes(cause?.code))
        hold("an authenticated runtime boundary is missing", cause);
      throw cause;
    }
  }
  const runtime = Object.freeze({
    descriptor,
    initialize,
    recover: initialize,
    read,
  });
  RUNTIMES.set(
    runtime,
    Object.freeze({
      descriptor,
      read,
      matchesPolicy: (value) => value === options.storePolicy,
      verifyPrivateDirectories(operationId) {
        const current = read(operationId);
        privateDirectories(Object.values(current.directories));
        return read(operationId);
      },
    }),
  );
  return runtime;
}

export function captureRrsiRegistryRuntimePolicy(value) {
  const reader = RUNTIMES.get(value);
  if (!reader) hold("a genuine Registry runtime attachment is required");
  return reader;
}
