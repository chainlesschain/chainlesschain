import { posix, win32 } from "node:path";

function sourcePathError(message) {
  const error = new TypeError(message);
  error.code = "SCHEDULER_SOURCE_PATH_INVALID";
  return error;
}

function pathApiFor(platform) {
  return platform === "win32" ? win32 : posix;
}

function isWindowsFilesystemRoot(value) {
  return (
    /^[A-Za-z]:\\$/u.test(value) ||
    /^\\\\\?\\[A-Za-z]:\\$/u.test(value) ||
    /^\\\\\?\\UNC\\[^\\]+\\[^\\]+\\$/iu.test(value) ||
    /^\\\\(?![?.]\\)[^\\]+\\[^\\]+\\$/u.test(value)
  );
}

function stripNonRootTrailingSeparators(value, pathApi, platform) {
  if (platform === "win32" && isWindowsFilesystemRoot(value)) return value;
  const root = pathApi.parse(value).root;
  let end = value.length;
  while (end > root.length && value[end - 1] === pathApi.sep) end -= 1;
  return value.slice(0, end);
}

export function isFullyQualifiedWindowsSchedulerPath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value
  ) {
    return false;
  }

  // Extended-length paths are accepted only for a fully-qualified drive or
  // UNC share. Other device namespaces (for example \\.\pipe) are not disk
  // locations and must never become durable source locators.
  if (/^[\\/]{2}\?[\\/]UNC[\\/][^\\/]+[\\/]+[^\\/]+(?:[\\/]|$)/iu.test(value)) {
    return true;
  }
  if (/^[\\/]{2}\?[\\/][A-Za-z]:[\\/]/u.test(value)) return true;
  if (/^[\\/]{2}[?.][\\/]/u.test(value)) return false;

  if (/^[A-Za-z]:[\\/]/u.test(value)) return true;
  return /^[\\/]{2}[^\\/]+[\\/]+[^\\/]+(?:[\\/]|$)/u.test(value);
}

/**
 * Produce the durable identity used by scheduler source locators.
 *
 * Windows identities are separator-normalized and case-folded. A rooted path
 * without a drive (\foo), a drive-relative path (C:foo), and incomplete UNC
 * paths are rejected because their meaning depends on process-local state.
 * Plain relative inputs remain supported for runtime-facing adapter APIs and
 * are resolved against a fully-qualified base before they enter a journal.
 */
export function canonicalSchedulerSourcePath(
  value,
  {
    platform = process.platform,
    basePath = process.cwd(),
    allowRelative = true,
  } = {},
) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value
  ) {
    throw sourcePathError("scheduler source path must be a non-empty string");
  }
  const input = value;
  const pathApi = pathApiFor(platform);

  if (platform === "win32") {
    let candidate = input;
    if (!isFullyQualifiedWindowsSchedulerPath(candidate)) {
      const isRootRelative = /^[\\/]/u.test(candidate);
      const isDriveRelative = /^[A-Za-z]:(?:[^\\/]|$)/u.test(candidate);
      if (isRootRelative || isDriveRelative || !allowRelative) {
        throw sourcePathError(
          "Windows scheduler source path must use a fully-qualified drive or UNC share",
        );
      }
      if (!isFullyQualifiedWindowsSchedulerPath(basePath)) {
        throw sourcePathError(
          "Windows scheduler source path base must use a fully-qualified drive or UNC share",
        );
      }
      candidate = pathApi.resolve(basePath, candidate);
    }
    if (!isFullyQualifiedWindowsSchedulerPath(candidate)) {
      throw sourcePathError(
        "Windows scheduler source path must use a fully-qualified drive or UNC share",
      );
    }
    return stripNonRootTrailingSeparators(
      pathApi.normalize(candidate),
      pathApi,
      platform,
    ).toLowerCase();
  }

  if (!pathApi.isAbsolute(input) && !allowRelative) {
    throw sourcePathError("scheduler source path must be absolute");
  }
  return stripNonRootTrailingSeparators(
    pathApi.normalize(
      pathApi.isAbsolute(input) ? input : pathApi.resolve(basePath, input),
    ),
    pathApi,
    platform,
  );
}

export function isCanonicalSchedulerSourcePath(value, options = {}) {
  try {
    return (
      canonicalSchedulerSourcePath(value, {
        ...options,
        allowRelative: false,
      }) === value
    );
  } catch {
    return false;
  }
}

export function schedulerSourcePathDirname(value, options = {}) {
  const platform = options.platform ?? process.platform;
  const pathApi = pathApiFor(platform);
  const canonical = canonicalSchedulerSourcePath(value, options);
  return canonicalSchedulerSourcePath(pathApi.dirname(canonical), {
    ...options,
    platform,
    allowRelative: false,
  });
}
