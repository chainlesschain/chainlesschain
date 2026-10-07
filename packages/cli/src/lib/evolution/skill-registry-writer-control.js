/** Cooperative writer exclusion for the Registry transition release. */
import { createHash } from "node:crypto";
import path from "node:path";
import { types as utilTypes } from "node:util";
import { withFileLock, withFileLockAsync } from "../with-file-lock.js";

export const SKILL_REGISTRY_WRITER_PROTOCOL_SCHEMA =
  "chainlesschain.skill-registry-writer-protocol/v1";
export const SKILL_REGISTRY_WRITER_BUSY_CODE = "CC_SKILL_REGISTRY_WRITER_BUSY";
const ACTIVE = new Map();
const canonicalPath = (value) =>
  process.platform === "win32" ? value.toLowerCase() : value;
const identity = (stat) => `${String(stat.dev)}:${String(stat.ino)}`;
function fail(message, code = "CC_SKILL_REGISTRY_WRITER_UNSAFE") {
  throw Object.assign(new Error(message), { code });
}

/** Called by real Registry constructors; this generic lock is not an origin authority. */
export function createSkillRegistryWriterControl({
  rootDir,
  tenantId,
  component,
  fsImpl,
}) {
  const root = path.resolve(rootDir),
    parent = path.dirname(root);
  const realpath = fsImpl.realpathSync?.native ?? fsImpl.realpathSync;
  if (typeof realpath !== "function")
    fail("Registry writer requires canonical filesystem paths");
  function capture(directory) {
    const stat = fsImpl.lstatSync(directory);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      canonicalPath(path.resolve(realpath(directory))) !==
        canonicalPath(directory)
    )
      fail("Registry writer directory is not canonical");
    return Object.freeze({ path: directory, identity: identity(stat) });
  }
  const directories = [capture(root), capture(parent)];
  function assertDirectories() {
    for (const directory of directories) {
      const current = capture(directory.path);
      if (current.identity !== directory.identity)
        fail("Registry writer directory identity changed");
    }
  }
  const rootPathDigest = createHash("sha256")
    .update(canonicalPath(root))
    .digest("hex");
  // A sibling of the tenant root: existing artifact formats and strict root
  // inventories stay unchanged. Canonical physical paths unify reopen/aliases.
  const target = path.join(parent, `.registry-writer-${rootPathDigest}`);
  const key = canonicalPath(target);
  let held = null;
  function assertIfWriting() {
    if (held) {
      held.context.assertOwnership();
      assertDirectories();
    }
  }
  function enter(role) {
    assertDirectories();
    // Sync reentry must never block a same-process async owner from finishing.
    if (ACTIVE.has(key))
      fail(
        "Registry writer or maintenance operation is already active",
        SKILL_REGISTRY_WRITER_BUSY_CODE,
      );
    const state = { role, context: null };
    ACTIVE.set(key, state);
    return state;
  }
  function leave(state) {
    held = null;
    if (ACTIVE.get(key) === state) ACTIVE.delete(key);
  }
  function execute(state, context, operation) {
    if (context.locked !== true) fail("Registry writer lock was not acquired");
    state.context = context;
    held = state;
    assertIfWriting();
    return operation();
  }
  function runSync(operation) {
    const state = enter("writer");
    try {
      return withFileLock(
        target,
        (context) => {
          const result = execute(state, context, operation);
          if (utilTypes.isPromise(result))
            fail("Registry synchronous writer cannot return a Promise");
          assertIfWriting();
          return result;
        },
        { failIfUnavailable: true, timeoutMs: 0 },
      );
    } finally {
      leave(state);
    }
  }
  async function runAsync(operation, role = "writer") {
    const state = enter(role);
    try {
      return await withFileLockAsync(
        target,
        async (context) => {
          const result = await execute(state, context, operation);
          assertIfWriting();
          return result;
        },
        { failIfUnavailable: true, timeoutMs: 0 },
      );
    } finally {
      leave(state);
    }
  }
  return Object.freeze({
    descriptor: Object.freeze({
      schema: SKILL_REGISTRY_WRITER_PROTOCOL_SCHEMA,
      tenantId,
      component,
      canonicalRootPathDigest: `sha256:${rootPathDigest}`,
      participatingWriterProtocolRevision: 1,
      coversPreTransitionBinaryWriters: false,
      persistentStoreIdentityAuthenticated: false,
      originCutoverAuthenticated: false,
      grantsOriginOrPromotionAuthority: false,
    }),
    orderKey: key,
    runSync,
    runAsync,
    maintainAsync: (operation) => runAsync(operation, "maintenance"),
    assertIfWriting,
  });
}
