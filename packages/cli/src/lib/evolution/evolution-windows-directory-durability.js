import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

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
  // Koffi's named types share a process-wide registry even when this module
  // is loaded in separate realms. Keep each API's ABI declarations private;
  // filesystem brands and the API cache remain local to this module instance.
  const typeScope = randomUUID().replaceAll("-", "");
  const typeName = (name) => `${name}_${typeScope}`;
  const HANDLE = koffi.pointer(
    typeName("ChainlessChainEvolutionDirectoryHandle"),
    koffi.opaque(),
  );
  const FILETIME = koffi.struct(typeName("ChainlessChainEvolutionFileTime"), {
    lowDateTime: "uint32_t",
    highDateTime: "uint32_t",
  });
  const BY_HANDLE_FILE_INFORMATION = koffi.struct(
    typeName("ChainlessChainEvolutionDirectoryInformation"),
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
  const FILE_ID_128 = koffi.struct(
    typeName("ChainlessChainEvolutionFileId128"),
    {
      low: "uint64_t",
      high: "uint64_t",
    },
  );
  const FILE_ID_INFO = koffi.struct(
    typeName("ChainlessChainEvolutionFileIdInfo"),
    {
      volumeSerialNumber: "uint64_t",
      fileId: FILE_ID_128,
    },
  );
  const statFields = {
    fileId: "int64_t",
    creationTime: "int64_t",
    lastAccessTime: "int64_t",
    lastWriteTime: "int64_t",
    changeTime: "int64_t",
    allocationSize: "int64_t",
    endOfFile: "int64_t",
    fileAttributes: "uint32_t",
    reparseTag: "uint32_t",
    numberOfLinks: "uint32_t",
  };
  const FILE_STAT_INFORMATION = koffi.struct(
    typeName("ChainlessChainEvolutionFileStatInformation"),
    { ...statFields, effectiveAccess: "uint32_t" },
  );
  const FILE_STAT_BASIC_INFORMATION = koffi.struct(
    typeName("ChainlessChainEvolutionFileStatBasicInformation"),
    {
      ...statFields,
      deviceType: "uint32_t",
      deviceCharacteristics: "uint32_t",
      reserved: "uint32_t",
      // Windows' documented layout; libuv 1.49 placed these in reverse order.
      volumeSerialNumber: "uint64_t",
      fileId128: FILE_ID_128,
    },
  );
  const IO_STATUS_BLOCK = koffi.struct(
    typeName("ChainlessChainEvolutionIoStatus"),
    {
      status: "intptr_t",
      information: "uintptr_t",
    },
  );
  let GetFileInformationByName = null;
  try {
    const fileApi = koffi.load("api-ms-win-core-file-l2-1-4.dll");
    GetFileInformationByName = fileApi.func(
      `bool __stdcall GetFileInformationByName(str16 fileName, int informationClass, _Out_ ${typeName("ChainlessChainEvolutionFileStatBasicInformation")} *information, uint32_t size)`,
    );
  } catch {
    // Older Windows versions use libuv's handle-based stat path instead.
  }
  const ntdll = koffi.load("ntdll.dll");
  windowsApi = Object.freeze({
    koffi,
    HANDLE,
    CreateFileW: kernel32.func(
      `${typeName("ChainlessChainEvolutionDirectoryHandle")} __stdcall CreateFileW(str16 fileName, uint32_t desiredAccess, uint32_t shareMode, void *securityAttributes, uint32_t creationDisposition, uint32_t flagsAndAttributes, void *templateFile)`,
    ),
    FlushFileBuffers: kernel32.func(
      `bool __stdcall FlushFileBuffers(${typeName("ChainlessChainEvolutionDirectoryHandle")} handle)`,
    ),
    GetDriveTypeW: kernel32.func(
      "uint32_t __stdcall GetDriveTypeW(str16 rootPathName)",
    ),
    GetFileInformationByHandle: kernel32.func(
      `bool __stdcall GetFileInformationByHandle(${typeName("ChainlessChainEvolutionDirectoryHandle")} handle, _Out_ ${typeName("ChainlessChainEvolutionDirectoryInformation")} *information)`,
    ),
    GetFileInformationByHandleEx: kernel32.func(
      `bool __stdcall GetFileInformationByHandleEx(${typeName("ChainlessChainEvolutionDirectoryHandle")} handle, int informationClass, _Out_ ${typeName("ChainlessChainEvolutionFileIdInfo")} *information, uint32_t size)`,
    ),
    GetFileInformationByName,
    NtQueryInformationFile: ntdll.func(
      `int32_t __stdcall NtQueryInformationFile(${typeName("ChainlessChainEvolutionDirectoryHandle")} handle, _Out_ ${typeName("ChainlessChainEvolutionIoStatus")} *ioStatus, _Out_ ${typeName("ChainlessChainEvolutionFileStatInformation")} *information, uint32_t size, int informationClass)`,
    ),
    GetLastError: kernel32.func("uint32_t __stdcall GetLastError()"),
    GetVolumeInformationW: kernel32.func(
      "bool __stdcall GetVolumeInformationW(str16 rootPathName, _Out_ uint16_t *volumeName, uint32_t volumeNameSize, _Out_ uint32_t *volumeSerialNumber, _Out_ uint32_t *maximumComponentLength, _Out_ uint32_t *fileSystemFlags, _Out_ uint16_t *fileSystemName, uint32_t fileSystemNameSize)",
    ),
    GetVolumePathNameW: kernel32.func(
      "bool __stdcall GetVolumePathNameW(str16 fileName, _Out_ uint16_t *volumePathName, uint32_t bufferLength)",
    ),
    CloseHandle: kernel32.func(
      `bool __stdcall CloseHandle(${typeName("ChainlessChainEvolutionDirectoryHandle")} handle)`,
    ),
    BY_HANDLE_FILE_INFORMATION,
    FILE_ID_INFO,
    FILE_STAT_INFORMATION,
    FILE_STAT_BASIC_INFORMATION,
    IO_STATUS_BLOCK,
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

// These Win32 APIs expose a DWORD serial. Normalize serial representations
// only across those APIs, retaining full stat.dev for path-change checks.
// Node 22.12's fast-stat ABI defect needs a separate, handle-bound projection.
function windowsVolumeSerial(device) {
  return BigInt.asUintN(32, BigInt(device));
}

function matchesFastNodeDirectoryIdentity(api, handle, directory, expected) {
  if (!api.GetFileInformationByName) return false;
  const handleIdentity = {};
  requireWindowsSuccess(
    api,
    api.GetFileInformationByHandleEx(
      handle,
      18,
      handleIdentity,
      api.koffi.sizeof(api.FILE_ID_INFO),
    ),
  );
  const handleStat = {};
  const status = api.NtQueryInformationFile(
    handle,
    {},
    handleStat,
    api.koffi.sizeof(api.FILE_STAT_INFORMATION),
    68,
  );
  if (status < 0) {
    throw new Error("Windows local UI native directory identity unavailable");
  }
  const pathStat = {};
  requireWindowsSuccess(
    api,
    api.GetFileInformationByName(
      win32Path(directory),
      3,
      pathStat,
      api.koffi.sizeof(api.FILE_STAT_BASIC_INFORMATION),
    ),
  );
  const pathFileId = BigInt.asUintN(64, BigInt(pathStat.fileId));
  if (
    (Number(pathStat.fileAttributes) & DIRECTORY_ATTRIBUTE) === 0 ||
    (Number(pathStat.fileAttributes) & REPARSE_POINT_ATTRIBUTE) !== 0 ||
    BigInt(pathStat.volumeSerialNumber) !==
      BigInt(handleIdentity.volumeSerialNumber) ||
    BigInt(pathStat.fileId128.low) !== BigInt(handleIdentity.fileId.low) ||
    BigInt(pathStat.fileId128.high) !== BigInt(handleIdentity.fileId.high) ||
    pathFileId !== BigInt.asUintN(64, BigInt(handleStat.fileId))
  ) {
    throw new Error(
      "Windows local UI path identity does not match the directory handle",
    );
  }
  // Same projections as windows-sandbox.cs: pair dev and ino from one stat
  // implementation, only after binding the correctly laid-out path result to
  // this handle's complete volume/128-bit ID. Never treat dev === 0 as a bypass.
  return (
    pathFileId === BigInt(expected.stat.ino) &&
    (BigInt(expected.stat.dev) ===
      windowsVolumeSerial(pathStat.volumeSerialNumber) ||
      BigInt(expected.stat.dev) === BigInt(pathStat.fileId128.high))
  );
}

function assertDirectoryHandleIdentity(
  api,
  handle,
  fsImpl,
  directory,
  expected,
) {
  const information = {};
  requireWindowsSuccess(
    api,
    api.GetFileInformationByHandle(handle, information),
  );
  const attributes = Number(information.fileAttributes);
  if (
    (attributes & DIRECTORY_ATTRIBUTE) === 0 ||
    (attributes & REPARSE_POINT_ATTRIBUTE) !== 0 ||
    BigInt(information.volumeSerialNumber) !== expected.volumeSerialNumber
  ) {
    throw new Error(
      "Windows local UI durability handle does not match the requested directory",
    );
  }
  const expectedDevice = BigInt(expected.stat.dev);
  const matchingLegacyFileId =
    fileId(information) === BigInt(expected.stat.ino);
  let legacyIdentityMatches =
    matchingLegacyFileId &&
    BigInt(information.volumeSerialNumber) === expectedDevice;
  if (
    !legacyIdentityMatches &&
    matchingLegacyFileId &&
    expectedDevice > 0xffffffffn
  ) {
    const fullIdentity = {};
    requireWindowsSuccess(
      api,
      api.GetFileInformationByHandleEx(
        handle,
        18,
        fullIdentity,
        api.koffi.sizeof(api.FILE_ID_INFO),
      ),
    );
    legacyIdentityMatches =
      expectedDevice === BigInt(fullIdentity.volumeSerialNumber);
  }
  const fastIdentityMatches = matchesFastNodeDirectoryIdentity(
    api,
    handle,
    expected.resolvedPath,
    expected,
  );
  if (!legacyIdentityMatches && !fastIdentityMatches) {
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
  { fsImpl = fs, nativeApi = null } = {},
) {
  if (process.platform !== "win32") {
    throw new Error("Windows directory flush is only available on Windows");
  }
  const api =
    typeof nativeApi === "function"
      ? nativeApi(loadWindowsApi())
      : nativeApi || loadWindowsApi();
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
    readWideString(fileSystemName).toLowerCase() !== "ntfs"
  ) {
    throw new Error(
      "Windows local UI durable storage requires a local NTFS directory",
    );
  }
  const expected = {
    ...before,
    volumeSerialNumber: BigInt(volumeSerialNumber[0]),
  };

  const invalidHandle = BigInt.asUintN(api.koffi.sizeof("intptr_t") * 8, -1n);
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
    assertDirectoryHandleIdentity(api, handle, fsImpl, directory, expected);
    const flushed = api.FlushFileBuffers(handle);
    if (!flushed) {
      const errorCode = api.GetLastError();
      throw windowsError("FlushFileBuffers", errorCode);
    }
    assertDirectoryHandleIdentity(api, handle, fsImpl, directory, expected);
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

// Only the original adapter inherits every filesystem operation unchanged.
// A branded object with injected operations must keep its dependency boundary.
export function isUnmodifiedLocalUiEvolutionFileSystem(fsImpl) {
  return (
    isLocalUiEvolutionFileSystem(fsImpl) &&
    Object.getPrototypeOf(fsImpl) === fs &&
    Reflect.ownKeys(fsImpl).length === 1 &&
    Object.hasOwn(fsImpl, "syncDirectorySync")
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
