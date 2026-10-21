import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const DIRECTORY_ATTRIBUTE = 0x10;
const REPARSE_POINT_ATTRIBUTE = 0x400;
const GENERIC_READ_WRITE = 0xc0000000;
const FILE_SHARE_ALL = 0x7;
const OPEN_EXISTING = 3;
const FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
const FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
const DRIVE_FIXED = 3;
let windowsApi = null;
const localUiEvolutionFileSystems = new WeakSet();

function loadWindowsApi() {
  if (windowsApi !== null) return windowsApi;
  const koffi = require("koffi");
  const kernel32 = koffi.load("kernel32.dll");
  const HANDLE = koffi.pointer(
    "ChainlessChainEvolutionDirectoryHandle",
    koffi.opaque(),
  );
  const FILETIME = koffi.struct("ChainlessChainEvolutionFileTime", {
    lowDateTime: "uint32_t",
    highDateTime: "uint32_t",
  });
  const BY_HANDLE_FILE_INFORMATION = koffi.struct(
    "ChainlessChainEvolutionDirectoryInformation",
    {
      fileAttributes: "uint32_t",
      creationTime: FILETIME,
      lastAccessTime: FILETIME,
      lastWriteTime: FILETIME,
      volumeSerialNumber: "uint32_t",
      fileSizeHigh: "uint32_t",
      fileSizeLow: "uint32_t",
      numberOfLinks: "uint32_t",
      fileIndexHigh: "uint32_t",
      fileIndexLow: "uint32_t",
    },
  );
  windowsApi = Object.freeze({
    koffi,
    HANDLE,
    CreateFileW: kernel32.func(
      "ChainlessChainEvolutionDirectoryHandle __stdcall CreateFileW(str16 fileName, uint32_t desiredAccess, uint32_t shareMode, void *securityAttributes, uint32_t creationDisposition, uint32_t flagsAndAttributes, void *templateFile)",
    ),
    FlushFileBuffers: kernel32.func(
      "bool __stdcall FlushFileBuffers(ChainlessChainEvolutionDirectoryHandle handle)",
    ),
    GetDriveTypeW: kernel32.func(
      "uint32_t __stdcall GetDriveTypeW(str16 rootPathName)",
    ),
    GetFileInformationByHandle: kernel32.func(
      "bool __stdcall GetFileInformationByHandle(ChainlessChainEvolutionDirectoryHandle handle, _Out_ ChainlessChainEvolutionDirectoryInformation *information)",
    ),
    GetLastError: kernel32.func("uint32_t __stdcall GetLastError()"),
    GetVolumeInformationW: kernel32.func(
      "bool __stdcall GetVolumeInformationW(str16 rootPathName, _Out_ uint16_t *volumeName, uint32_t volumeNameSize, _Out_ uint32_t *volumeSerialNumber, _Out_ uint32_t *maximumComponentLength, _Out_ uint32_t *fileSystemFlags, _Out_ uint16_t *fileSystemName, uint32_t fileSystemNameSize)",
    ),
    GetVolumePathNameW: kernel32.func(
      "bool __stdcall GetVolumePathNameW(str16 fileName, _Out_ uint16_t *volumePathName, uint32_t bufferLength)",
    ),
    CloseHandle: kernel32.func(
      "bool __stdcall CloseHandle(ChainlessChainEvolutionDirectoryHandle handle)",
    ),
    BY_HANDLE_FILE_INFORMATION,
  });
  return windowsApi;
}

function win32Path(value) {
  let resolved = path.win32.resolve(value);
  if (resolved.startsWith("\\\\?\\")) return resolved;
  if (resolved.startsWith("\\\\")) {
    return `\\\\?\\UNC\\${resolved.slice(2)}`;
  }
  return `\\\\?\\${resolved}`;
}

function normalizedWindowsPath(value) {
  return path.win32
    .resolve(value)
    .replace(/^\\\\\?\\/u, "")
    .replace(/[\\/]+$/u, "")
    .replaceAll("/", "\\")
    .toLowerCase();
}

function readWideString(buffer) {
  return buffer.toString("utf16le").replace(/\u0000.*$/su, "");
}

function windowsError(api, code) {
  return new Error(
    `Windows local UI directory durability unavailable: ${api} failed (Win32 ${code})`,
  );
}

function requireWindowsSuccess(api, ok) {
  if (ok) return;
  const errorCode = api.GetLastError();
  throw windowsError("Windows directory operation", errorCode);
}

function pathIdentity(fsImpl, directory) {
  const resolvedPath = path.win32.resolve(directory);
  let realPath;
  let stat;
  try {
    realPath = path.win32.resolve(fsImpl.realpathSync(resolvedPath));
    stat = fsImpl.lstatSync(resolvedPath, { bigint: true });
  } catch (cause) {
    throw new Error(
      "Windows local UI durability path could not be safely resolved",
      { cause },
    );
  }
  if (
    normalizedWindowsPath(realPath) !== normalizedWindowsPath(resolvedPath) ||
    !stat.isDirectory() ||
    stat.isSymbolicLink()
  ) {
    throw new Error(
      "Windows local UI durability requires the same non-reparse directory path",
    );
  }
  return Object.freeze({ resolvedPath, stat });
}

function fileId(information) {
  return (
    (BigInt(information.fileIndexHigh) << 32n) |
    BigInt(information.fileIndexLow)
  );
}

function assertDirectoryHandleIdentity(api, handle, fsImpl, directory, expected) {
  const information = {};
  requireWindowsSuccess(
    api,
    api.GetFileInformationByHandle(handle, information),
  );
  const attributes = Number(information.fileAttributes);
  if (
    (attributes & DIRECTORY_ATTRIBUTE) === 0 ||
    (attributes & REPARSE_POINT_ATTRIBUTE) !== 0 ||
    BigInt(information.volumeSerialNumber) !== BigInt(expected.stat.dev) ||
    fileId(information) !== BigInt(expected.stat.ino)
  ) {
    throw new Error(
      "Windows local UI durability handle does not match the requested directory",
    );
  }
  const current = pathIdentity(fsImpl, directory);
  if (
    BigInt(current.stat.dev) !== BigInt(expected.stat.dev) ||
    BigInt(current.stat.ino) !== BigInt(expected.stat.ino)
  ) {
    throw new Error(
      "Windows local UI durability directory changed during flush",
    );
  }
  return information;
}

/** Flush one verified directory on a local NTFS volume using a write handle. */
export function flushWindowsLocalNtfsDirectory(
  directory,
  { fsImpl = fs } = {},
) {
  if (process.platform !== "win32") {
    throw new Error("Windows directory flush is only available on Windows");
  }
  const api = loadWindowsApi();
  const before = pathIdentity(fsImpl, directory);
  const volumePath = Buffer.alloc(520);
  requireWindowsSuccess(
    api,
    api.GetVolumePathNameW(before.resolvedPath, volumePath, 260),
  );
  const volumeRoot = readWideString(volumePath);
  const driveType = api.GetDriveTypeW(volumeRoot);
  const fileSystemName = Buffer.alloc(128);
  const volumeName = Buffer.alloc(512);
  const volumeSerialNumber = [0];
  const maximumComponentLength = [0];
  const fileSystemFlags = [0];
  requireWindowsSuccess(
    api,
    api.GetVolumeInformationW(
      volumeRoot,
      volumeName,
      256,
      volumeSerialNumber,
      maximumComponentLength,
      fileSystemFlags,
      fileSystemName,
      64,
    ),
  );
  if (
    driveType !== DRIVE_FIXED ||
    readWideString(fileSystemName).toLowerCase() !== "ntfs" ||
    BigInt(volumeSerialNumber[0]) !== BigInt(before.stat.dev)
  ) {
    throw new Error(
      "Windows local UI durable storage requires a local NTFS directory",
    );
  }

  const invalidHandle = BigInt.asUintN(
    api.koffi.sizeof("intptr_t") * 8,
    -1n,
  );
  const handle = api.CreateFileW(
    win32Path(before.resolvedPath),
    GENERIC_READ_WRITE,
    FILE_SHARE_ALL,
    null,
    OPEN_EXISTING,
    FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
    null,
  );
  if (api.koffi.address(handle) === invalidHandle) {
    const errorCode = api.GetLastError();
    throw windowsError("CreateFileW", errorCode);
  }

  let operationError = null;
  try {
    assertDirectoryHandleIdentity(
      api,
      handle,
      fsImpl,
      directory,
      before,
    );
    const flushed = api.FlushFileBuffers(handle);
    if (!flushed) {
      const errorCode = api.GetLastError();
      throw windowsError("FlushFileBuffers", errorCode);
    }
    assertDirectoryHandleIdentity(
      api,
      handle,
      fsImpl,
      directory,
      before,
    );
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    const closed = api.CloseHandle(handle);
    if (!closed && operationError === null) {
      const errorCode = api.GetLastError();
      throw windowsError("CloseHandle", errorCode);
    }
  }
  return "windows-directory-flush";
}

export function createLocalUiEvolutionFileSystem() {
  if (process.platform !== "win32") return fs;
  const localFs = Object.create(fs);
  Object.defineProperty(localFs, "syncDirectorySync", {
    enumerable: true,
    value: (directory) => flushWindowsLocalNtfsDirectory(directory),
  });
  localUiEvolutionFileSystems.add(localFs);
  return localFs;
}

export function isLocalUiEvolutionFileSystem(fsImpl) {
  return (
    fsImpl !== null &&
    (typeof fsImpl === "object" || typeof fsImpl === "function") &&
    localUiEvolutionFileSystems.has(fsImpl)
  );
}

export function ensureDirectoryTreeDurable(fsImpl, directory) {
  if (typeof fsImpl?.syncDirectorySync !== "function") {
    fsImpl.mkdirSync(directory, { recursive: true, mode: 0o700 });
    return;
  }
  const target = path.resolve(directory);
  const missing = [];
  let cursor = target;
  for (;;) {
    try {
      const stat = fsImpl.lstatSync(cursor);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error("Local UI state path contains a reparse point");
      }
      break;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      missing.push(cursor);
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        throw new Error("Local UI state path has no existing directory root");
      }
      cursor = parent;
    }
  }
  for (const candidate of missing.reverse()) {
    try {
      fsImpl.mkdirSync(candidate, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    const stat = fsImpl.lstatSync(candidate);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("Local UI state path changed during creation");
    }
    fsImpl.syncDirectorySync(path.dirname(candidate));
  }
}
