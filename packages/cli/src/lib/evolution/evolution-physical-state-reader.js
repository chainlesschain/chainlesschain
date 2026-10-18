/** Stable local state windows, never a retention, installation or graph grant. */
import path from "node:path";
import { artifactPhysicalIdentity } from "./evolution-artifact-identity.js";
import { withEvolutionFileIdentity } from "./evolution-file-identity.js";
import { readBoundedDescriptor } from "./bounded-descriptor-read.js";

const DIRECTORY_BOUNDARIES = new WeakMap();

const FILE_FIELDS = Object.freeze([
  "dev",
  "ino",
  "mode",
  "uid",
  "gid",
  "nlink",
  "size",
  "mtimeNs",
  "ctimeNs",
]);
const DIRECTORY_FIELDS = Object.freeze(["dev", "ino", "mode", "uid", "gid"]);
const MUTATION_FIELDS = FILE_FIELDS.filter(
  (field) => field !== "dev" && field !== "ino",
);
const samePath = (left, right) =>
  process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
const birthtime = (stat) => artifactPhysicalIdentity(stat).birthtimeMs;
const sameMetadata = (left, right) =>
  MUTATION_FIELDS.every((field) => left[field] === right[field]) &&
  birthtime(left) === birthtime(right);
const sameStat = (left, right) =>
  left.dev === right.dev && left.ino === right.ino && sameMetadata(left, right);

export function createEvolutionPhysicalStateReader({
  directoryPath: directory,
  fsImpl,
  maximumBytes,
  minimumBytes = 0,
  directoryMode = null,
  sizeError = "exceeds maximumBytes",
  label,
  errorCode,
  readFailureMessage = `${label} bounded state read failed`,
}) {
  if (
    typeof directory !== "string" ||
    !path.isAbsolute(directory) ||
    path.resolve(directory) !== directory ||
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 1 ||
    !Number.isSafeInteger(minimumBytes) ||
    minimumBytes < 0 ||
    minimumBytes > maximumBytes ||
    (directoryMode !== null && typeof directoryMode !== "bigint") ||
    typeof sizeError !== "string" ||
    !sizeError ||
    typeof errorCode !== "string" ||
    !errorCode ||
    typeof readFailureMessage !== "string" ||
    !readFailureMessage ||
    typeof label !== "string" ||
    !label ||
    !fsImpl
  )
    throw new TypeError(
      "physical state reader requires a canonical directory, filesystem, code and byte bounds",
    );
  const physicalPath = (target) => {
    const realpath = fsImpl.realpathSync;
    return typeof realpath.native === "function"
      ? realpath.native(target)
      : realpath.call(fsImpl, target);
  };
  const fail = (message, cause) => {
    throw Object.assign(new Error(message, cause ? { cause } : undefined), {
      code: errorCode,
    });
  };
  const guard = (operation) => {
    try {
      return operation();
    } catch (cause) {
      if (cause?.code === errorCode) throw cause;
      fail(readFailureMessage, cause);
    }
  };
  const inspectDirectory = () => {
    const stat = fsImpl.lstatSync(directory, { bigint: true });
    if (DIRECTORY_FIELDS.some((field) => typeof stat?.[field] !== "bigint"))
      fail(`${label} directory requires full-precision stat fields`);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      !samePath(physicalPath(directory), directory)
    )
      fail(`${label} directory must be physically canonical`);
    if (directoryMode !== null && (stat.mode & 0o7777n) !== directoryMode)
      fail(`${label} directory permissions are invalid`);
    return stat;
  };
  // Contents, link count and mutation times may change during legitimate locks
  // and temporary+rename writes. Only the original directory identity/owner is
  // retained; mutable leaf files acquire a new identity on every read.
  const originalDirectory = guard(() => {
    const stat = inspectDirectory();
    return Object.freeze({
      ...Object.fromEntries(
        DIRECTORY_FIELDS.map((field) => [field, stat[field]]),
      ),
      birthtimeMs: birthtime(stat),
    });
  });
  const recheck = () => {
    const current = inspectDirectory();
    if (
      !DIRECTORY_FIELDS.every(
        (field) => originalDirectory[field] === current[field],
      ) ||
      originalDirectory.birthtimeMs !== birthtime(current)
    )
      fail(`${label} directory physical identity changed`);
  };
  const safeStat = (stat, source, byteLimit) => {
    if (FILE_FIELDS.some((field) => typeof stat?.[field] !== "bigint"))
      fail(`${label} ${source} requires full-precision stat fields`);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n)
      fail(`${label} file identity is invalid`);
    if (stat.size < BigInt(minimumBytes) || stat.size > BigInt(byteLimit))
      fail(`${label} ${sizeError}`);
  };
  // Only identity-helper directory opens use this adapter. All operations,
  // including Windows path/handle bridging, retain the caller's original fsImpl.
  const directoryFs = Object.freeze({
    constants: fsImpl.constants,
    realpathSync: Object.assign(
      (...args) => fsImpl.realpathSync(...args),
      typeof fsImpl.realpathSync.native === "function"
        ? { native: (...args) => fsImpl.realpathSync.native(...args) }
        : {},
    ),
    lstatSync: (...args) => fsImpl.lstatSync(...args),
    fstatSync: (...args) => fsImpl.fstatSync(...args),
    closeSync: (...args) => fsImpl.closeSync(...args),
    openSync: (target, flags) =>
      fsImpl.openSync(
        target,
        flags |
          (fsImpl.constants.O_NONBLOCK || 0) |
          (fsImpl.constants.O_DIRECTORY || 0),
      ),
  });
  const read = (file, byteLimit, allowAbsent, prepareFile) => {
    if (
      typeof file !== "string" ||
      !path.isAbsolute(file) ||
      path.resolve(file) !== file ||
      path.dirname(file) !== directory ||
      !Number.isSafeInteger(byteLimit) ||
      byteLimit < 0 ||
      typeof allowAbsent !== "boolean" ||
      (prepareFile !== null && typeof prepareFile !== "function")
    )
      throw new TypeError(
        "physical state read requires a direct canonical child and finite byte bound",
      );
    byteLimit = Math.min(maximumBytes, byteLimit);
    recheck();
    let before;
    try {
      before = fsImpl.lstatSync(file, { bigint: true });
    } catch (cause) {
      // Preserve the backend's absent-state contract, without treating access
      // errors, dangling links or a disappearance during open/read as absence.
      if (cause?.code !== "ENOENT" || !allowAbsent) throw cause;
      recheck();
      return null;
    }
    safeStat(before, "path", byteLimit);
    if (prepareFile !== null) {
      // Preserve existing private-file preparation without treating a repaired
      // ctime/mode as mutation inside the later stable content window.
      const identity = {
        dev: before.dev,
        ino: before.ino,
        birthtimeMs: birthtime(before),
      };
      prepareFile(file);
      recheck();
      before = fsImpl.lstatSync(file, { bigint: true });
      safeStat(before, "path", byteLimit);
      if (
        before.dev !== identity.dev ||
        before.ino !== identity.ino ||
        birthtime(before) !== identity.birthtimeMs
      )
        fail(`${label} file changed during private-file preparation`);
    }
    if (!samePath(physicalPath(file), file))
      fail(`${label} file must be physically canonical`);
    return withEvolutionFileIdentity(directoryFs, file, (samePathHandle) => {
      recheck();
      let descriptor = null;
      try {
        descriptor = fsImpl.openSync(
          file,
          fsImpl.constants.O_RDONLY |
            (fsImpl.constants.O_NOFOLLOW || 0) |
            (fsImpl.constants.O_NONBLOCK || 0),
        );
        const opened = fsImpl.fstatSync(descriptor, { bigint: true });
        safeStat(opened, "descriptor", byteLimit);
        if (!samePathHandle(before, opened) || !sameMetadata(before, opened))
          fail(`${label} path and descriptor identities differ`);
        const bytes = readBoundedDescriptor(
          fsImpl,
          descriptor,
          Number(opened.size),
          byteLimit,
        );
        const afterDescriptor = fsImpl.fstatSync(descriptor, { bigint: true });
        const afterPath = fsImpl.lstatSync(file, { bigint: true });
        safeStat(afterDescriptor, "descriptor", byteLimit);
        safeStat(afterPath, "path", byteLimit);
        if (!sameStat(opened, afterDescriptor))
          fail(`${label} descriptor changed during bounded read`);
        if (
          !sameStat(before, afterPath) ||
          !samePathHandle(afterPath, afterDescriptor) ||
          !sameMetadata(afterPath, afterDescriptor) ||
          !samePath(physicalPath(file), file)
        )
          fail(`${label} pathname changed during bounded read`);
        recheck();
        return bytes;
      } finally {
        if (descriptor !== null) fsImpl.closeSync(descriptor);
      }
    });
  };
  const reader = Object.freeze({
    read: (
      file,
      {
        maximumBytes: byteLimit = maximumBytes,
        allowAbsent = false,
        prepareFile = null,
      } = {},
    ) => guard(() => read(file, byteLimit, allowAbsent, prepareFile)),
    recheck: () => guard(recheck),
  });
  // Project the original construction pin; later capture never claims a new
  // pathname. The brand identifies this factory/its original ports, not native
  // filesystem trust, installation authority, or any leaf inventory.
  const descriptor = Object.freeze({
    schema: "chainlesschain.evolution-physical-state-directory-boundary/v1",
    scope: "single-original-state-directory",
    directory: Object.freeze({
      path: directory,
      identity: Object.freeze({
        ...Object.fromEntries(
          DIRECTORY_FIELDS.map((field) => [
            field,
            String(originalDirectory[field]),
          ]),
        ),
        birthtimeMs: originalDirectory.birthtimeMs,
      }),
    }),
    fileIdentityVerified: false,
    fileContentsVerified: false,
    storageInventoryVerified: false,
    retentionStorageVerified: false,
    fullPhysicalStorageGraphVerified: false,
    rootAuthorityVerified: false,
    routingPinVerified: false,
    crossProcessRollbackProtectionVerified: false,
    grantsMutationOrPromotionAuthority: false,
  });
  const recheckDirectory = (...args) => {
    if (args.length)
      throw new TypeError("directory boundary takes no replacement context");
    return guard(() => {
      recheck();
      return descriptor;
    });
  };
  recheckDirectory();
  DIRECTORY_BOUNDARIES.set(
    reader,
    Object.freeze({
      descriptor,
      recheck: Object.freeze(recheckDirectory),
    }),
  );
  return reader;
}

/** Metadata-only original directory of a genuine physical state reader. */
export function captureEvolutionPhysicalStateReaderDirectoryBoundary(reader) {
  if (arguments.length !== 1)
    throw new TypeError("directory capture takes one original reader");
  const boundary = DIRECTORY_BOUNDARIES.get(reader);
  if (!boundary)
    throw new TypeError("an original physical state reader is required");
  boundary.recheck();
  return boundary;
}
