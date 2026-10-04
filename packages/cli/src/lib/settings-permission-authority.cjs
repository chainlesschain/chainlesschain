"use strict";

// Trusted-host, cooperative Linux binding. Only explicit provisioning creates
// an authority; a reader/writer never registers or repairs a missing domain.
const path = require("node:path");
const { types } = require("node:util");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const { observeSettingsSources } = require("./settings-source-observation.cjs");
const domain = require("./settings-authority-domain.cjs");
const records = require("./settings-authority-record.cjs");
const bindings = new WeakMap();
const SCHEMA = "chainlesschain.settings-permission-launch/v1";
const loader = () => require("./settings-loader.cjs");

function fail(code = "CC_SETTINGS_PERMISSION_BINDING_INVALID") {
  throw Object.assign(
    new Error("Persistent settings permission binding is unavailable"),
    { code },
  );
}

function dataCopy(input, depth = 0) {
  if (input === null || ["string", "boolean", "number"].includes(typeof input))
    return input;
  if (!input || typeof input !== "object" || types.isProxy(input) || depth > 12)
    fail();
  const array = Array.isArray(input);
  if (
    !array &&
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    fail();
  const output = array ? [] : {};
  const keys = Reflect.ownKeys(input);
  if (keys.length > 1024) fail();
  for (const key of keys) {
    if (array && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (
      typeof key !== "string" ||
      !descriptor ||
      !Object.hasOwn(descriptor, "value") ||
      key === "__proto__" ||
      (array && !/^(0|[1-9][0-9]*)$/.test(key))
    )
      fail();
    output[key] = dataCopy(descriptor.value, depth + 1);
  }
  if (
    array &&
    (output.length !== input.length ||
      Object.keys(output).length !== input.length)
  )
    fail();
  return Object.freeze(output);
}

function exactKeys(value, keys) {
  if (
    !value ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== [...keys].sort().join(",")
  )
    fail();
}

function absolute(value) {
  if (
    typeof value !== "string" ||
    !value ||
    !path.isAbsolute(value) ||
    path.resolve(value) !== value
  )
    fail();
  return value;
}

function captureContexts(input, captured = false) {
  const contexts = dataCopy(input);
  if (!Array.isArray(contexts) || !contexts.length || contexts.length > 64)
    fail();
  const ids = new Set();
  return Object.freeze(
    contexts.map((context) => {
      const fields = [
        "contextId",
        "cwd",
        "settingsFile",
        "managedSettingsFile",
        "userSettingsFile",
        "scopedFile",
      ];
      if (captured) exactKeys(context, fields);
      else if (Object.keys(context).some((key) => !fields.includes(key)))
        fail();
      if (
        typeof context.contextId !== "string" ||
        !/^[a-zA-Z0-9._:-]{1,128}$/.test(context.contextId) ||
        ids.has(context.contextId)
      )
        fail();
      ids.add(context.contextId);
      const cwd = captured
        ? absolute(context.cwd)
        : path.resolve(context.cwd || process.cwd());
      const settingsFile =
        context.settingsFile === null || context.settingsFile === undefined
          ? null
          : captured
            ? absolute(context.settingsFile)
            : path.resolve(cwd, context.settingsFile);
      const managedSettingsFile = captured
        ? absolute(context.managedSettingsFile)
        : loader().managedSettingsPath(context);
      const userSettingsFile = captured
        ? absolute(context.userSettingsFile)
        : context.userSettingsFile
          ? path.resolve(context.userSettingsFile)
          : loader().scopeFile(cwd, "user");
      const scopedFile = captured
        ? absolute(context.scopedFile)
        : context.scopedFile
          ? path.resolve(context.scopedFile)
          : require("./scoped-permission-store.js").defaultScopedPermissionStatePath(
              cwd,
            );
      return Object.freeze({
        contextId: context.contextId,
        cwd,
        settingsFile,
        managedSettingsFile: path.resolve(managedSettingsFile),
        userSettingsFile: path.resolve(userSettingsFile),
        scopedFile,
      });
    }),
  );
}

function observe(contexts) {
  const observations = new Map();
  const manifests = contexts.map((context) => {
    const observation = loader().inspectSettingsSources(context);
    const scopedObservation = observeSettingsSources([context.scopedFile])[0];
    observations.set(context.contextId, { observation, scopedObservation });
    return records.createManifest({
      contextId: context.contextId,
      discovery: [
        context.cwd,
        context.userSettingsFile,
        context.managedSettingsFile,
        ...(context.settingsFile ? [context.settingsFile] : []),
        context.scopedFile,
      ],
      sources: [...observation.sources, scopedObservation],
    });
  });
  return { observations, manifests };
}

function observer(contexts, save = () => {}) {
  return (expected) => {
    if (
      expected.length !== contexts.length ||
      expected.some(
        (context, index) => context.contextId !== contexts[index].contextId,
      )
    )
      fail("CC_SETTINGS_AUTHORITY_BINDING_CHANGED");
    // Recompute the complete discovery route, never reuse ledger source paths.
    const current = observe(contexts);
    save(current.observations);
    return current.manifests;
  };
}

/** Explicit administrator/host provisioning. Parent directories must exist. */
function initializeSettingsPermissionAuthority({
  directory,
  forbiddenRoots,
  contexts,
}) {
  const captured = captureContexts(contexts);
  const initial = observe(captured);
  const handle = domain.initializeSettingsAuthorityDomain({
    directory,
    forbiddenRoots: [
      ...new Set([
        ...forbiddenRoots,
        ...captured.map((context) => context.cwd),
      ]),
    ],
    contexts: initial.manifests,
    observeContexts: observer(captured),
  });
  try {
    return dataCopy({
      schema: SCHEMA,
      domain: domain.exportSettingsAuthorityDomain(handle),
      contexts: captured,
    });
  } finally {
    domain.closeSettingsAuthorityDomain(handle);
  }
}

/** Reopen a fixed launch descriptor in a process or Worker; never bootstrap. */
function openSettingsPermissionAuthority({ launch, contextId }) {
  launch = dataCopy(launch);
  exactKeys(launch, ["schema", "domain", "contexts"]);
  if (launch.schema !== SCHEMA) fail();
  const contexts = captureContexts(launch.contexts, true);
  const selected = contexts.find((context) => context.contextId === contextId);
  if (!selected) fail("CC_SETTINGS_AUTHORITY_CONTEXT_UNREGISTERED");
  const handle = domain.reopenSettingsAuthorityDomain({
    descriptor: launch.domain,
  });
  const binding = Object.freeze({});
  const state = { handle, launch, contexts, selected, closed: false };
  bindings.set(binding, state);
  try {
    readSettingsPermissionAuthority(binding);
    return binding;
  } catch (error) {
    closeSettingsPermissionAuthority(binding);
    throw error;
  }
}

function stateFor(binding) {
  const state = bindings.get(binding);
  if (!state || state.closed) fail();
  return state;
}

function settingsPermissionAuthorityOptions(binding) {
  return stateFor(binding).selected;
}

function exportSettingsPermissionAuthority(binding) {
  const state = stateFor(binding);
  domain.exportSettingsAuthorityDomain(state.handle); // Verify namespace first.
  return state.launch;
}

function readSettingsPermissionAuthority(binding, { forUpdate = false } = {}) {
  const state = stateFor(binding);
  let observations;
  const read = forUpdate
    ? domain.readSettingsAuthorityForUpdate
    : domain.readSettingsAuthority;
  const result = read(state.handle, {
    observeContexts: observer(state.contexts, (value) => {
      observations = value;
    }),
    localRevision: () => localRevision(state),
  });
  const observed = observations.get(state.selected.contextId);
  return Object.freeze({
    snapshot: result.snapshot,
    observation: observed.observation,
    scopedObservation: observed.scopedObservation,
  });
}

function localRevision(state) {
  const settings = loader().getSettingsPermissionRevision();
  const scoped =
    require("./scoped-permission-store.js").getScopedPermissionRevision();
  if (
    state.localRevision?.settings !== settings ||
    state.localRevision?.scoped !== scoped
  )
    state.localRevision = Object.freeze({ settings, scoped });
  return state.localRevision;
}

// Keep the observation's minting and projection within one loader instance.
// Hosts with an ESM transform loader can also load CJS through native require;
// the native observation must still pass its original private WeakSet brand.
function projectSettingsPermissionObservation(observation, options) {
  return loader().projectSettingsObservation(observation, options);
}

function assertSettingsPermissionWritableRoots(binding, roots) {
  const state = stateFor(binding);
  const directory = domain.exportSettingsAuthorityDomain(
    state.handle,
  ).directory;
  for (const root of roots) {
    const canonical = fs.realpathSync(absolute(root));
    const overlaps = [
      path.relative(canonical, directory),
      path.relative(directory, canonical),
    ].some(
      (relative) =>
        relative === "" ||
        (!relative.startsWith(".." + path.sep) &&
          relative !== ".." &&
          !path.isAbsolute(relative)),
    );
    if (overlaps) fail("CC_SETTINGS_AUTHORITY_DOMAIN_OVERLAP");
  }
}

// Used only by the official synchronous settings writer. Callbacks remain a
// trusted host contract; no callback or arbitrary source enters launch data.
function mutateSettingsPermissionSource(
  binding,
  { logicalPath, prepare, revokeLocal, replace },
) {
  const state = stateFor(binding);
  logicalPath = absolute(logicalPath);
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = readSettingsPermissionAuthority(binding, {
      forUpdate: true,
    });
    const source = [
      ...current.observation.sources,
      current.scopedObservation,
    ].find((item) => item.logicalPath === logicalPath);
    if (!source) fail("CC_SETTINGS_AUTHORITY_SOURCE_UNREGISTERED");
    const data = JSON.parse(JSON.stringify(source.settings || {}));
    if (prepare(data) === false)
      return { changed: false, snapshot: current.snapshot };
    const bytes = Buffer.from(`${JSON.stringify(data, null, 2)}\n`);
    if (bytes.length > 1024 * 1024) fail("CC_SETTINGS_SOURCE_TOO_LARGE");
    try {
      return domain.transitionSettingsAuthority(state.handle, {
        intent: {
          kind: "write",
          physicalPath: source.physicalPath,
          after: {
            exists: true,
            byteLength: bytes.length,
            digest: createHash("sha256").update(bytes).digest("hex"),
          },
        },
        expectedSnapshot: current.snapshot,
        localRevision: () => localRevision(state),
        observeContexts: observer(state.contexts),
        revokeLocal,
        replace: () => replace(source.physicalPath, data),
      });
    } catch (error) {
      if (
        error.cause?.code !== "CC_SETTINGS_AUTHORITY_CONFLICT" ||
        error.commitState !== "not-committed" ||
        error.authorityState !== "unchanged"
      )
        throw error;
    }
  }
  fail("CC_SETTINGS_AUTHORITY_CONFLICT");
}

function closeSettingsPermissionAuthority(binding) {
  const state = stateFor(binding);
  domain.closeSettingsAuthorityDomain(state.handle);
  state.closed = true;
}

module.exports = {
  initializeSettingsPermissionAuthority,
  openSettingsPermissionAuthority,
  exportSettingsPermissionAuthority,
  closeSettingsPermissionAuthority,
  settingsPermissionAuthorityOptions,
  readSettingsPermissionAuthority,
  projectSettingsPermissionObservation,
  mutateSettingsPermissionSource,
  assertSettingsPermissionWritableRoots,
};
