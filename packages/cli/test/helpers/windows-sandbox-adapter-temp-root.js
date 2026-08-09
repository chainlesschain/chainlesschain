import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const WINDOWS_SANDBOX_ADAPTER_TEMP_ROOT_ENV =
  "CC_WINDOWS_SANDBOX_ADAPTER_TEMP_ROOT";
export const WINDOWS_SANDBOX_ADAPTER_TEST_ROOT_PREFIX =
  "cc-vitest-win-sandbox-";

const TEST_ROOT_NAME_PATTERN = /^cc-vitest-win-sandbox-[A-Za-z0-9_-]{6}$/;
const HELPER_DIRECTORY_PATTERN = /^chainless-win-sandbox-[0-9a-f]{48}$/;
const DIRECT_FILE_PATTERNS = [
  /^chainless-win-sandbox-[0-9a-f]{48}\.dll$/,
  /^chainless-win-sandbox-invocation-[0-9a-f]{48}\.json$/,
  /^chainless-win-sandbox-identity-[0-9a-f]{48}\.json$/,
];
const HELPER_EXECUTABLE_NAME = "windows-sandbox-helper.exe";
const DEFAULT_CLEANUP_ATTEMPTS = 40;
const DEFAULT_CLEANUP_RETRY_MS = 25;

function fail(message) {
  throw new Error(`Windows sandbox Vitest temp root: ${message}`);
}

export function relativeCanonicalWindowsSandboxAdapterPath({
  rootRealPath,
  targetPath,
  pathApi = path,
}) {
  const relativePath = pathApi.relative(
    pathApi.resolve(rootRealPath),
    pathApi.resolve(targetPath),
  );
  if (
    !relativePath ||
    pathApi.isAbsolute(relativePath) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${pathApi.sep}`)
  ) {
    fail("target is outside the captured canonical root");
  }
  return relativePath.split(pathApi.sep);
}

function comparablePath(pathApi, platform, value) {
  const resolved = pathApi.resolve(String(value));
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

function samePath(pathApi, platform, left, right) {
  return (
    comparablePath(pathApi, platform, left) ===
    comparablePath(pathApi, platform, right)
  );
}

function realpath(fsApi, targetPath) {
  const operation = fsApi.realpathSync?.native || fsApi.realpathSync;
  if (typeof operation !== "function") {
    fail("filesystem dependency does not expose realpathSync");
  }
  return operation(targetPath);
}

function lstat(fsApi, targetPath) {
  return fsApi.lstatSync(targetPath, { bigint: true });
}

function identityValue(value) {
  return typeof value === "bigint" ? value.toString() : String(value);
}

function captureIdentity(stats) {
  return {
    dev: identityValue(stats.dev),
    ino: identityValue(stats.ino),
    birthtime:
      stats.birthtimeNs === undefined
        ? identityValue(stats.birthtimeMs)
        : identityValue(stats.birthtimeNs),
  };
}

function sameIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.birthtime === right.birthtime
  );
}

function isReparseOrLink(stats) {
  return (
    stats.isSymbolicLink() ||
    stats.isReparsePoint?.() === true ||
    stats.reparsePoint === true
  );
}

function assertPlainDirectory({
  fsApi,
  pathApi,
  platform,
  targetPath,
  expectedRealPath,
  expectedIdentity,
  label,
}) {
  let stats;
  try {
    stats = lstat(fsApi, targetPath);
  } catch (error) {
    fail(`${label} cannot be inspected: ${error?.message || error}`);
  }
  if (!stats.isDirectory() || isReparseOrLink(stats)) {
    fail(`${label} must be a real, non-reparse directory`);
  }

  let resolvedRealPath;
  try {
    resolvedRealPath = realpath(fsApi, targetPath);
  } catch (error) {
    fail(`${label} real path cannot be resolved: ${error?.message || error}`);
  }
  if (
    expectedRealPath &&
    !samePath(pathApi, platform, resolvedRealPath, expectedRealPath)
  ) {
    fail(`${label} resolves outside its captured path`);
  }

  const identity = captureIdentity(stats);
  if (expectedIdentity && !sameIdentity(identity, expectedIdentity)) {
    fail(`${label} identity changed after setup`);
  }
  return { identity, realPath: resolvedRealPath };
}

function assertPlainFile({
  fsApi,
  pathApi,
  platform,
  targetPath,
  expectedRealPath,
  expectedIdentity,
  label,
}) {
  let stats;
  try {
    stats = lstat(fsApi, targetPath);
  } catch (error) {
    fail(`${label} cannot be inspected: ${error?.message || error}`);
  }
  if (!stats.isFile() || isReparseOrLink(stats)) {
    fail(`${label} must be a regular, non-link file`);
  }
  if (identityValue(stats.nlink) !== "1") {
    fail(`${label} must have exactly one filesystem link`);
  }

  let resolvedRealPath;
  try {
    resolvedRealPath = realpath(fsApi, targetPath);
  } catch (error) {
    fail(`${label} real path cannot be resolved: ${error?.message || error}`);
  }
  if (
    expectedRealPath &&
    !samePath(pathApi, platform, resolvedRealPath, expectedRealPath)
  ) {
    fail(`${label} resolves outside its captured path`);
  }

  const identity = captureIdentity(stats);
  if (expectedIdentity && !sameIdentity(identity, expectedIdentity)) {
    fail(`${label} identity changed during teardown`);
  }
  return { identity, realPath: resolvedRealPath };
}

function defaultSleepSync(delayMs) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
}

function retryStrictOperation(
  operation,
  {
    attempts = DEFAULT_CLEANUP_ATTEMPTS,
    delayMs = DEFAULT_CLEANUP_RETRY_MS,
    sleepSync = defaultSleepSync,
  } = {},
) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      operation();
      return;
    } catch (error) {
      lastError = error;
    }
    if (attempt + 1 < attempts) sleepSync(delayMs);
  }
  throw lastError;
}

function validateRoot({
  fsApi,
  pathApi,
  platform,
  rootPath,
  systemTempPath,
  systemTempRealPath,
  expectedRootRealPath,
  expectedRootIdentity,
}) {
  const rootName = pathApi.basename(rootPath);
  if (!TEST_ROOT_NAME_PATTERN.test(rootName)) {
    fail(`captured root has an invalid name: ${rootName}`);
  }
  if (!samePath(pathApi, platform, pathApi.dirname(rootPath), systemTempPath)) {
    fail("captured root is not a direct child of the system temp directory");
  }

  let currentSystemTempRealPath;
  try {
    currentSystemTempRealPath = realpath(fsApi, systemTempPath);
  } catch (error) {
    fail(
      `system temp real path cannot be resolved: ${error?.message || error}`,
    );
  }
  if (
    !samePath(pathApi, platform, currentSystemTempRealPath, systemTempRealPath)
  ) {
    fail("system temp directory identity changed after setup");
  }

  const expectedByParent = pathApi.join(systemTempRealPath, rootName);
  const inspected = assertPlainDirectory({
    fsApi,
    pathApi,
    platform,
    targetPath: rootPath,
    expectedRealPath: expectedRootRealPath || expectedByParent,
    expectedIdentity: expectedRootIdentity,
    label: "captured root",
  });
  if (!samePath(pathApi, platform, inspected.realPath, expectedByParent)) {
    fail(
      "captured root is a reparse path or escaped the system temp directory",
    );
  }
  return inspected;
}

function preflightRootContents({
  fsApi,
  pathApi,
  platform,
  rootPath,
  rootRealPath,
}) {
  const files = [];
  const directories = [];
  const directEntries = fsApi.readdirSync(rootPath, { withFileTypes: true });

  for (const directEntry of directEntries) {
    const name = directEntry.name;
    const targetPath = pathApi.join(rootPath, name);
    const targetRealPath = pathApi.join(rootRealPath, name);

    if (HELPER_DIRECTORY_PATTERN.test(name)) {
      const directory = assertPlainDirectory({
        fsApi,
        pathApi,
        platform,
        targetPath,
        expectedRealPath: targetRealPath,
        label: `helper directory ${name}`,
      });
      const directoryRecord = {
        path: targetPath,
        realPath: directory.realPath,
        identity: directory.identity,
        label: `helper directory ${name}`,
      };
      const children = fsApi.readdirSync(targetPath, { withFileTypes: true });
      if (children.length > 1) {
        fail(`helper directory ${name} contains unexpected entries`);
      }
      if (children.length === 1) {
        if (children[0].name !== HELPER_EXECUTABLE_NAME) {
          fail(`helper directory ${name} contains an unknown entry`);
        }
        const helperPath = pathApi.join(targetPath, HELPER_EXECUTABLE_NAME);
        const helperRealPath = pathApi.join(
          directory.realPath,
          HELPER_EXECUTABLE_NAME,
        );
        const helper = assertPlainFile({
          fsApi,
          pathApi,
          platform,
          targetPath: helperPath,
          expectedRealPath: helperRealPath,
          label: `helper executable in ${name}`,
        });
        files.push({
          path: helperPath,
          realPath: helper.realPath,
          identity: helper.identity,
          label: `helper executable in ${name}`,
          parentDirectory: directoryRecord,
        });
      }
      directories.push(directoryRecord);
      continue;
    }

    if (DIRECT_FILE_PATTERNS.some((pattern) => pattern.test(name))) {
      const file = assertPlainFile({
        fsApi,
        pathApi,
        platform,
        targetPath,
        expectedRealPath: targetRealPath,
        label: `adapter file ${name}`,
      });
      files.push({
        path: targetPath,
        realPath: file.realPath,
        identity: file.identity,
        label: `adapter file ${name}`,
      });
      continue;
    }

    fail(`captured root contains an unknown entry: ${name}`);
  }

  return { directories, files };
}

function revalidateRootGuard({ fsApi, pathApi, platform, rootGuard }) {
  validateRoot({
    fsApi,
    pathApi,
    platform,
    rootPath: rootGuard.path,
    systemTempPath: rootGuard.systemTempPath,
    systemTempRealPath: rootGuard.systemTempRealPath,
    expectedRootRealPath: rootGuard.realPath,
    expectedRootIdentity: rootGuard.identity,
  });
}

function removeValidatedFile({
  fsApi,
  pathApi,
  platform,
  rootGuard,
  file,
  retryOptions,
}) {
  retryStrictOperation(() => {
    revalidateRootGuard({ fsApi, pathApi, platform, rootGuard });
    if (file.parentDirectory) {
      assertPlainDirectory({
        fsApi,
        pathApi,
        platform,
        targetPath: file.parentDirectory.path,
        expectedRealPath: file.parentDirectory.realPath,
        expectedIdentity: file.parentDirectory.identity,
        label: file.parentDirectory.label,
      });
    }
    assertPlainFile({
      fsApi,
      pathApi,
      platform,
      targetPath: file.path,
      expectedRealPath: file.realPath,
      expectedIdentity: file.identity,
      label: file.label,
    });
    fsApi.unlinkSync(file.path);
  }, retryOptions);
}

function removeValidatedDirectory({
  fsApi,
  pathApi,
  platform,
  rootGuard,
  directory,
  retryOptions,
}) {
  retryStrictOperation(() => {
    revalidateRootGuard({ fsApi, pathApi, platform, rootGuard });
    assertPlainDirectory({
      fsApi,
      pathApi,
      platform,
      targetPath: directory.path,
      expectedRealPath: directory.realPath,
      expectedIdentity: directory.identity,
      label: directory.label,
    });
    if (fsApi.readdirSync(directory.path).length !== 0) {
      fail(`${directory.label} changed after validation`);
    }
    fsApi.rmdirSync(directory.path);
  }, retryOptions);
}

/**
 * Test-harness-only cleanup. Node does not expose descriptor-relative
 * unlinkat/rmdirat primitives on Windows, so a residual path-swap window
 * remains between the final identity check and each path-based mutation.
 * The unpredictable, suite-owned root plus repeated root/child validation
 * narrows that window; production cleanup must not treat this as a general
 * untrusted-directory deletion primitive.
 */
export function cleanupWindowsSandboxAdapterTestRoot({
  fsApi = fs,
  pathApi = path,
  platform = process.platform,
  rootPath,
  systemTempPath,
  systemTempRealPath,
  rootRealPath,
  rootIdentity,
  retryOptions,
}) {
  const root = validateRoot({
    fsApi,
    pathApi,
    platform,
    rootPath,
    systemTempPath,
    systemTempRealPath,
    expectedRootRealPath: rootRealPath,
    expectedRootIdentity: rootIdentity,
  });
  const plan = preflightRootContents({
    fsApi,
    pathApi,
    platform,
    rootPath,
    rootRealPath: root.realPath,
  });
  const rootGuard = {
    path: rootPath,
    systemTempPath,
    systemTempRealPath,
    realPath: root.realPath,
    identity: root.identity,
  };

  for (const file of plan.files) {
    removeValidatedFile({
      fsApi,
      pathApi,
      platform,
      rootGuard,
      file,
      retryOptions,
    });
  }
  for (const directory of plan.directories) {
    removeValidatedDirectory({
      fsApi,
      pathApi,
      platform,
      rootGuard,
      directory,
      retryOptions,
    });
  }

  retryStrictOperation(() => {
    validateRoot({
      fsApi,
      pathApi,
      platform,
      rootPath,
      systemTempPath,
      systemTempRealPath,
      expectedRootRealPath: root.realPath,
      expectedRootIdentity: root.identity,
    });
    if (fsApi.readdirSync(rootPath).length !== 0) {
      fail("captured root changed after validation");
    }
    fsApi.rmdirSync(rootPath);
  }, retryOptions);
}

export function wrapWindowsSandboxAdapterGlobalTeardown(
  teardown,
  { processApi = process } = {},
) {
  if (typeof teardown !== "function") {
    throw new TypeError("Windows sandbox global teardown must be a function");
  }
  return () => {
    try {
      return teardown();
    } catch (error) {
      processApi.exitCode = 1;
      throw error;
    }
  };
}

export function installWindowsSandboxAdapterTestRoot({
  platform = process.platform,
  env = process.env,
  fsApi = fs,
  osApi = os,
  pathApi = path,
  systemTempDirectory,
  retryOptions,
} = {}) {
  if (platform !== "win32") {
    return { installed: false };
  }

  const systemTempPath = pathApi.resolve(systemTempDirectory || osApi.tmpdir());
  const systemTempRealPath = realpath(fsApi, systemTempPath);
  const rootPath = fsApi.mkdtempSync(
    pathApi.join(systemTempPath, WINDOWS_SANDBOX_ADAPTER_TEST_ROOT_PREFIX),
  );

  // If validation fails, preserve the path for inspection. It may have been
  // replaced, so no destructive operation is safe before identity acceptance.
  const root = validateRoot({
    fsApi,
    pathApi,
    platform,
    rootPath,
    systemTempPath,
    systemTempRealPath,
  });

  const hadPreviousValue = Object.hasOwn(
    env,
    WINDOWS_SANDBOX_ADAPTER_TEMP_ROOT_ENV,
  );
  const previousValue = env[WINDOWS_SANDBOX_ADAPTER_TEMP_ROOT_ENV];
  env[WINDOWS_SANDBOX_ADAPTER_TEMP_ROOT_ENV] = rootPath;

  let teardownStarted = false;
  const teardown = () => {
    if (teardownStarted) return;
    teardownStarted = true;
    try {
      cleanupWindowsSandboxAdapterTestRoot({
        fsApi,
        pathApi,
        platform,
        rootPath,
        systemTempPath,
        systemTempRealPath,
        rootRealPath: root.realPath,
        rootIdentity: root.identity,
        retryOptions,
      });
    } finally {
      if (hadPreviousValue) {
        env[WINDOWS_SANDBOX_ADAPTER_TEMP_ROOT_ENV] = previousValue;
      } else {
        delete env[WINDOWS_SANDBOX_ADAPTER_TEMP_ROOT_ENV];
      }
    }
  };

  return {
    installed: true,
    rootPath,
    capture: {
      rootPath,
      systemTempPath,
      systemTempRealPath,
      rootRealPath: root.realPath,
      rootIdentity: root.identity,
    },
    teardown,
  };
}
