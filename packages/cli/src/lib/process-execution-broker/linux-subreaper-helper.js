import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  LINUX_SUBREAPER_SOURCE_DIGEST,
  MAX_SUBREAPER_IMAGE_BYTES,
  MAX_SUBREAPER_MANIFEST_BYTES,
  validateLinuxSubreaperArtifact,
  validateLinuxSubreaperElf,
} from "./linux-subreaper-artifact.js";
export { LINUX_SUBREAPER_SOURCE_DIGEST } from "./linux-subreaper-artifact.js";

const MAX_SOURCE_BYTES = 128 * 1024;
const MAX_IMAGE_BYTES = MAX_SUBREAPER_IMAGE_BYTES;
const images = new Map();
const leases = new WeakMap();
const sha = (bytes) =>
  "sha256:" + crypto.createHash("sha256").update(bytes).digest("hex");

function failure(reason) {
  const error = new Error(
    `Linux process supervision helper unavailable: ${reason}`,
  );
  error.code = "EXTERNAL_AGENT_HELPER_UNAVAILABLE";
  return error;
}

function readDescriptor(fd, maximum) {
  const before = fs.fstatSync(fd, { bigint: true });
  if (!before.isFile() || before.size < 1n || before.size > BigInt(maximum))
    throw failure("invalid-file");
  const bytes = Buffer.alloc(Number(before.size));
  let offset = 0;
  while (offset < bytes.length) {
    const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
    if (count <= 0) throw failure("short-file-read");
    offset += count;
  }
  const after = fs.fstatSync(fd, { bigint: true });
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeNs !== after.mtimeNs ||
    before.ctimeNs !== after.ctimeNs
  )
    throw failure("file-changed");
  return { bytes, stat: after };
}

function compilerPath() {
  // Only the system toolchain is eligible. Do not consult PATH, CC, loader,
  // include-path, or plugin-provided compiler settings.
  const compiler = fs.realpathSync("/usr/bin/cc");
  let current = compiler;
  for (;;) {
    const info = fs.lstatSync(current);
    if (info.isSymbolicLink() || info.uid !== 0 || (info.mode & 0o022) !== 0)
      throw failure("untrusted-system-compiler");
    if (current === compiler && (!info.isFile() || (info.mode & 0o111) === 0))
      throw failure("invalid-system-compiler");
    if (current === "/") break;
    current = path.dirname(current);
  }
  return compiler;
}

function isPkgRuntime() {
  if (!process.pkg) return false;
  // The location is derived only from this module and pkg's bootstrap, never
  // from cwd, executable siblings, environment variables or caller paths.
  if (
    typeof process.pkg.defaultEntrypoint !== "string" ||
    !process.pkg.defaultEntrypoint.startsWith("/snapshot/") ||
    !fileURLToPath(import.meta.url).startsWith("/snapshot/")
  )
    throw failure("invalid-standalone-runtime");
  return true;
}

function readPkgAsset(file, maximum) {
  // pkg's snapshot descriptors refer to /dev/null in the kernel and are read
  // through its immutable payload reader. They are NOT native directory FDs.
  // Reject real files mounted under a snapshot-looking pathname as well as
  // symlink aliases; a pathname prefix alone never establishes this identity.
  if (fs.realpathSync(file) !== file || fs.lstatSync(file).isSymbolicLink())
    throw failure("invalid-standalone-asset");
  const fd = fs.openSync(file, fs.constants.O_RDONLY);
  try {
    if (fs.readlinkSync(`/proc/self/fd/${fd}`) !== "/dev/null")
      throw failure("standalone-asset-not-embedded");
    const stat = fs.fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.size < 1 ||
      stat.size > maximum ||
      stat.nlink !== 0 ||
      stat.ino !== 0 ||
      stat.dev !== 0
    )
      throw failure("invalid-standalone-asset");
    // readFileSync(path) reads the embedded payload directly. pkg readSync(fd)
    // can instead read a decompressed external cache when compression is on.
    // Never trust those cache bytes as supervision executable content.
    const bytes = fs.readFileSync(file);
    if (
      !Buffer.isBuffer(bytes) ||
      bytes.length !== stat.size ||
      bytes.length > maximum
    )
      throw failure("invalid-standalone-asset");
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}

function packagedImage() {
  const root = fileURLToPath(
    new URL("../../assets/linux-subreaper/", import.meta.url),
  );
  if (isPkgRuntime()) {
    const directory = path.join(root, `linux-${process.arch}`);
    const manifest = readPkgAsset(
      path.join(directory, "manifest.json"),
      MAX_SUBREAPER_MANIFEST_BYTES,
    );
    const bytes = readPkgAsset(
      path.join(directory, "supervisor"),
      MAX_IMAGE_BYTES,
    );
    return {
      bytes,
      identity: validateLinuxSubreaperArtifact(manifest, bytes, {
        arch: process.arch,
      }),
    };
  }
  // Only source checkouts with no packaged directory may use the development
  // compiler path. A partial/corrupt installed payload must never fall back.
  try {
    if (!fs.lstatSync(root).isDirectory())
      throw failure("invalid-packaged-directory");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  let rootFd = null;
  let dirFd = null;
  const read = (name, maximum) => {
    const fd = fs.openSync(
      `/proc/self/fd/${dirFd}/${name}`,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
    try {
      const snapshot = readDescriptor(fd, maximum);
      if (snapshot.stat.nlink !== 1n) throw failure("invalid-packaged-file");
      return snapshot.bytes;
    } finally {
      fs.closeSync(fd);
    }
  };
  try {
    rootFd = fs.openSync(
      root,
      fs.constants.O_RDONLY |
        fs.constants.O_DIRECTORY |
        fs.constants.O_NOFOLLOW,
    );
    dirFd = fs.openSync(
      `/proc/self/fd/${rootFd}/linux-${process.arch}`,
      fs.constants.O_RDONLY |
        fs.constants.O_DIRECTORY |
        fs.constants.O_NOFOLLOW,
    );
    const manifest = read("manifest.json", MAX_SUBREAPER_MANIFEST_BYTES);
    const bytes = read("supervisor", MAX_IMAGE_BYTES);
    const identity = validateLinuxSubreaperArtifact(manifest, bytes, {
      arch: process.arch,
    });
    return { bytes, identity };
  } catch (error) {
    if (error.code === "EXTERNAL_AGENT_HELPER_UNAVAILABLE") throw error;
    throw failure("packaged-helper-unavailable");
  } finally {
    if (dirFd !== null) fs.closeSync(dirFd);
    if (rootFd !== null) fs.closeSync(rootFd);
  }
}

function compileImage(spawnSync) {
  let sourceFd = null;
  let directoryFd = null;
  let imageFd = null;
  let temporaryRoot = null;
  let imagePath = null;
  try {
    // Vite may import the Broker through an http: module URL on non-Linux
    // hosts. Resolve this Linux-only asset only when native supervision runs.
    const source = fileURLToPath(
      new URL("./linux-subreaper-supervisor.c", import.meta.url),
    );
    const packed = isPkgRuntime();
    let sourceSnapshot;
    if (packed) {
      sourceSnapshot = readPkgAsset(source, MAX_SOURCE_BYTES);
    } else {
      sourceFd = fs.openSync(
        source,
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
      );
      const snapshot = readDescriptor(sourceFd, MAX_SOURCE_BYTES);
      if (snapshot.stat.nlink !== 1n) throw failure("source-digest-mismatch");
      sourceSnapshot = snapshot.bytes;
      fs.closeSync(sourceFd);
      sourceFd = null;
    }
    // npm/git may transport text with CRLF. Compile the exact canonical bytes
    // that the source digest commits to, passed on stdin rather than reopened.
    const sourceBytes = Buffer.from(
      sourceSnapshot.toString("utf8").replace(/\r\n/g, "\n"),
    );
    if (sha(sourceBytes) !== LINUX_SUBREAPER_SOURCE_DIGEST)
      throw failure("source-digest-mismatch");
    const packaged = packagedImage();
    const compiler = packaged ? null : compilerPath();
    temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-linux-subreaper-build-"),
    );
    fs.chmodSync(temporaryRoot, 0o700);
    directoryFd = fs.openSync(
      temporaryRoot,
      fs.constants.O_RDONLY |
        fs.constants.O_DIRECTORY |
        fs.constants.O_NOFOLLOW,
    );
    const directory = fs.fstatSync(directoryFd);
    if (
      !directory.isDirectory() ||
      directory.uid !== process.getuid() ||
      (directory.mode & 0o777) !== 0o700
    )
      throw failure("untrusted-build-directory");
    imagePath = path.join(temporaryRoot, "supervisor");
    // The compiler writes through its inherited directory handle. An ancestor
    // rename cannot redirect the build to a caller-supplied executable path.
    if (packaged) {
      fs.writeFileSync(
        `/proc/self/fd/${directoryFd}/supervisor`,
        packaged.bytes,
        { flag: "wx", mode: 0o500 },
      );
    } else {
      const built = spawnSync(
        compiler,
        [
          "-std=c11",
          "-Wall",
          "-Wextra",
          "-Werror",
          "-O2",
          "-fstack-protector-strong",
          "-D_FORTIFY_SOURCE=2",
          "-x",
          "c",
          "-",
          "-o",
          "/proc/self/fd/3/supervisor",
        ],
        {
          cwd: temporaryRoot,
          env: { PATH: "/usr/bin:/bin", LC_ALL: "C" },
          shell: false,
          input: sourceBytes,
          timeout: 30000,
          maxBuffer: 1024 * 1024,
          stdio: ["pipe", "pipe", "pipe", directoryFd],
        },
      );
      if (built.error || built.status !== 0 || built.signal)
        throw failure("native-build-failed");
    }
    imageFd = fs.openSync(
      `/proc/self/fd/${directoryFd}/supervisor`,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
    fs.fchmodSync(imageFd, 0o500);
    const image = readDescriptor(imageFd, MAX_IMAGE_BYTES);
    if (
      image.stat.uid !== BigInt(process.getuid()) ||
      image.stat.nlink !== 1n ||
      (image.stat.mode & 0o777n) !== 0o500n
    )
      throw failure("untrusted-helper-image");
    validateLinuxSubreaperElf(image.bytes, {
      arch: process.arch,
      staticOnly: Boolean(packaged),
    });
    if (packaged && sha(image.bytes) !== packaged.identity.imageDigest)
      throw failure("packaged-copy-changed");
    // Remove the name before granting a launch lease. The executable can only
    // be reached through the held descriptor; a later pathname swap is inert.
    fs.unlinkSync(`/proc/self/fd/${directoryFd}/supervisor`);
    imagePath = null;
    const held = fs.fstatSync(imageFd, { bigint: true });
    if (
      held.nlink !== 0n ||
      held.dev !== image.stat.dev ||
      held.ino !== image.stat.ino
    )
      throw failure("helper-unlink-unconfirmed");
    const entry = {
      fd: imageFd,
      dev: held.dev,
      ino: held.ino,
      digest: sha(image.bytes),
      distribution: packaged ? "packaged-static" : "local-build",
    };
    imageFd = null;
    return entry;
  } catch (error) {
    if (error.code === "EXTERNAL_AGENT_HELPER_UNAVAILABLE") throw error;
    // Do not expose compiler stdout/stderr, paths, environment, or native argv.
    throw failure(
      error.code === "ENOENT"
        ? process.pkg
          ? "standalone-asset-missing"
          : "system-compiler-or-source-missing"
        : "native-build-setup-failed",
    );
  } finally {
    if (sourceFd !== null) fs.closeSync(sourceFd);
    if (imageFd !== null) fs.closeSync(imageFd);
    if (imagePath && directoryFd !== null) {
      try {
        fs.unlinkSync(`/proc/self/fd/${directoryFd}/supervisor`);
      } catch {
        /* Preserve the admission failure. */
      }
    }
    if (directoryFd !== null) fs.closeSync(directoryFd);
    if (temporaryRoot) {
      try {
        fs.rmdirSync(temporaryRoot);
      } catch {
        /* Never recursively remove an unexpected build entry. */
      }
    }
  }
}

/** Acquire a one-use descriptor lease from trusted packaged source. */
export function acquireLinuxSubreaperHelper({ spawnSync }) {
  if (process.platform !== "linux" || typeof spawnSync !== "function")
    throw failure("unsupported-host");
  let entry = images.get(spawnSync);
  if (!entry) {
    entry = compileImage(spawnSync);
    images.set(spawnSync, entry);
    // Outstanding leases hold their own duplicated descriptor. Bound cached
    // native-seam variants without invalidating already-started children.
    if (images.size > 4) {
      const oldest = images.keys().next().value;
      fs.closeSync(images.get(oldest).fd);
      images.delete(oldest);
    }
  }
  const held = readDescriptor(entry.fd, MAX_IMAGE_BYTES);
  if (
    held.stat.dev !== entry.dev ||
    held.stat.ino !== entry.ino ||
    held.stat.nlink !== 0n ||
    sha(held.bytes) !== entry.digest
  )
    throw failure("cached-helper-changed");
  const descriptor = fs.openSync(
    `/proc/self/fd/${entry.fd}`,
    fs.constants.O_RDONLY,
  );
  try {
    const borrowed = fs.fstatSync(descriptor, { bigint: true });
    if (
      borrowed.dev !== entry.dev ||
      borrowed.ino !== entry.ino ||
      borrowed.nlink !== 0n
    )
      throw failure("helper-lease-changed");
  } catch (error) {
    fs.closeSync(descriptor);
    throw error;
  }
  const lease = Object.freeze({ kind: "linux-subreaper-helper-lease/v1" });
  leases.set(lease, {
    descriptor,
    sourceDigest: LINUX_SUBREAPER_SOURCE_DIGEST,
    imageDigest: entry.digest,
    distribution: entry.distribution,
  });
  return lease;
}

export function consumeLinuxSubreaperHelper(lease) {
  const entry = leases.get(lease);
  if (!entry) throw failure("invalid-or-consumed-helper-lease");
  leases.delete(lease);
  let released = false;
  return Object.freeze({
    ...entry,
    release() {
      if (!released) {
        released = true;
        fs.closeSync(entry.descriptor);
      }
    },
  });
}
