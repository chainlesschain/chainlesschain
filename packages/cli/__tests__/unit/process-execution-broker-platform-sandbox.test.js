import { EventEmitter, once } from "node:events";
import { spawnSync as nativeSpawnSync } from "node:child_process";
import * as fs from "node:fs";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { Script } from "node:vm";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  applySandbox,
  applyWindowsSandbox,
  consumeMacMcpCodeSnapshotPlanBinding,
  consumeWindowsMcpCodeSnapshotPlanBinding,
  MCP_STDIO_FD_ENTRY_BOOTSTRAP,
  MCP_STDIO_FD_ENTRY_BOOTSTRAP_SHA256,
  MCP_STDIO_MACOS_GATED_ENTRY_BOOTSTRAP_SHA256,
  MACOS_PKG_EXECPATH_MAGIC,
  macMcpTargetEnvironment,
  resetWindowsSandboxAdapterCache,
  SANDBOX_BOUNDARIES,
} from "../../src/lib/process-execution-broker/platform-sandbox.js";
import { MACOS_MCP_LAUNCHER_INPUTS } from "../../src/lib/process-execution-broker/macos-mcp-launcher-contract.js";
import {
  buildLinuxBwrapDescriptorScrubbedLaunch,
  linuxBwrapDescriptorScrubberPolicyBinding,
  parseLinuxBwrapDescriptorScrubbedLaunch,
} from "../../src/lib/process-execution-broker/linux-bwrap-descriptor-launch.js";
import { executionBroker } from "../../src/lib/process-execution-broker/index.js";
import { installWindowsSandboxAdapterTestRoot } from "../../test/helpers/windows-sandbox-adapter-temp-root.js";

const windowsSandboxSource = readFileSync(
  new URL(
    "../../src/lib/process-execution-broker/windows-sandbox.cs",
    import.meta.url,
  ),
  "utf8",
);
const platformSandboxSource = readFileSync(
  new URL(
    "../../src/lib/process-execution-broker/platform-sandbox.js",
    import.meta.url,
  ),
  "utf8",
);
const processExecutionBrokerSource = readFileSync(
  new URL("../../src/lib/process-execution-broker/index.js", import.meta.url),
  "utf8",
);

function createChild(pid = 4102) {
  const child = new EventEmitter();
  child.pid = pid;
  child.kill = vi.fn(() => true);
  return child;
}

function createWindowsAdapterHarness({
  helperSpawnSync = vi.fn(() => {
    throw new Error("Unexpected Windows native helper invocation");
  }),
  readFileSync: readFile = vi.fn(),
  preexistingPaths = [],
  preexistingDirectories = ["C:\\temp"],
} = {}) {
  const normalizeWindowsPath = (value) => path.win32.resolve(String(value));
  const files = new Set();
  const directories = new Set();
  const contents = new Map();
  const identities = new Map();
  const realpaths = new Map();
  let nextFileIdentity = 100;
  const addDirectoryWithAncestors = (value) => {
    const directory = normalizeWindowsPath(value);
    const volumeRoot = path.win32.parse(directory).root;
    let current = volumeRoot;
    directories.add(current);
    const relative = path.win32.relative(volumeRoot, directory);
    for (const segment of relative.split(path.win32.sep).filter(Boolean)) {
      current = path.win32.join(current, segment);
      directories.add(current);
    }
  };
  for (const directory of preexistingDirectories) {
    addDirectoryWithAncestors(directory);
  }
  for (const filePath of preexistingPaths) {
    addDirectoryWithAncestors(path.win32.dirname(String(filePath)));
  }
  const putFile = (value, content) => {
    const filePath = normalizeWindowsPath(value);
    const identity = nextFileIdentity;
    nextFileIdentity += 1;
    addDirectoryWithAncestors(path.win32.dirname(filePath));
    files.add(filePath);
    contents.set(filePath, Buffer.from(content));
    identities.set(filePath, identity);
  };
  for (const directory of directories) {
    identities.set(directory, nextFileIdentity++);
  }
  for (const filePath of preexistingPaths) {
    putFile(filePath, `preexisting:${filePath}`);
  }
  const missingPathError = (filePath) => {
    const error = new Error(`Path does not exist: ${filePath}`);
    error.code = "ENOENT";
    return error;
  };
  const statFile = (value) => {
    const filePath = normalizeWindowsPath(value);
    if (!files.has(filePath) && !directories.has(filePath)) {
      throw missingPathError(filePath);
    }
    const identity = BigInt(identities.get(filePath));
    const size = BigInt(contents.get(filePath)?.length || 0);
    const isFile = files.has(filePath);
    return {
      dev: 1n,
      ino: identity,
      size,
      mode: isFile ? 33_206n : 16_895n,
      birthtimeNs: identity * 1_000_000n,
      ctimeNs: identity * 1_000_000n,
      mtimeNs: identity * 1_000_000n,
      isFile: () => isFile,
      isDirectory: () => !isFile,
      isSymbolicLink: () => false,
    };
  };
  const nativeRealpath = vi.fn((value) => {
    const filePath = normalizeWindowsPath(value);
    return realpaths.get(filePath) || filePath;
  });
  const realpathSync = vi.fn(nativeRealpath);
  realpathSync.native = nativeRealpath;
  const fsRuntime = {
    existsSync: vi.fn((value) => {
      const filePath = normalizeWindowsPath(value);
      return (
        filePath.toLowerCase().endsWith("\\powershell.exe") ||
        files.has(filePath) ||
        directories.has(filePath)
      );
    }),
    readFileSync: vi.fn((value, encoding) => {
      const filePath = normalizeWindowsPath(value);
      if (files.has(filePath)) {
        const content = contents.get(filePath);
        return encoding ? content.toString(encoding) : Buffer.from(content);
      }
      return readFile(value, encoding);
    }),
    writeFileSync: vi.fn((value, _content, options) => {
      const filePath = normalizeWindowsPath(value);
      if (options?.flag === "wx" && files.has(filePath)) {
        const error = new Error(`Path already exists: ${filePath}`);
        error.code = "EEXIST";
        throw error;
      }
      putFile(filePath, _content);
    }),
    mkdirSync: vi.fn((value) => {
      const directory = normalizeWindowsPath(value);
      if (files.has(directory) || directories.has(directory)) {
        const error = new Error(`Path already exists: ${directory}`);
        error.code = "EEXIST";
        throw error;
      }
      directories.add(directory);
      identities.set(directory, nextFileIdentity++);
    }),
    unlinkSync: vi.fn((value) => {
      const filePath = normalizeWindowsPath(value);
      if (!files.delete(filePath)) {
        throw missingPathError(filePath);
      }
      contents.delete(filePath);
      identities.delete(filePath);
    }),
    rmdirSync: vi.fn((value) => {
      const directory = normalizeWindowsPath(value);
      const hasChildren = [...files, ...directories].some(
        (candidate) =>
          candidate !== directory &&
          path.win32.dirname(candidate) === directory,
      );
      if (hasChildren) {
        const error = new Error(`Directory is not empty: ${directory}`);
        error.code = "ENOTEMPTY";
        throw error;
      }
      if (!directories.delete(directory)) {
        throw missingPathError(directory);
      }
      identities.delete(directory);
    }),
    lstatSync: vi.fn(statFile),
    statSync: vi.fn(statFile),
    realpathSync,
  };
  const decodeInvocationPaths = (args) => {
    if (
      args?.length === 5 &&
      args[0] === "--adapter-path" &&
      args[2] === "--invocation-file"
    ) {
      return {
        assemblyPath: args[1],
        payloadPath: args[3],
        payloadDigest: args[4],
        loaderMode: "managed-executable",
      };
    }
    const encodedIndex = args?.indexOf("-EncodedCommand") ?? -1;
    if (encodedIndex < 0 || typeof args[encodedIndex + 1] !== "string") {
      throw new Error(`Missing encoded PowerShell helper command: ${args}`);
    }
    const bootstrap = Buffer.from(args[encodedIndex + 1], "base64").toString(
      "utf16le",
    );
    const encodedPath = (variable) => {
      const line = bootstrap
        .split(/\r?\n/)
        .find((candidate) => candidate.startsWith(`${variable}=`));
      const match = line?.match(/FromBase64String\('([^']+)'\)/);
      if (!match) {
        throw new Error(
          `Encoded PowerShell helper command omitted ${variable}`,
        );
      }
      return Buffer.from(match[1], "base64").toString("utf8");
    };
    return {
      assemblyPath: encodedPath("$ccAssemblyPath"),
      payloadPath: encodedPath("$ccPayloadPath"),
      bootstrap,
      loaderMode: "powershell-byte-assembly",
    };
  };
  const decodeHelperArgs = (args) => {
    const { payloadPath } = decodeInvocationPaths(args);
    const payloadLine = contents
      .get(payloadPath)
      ?.toString("utf8")
      .split(/\r?\n/)
      .join("\n");
    if (!payloadLine) {
      throw new Error(`PowerShell helper payload is missing: ${payloadPath}`);
    }
    const lines = payloadLine.split("\n");
    if (
      lines.shift() !== "CC_WINDOWS_SANDBOX_INVOCATION_V1" ||
      lines.pop() !== ""
    ) {
      throw new Error("PowerShell helper payload contract is invalid");
    }
    return lines.map((value) => Buffer.from(value, "base64").toString("utf8"));
  };
  const logicalCalls = [];
  const spawnSync = vi.fn((command, args, options) => {
    const invocationPaths = decodeInvocationPaths(args);
    const logicalArgs = decodeHelperArgs(args);
    logicalCalls.push({
      command,
      args: logicalArgs,
      options,
      invocationPaths,
    });
    if (logicalArgs[0] === "--probe-helper") {
      const loaderMode = invocationPaths.loaderMode;
      return {
        status: 0,
        stdout: JSON.stringify({
          ready: true,
          hostRuntime:
            loaderMode === "managed-executable"
              ? "managed-executable-v1"
              : "powershell-byte-assembly-v1",
        }),
        stderr: "",
      };
    }
    return helperSpawnSync(command, logicalArgs, options);
  });
  return {
    directories,
    files,
    fsRuntime,
    helperSpawnSync,
    decodeHelperArgs,
    decodeInvocationPaths,
    logicalCalls,
    getPathIdentity: (value) =>
      identities.get(normalizeWindowsPath(value)) ?? null,
    setPathIdentity: (value, identity) => {
      identities.set(normalizeWindowsPath(value), identity);
    },
    replacePathIdentity: (value) => {
      const filePath = normalizeWindowsPath(value);
      const previous = identities.get(filePath);
      identities.set(filePath, nextFileIdentity++);
      return previous;
    },
    redirectRealpath: (value, target) => {
      realpaths.set(normalizeWindowsPath(value), normalizeWindowsPath(target));
    },
    materializeExternalFile: (value) => {
      const filePath = normalizeWindowsPath(value);
      if (files.has(filePath)) return;
      const content = readFile(filePath, "utf8");
      if (content !== undefined) putFile(filePath, content);
    },
    replaceFile: putFile,
    spawnSync,
  };
}

function decodeWindowsLaunchSpec(harness, plan) {
  const helperArgs = harness.decodeHelperArgs(plan.args);
  if (helperArgs.length !== 1) {
    throw new Error(`Expected one Windows launch payload: ${helperArgs}`);
  }
  const launchSpec = JSON.parse(
    Buffer.from(helperArgs[0], "base64").toString("utf8"),
  );
  if (launchSpec.identityPath) {
    harness.materializeExternalFile(launchSpec.identityPath);
  }
  return launchSpec;
}

function createLinuxStaticElf64({
  elfClass = 2,
  dataEncoding = 1,
  elfType = 2,
  machine = 62,
  extraProgramType = null,
  includeGnuStack = true,
  gnuStackFlags = 0x6,
  loadFlags = 0x5,
  loadFileSize = null,
  loadMemorySize = null,
  entryAddress = 0x400040n,
  programHeaderOffset = 64,
} = {}) {
  const programHeaderCount =
    1 + (includeGnuStack ? 1 : 0) + (extraProgramType === null ? 0 : 1);
  const bytes = 64 + programHeaderCount * 56 + 16;
  const image = Buffer.alloc(bytes);
  image.set([0x7f, 0x45, 0x4c, 0x46], 0);
  image[4] = elfClass;
  image[5] = dataEncoding;
  image[6] = 1;
  image.writeUInt16LE(elfType, 16);
  image.writeUInt16LE(machine, 18);
  image.writeUInt32LE(1, 20);
  image.writeBigUInt64LE(entryAddress, 24);
  image.writeBigUInt64LE(BigInt(programHeaderOffset), 32);
  image.writeUInt16LE(64, 52);
  image.writeUInt16LE(56, 54);
  image.writeUInt16LE(programHeaderCount, 56);

  if (programHeaderOffset + 56 <= image.length) {
    image.writeUInt32LE(1, programHeaderOffset);
    image.writeUInt32LE(loadFlags, programHeaderOffset + 4);
    image.writeBigUInt64LE(0n, programHeaderOffset + 8);
    image.writeBigUInt64LE(0x400000n, programHeaderOffset + 16);
    image.writeBigUInt64LE(0x400000n, programHeaderOffset + 24);
    image.writeBigUInt64LE(
      BigInt(loadFileSize ?? image.length),
      programHeaderOffset + 32,
    );
    image.writeBigUInt64LE(
      BigInt(loadMemorySize ?? image.length),
      programHeaderOffset + 40,
    );
    image.writeBigUInt64LE(0x1000n, programHeaderOffset + 48);
  }
  let nextProgramHeader = 1;
  if (
    includeGnuStack &&
    programHeaderOffset + (nextProgramHeader + 1) * 56 <= image.length
  ) {
    const offset = programHeaderOffset + nextProgramHeader * 56;
    image.writeUInt32LE(0x6474e551, offset);
    image.writeUInt32LE(gnuStackFlags, offset + 4);
    nextProgramHeader += 1;
  }
  if (
    extraProgramType !== null &&
    programHeaderOffset + (nextProgramHeader + 1) * 56 <= image.length
  ) {
    image.writeUInt32LE(
      extraProgramType,
      programHeaderOffset + nextProgramHeader * 56,
    );
  }
  return image;
}

function createLinuxStaticPieElf64({
  elfType = 3,
  machine = 62,
  includeDynamic = true,
  dynamicSegmentCount = 1,
  includeInterp = false,
  interpreterPath = "/lib64/ld-linux-x86-64.so.2",
  dynamicNeeded = false,
  dynamicNeededNames = null,
  dynamicSoname = null,
  dynamicRunpath = false,
  dynamicFlags1 = 0x08000000n,
  dynamicTerminated = true,
  dynamicExecutable = false,
  dynamicFileSize = null,
  dynamicVirtualAddress = 0x1000n,
} = {}) {
  const neededNames = Array.isArray(dynamicNeededNames)
    ? dynamicNeededNames
    : [];
  const stringParts = [Buffer.from([0])];
  const neededOffsets = [];
  let stringBytes = 1;
  for (const name of neededNames) {
    neededOffsets.push(stringBytes);
    const encoded = Buffer.from(`${name}\0`, "ascii");
    stringParts.push(encoded);
    stringBytes += encoded.length;
  }
  let sonameOffset = null;
  if (dynamicSoname !== null) {
    sonameOffset = stringBytes;
    const encoded = Buffer.from(`${dynamicSoname}\0`, "ascii");
    stringParts.push(encoded);
    stringBytes += encoded.length;
  }
  const stringTable =
    neededNames.length > 0 || sonameOffset !== null
      ? Buffer.concat(stringParts)
      : Buffer.alloc(0);
  const dynamicEntries = [];
  if (dynamicNeeded) dynamicEntries.push([1n, 0n]);
  neededOffsets.forEach((offset) => {
    dynamicEntries.push([1n, BigInt(offset)]);
  });
  if (sonameOffset !== null) {
    dynamicEntries.push([14n, BigInt(sonameOffset)]);
  }
  if (neededNames.length > 0 || sonameOffset !== null) {
    dynamicEntries.push([5n, 0n], [10n, BigInt(stringTable.length)]);
  }
  if (dynamicRunpath) dynamicEntries.push([29n, 0n]);
  if (dynamicFlags1 !== null) {
    dynamicEntries.push([0x6ffffffbn, BigInt(dynamicFlags1)]);
  }
  if (dynamicTerminated) dynamicEntries.push([0n, 0n]);
  const dynamicTable = Buffer.alloc(dynamicEntries.length * 16);
  const dynamicOffset = 0x1000;
  const stringTableOffset = dynamicOffset + dynamicTable.length;
  const stringTableVirtualAddress = 0x1000n + BigInt(dynamicTable.length);
  dynamicEntries.forEach(([tag, value], index) => {
    dynamicTable.writeBigUInt64LE(tag, index * 16);
    dynamicTable.writeBigUInt64LE(
      tag === 5n ? stringTableVirtualAddress : value,
      index * 16 + 8,
    );
  });

  const interp = Buffer.from(`${interpreterPath}\0`, "utf8");
  const interpOffset = stringTableOffset + stringTable.length;
  const payloadBytes =
    dynamicTable.length +
    stringTable.length +
    (includeInterp ? interp.length : 0);
  const includeDataLoad = payloadBytes > 0;
  const programHeaderCount =
    1 +
    (includeDataLoad ? 1 : 0) +
    1 +
    (includeDynamic ? dynamicSegmentCount : 0) +
    (includeInterp ? 1 : 0);
  const image = Buffer.alloc(
    includeDataLoad ? dynamicOffset + payloadBytes : dynamicOffset,
  );
  image.set([0x7f, 0x45, 0x4c, 0x46], 0);
  image[4] = 2;
  image[5] = 1;
  image[6] = 1;
  image.writeUInt16LE(elfType, 16);
  image.writeUInt16LE(machine, 18);
  image.writeUInt32LE(1, 20);
  image.writeBigUInt64LE(0x200n, 24);
  image.writeBigUInt64LE(64n, 32);
  image.writeUInt16LE(64, 52);
  image.writeUInt16LE(56, 54);
  image.writeUInt16LE(programHeaderCount, 56);

  let programHeaderIndex = 0;
  const writeProgramHeader = ({
    type,
    flags,
    fileOffset = 0n,
    virtualAddress = fileOffset,
    fileSize = 0n,
    memorySize = fileSize,
    alignment = 1n,
  }) => {
    const offset = 64 + programHeaderIndex * 56;
    programHeaderIndex += 1;
    image.writeUInt32LE(type, offset);
    image.writeUInt32LE(flags, offset + 4);
    image.writeBigUInt64LE(fileOffset, offset + 8);
    image.writeBigUInt64LE(virtualAddress, offset + 16);
    image.writeBigUInt64LE(virtualAddress, offset + 24);
    image.writeBigUInt64LE(fileSize, offset + 32);
    image.writeBigUInt64LE(memorySize, offset + 40);
    image.writeBigUInt64LE(alignment, offset + 48);
  };

  writeProgramHeader({
    type: 1,
    flags: 0x5,
    fileSize: BigInt(dynamicOffset),
    memorySize: BigInt(dynamicOffset),
    alignment: 0x1000n,
  });
  if (includeDataLoad) {
    writeProgramHeader({
      type: 1,
      flags: 0x6,
      fileOffset: BigInt(dynamicOffset),
      virtualAddress: 0x1000n,
      fileSize: BigInt(payloadBytes),
      memorySize: BigInt(payloadBytes),
      alignment: 0x1000n,
    });
  }
  writeProgramHeader({ type: 0x6474e551, flags: 0x6 });
  if (includeDynamic) {
    for (let index = 0; index < dynamicSegmentCount; index += 1) {
      writeProgramHeader({
        type: 2,
        flags: dynamicExecutable ? 0x5 : 0x6,
        fileOffset: BigInt(dynamicOffset),
        virtualAddress: dynamicVirtualAddress,
        fileSize: BigInt(dynamicFileSize ?? dynamicTable.length),
        memorySize: BigInt(dynamicFileSize ?? dynamicTable.length),
        alignment: 8n,
      });
    }
  }
  if (includeInterp) {
    writeProgramHeader({
      type: 3,
      flags: 0x4,
      fileOffset: BigInt(interpOffset),
      virtualAddress: BigInt(interpOffset),
      fileSize: BigInt(interp.length),
      memorySize: BigInt(interp.length),
    });
  }
  dynamicTable.copy(image, dynamicOffset);
  stringTable.copy(image, stringTableOffset);
  if (includeInterp) interp.copy(image, interpOffset);
  return image;
}

function createLinuxDynamicElf64WithOverlappingLoaderView() {
  const original = createLinuxStaticPieElf64({
    includeInterp: true,
    interpreterPath: "/lib64/ld-linux.so.2",
    dynamicNeededNames: ["libc.so.6"],
  });
  const programHeaderOffset = Number(original.readBigUInt64LE(32));
  const programHeaderBytes = original.readUInt16LE(54);
  const programHeaderCount = original.readUInt16LE(56);
  const dataLoadOffset = programHeaderOffset + programHeaderBytes;
  const dataFileOffset = original.readBigUInt64LE(dataLoadOffset + 8);
  const dataVirtualAddress = original.readBigUInt64LE(dataLoadOffset + 16);
  const dataFileSize = original.readBigUInt64LE(dataLoadOffset + 32);
  const alternateFileOffset = 0x2000n;
  const image = Buffer.alloc(Number(alternateFileOffset + dataFileSize));
  original.copy(image);
  original
    .subarray(Number(dataFileOffset), Number(dataFileOffset + dataFileSize))
    .copy(image, Number(alternateFileOffset));

  // The file-offset view remains a benign DT_NEEDED table, while a Linux
  // loader that honors the later MAP_FIXED PT_LOAD would see DT_RUNPATH at
  // the same PT_DYNAMIC virtual address.
  image.writeBigUInt64LE(29n, Number(alternateFileOffset));
  const hostileLoadOffset =
    programHeaderOffset + programHeaderCount * programHeaderBytes;
  image.writeUInt16LE(programHeaderCount + 1, 56);
  image.writeUInt32LE(1, hostileLoadOffset);
  image.writeUInt32LE(0x6, hostileLoadOffset + 4);
  image.writeBigUInt64LE(alternateFileOffset, hostileLoadOffset + 8);
  image.writeBigUInt64LE(dataVirtualAddress, hostileLoadOffset + 16);
  image.writeBigUInt64LE(dataVirtualAddress, hostileLoadOffset + 24);
  image.writeBigUInt64LE(dataFileSize, hostileLoadOffset + 32);
  image.writeBigUInt64LE(dataFileSize, hostileLoadOffset + 40);
  image.writeBigUInt64LE(0x1000n, hostileLoadOffset + 48);
  return image;
}

function createLinuxElf64WithPageOnlyLoadOverlap() {
  const original = createLinuxStaticElf64({
    extraProgramType: 1,
    loadFileSize: 0x801,
    loadMemorySize: 0x801,
  });
  const image = Buffer.alloc(0x2000);
  original.copy(image);
  const programHeaderOffset = Number(image.readBigUInt64LE(32));
  const programHeaderBytes = image.readUInt16LE(54);
  const secondLoadOffset = programHeaderOffset + 2 * programHeaderBytes;
  image.writeUInt32LE(1, secondLoadOffset);
  image.writeUInt32LE(0x4, secondLoadOffset + 4);
  image.writeBigUInt64LE(0xff0n, secondLoadOffset + 8);
  image.writeBigUInt64LE(0x400ff0n, secondLoadOffset + 16);
  image.writeBigUInt64LE(0x400ff0n, secondLoadOffset + 24);
  image.writeBigUInt64LE(0x10n, secondLoadOffset + 32);
  image.writeBigUInt64LE(0x10n, secondLoadOffset + 40);
  image.writeBigUInt64LE(0x1000n, secondLoadOffset + 48);
  return image;
}

function createLinuxAuxv64(pageSize) {
  const auxv = Buffer.alloc(32);
  auxv.writeBigUInt64LE(6n, 0);
  auxv.writeBigUInt64LE(BigInt(pageSize), 8);
  return auxv;
}

function createLinuxStrongHarness({
  bwrapStatus = 0,
  bwrapStdout = "chainless-linux-bwrap-plugin-node-v1",
  bwrapHelp = "--file FD DEST\n--ro-bind-fd FD DEST\n--ro-bind-data FD DEST\n--perms MODE\n--disable-userns\n--assert-userns-disabled\n--seccomp FD\n",
  lddStdout = [
    "libc.so.6 => /lib/libc.so.6 (0x1)",
    "/lib64/ld-linux.so.2 (0x2)",
  ].join("\n"),
  includeBwrap = true,
  tamperSeccompFilter = false,
  tamperNodeSnapshot = false,
  tamperNodeSnapshotAfterProbe = false,
  tamperNodeSourceDuringSnapshotCopy = false,
  tamperNativeSnapshot = false,
  tamperNativeSnapshotAfterProbe = false,
  removeNativeEntryExecuteBeforeSnapshot = false,
  failNodeSnapshotTmpfileOpen = false,
  failNodeSnapshotReopen = false,
  failNodeSnapshotWriterClose = false,
  failNativeSnapshotReopen = false,
  entryRuntime = "node",
  nodeEntry = Buffer.from("require('../lib/value.cjs');\n"),
  nodeDependency = Buffer.from("module.exports = 42;\n"),
  nodeDependencyMode = 0o100644,
  additionalPluginFiles = [],
  failSnapshotReopenForContents = null,
  nativeEntry = createLinuxStaticElf64(),
  nativeEntryMode = 0o100755,
  runtimeLibc = createLinuxStaticPieElf64({ dynamicFlags1: null }),
  runtimeLoader = createLinuxStaticPieElf64({ dynamicFlags1: null }),
  additionalRuntimeFiles = [],
  bwrapDevice = 11,
  bwrapInode = null,
  linuxPageSize = 4096,
  contractKind = null,
  onPolicyProbeComplete = null,
} = {}) {
  const nativeStatic = entryRuntime !== "node";
  const entryPath = nativeStatic ? "/plugin/bin/tool" : "/plugin/bin/tool.js";
  const sandboxEntryPath = nativeStatic
    ? "/opt/chainless/plugin/bin/tool"
    : "/opt/chainless/plugin/bin/tool.js";
  const originalNodeEntry = Buffer.from(nodeEntry);
  const snapshotReopenFailureContents =
    failSnapshotReopenForContents === null
      ? null
      : Buffer.from(failSnapshotReopenForContents);
  const regularFileMode = (value) => {
    const mode = Number(value);
    return (mode & 0o170000) === 0 ? 0o100000 | mode : mode;
  };
  const directories = new Set([
    "/plugin",
    "/plugin/bin",
    "/plugin/lib",
    "/tmp",
  ]);
  const files = new Map([
    [
      entryPath,
      nativeStatic ? Buffer.from(nativeEntry) : Buffer.from(originalNodeEntry),
    ],
    ["/plugin/lib/value.cjs", Buffer.from(nodeDependency)],
    ["/runtime/node", Buffer.from("attested-node-runtime")],
    ["/usr/bin/bwrap", Buffer.from("bubblewrap")],
    ["/usr/bin/bash", Buffer.from("bash")],
    ["/usr/bin/ldd", Buffer.from("ldd")],
    ["/lib/libc.so.6", Buffer.from(runtimeLibc)],
    ["/lib64/ld-linux.so.2", Buffer.from(runtimeLoader)],
    ["/etc/ld.so.cache", Buffer.from("loader-cache")],
    ["/proc/self/auxv", createLinuxAuxv64(linuxPageSize)],
    [
      "/proc/self/mountinfo",
      Buffer.from("1 0 0:1 / / rw,relatime - ext4 /dev/root rw\n"),
    ],
  ]);
  const reportedFileSizes = new Map();
  const fileModes = new Map([
    ["/plugin/lib/value.cjs", regularFileMode(nodeDependencyMode)],
  ]);
  for (const runtimeFile of additionalRuntimeFiles) {
    const filePath = String(runtimeFile.path);
    files.set(filePath, Buffer.from(runtimeFile.contents));
    fileModes.set(
      filePath,
      regularFileMode(
        runtimeFile.mode === undefined ? 0o100755 : runtimeFile.mode,
      ),
    );
    let parent = path.posix.dirname(filePath);
    while (parent !== "/" && parent !== ".") {
      directories.add(parent);
      parent = path.posix.dirname(parent);
    }
  }
  for (const pluginFile of additionalPluginFiles) {
    const filePath = String(pluginFile.path);
    files.set(filePath, Buffer.from(pluginFile.contents));
    fileModes.set(filePath, regularFileMode(pluginFile.mode));
    if (pluginFile.reportedSize !== undefined) {
      reportedFileSizes.set(filePath, Number(pluginFile.reportedSize));
    }
    let parent = path.posix.dirname(filePath);
    while (parent !== "/" && parent !== ".") {
      directories.add(parent);
      if (parent === "/plugin") break;
      parent = path.posix.dirname(parent);
    }
  }
  if (!includeBwrap) files.delete("/usr/bin/bwrap");
  const identities = new Map();
  const openFiles = new Map();
  const openFlags = new Map();
  const detachedContents = new Map();
  const detachedStats = new Map();
  const anonymousFiles = new Set();
  const anonymousSnapshotSources = new Map();
  const fileMtimes = new Map();
  const fdOffsets = new Map();
  const mountIds = new Map();
  const bwrapInvocations = [];
  const bwrapSupervisorReads = [];
  const bwrapDataReads = [];
  const lddInspectionSources = [];
  const tamperedAnonymousFiles = new Set();
  const nodeSnapshotWriterCloseErrors = [];
  let nextIno = 700;
  let nextFd = 40;
  let nextTempDirectory = 1;
  let bwrapInvocationCount = 0;
  let nodeSnapshotTmpfileOpenFailed = false;
  let nodeSnapshotSourceTampered = false;
  let nodeSnapshotWriterCloseFailed = false;
  let lastPluginSnapshotReadSource = null;
  let nativeEntryFullHashReads = 0;
  let nativeEntryExecuteRemovalArmed = false;
  let nativeEntryExecuteRemoved = false;
  for (const value of [...directories, ...files.keys()]) {
    identities.set(value, nextIno++);
  }
  if (bwrapInode !== null && files.has("/usr/bin/bwrap")) {
    identities.set("/usr/bin/bwrap", bwrapInode);
  }
  const missing = (value) => {
    const error = new Error(`missing ${value}`);
    error.code = "ENOENT";
    return error;
  };
  const resolveFdPath = (value) => {
    const filePath = String(value);
    const match = filePath.match(/^\/proc\/self\/fd\/(\d+)(?:\/(.*))?$/);
    if (!match) return filePath;
    const base = openFiles.get(Number(match[1]));
    if (!base) throw missing(filePath);
    return match[2] ? path.posix.join(base, match[2]) : base;
  };
  const statFor = (value, options = {}) => {
    const filePath = resolveFdPath(value);
    if (!directories.has(filePath) && !files.has(filePath)) {
      throw missing(filePath);
    }
    const isDirectory = directories.has(filePath);
    const contents = files.get(filePath);
    const statValue = (raw) =>
      options?.bigint === true ? BigInt(raw) : Number(raw);
    return {
      dev: statValue(filePath === "/usr/bin/bwrap" ? bwrapDevice : 11),
      ino: statValue(identities.get(filePath)),
      size: statValue(reportedFileSizes.get(filePath) ?? contents?.length ?? 0),
      mtimeMs: statValue(fileMtimes.get(filePath) ?? 1234),
      ctimeMs: statValue(fileMtimes.get(filePath) ?? 1234),
      nlink: statValue(anonymousFiles.has(filePath) ? 0 : 1),
      mode: statValue(
        fileModes.get(filePath) ??
          (isDirectory
            ? 0o040755
            : filePath === entryPath && !nativeStatic
              ? 0o100644
              : filePath === entryPath
                ? nativeEntryMode
                : 0o100755),
      ),
      uid: statValue(0),
      gid: statValue(0),
      isFile: () => !isDirectory,
      isDirectory: () => isDirectory,
      isSymbolicLink: () => false,
      isSocket: () => false,
      isFIFO: () => false,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
    };
  };
  const fsRuntime = {
    constants: {
      O_RDONLY: 0,
      O_WRONLY: 0x1,
      O_RDWR: 0x2,
      O_ACCMODE: 0x3,
      O_CREAT: 0x40,
      O_EXCL: 0x80,
      O_TMPFILE: 0x410000,
      O_NONBLOCK: 0x800,
      O_DIRECTORY: 0x10000,
      O_NOFOLLOW: 0x20000,
    },
    existsSync: vi.fn((value) => {
      const filePath = resolveFdPath(value);
      return directories.has(filePath) || files.has(filePath);
    }),
    realpathSync: Object.assign(
      vi.fn((value) => {
        const filePath = resolveFdPath(value);
        if (!directories.has(filePath) && !files.has(filePath)) {
          throw missing(filePath);
        }
        return filePath;
      }),
      {
        native: vi.fn((value) => {
          const filePath = resolveFdPath(value);
          if (!directories.has(filePath) && !files.has(filePath)) {
            throw missing(filePath);
          }
          return filePath;
        }),
      },
    ),
    lstatSync: vi.fn(statFor),
    statSync: vi.fn(statFor),
    readFileSync: vi.fn((value) => {
      const fdInfo = String(value).match(/^\/proc\/self\/fdinfo\/(\d+)$/);
      if (fdInfo) {
        const openPath = openFiles.get(Number(fdInfo[1]));
        if (!openPath) throw missing(String(value));
        return Buffer.from(
          `pos:\t0\nflags:\t0100000\nmnt_id:\t${
            mountIds.get(openPath) || 77
          }\n`,
        );
      }
      const filePath =
        typeof value === "number" ? openFiles.get(value) : resolveFdPath(value);
      if (!files.has(filePath)) throw missing(filePath);
      return Buffer.from(files.get(filePath));
    }),
    readSync: vi.fn((fd, buffer, offset, length, position) => {
      const filePath = openFiles.get(fd);
      const contents = detachedContents.get(fd) || files.get(filePath);
      if (!filePath || !contents) throw missing(`fd:${fd}`);
      if (filePath.startsWith("/plugin/")) {
        lastPluginSnapshotReadSource = filePath;
      }
      const available = Math.max(
        0,
        Math.min(length, contents.length - position),
      );
      if (available > 0) {
        contents.copy(buffer, offset, position, position + available);
      }
      if (
        removeNativeEntryExecuteBeforeSnapshot &&
        nativeStatic &&
        !nativeEntryExecuteRemoved &&
        filePath === entryPath &&
        position === 0 &&
        length === contents.length
      ) {
        nativeEntryFullHashReads += 1;
        if (nativeEntryFullHashReads === 3) {
          nativeEntryExecuteRemovalArmed = true;
        }
      }
      if (
        tamperNodeSourceDuringSnapshotCopy &&
        !nativeStatic &&
        !nodeSnapshotSourceTampered &&
        filePath === entryPath &&
        anonymousFiles.size > 0
      ) {
        const changed = Buffer.from(files.get(entryPath));
        changed[changed.length - 1] ^= 0x1;
        files.set(entryPath, changed);
        fileMtimes.set(
          entryPath,
          Number(fileMtimes.get(entryPath) ?? 1234) + 1,
        );
        nodeSnapshotSourceTampered = true;
      }
      return available;
    }),
    readdirSync: vi.fn((value) => {
      const directory = resolveFdPath(value);
      if (!directories.has(directory)) throw missing(directory);
      const children = new Set();
      for (const candidate of [...directories, ...files.keys()]) {
        if (candidate === directory) continue;
        if (path.posix.dirname(candidate) === directory) {
          children.add(path.posix.basename(candidate));
        }
      }
      return [...children].map((name) => ({ name }));
    }),
    mkdtempSync: vi.fn((prefix) => {
      const directory = `${prefix}${nextTempDirectory++}`;
      directories.add(directory);
      identities.set(directory, nextIno++);
      return directory;
    }),
    openSync: vi.fn((value, flags = 0, mode = 0o666) => {
      const requestedPath = String(value);
      const reopenedFd = Number(
        requestedPath.match(/^\/proc\/self\/fd\/(\d+)$/)?.[1],
      );
      let filePath = resolveFdPath(value);
      const anonymous =
        (Number(flags) & fsRuntime.constants.O_TMPFILE) ===
        fsRuntime.constants.O_TMPFILE;
      if (anonymous) {
        if (
          failNodeSnapshotTmpfileOpen &&
          !nativeStatic &&
          !nodeSnapshotTmpfileOpenFailed
        ) {
          nodeSnapshotTmpfileOpenFailed = true;
          throw new Error("node snapshot O_TMPFILE open denied");
        }
        if (!directories.has(filePath)) throw missing(filePath);
        filePath = `anonymous-inode-${nextIno}`;
        files.set(filePath, Buffer.alloc(0));
        fileModes.set(filePath, 0o100000 | (Number(mode) & 0o777));
        fileMtimes.set(filePath, 10_000 + nextIno);
        identities.set(filePath, nextIno++);
        anonymousFiles.add(filePath);
      }
      if (
        failNativeSnapshotReopen &&
        requestedPath.startsWith("/proc/self/fd/") &&
        anonymousFiles.has(filePath) &&
        files.get(filePath)?.subarray(0, 4).equals(Buffer.from("\x7fELF"))
      ) {
        throw new Error("snapshot reader reopen denied");
      }
      if (
        failNodeSnapshotReopen &&
        requestedPath.startsWith("/proc/self/fd/") &&
        anonymousFiles.has(filePath) &&
        files.get(filePath)?.equals(originalNodeEntry)
      ) {
        throw new Error("node snapshot reader reopen denied");
      }
      if (
        snapshotReopenFailureContents &&
        requestedPath.startsWith("/proc/self/fd/") &&
        anonymousFiles.has(filePath) &&
        files.get(filePath)?.equals(snapshotReopenFailureContents)
      ) {
        throw new Error("node_plugin_tree_snapshot_reader_reopen_denied");
      }
      const create = (Number(flags) & 0x40) !== 0;
      const exclusive = (Number(flags) & 0x80) !== 0;
      if (create && exclusive && files.has(filePath)) {
        const error = new Error(`exists ${filePath}`);
        error.code = "EEXIST";
        throw error;
      }
      if (create && !files.has(filePath) && !directories.has(filePath)) {
        files.set(filePath, Buffer.alloc(0));
        identities.set(filePath, nextIno++);
      }
      if (!files.has(filePath) && !directories.has(filePath)) {
        throw missing(filePath);
      }
      const fd = nextFd++;
      openFiles.set(fd, filePath);
      openFlags.set(fd, Number(flags));
      fdOffsets.set(fd, 0);
      if (anonymous) detachedContents.set(fd, Buffer.alloc(0));
      if (Number.isInteger(reopenedFd) && detachedStats.has(reopenedFd)) {
        detachedContents.set(fd, Buffer.from(detachedContents.get(reopenedFd)));
        detachedStats.set(fd, { ...detachedStats.get(reopenedFd) });
      }
      return fd;
    }),
    writeSync: vi.fn((fd, buffer, offset, length, position) => {
      const filePath = openFiles.get(fd);
      if (!filePath || !files.has(filePath)) throw missing(`fd:${fd}`);
      const previous = files.get(filePath);
      const required = position + length;
      const contents =
        previous.length >= required
          ? Buffer.from(previous)
          : Buffer.concat([previous, Buffer.alloc(required - previous.length)]);
      buffer.copy(contents, position, offset, offset + length);
      files.set(filePath, contents);
      if (detachedContents.has(fd)) {
        detachedContents.set(fd, Buffer.from(contents));
      }
      if (
        anonymousFiles.has(filePath) &&
        lastPluginSnapshotReadSource !== null
      ) {
        anonymousSnapshotSources.set(filePath, lastPluginSnapshotReadSource);
        lastPluginSnapshotReadSource = null;
      }
      return length;
    }),
    fchmodSync: vi.fn((fd, mode) => {
      const filePath = openFiles.get(fd);
      if (!filePath || !files.has(filePath)) throw missing(`fd:${fd}`);
      fileModes.set(filePath, 0o100000 | (Number(mode) & 0o777));
    }),
    fsyncSync: vi.fn((fd) => {
      const filePath = openFiles.get(fd);
      if (!filePath || !detachedContents.has(fd)) return;
      const contents = Buffer.from(files.get(filePath));
      const nativeSnapshot = contents
        .subarray(0, 4)
        .equals(Buffer.from("\x7fELF"));
      const nodeSnapshot = !nativeStatic && contents.equals(originalNodeEntry);
      const pluginTreeSnapshot = anonymousSnapshotSources.has(filePath);
      if (
        tamperedAnonymousFiles.has(filePath) ||
        (nativeSnapshot
          ? !tamperNativeSnapshot
          : nodeSnapshot
            ? !tamperNodeSnapshot
            : pluginTreeSnapshot
              ? true
              : !tamperSeccompFilter) ||
        contents.length === 0
      ) {
        return;
      }
      contents[contents.length - 1] ^= 0xff;
      files.set(filePath, contents);
      detachedContents.set(fd, Buffer.from(contents));
      tamperedAnonymousFiles.add(filePath);
    }),
    fstatSync: vi.fn((fd, options = {}) => {
      const filePath = openFiles.get(fd);
      if (!filePath) throw missing(`fd:${fd}`);
      const detached = detachedStats.get(fd);
      const result = !detached
        ? statFor(filePath, options)
        : options?.bigint !== true
          ? detached
          : {
              ...detached,
              dev: BigInt(detached.dev),
              ino: BigInt(detached.ino),
              size: BigInt(detached.size),
              mtimeMs: BigInt(detached.mtimeMs),
              ctimeMs: BigInt(detached.ctimeMs),
              nlink: BigInt(detached.nlink),
              mode: BigInt(detached.mode),
              uid: BigInt(detached.uid),
              gid: BigInt(detached.gid),
            };
      if (
        nativeEntryExecuteRemovalArmed &&
        !nativeEntryExecuteRemoved &&
        filePath === entryPath
      ) {
        nativeEntryExecuteRemovalArmed = false;
        fileModes.set(entryPath, regularFileMode(nativeEntryMode) & ~0o111);
        nativeEntryExecuteRemoved = true;
      }
      return result;
    }),
    closeSync: vi.fn((fd) => {
      const filePath = openFiles.get(fd);
      const failAfterClose =
        failNodeSnapshotWriterClose &&
        !nativeStatic &&
        !nodeSnapshotWriterCloseFailed &&
        anonymousFiles.has(filePath) &&
        files.get(filePath)?.equals(originalNodeEntry) &&
        (Number(openFlags.get(fd)) & fsRuntime.constants.O_ACCMODE) ===
          fsRuntime.constants.O_RDWR;
      if (failAfterClose) {
        nodeSnapshotWriterCloseFailed = true;
      }
      if (!openFiles.delete(fd)) throw missing(`fd:${fd}`);
      openFlags.delete(fd);
      detachedContents.delete(fd);
      detachedStats.delete(fd);
      fdOffsets.delete(fd);
      const hasOpenReference = [...openFiles.values()].some(
        (openPath) => openPath === filePath,
      );
      if (anonymousFiles.has(filePath) && !hasOpenReference) {
        anonymousFiles.delete(filePath);
        files.delete(filePath);
        fileModes.delete(filePath);
        fileMtimes.delete(filePath);
        identities.delete(filePath);
        tamperedAnonymousFiles.delete(filePath);
        anonymousSnapshotSources.delete(filePath);
      }
      if (failAfterClose) {
        nodeSnapshotWriterCloseErrors.push(fd);
        throw new Error("node snapshot writer close result unavailable");
      }
    }),
    unlinkSync: vi.fn((value) => {
      const filePath = String(value);
      const contents = files.get(filePath);
      const detachedStat =
        contents === undefined ? null : { ...statFor(filePath), nlink: 0 };
      for (const [fd, openPath] of openFiles) {
        if (openPath === filePath && contents) {
          detachedContents.set(fd, Buffer.from(contents));
          detachedStats.set(fd, detachedStat);
        }
      }
      if (!files.delete(filePath)) throw missing(filePath);
      fileModes.delete(filePath);
      fileMtimes.delete(filePath);
      identities.delete(filePath);
    }),
    rmdirSync: vi.fn((value) => {
      const directory = String(value);
      if (!directories.delete(directory)) throw missing(directory);
      identities.delete(directory);
      fileModes.delete(directory);
      fileMtimes.delete(directory);
    }),
  };
  const sha256 = (contents) =>
    crypto.createHash("sha256").update(contents).digest("hex");
  const originalBwrapSha256 = sha256(
    files.get("/usr/bin/bwrap") || Buffer.alloc(0),
  );
  const replaceFileAtPath = (filePath, replacement) => {
    if (!files.has(filePath)) throw missing(filePath);
    const before = statFor(filePath);
    const contents = Buffer.from(files.get(filePath));
    for (const [fd, openPath] of openFiles) {
      if (openPath !== filePath) continue;
      if (!detachedContents.has(fd)) {
        detachedContents.set(fd, Buffer.from(contents));
      }
      if (!detachedStats.has(fd)) {
        // Model a mount/path replacement: already-open descriptions keep the
        // original inode while rename-over drops its link count and changes
        // ctime. Fresh path resolution sees the replacement object.
        detachedStats.set(fd, {
          ...before,
          nlink: 0,
          ctimeMs: Number(before.ctimeMs) + 1,
        });
      }
    }
    files.set(filePath, Buffer.from(replacement));
    identities.set(filePath, nextIno++);
    fileMtimes.set(filePath, Number(before.mtimeMs) + 1);
    reportedFileSizes.delete(filePath);
    return {
      before,
      after: statFor(filePath),
      beforeSha256: sha256(contents),
      afterSha256: sha256(files.get(filePath)),
    };
  };
  const rewriteFileInPlace = (filePath, replacement) => {
    if (!files.has(filePath)) throw missing(filePath);
    const before = statFor(filePath);
    const beforeSha256 = sha256(files.get(filePath));
    files.set(filePath, Buffer.from(replacement));
    fileMtimes.set(filePath, Number(before.mtimeMs) + 1);
    reportedFileSizes.delete(filePath);
    return {
      before,
      after: statFor(filePath),
      beforeSha256,
      afterSha256: sha256(files.get(filePath)),
    };
  };
  const isBwrapCommand = (command) =>
    command === "/usr/bin/bwrap" ||
    /^\/proc\/self\/fd\/\d+$/.test(String(command));
  const spawnSync = vi.fn((command, args, options) => {
    if (command === "/usr/bin/ldd") {
      const inspectionChildFd = Number(
        String(args?.[0] || "").match(/^\/proc\/self\/fd\/(\d+)$/)?.[1],
      );
      const inspectionParentFd = options?.stdio?.[inspectionChildFd];
      lddInspectionSources.push(openFiles.get(inspectionParentFd) || null);
      return {
        status: 0,
        stdout: lddStdout,
        stderr: "",
      };
    }
    const scrubbed = parseLinuxBwrapDescriptorScrubbedLaunch(
      command,
      args,
      options,
    );
    const logicalCommand = scrubbed
      ? `/proc/self/fd/${scrubbed.executableChildFd}`
      : command;
    const logicalArgs = scrubbed ? scrubbed.executableArgs : args;
    if (isBwrapCommand(logicalCommand)) {
      const descriptorChildFd = Number(
        String(logicalCommand).match(/^\/proc\/self\/fd\/(\d+)$/)?.[1],
      );
      const descriptorBacked = Number.isInteger(descriptorChildFd);
      const supervisorParentFd = descriptorBacked
        ? options?.stdio?.[descriptorChildFd]
        : null;
      const supervisorSourcePath = descriptorBacked
        ? openFiles.get(supervisorParentFd)
        : "/usr/bin/bwrap";
      const supervisorContents = descriptorBacked
        ? detachedContents.get(supervisorParentFd) ||
          files.get(supervisorSourcePath)
        : files.get("/usr/bin/bwrap");
      const supervisorStat =
        descriptorBacked && Number.isInteger(supervisorParentFd)
          ? detachedStats.get(supervisorParentFd) ||
            statFor(supervisorSourcePath, { bigint: true })
          : statFor("/usr/bin/bwrap", { bigint: true });
      const invocation = {
        command: logicalCommand,
        args: [...(logicalArgs || [])],
        scrubbed,
        descriptorBacked,
        childFd: descriptorBacked ? descriptorChildFd : null,
        parentFd: supervisorParentFd,
        sourcePath: supervisorSourcePath,
        sourceFileId: {
          dev: String(supervisorStat.dev),
          ino: String(supervisorStat.ino),
        },
        sourceSha256: supervisorContents ? sha256(supervisorContents) : null,
        sourceBytes: supervisorContents?.length ?? null,
        sourceNlink: Number(supervisorStat.nlink),
        sourceCtimeMs: Number(supervisorStat.ctimeMs),
        offsetBefore: descriptorBacked
          ? fdOffsets.get(supervisorParentFd)
          : null,
        stage:
          logicalArgs?.[0] === "--help"
            ? "capability"
            : bwrapInvocationCount === 0
              ? "probe"
              : "final",
      };
      bwrapInvocations.push(invocation);
      if (logicalArgs?.[0] === "--help") {
        return {
          status: 0,
          stdout: bwrapHelp,
          stderr: "",
        };
      }
      bwrapInvocationCount += 1;
      if (descriptorBacked) {
        const supervisorFileIndex = logicalArgs.findIndex(
          (value, index) =>
            value === "--file" &&
            Number(logicalArgs[index + 1]) === descriptorChildFd &&
            logicalArgs[index + 2] === "/run/.chainless-bwrap-supervisor",
        );
        const runTmpfsIndex = logicalArgs.findIndex(
          (value, index) =>
            index > supervisorFileIndex &&
            value === "--tmpfs" &&
            logicalArgs[index + 1] === "/run",
        );
        const accessMode =
          Number(openFlags.get(supervisorParentFd)) &
          fsRuntime.constants.O_ACCMODE;
        const offsetBefore = fdOffsets.get(supervisorParentFd);
        const bytesRead =
          supervisorContents && Number.isInteger(offsetBefore)
            ? Math.max(0, supervisorContents.length - offsetBefore)
            : 0;
        const supervisorRead = {
          stage: invocation.stage,
          childFd: descriptorChildFd,
          parentFd: supervisorParentFd,
          sourcePath: supervisorSourcePath,
          sourceFileId: invocation.sourceFileId,
          sourceSha256:
            supervisorContents && Number.isInteger(offsetBefore)
              ? sha256(supervisorContents.subarray(offsetBefore))
              : null,
          offsetBefore,
          bytesRead,
          flags: openFlags.get(supervisorParentFd),
          permissions:
            supervisorFileIndex >= 2 &&
            logicalArgs[supervisorFileIndex - 2] === "--perms"
              ? logicalArgs[supervisorFileIndex - 1]
              : null,
          destination:
            supervisorFileIndex >= 0
              ? logicalArgs[supervisorFileIndex + 2]
              : null,
          fileIndex: supervisorFileIndex,
          runTmpfsIndex,
        };
        bwrapSupervisorReads.push(supervisorRead);
        if (
          supervisorSourcePath !== "/usr/bin/bwrap" ||
          !supervisorContents ||
          accessMode !== fsRuntime.constants.O_RDONLY ||
          offsetBefore !== 0 ||
          bytesRead <= 0 ||
          supervisorFileIndex < 2 ||
          supervisorRead.permissions !== "0000" ||
          runTmpfsIndex <= supervisorFileIndex
        ) {
          return {
            status: 1,
            stdout: "",
            stderr: "invalid bwrap supervisor descriptor",
          };
        }
        // bubblewrap SETUP_MAKE_FILE reads from the descriptor's current
        // offset through EOF and closes the child copy. The independently
        // reopened parent OFD records the consumed offset for this invocation.
        fdOffsets.set(supervisorParentFd, supervisorContents.length);
      }
      for (let index = 0; index < logicalArgs.length; index += 1) {
        if (logicalArgs[index] !== "--ro-bind-data") continue;
        const childFd = Number(logicalArgs[index + 1]);
        const destination = logicalArgs[index + 2];
        const parentFd = options?.stdio?.[childFd];
        const sourcePath = openFiles.get(parentFd);
        const contents =
          detachedContents.get(parentFd) || files.get(sourcePath);
        const accessMode =
          Number(openFlags.get(parentFd)) & fsRuntime.constants.O_ACCMODE;
        const offsetBefore = fdOffsets.get(parentFd);
        const bytesRead =
          contents && Number.isInteger(offsetBefore)
            ? Math.max(0, contents.length - offsetBefore)
            : 0;
        bwrapDataReads.push({
          stage: invocation.stage,
          childFd,
          parentFd,
          destination,
          sourcePath,
          offsetBefore,
          bytesRead,
          flags: openFlags.get(parentFd),
          permissions:
            logicalArgs[index - 2] === "--perms"
              ? logicalArgs[index - 1]
              : null,
          sha256:
            contents && Number.isInteger(offsetBefore)
              ? crypto
                  .createHash("sha256")
                  .update(contents.subarray(offsetBefore))
                  .digest("hex")
              : null,
        });
        if (
          !sourcePath ||
          !contents ||
          accessMode !== fsRuntime.constants.O_RDONLY ||
          offsetBefore !== 0
        ) {
          return {
            status: 1,
            stdout: "",
            stderr: "invalid ro-bind-data descriptor",
          };
        }
        fdOffsets.set(parentFd, contents.length);
      }
      const seccompIndex = logicalArgs.indexOf("--seccomp");
      const seccompChildFd = Number(logicalArgs[seccompIndex + 1]);
      const seccompParentFd = options?.stdio?.[seccompChildFd];
      const seccompContents = detachedContents.get(seccompParentFd);
      const seccompOffset = fdOffsets.get(seccompParentFd);
      if (
        seccompIndex < 0 ||
        !seccompContents ||
        seccompOffset !== 0 ||
        seccompContents.length === 0 ||
        seccompContents.length % 8 !== 0
      ) {
        return {
          status: 1,
          stdout: "",
          stderr: "invalid seccomp filter descriptor",
        };
      }
      fdOffsets.set(seccompParentFd, seccompContents.length);
      if (
        (tamperNativeSnapshotAfterProbe || tamperNodeSnapshotAfterProbe) &&
        bwrapInvocationCount === 1
      ) {
        const snapshotRead = bwrapDataReads.find(
          (read) => read.destination === sandboxEntryPath && read.sourcePath,
        );
        const snapshotContents = snapshotRead
          ? Buffer.from(files.get(snapshotRead.sourcePath))
          : null;
        if (snapshotContents?.length > 0) {
          snapshotContents[snapshotContents.length - 1] ^= 0xff;
          files.set(snapshotRead.sourcePath, snapshotContents);
        }
      }
      if (bwrapInvocationCount === 1) {
        onPolicyProbeComplete?.();
      }
      const runtimePathnameClosureProbe = logicalArgs.some((value) =>
        String(value).includes(
          "chainless-linux-bwrap-native-runtime-pathname-closure-v1",
        ),
      );
      return {
        status: bwrapStatus,
        stdout: runtimePathnameClosureProbe
          ? "chainless-linux-bwrap-native-runtime-pathname-closure-v1"
          : bwrapStdout,
        stderr: "",
      };
    }
    throw new Error(`unexpected command ${command}`);
  });
  const identityFor = (filePath) => {
    const stat = statFor(filePath);
    return Object.freeze({
      contractVersion: 1,
      realPath: filePath,
      sha256: crypto
        .createHash("sha256")
        .update(files.get(filePath))
        .digest("hex"),
      bytes: stat.size,
      fileId: Object.freeze({
        dev: String(stat.dev),
        ino: String(stat.ino),
      }),
      mtimeMs: stat.mtimeMs,
      attestation: "realpath-file-id-sha256",
    });
  };
  const contract = Object.freeze({
    contractVersion: 1,
    kind:
      contractKind ||
      (nativeStatic
        ? entryRuntime === "native-dynamic-elf"
          ? "strict-plugin-native-elf-bin"
          : "strict-plugin-native-static-elf-bin"
        : "strict-plugin-node-bin"),
    pluginRoot: "/plugin",
    workingDirectory: "/plugin",
    runtimePath: "/runtime/node",
    rootIdentity: Object.freeze({
      realPath: "/plugin",
      fileId: Object.freeze({
        dev: String(statFor("/plugin").dev),
        ino: String(statFor("/plugin").ino),
      }),
      attestation: "realpath-directory-file-id",
    }),
    entryIdentity: identityFor(entryPath),
    runtimeIdentity: identityFor("/runtime/node"),
  });
  return {
    contract,
    anonymousFiles,
    bwrapDataReads,
    bwrapInvocations,
    bwrapSupervisorReads,
    detachedContents,
    detachedStats,
    directories,
    entryPath,
    fileModes,
    files,
    fsRuntime,
    identities,
    fdOffsets,
    lddInspectionSources,
    linuxPageSize,
    mountIds,
    get nativeEntryExecuteRemoved() {
      return nativeEntryExecuteRemoved;
    },
    get nativeEntryFullHashReads() {
      return nativeEntryFullHashReads;
    },
    nodeSnapshotWriterCloseErrors,
    openFiles,
    openFlags,
    originalBwrapSha256,
    reportedFileSizes,
    replaceFileAtPath,
    rewriteFileInPlace,
    isBwrapCommand,
    spawnSync,
    statFor,
  };
}

function applyLinuxStrongNativeHarness(
  harness,
  args = ["--label", "ready"],
  arch = "x64",
) {
  const requiredBoundaries = [
    SANDBOX_BOUNDARIES.FILESYSTEM,
    SANDBOX_BOUNDARIES.NETWORK,
  ];
  return applySandbox(
    harness.entryPath,
    args,
    {
      cwd: "/plugin",
      shell: false,
      env: {
        PATH: "/host/path",
        LD_LIBRARY_PATH: "/host/plugin-native-libs",
      },
    },
    {
      profile: "strict",
      requiredBoundaries,
    },
    {
      platform: "linux",
      arch,
      fs: harness.fsRuntime,
      homedir: () => "/home/tester",
      spawnSync: harness.spawnSync,
    },
    {
      profile: "strict",
      requiredBoundaries,
      sync: true,
      executionContract: harness.contract,
    },
  );
}

function applyLinuxStrongNodeHarness(harness, args = ["--label", "ready"]) {
  const requiredBoundaries = [
    SANDBOX_BOUNDARIES.FILESYSTEM,
    SANDBOX_BOUNDARIES.NETWORK,
  ];
  return applySandbox(
    "/runtime/node",
    [harness.entryPath, ...args],
    {
      cwd: "/plugin",
      shell: false,
    },
    {
      profile: "strict",
      requiredBoundaries,
    },
    {
      platform: "linux",
      arch: "x64",
      fs: harness.fsRuntime,
      homedir: () => "/home/tester",
      spawnSync: harness.spawnSync,
    },
    {
      profile: "strict",
      requiredBoundaries,
      sync: true,
      executionContract: harness.contract,
    },
  );
}

function applyLinuxMcpCapsuleHarness(harness, args = ["--label", "ready"]) {
  const requiredBoundaries = [SANDBOX_BOUNDARIES.CODE_SNAPSHOT];
  const contract = Object.freeze({
    ...harness.contract,
    kind: "strict-mcp-node-capsule",
  });
  return applySandbox(
    "/runtime/node",
    [harness.entryPath, ...args],
    {
      cwd: "/plugin",
      shell: false,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    },
    {
      profile: "default",
      requiredBoundaries,
    },
    {
      platform: "linux",
      arch: "x64",
      fs: harness.fsRuntime,
      homedir: () => "/home/tester",
      spawnSync: harness.spawnSync,
    },
    {
      profile: "default",
      requiredBoundaries,
      sync: false,
      executionContract: contract,
    },
  );
}

function expectLinuxBwrapSupervisorPolicy(args) {
  const fileIndex = args.findIndex(
    (value, index) =>
      value === "--file" &&
      args[index + 1] === "3" &&
      args[index + 2] === "/run/.chainless-bwrap-supervisor",
  );
  expect(fileIndex).toBeGreaterThanOrEqual(2);
  expect(args.slice(fileIndex - 2, fileIndex + 3)).toEqual([
    "--perms",
    "0000",
    "--file",
    "3",
    "/run/.chainless-bwrap-supervisor",
  ]);
  const runTmpfsIndex = args.findIndex(
    (value, index) =>
      index > fileIndex && value === "--tmpfs" && args[index + 1] === "/run",
  );
  expect(runTmpfsIndex).toBeGreaterThan(fileIndex);

  for (let index = 0; index < args.length; index += 1) {
    if (
      args[index] === "--ro-bind-fd" ||
      args[index] === "--ro-bind-data" ||
      args[index] === "--seccomp"
    ) {
      expect(Number(args[index + 1])).toBeGreaterThanOrEqual(4);
    }
  }
  return { fileIndex, runTmpfsIndex };
}

function linuxBwrapFileMounts(args) {
  const mounts = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--ro-bind-data") {
      mounts.push({
        mode: "ro-bind-data",
        childFd: Number(args[index + 1]),
        destination: args[index + 2],
        permissions: args[index - 2] === "--perms" ? args[index - 1] : null,
      });
    } else if (args[index] === "--ro-bind-fd") {
      mounts.push({
        mode: "ro-bind-fd",
        childFd: Number(args[index + 1]),
        destination: args[index + 2],
        permissions: null,
      });
    }
  }
  return mounts;
}

function expectLinuxBwrapSupervisorInvocations(harness, expectedStages) {
  expect(harness.bwrapInvocations.map(({ stage }) => stage)).toEqual(
    expectedStages,
  );
  expect(
    harness.bwrapInvocations.every(
      ({ command, descriptorBacked, childFd, sourcePath, sourceSha256 }) =>
        command === "/proc/self/fd/3" &&
        descriptorBacked === true &&
        childFd === 3 &&
        sourcePath === "/usr/bin/bwrap" &&
        sourceSha256 === harness.originalBwrapSha256,
    ),
  ).toBe(true);
  expect(
    harness.bwrapInvocations.every(
      ({ sourceNlink }) => sourceNlink === 0 || sourceNlink === 1,
    ),
  ).toBe(true);
  expect(
    new Set(harness.bwrapInvocations.map(({ parentFd }) => parentFd)).size,
  ).toBe(expectedStages.length);
  expect(
    new Set(
      harness.bwrapInvocations.map(
        ({ sourceFileId }) => `${sourceFileId.dev}:${sourceFileId.ino}`,
      ),
    ).size,
  ).toBe(1);
  expect(
    harness.bwrapInvocations.every(({ offsetBefore }) => offsetBefore === 0),
  ).toBe(true);

  expect(harness.bwrapSupervisorReads).toHaveLength(
    expectedStages.filter((stage) => stage !== "capability").length,
  );
  expect(
    harness.bwrapSupervisorReads.every(
      ({
        childFd,
        sourcePath,
        sourceSha256,
        offsetBefore,
        bytesRead,
        permissions,
        destination,
        fileIndex,
        runTmpfsIndex,
      }) =>
        childFd === 3 &&
        sourcePath === "/usr/bin/bwrap" &&
        sourceSha256 === harness.originalBwrapSha256 &&
        offsetBefore === 0 &&
        bytesRead > 0 &&
        permissions === "0000" &&
        destination === "/run/.chainless-bwrap-supervisor" &&
        fileIndex >= 2 &&
        runTmpfsIndex > fileIndex,
    ),
  ).toBe(true);
}

function createLinuxSupervisorExecutableIdentity(overrides = {}) {
  return {
    path: "/usr/bin/bwrap",
    fileId: {
      dev: "11",
      ino: "701",
    },
    sha256: "a".repeat(64),
    bytes: 10,
    mtimeMs: 1234,
    mode: 0o100755,
    uid: 0,
    gid: 0,
    ...overrides,
  };
}

function createLinuxDescriptorScrubberExecutableIdentity(overrides = {}) {
  return {
    path: "/usr/bin/bash",
    fileId: {
      dev: "11",
      ino: "702",
    },
    sha256: "9".repeat(64),
    bytes: 12,
    mtimeMs: 1234,
    mode: 0o100755,
    uid: 0,
    gid: 0,
    ...overrides,
  };
}

function createLinuxDescriptorScrubberRuntimeEvidence(
  layout = {
    scrubberChildFd: 4,
    preservedMaxFd: 3,
    activeStdioThrough: 2,
    nodeIpcChildFd: null,
    executableChildFd: 3,
  },
) {
  return linuxBwrapDescriptorScrubberPolicyBinding(
    createLinuxDescriptorScrubberExecutableIdentity(),
    layout,
  );
}

function expectedLinuxDescriptorRuntimeProbe(runtimeProbe) {
  return {
    ...Object.fromEntries(
      Object.entries(runtimeProbe).filter(([, value]) => value !== undefined),
    ),
    descriptorScrubber: createLinuxDescriptorScrubberRuntimeEvidence(),
  };
}

function createLinuxSupervisorRuntimeProbe(overrides = {}) {
  return {
    kind: "linux-bwrap-plugin-node-policy-v1",
    attempted: true,
    runnable: true,
    reason: null,
    probeRuntime: "node",
    targetRuntime: "node",
    runtimeDetachedChildSpawnVerified: true,
    contentSnapshot: false,
    handleAtomic: false,
    supervisorDescriptorBound: true,
    supervisorExecutablePinned: true,
    supervisorBindingScope: "host-path-replacement",
    supervisorDescriptorBindingMechanism:
      "pinned-child-fd3-file-consume-run-overmount-v1",
    supervisorDescriptorContained: true,
    supervisorDescriptorConsumedBeforeTarget: true,
    supervisorStagingPathHidden: true,
    supervisorTemporaryCopyObscured: true,
    supervisorPid1ExecutableExposure: "procfs",
    supervisorExecutableIdentity: createLinuxSupervisorExecutableIdentity(),
    ...overrides,
  };
}

function createLinuxPluginTreeRuntimeProbe(overrides = {}) {
  return createLinuxSupervisorRuntimeProbe({
    contentSnapshot: true,
    contentSnapshotScope: "plugin-entry-source",
    contentSnapshotMechanism: "verified-o_tmpfile-copy-bwrap-ro-bind-data-v1",
    pluginTreeContentSnapshot: true,
    pluginTreeContentSnapshotScope: "all-pinned-plugin-regular-files",
    pluginTreeContentSnapshotMechanism:
      "verified-o_tmpfile-copy-bwrap-ro-bind-data-v1",
    pluginTreeContentSnapshotFiles: 2,
    pluginTreeContentSnapshotBytes: 50,
    pluginTreeContentSnapshotDigest: "b".repeat(64),
    pluginTreeSnapshotConsistency: "per-file-pin-to-launch",
    pluginTreeSnapshotContractBound: false,
    pluginTreeSnapshotAtomic: false,
    ...overrides,
  });
}

function createLinuxDynamicNativeRuntimeProbe(overrides = {}) {
  return createLinuxSupervisorRuntimeProbe({
    kind: "linux-bwrap-plugin-native-dynamic-elf-policy-v1",
    targetRuntime: "native-dynamic-elf",
    contentSnapshot: true,
    contentSnapshotScope: "plugin-entry-executable",
    contentSnapshotMechanism: "verified-o_tmpfile-copy-bwrap-ro-bind-data-v1",
    pluginTreeContentSnapshot: true,
    pluginTreeContentSnapshotScope: "all-pinned-plugin-regular-files",
    pluginTreeContentSnapshotMechanism:
      "verified-o_tmpfile-copy-bwrap-ro-bind-data-v1",
    pluginTreeContentSnapshotFiles: 2,
    pluginTreeContentSnapshotBytes: 50,
    pluginTreeContentSnapshotDigest: "e".repeat(64),
    pluginTreeSnapshotConsistency: "per-file-pin-to-launch",
    pluginTreeSnapshotContractBound: false,
    pluginTreeSnapshotAtomic: false,
    initialDynamicLoadClosureDescriptorBound: true,
    initialDynamicLoadClosureScope:
      "initial-pt_interp-and-recursive-dt_needed-attested-system-graph",
    initialDynamicLoadClosureMechanism:
      "recursive-parsed-elf-system-graph-to-attested-runtime-fds-v1",
    initialDynamicInterpreter: "/lib64/ld-linux-x86-64.so.2",
    initialDynamicDependencyCount: 2,
    initialDynamicRuntimeFileCount: 3,
    initialDynamicRuntimeBytes: 300,
    initialDynamicLoadClosureDigest: "d".repeat(64),
    sharedLibraryClosure: false,
    runtimeSharedLibraryPathnameClosure: true,
    runtimeSharedLibraryPathnameClosureExcludes:
      "anonymous-jit-and-custom-in-process-loader",
    runtimeSharedLibraryClosureScope:
      "all-pathname-visible-regular-files-in-read-only-bwrap-namespace",
    runtimeSharedLibraryClosureMechanism:
      "descriptor-pinned-hashed-ro-mount-set-plus-loader-fd-and-namespace-mutation-seccomp-v2",
    runtimeSharedLibraryLoadSetFiles: 5,
    runtimeSharedLibraryLoadSetBytes: 500,
    runtimeSharedLibraryLoadSetDigest: "f".repeat(64),
    runtimeLoadSetPolicyBound: true,
    runtimeWritableFilesystems: false,
    runtimeProcfsMounted: false,
    runtimeDevfsMounted: false,
    runtimeScratchWritable: false,
    runtimeDescriptorReopenPaths: false,
    supervisorPid1ExecutableExposure: "procfs-not-mounted",
    ...overrides,
  });
}

function createLinuxStaticNativeRuntimeProbe(overrides = {}) {
  return createLinuxDynamicNativeRuntimeProbe({
    kind: "linux-bwrap-plugin-native-static-elf-policy-v1",
    targetRuntime: "native-static-elf",
    initialDynamicLoadClosureDescriptorBound: undefined,
    initialDynamicLoadClosureScope: undefined,
    initialDynamicLoadClosureMechanism: undefined,
    initialDynamicInterpreter: undefined,
    initialDynamicDependencyCount: undefined,
    initialDynamicRuntimeFileCount: undefined,
    initialDynamicRuntimeBytes: undefined,
    initialDynamicLoadClosureDigest: undefined,
    runtimeSharedLibraryPathnameClosure: undefined,
    runtimeSharedLibraryPathnameClosureExcludes: undefined,
    runtimeSharedLibraryClosureScope: undefined,
    runtimeSharedLibraryClosureMechanism: undefined,
    runtimeSharedLibraryLoadSetFiles: undefined,
    runtimeSharedLibraryLoadSetBytes: undefined,
    runtimeSharedLibraryLoadSetDigest: undefined,
    runtimeLoadSetPolicyBound: undefined,
    runtimeWritableFilesystems: undefined,
    runtimeProcfsMounted: undefined,
    runtimeDevfsMounted: undefined,
    runtimeScratchWritable: undefined,
    runtimeDescriptorReopenPaths: undefined,
    supervisorPid1ExecutableExposure: "procfs",
    ...overrides,
  });
}

function normalizedMcpCapsuleContract({
  runtimePath,
  entryPath,
  runtimeSha256 = "a".repeat(64),
  runtimeBytes = 100,
  entrySha256 = "b".repeat(64),
  entryBytes = 200,
}) {
  const pluginRoot = /^[A-Za-z]:\\/.test(entryPath)
    ? path.win32.dirname(entryPath)
    : path.posix.dirname(entryPath);
  return Object.freeze({
    contractVersion: 1,
    kind: "strict-mcp-node-capsule",
    pluginRoot,
    workingDirectory: pluginRoot,
    runtimePath,
    rootIdentity: Object.freeze({
      realPath: pluginRoot,
      fileId: Object.freeze({ dev: "1", ino: "1" }),
    }),
    runtimeIdentity: Object.freeze({
      contractVersion: 1,
      realPath: runtimePath,
      sha256: runtimeSha256,
      bytes: runtimeBytes,
      fileId: Object.freeze({ dev: "1", ino: "2" }),
      mtimeMs: 1,
    }),
    entryIdentity: Object.freeze({
      contractVersion: 1,
      realPath: entryPath,
      sha256: entrySha256,
      bytes: entryBytes,
      fileId: Object.freeze({ dev: "1", ino: "3" }),
      mtimeMs: 1,
    }),
  });
}

function appliedPlan(command, args, options, overrides = {}) {
  return {
    contractVersion: 1,
    applied: true,
    platform: "test",
    profile: "default",
    command,
    args,
    options,
    enforcement: "test-sandbox",
    reason: null,
    postSpawn: { required: false, mode: "none" },
    ...overrides,
  };
}

function appliedLinuxDescriptorScrubbedPlan(
  executableArgs,
  options,
  runtimeProbe,
  overrides,
) {
  const originalStdio = Array.isArray(options?.stdio)
    ? Array.from(options.stdio)
    : ["pipe", "pipe", "pipe", 41];
  while (originalStdio.length < 4) originalStdio.push(undefined);
  const usedParentFds = new Set();
  let nextParentFd = 41;
  const allocateParentFd = () => {
    while (usedParentFds.has(nextParentFd)) nextParentFd += 1;
    const result = nextParentFd;
    usedParentFds.add(result);
    nextParentFd += 1;
    return result;
  };
  const stdio = Array.from(originalStdio, (value, index) => {
    if (index < 3) return value;
    if (
      Number.isSafeInteger(value) &&
      value >= 0 &&
      !usedParentFds.has(value)
    ) {
      usedParentFds.add(value);
      return value;
    }
    return allocateParentFd();
  });
  const scrubberChildFd = stdio.length;
  stdio.push(allocateParentFd());
  const layout = Object.freeze({
    scrubberChildFd,
    preservedMaxFd: scrubberChildFd - 1,
    activeStdioThrough: 2,
    nodeIpcChildFd: null,
    executableChildFd: 3,
  });
  const launch = buildLinuxBwrapDescriptorScrubbedLaunch({
    ...layout,
    executableArgs,
  });
  return appliedPlan(
    launch.command,
    launch.args,
    {
      ...options,
      shell: false,
      env: {
        PATH: "/usr/bin:/bin",
        LANG: "C",
        LC_ALL: "C",
      },
      stdio,
    },
    {
      ...overrides,
      runtimeProbe: {
        ...runtimeProbe,
        descriptorScrubber:
          runtimeProbe?.descriptorScrubber ??
          createLinuxDescriptorScrubberRuntimeEvidence(layout),
      },
    },
  );
}

function appliedMacSignedRootMcpPlan(
  command,
  args,
  options,
  contract,
  overrides = {},
) {
  const protocol = MACOS_MCP_LAUNCHER_INPUTS.protocol;
  const nonce = "c".repeat(64);
  const policyDigest = "d".repeat(64);
  const helperArgs = [
    "--launch-v1",
    nonce,
    MACOS_MCP_LAUNCHER_INPUTS.protocolSha256,
    contract.runtimeIdentity.sha256,
    String(contract.runtimeIdentity.bytes),
    contract.entryIdentity.sha256,
    String(contract.entryIdentity.bytes),
    "501",
    "20",
    policyDigest,
    ...args.slice(1),
  ];
  return appliedPlan(
    protocol.helperInstallPath,
    helperArgs,
    {
      ...options,
      cwd: "/",
      shell: false,
      detached: false,
      stdio: ["pipe", "pipe", "pipe", 31, 32, 33, "ignore", "ignore", "pipe"],
    },
    {
      platform: "darwin",
      enforcement: protocol.backend,
      backend: protocol.backend,
      candidateBackend: null,
      policyAttested: true,
      policyDigest,
      guarantees: [
        SANDBOX_BOUNDARIES.CODE_SNAPSHOT,
        SANDBOX_BOUNDARIES.FILESYSTEM,
        SANDBOX_BOUNDARIES.NETWORK,
        SANDBOX_BOUNDARIES.PROCESS_EXEC,
        SANDBOX_BOUNDARIES.PROCESS_TREE,
        SANDBOX_BOUNDARIES.PRIVILEGE_REDUCTION,
      ],
      runtimeProbe: {
        kind: "darwin-mcp-capsule-code-snapshot-v2",
        attempted: true,
        runnable: true,
        reason: null,
        probeRuntime: "node",
        targetRuntime: "node",
        contentSnapshot: true,
        contentSnapshotScope: "mcp-capsule-entry-and-node-runtime",
        contentSnapshotMechanism:
          "signed-root-runtime-path-and-anonymous-entry-fd-snapshots-v1",
        handleAtomic: true,
        entrySnapshotAtomic: true,
        runtimeLaunchAtomic: true,
        runtimeLaunchMechanism:
          "signed-root-helper-fd-copy-protected-path-ready-gate-v1",
        runtimeLaunchPath: path.posix.join(
          protocol.snapshotRoot,
          nonce,
          "node",
        ),
        entrySnapshotPath: "anonymous-root-owned-fd4",
        runtimeSnapshotSha256: contract.runtimeIdentity.sha256,
        runtimeSnapshotBytes: contract.runtimeIdentity.bytes,
        entrySnapshotSha256: contract.entryIdentity.sha256,
        entrySnapshotBytes: contract.entryIdentity.bytes,
        entrySnapshotBootstrapSha256:
          MCP_STDIO_MACOS_GATED_ENTRY_BOOTSTRAP_SHA256,
        sharedLibraryClosure: false,
        rootProtectedRuntimeSnapshot: true,
        entryRootOwnedAnonymousSnapshot: true,
        entrySourcePrePostStat: true,
        entryWriterClosedBeforeReadonlyReopen: true,
        entryReadonlyIdentityRechecked: true,
        entryUnlinkedAndDirectoryFsyncedBeforeTarget: true,
        targetInheritedEntrySnapshotOnly: true,
        runtimeAndCapsuleSlotsNullBeforeExec: true,
        bootstrapClosesNullAndReadyDescriptors: true,
        actualRuntimeReadyHandshake: true,
        runtimeSnapshotUnlinkedBeforeEntryRelease: true,
        callerCredentialDropIrreversible: true,
        relayParentCredentialsDropped: true,
        callerLifelineWatched: true,
        signalRelayNonblocking: true,
        targetRuntimeInvocationMode: "node-executable-eval-v1",
        pkgExecPathMagicBound: false,
        targetDescriptorAllowlist:
          "stdio-fd3-null-fd4-entry-fd5-null-fd6-gate-fd7-ready",
        capsuleRootDescriptorBound: true,
        capsulePathObjectAtomic: false,
        sandboxProfileFixedAndDigestBound: true,
        processForkExplicitlyDenied: true,
        sandboxExecLiveGateContract: true,
        globalLaunchSerialization: true,
        maximumStaleSnapshots: protocol.maximumStaleSnapshots,
        helperSha256: "e".repeat(64),
        helperSourceSha256: MACOS_MCP_LAUNCHER_INPUTS.sourceSha256,
        helperProtocolSha256: MACOS_MCP_LAUNCHER_INPUTS.protocolSha256,
        helperInstallContractSha256: "f".repeat(64),
        helperDesignatedRequirementSha256: "1".repeat(64),
        helperTeamIdentifier: "ABCDEFGHIJ",
        helperPackageIdentifier: protocol.packageIdentifier,
        helperPackageVersion: "0.163.8",
        installAttestationDigest: "2".repeat(64),
        planBindingMechanism: "macos-mcp-code-snapshot-plan-binding-v1",
        planBindingDigest: "3".repeat(64),
      },
      ...overrides,
    },
  );
}

function appliedLinuxBwrapPluginTreePlan(
  command,
  args,
  options,
  overrides = {},
) {
  const {
    runtimeProbe = createLinuxPluginTreeRuntimeProbe(),
    ...planOverrides
  } = overrides;
  return appliedLinuxDescriptorScrubbedPlan(
    ["--", command, ...args],
    options,
    runtimeProbe,
    {
      platform: "linux",
      profile: "strict",
      enforcement: "linux-bwrap",
      backend: "linux-bwrap",
      candidateBackend: null,
      policyAttested: true,
      policyDigest: "c".repeat(64),
      guarantees: [
        SANDBOX_BOUNDARIES.FILESYSTEM,
        SANDBOX_BOUNDARIES.NETWORK,
        SANDBOX_BOUNDARIES.PROCESS_TREE,
      ],
      ...planOverrides,
    },
  );
}

function appliedLinuxBwrapDynamicNativePlan(
  command,
  args,
  options,
  overrides = {},
) {
  const {
    runtimeProbe = createLinuxDynamicNativeRuntimeProbe(),
    ...planOverrides
  } = overrides;
  return appliedLinuxDescriptorScrubbedPlan(
    [
      "--die-with-parent",
      "--new-session",
      "--unshare-user",
      "--disable-userns",
      "--assert-userns-disabled",
      "--unshare-pid",
      "--unshare-ipc",
      "--unshare-net",
      "--unshare-uts",
      "--unshare-cgroup-try",
      "--cap-drop",
      "ALL",
      "--hostname",
      "chainless-sandbox",
      "--clearenv",
      ...[
        "/dev",
        "/etc",
        "/home",
        "/lib",
        "/opt",
        "/proc",
        "/run",
        "/tmp",
        "/var",
        "/home/sandbox",
        "/opt/chainless",
        "/var/tmp",
        "/opt/chainless/plugin",
        "/opt/chainless/runtime",
        "/opt/chainless/plugin/bin",
        "/opt/chainless/plugin/lib",
      ].flatMap((directory) => ["--dir", directory]),
      "--perms",
      "0000",
      "--file",
      "3",
      "/run/.chainless-bwrap-supervisor",
      "--perms",
      "0500",
      "--ro-bind-data",
      "4",
      "/opt/chainless/runtime/node",
      "--ro-bind-fd",
      "5",
      "/etc/ld.so.cache",
      "--perms",
      "0500",
      "--ro-bind-data",
      "6",
      "/opt/chainless/plugin/bin/tool",
      "--perms",
      "0400",
      "--ro-bind-data",
      "7",
      "/opt/chainless/plugin/lib/approved.so",
      "--ro-bind-fd",
      "8",
      "/lib/libc.so.6",
      "--seccomp",
      "9",
      "--remount-ro",
      "/",
      "--perms",
      "0755",
      "--size",
      String(16 * 1024 * 1024),
      "--tmpfs",
      "/run",
      "--remount-ro",
      "/run",
      "--setenv",
      "CHAINLESS_SANDBOXED",
      "1",
      "--setenv",
      "HOME",
      "/home/sandbox",
      "--setenv",
      "LANG",
      "C.UTF-8",
      "--setenv",
      "LC_ALL",
      "C.UTF-8",
      "--setenv",
      "OPENSSL_CONF",
      "/dev/null",
      "--setenv",
      "PATH",
      "/opt/chainless/runtime",
      "--setenv",
      "TMPDIR",
      "/tmp",
      "--setenv",
      "TZ",
      "UTC",
      "--chdir",
      "/opt/chainless/plugin",
      "--",
      command,
      ...args,
    ],
    options,
    runtimeProbe,
    {
      platform: "linux",
      profile: "strict",
      enforcement: "linux-bwrap",
      backend: "linux-bwrap",
      candidateBackend: null,
      policyAttested: true,
      policyDigest: "c".repeat(64),
      guarantees: [
        SANDBOX_BOUNDARIES.FILESYSTEM,
        SANDBOX_BOUNDARIES.NETWORK,
        SANDBOX_BOUNDARIES.PROCESS_TREE,
      ],
      ...planOverrides,
    },
  );
}

function trustedBuiltInLinuxLaunchContext({
  command = "tool",
  args = ["run"],
  cwd,
  shell = false,
  detached = false,
  executionContract = null,
  requiredBoundaries = [SANDBOX_BOUNDARIES.FILESYSTEM],
  sync = false,
} = {}) {
  return Object.freeze({
    command,
    args: Object.freeze([...args]),
    cwd,
    shell,
    detached,
    executionContract,
    profile: "strict",
    requiredBoundaries: Object.freeze([...requiredBoundaries]),
    sync,
    builtInSandboxAdapter: true,
  });
}

afterAll(() => {
  expect(resetWindowsSandboxAdapterCache()).toBe(true);
});

describe("platform sandbox adapter contract", () => {
  beforeEach(() => {
    resetWindowsSandboxAdapterCache();
  });

  it("reports the implicit macOS profile unavailable without altering the invocation", () => {
    const options = { shell: true, cwd: "/workspace" };
    const plan = applySandbox("echo ready", [], options, "default", {
      platform: "darwin",
      fs: { existsSync: vi.fn(() => true) },
    });

    expect(plan).toMatchObject({
      applied: false,
      platform: "darwin",
      profile: "default",
      command: "echo ready",
      args: [],
      options,
      reason: "macos_default_profile_requires_explicit_policy",
      guarantees: [],
    });
  });

  it("returns a macOS Seatbelt wrapper as the executable spawn plan", () => {
    const fsRuntime = {
      existsSync: vi.fn(() => true),
      writeFileSync: vi.fn(),
      unlinkSync: vi.fn(),
    };
    const options = { cwd: "/workspace", env: { PATH: "/usr/bin" } };

    const plan = applySandbox("node", ["script.js"], options, "strict", {
      platform: "darwin",
      fs: fsRuntime,
      tmpdir: () => "/sandbox-tmp",
      randomBytes: () => Buffer.from("0123456789abcdef", "hex"),
    });

    expect(plan).toMatchObject({
      contractVersion: 1,
      applied: true,
      platform: "darwin",
      profile: "strict",
      command: "/usr/bin/sandbox-exec",
      enforcement: "macos-seatbelt",
      backend: "macos-seatbelt",
      guarantees: [
        SANDBOX_BOUNDARIES.FILESYSTEM,
        SANDBOX_BOUNDARIES.NETWORK,
        SANDBOX_BOUNDARIES.PROCESS_EXEC,
      ],
      postSpawn: { required: false, mode: "none" },
    });
    expect(plan.args[0]).toBe("-f");
    expect(plan.args.slice(2)).toEqual(["node", "script.js"]);
    expect(plan.options).toEqual(options);
    expect(fsRuntime.writeFileSync).toHaveBeenCalledOnce();
    const profile = fsRuntime.writeFileSync.mock.calls[0][1];
    expect(profile).toContain('(import "system.sb")');
    expect(profile).toContain("(deny network*)");
    expect(profile).toContain('(allow file-read* (subpath "/usr/bin"))');
    expect(profile).toContain(
      '(allow file-read* file-write* (literal "/dev/null")',
    );

    plan.cleanup();
    expect(fsRuntime.unlinkSync).toHaveBeenCalledOnce();
  });

  it("preserves shell command semantics behind an explicit macOS wrapper", () => {
    const fsRuntime = {
      existsSync: vi.fn(() => true),
      writeFileSync: vi.fn(),
      unlinkSync: vi.fn(),
    };
    const plan = applySandbox(
      "node script.js",
      [],
      { shell: true, cwd: "/workspace" },
      "network-only",
      {
        platform: "darwin",
        fs: fsRuntime,
        tmpdir: () => "/sandbox-tmp",
        randomBytes: () => Buffer.from("0123456789abcdef", "hex"),
      },
    );

    expect(plan.args.slice(-3)).toEqual(["/bin/sh", "-c", "node script.js"]);
    expect(plan.options).toMatchObject({
      cwd: "/workspace",
      shell: false,
    });
    plan.cleanup();
  });

  it("launches an MCP capsule from anonymous Linux runtime and entry snapshots", () => {
    const harness = createLinuxStrongHarness();
    const plan = applyLinuxMcpCapsuleHarness(harness);

    expect(plan).toMatchObject({
      applied: true,
      platform: "linux",
      backend: "linux-fd-code-snapshot",
      enforcement: "linux-fd-code-snapshot",
      policyAttested: true,
      guarantees: [SANDBOX_BOUNDARIES.CODE_SNAPSHOT],
      command: "/proc/self/fd/3",
      args: ["-e", MCP_STDIO_FD_ENTRY_BOOTSTRAP, "--", "--label", "ready"],
      runtimeProbe: {
        runnable: true,
        contentSnapshot: true,
        contentSnapshotScope: "mcp-capsule-entry-and-node-runtime",
        handleAtomic: true,
        entrySnapshotAtomic: true,
        runtimeLaunchAtomic: true,
        sharedLibraryClosure: false,
      },
    });
    expect(plan.options).toMatchObject({
      cwd: "/plugin",
      shell: false,
      detached: true,
    });
    expect(plan.options.stdio.slice(0, 3)).toEqual(["pipe", "pipe", "pipe"]);
    expect(plan.options.stdio.slice(3)).toHaveLength(2);
    expect(
      plan.options.stdio.slice(3).every((fd) => harness.openFiles.has(fd)),
    ).toBe(true);
    expect(plan.policyDigest).toMatch(/^[a-f0-9]{64}$/);

    const inherited = plan.options.stdio.slice(3);
    plan.cleanup();
    expect(inherited.every((fd) => !harness.openFiles.has(fd))).toBe(true);
  });

  it("fails the Linux MCP capsule boundary closed when source changes during snapshot", () => {
    const harness = createLinuxStrongHarness({
      tamperNodeSourceDuringSnapshotCopy: true,
    });
    const plan = applyLinuxMcpCapsuleHarness(harness);

    expect(plan).toMatchObject({
      applied: false,
      backend: null,
      candidateBackend: "linux-fd-code-snapshot",
      policyAttested: false,
      guarantees: [],
      reason: "linux_mcp_capsule_code_snapshot_unavailable",
      runtimeProbe: {
        runnable: false,
        reason: "node_entry_snapshot_source_changed",
      },
    });
    expect(harness.openFiles.size).toBe(0);
  });

  it("returns the Linux prlimit wrapper and marked child environment", () => {
    const options = { cwd: "/workspace", env: { PATH: "/usr/bin" } };
    const probeSpawnSync = vi.fn();
    const plan = applySandbox("node", ["script.js"], options, "default", {
      platform: "linux",
      fs: { existsSync: vi.fn(() => true) },
      spawnSync: probeSpawnSync,
    });

    expect(plan).toMatchObject({
      contractVersion: 1,
      applied: true,
      platform: "linux",
      profile: "default",
      command: "/usr/bin/prlimit",
      enforcement: "linux-prlimit",
      backend: "linux-prlimit",
      guarantees: [SANDBOX_BOUNDARIES.RESOURCE_LIMITS],
    });
    expect(plan.args).toEqual([
      "--cpu=30",
      "--nofile=256",
      "--",
      "node",
      "script.js",
    ]);
    expect(plan.guarantees).toEqual([SANDBOX_BOUNDARIES.RESOURCE_LIMITS]);
    expect(plan.options.env).toEqual({
      PATH: "/usr/bin",
      CHAINLESS_SANDBOXED: "1",
    });
    expect(options.env).toEqual({ PATH: "/usr/bin" });
    expect(probeSpawnSync).not.toHaveBeenCalled();
  });

  it("requires a trusted execution contract before probing or starting bubblewrap", () => {
    const probeSpawnSync = vi.fn(() => ({ status: 1 }));
    const plan = applySandbox(
      "node",
      ["script.js"],
      { cwd: "/workspace" },
      {
        profile: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
      },
      {
        platform: "linux",
        fs: { existsSync: vi.fn(() => true) },
        spawnSync: probeSpawnSync,
      },
    );

    expect(plan).toMatchObject({
      applied: false,
      platform: "linux",
      profile: "strict",
      command: "node",
      args: ["script.js"],
      backend: null,
      candidateBackend: "linux-bwrap",
      policyAttested: false,
      reason: "linux_bwrap_execution_contract_missing",
      guarantees: [],
      runtimeProbe: {
        kind: "linux-bwrap-plugin-node-policy-v1",
        attempted: false,
        runnable: false,
        reason: "execution_contract_missing",
      },
    });
    expect(probeSpawnSync).not.toHaveBeenCalled();
  });

  it("fails closed and releases every pin when argv becomes sparse after the policy probe", () => {
    const launchArgs = ["/plugin/bin/tool.js", "--label", "ready"];
    const harness = createLinuxStrongHarness({
      onPolicyProbeComplete() {
        delete launchArgs[1];
      },
    });
    const plan = applySandbox(
      "/runtime/node",
      launchArgs,
      { cwd: "/plugin", shell: false },
      {
        profile: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
      },
      {
        platform: "linux",
        fs: harness.fsRuntime,
        homedir: () => "/home/tester",
        spawnSync: harness.spawnSync,
      },
      {
        profile: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
        sync: true,
        executionContract: harness.contract,
      },
    );

    expect(plan).toMatchObject({
      applied: false,
      candidateBackend: "linux-bwrap",
      reason: "linux_bwrap_execution_contract_changed",
      guarantees: [],
    });
    expect(harness.openFiles.size).toBe(0);
  });

  it.each([
    ["throwing slice getter", "slice"],
    ["throwing Symbol.iterator getter", Symbol.iterator],
  ])(
    "rejects an argv array with a %s without opening resources",
    (_label, key) => {
      const launchArgs = ["/plugin/bin/tool.js", "--label", "ready"];
      Object.defineProperty(launchArgs, key, {
        configurable: true,
        get() {
          throw new Error("argv_property_must_not_be_read");
        },
      });
      const harness = createLinuxStrongHarness();

      const plan = applySandbox(
        "/runtime/node",
        launchArgs,
        { cwd: "/plugin", shell: false },
        {
          profile: "strict",
          requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
        },
        {
          platform: "linux",
          fs: harness.fsRuntime,
          homedir: () => "/home/tester",
          spawnSync: harness.spawnSync,
        },
        {
          profile: "strict",
          requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
          sync: true,
          executionContract: harness.contract,
        },
      );

      expect(plan).toMatchObject({
        applied: false,
        candidateBackend: "linux-bwrap",
        reason: "linux_bwrap_execution_contract_invalid",
        guarantees: [],
      });
      expect(harness.openFiles.size).toBe(0);
    },
  );

  it("builds an attested empty-root bwrap plan for one direct Plugin Node bin", () => {
    const harness = createLinuxStrongHarness();
    const plan = applySandbox(
      "/runtime/node",
      ["/plugin/bin/tool.js", "--label", "ready"],
      {
        cwd: "/plugin",
        shell: false,
        env: {
          PATH: "/host/path",
          NODE_OPTIONS: "--require=/host/secret.js",
          SSH_AUTH_SOCK: "/run/user/1000/ssh-agent",
          CC_SESSION_ID: "session-1",
        },
      },
      {
        profile: "strict",
        requiredBoundaries: [
          SANDBOX_BOUNDARIES.FILESYSTEM,
          SANDBOX_BOUNDARIES.NETWORK,
        ],
      },
      {
        platform: "linux",
        fs: harness.fsRuntime,
        homedir: () => "/home/tester",
        spawnSync: harness.spawnSync,
      },
      {
        profile: "strict",
        requiredBoundaries: [
          SANDBOX_BOUNDARIES.FILESYSTEM,
          SANDBOX_BOUNDARIES.NETWORK,
        ],
        sync: true,
        executionContract: harness.contract,
      },
    );

    expect(plan).toMatchObject({
      applied: true,
      backend: "linux-bwrap",
      enforcement: "linux-bwrap",
      policyAttested: true,
      reason: null,
      guarantees: [
        SANDBOX_BOUNDARIES.FILESYSTEM,
        SANDBOX_BOUNDARIES.NETWORK,
        SANDBOX_BOUNDARIES.PROCESS_TREE,
      ],
      runtimeProbe: {
        attempted: true,
        runnable: true,
        reason: null,
        targetRuntime: "node",
        runtimeDetachedChildSpawnVerified: true,
        contentSnapshot: true,
        contentSnapshotScope: "plugin-entry-source",
        contentSnapshotMechanism:
          "verified-o_tmpfile-copy-bwrap-ro-bind-data-v1",
        pluginTreeContentSnapshot: true,
        pluginTreeContentSnapshotScope: "all-pinned-plugin-regular-files",
        pluginTreeContentSnapshotMechanism:
          "verified-o_tmpfile-copy-bwrap-ro-bind-data-v1",
        pluginTreeContentSnapshotFiles: 2,
        pluginTreeContentSnapshotBytes:
          harness.contract.entryIdentity.bytes +
          harness.files.get("/plugin/lib/value.cjs").length,
        pluginTreeContentSnapshotDigest:
          expect.stringMatching(/^[a-f0-9]{64}$/),
        pluginTreeSnapshotConsistency: "per-file-pin-to-launch",
        pluginTreeSnapshotContractBound: false,
        pluginTreeSnapshotAtomic: false,
        supervisorDescriptorBound: true,
        supervisorDescriptorBindingMechanism:
          "pinned-child-fd3-file-consume-run-overmount-v1",
        supervisorExecutableIdentity: {
          path: "/usr/bin/bwrap",
          sha256: harness.originalBwrapSha256,
        },
        descriptorScrubber: {
          kind: "linux-bwrap-inherited-fd-scrubber-v1",
          executableIdentity: {
            path: "/usr/bin/bash",
            uid: 0,
          },
          executablePinned: true,
          argvFixed: true,
          callerEnvironmentFixed: true,
          nodeRuntimeEnvironmentInjection: "none",
          nodeIpcChildFd: null,
          nodeIpcSerializationMode: null,
          procSelfFdPasses: 3,
          closesUnknownInheritedDescriptors: true,
          verificationPassesFailClosed: true,
          policyBound: true,
          executableChildFd: 3,
        },
        handleAtomic: false,
      },
    });
    expect(plan.policyDigest).toMatch(/^[a-f0-9]{64}$/);
    const scrubbedLaunch = parseLinuxBwrapDescriptorScrubbedLaunch(
      plan.command,
      plan.args,
      plan.options,
    );
    expect(scrubbedLaunch).toMatchObject({
      scrubberChildFd: plan.options.stdio.length - 1,
      preservedMaxFd: plan.options.stdio.length - 2,
      executableChildFd: 3,
    });
    expect(plan.command).toBe(`/proc/self/fd/${plan.options.stdio.length - 1}`);
    const bwrapArgs = scrubbedLaunch.executableArgs;
    expectLinuxBwrapSupervisorPolicy(bwrapArgs);
    expect(bwrapArgs).toContain("--unshare-user");
    expect(bwrapArgs).toContain("--disable-userns");
    expect(bwrapArgs).toContain("--unshare-net");
    expect(bwrapArgs).toContain("--seccomp");
    expect(bwrapArgs).toContain("--clearenv");
    expect(bwrapArgs).toContain("--remount-ro");
    expect(bwrapArgs.join("\0")).not.toContain("--ro-bind\0/\0/");
    const entryDataIndex = bwrapArgs.findIndex(
      (value, index) =>
        value === "--ro-bind-data" &&
        bwrapArgs[index + 2] === "/opt/chainless/plugin/bin/tool.js",
    );
    expect(entryDataIndex).toBeGreaterThanOrEqual(2);
    expect(bwrapArgs.slice(entryDataIndex - 2, entryDataIndex + 3)).toEqual([
      "--perms",
      "0400",
      "--ro-bind-data",
      expect.any(String),
      "/opt/chainless/plugin/bin/tool.js",
    ]);
    expect(
      bwrapArgs.some(
        (value, index) =>
          value === "--ro-bind-fd" &&
          bwrapArgs[index + 2] === "/opt/chainless/plugin/bin/tool.js",
      ),
    ).toBe(false);
    expect(bwrapArgs).not.toContain("/plugin");
    const libDirectoryIndex = bwrapArgs.findIndex(
      (value, index) => value === "--dir" && bwrapArgs[index + 1] === "/lib",
    );
    const libBindIndex = bwrapArgs.findIndex(
      (value, index) =>
        value === "--ro-bind-fd" && bwrapArgs[index + 2] === "/lib/libc.so.6",
    );
    expect(libDirectoryIndex).toBeGreaterThan(-1);
    expect(libBindIndex).toBeGreaterThan(libDirectoryIndex);
    expect(bwrapArgs.slice(-5)).toEqual([
      "--",
      "/opt/chainless/runtime/node",
      "/opt/chainless/plugin/bin/tool.js",
      "--label",
      "ready",
    ]);
    expect(plan.options).toMatchObject({
      cwd: "/",
      shell: false,
      detached: false,
      env: {
        PATH: "/usr/bin:/bin",
        LANG: "C",
        LC_ALL: "C",
      },
    });
    expect(bwrapArgs.join("\0")).not.toContain("NODE_OPTIONS");
    expect(bwrapArgs.join("\0")).not.toContain("SSH_AUTH_SOCK");
    expect(bwrapArgs.join("\0")).not.toContain("CC_SESSION_ID");
    expect(harness.spawnSync.mock.calls[0][0]).toBe("/usr/bin/ldd");
    expect(
      harness.spawnSync.mock.calls
        .slice(1)
        .every(([command, launchArgs, options]) =>
          Boolean(
            parseLinuxBwrapDescriptorScrubbedLaunch(
              command,
              launchArgs,
              options,
            ),
          ),
        ),
    ).toBe(true);
    expectLinuxBwrapSupervisorInvocations(harness, ["capability", "probe"]);
    const policyProbeCall = harness.spawnSync.mock.calls.find(
      ([command, probeArgs, options]) => {
        const launch = parseLinuxBwrapDescriptorScrubbedLaunch(
          command,
          probeArgs,
          options,
        );
        return launch && launch.executableArgs[0] !== "--help";
      },
    );
    const policyProbeArgs = parseLinuxBwrapDescriptorScrubbedLaunch(
      policyProbeCall[0],
      policyProbeCall[1],
      policyProbeCall[2],
    ).executableArgs;
    const policyProbeSeparator = policyProbeArgs.lastIndexOf("--");
    const policyProbeSource = policyProbeArgs[policyProbeSeparator + 3];
    expect(() => new Script(policyProbeSource)).not.toThrow();
    expect(
      policyProbeArgs.slice(policyProbeSeparator + 1, policyProbeSeparator + 3),
    ).toEqual(["/opt/chainless/runtime/node", "-e"]);
    expect(policyProbeSource).toContain(
      'spawnSync("/opt/chainless/runtime/node", ["-e"',
    );
    expect(policyProbeSource).toContain("detached: true");
    expect(policyProbeSource).toContain(
      'fs.openSync(childReportPath, "wx+", 0o600)',
    );
    expect(policyProbeSource).toContain(
      'stdio: ["ignore", reportFd, "ignore"]',
    );
    expect(policyProbeSource).toContain("fs.writeSync(1");
    expect(policyProbeSource).toContain("fs.readSync(reportFd");
    expect(policyProbeSource).toContain("crypto.randomBytes(16)");
    expect(policyProbeSource).toContain("reportText === canonicalReport");
    expect(policyProbeSource).toContain(
      "report.processGroupPid === report.pid",
    );
    expect(policyProbeSource).toContain("report.sessionPid === report.pid");
    expect(policyProbeSource).not.toContain('"pipe"');
    expect(policyProbeSource).not.toContain("process.getuid()");
    expect(policyProbeSource).not.toContain("process.getgid()");
    expect(policyProbeSource).toContain(
      "runtimeDetachedChildSpawnVerified = false",
    );
    expect(policyProbeSource).toContain(
      "chainless-linux-bwrap-child-runtime-v1",
    );
    expect(plan.options.stdio.length).toBeGreaterThan(3);
    expect(plan.options.stdio[3]).not.toBe(
      harness.bwrapInvocations[0].parentFd,
    );
    expect(plan.options.stdio[3]).not.toBe(
      harness.bwrapInvocations[1].parentFd,
    );
    expect(harness.fdOffsets.get(plan.options.stdio[3])).toBe(0);
    const probeDataReads = harness.bwrapDataReads.filter(
      ({ stage }) => stage === "probe",
    );
    expect(probeDataReads).toHaveLength(2);
    const probeSnapshotRead = probeDataReads.find(
      ({ destination }) => destination === "/opt/chainless/plugin/bin/tool.js",
    );
    expect(probeSnapshotRead).toMatchObject({
      destination: "/opt/chainless/plugin/bin/tool.js",
      offsetBefore: 0,
      bytesRead: harness.contract.entryIdentity.bytes,
      sha256: harness.contract.entryIdentity.sha256,
      permissions: "0400",
    });
    expect(
      probeSnapshotRead.flags & harness.fsRuntime.constants.O_ACCMODE,
    ).toBe(harness.fsRuntime.constants.O_RDONLY);
    const finalSnapshotChildFd = Number(bwrapArgs[entryDataIndex + 1]);
    const finalSnapshotFd = plan.options.stdio[finalSnapshotChildFd];
    expect(finalSnapshotFd).not.toBe(probeSnapshotRead.parentFd);
    expect(harness.fdOffsets.get(finalSnapshotFd)).toBe(0);
    expect(
      harness.openFlags.get(finalSnapshotFd) &
        harness.fsRuntime.constants.O_ACCMODE,
    ).toBe(harness.fsRuntime.constants.O_RDONLY);
    const finalSnapshotPath = harness.openFiles.get(finalSnapshotFd);
    expect(finalSnapshotPath).toBe(probeSnapshotRead.sourcePath);
    expect(harness.statFor(finalSnapshotPath)).toMatchObject({
      nlink: 0,
      mode: 0o100400,
      size: harness.contract.entryIdentity.bytes,
    });
    expect([...harness.openFiles.values()]).not.toContain(harness.entryPath);
    expect([...harness.openFiles.values()]).not.toContain(
      "/plugin/lib/value.cjs",
    );
    const anonymousFilterOpens = harness.fsRuntime.openSync.mock.calls.filter(
      ([value, flags, mode]) =>
        value === "/tmp" &&
        (Number(flags) & harness.fsRuntime.constants.O_TMPFILE) ===
          harness.fsRuntime.constants.O_TMPFILE &&
        mode === 0o400,
    );
    expect(anonymousFilterOpens).toHaveLength(4);
    expect(harness.fsRuntime.mkdtempSync).not.toHaveBeenCalled();
    const seccompIndex = bwrapArgs.indexOf("--seccomp");
    expect(bwrapArgs[seccompIndex + 1]).toBe(
      String(plan.options.stdio.length - 2),
    );
    const actualSeccompFd =
      plan.options.stdio[Number(bwrapArgs[seccompIndex + 1])];
    expect(harness.fdOffsets.get(actualSeccompFd)).toBe(0);
    const seccompProgram = harness.detachedContents.get(actualSeccompFd);
    expect(seccompProgram.length % 8).toBe(0);
    const seccompConstants = [];
    for (let offset = 0; offset < seccompProgram.length; offset += 8) {
      seccompConstants.push(seccompProgram.readUInt32LE(offset + 4));
    }
    const expectedSocketSyscalls =
      process.arch === "arm64" || process.arch === "riscv64"
        ? [198, 199]
        : [41, 53];
    expect(seccompConstants).toEqual(
      expect.arrayContaining([
        ...expectedSocketSyscalls,
        425,
        0x00050001,
        0x7fff0000,
      ]),
    );
    const descriptorReaddirPaths = harness.fsRuntime.readdirSync.mock.calls
      .map(([value]) => String(value))
      .filter((value) => value.startsWith("/proc/self/fd/"));
    expect(descriptorReaddirPaths.length).toBeGreaterThanOrEqual(3);
    expect(
      descriptorReaddirPaths.every((value) =>
        /^\/proc\/self\/fd\/\d+$/.test(value),
      ),
    ).toBe(true);
    expect(harness.openFiles.size).toBeGreaterThan(0);

    const finalResult = harness.spawnSync(
      plan.command,
      plan.args,
      plan.options,
    );
    expect(finalResult.status).toBe(0);
    expectLinuxBwrapSupervisorInvocations(harness, [
      "capability",
      "probe",
      "final",
    ]);
    expect(harness.bwrapDataReads).toHaveLength(4);
    expect(
      harness.bwrapDataReads.find(
        ({ stage, destination }) =>
          stage === "final" &&
          destination === "/opt/chainless/plugin/bin/tool.js",
      ),
    ).toMatchObject({
      parentFd: finalSnapshotFd,
      sourcePath: finalSnapshotPath,
      destination: "/opt/chainless/plugin/bin/tool.js",
      offsetBefore: 0,
      bytesRead: harness.contract.entryIdentity.bytes,
      sha256: harness.contract.entryIdentity.sha256,
      permissions: "0400",
    });

    plan.cleanup();
    plan.cleanup();
    expect(harness.openFiles.size).toBe(0);
    expect(harness.anonymousFiles.size).toBe(0);
    const closedFds = harness.fsRuntime.closeSync.mock.calls.map(([fd]) => fd);
    expect(new Set(closedFds).size).toBe(closedFds.length);
  });

  it("composes an MCP capsule snapshot with Linux filesystem and network isolation", () => {
    const harness = createLinuxStrongHarness({
      contractKind: "strict-mcp-node-capsule",
      nodeEntry: Buffer.from('process.stdout.write("ready");\n'),
      nodeDependency: Buffer.alloc(0),
    });
    const requiredBoundaries = [
      SANDBOX_BOUNDARIES.CODE_SNAPSHOT,
      SANDBOX_BOUNDARIES.FILESYSTEM,
      SANDBOX_BOUNDARIES.NETWORK,
    ];
    const plan = applySandbox(
      "/runtime/node",
      ["/plugin/bin/tool.js", "--stdio"],
      {
        cwd: "/plugin",
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      },
      { profile: "strict", requiredBoundaries },
      {
        platform: "linux",
        fs: harness.fsRuntime,
        homedir: () => "/home/tester",
        spawnSync: harness.spawnSync,
      },
      {
        profile: "strict",
        requiredBoundaries,
        sync: false,
        executionContract: harness.contract,
      },
    );

    expect(plan).toMatchObject({
      applied: true,
      backend: "linux-bwrap",
      enforcement: "linux-bwrap",
      policyAttested: true,
      guarantees: [
        SANDBOX_BOUNDARIES.FILESYSTEM,
        SANDBOX_BOUNDARIES.NETWORK,
        SANDBOX_BOUNDARIES.PROCESS_TREE,
        SANDBOX_BOUNDARIES.CODE_SNAPSHOT,
      ],
      runtimeProbe: {
        kind: "linux-bwrap-plugin-node-policy-v1",
        runnable: true,
        mcpCapsuleCodeSnapshot: true,
        contentSnapshot: true,
        contentSnapshotScope: "plugin-entry-source",
        contentSnapshotMechanism:
          "verified-o_tmpfile-copy-bwrap-ro-bind-data-v1",
        handleAtomic: false,
        entrySnapshotAtomic: true,
        runtimeLaunchAtomic: true,
        runtimeLaunchMechanism: "bwrap-descriptor-mount-node-runtime-exec-v1",
        sharedLibraryClosure: false,
        runtimeSnapshotSha256: harness.contract.runtimeIdentity.sha256,
        runtimeSnapshotBytes: harness.contract.runtimeIdentity.bytes,
        entrySnapshotSha256: harness.contract.entryIdentity.sha256,
        entrySnapshotBytes: harness.contract.entryIdentity.bytes,
        runtimeLaunchPath: "/opt/chainless/runtime/node",
        entrySnapshotPath: "/opt/chainless/plugin/bin/tool.js",
      },
    });
    expect(plan.args.slice(-4)).toEqual([
      "--",
      "/opt/chainless/runtime/node",
      "/opt/chainless/plugin/bin/tool.js",
      "--stdio",
    ]);
    plan.cleanup();
    expect(harness.openFiles.size).toBe(0);
  });

  it("snapshots every Node plugin file with normalized data-bind modes", () => {
    const emptyContents = Buffer.alloc(0);
    const helperContents = Buffer.from("#!/bin/sh\nexit 0\n");
    const harness = createLinuxStrongHarness({
      nodeDependencyMode: 0o100400,
      additionalPluginFiles: [
        {
          path: "/plugin/lib/empty.dat",
          contents: emptyContents,
          mode: 0o100444,
        },
        {
          path: "/plugin/bin/helper",
          contents: helperContents,
          mode: 0o100010,
        },
      ],
    });
    const plan = applyLinuxStrongNodeHarness(harness);
    const expectedBytes =
      harness.contract.entryIdentity.bytes +
      harness.files.get("/plugin/lib/value.cjs").length +
      emptyContents.length +
      helperContents.length;

    expect(plan).toMatchObject({
      applied: true,
      policyAttested: true,
      runtimeProbe: {
        runnable: true,
        targetRuntime: "node",
        contentSnapshot: true,
        contentSnapshotScope: "plugin-entry-source",
        contentSnapshotMechanism:
          "verified-o_tmpfile-copy-bwrap-ro-bind-data-v1",
        pluginTreeContentSnapshot: true,
        pluginTreeContentSnapshotScope: "all-pinned-plugin-regular-files",
        pluginTreeContentSnapshotMechanism:
          "verified-o_tmpfile-copy-bwrap-ro-bind-data-v1",
        pluginTreeContentSnapshotFiles: 4,
        pluginTreeContentSnapshotBytes: expectedBytes,
        pluginTreeContentSnapshotDigest:
          expect.stringMatching(/^[a-f0-9]{64}$/),
        pluginTreeSnapshotConsistency: "per-file-pin-to-launch",
        pluginTreeSnapshotContractBound: false,
        pluginTreeSnapshotAtomic: false,
        handleAtomic: false,
      },
    });

    const mounts = linuxBwrapFileMounts(plan.args);
    expect(
      mounts
        .filter(({ destination }) =>
          destination.startsWith("/opt/chainless/plugin/"),
        )
        .map(({ mode, destination, permissions }) => ({
          mode,
          destination,
          permissions,
        }))
        .sort((left, right) =>
          left.destination.localeCompare(right.destination),
        ),
    ).toEqual([
      {
        mode: "ro-bind-data",
        destination: "/opt/chainless/plugin/bin/helper",
        permissions: "0500",
      },
      {
        mode: "ro-bind-data",
        destination: "/opt/chainless/plugin/bin/tool.js",
        permissions: "0400",
      },
      {
        mode: "ro-bind-data",
        destination: "/opt/chainless/plugin/lib/empty.dat",
        permissions: "0400",
      },
      {
        mode: "ro-bind-data",
        destination: "/opt/chainless/plugin/lib/value.cjs",
        permissions: "0400",
      },
    ]);
    for (const destination of [
      "/opt/chainless/runtime/node",
      "/lib/libc.so.6",
      "/lib64/ld-linux.so.2",
      "/etc/ld.so.cache",
    ]) {
      expect(mounts).toContainEqual({
        mode: "ro-bind-fd",
        childFd: expect.any(Number),
        destination,
        permissions: null,
      });
    }

    const probeReads = harness.bwrapDataReads.filter(
      ({ stage }) => stage === "probe",
    );
    expect(probeReads).toHaveLength(4);
    expect(
      probeReads.find(
        ({ destination }) =>
          destination === "/opt/chainless/plugin/lib/empty.dat",
      ),
    ).toMatchObject({
      bytesRead: 0,
      permissions: "0400",
      sha256: crypto.createHash("sha256").update(emptyContents).digest("hex"),
    });
    expect(
      probeReads.find(
        ({ destination }) => destination === "/opt/chainless/plugin/bin/helper",
      ),
    ).toMatchObject({
      bytesRead: helperContents.length,
      permissions: "0500",
      sha256: crypto.createHash("sha256").update(helperContents).digest("hex"),
    });

    const result = harness.spawnSync(plan.command, plan.args, plan.options);
    expect(result.status).toBe(0);
    expect(
      harness.bwrapDataReads.filter(({ stage }) => stage === "final"),
    ).toHaveLength(4);

    plan.cleanup();
    expect(harness.openFiles.size).toBe(0);
    expect(harness.anonymousFiles.size).toBe(0);
  });

  it.each([
    [
      "same-inode truncate/write",
      (harness) =>
        harness.rewriteFileInPlace(
          harness.entryPath,
          Buffer.from("throw new Error('changed');\n"),
        ),
      true,
    ],
    [
      "rename-over",
      (harness) =>
        harness.replaceFileAtPath(
          harness.entryPath,
          Buffer.from("throw new Error('replacement');\n"),
        ),
      false,
    ],
  ])(
    "keeps the Node entry snapshot stable across %s between plan and spawn",
    (_label, mutateEntry, sameInode) => {
      const harness = createLinuxStrongHarness();
      const originalSha256 = harness.contract.entryIdentity.sha256;
      const originalBytes = harness.contract.entryIdentity.bytes;
      const plan = applyLinuxStrongNodeHarness(harness);

      expect(plan).toMatchObject({
        applied: true,
        runtimeProbe: {
          runnable: true,
          targetRuntime: "node",
          contentSnapshot: true,
          contentSnapshotScope: "plugin-entry-source",
          contentSnapshotMechanism:
            "verified-o_tmpfile-copy-bwrap-ro-bind-data-v1",
          pluginTreeContentSnapshot: true,
          pluginTreeContentSnapshotScope: "all-pinned-plugin-regular-files",
          pluginTreeContentSnapshotMechanism:
            "verified-o_tmpfile-copy-bwrap-ro-bind-data-v1",
          pluginTreeSnapshotConsistency: "per-file-pin-to-launch",
          pluginTreeSnapshotContractBound: false,
          pluginTreeSnapshotAtomic: false,
          handleAtomic: false,
        },
      });
      const mutation = mutateEntry(harness);
      expect(mutation.afterSha256).not.toBe(originalSha256);
      expect(mutation.after.ino === mutation.before.ino).toBe(sameInode);

      const finalResult = harness.spawnSync(
        plan.command,
        plan.args,
        plan.options,
      );

      expect(finalResult.status).toBe(0);
      expect(harness.bwrapDataReads).toHaveLength(4);
      expect(
        harness.bwrapDataReads.find(
          ({ stage, destination }) =>
            stage === "final" &&
            destination === "/opt/chainless/plugin/bin/tool.js",
        ),
      ).toMatchObject({
        destination: "/opt/chainless/plugin/bin/tool.js",
        offsetBefore: 0,
        bytesRead: originalBytes,
        sha256: originalSha256,
        permissions: "0400",
      });
      expect(
        crypto
          .createHash("sha256")
          .update(harness.files.get(harness.entryPath))
          .digest("hex"),
      ).toBe(mutation.afterSha256);

      plan.cleanup();
      plan.cleanup();
      expect(harness.openFiles.size).toBe(0);
      expect(harness.anonymousFiles.size).toBe(0);
    },
  );

  it("recursively binds cyclic second-level DT_NEEDED edges and survives dependency pathname replacement", () => {
    const alpha = createLinuxStaticPieElf64({
      dynamicFlags1: null,
      dynamicNeededNames: ["libbeta.so"],
    });
    const beta = createLinuxStaticPieElf64({
      dynamicFlags1: null,
      dynamicNeededNames: ["libalpha.so"],
    });
    const harness = createLinuxStrongHarness({
      entryRuntime: "native-dynamic-elf",
      nativeEntry: createLinuxStaticPieElf64({
        includeInterp: true,
        interpreterPath: "/lib64/ld-linux.so.2",
        dynamicNeededNames: ["libalpha.so"],
      }),
      lddStdout: [
        "libalpha.so => /lib/libalpha.so (0x1)",
        "libbeta.so => /lib/libbeta.so (0x2)",
        "/lib64/ld-linux.so.2 (0x3)",
      ].join("\n"),
      additionalRuntimeFiles: [
        { path: "/lib/libalpha.so", contents: alpha },
        { path: "/lib/libbeta.so", contents: beta },
      ],
    });
    const plan = applyLinuxStrongNativeHarness(harness);

    expect(plan).toMatchObject({
      applied: true,
      runtimeProbe: {
        initialDynamicLoadClosureDescriptorBound: true,
        initialDynamicDependencyCount: 3,
        initialDynamicRuntimeFileCount: 3,
        sharedLibraryClosure: false,
      },
    });
    const betaMount = linuxBwrapFileMounts(plan.args).find(
      ({ destination }) => destination === "/lib/libbeta.so",
    );
    const betaParentFd = plan.options.stdio[betaMount.childFd];
    const betaBefore = Buffer.from(beta);
    harness.replaceFileAtPath(
      "/lib/libbeta.so",
      createLinuxStaticPieElf64({
        dynamicFlags1: null,
        dynamicRunpath: true,
      }),
    );

    expect(harness.detachedContents.get(betaParentFd)).toEqual(betaBefore);
    expect(harness.files.get("/lib/libbeta.so")).not.toEqual(betaBefore);
    expect(
      harness.spawnSync(plan.command, plan.args, plan.options).status,
    ).toBe(0);

    plan.cleanup();
    expect(harness.openFiles.size).toBe(0);
  });

  it.each([
    [
      "a missing second-level dependency",
      createLinuxStaticPieElf64({
        dynamicFlags1: null,
        dynamicNeededNames: ["libmissing-secondary.so"],
      }),
      "native_dynamic_recursive_dependency_outside_system_graph",
      [
        "libalpha.so => /lib/libalpha.so (0x1)",
        "/lib64/ld-linux.so.2 (0x2)",
      ].join("\n"),
      [],
    ],
    [
      "a second-level DT_RUNPATH directive",
      createLinuxStaticPieElf64({
        dynamicFlags1: null,
        dynamicRunpath: true,
      }),
      "native_dependency_dynamic_loader_directive_unsupported",
      [
        "libalpha.so => /lib/libalpha.so (0x1)",
        "/lib64/ld-linux.so.2 (0x2)",
      ].join("\n"),
      [],
    ],
    [
      "a second-level DT_SONAME alias",
      createLinuxStaticPieElf64({
        dynamicFlags1: null,
        dynamicSoname: "libalias.so",
      }),
      "native_dependency_soname_alias_unsupported",
      [
        "libalpha.so => /lib/libalpha.so (0x1)",
        "/lib64/ld-linux.so.2 (0x2)",
      ].join("\n"),
      [],
    ],
    [
      "an ambiguous second-level basename",
      createLinuxStaticPieElf64({
        dynamicFlags1: null,
        dynamicNeededNames: ["libbeta.so"],
      }),
      "runtime_dependency_resolution_ambiguous",
      [
        "libalpha.so => /lib/libalpha.so (0x1)",
        "libbeta.so => /lib/libbeta.so (0x2)",
        "libbeta.so => /usr/lib/libbeta.so (0x3)",
        "/lib64/ld-linux.so.2 (0x4)",
      ].join("\n"),
      [
        {
          path: "/lib/libbeta.so",
          contents: createLinuxStaticPieElf64({ dynamicFlags1: null }),
        },
        {
          path: "/usr/lib/libbeta.so",
          contents: createLinuxStaticPieElf64({ dynamicFlags1: null }),
        },
      ],
    ],
  ])(
    "fails closed for %s in the recursive native loader graph",
    (_label, alpha, expectedReason, lddStdout, extraFiles) => {
      const harness = createLinuxStrongHarness({
        entryRuntime: "native-dynamic-elf",
        nativeEntry: createLinuxStaticPieElf64({
          includeInterp: true,
          interpreterPath: "/lib64/ld-linux.so.2",
          dynamicNeededNames: ["libalpha.so"],
        }),
        lddStdout,
        additionalRuntimeFiles: [
          { path: "/lib/libalpha.so", contents: alpha },
          ...extraFiles,
        ],
      });
      const plan = applyLinuxStrongNativeHarness(harness);
      const resolutionRejectedBeforePin = expectedReason.startsWith(
        "runtime_dependency_resolution_",
      );

      expect(plan).toMatchObject({
        applied: false,
        backend: null,
        candidateBackend: "linux-bwrap",
        policyAttested: false,
        reason: resolutionRejectedBeforePin
          ? "linux_bwrap_runtime_unattested"
          : "linux_bwrap_native_runtime_unattested",
        guarantees: [],
        runtimeProbe: {
          attempted: false,
          runnable: false,
          reason: expectedReason,
          targetRuntime: "native-dynamic-elf",
          contentSnapshot: false,
          handleAtomic: false,
        },
      });
      expect(
        harness.spawnSync.mock.calls.some(([, spawnArgs]) =>
          spawnArgs?.includes("/opt/chainless/plugin/bin/tool"),
        ),
      ).toBe(false);
      expect(harness.openFiles.size).toBe(0);
    },
  );

  it.each([
    {
      arch: "x64",
      auditArch: 0xc000003e,
      socketSyscall: 41,
      socketpairSyscall: 53,
      syscallMask: 0xbfffffff,
      cloneSyscall: 56,
      deniedSyscalls: [
        47, 299, 438, 304, 272, 308, 165, 166, 155, 428, 429, 430, 431, 432,
        433, 442,
      ],
    },
    {
      arch: "arm64",
      auditArch: 0xc00000b7,
      socketSyscall: 198,
      socketpairSyscall: 199,
      syscallMask: null,
      cloneSyscall: 220,
      deniedSyscalls: [
        212, 243, 438, 265, 97, 268, 40, 39, 41, 428, 429, 430, 431, 432, 433,
        442,
      ],
    },
    {
      arch: "riscv64",
      auditArch: 0xc00000f3,
      socketSyscall: 198,
      socketpairSyscall: 199,
      syscallMask: null,
      cloneSyscall: 220,
      deniedSyscalls: [
        212, 243, 438, 265, 97, 268, 40, 39, 41, 428, 429, 430, 431, 432, 433,
        442,
      ],
    },
  ])(
    "adds loader-FD and nested namespace denials to the dynamic pathname cBPF program for $arch",
    ({
      arch,
      auditArch,
      socketSyscall,
      socketpairSyscall,
      syscallMask,
      cloneSyscall,
      deniedSyscalls,
    }) => {
      const machine = { x64: 62, arm64: 183, riscv64: 243 }[arch];
      const harness = createLinuxStrongHarness({
        entryRuntime: "native-dynamic-elf",
        nativeEntry: createLinuxStaticPieElf64({
          machine,
          includeInterp: true,
          interpreterPath: "/lib64/ld-linux.so.2",
          dynamicNeededNames: ["libc.so.6"],
        }),
        runtimeLibc: createLinuxStaticPieElf64({
          machine,
          dynamicFlags1: null,
        }),
        runtimeLoader: createLinuxStaticPieElf64({
          machine,
          dynamicFlags1: null,
        }),
      });
      const plan = applyLinuxStrongNativeHarness(
        harness,
        ["--label", "ready"],
        arch,
      );

      expect(plan.applied).toBe(true);
      expect(plan.runtimeProbe).toMatchObject({
        targetRuntime: "native-dynamic-elf",
        runtimeSharedLibraryPathnameClosure: true,
        sharedLibraryClosure: false,
      });
      const seccompIndex = plan.args.indexOf("--seccomp");
      const seccompFd = plan.options.stdio[Number(plan.args[seccompIndex + 1])];
      const program = harness.detachedContents.get(seccompFd);
      const decoded = [];
      for (let offset = 0; offset < program.length; offset += 8) {
        decoded.push([
          program.readUInt16LE(offset),
          program.readUInt8(offset + 2),
          program.readUInt8(offset + 3),
          program.readUInt32LE(offset + 4),
        ]);
      }
      expect(decoded).toEqual([
        [0x20, 0, 0, 4],
        [0x15, 1, 0, auditArch],
        [0x06, 0, 0, 0x80000000],
        [0x20, 0, 0, 0],
        ...(syscallMask === null ? [] : [[0x54, 0, 0, syscallMask]]),
        [0x15, 0, 1, socketSyscall],
        [0x06, 0, 0, 0x00050001],
        [0x15, 0, 1, socketpairSyscall],
        [0x06, 0, 0, 0x00050001],
        [0x15, 0, 1, 425],
        [0x06, 0, 0, 0x00050001],
        [0x15, 0, 1, 435],
        [0x06, 0, 0, 0x00050026],
        ...deniedSyscalls.flatMap((syscall) => [
          [0x15, 0, 1, syscall],
          [0x06, 0, 0, 0x00050001],
        ]),
        [0x15, 0, 5, cloneSyscall],
        [0x20, 0, 0, 16],
        [0x54, 0, 0, 0x10020000],
        [0x15, 1, 0, 0],
        [0x06, 0, 0, 0x00050001],
        [0x06, 0, 0, 0x7fff0000],
        [0x06, 0, 0, 0x7fff0000],
      ]);

      const staticHarness = createLinuxStrongHarness({
        entryRuntime: "native-static-elf",
        nativeEntry: createLinuxStaticElf64({ machine }),
      });
      const staticPlan = applyLinuxStrongNativeHarness(
        staticHarness,
        ["--label", "ready"],
        arch,
      );
      expect(staticPlan.applied).toBe(true);
      const staticSeccompIndex = staticPlan.args.indexOf("--seccomp");
      const staticSeccompFd =
        staticPlan.options.stdio[
          Number(staticPlan.args[staticSeccompIndex + 1])
        ];
      const staticProgram = staticHarness.detachedContents.get(staticSeccompFd);
      const runtimePathnameDenialBytes =
        (2 + deniedSyscalls.length * 2 + 6) * 8;
      expect(staticProgram).toEqual(
        Buffer.concat([
          program.subarray(0, program.length - 8 - runtimePathnameDenialBytes),
          program.subarray(program.length - 8),
        ]),
      );

      plan.cleanup();
      staticPlan.cleanup();
      expect(harness.openFiles.size).toBe(0);
      expect(staticHarness.openFiles.size).toBe(0);
    },
  );

  it("binds and hashes ld.so.cache as a pathname-visible load-set member", () => {
    const nativeEntry = createLinuxStaticPieElf64({
      includeInterp: true,
      interpreterPath: "/lib64/ld-linux.so.2",
      dynamicNeededNames: ["libc.so.6"],
    });
    const baselineHarness = createLinuxStrongHarness({
      entryRuntime: "native-dynamic-elf",
      nativeEntry,
    });
    const hostileCacheHarness = createLinuxStrongHarness({
      entryRuntime: "native-dynamic-elf",
      nativeEntry,
    });
    hostileCacheHarness.files.set(
      "/etc/ld.so.cache",
      Buffer.from("cache-entry:/host/unmounted/libhostile.so"),
    );

    const baselinePlan = applyLinuxStrongNativeHarness(baselineHarness);
    const hostileCachePlan = applyLinuxStrongNativeHarness(hostileCacheHarness);

    expect(baselinePlan.applied).toBe(true);
    expect(hostileCachePlan.applied).toBe(true);
    expect(
      linuxBwrapFileMounts(baselinePlan.args).filter(
        ({ destination }) => destination === "/etc/ld.so.cache",
      ),
    ).toHaveLength(1);
    expect(
      baselinePlan.runtimeProbe.runtimeSharedLibraryLoadSetDigest,
    ).not.toBe(hostileCachePlan.runtimeProbe.runtimeSharedLibraryLoadSetDigest);
    expect(baselinePlan.runtimeProbe.runtimeSharedLibraryLoadSetFiles).toBe(
      linuxBwrapFileMounts(baselinePlan.args).length,
    );

    baselinePlan.cleanup();
    hostileCachePlan.cleanup();
    expect(baselineHarness.openFiles.size).toBe(0);
    expect(hostileCacheHarness.openFiles.size).toBe(0);
  });

  it.each([
    [
      "same-inode truncate/write",
      (harness, replacement) =>
        harness.rewriteFileInPlace("/plugin/lib/value.cjs", replacement),
      true,
    ],
    [
      "rename-over",
      (harness, replacement) =>
        harness.replaceFileAtPath("/plugin/lib/value.cjs", replacement),
      false,
    ],
  ])(
    "keeps a Node dependency snapshot stable across %s after planning",
    (_label, mutateDependency, sameInode) => {
      const originalContents = Buffer.from("module.exports = 'original';\n");
      const replacement = Buffer.from("module.exports = 'replacement';\n");
      const originalSha256 = crypto
        .createHash("sha256")
        .update(originalContents)
        .digest("hex");
      const harness = createLinuxStrongHarness({
        nodeDependency: originalContents,
        nodeDependencyMode: 0o100600,
      });
      const plan = applyLinuxStrongNodeHarness(harness);

      expect(plan).toMatchObject({
        applied: true,
        runtimeProbe: {
          contentSnapshot: true,
          contentSnapshotScope: "plugin-entry-source",
          handleAtomic: false,
          pluginTreeContentSnapshot: true,
          pluginTreeContentSnapshotScope: "all-pinned-plugin-regular-files",
          pluginTreeSnapshotConsistency: "per-file-pin-to-launch",
          pluginTreeSnapshotContractBound: false,
          pluginTreeSnapshotAtomic: false,
        },
      });
      const mutation = mutateDependency(harness, replacement);
      expect(mutation.afterSha256).not.toBe(originalSha256);
      expect(mutation.after.ino === mutation.before.ino).toBe(sameInode);

      const result = harness.spawnSync(plan.command, plan.args, plan.options);
      expect(result.status).toBe(0);
      expect(
        harness.bwrapDataReads.find(
          ({ stage, destination }) =>
            stage === "final" &&
            destination === "/opt/chainless/plugin/lib/value.cjs",
        ),
      ).toMatchObject({
        bytesRead: originalContents.length,
        permissions: "0400",
        sha256: originalSha256,
      });
      expect(
        crypto
          .createHash("sha256")
          .update(harness.files.get("/plugin/lib/value.cjs"))
          .digest("hex"),
      ).toBe(mutation.afterSha256);

      plan.cleanup();
      expect(harness.openFiles.size).toBe(0);
      expect(harness.anonymousFiles.size).toBe(0);
    },
  );

  it("snapshots a valid empty Node entry source", () => {
    const harness = createLinuxStrongHarness({
      nodeEntry: Buffer.alloc(0),
    });
    const plan = applyLinuxStrongNodeHarness(harness);

    expect(plan).toMatchObject({
      applied: true,
      policyAttested: true,
      runtimeProbe: {
        runnable: true,
        contentSnapshot: true,
        contentSnapshotScope: "plugin-entry-source",
        contentSnapshotMechanism:
          "verified-o_tmpfile-copy-bwrap-ro-bind-data-v1",
        pluginTreeContentSnapshot: true,
        pluginTreeContentSnapshotFiles: 2,
        pluginTreeSnapshotConsistency: "per-file-pin-to-launch",
        pluginTreeSnapshotContractBound: false,
        pluginTreeSnapshotAtomic: false,
        handleAtomic: false,
      },
    });
    expect(harness.contract.entryIdentity).toMatchObject({
      bytes: 0,
      sha256: crypto.createHash("sha256").update("").digest("hex"),
    });
    expect(harness.bwrapDataReads).toHaveLength(2);
    expect(
      harness.bwrapDataReads.find(
        ({ stage, destination }) =>
          stage === "probe" &&
          destination === "/opt/chainless/plugin/bin/tool.js",
      ),
    ).toMatchObject({
      destination: "/opt/chainless/plugin/bin/tool.js",
      offsetBefore: 0,
      bytesRead: 0,
      permissions: "0400",
    });

    const finalResult = harness.spawnSync(
      plan.command,
      plan.args,
      plan.options,
    );
    expect(finalResult.status).toBe(0);
    expect(harness.bwrapDataReads).toHaveLength(4);
    expect(
      harness.bwrapDataReads.find(
        ({ stage, destination }) =>
          stage === "final" &&
          destination === "/opt/chainless/plugin/bin/tool.js",
      ),
    ).toMatchObject({
      offsetBefore: 0,
      bytesRead: 0,
    });

    plan.cleanup();
    expect(harness.openFiles.size).toBe(0);
    expect(harness.anonymousFiles.size).toBe(0);
  });

  it("keeps the Node v4 digest stable and binds sorted tree membership", () => {
    const alpha = {
      path: "/plugin/lib/alpha.cjs",
      contents: Buffer.from("module.exports = 'alpha';\n"),
      mode: 0o100644,
    };
    const beta = {
      path: "/plugin/lib/beta.cjs",
      contents: Buffer.from("module.exports = 'beta';\n"),
      mode: 0o100755,
    };
    const left = createLinuxStrongHarness({
      additionalPluginFiles: [alpha, beta],
    });
    const right = createLinuxStrongHarness({
      additionalPluginFiles: [beta, alpha],
    });
    for (const filePath of [alpha.path, beta.path]) {
      right.identities.set(filePath, left.identities.get(filePath));
    }
    const temporaryFd = right.fsRuntime.openSync(
      "/tmp",
      right.fsRuntime.constants.O_TMPFILE |
        right.fsRuntime.constants.O_EXCL |
        right.fsRuntime.constants.O_RDWR,
      0o400,
    );
    right.fsRuntime.closeSync(temporaryFd);
    const changedEntry = createLinuxStrongHarness({
      nodeEntry: Buffer.from("require('../lib/value.cjs'); // changed\n"),
      additionalPluginFiles: [alpha, beta],
    });
    const changedDependency = createLinuxStrongHarness({
      nodeDependency: Buffer.from("module.exports = 43;\n"),
      additionalPluginFiles: [alpha, beta],
    });
    const changedPath = createLinuxStrongHarness({
      additionalPluginFiles: [
        alpha,
        {
          ...beta,
          path: "/plugin/lib/renamed-beta.cjs",
        },
      ],
    });
    const changedMode = createLinuxStrongHarness({
      additionalPluginFiles: [
        {
          ...alpha,
          mode: 0o100744,
        },
        beta,
      ],
    });

    const leftPlan = applyLinuxStrongNodeHarness(left);
    const rightPlan = applyLinuxStrongNodeHarness(right);
    const changedPlans = [
      applyLinuxStrongNodeHarness(changedEntry),
      applyLinuxStrongNodeHarness(changedDependency),
      applyLinuxStrongNodeHarness(changedPath),
      applyLinuxStrongNodeHarness(changedMode),
    ];

    expect(leftPlan.applied).toBe(true);
    expect(rightPlan.applied).toBe(true);
    expect(changedPlans.every(({ applied }) => applied)).toBe(true);
    expect(leftPlan.policyDigest).toBe(rightPlan.policyDigest);
    expect(leftPlan.runtimeProbe.pluginTreeContentSnapshotDigest).toBe(
      rightPlan.runtimeProbe.pluginTreeContentSnapshotDigest,
    );
    for (const changedPlan of changedPlans) {
      expect(changedPlan.policyDigest).not.toBe(leftPlan.policyDigest);
      expect(changedPlan.runtimeProbe.pluginTreeContentSnapshotDigest).not.toBe(
        leftPlan.runtimeProbe.pluginTreeContentSnapshotDigest,
      );
    }
    expect(leftPlan.runtimeProbe).toMatchObject({
      contentSnapshot: true,
      contentSnapshotScope: "plugin-entry-source",
      contentSnapshotMechanism: "verified-o_tmpfile-copy-bwrap-ro-bind-data-v1",
      pluginTreeContentSnapshot: true,
      pluginTreeContentSnapshotScope: "all-pinned-plugin-regular-files",
      pluginTreeContentSnapshotMechanism:
        "verified-o_tmpfile-copy-bwrap-ro-bind-data-v1",
      pluginTreeContentSnapshotFiles: 4,
      pluginTreeContentSnapshotDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      pluginTreeSnapshotConsistency: "per-file-pin-to-launch",
      pluginTreeSnapshotContractBound: false,
      pluginTreeSnapshotAtomic: false,
      handleAtomic: false,
    });

    leftPlan.cleanup();
    rightPlan.cleanup();
    for (const changedPlan of changedPlans) changedPlan.cleanup();
    expect(left.openFiles.size).toBe(0);
    expect(right.openFiles.size).toBe(0);
    for (const changedHarness of [
      changedEntry,
      changedDependency,
      changedPath,
      changedMode,
    ]) {
      expect(changedHarness.openFiles.size).toBe(0);
      expect(changedHarness.anonymousFiles.size).toBe(0);
    }
  });

  it.each([
    [
      "source changes during verified copy",
      { tamperNodeSourceDuringSnapshotCopy: true },
    ],
    ["copied bytes change before sealing", { tamperNodeSnapshot: true }],
    ["O_TMPFILE creation is denied", { failNodeSnapshotTmpfileOpen: true }],
    ["read-only OFDs cannot be reopened", { failNodeSnapshotReopen: true }],
    [
      "writer close result is unavailable",
      { failNodeSnapshotWriterClose: true },
    ],
  ])("fails closed when the Node entry snapshot %s", (_label, options) => {
    const harness = createLinuxStrongHarness(options);
    const plan = applyLinuxStrongNodeHarness(harness);

    expect(plan).toMatchObject({
      applied: false,
      backend: null,
      candidateBackend: "linux-bwrap",
      policyAttested: false,
      reason: "linux_bwrap_plugin_snapshot_unattested",
      guarantees: [],
      runtimeProbe: {
        kind: "linux-bwrap-plugin-node-policy-v1",
        attempted: false,
        runnable: false,
        targetRuntime: "node",
        contentSnapshot: false,
        handleAtomic: false,
      },
    });
    expect(
      harness.spawnSync.mock.calls.filter(
        ([command, probeArgs]) =>
          harness.isBwrapCommand(command) && probeArgs?.[0] !== "--help",
      ),
    ).toHaveLength(0);
    expect(harness.openFiles.size).toBe(0);
    expect(harness.anonymousFiles.size).toBe(0);
    if (options.failNodeSnapshotWriterClose) {
      expect(harness.nodeSnapshotWriterCloseErrors).toHaveLength(1);
      const [failedFd] = harness.nodeSnapshotWriterCloseErrors;
      expect(
        harness.fsRuntime.closeSync.mock.calls.filter(
          ([closedFd]) => closedFd === failedFd,
        ),
      ).toHaveLength(1);
    }
  });

  it.each([
    [
      "regular-file count exceeds 256",
      {
        additionalPluginFiles: Array.from({ length: 255 }, (_, index) => ({
          path: `/plugin/lib/count-${String(index).padStart(3, "0")}.dat`,
          contents: Buffer.from([index % 251]),
          mode: 0o100644,
        })),
      },
      /(?:plugin_tree|snapshot).*(?:file|count|large|limit)/,
    ],
    [
      "aggregate bytes exceed 256 MiB",
      {
        additionalPluginFiles: [
          {
            path: "/plugin/lib/reported-large.dat",
            contents: Buffer.from("small fake backing"),
            mode: 0o100644,
            reportedSize: 256 * 1024 * 1024,
          },
        ],
      },
      /(?:plugin_tree|snapshot).*(?:byte|size|large|limit)/,
    ],
  ])("fails closed when Node plugin tree %s", (_label, options, reason) => {
    const harness = createLinuxStrongHarness(options);
    const plan = applyLinuxStrongNodeHarness(harness);

    expect(plan).toMatchObject({
      applied: false,
      backend: null,
      candidateBackend: "linux-bwrap",
      policyAttested: false,
      reason: "linux_bwrap_plugin_snapshot_unattested",
      guarantees: [],
      runtimeProbe: {
        kind: "linux-bwrap-plugin-node-policy-v1",
        attempted: false,
        runnable: false,
        targetRuntime: "node",
        contentSnapshot: false,
        handleAtomic: false,
      },
    });
    expect(plan.runtimeProbe.reason).toMatch(reason);
    expect(
      harness.spawnSync.mock.calls.filter(([command]) =>
        harness.isBwrapCommand(command),
      ),
    ).toHaveLength(0);
    expect(harness.openFiles.size).toBe(0);
    expect(harness.anonymousFiles.size).toBe(0);
  });

  it("releases every prior tree snapshot when a middle snapshot fails", () => {
    const failingContents = Buffer.from("fail this snapshot reopen\n");
    const harness = createLinuxStrongHarness({
      additionalPluginFiles: [
        {
          path: "/plugin/lib/a-first.dat",
          contents: Buffer.from("first snapshot succeeds\n"),
          mode: 0o100644,
        },
        {
          path: "/plugin/lib/b-fail.dat",
          contents: failingContents,
          mode: 0o100755,
        },
        {
          path: "/plugin/lib/c-never.dat",
          contents: Buffer.from("later member\n"),
          mode: 0o100644,
        },
      ],
      failSnapshotReopenForContents: failingContents,
    });
    const plan = applyLinuxStrongNodeHarness(harness);

    expect(plan).toMatchObject({
      applied: false,
      backend: null,
      candidateBackend: "linux-bwrap",
      policyAttested: false,
      reason: "linux_bwrap_plugin_snapshot_unattested",
      guarantees: [],
      runtimeProbe: {
        attempted: false,
        runnable: false,
        targetRuntime: "node",
        contentSnapshot: false,
        handleAtomic: false,
      },
    });
    expect(plan.runtimeProbe.reason).toMatch(
      /node_plugin_tree_snapshot.*reopen/,
    );
    const snapshotTmpfileOpens = harness.fsRuntime.openSync.mock.calls.filter(
      ([value, flags]) =>
        value === "/tmp" &&
        (Number(flags) & harness.fsRuntime.constants.O_TMPFILE) ===
          harness.fsRuntime.constants.O_TMPFILE,
    );
    expect(snapshotTmpfileOpens.length).toBeGreaterThanOrEqual(2);
    expect(
      harness.spawnSync.mock.calls.filter(([command]) =>
        harness.isBwrapCommand(command),
      ),
    ).toHaveLength(0);
    expect(harness.openFiles.size).toBe(0);
    expect(harness.anonymousFiles.size).toBe(0);
    const closedFds = harness.fsRuntime.closeSync.mock.calls.map(([fd]) => fd);
    expect(new Set(closedFds).size).toBe(closedFds.length);
  });

  it("fails closed when the Node snapshot changes after the policy probe", () => {
    const harness = createLinuxStrongHarness({
      tamperNodeSnapshotAfterProbe: true,
    });
    const plan = applyLinuxStrongNodeHarness(harness);

    expect(plan).toMatchObject({
      applied: false,
      backend: null,
      candidateBackend: "linux-bwrap",
      policyAttested: false,
      reason: "linux_bwrap_execution_contract_changed",
      guarantees: [],
      runtimeProbe: {
        kind: "linux-bwrap-plugin-node-policy-v1",
        attempted: true,
        runnable: false,
        targetRuntime: "node",
        contentSnapshot: false,
        handleAtomic: false,
      },
    });
    expect(plan.runtimeProbe.reason).toMatch(
      /^post_probe_.*entry_snapshot_identity_changed$/,
    );
    expect(harness.bwrapDataReads).toHaveLength(2);
    expect(harness.openFiles.size).toBe(0);
    expect(harness.anonymousFiles.size).toBe(0);
  });

  it("releases both Node snapshot readers when the policy probe fails", () => {
    const harness = createLinuxStrongHarness({ bwrapStatus: 1 });
    const plan = applyLinuxStrongNodeHarness(harness);

    expect(plan).toMatchObject({
      applied: false,
      reason: "linux_bwrap_policy_probe_failed",
      runtimeProbe: {
        attempted: true,
        runnable: false,
        reason: "probe_failed",
        targetRuntime: "node",
        contentSnapshot: false,
        handleAtomic: false,
      },
    });
    expect(harness.bwrapDataReads).toHaveLength(2);
    expect(harness.openFiles.size).toBe(0);
    expect(harness.anonymousFiles.size).toBe(0);
  });

  it("classifies a failed detached child descriptor report without exposing stderr", () => {
    const harness = createLinuxStrongHarness({ bwrapStatus: 86 });
    const plan = applyLinuxStrongNodeHarness(harness);

    expect(plan).toMatchObject({
      applied: false,
      reason: "linux_bwrap_policy_probe_failed",
      runtimeProbe: {
        attempted: true,
        runnable: false,
        reason: "detached_child_runtime_probe_failed",
        runtimeDetachedChildSpawnVerified: false,
      },
    });
    expect(harness.openFiles.size).toBe(0);
    expect(harness.anonymousFiles.size).toBe(0);
  });

  it("preserves full-width bwrap device and inode identity evidence", () => {
    const bwrapDevice = 9_007_199_254_740_993n;
    const bwrapInode = 9_007_199_254_740_995n;
    const harness = createLinuxStrongHarness({
      bwrapDevice,
      bwrapInode,
    });
    const plan = applyLinuxStrongNodeHarness(harness);

    expect(plan).toMatchObject({
      applied: true,
      policyAttested: true,
      runtimeProbe: {
        runnable: true,
        supervisorExecutableIdentity: {
          fileId: {
            dev: String(bwrapDevice),
            ino: String(bwrapInode),
          },
        },
      },
    });
    expect(
      harness.bwrapInvocations.every(
        ({ sourceFileId }) =>
          sourceFileId.dev === String(bwrapDevice) &&
          sourceFileId.ino === String(bwrapInode),
      ),
    ).toBe(true);

    const sourceOpenIndex = harness.fsRuntime.openSync.mock.calls.findIndex(
      ([value]) => value === "/usr/bin/bwrap",
    );
    const sourceFd =
      harness.fsRuntime.openSync.mock.results[sourceOpenIndex]?.value;
    const supervisorFds = new Set([sourceFd]);
    harness.fsRuntime.openSync.mock.calls.forEach(([value], index) => {
      if (value === `/proc/self/fd/${sourceFd}`) {
        supervisorFds.add(harness.fsRuntime.openSync.mock.results[index].value);
      }
    });
    expect(supervisorFds.size).toBe(4);
    const supervisorStats = harness.fsRuntime.fstatSync.mock.calls.filter(
      ([fd]) => supervisorFds.has(fd),
    );
    expect(supervisorStats.length).toBeGreaterThanOrEqual(8);
    expect(
      supervisorStats.every(([, options]) => options?.bigint === true),
    ).toBe(true);
    expect(harness.fsRuntime.lstatSync).toHaveBeenCalledWith("/usr/bin/bwrap", {
      bigint: true,
    });
    expect(harness.fsRuntime.statSync).toHaveBeenCalledWith("/usr/bin/bwrap", {
      bigint: true,
    });
    const policyProbeInvocation = harness.bwrapInvocations.find(
      ({ stage }) => stage === "probe",
    );
    expect(policyProbeInvocation.args.join("\n")).toContain(
      "fstatSync(Number(name), { bigint: true })",
    );

    plan.cleanup();
    expect(harness.openFiles.size).toBe(0);
  });

  it("builds an attested bwrap plan for one direct static ELF native bin", () => {
    const harness = createLinuxStrongHarness({
      entryRuntime: "native-static-elf",
    });
    const plan = applyLinuxStrongNativeHarness(harness);

    expect(harness.contract.kind).toBe("strict-plugin-native-static-elf-bin");
    expect(plan).toMatchObject({
      applied: true,
      backend: "linux-bwrap",
      enforcement: "linux-bwrap",
      policyAttested: true,
      reason: null,
      guarantees: [
        SANDBOX_BOUNDARIES.FILESYSTEM,
        SANDBOX_BOUNDARIES.NETWORK,
        SANDBOX_BOUNDARIES.PROCESS_TREE,
      ],
      runtimeProbe: {
        kind: "linux-bwrap-plugin-native-static-elf-policy-v1",
        attempted: true,
        runnable: true,
        reason: null,
        probeRuntime: "node",
        targetRuntime: "native-static-elf",
        contentSnapshot: true,
        contentSnapshotScope: "plugin-entry-executable",
        contentSnapshotMechanism:
          "verified-o_tmpfile-copy-bwrap-ro-bind-data-v1",
        pluginTreeContentSnapshot: true,
        pluginTreeContentSnapshotScope: "all-pinned-plugin-regular-files",
        pluginTreeContentSnapshotMechanism:
          "verified-o_tmpfile-copy-bwrap-ro-bind-data-v1",
        pluginTreeContentSnapshotFiles: 2,
        pluginTreeContentSnapshotBytes:
          harness.contract.entryIdentity.bytes +
          harness.files.get("/plugin/lib/value.cjs").length,
        pluginTreeContentSnapshotDigest:
          expect.stringMatching(/^[a-f0-9]{64}$/),
        pluginTreeSnapshotConsistency: "per-file-pin-to-launch",
        pluginTreeSnapshotContractBound: false,
        pluginTreeSnapshotAtomic: false,
        supervisorDescriptorBound: true,
        supervisorDescriptorBindingMechanism:
          "pinned-child-fd3-file-consume-run-overmount-v1",
        supervisorExecutableIdentity: {
          path: "/usr/bin/bwrap",
          sha256: harness.originalBwrapSha256,
        },
        handleAtomic: false,
      },
    });
    const scrubbedLaunch = parseLinuxBwrapDescriptorScrubbedLaunch(
      plan.command,
      plan.args,
      plan.options,
    );
    expect(scrubbedLaunch).not.toBeNull();
    expect(scrubbedLaunch.executableChildFd).toBe(3);
    const bwrapArgs = scrubbedLaunch.executableArgs;
    expectLinuxBwrapSupervisorPolicy(bwrapArgs);
    expectLinuxBwrapSupervisorInvocations(harness, ["capability", "probe"]);
    expect(plan.options.stdio[3]).not.toBe(
      harness.bwrapInvocations[0].parentFd,
    );
    expect(plan.options.stdio[3]).not.toBe(
      harness.bwrapInvocations[1].parentFd,
    );
    expect(harness.fdOffsets.get(plan.options.stdio[3])).toBe(0);
    const entryDataIndex = bwrapArgs.findIndex(
      (value, index) =>
        value === "--ro-bind-data" &&
        bwrapArgs[index + 2] === "/opt/chainless/plugin/bin/tool",
    );
    expect(bwrapArgs.slice(entryDataIndex - 2, entryDataIndex + 3)).toEqual([
      "--perms",
      "0500",
      "--ro-bind-data",
      expect.any(String),
      "/opt/chainless/plugin/bin/tool",
    ]);
    const nativeMounts = linuxBwrapFileMounts(bwrapArgs);
    expect(nativeMounts.filter(({ mode }) => mode === "ro-bind-data")).toEqual(
      expect.arrayContaining([
        {
          mode: "ro-bind-data",
          childFd: expect.any(Number),
          destination: "/opt/chainless/plugin/bin/tool",
          permissions: "0500",
        },
        {
          mode: "ro-bind-data",
          childFd: expect.any(Number),
          destination: "/opt/chainless/plugin/lib/value.cjs",
          permissions: "0400",
        },
      ]),
    );
    expect(bwrapArgs.slice(-4)).toEqual([
      "--",
      "/opt/chainless/plugin/bin/tool",
      "--label",
      "ready",
    ]);
    expect(bwrapArgs.join("\0")).not.toContain("LD_LIBRARY_PATH");
    expect(harness.lddInspectionSources).toEqual(["/runtime/node"]);
    const policyProbeArgs = harness.bwrapInvocations.find(
      ({ stage }) => stage === "probe",
    ).args;
    const probeSeparator = policyProbeArgs.lastIndexOf("--");
    expect(
      policyProbeArgs.slice(probeSeparator + 1, probeSeparator + 3),
    ).toEqual(["/opt/chainless/runtime/node", "-e"]);
    expect(
      policyProbeArgs
        .slice(probeSeparator + 1)
        .includes("/opt/chainless/plugin/bin/tool"),
    ).toBe(false);
    expect(harness.bwrapDataReads).toHaveLength(2);
    const probeSnapshotRead = harness.bwrapDataReads.find(
      ({ stage, destination }) =>
        stage === "probe" && destination === "/opt/chainless/plugin/bin/tool",
    );
    expect(probeSnapshotRead).toMatchObject({
      destination: "/opt/chainless/plugin/bin/tool",
      offsetBefore: 0,
      bytesRead: harness.contract.entryIdentity.bytes,
      sha256: harness.contract.entryIdentity.sha256,
      permissions: "0500",
    });
    expect(
      probeSnapshotRead.flags & harness.fsRuntime.constants.O_ACCMODE,
    ).toBe(harness.fsRuntime.constants.O_RDONLY);
    const finalSnapshotChildFd = Number(bwrapArgs[entryDataIndex + 1]);
    const finalSnapshotFd = plan.options.stdio[finalSnapshotChildFd];
    expect(finalSnapshotFd).not.toBe(probeSnapshotRead.parentFd);
    expect(harness.fdOffsets.get(finalSnapshotFd)).toBe(0);
    expect(
      harness.openFlags.get(finalSnapshotFd) &
        harness.fsRuntime.constants.O_ACCMODE,
    ).toBe(harness.fsRuntime.constants.O_RDONLY);
    const finalSnapshotPath = harness.openFiles.get(finalSnapshotFd);
    expect(finalSnapshotPath).toBe(probeSnapshotRead.sourcePath);
    expect(harness.statFor(finalSnapshotPath)).toMatchObject({
      nlink: 0,
      mode: 0o100400,
      size: harness.contract.entryIdentity.bytes,
    });
    expect([...harness.openFiles.values()]).not.toContain(harness.entryPath);
    expect(harness.openFiles.size).toBeGreaterThan(0);

    const finalResult = harness.spawnSync(
      plan.command,
      plan.args,
      plan.options,
    );
    expect(finalResult.status).toBe(0);
    expectLinuxBwrapSupervisorInvocations(harness, [
      "capability",
      "probe",
      "final",
    ]);
    expect(harness.bwrapDataReads).toHaveLength(4);
    expect(
      harness.bwrapDataReads.find(
        ({ stage, destination }) =>
          stage === "final" && destination === "/opt/chainless/plugin/bin/tool",
      ),
    ).toMatchObject({
      parentFd: finalSnapshotFd,
      sourcePath: finalSnapshotPath,
      destination: "/opt/chainless/plugin/bin/tool",
      offsetBefore: 0,
      bytesRead: harness.contract.entryIdentity.bytes,
      sha256: harness.contract.entryIdentity.sha256,
      permissions: "0500",
    });

    plan.cleanup();
    plan.cleanup();
    expect(harness.openFiles.size).toBe(0);
    expect(harness.anonymousFiles.size).toBe(0);
  });

  it("materializes and seals every native plugin file before launch", () => {
    const dependencyContents = Buffer.from("ORIGINAL_NATIVE_DATA\n");
    const replacementContents = Buffer.from("REPLACEMENT_NATIVE_DATA\n");
    const helperContents = Buffer.from("native helper bytes\n");
    const harness = createLinuxStrongHarness({
      entryRuntime: "native-static-elf",
      nodeDependency: dependencyContents,
      nodeDependencyMode: 0o100600,
      additionalPluginFiles: [
        {
          path: "/plugin/assets/empty.dat",
          contents: Buffer.alloc(0),
          mode: 0o100444,
        },
        {
          path: "/plugin/bin/helper",
          contents: helperContents,
          mode: 0o100010,
        },
      ],
    });
    const plan = applyLinuxStrongNativeHarness(harness);
    const expectedBytes =
      harness.contract.entryIdentity.bytes +
      dependencyContents.length +
      helperContents.length;

    expect(plan).toMatchObject({
      applied: true,
      policyAttested: true,
      runtimeProbe: {
        runnable: true,
        targetRuntime: "native-static-elf",
        contentSnapshot: true,
        pluginTreeContentSnapshot: true,
        pluginTreeContentSnapshotScope: "all-pinned-plugin-regular-files",
        pluginTreeContentSnapshotMechanism:
          "verified-o_tmpfile-copy-bwrap-ro-bind-data-v1",
        pluginTreeContentSnapshotFiles: 4,
        pluginTreeContentSnapshotBytes: expectedBytes,
        pluginTreeContentSnapshotDigest:
          expect.stringMatching(/^[a-f0-9]{64}$/),
        pluginTreeSnapshotConsistency: "per-file-pin-to-launch",
        pluginTreeSnapshotContractBound: false,
        pluginTreeSnapshotAtomic: false,
        handleAtomic: false,
      },
    });

    expect(
      linuxBwrapFileMounts(plan.args)
        .filter(({ destination }) =>
          destination.startsWith("/opt/chainless/plugin/"),
        )
        .map(({ mode, destination, permissions }) => ({
          mode,
          destination,
          permissions,
        }))
        .sort((left, right) =>
          left.destination.localeCompare(right.destination),
        ),
    ).toEqual([
      {
        mode: "ro-bind-data",
        destination: "/opt/chainless/plugin/assets/empty.dat",
        permissions: "0400",
      },
      {
        mode: "ro-bind-data",
        destination: "/opt/chainless/plugin/bin/helper",
        permissions: "0500",
      },
      {
        mode: "ro-bind-data",
        destination: "/opt/chainless/plugin/bin/tool",
        permissions: "0500",
      },
      {
        mode: "ro-bind-data",
        destination: "/opt/chainless/plugin/lib/value.cjs",
        permissions: "0400",
      },
    ]);
    expect(
      harness.bwrapDataReads.filter(({ stage }) => stage === "probe"),
    ).toHaveLength(4);

    const mutation = harness.rewriteFileInPlace(
      "/plugin/lib/value.cjs",
      replacementContents,
    );
    expect(mutation.after.ino).toBe(mutation.before.ino);
    expect(mutation.afterSha256).not.toBe(mutation.beforeSha256);

    const result = harness.spawnSync(plan.command, plan.args, plan.options);
    expect(result.status).toBe(0);
    expect(
      harness.bwrapDataReads.find(
        ({ stage, destination }) =>
          stage === "final" &&
          destination === "/opt/chainless/plugin/lib/value.cjs",
      ),
    ).toMatchObject({
      bytesRead: dependencyContents.length,
      permissions: "0400",
      sha256: crypto
        .createHash("sha256")
        .update(dependencyContents)
        .digest("hex"),
    });
    expect([...harness.openFiles.values()]).not.toContain(
      "/plugin/lib/value.cjs",
    );

    plan.cleanup();
    expect(harness.openFiles.size).toBe(0);
    expect(harness.anonymousFiles.size).toBe(0);
  });

  it.each([
    ["Plugin Node", "node"],
    ["static ELF native", "native-static-elf"],
  ])(
    "keeps the descriptor-pinned bwrap supervisor stable when its path is replaced for %s",
    (_label, entryRuntime) => {
      const harness = createLinuxStrongHarness({ entryRuntime });
      const originalSpawnSync = harness.spawnSync.getMockImplementation();
      let replacement;
      harness.spawnSync.mockImplementation((command, args, options) => {
        const scrubbedLaunch = parseLinuxBwrapDescriptorScrubbedLaunch(
          command,
          args,
          options,
        );
        if (
          !replacement &&
          scrubbedLaunch?.executableChildFd === 3 &&
          scrubbedLaunch.executableArgs[0] === "--help"
        ) {
          replacement = harness.replaceFileAtPath(
            "/usr/bin/bwrap",
            Buffer.from("replacement-bwrap-binary"),
          );
        }
        return originalSpawnSync(command, args, options);
      });

      const plan =
        entryRuntime === "native-static-elf"
          ? applyLinuxStrongNativeHarness(harness)
          : applyLinuxStrongNodeHarness(harness);

      expect(replacement).toMatchObject({
        beforeSha256: harness.originalBwrapSha256,
      });
      expect(plan).toMatchObject({
        applied: true,
        runtimeProbe: {
          runnable: true,
          targetRuntime: entryRuntime,
          supervisorDescriptorBound: true,
          handleAtomic: false,
        },
      });
      expect(replacement.after.ino).not.toBe(replacement.before.ino);
      expect(replacement.afterSha256).not.toBe(replacement.beforeSha256);
      const finalLaunch = parseLinuxBwrapDescriptorScrubbedLaunch(
        plan.command,
        plan.args,
        plan.options,
      );
      expect(finalLaunch).not.toBeNull();
      expectLinuxBwrapSupervisorPolicy(finalLaunch.executableArgs);
      expectLinuxBwrapSupervisorInvocations(harness, ["capability", "probe"]);
      expect(
        harness.bwrapInvocations.every(
          ({ sourceFileId }) =>
            sourceFileId.ino === String(replacement.before.ino),
        ),
      ).toBe(true);
      expect(
        harness.bwrapInvocations.every(
          ({ sourceNlink, sourceCtimeMs }) =>
            sourceNlink === 0 &&
            sourceCtimeMs === Number(replacement.before.ctimeMs) + 1,
        ),
      ).toBe(true);
      expect(
        harness.bwrapInvocations.some(
          ({ command }) => command === "/usr/bin/bwrap",
        ),
      ).toBe(false);

      const finalResult = harness.spawnSync(
        plan.command,
        plan.args,
        plan.options,
      );

      expect(finalResult.status).toBe(0);
      expectLinuxBwrapSupervisorInvocations(harness, [
        "capability",
        "probe",
        "final",
      ]);
      expect(
        harness.bwrapInvocations.every(
          ({ sourceFileId }) =>
            sourceFileId.ino === String(replacement.before.ino),
        ),
      ).toBe(true);
      expect(harness.statFor("/usr/bin/bwrap").ino).toBe(replacement.after.ino);

      plan.cleanup();
      plan.cleanup();
      expect(harness.openFiles.size).toBe(0);
      expect(harness.anonymousFiles.size).toBe(0);
    },
  );

  it("builds the same attested bwrap plan for a narrow static PIE native bin", () => {
    const harness = createLinuxStrongHarness({
      entryRuntime: "native-static-elf",
      nativeEntry: createLinuxStaticPieElf64(),
    });
    const plan = applyLinuxStrongNativeHarness(harness);

    expect(plan).toMatchObject({
      applied: true,
      backend: "linux-bwrap",
      enforcement: "linux-bwrap",
      policyAttested: true,
      reason: null,
      guarantees: [
        SANDBOX_BOUNDARIES.FILESYSTEM,
        SANDBOX_BOUNDARIES.NETWORK,
        SANDBOX_BOUNDARIES.PROCESS_TREE,
      ],
      runtimeProbe: {
        kind: "linux-bwrap-plugin-native-static-elf-policy-v1",
        attempted: true,
        runnable: true,
        reason: null,
        probeRuntime: "node",
        targetRuntime: "native-static-elf",
        contentSnapshot: true,
        contentSnapshotScope: "plugin-entry-executable",
        contentSnapshotMechanism:
          "verified-o_tmpfile-copy-bwrap-ro-bind-data-v1",
        handleAtomic: false,
      },
    });
    expect(plan.args.slice(-4)).toEqual([
      "--",
      "/opt/chainless/plugin/bin/tool",
      "--label",
      "ready",
    ]);
    expect(harness.lddInspectionSources).toEqual(["/runtime/node"]);
    expect(plan.policyDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(harness.openFiles.size).toBeGreaterThan(0);

    plan.cleanup();
    expect(harness.openFiles.size).toBe(0);
  });

  it.each([
    ["dynamic PIE ET_DYN", {}],
    ["dynamic non-PIE ET_EXEC", { elfType: 2, dynamicFlags1: null }],
  ])(
    "binds a %s interpreter and recursive DT_NEEDED graph to pinned trusted runtime files",
    (_label, elfOptions) => {
      const harness = createLinuxStrongHarness({
        entryRuntime: "native-dynamic-elf",
        nativeEntry: createLinuxStaticPieElf64({
          ...elfOptions,
          includeInterp: true,
          interpreterPath: "/lib64/ld-linux.so.2",
          dynamicNeededNames: ["libc.so.6"],
        }),
      });
      const plan = applyLinuxStrongNativeHarness(harness);

      expect(harness.contract.kind).toBe("strict-plugin-native-elf-bin");
      expect(plan).toMatchObject({
        applied: true,
        backend: "linux-bwrap",
        enforcement: "linux-bwrap",
        policyAttested: true,
        reason: null,
        guarantees: [
          SANDBOX_BOUNDARIES.FILESYSTEM,
          SANDBOX_BOUNDARIES.NETWORK,
          SANDBOX_BOUNDARIES.PROCESS_TREE,
        ],
        runtimeProbe: {
          kind: "linux-bwrap-plugin-native-dynamic-elf-policy-v1",
          attempted: true,
          runnable: true,
          reason: null,
          probeRuntime: "node",
          targetRuntime: "native-dynamic-elf",
          contentSnapshot: true,
          contentSnapshotScope: "plugin-entry-executable",
          initialDynamicLoadClosureDescriptorBound: true,
          initialDynamicLoadClosureScope:
            "initial-pt_interp-and-recursive-dt_needed-attested-system-graph",
          initialDynamicLoadClosureMechanism:
            "recursive-parsed-elf-system-graph-to-attested-runtime-fds-v1",
          initialDynamicInterpreter: "/lib64/ld-linux.so.2",
          initialDynamicDependencyCount: 1,
          initialDynamicRuntimeFileCount: 2,
          initialDynamicRuntimeBytes: expect.any(Number),
          initialDynamicLoadClosureDigest:
            expect.stringMatching(/^[a-f0-9]{64}$/),
          sharedLibraryClosure: false,
          runtimeSharedLibraryPathnameClosure: true,
          runtimeSharedLibraryPathnameClosureExcludes:
            "anonymous-jit-and-custom-in-process-loader",
          runtimeSharedLibraryClosureScope:
            "all-pathname-visible-regular-files-in-read-only-bwrap-namespace",
          runtimeSharedLibraryClosureMechanism:
            "descriptor-pinned-hashed-ro-mount-set-plus-loader-fd-and-namespace-mutation-seccomp-v2",
          runtimeSharedLibraryLoadSetFiles: expect.any(Number),
          runtimeSharedLibraryLoadSetBytes: expect.any(Number),
          runtimeSharedLibraryLoadSetDigest:
            expect.stringMatching(/^[a-f0-9]{64}$/),
          runtimeLoadSetPolicyBound: true,
          runtimeWritableFilesystems: false,
          runtimeProcfsMounted: false,
          runtimeDevfsMounted: false,
          runtimeScratchWritable: false,
          runtimeDescriptorReopenPaths: false,
          supervisorPid1ExecutableExposure: "procfs-not-mounted",
          handleAtomic: false,
        },
      });
      expect(plan.args.slice(-4)).toEqual([
        "--",
        "/opt/chainless/plugin/bin/tool",
        "--label",
        "ready",
      ]);
      expect(plan.runtimeProbe.initialDynamicRuntimeBytes).toBe(
        harness.files.get("/lib/libc.so.6").length +
          harness.files.get("/lib64/ld-linux.so.2").length,
      );
      expect(linuxBwrapFileMounts(plan.args)).toEqual(
        expect.arrayContaining([
          {
            mode: "ro-bind-fd",
            childFd: expect.any(Number),
            destination: "/lib/libc.so.6",
            permissions: null,
          },
          {
            mode: "ro-bind-fd",
            childFd: expect.any(Number),
            destination: "/lib64/ld-linux.so.2",
            permissions: null,
          },
          {
            mode: "ro-bind-data",
            childFd: expect.any(Number),
            destination: "/opt/chainless/plugin/bin/tool",
            permissions: "0500",
          },
          {
            mode: "ro-bind-data",
            childFd: expect.any(Number),
            destination: "/opt/chainless/runtime/node",
            permissions: "0500",
          },
        ]),
      );
      expect(harness.lddInspectionSources).toEqual(["/runtime/node"]);
      expect(harness.lddInspectionSources.includes(harness.entryPath)).toBe(
        false,
      );
      const finalLaunch = parseLinuxBwrapDescriptorScrubbedLaunch(
        plan.command,
        plan.args,
        plan.options,
      );
      expect(finalLaunch).not.toBeNull();
      const bwrapArgs = finalLaunch.executableArgs;
      expect(bwrapArgs.join("\0")).not.toContain("LD_LIBRARY_PATH");
      const targetSeparator = bwrapArgs.indexOf("--");
      const finalPolicyArgs = bwrapArgs.slice(0, targetSeparator);
      const policyTargets = (option) =>
        finalPolicyArgs.flatMap((value, index) =>
          value === option ? [finalPolicyArgs[index + 1]] : [],
        );
      expect(policyTargets("--tmpfs")).toEqual(["/run"]);
      expect(policyTargets("--remount-ro")).toEqual(["/", "/run"]);
      expect(finalPolicyArgs).not.toContain("--proc");
      expect(finalPolicyArgs).not.toContain("--dev");
      expect(finalPolicyArgs).not.toContain("--bind");
      expect(finalPolicyArgs).not.toContain("--dev-bind");
      expect(finalPolicyArgs.indexOf("--remount-ro")).toBeLessThan(
        finalPolicyArgs.indexOf("--tmpfs"),
      );
      const probeInvocation = harness.bwrapInvocations.find(
        ({ stage }) => stage === "probe",
      );
      const probeSeparator = probeInvocation.args.indexOf("--");
      expect(probeInvocation.args.slice(0, probeSeparator)).toEqual(
        finalPolicyArgs,
      );
      expect(probeInvocation.args.join("\n")).toContain(
        "chainless-linux-bwrap-native-runtime-pathname-closure-v1",
      );
      expect(probeInvocation.args.join("\n")).toContain('"/proc/self/fd/0"');
      expect(plan.runtimeProbe.runtimeSharedLibraryLoadSetFiles).toBe(
        linuxBwrapFileMounts(bwrapArgs).length,
      );

      plan.cleanup();
      expect(harness.openFiles.size).toBe(0);
    },
  );

  it("keeps the visible dynamic probe Node runtime on an immutable snapshot across a same-inode host rewrite", () => {
    const harness = createLinuxStrongHarness({
      entryRuntime: "native-dynamic-elf",
      nativeEntry: createLinuxStaticPieElf64({
        includeInterp: true,
        interpreterPath: "/lib64/ld-linux.so.2",
        dynamicNeededNames: ["libc.so.6"],
      }),
    });
    const originalRuntime = Buffer.from(harness.files.get("/runtime/node"));
    const originalRuntimeSha256 = crypto
      .createHash("sha256")
      .update(originalRuntime)
      .digest("hex");
    const replacementRuntime = Buffer.from("replacement-node-runtime");
    const plan = applyLinuxStrongNativeHarness(harness);

    expect(plan.applied).toBe(true);
    const runtimeMounts = linuxBwrapFileMounts(plan.args).filter(
      ({ destination }) => destination === "/opt/chainless/runtime/node",
    );
    expect(runtimeMounts).toEqual([
      {
        mode: "ro-bind-data",
        childFd: expect.any(Number),
        destination: "/opt/chainless/runtime/node",
        permissions: "0500",
      },
    ]);
    const runtimeMount = runtimeMounts[0];
    const probeRead = harness.bwrapDataReads.find(
      ({ stage, destination }) =>
        stage === "probe" && destination === "/opt/chainless/runtime/node",
    );
    expect(probeRead).toMatchObject({
      bytesRead: originalRuntime.length,
      permissions: "0500",
      sha256: originalRuntimeSha256,
    });
    const finalRuntimeFd = plan.options.stdio[runtimeMount.childFd];
    expect(finalRuntimeFd).not.toBe(probeRead.parentFd);
    const finalRuntimeSnapshotPath = harness.openFiles.get(finalRuntimeFd);
    expect(finalRuntimeSnapshotPath).toBe(probeRead.sourcePath);
    expect(harness.files.get(finalRuntimeSnapshotPath)).toEqual(
      originalRuntime,
    );
    expect(harness.statFor(finalRuntimeSnapshotPath)).toMatchObject({
      nlink: 0,
      mode: 0o100500,
      size: originalRuntime.length,
    });
    expect([...harness.openFiles.values()]).not.toContain("/runtime/node");

    const mutation = harness.rewriteFileInPlace(
      "/runtime/node",
      replacementRuntime,
    );
    expect(mutation.after.ino).toBe(mutation.before.ino);
    expect(mutation.afterSha256).not.toBe(mutation.beforeSha256);

    const result = harness.spawnSync(plan.command, plan.args, plan.options);
    expect(result.status).toBe(0);
    expect(
      harness.bwrapDataReads.find(
        ({ stage, destination }) =>
          stage === "final" && destination === "/opt/chainless/runtime/node",
      ),
    ).toMatchObject({
      parentFd: finalRuntimeFd,
      bytesRead: originalRuntime.length,
      permissions: "0500",
      sha256: originalRuntimeSha256,
    });
    expect(harness.files.get("/runtime/node")).toEqual(replacementRuntime);

    plan.cleanup();
    expect(harness.openFiles.size).toBe(0);
    expect(harness.anonymousFiles.size).toBe(0);
  });

  it.each([
    [
      "later PT_LOAD overlay of the PT_DYNAMIC loader view",
      createLinuxDynamicElf64WithOverlappingLoaderView(),
    ],
    [
      "page-rounded PT_LOAD overlap without raw virtual-range overlap",
      createLinuxElf64WithPageOnlyLoadOverlap(),
    ],
  ])(
    "rejects a native ELF with %s before runtime inspection or target start",
    (_label, nativeEntry) => {
      const harness = createLinuxStrongHarness({
        entryRuntime: "native-dynamic-elf",
        nativeEntry,
      });
      const plan = applyLinuxStrongNativeHarness(harness);

      expect(plan).toMatchObject({
        applied: false,
        backend: null,
        candidateBackend: "linux-bwrap",
        policyAttested: false,
        reason: "linux_bwrap_execution_contract_invalid",
        guarantees: [],
        runtimeProbe: {
          kind: "linux-bwrap-plugin-native-elf-policy-v1",
          attempted: false,
          runnable: false,
          reason: "native_entry_load_segment_page_overlap",
          targetRuntime: "native-unclassified",
          contentSnapshot: false,
          handleAtomic: false,
        },
      });
      expect(harness.lddInspectionSources).toEqual([]);
      expect(
        harness.spawnSync.mock.calls.some(([, spawnArgs]) =>
          spawnArgs?.includes("/opt/chainless/plugin/bin/tool"),
        ),
      ).toBe(false);
      expect(harness.openFiles.size).toBe(0);
    },
  );

  it("fails closed when the trusted Linux runtime page-size contract is invalid", () => {
    const harness = createLinuxStrongHarness({
      entryRuntime: "native-dynamic-elf",
      nativeEntry: createLinuxStaticPieElf64({
        includeInterp: true,
        interpreterPath: "/lib64/ld-linux.so.2",
        dynamicNeededNames: ["libc.so.6"],
      }),
      linuxPageSize: 3000,
    });
    const plan = applyLinuxStrongNativeHarness(harness);

    expect(plan).toMatchObject({
      applied: false,
      backend: null,
      candidateBackend: "linux-bwrap",
      policyAttested: false,
      reason: "linux_bwrap_execution_contract_invalid",
      guarantees: [],
      runtimeProbe: {
        attempted: false,
        runnable: false,
        reason: "linux_runtime_page_size_unattested",
        targetRuntime: "native-unclassified",
        contentSnapshot: false,
        handleAtomic: false,
      },
    });
    expect(harness.lddInspectionSources).toEqual([]);
    expect(harness.openFiles.size).toBe(0);
  });

  it.each([
    [
      "an interpreter outside the trusted runtime closure",
      createLinuxStaticPieElf64({
        includeInterp: true,
        interpreterPath: "/lib64/other-loader.so",
        dynamicNeededNames: ["libc.so.6"],
      }),
      "native_dynamic_interpreter_outside_direct_system_set",
      "linux_bwrap_native_runtime_unattested",
      true,
      "native-dynamic-elf",
    ],
    [
      "a DT_NEEDED member outside the trusted runtime closure",
      createLinuxStaticPieElf64({
        includeInterp: true,
        interpreterPath: "/lib64/ld-linux.so.2",
        dynamicNeededNames: ["libplugin-private.so"],
      }),
      "native_dynamic_dependency_outside_direct_system_set",
      "linux_bwrap_native_runtime_unattested",
      true,
      "native-dynamic-elf",
    ],
    [
      "DT_RUNPATH loader search injection",
      createLinuxStaticPieElf64({
        includeInterp: true,
        interpreterPath: "/lib64/ld-linux.so.2",
        dynamicNeededNames: ["libc.so.6"],
        dynamicRunpath: true,
      }),
      "native_entry_dynamic_loader_directive_unsupported",
      "linux_bwrap_execution_contract_invalid",
      false,
      "native-unclassified",
    ],
  ])(
    "fails closed for dynamic native %s before the plugin target can start",
    (
      _label,
      nativeEntry,
      expectedProbeReason,
      expectedPlanReason,
      inspectedNode,
      expectedRuntime,
    ) => {
      const harness = createLinuxStrongHarness({
        entryRuntime: "native-dynamic-elf",
        nativeEntry,
      });
      const plan = applyLinuxStrongNativeHarness(harness);

      expect(plan).toMatchObject({
        applied: false,
        backend: null,
        candidateBackend: "linux-bwrap",
        policyAttested: false,
        reason: expectedPlanReason,
        guarantees: [],
        runtimeProbe: {
          attempted: false,
          runnable: false,
          reason: expectedProbeReason,
          targetRuntime: expectedRuntime,
          contentSnapshot: false,
          handleAtomic: false,
        },
      });
      expect(harness.lddInspectionSources).toEqual(
        inspectedNode ? ["/runtime/node"] : [],
      );
      expect(
        harness.spawnSync.mock.calls.some(([, spawnArgs]) =>
          spawnArgs?.includes("/opt/chainless/plugin/bin/tool"),
        ),
      ).toBe(false);
      expect(harness.openFiles.size).toBe(0);
    },
  );

  it("keeps a native entry snapshot runnable after the source inode changes", () => {
    const harness = createLinuxStrongHarness({
      entryRuntime: "native-static-elf",
    });
    const originalSha256 = harness.contract.entryIdentity.sha256;
    const originalBytes = harness.contract.entryIdentity.bytes;
    const plan = applyLinuxStrongNativeHarness(harness);

    expect(plan.applied).toBe(true);
    harness.files.set(
      harness.entryPath,
      Buffer.from("REPLACEMENT_MARKER".padEnd(originalBytes, "!")),
    );
    const finalResult = harness.spawnSync(
      plan.command,
      plan.args,
      plan.options,
    );

    expect(finalResult.status).toBe(0);
    expect(harness.bwrapDataReads).toHaveLength(4);
    expect(
      harness.bwrapDataReads.find(
        ({ stage, destination }) =>
          stage === "final" && destination === "/opt/chainless/plugin/bin/tool",
      ),
    ).toMatchObject({
      offsetBefore: 0,
      bytesRead: originalBytes,
      sha256: originalSha256,
    });
    expect(
      crypto
        .createHash("sha256")
        .update(harness.files.get(harness.entryPath))
        .digest("hex"),
    ).not.toBe(originalSha256);

    plan.cleanup();
    expect(harness.openFiles.size).toBe(0);
    expect(harness.anonymousFiles.size).toBe(0);
  });

  it("does not reselect the host native entry after the policy probe", () => {
    const harness = createLinuxStrongHarness({
      entryRuntime: "native-static-elf",
    });
    const originalSpawnSync = harness.spawnSync.getMockImplementation();
    harness.spawnSync.mockImplementation((command, args, options) => {
      const result = originalSpawnSync(command, args, options);
      if (harness.isBwrapCommand(command) && args?.[0] !== "--help") {
        harness.files.set(
          harness.entryPath,
          Buffer.from(
            "REPLACEMENT_MARKER".padEnd(
              harness.contract.entryIdentity.bytes,
              "!",
            ),
          ),
        );
      }
      return result;
    });

    const plan = applyLinuxStrongNativeHarness(harness);

    expect(plan).toMatchObject({
      applied: true,
      runtimeProbe: {
        runnable: true,
        contentSnapshot: true,
      },
    });
    const finalResult = harness.spawnSync(
      plan.command,
      plan.args,
      plan.options,
    );
    expect(finalResult.status).toBe(0);
    expect(harness.bwrapDataReads).toHaveLength(4);
    expect(
      harness.bwrapDataReads.find(
        ({ stage, destination }) =>
          stage === "final" && destination === "/opt/chainless/plugin/bin/tool",
      ).sha256,
    ).toBe(harness.contract.entryIdentity.sha256);

    plan.cleanup();
    expect(harness.openFiles.size).toBe(0);
  });

  it("keeps the native policy digest stable across anonymous inode IDs", () => {
    const left = createLinuxStrongHarness({
      entryRuntime: "native-static-elf",
    });
    const right = createLinuxStrongHarness({
      entryRuntime: "native-static-elf",
    });
    const temporaryFd = right.fsRuntime.openSync(
      "/tmp",
      right.fsRuntime.constants.O_TMPFILE |
        right.fsRuntime.constants.O_EXCL |
        right.fsRuntime.constants.O_RDWR,
      0o400,
    );
    right.fsRuntime.closeSync(temporaryFd);
    const changedEntry = createLinuxStaticElf64();
    changedEntry[changedEntry.length - 1] ^= 0x1;
    const changed = createLinuxStrongHarness({
      entryRuntime: "native-static-elf",
      nativeEntry: changedEntry,
    });
    const changedTree = createLinuxStrongHarness({
      entryRuntime: "native-static-elf",
      nodeDependency: Buffer.from("changed native plugin data\n"),
    });

    const leftPlan = applyLinuxStrongNativeHarness(left);
    const rightPlan = applyLinuxStrongNativeHarness(right);
    const changedPlan = applyLinuxStrongNativeHarness(changed);
    const changedTreePlan = applyLinuxStrongNativeHarness(changedTree);

    expect(leftPlan.applied).toBe(true);
    expect(rightPlan.applied).toBe(true);
    expect(changedPlan.applied).toBe(true);
    expect(changedTreePlan.applied).toBe(true);
    expect(leftPlan.policyDigest).toBe(rightPlan.policyDigest);
    expect(changedPlan.policyDigest).not.toBe(leftPlan.policyDigest);
    expect(changedTreePlan.policyDigest).not.toBe(leftPlan.policyDigest);
    expect(
      changedTreePlan.runtimeProbe.pluginTreeContentSnapshotDigest,
    ).not.toBe(leftPlan.runtimeProbe.pluginTreeContentSnapshotDigest);

    leftPlan.cleanup();
    rightPlan.cleanup();
    changedPlan.cleanup();
    changedTreePlan.cleanup();
    expect(left.openFiles.size).toBe(0);
    expect(right.openFiles.size).toBe(0);
    expect(changed.openFiles.size).toBe(0);
    expect(changedTree.openFiles.size).toBe(0);
  });

  it("fails closed when a native entry loses execute mode before snapshot", () => {
    const harness = createLinuxStrongHarness({
      entryRuntime: "native-static-elf",
      removeNativeEntryExecuteBeforeSnapshot: true,
    });
    const originalInode = harness.contract.entryIdentity.fileId.ino;
    const plan = applyLinuxStrongNativeHarness(harness);

    expect(harness.nativeEntryFullHashReads).toBe(3);
    expect(harness.nativeEntryExecuteRemoved).toBe(true);
    expect(String(harness.statFor(harness.entryPath).ino)).toBe(originalInode);
    expect(harness.statFor(harness.entryPath).mode & 0o111).toBe(0);
    expect(plan).toMatchObject({
      applied: false,
      backend: null,
      candidateBackend: "linux-bwrap",
      policyAttested: false,
      reason: "linux_bwrap_plugin_snapshot_unattested",
      guarantees: [],
      runtimeProbe: {
        kind: "linux-bwrap-plugin-native-static-elf-policy-v1",
        attempted: false,
        runnable: false,
        targetRuntime: "native-static-elf",
        contentSnapshot: false,
        handleAtomic: false,
      },
    });
    expect(plan.runtimeProbe.reason).toMatch(
      /native_entry_snapshot.*(?:mode|execut)/,
    );
    expect(
      harness.spawnSync.mock.calls.filter(
        ([command, probeArgs]) =>
          harness.isBwrapCommand(command) && probeArgs?.[0] !== "--help",
      ),
    ).toHaveLength(0);
    expect(harness.openFiles.size).toBe(0);
    expect(harness.anonymousFiles.size).toBe(0);
  });

  it.each([
    ["changes during verified copy", { tamperNativeSnapshot: true }],
    ["cannot be reopened read-only", { failNativeSnapshotReopen: true }],
  ])("fails closed when a native snapshot %s", (_label, options) => {
    const harness = createLinuxStrongHarness({
      entryRuntime: "native-static-elf",
      ...options,
    });
    const plan = applyLinuxStrongNativeHarness(harness);

    expect(plan).toMatchObject({
      applied: false,
      backend: null,
      candidateBackend: "linux-bwrap",
      policyAttested: false,
      reason: "linux_bwrap_plugin_snapshot_unattested",
      guarantees: [],
      runtimeProbe: {
        kind: "linux-bwrap-plugin-native-static-elf-policy-v1",
        attempted: false,
        runnable: false,
        targetRuntime: "native-static-elf",
        contentSnapshot: false,
        handleAtomic: false,
      },
    });
    expect(
      harness.spawnSync.mock.calls.filter(
        ([command, probeArgs]) =>
          harness.isBwrapCommand(command) && probeArgs?.[0] !== "--help",
      ),
    ).toHaveLength(0);
    expect(harness.openFiles.size).toBe(0);
    expect(harness.anonymousFiles.size).toBe(0);
  });

  it("fails closed and releases prior snapshots when a native tree member cannot be sealed", () => {
    const failingContents = Buffer.from("native member reopen must fail\n");
    const harness = createLinuxStrongHarness({
      entryRuntime: "native-static-elf",
      additionalPluginFiles: [
        {
          path: "/plugin/lib/a-first.dat",
          contents: Buffer.from("first native member\n"),
          mode: 0o100644,
        },
        {
          path: "/plugin/lib/b-fail.dat",
          contents: failingContents,
          mode: 0o100755,
        },
      ],
      failSnapshotReopenForContents: failingContents,
    });
    const plan = applyLinuxStrongNativeHarness(harness);

    expect(plan).toMatchObject({
      applied: false,
      backend: null,
      candidateBackend: "linux-bwrap",
      policyAttested: false,
      reason: "linux_bwrap_plugin_snapshot_unattested",
      guarantees: [],
      runtimeProbe: {
        attempted: false,
        runnable: false,
        targetRuntime: "native-static-elf",
        contentSnapshot: false,
        handleAtomic: false,
      },
    });
    expect(plan.runtimeProbe.reason).toMatch(/plugin_tree_snapshot.*reopen/);
    expect(
      harness.spawnSync.mock.calls.filter(([command]) =>
        harness.isBwrapCommand(command),
      ),
    ).toHaveLength(0);
    expect(harness.openFiles.size).toBe(0);
    expect(harness.anonymousFiles.size).toBe(0);
    const closedFds = harness.fsRuntime.closeSync.mock.calls.map(([fd]) => fd);
    expect(new Set(closedFds).size).toBe(closedFds.length);
  });

  it("fails closed before snapshot allocation when a native plugin tree exceeds the file limit", () => {
    const harness = createLinuxStrongHarness({
      entryRuntime: "native-static-elf",
      additionalPluginFiles: Array.from({ length: 255 }, (_, index) => ({
        path: `/plugin/lib/native-count-${String(index).padStart(3, "0")}.dat`,
        contents: Buffer.from([index % 251]),
        mode: 0o100644,
      })),
    });
    const plan = applyLinuxStrongNativeHarness(harness);

    expect(plan).toMatchObject({
      applied: false,
      backend: null,
      candidateBackend: "linux-bwrap",
      policyAttested: false,
      reason: "linux_bwrap_plugin_snapshot_unattested",
      guarantees: [],
      runtimeProbe: {
        attempted: false,
        runnable: false,
        reason: "native_plugin_tree_snapshot_file_count_invalid",
        targetRuntime: "native-static-elf",
        contentSnapshot: false,
        handleAtomic: false,
      },
    });
    expect(
      harness.fsRuntime.openSync.mock.calls.filter(
        ([value, flags]) =>
          value === "/tmp" &&
          (Number(flags) & harness.fsRuntime.constants.O_TMPFILE) ===
            harness.fsRuntime.constants.O_TMPFILE,
      ),
    ).toHaveLength(0);
    expect(harness.openFiles.size).toBe(0);
    expect(harness.anonymousFiles.size).toBe(0);
  });

  it("fails closed when the native snapshot changes after the policy probe", () => {
    const harness = createLinuxStrongHarness({
      entryRuntime: "native-static-elf",
      tamperNativeSnapshotAfterProbe: true,
    });
    const plan = applyLinuxStrongNativeHarness(harness);

    expect(plan).toMatchObject({
      applied: false,
      backend: null,
      candidateBackend: "linux-bwrap",
      policyAttested: false,
      reason: "linux_bwrap_execution_contract_changed",
      guarantees: [],
      runtimeProbe: {
        kind: "linux-bwrap-plugin-native-static-elf-policy-v1",
        attempted: true,
        runnable: false,
        reason: "post_probe_native_entry_snapshot_identity_changed",
        targetRuntime: "native-static-elf",
        contentSnapshot: false,
        handleAtomic: false,
      },
    });
    expect(harness.bwrapDataReads).toHaveLength(2);
    expect(harness.openFiles.size).toBe(0);
    expect(harness.anonymousFiles.size).toBe(0);
  });

  it("releases both snapshot readers when the native policy probe fails", () => {
    const harness = createLinuxStrongHarness({
      entryRuntime: "native-static-elf",
      bwrapStatus: 1,
    });
    const plan = applyLinuxStrongNativeHarness(harness);

    expect(plan).toMatchObject({
      applied: false,
      reason: "linux_bwrap_policy_probe_failed",
      runtimeProbe: {
        attempted: true,
        runnable: false,
        reason: "probe_failed",
        contentSnapshot: false,
      },
    });
    expect(harness.bwrapDataReads).toHaveLength(2);
    expect(harness.openFiles.size).toBe(0);
    expect(harness.anonymousFiles.size).toBe(0);
  });

  it.each([
    [
      "PT_INTERP",
      createLinuxStaticElf64({ extraProgramType: 3 }),
      "native_entry_interpreter_invalid",
    ],
    [
      "PT_DYNAMIC",
      createLinuxStaticElf64({ extraProgramType: 2 }),
      "native_entry_dynamic_elf_unsupported",
    ],
    [
      "ET_REL",
      createLinuxStaticElf64({ elfType: 1 }),
      "native_entry_unsupported_elf_type",
    ],
    [
      "ET_DYN without PT_DYNAMIC",
      createLinuxStaticPieElf64({ includeDynamic: false }),
      "native_entry_static_pie_dynamic_segment_missing",
    ],
    [
      "ET_DYN with PT_INTERP",
      createLinuxStaticPieElf64({ includeInterp: true }),
      "native_entry_dynamic_contract_required",
    ],
    [
      "ET_DYN with duplicate PT_DYNAMIC",
      createLinuxStaticPieElf64({ dynamicSegmentCount: 2 }),
      "native_entry_static_pie_dynamic_segment_ambiguous",
    ],
    [
      "ET_DYN with executable PT_DYNAMIC",
      createLinuxStaticPieElf64({ dynamicExecutable: true }),
      "native_entry_static_pie_dynamic_segment_executable",
    ],
    [
      "ET_DYN with malformed PT_DYNAMIC size",
      createLinuxStaticPieElf64({ dynamicFileSize: 15 }),
      "native_entry_static_pie_dynamic_segment_invalid",
    ],
    [
      "ET_DYN with unmapped PT_DYNAMIC",
      createLinuxStaticPieElf64({ dynamicVirtualAddress: 0x2000n }),
      "native_entry_static_pie_dynamic_segment_unmapped",
    ],
    [
      "ET_DYN with DT_NEEDED",
      createLinuxStaticPieElf64({ dynamicNeeded: true }),
      "native_entry_static_pie_dependency_unsupported",
    ],
    [
      "ET_DYN with unterminated dynamic table",
      createLinuxStaticPieElf64({ dynamicTerminated: false }),
      "native_entry_static_pie_dynamic_table_unterminated",
    ],
    [
      "ET_DYN without DF_1_PIE",
      createLinuxStaticPieElf64({ dynamicFlags1: 0n }),
      "native_entry_static_pie_flag_missing",
    ],
    [
      "ELF32",
      createLinuxStaticElf64({ elfClass: 1 }),
      "native_entry_not_elf64",
    ],
    [
      "big-endian ELF",
      createLinuxStaticElf64({ dataEncoding: 2 }),
      "native_entry_not_little_endian",
    ],
    [
      "foreign architecture",
      createLinuxStaticElf64({ machine: 183 }),
      "native_entry_architecture_mismatch",
    ],
    [
      "out-of-bounds program headers",
      createLinuxStaticElf64({ programHeaderOffset: 4096 }),
      "native_entry_program_headers_out_of_bounds",
    ],
    [
      "executable script",
      Buffer.from("#!/bin/sh\nexit 0\n".padEnd(128, "#")),
      "native_entry_not_elf",
    ],
    [
      "missing non-executable stack attestation",
      createLinuxStaticElf64({ includeGnuStack: false }),
      "native_entry_nonexecutable_stack_unattested",
    ],
    [
      "executable stack",
      createLinuxStaticElf64({ gnuStackFlags: 0x7 }),
      "native_entry_executable_stack_unsupported",
    ],
    [
      "writable executable load segment",
      createLinuxStaticElf64({ loadFlags: 0x7 }),
      "native_entry_writable_executable_segment",
    ],
    [
      "load segment larger on disk than in memory",
      createLinuxStaticElf64({ loadFileSize: 64, loadMemorySize: 32 }),
      "native_entry_segment_out_of_bounds",
    ],
    [
      "entry outside every executable load segment",
      createLinuxStaticElf64({ entryAddress: 0x500000n }),
      "native_entry_has_no_executable_entry_segment",
    ],
  ])(
    "rejects a native %s before the bwrap policy probe or target spawn",
    (_label, nativeEntry, expectedReason) => {
      const harness = createLinuxStrongHarness({
        entryRuntime: "native-static-elf",
        nativeEntry,
      });
      const plan = applyLinuxStrongNativeHarness(harness);

      expect(plan).toMatchObject({
        applied: false,
        backend: null,
        candidateBackend: "linux-bwrap",
        policyAttested: false,
        reason: "linux_bwrap_execution_contract_invalid",
        guarantees: [],
        runtimeProbe: {
          kind: "linux-bwrap-plugin-native-static-elf-policy-v1",
          attempted: false,
          runnable: false,
          reason: expectedReason,
          probeRuntime: "node",
          targetRuntime: "native-static-elf",
          contentSnapshot: false,
          handleAtomic: false,
        },
      });
      expect(harness.lddInspectionSources).toEqual([]);
      expect(harness.spawnSync).not.toHaveBeenCalled();
      expect(
        harness.spawnSync.mock.calls.filter(
          ([command, probeArgs]) =>
            harness.isBwrapCommand(command) && probeArgs?.[0] !== "--help",
        ),
      ).toHaveLength(0);
      expect(
        harness.spawnSync.mock.calls.some(([, spawnArgs]) =>
          spawnArgs?.includes("/opt/chainless/plugin/bin/tool"),
        ),
      ).toBe(false);
      expect(harness.openFiles.size).toBe(0);
    },
  );

  it("rejects a set-id native entry before any host inspection or spawn", () => {
    const harness = createLinuxStrongHarness({
      entryRuntime: "native-static-elf",
      nativeEntryMode: 0o104755,
    });
    const plan = applyLinuxStrongNativeHarness(harness);

    expect(plan).toMatchObject({
      applied: false,
      reason: "linux_bwrap_execution_contract_invalid",
      runtimeProbe: {
        kind: "linux-bwrap-plugin-native-static-elf-policy-v1",
        attempted: false,
        runnable: false,
        reason: "native_entry_identity_changed",
        targetRuntime: "native-static-elf",
      },
    });
    expect(harness.lddInspectionSources).toEqual([]);
    expect(harness.spawnSync).not.toHaveBeenCalled();
    expect(harness.openFiles.size).toBe(0);
  });

  it.each([
    ["x64", 0xc000003e, 41, 53, 0xbfffffff],
    ["arm64", 0xc00000b7, 198, 199, null],
    ["riscv64", 0xc00000f3, 198, 199, null],
  ])(
    "emits the exact fail-closed network cBPF program for %s",
    (arch, auditArch, socketSyscall, socketpairSyscall, syscallMask) => {
      const harness = createLinuxStrongHarness();
      const plan = applySandbox(
        "/runtime/node",
        ["/plugin/bin/tool.js"],
        { cwd: "/plugin", shell: false },
        "strict",
        {
          platform: "linux",
          arch,
          fs: harness.fsRuntime,
          homedir: () => "/home/tester",
          spawnSync: harness.spawnSync,
        },
        {
          profile: "strict",
          requiredBoundaries: [SANDBOX_BOUNDARIES.NETWORK],
          sync: true,
          executionContract: harness.contract,
        },
      );

      expect(plan.applied).toBe(true);
      const seccompIndex = plan.args.indexOf("--seccomp");
      const seccompFd = plan.options.stdio[Number(plan.args[seccompIndex + 1])];
      const program = harness.detachedContents.get(seccompFd);
      const decoded = [];
      for (let offset = 0; offset < program.length; offset += 8) {
        decoded.push([
          program.readUInt16LE(offset),
          program.readUInt8(offset + 2),
          program.readUInt8(offset + 3),
          program.readUInt32LE(offset + 4),
        ]);
      }
      expect(decoded).toEqual([
        [0x20, 0, 0, 4],
        [0x15, 1, 0, auditArch],
        [0x06, 0, 0, 0x80000000],
        [0x20, 0, 0, 0],
        ...(syscallMask === null ? [] : [[0x54, 0, 0, syscallMask]]),
        [0x15, 0, 1, socketSyscall],
        [0x06, 0, 0, 0x00050001],
        [0x15, 0, 1, socketpairSyscall],
        [0x06, 0, 0, 0x00050001],
        [0x15, 0, 1, 425],
        [0x06, 0, 0, 0x00050001],
        [0x06, 0, 0, 0x7fff0000],
      ]);
      plan.cleanup();
      expect(harness.openFiles.size).toBe(0);
    },
  );

  it("accepts an async strong Plugin Node contract without detaching the bwrap supervisor", () => {
    const harness = createLinuxStrongHarness();
    const plan = applySandbox(
      "/runtime/node",
      ["/plugin/bin/tool.js"],
      { cwd: "/plugin", shell: false },
      "strict",
      {
        platform: "linux",
        fs: harness.fsRuntime,
        homedir: () => "/home/tester",
        spawnSync: harness.spawnSync,
      },
      {
        profile: "strict",
        requiredBoundaries: [
          SANDBOX_BOUNDARIES.FILESYSTEM,
          SANDBOX_BOUNDARIES.NETWORK,
        ],
        sync: false,
        executionContract: harness.contract,
      },
    );

    expect(plan).toMatchObject({
      applied: true,
      backend: "linux-bwrap",
      policyAttested: true,
      guarantees: [
        SANDBOX_BOUNDARIES.FILESYSTEM,
        SANDBOX_BOUNDARIES.NETWORK,
        SANDBOX_BOUNDARIES.PROCESS_TREE,
      ],
      options: {
        shell: false,
        detached: false,
      },
      runtimeProbe: {
        attempted: true,
        runnable: true,
        reason: null,
      },
    });
    expectLinuxBwrapSupervisorInvocations(harness, ["capability", "probe"]);
    plan.cleanup();
    expect(harness.openFiles.size).toBe(0);
  });

  it("keeps the policy digest independent of user argv values", () => {
    const createPlan = (userArg) => {
      const harness = createLinuxStrongHarness();
      const plan = applySandbox(
        "/runtime/node",
        ["/plugin/bin/tool.js", "--token", userArg],
        { cwd: "/plugin", shell: false },
        "strict",
        {
          platform: "linux",
          fs: harness.fsRuntime,
          homedir: () => "/home/tester",
          spawnSync: harness.spawnSync,
        },
        {
          profile: "strict",
          requiredBoundaries: [
            SANDBOX_BOUNDARIES.FILESYSTEM,
            SANDBOX_BOUNDARIES.NETWORK,
          ],
          sync: true,
          executionContract: harness.contract,
        },
      );
      return { harness, plan };
    };
    const left = createPlan("first-sensitive-value");
    const right = createPlan("different-sensitive-value");

    expect(left.plan.policyDigest).toBe(right.plan.policyDigest);
    left.plan.cleanup();
    right.plan.cleanup();
    expect(left.harness.openFiles.size).toBe(0);
    expect(right.harness.openFiles.size).toBe(0);
  });

  it("keeps a failed fixed-policy bwrap probe as a candidate with no guarantee", () => {
    const harness = createLinuxStrongHarness({ bwrapStatus: 1 });
    const plan = applySandbox(
      "/runtime/node",
      ["/plugin/bin/tool.js"],
      { cwd: "/plugin", shell: false },
      "strict",
      {
        platform: "linux",
        fs: harness.fsRuntime,
        homedir: () => "/home/tester",
        spawnSync: harness.spawnSync,
      },
      {
        profile: "strict",
        requiredBoundaries: [
          SANDBOX_BOUNDARIES.FILESYSTEM,
          SANDBOX_BOUNDARIES.NETWORK,
        ],
        sync: true,
        executionContract: harness.contract,
      },
    );

    expect(plan).toMatchObject({
      applied: false,
      backend: null,
      candidateBackend: "linux-bwrap",
      policyAttested: false,
      reason: "linux_bwrap_policy_probe_failed",
      guarantees: [],
      runtimeProbe: {
        attempted: true,
        runnable: false,
        reason: "probe_failed",
      },
    });
    expect(plan.policyDigest).toMatch(/^[a-f0-9]{64}$/);
    expectLinuxBwrapSupervisorInvocations(harness, ["capability", "probe"]);
    expect(harness.openFiles.size).toBe(0);
  });

  it("keeps the sealed Node entry after its source changes after the policy probe", () => {
    const harness = createLinuxStrongHarness();
    const originalSha256 = harness.contract.entryIdentity.sha256;
    const originalSpawnSync = harness.spawnSync.getMockImplementation();
    let mutation;
    harness.spawnSync.mockImplementation((command, args, options) => {
      const result = originalSpawnSync(command, args, options);
      if (
        !mutation &&
        harness.isBwrapCommand(command) &&
        args?.[0] !== "--help"
      ) {
        mutation = harness.rewriteFileInPlace(
          harness.entryPath,
          Buffer.from("process.stdout.write('changed after probe')"),
        );
      }
      return result;
    });
    const plan = applySandbox(
      "/runtime/node",
      ["/plugin/bin/tool.js"],
      { cwd: "/plugin", shell: false },
      "strict",
      {
        platform: "linux",
        fs: harness.fsRuntime,
        homedir: () => "/home/tester",
        spawnSync: harness.spawnSync,
      },
      {
        profile: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
        sync: true,
        executionContract: harness.contract,
      },
    );

    expect(plan).toMatchObject({
      applied: true,
      policyAttested: true,
      reason: null,
      guarantees: [
        SANDBOX_BOUNDARIES.FILESYSTEM,
        SANDBOX_BOUNDARIES.NETWORK,
        SANDBOX_BOUNDARIES.PROCESS_TREE,
      ],
      runtimeProbe: {
        attempted: true,
        runnable: true,
        reason: null,
        targetRuntime: "node",
        contentSnapshot: true,
        contentSnapshotScope: "plugin-entry-source",
        contentSnapshotMechanism:
          "verified-o_tmpfile-copy-bwrap-ro-bind-data-v1",
        pluginTreeContentSnapshot: true,
        pluginTreeContentSnapshotScope: "all-pinned-plugin-regular-files",
        pluginTreeSnapshotConsistency: "per-file-pin-to-launch",
        pluginTreeSnapshotContractBound: false,
        pluginTreeSnapshotAtomic: false,
        handleAtomic: false,
      },
    });
    expect(mutation.afterSha256).not.toBe(originalSha256);
    expectLinuxBwrapSupervisorInvocations(harness, ["capability", "probe"]);
    expect(harness.bwrapDataReads).toHaveLength(2);

    const finalResult = harness.spawnSync(
      plan.command,
      plan.args,
      plan.options,
    );

    expect(finalResult.status).toBe(0);
    expect(harness.bwrapDataReads).toHaveLength(4);
    expect(
      harness.bwrapDataReads.find(
        ({ stage, destination }) =>
          stage === "final" &&
          destination === "/opt/chainless/plugin/bin/tool.js",
      ),
    ).toMatchObject({
      destination: "/opt/chainless/plugin/bin/tool.js",
      offsetBefore: 0,
      sha256: originalSha256,
      permissions: "0400",
    });
    plan.cleanup();
    expect(harness.openFiles.size).toBe(0);
    expect(harness.anonymousFiles.size).toBe(0);
  });

  it("still fails closed when the attested runtime changes after the policy probe", () => {
    const harness = createLinuxStrongHarness();
    const originalSpawnSync = harness.spawnSync.getMockImplementation();
    let mutation;
    harness.spawnSync.mockImplementation((command, args, options) => {
      const result = originalSpawnSync(command, args, options);
      if (
        !mutation &&
        harness.isBwrapCommand(command) &&
        args?.[0] !== "--help"
      ) {
        mutation = harness.rewriteFileInPlace(
          "/runtime/node",
          Buffer.from("changed-node-runtime-after-probe"),
        );
      }
      return result;
    });

    const plan = applyLinuxStrongNodeHarness(harness);

    expect(mutation.afterSha256).not.toBe(mutation.beforeSha256);
    expect(plan).toMatchObject({
      applied: false,
      backend: null,
      candidateBackend: "linux-bwrap",
      policyAttested: false,
      reason: "linux_bwrap_execution_contract_changed",
      guarantees: [],
      runtimeProbe: {
        attempted: true,
        runnable: false,
        reason: "post_probe_execution_identity_changed",
        targetRuntime: "node",
        contentSnapshot: false,
        handleAtomic: false,
      },
    });
    expectLinuxBwrapSupervisorInvocations(harness, ["capability", "probe"]);
    expect(harness.openFiles.size).toBe(0);
    expect(harness.anonymousFiles.size).toBe(0);
  });

  it.each([
    ["shell", { shell: true }],
    ["detached", { shell: false, detached: true }],
    ["ipc", { shell: false, stdio: ["pipe", "pipe", "pipe", "ipc"] }],
    ["numeric fd", { shell: false, stdio: ["pipe", "pipe", 9] }],
  ])(
    "rejects unsupported %s Plugin Node launch options before probing bwrap",
    (_label, launchOptions) => {
      const harness = createLinuxStrongHarness();
      const plan = applySandbox(
        "/runtime/node",
        ["/plugin/bin/tool.js"],
        { cwd: "/plugin", ...launchOptions },
        "strict",
        {
          platform: "linux",
          fs: harness.fsRuntime,
          homedir: () => "/home/tester",
          spawnSync: harness.spawnSync,
        },
        {
          profile: "strict",
          requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
          sync: true,
          executionContract: harness.contract,
        },
      );

      expect(plan).toMatchObject({
        applied: false,
        policyAttested: false,
        reason: "linux_bwrap_execution_contract_invalid",
        guarantees: [],
        runtimeProbe: {
          attempted: false,
          runnable: false,
          reason: "unsupported_launch_options",
        },
      });
      expect(harness.spawnSync).not.toHaveBeenCalled();
    },
  );

  it("rejects an entry identity change before probing or starting bwrap", () => {
    const harness = createLinuxStrongHarness();
    harness.files.set(
      "/plugin/bin/tool.js",
      Buffer.from("require('node:fs').writeFileSync('/tmp/marker', 'x')"),
    );
    const plan = applySandbox(
      "/runtime/node",
      ["/plugin/bin/tool.js"],
      { cwd: "/plugin", shell: false },
      "strict",
      {
        platform: "linux",
        fs: harness.fsRuntime,
        homedir: () => "/home/tester",
        spawnSync: harness.spawnSync,
      },
      {
        profile: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
        sync: true,
        executionContract: harness.contract,
      },
    );

    expect(plan).toMatchObject({
      applied: false,
      reason: "linux_bwrap_execution_contract_invalid",
      guarantees: [],
      runtimeProbe: {
        attempted: false,
        reason: "execution_identity_changed",
      },
    });
    expect(harness.spawnSync).not.toHaveBeenCalled();
  });

  it("rejects a nested host mount inside the plugin root", () => {
    const harness = createLinuxStrongHarness();
    harness.files.set(
      "/proc/self/mountinfo",
      Buffer.from(
        [
          "1 0 0:1 / / rw,relatime - ext4 /dev/root rw",
          "2 1 0:1 /secret /plugin/lib/mounted rw,relatime - ext4 /dev/root rw",
        ].join("\n"),
      ),
    );
    const plan = applySandbox(
      "/runtime/node",
      ["/plugin/bin/tool.js"],
      { cwd: "/plugin", shell: false },
      "strict",
      {
        platform: "linux",
        fs: harness.fsRuntime,
        homedir: () => "/home/tester",
        spawnSync: harness.spawnSync,
      },
      {
        profile: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
        sync: true,
        executionContract: harness.contract,
      },
    );

    expect(plan.runtimeProbe).toMatchObject({
      attempted: false,
      runnable: false,
      reason: "plugin_tree_unattested",
    });
    expect(plan.guarantees).toEqual([]);
    expect(harness.spawnSync).not.toHaveBeenCalled();
  });

  it.each(["fuse.sshfs", "nfs", "cifs", "9p", "virtiofs", "unknownfs"])(
    "rejects a plugin root backed by %s before probing bubblewrap",
    (filesystemType) => {
      const harness = createLinuxStrongHarness();
      harness.files.set(
        "/proc/self/mountinfo",
        Buffer.from(
          [
            "1 0 0:1 / / rw,relatime - ext4 /dev/root rw",
            `2 1 0:2 /source /plugin rw,relatime - ${filesystemType} source rw`,
          ].join("\n"),
        ),
      );
      const plan = applySandbox(
        "/runtime/node",
        ["/plugin/bin/tool.js"],
        { cwd: "/plugin", shell: false },
        "strict",
        {
          platform: "linux",
          fs: harness.fsRuntime,
          homedir: () => "/home/tester",
          spawnSync: harness.spawnSync,
        },
        {
          profile: "strict",
          requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
          sync: true,
          executionContract: harness.contract,
        },
      );

      expect(plan.runtimeProbe).toMatchObject({
        attempted: false,
        runnable: false,
        reason: "plugin_tree_unattested",
      });
      expect(plan.guarantees).toEqual([]);
      expect(harness.spawnSync).not.toHaveBeenCalled();
    },
  );

  it("rejects an exact local bind mount at the plugin root", () => {
    const harness = createLinuxStrongHarness();
    harness.files.set(
      "/proc/self/mountinfo",
      Buffer.from(
        [
          "1 0 0:1 / / rw,relatime - ext4 /dev/root rw",
          "2 1 0:1 /other-plugin /plugin rw,relatime - ext4 /dev/root rw",
        ].join("\n"),
      ),
    );
    const plan = applySandbox(
      "/runtime/node",
      ["/plugin/bin/tool.js"],
      { cwd: "/plugin", shell: false },
      "strict",
      {
        platform: "linux",
        fs: harness.fsRuntime,
        homedir: () => "/home/tester",
        spawnSync: harness.spawnSync,
      },
      {
        profile: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
        sync: true,
        executionContract: harness.contract,
      },
    );

    expect(plan.runtimeProbe).toMatchObject({
      attempted: false,
      runnable: false,
      reason: "plugin_tree_unattested",
    });
    expect(plan.guarantees).toEqual([]);
    expect(harness.spawnSync).not.toHaveBeenCalled();
  });

  it("rejects a plugin subtree that crosses a mount identity through a directory fd", () => {
    const harness = createLinuxStrongHarness();
    harness.mountIds.set("/plugin/lib", 88);
    const plan = applySandbox(
      "/runtime/node",
      ["/plugin/bin/tool.js"],
      { cwd: "/plugin", shell: false },
      "strict",
      {
        platform: "linux",
        fs: harness.fsRuntime,
        homedir: () => "/home/tester",
        spawnSync: harness.spawnSync,
      },
      {
        profile: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
        sync: true,
        executionContract: harness.contract,
      },
    );

    expect(plan).toMatchObject({
      applied: false,
      reason: "linux_bwrap_plugin_tree_unattested",
      guarantees: [],
    });
    expect(harness.openFiles.size).toBe(0);
    expect(
      harness.spawnSync.mock.calls.filter(
        ([command, args]) =>
          harness.isBwrapCommand(command) && args?.[0] !== "--help",
      ),
    ).toHaveLength(0);
  });

  it("rejects a plugin root inode replacement between validation and pinning", () => {
    const harness = createLinuxStrongHarness();
    const originalSpawnSync = harness.spawnSync.getMockImplementation();
    harness.spawnSync.mockImplementation((command, args, options) => {
      const result = originalSpawnSync(command, args, options);
      if (command === "/usr/bin/ldd") {
        harness.identities.set("/plugin", 9_999);
      }
      return result;
    });
    const plan = applySandbox(
      "/runtime/node",
      ["/plugin/bin/tool.js"],
      { cwd: "/plugin", shell: false },
      "strict",
      {
        platform: "linux",
        fs: harness.fsRuntime,
        homedir: () => "/home/tester",
        spawnSync: harness.spawnSync,
      },
      {
        profile: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
        sync: true,
        executionContract: harness.contract,
      },
    );

    expect(plan).toMatchObject({
      applied: false,
      reason: "linux_bwrap_plugin_tree_unattested",
      guarantees: [],
      runtimeProbe: {
        attempted: false,
        runnable: false,
        reason: "plugin_root_not_directory",
      },
    });
    expect(harness.openFiles.size).toBe(0);
  });

  it("rejects a root-wide plugin contract before probing bwrap", () => {
    const harness = createLinuxStrongHarness();
    harness.directories.add("/");
    harness.identities.set("/", 1);
    const contract = Object.freeze({
      ...harness.contract,
      pluginRoot: "/",
      workingDirectory: "/",
      rootIdentity: Object.freeze({
        realPath: "/",
        fileId: Object.freeze({
          dev: String(harness.statFor("/").dev),
          ino: String(harness.statFor("/").ino),
        }),
        attestation: "realpath-directory-file-id",
      }),
    });
    const plan = applySandbox(
      "/runtime/node",
      ["/plugin/bin/tool.js"],
      { cwd: "/", shell: false },
      "strict",
      {
        platform: "linux",
        fs: harness.fsRuntime,
        homedir: () => "/home/tester",
        spawnSync: harness.spawnSync,
      },
      {
        profile: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
        sync: true,
        executionContract: contract,
      },
    );

    expect(plan.runtimeProbe).toMatchObject({
      attempted: false,
      runnable: false,
      reason: "broad_plugin_root_disallowed",
    });
    expect(plan.guarantees).toEqual([]);
    expect(harness.spawnSync).not.toHaveBeenCalled();
  });

  it("reports an unattested or missing fixed bwrap binary without running ldd", () => {
    const harness = createLinuxStrongHarness({ includeBwrap: false });
    const plan = applySandbox(
      "/runtime/node",
      ["/plugin/bin/tool.js"],
      { cwd: "/plugin", shell: false },
      "strict",
      {
        platform: "linux",
        fs: harness.fsRuntime,
        homedir: () => "/home/tester",
        spawnSync: harness.spawnSync,
      },
      {
        profile: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.NETWORK],
        sync: true,
        executionContract: harness.contract,
      },
    );

    expect(plan).toMatchObject({
      applied: false,
      reason: "linux_bwrap_unavailable",
      guarantees: [],
      runtimeProbe: {
        attempted: false,
        runnable: false,
        reason: "binary_missing_or_unattested",
      },
    });
    expect(harness.spawnSync).not.toHaveBeenCalled();
  });

  it.each([
    [
      "file",
      "--ro-bind-fd FD DEST\n--ro-bind-data FD DEST\n--perms MODE\n--disable-userns\n--assert-userns-disabled\n--seccomp FD\n",
    ],
    [
      "ro-bind-fd",
      "--file FD DEST\n--ro-bind-data FD DEST\n--perms MODE\n--disable-userns\n--assert-userns-disabled\n--seccomp FD\n",
    ],
    [
      "perms",
      "--file FD DEST\n--ro-bind-fd FD DEST\n--ro-bind-data FD DEST\n--disable-userns\n--assert-userns-disabled\n--seccomp FD\n",
    ],
  ])(
    "fails closed when bubblewrap lacks required supervisor option %s",
    (missingOption, bwrapHelp) => {
      const harness = createLinuxStrongHarness({ bwrapHelp });
      const plan = applySandbox(
        "/runtime/node",
        ["/plugin/bin/tool.js"],
        { cwd: "/plugin", shell: false },
        "strict",
        {
          platform: "linux",
          fs: harness.fsRuntime,
          homedir: () => "/home/tester",
          spawnSync: harness.spawnSync,
        },
        {
          profile: "strict",
          requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
          sync: true,
          executionContract: harness.contract,
        },
      );

      expect(plan).toMatchObject({
        applied: false,
        reason: "linux_bwrap_unavailable",
        guarantees: [],
        runtimeProbe: {
          attempted: true,
          runnable: false,
          reason: `required_option_missing:${missingOption}`,
          supervisorDescriptorBound: true,
          handleAtomic: false,
        },
      });
      expectLinuxBwrapSupervisorInvocations(harness, ["capability"]);
      expect(harness.openFiles.size).toBe(0);
    },
  );

  it("fails closed when Node bubblewrap lacks ro-bind-data snapshot support", () => {
    const harness = createLinuxStrongHarness({
      bwrapHelp:
        "--file FD DEST\n--ro-bind-fd FD DEST\n--perms MODE\n--disable-userns\n--assert-userns-disabled\n--seccomp FD\n",
    });
    const plan = applySandbox(
      "/runtime/node",
      ["/plugin/bin/tool.js"],
      { cwd: "/plugin", shell: false },
      "strict",
      {
        platform: "linux",
        fs: harness.fsRuntime,
        homedir: () => "/home/tester",
        spawnSync: harness.spawnSync,
      },
      {
        profile: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
        sync: true,
        executionContract: harness.contract,
      },
    );

    expect(plan).toMatchObject({
      applied: false,
      backend: null,
      reason: "linux_bwrap_unavailable",
      guarantees: [],
      runtimeProbe: {
        attempted: true,
        runnable: false,
        reason: "required_option_missing:ro-bind-data",
        targetRuntime: "node",
        contentSnapshot: false,
        handleAtomic: false,
      },
    });
    expectLinuxBwrapSupervisorInvocations(harness, ["capability"]);
    expect(harness.openFiles.size).toBe(0);
    expect(harness.anonymousFiles.size).toBe(0);
  });

  it.each([
    [
      "ro-bind-data",
      "--file FD DEST\n--ro-bind-fd FD DEST\n--perms MODE\n--disable-userns\n--assert-userns-disabled\n--seccomp FD\n",
    ],
    [
      "perms",
      "--file FD DEST\n--ro-bind-fd FD DEST\n--ro-bind-data FD DEST\n--disable-userns\n--assert-userns-disabled\n--seccomp FD\n",
    ],
  ])(
    "fails closed when native bubblewrap lacks %s",
    (missingOption, bwrapHelp) => {
      const harness = createLinuxStrongHarness({
        entryRuntime: "native-static-elf",
        bwrapHelp,
      });
      const plan = applyLinuxStrongNativeHarness(harness);

      expect(plan).toMatchObject({
        applied: false,
        reason: "linux_bwrap_unavailable",
        guarantees: [],
        runtimeProbe: {
          attempted: true,
          runnable: false,
          reason: `required_option_missing:${missingOption}`,
          targetRuntime: "native-static-elf",
          contentSnapshot: false,
        },
      });
      expect(harness.openFiles.size).toBe(0);
    },
  );

  it("fails closed when bubblewrap cannot install the network seccomp filter", () => {
    const harness = createLinuxStrongHarness({
      bwrapHelp:
        "--file FD DEST\n--ro-bind-fd FD DEST\n--ro-bind-data FD DEST\n--perms MODE\n--disable-userns\n--assert-userns-disabled\n",
    });
    const plan = applySandbox(
      "/runtime/node",
      ["/plugin/bin/tool.js"],
      { cwd: "/plugin", shell: false },
      "strict",
      {
        platform: "linux",
        fs: harness.fsRuntime,
        homedir: () => "/home/tester",
        spawnSync: harness.spawnSync,
      },
      {
        profile: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.NETWORK],
        sync: true,
        executionContract: harness.contract,
      },
    );

    expect(plan).toMatchObject({
      applied: false,
      reason: "linux_bwrap_unavailable",
      guarantees: [],
      runtimeProbe: {
        attempted: true,
        runnable: false,
        reason: "required_option_missing:seccomp",
      },
    });
    expectLinuxBwrapSupervisorInvocations(harness, ["capability"]);
    expect(harness.openFiles.size).toBe(0);
  });

  it("fails closed and releases every pin on an unsupported seccomp architecture", () => {
    const harness = createLinuxStrongHarness();
    const plan = applySandbox(
      "/runtime/node",
      ["/plugin/bin/tool.js"],
      { cwd: "/plugin", shell: false },
      "strict",
      {
        platform: "linux",
        arch: "unsupported-test-arch",
        fs: harness.fsRuntime,
        homedir: () => "/home/tester",
        spawnSync: harness.spawnSync,
      },
      {
        profile: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.NETWORK],
        sync: true,
        executionContract: harness.contract,
      },
    );

    expect(plan).toMatchObject({
      applied: false,
      reason: "linux_bwrap_seccomp_unattested",
      guarantees: [],
      runtimeProbe: {
        attempted: false,
        runnable: false,
        reason: "unsupported_seccomp_architecture:unsupported-test-arch",
      },
    });
    expect(harness.spawnSync.mock.calls.map(([command]) => command)).toEqual([
      "/usr/bin/ldd",
    ]);
    expect(harness.bwrapInvocations).toHaveLength(0);
    expect(harness.openFiles.size).toBe(0);
  });

  it("fails closed when the anonymous seccomp filter bytes change before handoff", () => {
    const harness = createLinuxStrongHarness({
      tamperSeccompFilter: true,
    });
    const plan = applySandbox(
      "/runtime/node",
      ["/plugin/bin/tool.js"],
      { cwd: "/plugin", shell: false },
      "strict",
      {
        platform: "linux",
        fs: harness.fsRuntime,
        homedir: () => "/home/tester",
        spawnSync: harness.spawnSync,
      },
      {
        profile: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.NETWORK],
        sync: true,
        executionContract: harness.contract,
      },
    );

    expect(plan).toMatchObject({
      applied: false,
      reason: "linux_bwrap_seccomp_unattested",
      guarantees: [],
      runtimeProbe: {
        attempted: false,
        runnable: false,
        reason: "seccomp_filter_identity_changed",
      },
    });
    expect(harness.spawnSync.mock.calls.map(([command]) => command)).toEqual([
      "/usr/bin/ldd",
    ]);
    expect(harness.bwrapInvocations).toHaveLength(0);
    expect(harness.openFiles.size).toBe(0);
  });

  it("rejects a non-canonical library path returned by ldd", () => {
    const harness = createLinuxStrongHarness({
      lddStdout: "libescape.so => /usr/lib/../../home/tester/secret.so (0x1)",
    });
    const plan = applySandbox(
      "/runtime/node",
      ["/plugin/bin/tool.js"],
      { cwd: "/plugin", shell: false },
      "strict",
      {
        platform: "linux",
        fs: harness.fsRuntime,
        homedir: () => "/home/tester",
        spawnSync: harness.spawnSync,
      },
      {
        profile: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
        sync: true,
        executionContract: harness.contract,
      },
    );

    expect(plan).toMatchObject({
      applied: false,
      reason: "linux_bwrap_runtime_unattested",
      guarantees: [],
      runtimeProbe: {
        attempted: false,
        runnable: false,
        reason: "runtime_dependency_outside_system_library_roots",
      },
    });
    expect(harness.openFiles.size).toBe(0);
  });

  it("preserves shell command semantics behind the Linux wrapper", () => {
    const plan = applySandbox(
      "node script.js",
      [],
      { shell: true, cwd: "/workspace" },
      "default",
      {
        platform: "linux",
        fs: { existsSync: vi.fn(() => true) },
      },
    );

    expect(plan.args.slice(-3)).toEqual(["/bin/sh", "-c", "node script.js"]);
    expect(plan.options).toMatchObject({
      cwd: "/workspace",
      shell: false,
    });
  });

  it("returns the Windows Job Object + restricted-token wrapper plan", () => {
    const harness = createWindowsAdapterHarness();
    const options = { windowsHide: true, env: { PATH: "C:\\Windows" } };
    const plan = applyWindowsSandbox(
      "tool.exe",
      ["run"],
      options,
      { profileName: "strict" },
      {
        platform: "win32",
        fs: harness.fsRuntime,
        windowsDir: () => "C:\\Windows",
        windowsAdapterContent: "param([string]$Payload)",
        windowsAdapterIdleTtlMs: 60_000,
        tmpdir: () => "C:\\temp",
        randomBytes: (size) => Buffer.alloc(size, 7),
        joinPath: path.win32.join,
        spawnSync: harness.spawnSync,
      },
    );

    expect(plan).toMatchObject({
      applied: true,
      platform: "win32",
      profile: "strict",
      command: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      enforcement: "windows-job-restricted-token",
      backend: "windows-job-restricted-token",
      guarantees: [
        SANDBOX_BOUNDARIES.PROCESS_TREE,
        SANDBOX_BOUNDARIES.RESOURCE_LIMITS,
        SANDBOX_BOUNDARIES.PRIVILEGE_REDUCTION,
      ],
      postSpawn: { required: false, mode: "none" },
    });
    const payload = decodeWindowsLaunchSpec(harness, plan);
    expect(payload).toMatchObject({
      cpuSeconds: 0,
      processMemoryBytes: 256 * 1024 * 1024,
      activeProcessLimit: 16,
      command: "tool.exe",
      args: ["run"],
      nodeIpcFd: -1,
      detached: false,
      windowsHide: true,
      workingDirectory: expect.any(String),
      environment: {
        PATH: "C:\\Windows",
        CC_WINDOWS_SANDBOXED: "1",
        CC_WINDOWS_SANDBOX_PROFILE: "strict",
      },
    });
    expect(plan.guarantees).toEqual([
      SANDBOX_BOUNDARIES.PROCESS_TREE,
      SANDBOX_BOUNDARIES.RESOURCE_LIMITS,
      SANDBOX_BOUNDARIES.PRIVILEGE_REDUCTION,
    ]);
    expect(plan.guarantees).not.toContain(SANDBOX_BOUNDARIES.FILESYSTEM);
    expect(plan.guarantees).not.toContain(SANDBOX_BOUNDARIES.NETWORK);
    expect(plan.options).toMatchObject({
      windowsHide: true,
      shell: false,
      cwd: "C:\\Windows\\System32",
      env: {
        SystemRoot: "C:\\Windows",
        WINDIR: "C:\\Windows",
        PATH: "C:\\Windows\\System32;C:\\Windows",
        TEMP: "C:\\Windows\\Temp",
        TMP: "C:\\Windows\\Temp",
      },
    });
    expect(harness.fsRuntime.writeFileSync).toHaveBeenCalledTimes(3);
    for (const call of harness.fsRuntime.writeFileSync.mock.calls) {
      expect(call[2]).toEqual({ mode: 0o600, flag: "wx" });
    }
    const invocationPaths = harness.decodeInvocationPaths(plan.args);
    expect(invocationPaths.assemblyPath).toMatch(
      /^C:\\temp\\chainless-win-sandbox-[a-f0-9]+\.dll$/,
    );
    expect(invocationPaths.payloadPath).toMatch(
      /^C:\\temp\\chainless-win-sandbox-invocation-[a-f0-9]+\.json$/,
    );
    expect(options).toEqual({
      windowsHide: true,
      env: { PATH: "C:\\Windows" },
    });
    plan.cleanup();
    expect(harness.files.has(invocationPaths.assemblyPath)).toBe(true);
    expect(harness.files.has(invocationPaths.payloadPath)).toBe(false);
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
    expect(harness.fsRuntime.unlinkSync).toHaveBeenCalledWith(
      invocationPaths.assemblyPath,
    );
    expect(windowsSandboxSource).toContain("PROC_THREAD_ATTRIBUTE_HANDLE_LIST");
    expect(windowsSandboxSource).toContain("EXTENDED_STARTUPINFO_PRESENT");
    expect(windowsSandboxSource).toContain("BuildInheritedHandleList");
    expect(windowsSandboxSource).toContain("InitializeProcThreadAttributeList");
    expect(windowsSandboxSource).toContain("UpdateProcThreadAttribute");
    expect(windowsSandboxSource).toContain("DeleteProcThreadAttributeList");
    expect(windowsSandboxSource).toContain("_get_osfhandle(nodeIpcFd)");
    expect(windowsSandboxSource).toMatch(
      /CREATE_SUSPENDED\s*\|\s*CREATE_UNICODE_ENVIRONMENT\s*\|\s*EXTENDED_STARTUPINFO_PRESENT/,
    );
  });

  it("fails closed when the native helper probe payload cannot be removed", () => {
    const harness = createWindowsAdapterHarness();
    const unlink = harness.fsRuntime.unlinkSync.getMockImplementation();
    harness.fsRuntime.unlinkSync.mockImplementation((value) => {
      if (String(value).includes("chainless-win-sandbox-invocation-")) {
        const error = new Error("invocation is still open");
        error.code = "EACCES";
        throw error;
      }
      return unlink(value);
    });

    const plan = applyWindowsSandbox(
      "tool.exe",
      [],
      {},
      { profileName: "strict", sync: true },
      {
        platform: "win32",
        fs: harness.fsRuntime,
        windowsAdapterContent: "adapter-bytes",
        tmpdir: () => "C:\\temp",
        randomBytes: (size) => Buffer.alloc(size, 7),
        joinPath: path.win32.join,
        sleepSync: vi.fn(),
        spawnSync: harness.spawnSync,
      },
    );

    expect(plan).toMatchObject({
      applied: false,
      reason: "windows_native_adapter_compile_cleanup_unverified",
    });
    expect(resetWindowsSandboxAdapterCache()).toBe(false);
    harness.fsRuntime.unlinkSync.mockImplementation(unlink);
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
    expect(
      [...harness.files].some((value) =>
        value.includes("chainless-win-sandbox-invocation-"),
      ),
    ).toBe(false);
  });

  it("fails synchronous plan cleanup when its invocation payload remains", () => {
    const harness = createWindowsAdapterHarness();
    const plan = applyWindowsSandbox(
      "tool.exe",
      [],
      {},
      { profileName: "strict", sync: true },
      {
        platform: "win32",
        fs: harness.fsRuntime,
        windowsAdapterContent: "adapter-bytes",
        tmpdir: () => "C:\\temp",
        randomBytes: (size) => Buffer.alloc(size, 8),
        joinPath: path.win32.join,
        sleepSync: vi.fn(),
        spawnSync: harness.spawnSync,
      },
    );
    expect(plan.applied).toBe(true);
    const { payloadPath } = harness.decodeInvocationPaths(plan.args);
    const unlink = harness.fsRuntime.unlinkSync.getMockImplementation();
    harness.fsRuntime.unlinkSync.mockImplementation((value) => {
      if (String(value) === payloadPath) {
        const error = new Error("invocation is still open");
        error.code = "EACCES";
        throw error;
      }
      return unlink(value);
    });

    expect(() => plan.cleanup()).toThrow(
      "Windows sandbox cleanup could not be verified for invocation payload",
    );
    harness.fsRuntime.unlinkSync.mockImplementation(unlink);
    expect(plan.cleanup()).toBe(true);
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
  });

  it("binds a synchronous Windows Plugin Node launch to a verified entry snapshot", () => {
    const appContainerSid = "S-1-15-2-31-32-33-34-35-36-37";
    const helperSpawnSync = vi.fn((_helper, helperArgs) => {
      if (helperArgs[0] === "--prepare-appcontainer") {
        return {
          status: 0,
          stdout: JSON.stringify({
            ready: true,
            profileName: helperArgs[1],
            appContainerSid,
            capabilityCount: 0,
            tokenAttested: true,
            restrictedTokenAttested: true,
            probeRuntime: "node",
            targetRuntime: "node",
          }),
          stderr: "",
        };
      }
      if (helperArgs[0] === "--delete-appcontainer") {
        return {
          status: 0,
          stdout: JSON.stringify({
            deleted: true,
            absent: true,
            profileName: helperArgs[1],
          }),
          stderr: "",
        };
      }
      throw new Error(`Unexpected helper invocation: ${helperArgs}`);
    });
    const harness = createWindowsAdapterHarness({ helperSpawnSync });
    const runtimePath = "C:\\Program Files\\nodejs\\node.exe";
    const entryPath = "C:\\plugins\\example\\bin\\run.cjs";
    const runtimeSha256 = "1".repeat(64);
    const entrySha256 = "2".repeat(64);
    const plan = applyWindowsSandbox(
      runtimePath,
      [entryPath, "--label", "ready"],
      {
        cwd: "C:\\plugins\\example",
        shell: false,
        env: {
          PATH: "C:\\Program Files\\nodejs",
          AppDomain_Manager_Asm: "Untrusted.Manager, Version=1.0.0.0",
          appdomain_manager_type: "Untrusted.Manager.Bootstrap",
          NoDe_OpTiOnS: "--require=C:\\untrusted\\preload.cjs",
          node_channel_fd: "4",
          OpenSSL_Conf: "C:\\untrusted\\openssl.cnf",
          OpenSSL_Conf_Include: "C:\\untrusted\\openssl-includes",
          openssl_engines: "C:\\untrusted\\engines",
          OPENSSL_MODULES: "C:\\untrusted\\providers",
          cor_enable_profiling: "1",
          Cor_Profiler: "{11111111-1111-1111-1111-111111111111}",
          CORECLR_PROFILER_PATH_64: "C:\\untrusted\\profiler.dll",
          CoreClr_Profiler_Path_Arm32: "C:\\untrusted\\profiler-arm32.dll",
          dotnet_enable_profiling: "1",
          DotNet_Profiler_Path_Arm64: "C:\\untrusted\\profiler-arm64.dll",
          dotnet_startup_hooks: "C:\\untrusted\\startup-hook.dll",
          COMPlus_StartupHook: "C:\\untrusted\\startup-hook.dll",
          ComPlus_InstallRoot: "C:\\untrusted\\clr",
          COMPLUS_VERSION: "v4.0.30319",
          COMPlus_ApplicationMigrationRuntimeActivationConfigPath:
            "C:\\untrusted\\activation.config",
          SAFE_MARKER: "preserved",
        },
      },
      {
        profileName: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
        sync: true,
        executionContract: {
          kind: "strict-plugin-node-bin",
          runtimePath,
          runtimeIdentity: {
            realPath: runtimePath,
            bytes: 91_234_567,
            sha256: runtimeSha256,
            fileId: {
              dev: "4",
              ino: "5678",
            },
          },
          entryIdentity: {
            realPath: entryPath,
            bytes: 4_321,
            sha256: entrySha256,
            fileId: {
              dev: "4",
              ino: "9876",
            },
          },
        },
      },
      {
        platform: "win32",
        fs: harness.fsRuntime,
        windowsAdapterContent: "param()",
        tmpdir: () => "C:\\temp",
        randomBytes: (size) => Buffer.alloc(size, 0x1f),
        joinPath: path.win32.join,
        spawnSync: harness.spawnSync,
      },
    );

    expect(plan).toMatchObject({
      applied: true,
      backend: "windows-appcontainer-job-restricted-token",
      policyAttested: true,
      runtimeProbe: {
        kind: "windows-appcontainer-launch-attestation-v1",
        attempted: true,
        runnable: true,
        reason: null,
        capabilityCount: 0,
        probeRuntime: "node",
        targetRuntime: "node",
        contentSnapshot: true,
        contentSnapshotScope: "plugin-entry-source",
        contentSnapshotMechanism:
          "verified-handle-inherited-pipe-module-compile-v1",
        handleAtomic: false,
      },
    });
    expect(plan.policyDigest).toBe(
      crypto
        .createHash("sha256")
        .update(
          JSON.stringify({
            version: 1,
            backend: "windows-appcontainer-job-restricted-token",
            profile: "strict",
            requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
            guarantees: [
              SANDBOX_BOUNDARIES.FILESYSTEM,
              SANDBOX_BOUNDARIES.NETWORK,
              SANDBOX_BOUNDARIES.PRIVILEGE_REDUCTION,
              SANDBOX_BOUNDARIES.PROCESS_TREE,
              SANDBOX_BOUNDARIES.RESOURCE_LIMITS,
            ],
            adapter: {
              loaderMode: "powershell-byte-assembly",
              sourceDigest: crypto
                .createHash("sha256")
                .update(Buffer.from("param()"))
                .digest("hex"),
              sourceContractDigest: null,
            },
            appContainer: {
              attestationKind: "windows-appcontainer-launch-attestation-v1",
              capabilities: [],
              token: "restricted-primary-lowbox",
              disableAdministratorSids: true,
              allowReparsePaths: false,
              lifecycle: "ephemeral-delete-and-assert-absent",
            },
            job: {
              killOnClose: true,
              activeProcessLimit: 16,
              cpuSeconds: 0,
              processMemoryBytes: 256 * 1024 * 1024,
            },
            execution: {
              contractKind: "strict-plugin-node-bin",
              contentSnapshot: true,
              contentSnapshotScope: "plugin-entry-source",
              contentSnapshotMechanism:
                "verified-handle-inherited-pipe-module-compile-v1",
              handleAtomic: false,
              launchPathLocks: [
                {
                  role: "runtime",
                  path: runtimePath,
                  sha256: runtimeSha256,
                  bytes: 91_234_567,
                  dev: "4",
                  ino: "5678",
                },
                {
                  role: "entry",
                  path: entryPath,
                  sha256: entrySha256,
                  bytes: 4_321,
                  dev: "4",
                  ino: "9876",
                },
              ],
            },
          }),
        )
        .digest("hex"),
    );
    const payload = decodeWindowsLaunchSpec(harness, plan);
    expect(payload.command).toBe(runtimePath);
    expect(payload.args).toEqual([entryPath, "--label", "ready"]);
    expect(payload.launchPathLocks).toEqual([
      {
        role: "runtime",
        path: runtimePath,
        sha256: runtimeSha256,
        bytes: 91_234_567,
        dev: "4",
        ino: "5678",
      },
      {
        role: "entry",
        path: entryPath,
        sha256: entrySha256,
        bytes: 4_321,
        dev: "4",
        ino: "9876",
      },
    ]);
    expect(helperSpawnSync.mock.calls[0][1]).toEqual([
      "--prepare-appcontainer",
      "ChainlessChain.CliSandbox.1f1f1f1f1f1f1f1f1f1f1f1f",
      runtimePath,
    ]);
    expect(payload.environment).toMatchObject({
      PATH: "C:\\Program Files\\nodejs",
      SAFE_MARKER: "preserved",
    });
    expect(plan.options.env).toEqual({
      SystemRoot: "C:\\Windows",
      WINDIR: "C:\\Windows",
      ComSpec: "C:\\Windows\\System32\\cmd.exe",
      PATH: "C:\\Windows\\System32;C:\\Windows",
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
      TEMP: "C:\\Windows\\Temp",
      TMP: "C:\\Windows\\Temp",
    });
    expect(
      Object.keys(payload.environment).some((key) =>
        [
          "COMPLUS_STARTUPHOOK",
          "COMPLUS_INSTALLROOT",
          "COMPLUS_VERSION",
          "COMPLUS_APPLICATIONMIGRATIONRUNTIMEACTIVATIONCONFIGPATH",
          "APPDOMAIN_MANAGER_ASM",
          "APPDOMAIN_MANAGER_TYPE",
          "CORECLR_PROFILER_PATH_64",
          "CORECLR_PROFILER_PATH_ARM32",
          "COR_ENABLE_PROFILING",
          "COR_PROFILER",
          "DOTNET_ENABLE_PROFILING",
          "DOTNET_PROFILER_PATH_ARM64",
          "DOTNET_STARTUP_HOOKS",
          "NODE_CHANNEL_FD",
          "NODE_OPTIONS",
          "OPENSSL_CONF",
          "OPENSSL_CONF_INCLUDE",
          "OPENSSL_ENGINES",
          "OPENSSL_MODULES",
        ].includes(key.toUpperCase()),
      ),
    ).toBe(false);
    expect(
      Object.keys(helperSpawnSync.mock.calls[0][2].env).some((key) =>
        [
          "COMPLUS_STARTUPHOOK",
          "COMPLUS_INSTALLROOT",
          "COMPLUS_VERSION",
          "COMPLUS_APPLICATIONMIGRATIONRUNTIMEACTIVATIONCONFIGPATH",
          "APPDOMAIN_MANAGER_ASM",
          "APPDOMAIN_MANAGER_TYPE",
          "CORECLR_PROFILER_PATH_64",
          "CORECLR_PROFILER_PATH_ARM32",
          "COR_ENABLE_PROFILING",
          "COR_PROFILER",
          "DOTNET_ENABLE_PROFILING",
          "DOTNET_PROFILER_PATH_ARM64",
          "DOTNET_STARTUP_HOOKS",
          "NODE_CHANNEL_FD",
          "NODE_OPTIONS",
          "OPENSSL_CONF",
          "OPENSSL_CONF_INCLUDE",
          "OPENSSL_ENGINES",
          "OPENSSL_MODULES",
        ].includes(key.toUpperCase()),
      ),
    ).toBe(false);

    plan.cleanup();
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
  });

  it("binds an asynchronous Windows MCP capsule to runtime locks and an entry snapshot", () => {
    const helperSpawnSync = vi.fn((_helper, helperArgs) => {
      if (helperArgs[0] === "--probe-node-snapshot") {
        return {
          status: 0,
          stdout: JSON.stringify({
            ready: true,
            targetRuntime: "node",
            contentSnapshot: true,
          }),
          stderr: "",
        };
      }
      throw new Error(`Unexpected helper invocation: ${helperArgs}`);
    });
    const harness = createWindowsAdapterHarness({ helperSpawnSync });
    const runtimePath = "C:\\Program Files\\nodejs\\node.exe";
    const entryPath = "C:\\capsules\\server.cjs";
    const plan = applyWindowsSandbox(
      runtimePath,
      [entryPath, "--stdio"],
      {
        cwd: "C:\\capsules",
        shell: false,
        detached: false,
        stdio: ["pipe", "pipe", "pipe"],
      },
      {
        profileName: "default",
        requiredBoundaries: [
          SANDBOX_BOUNDARIES.PROCESS_TREE,
          SANDBOX_BOUNDARIES.CODE_SNAPSHOT,
        ],
        sync: false,
        executionContract: {
          kind: "strict-mcp-node-capsule",
          runtimePath,
          runtimeIdentity: {
            realPath: runtimePath,
            bytes: 91_234_567,
            sha256: "5".repeat(64),
            fileId: { dev: "4", ino: "2201" },
          },
          entryIdentity: {
            realPath: entryPath,
            bytes: 4_321,
            sha256: "6".repeat(64),
            fileId: { dev: "4", ino: "2202" },
          },
        },
      },
      {
        platform: "win32",
        fs: harness.fsRuntime,
        windowsAdapterContent: "param()",
        tmpdir: () => "C:\\temp",
        randomBytes: (size) => Buffer.alloc(size, 0x3b),
        joinPath: path.win32.join,
        spawnSync: harness.spawnSync,
      },
    );

    expect(plan).toMatchObject({
      applied: true,
      backend: "windows-job-restricted-token",
      guarantees: expect.arrayContaining([
        SANDBOX_BOUNDARIES.PROCESS_TREE,
        SANDBOX_BOUNDARIES.CODE_SNAPSHOT,
      ]),
      runtimeProbe: {
        runnable: true,
        contentSnapshot: true,
        contentSnapshotScope: "mcp-capsule-entry-source",
        contentSnapshotMechanism:
          "verified-handle-inherited-pipe-module-compile-v1",
        handleAtomic: false,
        entrySnapshotAtomic: true,
        runtimeLaunchAtomic: true,
        runtimeLaunchMechanism:
          "filter-oplock-locked-createprocess-suspended-image-v1",
        sharedLibraryClosure: false,
        planBindingMechanism: "windows-mcp-code-snapshot-plan-binding-v1",
        planBindingDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(decodeWindowsLaunchSpec(harness, plan)).toMatchObject({
      command: runtimePath,
      args: [entryPath, "--stdio"],
      launchPathLocks: [
        { role: "runtime", path: runtimePath, sha256: "5".repeat(64) },
        { role: "entry", path: entryPath, sha256: "6".repeat(64) },
      ],
    });
    plan.cleanup();
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
  });

  it("composes a Windows MCP capsule snapshot with zero-capability AppContainer boundaries", () => {
    const appContainerSid = "S-1-15-2-41-42-43-44-45-46-47";
    const helperSpawnSync = vi.fn((_helper, helperArgs) => {
      if (helperArgs[0] === "--prepare-appcontainer") {
        return {
          status: 0,
          stdout: JSON.stringify({
            ready: true,
            profileName: helperArgs[1],
            appContainerSid,
            capabilityCount: 0,
            tokenAttested: true,
            restrictedTokenAttested: true,
            probeRuntime: "node",
            targetRuntime: "node",
          }),
          stderr: "",
        };
      }
      if (helperArgs[0] === "--delete-appcontainer") {
        return {
          status: 0,
          stdout: JSON.stringify({
            deleted: true,
            absent: true,
            profileName: helperArgs[1],
          }),
          stderr: "",
        };
      }
      throw new Error(`Unexpected helper invocation: ${helperArgs}`);
    });
    const harness = createWindowsAdapterHarness({ helperSpawnSync });
    const runtimePath = "C:\\Program Files\\nodejs\\node.exe";
    const entryPath = "C:\\capsules\\server.cjs";
    const plan = applyWindowsSandbox(
      runtimePath,
      [entryPath, "--stdio"],
      {
        cwd: "C:\\capsules",
        shell: false,
        detached: false,
        stdio: ["pipe", "pipe", "pipe"],
      },
      {
        profileName: "strict",
        requiredBoundaries: [
          SANDBOX_BOUNDARIES.PROCESS_TREE,
          SANDBOX_BOUNDARIES.CODE_SNAPSHOT,
          SANDBOX_BOUNDARIES.FILESYSTEM,
          SANDBOX_BOUNDARIES.NETWORK,
        ],
        sync: false,
        executionContract: {
          kind: "strict-mcp-node-capsule",
          runtimePath,
          runtimeIdentity: {
            realPath: runtimePath,
            bytes: 91_234_567,
            sha256: "7".repeat(64),
            fileId: { dev: "4", ino: "2301" },
          },
          entryIdentity: {
            realPath: entryPath,
            bytes: 4_321,
            sha256: "8".repeat(64),
            fileId: { dev: "4", ino: "2302" },
          },
        },
      },
      {
        platform: "win32",
        fs: harness.fsRuntime,
        windowsAdapterContent: "param()",
        tmpdir: () => "C:\\temp",
        randomBytes: (size) => Buffer.alloc(size, 0x4b),
        joinPath: path.win32.join,
        spawnSync: harness.spawnSync,
      },
    );

    expect(plan).toMatchObject({
      applied: true,
      backend: "windows-appcontainer-job-restricted-token",
      policyAttested: true,
      guarantees: [
        SANDBOX_BOUNDARIES.FILESYSTEM,
        SANDBOX_BOUNDARIES.NETWORK,
        SANDBOX_BOUNDARIES.PROCESS_TREE,
        SANDBOX_BOUNDARIES.RESOURCE_LIMITS,
        SANDBOX_BOUNDARIES.PRIVILEGE_REDUCTION,
        SANDBOX_BOUNDARIES.CODE_SNAPSHOT,
      ],
      runtimeProbe: {
        kind: "windows-appcontainer-launch-attestation-v1",
        runnable: true,
        contentSnapshotScope: "mcp-capsule-entry-source",
        entrySnapshotAtomic: true,
        runtimeLaunchAtomic: true,
        runtimeLaunchMechanism:
          "filter-oplock-locked-createprocess-suspended-image-v1",
        sharedLibraryClosure: false,
        planBindingMechanism: "windows-mcp-code-snapshot-plan-binding-v1",
        planBindingDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      postSpawn: { required: true, mode: "sync" },
    });
    expect(decodeWindowsLaunchSpec(harness, plan)).toMatchObject({
      command: runtimePath,
      args: [entryPath, "--stdio"],
      appContainerSid,
      launchPathLocks: [
        { role: "runtime", path: runtimePath, sha256: "7".repeat(64) },
        { role: "entry", path: entryPath, sha256: "8".repeat(64) },
      ],
    });
    plan.cleanup();
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
  });

  it("probes the real Node snapshot transport before a restricted-token launch", () => {
    const helperSpawnSync = vi.fn((_helper, helperArgs) => {
      if (helperArgs[0] === "--probe-node-snapshot") {
        return {
          status: 0,
          stdout: JSON.stringify({
            ready: true,
            targetRuntime: "node",
            contentSnapshot: true,
          }),
          stderr: "",
        };
      }
      throw new Error(`Unexpected helper invocation: ${helperArgs}`);
    });
    const harness = createWindowsAdapterHarness({ helperSpawnSync });
    const runtimePath = "C:\\Program Files\\nodejs\\node.exe";
    const entryPath = "C:\\plugins\\example\\bin\\run.cjs";
    const spawnOptions = {
      env: {
        PATH: "C:\\Program Files\\nodejs",
        APPDOMAIN_MANAGER_ASM: "Untrusted.Manager, Version=1.0.0.0",
        AppDomain_Manager_Type: "Untrusted.Manager.Bootstrap",
        NODE_OPTIONS: "--require=C:\\untrusted\\preload.cjs",
        NODE_CHANNEL_FD: "4",
        OPENSSL_CONF: "C:\\untrusted\\openssl.cnf",
        OPENSSL_CONF_INCLUDE: "C:\\untrusted\\openssl-includes",
        COR_ENABLE_PROFILING: "1",
        COR_PROFILER_PATH: "C:\\untrusted\\profiler.dll",
      },
    };
    const sandboxOptions = {
      profileName: "strict",
      requiredBoundaries: [SANDBOX_BOUNDARIES.PROCESS_TREE],
      sync: true,
      executionContract: {
        kind: "strict-plugin-node-bin",
        runtimePath,
        runtimeIdentity: {
          realPath: runtimePath,
          bytes: 91_234_567,
          sha256: "3".repeat(64),
          fileId: { dev: "4", ino: "1201" },
        },
        entryIdentity: {
          realPath: entryPath,
          bytes: 4_321,
          sha256: "4".repeat(64),
          fileId: { dev: "4", ino: "1202" },
        },
      },
    };
    const runtimeOverrides = {
      platform: "win32",
      fs: harness.fsRuntime,
      windowsAdapterContent: "param()",
      tmpdir: () => "C:\\temp",
      randomBytes: (size) => Buffer.alloc(size, 0x2b),
      joinPath: path.win32.join,
      spawnSync: harness.spawnSync,
    };
    const createPlan = () =>
      applyWindowsSandbox(
        runtimePath,
        [entryPath],
        spawnOptions,
        sandboxOptions,
        runtimeOverrides,
      );
    const plan = createPlan();

    expect(plan).toMatchObject({
      applied: true,
      backend: "windows-job-restricted-token",
      runtimeProbe: {
        kind: "windows-plugin-node-entry-snapshot-v1",
        attempted: true,
        runnable: true,
        reason: null,
        probeRuntime: "node",
        targetRuntime: "node",
        contentSnapshot: true,
        contentSnapshotScope: "plugin-entry-source",
        contentSnapshotMechanism:
          "verified-handle-inherited-pipe-module-compile-v1",
        handleAtomic: false,
      },
    });
    expect(helperSpawnSync.mock.calls[0][1]).toEqual([
      "--probe-node-snapshot",
      runtimePath,
    ]);
    expect(helperSpawnSync.mock.calls[0][2]).toMatchObject({
      cwd: "C:\\Windows\\System32",
      timeout: 120_000,
      env: {
        SystemRoot: "C:\\Windows",
        WINDIR: "C:\\Windows",
        PATH: "C:\\Windows\\System32;C:\\Windows",
        TEMP: "C:\\Windows\\Temp",
        TMP: "C:\\Windows\\Temp",
      },
    });
    expect(decodeWindowsLaunchSpec(harness, plan).environment).toEqual({
      PATH: "C:\\Program Files\\nodejs",
      CC_WINDOWS_SANDBOXED: "1",
      CC_WINDOWS_SANDBOX_PROFILE: "strict",
    });
    plan.cleanup();
    expect(resetWindowsSandboxAdapterCache()).toBe(true);

    helperSpawnSync.mockImplementation(() => ({
      status: 0,
      stdout: "{}",
      stderr: "",
    }));
    const rejected = createPlan();
    expect(rejected).toMatchObject({
      applied: false,
      reason: "windows_plugin_entry_snapshot_probe_failed",
      runtimeProbe: {
        kind: "windows-plugin-node-entry-snapshot-v1",
        attempted: true,
        runnable: false,
        reason: "invalid_attestation",
        probeRuntime: "node",
        targetRuntime: "node",
      },
    });
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
  });

  it.each([
    {
      label: "native execution contract",
      command: "C:\\plugins\\example\\bin\\run.exe",
      args: [],
      spawnOptions: {},
      contract: {
        kind: "strict-plugin-native-static-elf-bin",
      },
      reason: "windows_plugin_execution_contract_unsupported",
    },
    {
      label: "asynchronous Node launch",
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: ["C:\\plugins\\example\\bin\\run.cjs"],
      spawnOptions: {},
      contract: {
        kind: "strict-plugin-node-bin",
        runtimePath: "C:\\Program Files\\nodejs\\node.exe",
        runtimeIdentity: {
          realPath: "C:\\Program Files\\nodejs\\node.exe",
          bytes: 10,
          sha256: "3".repeat(64),
          fileId: { dev: "4", ino: "101" },
        },
        entryIdentity: {
          realPath: "C:\\plugins\\example\\bin\\run.cjs",
          bytes: 20,
          sha256: "4".repeat(64),
          fileId: { dev: "4", ino: "102" },
        },
      },
      sync: false,
      reason: "windows_plugin_launch_path_lock_requires_sync_foreground",
    },
    {
      label: "detached Node launch",
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: ["C:\\plugins\\example\\bin\\run.cjs"],
      spawnOptions: { detached: true, stdio: "ignore" },
      contract: {
        kind: "strict-plugin-node-bin",
        runtimePath: "C:\\Program Files\\nodejs\\node.exe",
        runtimeIdentity: {
          realPath: "C:\\Program Files\\nodejs\\node.exe",
          bytes: 10,
          sha256: "5".repeat(64),
          fileId: { dev: "4", ino: "103" },
        },
        entryIdentity: {
          realPath: "C:\\plugins\\example\\bin\\run.cjs",
          bytes: 20,
          sha256: "6".repeat(64),
          fileId: { dev: "4", ino: "104" },
        },
      },
      sync: true,
      reason: "windows_plugin_launch_path_lock_requires_sync_foreground",
    },
    {
      label: "Node IPC descriptor",
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: ["C:\\plugins\\example\\bin\\run.cjs"],
      spawnOptions: { stdio: ["pipe", "pipe", "pipe", "ipc"] },
      contract: {
        kind: "strict-plugin-node-bin",
        runtimePath: "C:\\Program Files\\nodejs\\node.exe",
        runtimeIdentity: {
          realPath: "C:\\Program Files\\nodejs\\node.exe",
          bytes: 10,
          sha256: "b".repeat(64),
          fileId: { dev: "4", ino: "109" },
        },
        entryIdentity: {
          realPath: "C:\\plugins\\example\\bin\\run.cjs",
          bytes: 20,
          sha256: "c".repeat(64),
          fileId: { dev: "4", ino: "110" },
        },
      },
      sync: true,
      reason: "windows_plugin_entry_snapshot_ipc_unsupported",
    },
    {
      label: "ES module entry snapshot",
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: ["C:\\plugins\\example\\bin\\run.mjs"],
      spawnOptions: {},
      contract: {
        kind: "strict-plugin-node-bin",
        runtimePath: "C:\\Program Files\\nodejs\\node.exe",
        runtimeIdentity: {
          realPath: "C:\\Program Files\\nodejs\\node.exe",
          bytes: 10,
          sha256: "9".repeat(64),
          fileId: { dev: "4", ino: "107" },
        },
        entryIdentity: {
          realPath: "C:\\plugins\\example\\bin\\run.mjs",
          bytes: 20,
          sha256: "a".repeat(64),
          fileId: { dev: "4", ino: "108" },
        },
      },
      sync: true,
      reason: "windows_plugin_entry_snapshot_format_unsupported",
    },
    {
      label: "mismatched runtime identity",
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: ["C:\\plugins\\example\\bin\\run.cjs"],
      spawnOptions: {},
      contract: {
        kind: "strict-plugin-node-bin",
        runtimePath: "C:\\Program Files\\nodejs\\different-node.exe",
        runtimeIdentity: {
          realPath: "C:\\Program Files\\nodejs\\different-node.exe",
          bytes: 10,
          sha256: "7".repeat(64),
          fileId: { dev: "4", ino: "105" },
        },
        entryIdentity: {
          realPath: "C:\\plugins\\example\\bin\\run.cjs",
          bytes: 20,
          sha256: "8".repeat(64),
          fileId: { dev: "4", ino: "106" },
        },
      },
      sync: true,
      reason: "windows_plugin_launch_path_identity_mismatch",
    },
  ])(
    "rejects an unsupported Windows Plugin snapshot $label before compiling or starting the helper",
    ({ command, args, spawnOptions, contract, sync = true, reason }) => {
      const harness = createWindowsAdapterHarness();
      const plan = applyWindowsSandbox(
        command,
        args,
        spawnOptions,
        {
          profileName: "strict",
          sync,
          executionContract: contract,
        },
        {
          platform: "win32",
          fs: harness.fsRuntime,
          windowsAdapterContent: "param()",
          tmpdir: () => "C:\\temp",
          randomBytes: (size) => Buffer.alloc(size, 0x2f),
          joinPath: path.win32.join,
          spawnSync: harness.spawnSync,
        },
      );

      expect(plan).toMatchObject({
        applied: false,
        reason,
        command,
        args,
      });
      expect(harness.spawnSync).not.toHaveBeenCalled();
      expect(harness.helperSpawnSync).not.toHaveBeenCalled();
      expect(harness.fsRuntime.writeFileSync).not.toHaveBeenCalled();
    },
  );

  it("uses the audited default fallback for Git's nested Windows process tree", () => {
    const harness = createWindowsAdapterHarness();
    const plan = applyWindowsSandbox(
      "git",
      ["status", "--short"],
      { cwd: "C:\\repo" },
      { profileName: "default" },
      {
        platform: "win32",
        fs: harness.fsRuntime,
        windowsDir: () => "C:\\Windows",
        tmpdir: () => "C:\\temp",
        randomBytes: (size) => Buffer.alloc(size, 0x9a),
        joinPath: path.win32.join,
        spawnSync: harness.spawnSync,
      },
    );

    expect(plan).toMatchObject({
      applied: false,
      reason: "windows_git_nested_process_compatibility",
      command: "git",
      args: ["status", "--short"],
    });
    expect(harness.spawnSync).not.toHaveBeenCalled();
    expect(harness.fsRuntime.writeFileSync).not.toHaveBeenCalled();
  });

  it("prefers a canonical protected PowerShell 7 host for strong Windows plans", () => {
    const harness = createWindowsAdapterHarness();
    const modernHost = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
    const exists = harness.fsRuntime.existsSync.getMockImplementation();
    harness.fsRuntime.existsSync.mockImplementation(
      (value) => String(value) === modernHost || exists(value),
    );
    const realpathSync = vi.fn((value) => String(value));
    realpathSync.native = vi.fn((value) => String(value));
    harness.fsRuntime.realpathSync = realpathSync;

    const plan = applyWindowsSandbox(
      "tool.exe",
      [],
      {},
      { profileName: "strict", sync: true },
      {
        platform: "win32",
        fs: harness.fsRuntime,
        windowsAdapterContent: "adapter-bytes",
        windowsDir: () => "C:\\Windows",
        tmpdir: () => "C:\\temp",
        randomBytes: (size) => Buffer.alloc(size, 0x9b),
        joinPath: path.win32.join,
        spawnSync: harness.spawnSync,
      },
    );

    expect(plan.applied).toBe(true);
    expect(plan.command).toBe(modernHost);
    expect(realpathSync.native).toHaveBeenCalledWith(modernHost);
    plan.cleanup();
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
  });

  it("falls back to the protected in-box host when PowerShell 7 cannot probe under restriction", () => {
    const harness = createWindowsAdapterHarness();
    const modernHost = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
    const inboxHost =
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
    const exists = harness.fsRuntime.existsSync.getMockImplementation();
    harness.fsRuntime.existsSync.mockImplementation(
      (value) => String(value) === modernHost || exists(value),
    );
    const realpathSync = vi.fn((value) => String(value));
    realpathSync.native = vi.fn((value) => String(value));
    harness.fsRuntime.realpathSync = realpathSync;
    const nativeProbe = harness.spawnSync.getMockImplementation();
    harness.spawnSync.mockImplementation((command, args, options) =>
      command === modernHost
        ? {
            status: 125,
            stdout: "",
            stderr: "CC_WINDOWS_SANDBOX_ERROR: access denied",
          }
        : nativeProbe(command, args, options),
    );

    const plan = applyWindowsSandbox(
      "tool.exe",
      [],
      {},
      { profileName: "strict", sync: true },
      {
        platform: "win32",
        fs: harness.fsRuntime,
        windowsAdapterContent: "adapter-bytes",
        windowsDir: () => "C:\\Windows",
        tmpdir: () => "C:\\temp",
        randomBytes: (size) => Buffer.alloc(size, 0x9d),
        joinPath: path.win32.join,
        spawnSync: harness.spawnSync,
      },
    );

    expect(plan.applied).toBe(true);
    expect(plan.command).toBe(inboxHost);
    expect(harness.spawnSync).toHaveBeenCalledTimes(2);
    expect(harness.spawnSync.mock.calls[0][0]).toBe(modernHost);
    expect(harness.spawnSync.mock.calls[1][0]).toBe(inboxHost);
    plan.cleanup();
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
  });

  it("rejects a redirected PowerShell 7 host and retains the in-box host", () => {
    const harness = createWindowsAdapterHarness();
    const modernHost = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
    const inboxHost =
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
    const exists = harness.fsRuntime.existsSync.getMockImplementation();
    harness.fsRuntime.existsSync.mockImplementation(
      (value) => String(value) === modernHost || exists(value),
    );
    const realpathSync = vi.fn((value) => String(value));
    realpathSync.native = vi.fn((value) =>
      String(value) === modernHost
        ? "C:\\temp\\redirected-pwsh.exe"
        : String(value),
    );
    harness.fsRuntime.realpathSync = realpathSync;

    const plan = applyWindowsSandbox(
      "tool.exe",
      [],
      {},
      { profileName: "strict", sync: true },
      {
        platform: "win32",
        fs: harness.fsRuntime,
        windowsAdapterContent: "adapter-bytes",
        windowsDir: () => "C:\\Windows",
        tmpdir: () => "C:\\temp",
        randomBytes: (size) => Buffer.alloc(size, 0x9c),
        joinPath: path.win32.join,
        spawnSync: harness.spawnSync,
      },
    );

    expect(plan.applied).toBe(true);
    expect(plan.command).toBe(inboxHost);
    plan.cleanup();
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
  });

  it("uses the dedicated Windows adapter temp root from the environment", () => {
    const adapterRoot = "D:\\chainless-adapter-test";
    const harness = createWindowsAdapterHarness({
      preexistingDirectories: ["C:\\temp", adapterRoot],
    });
    vi.stubEnv("CC_WINDOWS_SANDBOX_ADAPTER_TEMP_ROOT", adapterRoot);
    try {
      const plan = applyWindowsSandbox(
        "tool.exe",
        [],
        {},
        { profileName: "default" },
        {
          platform: "win32",
          fs: harness.fsRuntime,
          windowsAdapterContent: "adapter-bytes",
          windowsDir: () => "C:\\Windows",
          randomBytes: (size) => Buffer.alloc(size, 0xa2),
          joinPath: path.win32.join,
          spawnSync: harness.spawnSync,
        },
      );

      expect(plan.applied).toBe(true);
      const { assemblyPath, payloadPath } = harness.decodeInvocationPaths(
        plan.args,
      );
      expect(assemblyPath.startsWith(`${adapterRoot}\\`)).toBe(true);
      expect(payloadPath.startsWith(`${adapterRoot}\\`)).toBe(true);
      expect(plan.adapterTempRootAttestation).toMatchObject({
        kind: "windows-adapter-temp-root-path-reattestation-v1",
        localVolume: true,
        nativeRealpathMatched: true,
        ancestorReparsePointsRejected: true,
        rootIdentityBound: true,
        criticalOperationReattestation: true,
        descriptorRelativeOperations: false,
        handleAtomic: false,
        residualHandling: "fail-closed-on-detected-path-or-identity-change",
      });
      plan.cleanup();
      expect(resetWindowsSandboxAdapterCache()).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("prefers a runtime Windows adapter temp root over the environment", () => {
    const environmentRoot = "D:\\chainless-adapter-env";
    const runtimeRoot = "E:\\chainless-adapter-runtime";
    const harness = createWindowsAdapterHarness({
      preexistingDirectories: ["C:\\temp", environmentRoot, runtimeRoot],
    });
    vi.stubEnv("CC_WINDOWS_SANDBOX_ADAPTER_TEMP_ROOT", environmentRoot);
    try {
      const plan = applyWindowsSandbox(
        "tool.exe",
        [],
        {},
        { profileName: "default" },
        {
          platform: "win32",
          fs: harness.fsRuntime,
          windowsAdapterContent: "adapter-bytes",
          windowsAdapterTempRoot: runtimeRoot,
          windowsDir: () => "C:\\Windows",
          randomBytes: (size) => Buffer.alloc(size, 0xa3),
          joinPath: path.win32.join,
          spawnSync: harness.spawnSync,
        },
      );

      expect(plan.applied).toBe(true);
      const { assemblyPath, payloadPath } = harness.decodeInvocationPaths(
        plan.args,
      );
      expect(assemblyPath.startsWith(`${runtimeRoot}\\`)).toBe(true);
      expect(payloadPath.startsWith(`${runtimeRoot}\\`)).toBe(true);
      plan.cleanup();
      expect(resetWindowsSandboxAdapterCache()).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("calls an explicit tmpdir hook once and pins every plan temp path to it", () => {
    const environmentRoot = "D:\\chainless-adapter-env";
    const runtimeRoot = "E:\\chainless-adapter-runtime";
    const tmpdirRoot = "F:\\chainless-adapter-tmpdir";
    const harness = createWindowsAdapterHarness({
      preexistingDirectories: [
        "C:\\temp",
        environmentRoot,
        runtimeRoot,
        tmpdirRoot,
      ],
    });
    const tmpdir = vi.fn(() => tmpdirRoot);
    vi.stubEnv("CC_WINDOWS_SANDBOX_ADAPTER_TEMP_ROOT", environmentRoot);
    try {
      const plan = applyWindowsSandbox(
        "tool.exe",
        [],
        { detached: true },
        { profileName: "default" },
        {
          platform: "win32",
          fs: harness.fsRuntime,
          windowsAdapterContent: "adapter-bytes",
          windowsAdapterTempRoot: runtimeRoot,
          windowsDir: () => "C:\\Windows",
          tmpdir,
          randomBytes: (size) => Buffer.alloc(size, 0xa4),
          joinPath: path.win32.join,
          spawnSync: harness.spawnSync,
        },
      );

      expect(plan.applied).toBe(true);
      expect(tmpdir).toHaveBeenCalledTimes(1);
      const { assemblyPath, payloadPath } = harness.decodeInvocationPaths(
        plan.args,
      );
      const launchSpec = decodeWindowsLaunchSpec(harness, plan);
      expect(assemblyPath.startsWith(`${tmpdirRoot}\\`)).toBe(true);
      expect(payloadPath.startsWith(`${tmpdirRoot}\\`)).toBe(true);
      expect(launchSpec.identityPath.startsWith(`${tmpdirRoot}\\`)).toBe(true);
      plan.cleanup();
      expect(resetWindowsSandboxAdapterCache()).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("resolves an explicit Windows tmpdir hook once through applySandbox", () => {
    const adapterRoot = "G:\\chainless-adapter-unified";
    const harness = createWindowsAdapterHarness({
      preexistingDirectories: [adapterRoot],
    });
    const tmpdir = vi.fn(() => adapterRoot);
    const plan = applySandbox("tool.exe", [], {}, "default", {
      platform: "win32",
      fs: harness.fsRuntime,
      windowsAdapterContent: "adapter-bytes",
      windowsDir: () => "C:\\Windows",
      tmpdir,
      randomBytes: (size) => Buffer.alloc(size, 0xa6),
      joinPath: path.win32.join,
      spawnSync: harness.spawnSync,
    });

    expect(plan.applied).toBe(true);
    expect(tmpdir).toHaveBeenCalledTimes(1);
    plan.cleanup();
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
  });

  it.each([
    ["an embedded NUL", "C:\\bad\0root", null, null],
    ["a relative path", "relative\\root", null, null],
    ["a symlink", "C:\\adapter-link", "directory", "symlink"],
    ["a reparse point", "C:\\adapter-reparse", "directory", "reparse"],
    ["a non-directory", "C:\\adapter-file", "file", null],
  ])(
    "fails closed with one reason when the adapter temp root is %s",
    (_label, adapterRoot, kind, special) => {
      const harness = createWindowsAdapterHarness({
        preexistingDirectories:
          kind === "directory" ? ["C:\\temp", adapterRoot] : ["C:\\temp"],
        preexistingPaths: kind === "file" ? [adapterRoot] : [],
      });
      if (special) {
        const lstat = harness.fsRuntime.lstatSync.getMockImplementation();
        harness.fsRuntime.lstatSync.mockImplementation((value) => {
          const stat = lstat(value);
          if (String(value) !== adapterRoot) return stat;
          return {
            ...stat,
            ...(special === "symlink"
              ? { isSymbolicLink: () => true }
              : { reparsePoint: true }),
          };
        });
      }

      const plan = applyWindowsSandbox(
        "tool.exe",
        [],
        {},
        { profileName: "default" },
        {
          platform: "win32",
          fs: harness.fsRuntime,
          windowsAdapterContent: "adapter-bytes",
          windowsAdapterTempRoot: adapterRoot,
          windowsDir: () => "C:\\Windows",
          randomBytes: (size) => Buffer.alloc(size, 0xa5),
          joinPath: path.win32.join,
          spawnSync: harness.spawnSync,
        },
      );

      expect(plan).toMatchObject({
        applied: false,
        reason: "windows_adapter_temp_root_untrusted",
      });
      expect(harness.spawnSync).not.toHaveBeenCalled();
    },
  );

  it("rejects a junction or reparse point in an adapter-root ancestor", () => {
    const adapterRoot = "C:\\adapter-owner\\temp";
    const reparseAncestor = "C:\\adapter-owner";
    const harness = createWindowsAdapterHarness({
      preexistingDirectories: [adapterRoot],
    });
    const lstat = harness.fsRuntime.lstatSync.getMockImplementation();
    harness.fsRuntime.lstatSync.mockImplementation((value, options) => {
      const stat = lstat(value, options);
      return path.win32.resolve(String(value)) === reparseAncestor
        ? { ...stat, isReparsePoint: () => true }
        : stat;
    });

    const plan = applyWindowsSandbox(
      "tool.exe",
      [],
      {},
      { profileName: "default" },
      {
        platform: "win32",
        fs: harness.fsRuntime,
        windowsAdapterContent: "adapter-bytes",
        windowsAdapterTempRoot: adapterRoot,
        windowsDir: () => "C:\\Windows",
        randomBytes: (size) => Buffer.alloc(size, 0xa7),
        joinPath: path.win32.join,
        spawnSync: harness.spawnSync,
      },
    );

    expect(plan).toMatchObject({
      applied: false,
      reason: "windows_adapter_temp_root_untrusted",
    });
    expect(harness.spawnSync).not.toHaveBeenCalled();
  });

  it("accepts a native 8.3 alias only when it resolves to the same directory identity", () => {
    const adapterRoot =
      "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\chainless-adapter";
    const canonicalRoot =
      "C:\\Users\\runneradmin\\AppData\\Local\\Temp\\chainless-adapter";
    const harness = createWindowsAdapterHarness({
      preexistingDirectories: [adapterRoot, canonicalRoot],
    });
    harness.setPathIdentity(
      canonicalRoot,
      harness.getPathIdentity(adapterRoot),
    );
    harness.redirectRealpath(adapterRoot, canonicalRoot);

    const plan = applyWindowsSandbox(
      "tool.exe",
      [],
      {},
      { profileName: "default" },
      {
        platform: "win32",
        fs: harness.fsRuntime,
        windowsAdapterContent: "adapter-bytes",
        windowsAdapterTempRoot: adapterRoot,
        windowsDir: () => "C:\\Windows",
        randomBytes: (size) => Buffer.alloc(size, 0xa8),
        joinPath: path.win32.join,
        spawnSync: harness.spawnSync,
      },
    );

    expect(plan.applied).toBe(true);
    expect(plan.adapterTempRootAttestation).toMatchObject({
      nativeRealpathMatched: true,
      sourceAliasCanonicalized: true,
      rootIdentityBound: true,
      criticalOperationReattestation: true,
    });
    const { assemblyPath, payloadPath } = harness.decodeInvocationPaths(
      plan.args,
    );
    expect(assemblyPath.startsWith(`${canonicalRoot}\\`)).toBe(true);
    expect(payloadPath.startsWith(`${canonicalRoot}\\`)).toBe(true);
    plan.cleanup();
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
  });

  it("rejects a native realpath target with a different leaf identity", () => {
    const adapterRoot = "C:\\adapter-realpath";
    const redirectedRoot = "C:\\redirected-adapter-root";
    const harness = createWindowsAdapterHarness({
      preexistingDirectories: [adapterRoot, redirectedRoot],
    });
    harness.redirectRealpath(adapterRoot, redirectedRoot);

    const plan = applyWindowsSandbox(
      "tool.exe",
      [],
      {},
      { profileName: "default" },
      {
        platform: "win32",
        fs: harness.fsRuntime,
        windowsAdapterContent: "adapter-bytes",
        windowsAdapterTempRoot: adapterRoot,
        windowsDir: () => "C:\\Windows",
        randomBytes: (size) => Buffer.alloc(size, 0xad),
        joinPath: path.win32.join,
        spawnSync: harness.spawnSync,
      },
    );

    expect(plan).toMatchObject({
      applied: false,
      reason: "windows_adapter_temp_root_untrusted",
    });
  });

  it("fails closed when the bound adapter root is replaced during helper creation", () => {
    const adapterRoot = "C:\\adapter-replaced-during-create";
    const harness = createWindowsAdapterHarness({
      preexistingDirectories: [adapterRoot],
    });
    const originalRootIdentity = harness.getPathIdentity(adapterRoot);
    const writeFile = harness.fsRuntime.writeFileSync.getMockImplementation();
    harness.fsRuntime.writeFileSync.mockImplementation(
      (value, content, options) => {
        const result = writeFile(value, content, options);
        if (String(value).endsWith("\\windows-sandbox-helper.exe")) {
          harness.replacePathIdentity(adapterRoot);
        }
        return result;
      },
    );

    const plan = applyWindowsSandbox(
      "tool.exe",
      [],
      {},
      { profileName: "default" },
      {
        platform: "win32",
        fs: harness.fsRuntime,
        windowsAdapterContent: "adapter-bytes",
        windowsAdapterTempRoot: adapterRoot,
        windowsDir: () => "C:\\Windows",
        randomBytes: (size) => Buffer.alloc(size, 0xa9),
        joinPath: path.win32.join,
        spawnSync: harness.spawnSync,
      },
    );

    expect(plan).toMatchObject({
      applied: false,
      reason: "windows_adapter_temp_root_changed",
    });
    expect(harness.fsRuntime.unlinkSync).not.toHaveBeenCalled();
    harness.setPathIdentity(adapterRoot, originalRootIdentity);
    const unownedPartialHelper = [...harness.files].find(
      (candidate) =>
        candidate.startsWith(`${adapterRoot}\\`) &&
        candidate.endsWith("\\windows-sandbox-helper.exe"),
    );
    expect(unownedPartialHelper).toBeTruthy();
    harness.fsRuntime.unlinkSync(unownedPartialHelper);
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
  });

  it("refuses cleanup after root replacement and succeeds after identity restoration", () => {
    const adapterRoot = "C:\\adapter-replaced-before-delete";
    const harness = createWindowsAdapterHarness({
      preexistingDirectories: [adapterRoot],
    });
    const originalRootIdentity = harness.getPathIdentity(adapterRoot);
    const warn = vi.fn();
    const plan = applyWindowsSandbox(
      "tool.exe",
      [],
      {},
      { profileName: "default" },
      {
        platform: "win32",
        fs: harness.fsRuntime,
        windowsAdapterContent: "adapter-bytes",
        windowsAdapterIdleTtlMs: 0,
        windowsAdapterTempRoot: adapterRoot,
        windowsDir: () => "C:\\Windows",
        randomBytes: (size) => Buffer.alloc(size, 0xaa),
        joinPath: path.win32.join,
        spawnSync: harness.spawnSync,
        warn,
      },
    );
    const { assemblyPath, payloadPath } = harness.decodeInvocationPaths(
      plan.args,
    );
    harness.fsRuntime.unlinkSync.mockClear();
    harness.replacePathIdentity(adapterRoot);

    expect(plan.cleanup()).toBe(false);
    expect(harness.files.has(assemblyPath)).toBe(true);
    expect(harness.files.has(payloadPath)).toBe(true);
    expect(harness.fsRuntime.unlinkSync).not.toHaveBeenCalledWith(assemblyPath);
    expect(harness.fsRuntime.unlinkSync).not.toHaveBeenCalledWith(payloadPath);
    expect(warn).toHaveBeenCalledOnce();

    harness.setPathIdentity(adapterRoot, originalRootIdentity);
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
    expect(harness.files.has(assemblyPath)).toBe(false);
    expect(harness.files.has(payloadPath)).toBe(false);
  });

  it("materializes a random byte-loaded Windows helper and never trusts a prepositioned cache", () => {
    const oldHashAssembly =
      "C:\\temp\\chainless-win-sandbox-0123456789abcdef01234567\\windows-sandbox-helper.exe";
    const harness = createWindowsAdapterHarness({
      preexistingPaths: [oldHashAssembly],
    });
    const plan = applyWindowsSandbox(
      "tool.exe",
      [],
      {},
      { profileName: "default" },
      {
        platform: "win32",
        fs: harness.fsRuntime,
        windowsAdapterContent: "param()",
        windowsAdapterIdleTtlMs: 60_000,
        windowsDir: () => "C:\\Windows",
        tmpdir: () => "C:\\temp",
        randomBytes: (size) => Buffer.alloc(size, 0xa1),
        joinPath: path.win32.join,
        spawnSync: harness.spawnSync,
      },
    );

    expect(plan.applied).toBe(true);
    const { assemblyPath } = harness.decodeInvocationPaths(plan.args);
    expect(assemblyPath).toBe(
      "C:\\temp\\chainless-win-sandbox-" +
        `${"a1".repeat(24)}\\windows-sandbox-helper.exe`,
    );
    expect(plan.command).toBe(assemblyPath);
    expect(assemblyPath).not.toBe(oldHashAssembly);
    expect(harness.logicalCalls[0]).toMatchObject({
      command: assemblyPath,
      args: ["--probe-helper"],
    });
    expect(decodeWindowsLaunchSpec(harness, plan)).toMatchObject({
      allowReparsePaths: true,
      disableAdministratorSids: false,
    });

    plan.cleanup();
    expect(harness.files.has(assemblyPath)).toBe(true);
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
    expect(harness.fsRuntime.unlinkSync).toHaveBeenCalledWith(assemblyPath);
    expect(harness.fsRuntime.unlinkSync).not.toHaveBeenCalledWith(
      oldHashAssembly,
    );
    expect(harness.files.has(oldHashAssembly)).toBe(true);
  });

  it("shares one attested helper across ordinary plans in the same process", () => {
    const harness = createWindowsAdapterHarness();
    let randomNonce = 0xb0;
    const runtime = {
      platform: "win32",
      fs: harness.fsRuntime,
      windowsAdapterContent: "param()",
      windowsAdapterIdleTtlMs: 60_000,
      windowsDir: () => "C:\\Windows",
      tmpdir: () => "C:\\temp",
      randomBytes: (size) => {
        randomNonce += 1;
        return Buffer.alloc(size, randomNonce);
      },
      joinPath: path.win32.join,
      spawnSync: harness.spawnSync,
    };

    const first = applyWindowsSandbox(
      "first.exe",
      [],
      {},
      { profileName: "default" },
      runtime,
    );
    const second = applyWindowsSandbox(
      "second.exe",
      [],
      {},
      { profileName: "default" },
      runtime,
    );

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(true);
    expect(second.command).toBe(first.command);
    const firstAssembly = harness.decodeInvocationPaths(
      first.args,
    ).assemblyPath;
    const secondAssembly = harness.decodeInvocationPaths(
      second.args,
    ).assemblyPath;
    expect(secondAssembly).toBe(firstAssembly);
    expect(
      harness.logicalCalls.filter(
        ({ args: helperArgs }) => helperArgs[0] === "--probe-helper",
      ),
    ).toHaveLength(1);

    first.cleanup();
    second.cleanup();
    expect(harness.files.has(firstAssembly)).toBe(true);
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
    expect(harness.files.has(firstAssembly)).toBe(false);
  });

  it("deletes a quiescent cached helper after the unref idle TTL", () => {
    vi.useFakeTimers();
    const harness = createWindowsAdapterHarness();
    try {
      const plan = applyWindowsSandbox(
        "tool.exe",
        [],
        {},
        { profileName: "default" },
        {
          platform: "win32",
          fs: harness.fsRuntime,
          windowsAdapterContent: "param()",
          windowsDir: () => "C:\\Windows",
          windowsAdapterIdleTtlMs: 50,
          tmpdir: () => "C:\\temp",
          randomBytes: (size) => Buffer.alloc(size, 0xb3),
          joinPath: path.win32.join,
          spawnSync: harness.spawnSync,
        },
      );

      const { assemblyPath } = harness.decodeInvocationPaths(plan.args);
      plan.cleanup();
      expect(harness.files.has(assemblyPath)).toBe(true);
      vi.advanceTimersByTime(49);
      expect(harness.files.has(assemblyPath)).toBe(true);
      vi.advanceTimersByTime(1);
      expect(harness.files.has(assemblyPath)).toBe(false);
    } finally {
      vi.useRealTimers();
      expect(resetWindowsSandboxAdapterCache()).toBe(true);
    }
  });

  it.each([
    ["the process environment", undefined],
    ["an explicit runtime override", 0],
  ])(
    "synchronously retires a released helper at zero TTL from %s",
    (_label, explicitTtl) => {
      vi.useFakeTimers();
      vi.stubEnv(
        "CC_WINDOWS_SANDBOX_ADAPTER_IDLE_TTL_MS",
        explicitTtl === undefined ? "0" : "999999",
      );
      const harness = createWindowsAdapterHarness();
      try {
        const plan = applyWindowsSandbox(
          "tool.exe",
          [],
          {},
          { profileName: "default" },
          {
            platform: "win32",
            fs: harness.fsRuntime,
            windowsAdapterContent: "adapter-bytes",
            windowsAdapterIdleTtlMs: explicitTtl,
            windowsDir: () => "C:\\Windows",
            tmpdir: () => "C:\\temp",
            randomBytes: (size) => Buffer.alloc(size, 0xb4),
            joinPath: path.win32.join,
            spawnSync: harness.spawnSync,
          },
        );

        const { assemblyPath } = harness.decodeInvocationPaths(plan.args);
        const adapterDirectory = path.win32.dirname(assemblyPath);
        expect(harness.files.has(assemblyPath)).toBe(true);
        expect(harness.directories.has(adapterDirectory)).toBe(true);
        const timerCountBeforeRelease = vi.getTimerCount();
        plan.cleanup();
        expect(harness.files.has(assemblyPath)).toBe(false);
        expect(harness.directories.has(adapterDirectory)).toBe(false);
        expect(vi.getTimerCount()).toBe(timerCountBeforeRelease);
      } finally {
        vi.unstubAllEnvs();
        vi.useRealTimers();
        expect(resetWindowsSandboxAdapterCache()).toBe(true);
      }
    },
  );

  it("does not reuse a 60-second helper lease for a new zero-TTL policy", () => {
    vi.useFakeTimers();
    const harness = createWindowsAdapterHarness();
    let helperNonce = 0xbb;
    const runtime = {
      platform: "win32",
      fs: harness.fsRuntime,
      windowsAdapterContent: "adapter-bytes",
      windowsDir: () => "C:\\Windows",
      tmpdir: () => "C:\\temp",
      randomBytes: (size) => Buffer.alloc(size, helperNonce++),
      joinPath: path.win32.join,
      spawnSync: harness.spawnSync,
    };
    try {
      const longLived = applyWindowsSandbox(
        "first.exe",
        [],
        {},
        { profileName: "default" },
        { ...runtime, windowsAdapterIdleTtlMs: 60_000 },
      );
      const firstAssembly = harness.decodeInvocationPaths(
        longLived.args,
      ).assemblyPath;
      longLived.cleanup();
      expect(harness.files.has(firstAssembly)).toBe(true);

      const zeroTtl = applyWindowsSandbox(
        "second.exe",
        [],
        {},
        { profileName: "default" },
        { ...runtime, windowsAdapterIdleTtlMs: 0 },
      );
      const secondAssembly = harness.decodeInvocationPaths(
        zeroTtl.args,
      ).assemblyPath;
      expect(secondAssembly).not.toBe(firstAssembly);
      expect(harness.files.has(firstAssembly)).toBe(false);
      expect(
        harness.logicalCalls.filter(
          ({ args: helperArgs }) => helperArgs[0] === "--probe-helper",
        ),
      ).toHaveLength(2);

      zeroTtl.cleanup();
      expect(harness.files.has(secondAssembly)).toBe(false);
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
      expect(resetWindowsSandboxAdapterCache()).toBe(true);
    }
  });

  it("retries a strict non-recursive directory removal after the helper file is gone", () => {
    vi.useFakeTimers();
    const harness = createWindowsAdapterHarness();
    const removeDirectory = harness.fsRuntime.rmdirSync.getMockImplementation();
    let allowDirectoryRemoval = false;
    harness.fsRuntime.rmdirSync.mockImplementation((value) => {
      if (!allowDirectoryRemoval) {
        const error = new Error(`Directory remains busy: ${value}`);
        error.code = "EACCES";
        throw error;
      }
      return removeDirectory(value);
    });
    try {
      const plan = applyWindowsSandbox(
        "tool.exe",
        [],
        {},
        { profileName: "default" },
        {
          platform: "win32",
          fs: harness.fsRuntime,
          windowsAdapterContent: "adapter-bytes",
          windowsAdapterIdleTtlMs: 0,
          windowsDir: () => "C:\\Windows",
          tmpdir: () => "C:\\temp",
          randomBytes: (size) => Buffer.alloc(size, 0xb5),
          joinPath: path.win32.join,
          sleepSync: vi.fn(),
          spawnSync: harness.spawnSync,
        },
      );
      const { assemblyPath } = harness.decodeInvocationPaths(plan.args);
      const adapterDirectory = path.win32.dirname(assemblyPath);

      plan.cleanup();
      expect(harness.files.has(assemblyPath)).toBe(false);
      expect(harness.directories.has(adapterDirectory)).toBe(true);
      expect(vi.getTimerCount()).toBe(1);

      allowDirectoryRemoval = true;
      vi.advanceTimersByTime(250);
      expect(harness.directories.has(adapterDirectory)).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      allowDirectoryRemoval = true;
      vi.runAllTimers();
      vi.useRealTimers();
      expect(resetWindowsSandboxAdapterCache()).toBe(true);
    }
  });

  it("tracks the helper directory when a partial materialization cannot clean up immediately", () => {
    const harness = createWindowsAdapterHarness();
    const writeFile = harness.fsRuntime.writeFileSync.getMockImplementation();
    const unlink = harness.fsRuntime.unlinkSync.getMockImplementation();
    let helperBusy = true;
    harness.fsRuntime.writeFileSync.mockImplementation(
      (value, content, options) => {
        const result = writeFile(value, content, options);
        if (String(value).endsWith("\\windows-sandbox-helper.exe")) {
          const error = new Error("partial helper write failed");
          error.code = "EIO";
          throw error;
        }
        return result;
      },
    );
    harness.fsRuntime.unlinkSync.mockImplementation((value) => {
      if (
        helperBusy &&
        String(value).endsWith("\\windows-sandbox-helper.exe")
      ) {
        const error = new Error("partial helper is temporarily busy");
        error.code = "EACCES";
        throw error;
      }
      return unlink(value);
    });

    const plan = applyWindowsSandbox(
      "tool.exe",
      [],
      {},
      { profileName: "default" },
      {
        platform: "win32",
        fs: harness.fsRuntime,
        windowsAdapterContent: "adapter-bytes",
        windowsDir: () => "C:\\Windows",
        tmpdir: () => "C:\\temp",
        randomBytes: (size) => Buffer.alloc(size, 0xb8),
        joinPath: path.win32.join,
        sleepSync: vi.fn(),
        spawnSync: harness.spawnSync,
      },
    );
    const adapterDirectory =
      "C:\\temp\\chainless-win-sandbox-" + "b8".repeat(24);
    const assemblyPath = path.win32.join(
      adapterDirectory,
      "windows-sandbox-helper.exe",
    );

    expect(plan).toMatchObject({
      applied: false,
      reason: "windows_native_adapter_compile_cleanup_unverified",
    });
    expect(harness.files.has(assemblyPath)).toBe(true);
    expect(harness.directories.has(adapterDirectory)).toBe(true);

    helperBusy = false;
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
    expect(harness.files.has(assemblyPath)).toBe(false);
    expect(harness.directories.has(adapterDirectory)).toBe(false);
  });

  it("retires the cache entry when an unlink race leaves only a file backlog", () => {
    vi.useFakeTimers();
    const harness = createWindowsAdapterHarness();
    const unlink = harness.fsRuntime.unlinkSync.getMockImplementation();
    const removeDirectory = harness.fsRuntime.rmdirSync.getMockImplementation();
    harness.fsRuntime.unlinkSync.mockImplementation((value) => {
      const target = String(value);
      if (
        target.endsWith("\\windows-sandbox-helper.exe") &&
        harness.files.has(target)
      ) {
        const error = new Error("helper is temporarily busy");
        error.code = "EACCES";
        throw error;
      }
      return unlink(value);
    });
    harness.fsRuntime.rmdirSync.mockImplementation((value) => {
      const directory = String(value);
      const helperPath = path.win32.join(
        directory,
        "windows-sandbox-helper.exe",
      );
      if (harness.files.has(helperPath)) unlink(helperPath);
      return removeDirectory(value);
    });
    try {
      const plan = applyWindowsSandbox(
        "tool.exe",
        [],
        {},
        { profileName: "default" },
        {
          platform: "win32",
          fs: harness.fsRuntime,
          windowsAdapterContent: "adapter-bytes",
          windowsAdapterIdleTtlMs: 0,
          windowsDir: () => "C:\\Windows",
          tmpdir: () => "C:\\temp",
          randomBytes: (size) => Buffer.alloc(size, 0xb6),
          joinPath: path.win32.join,
          sleepSync: vi.fn(),
          spawnSync: harness.spawnSync,
        },
      );
      const { assemblyPath } = harness.decodeInvocationPaths(plan.args);

      plan.cleanup();
      expect(harness.files.has(assemblyPath)).toBe(false);
      expect(vi.getTimerCount()).toBe(1);
      vi.advanceTimersByTime(250);
      expect(vi.getTimerCount()).toBe(0);

      harness.fsRuntime.unlinkSync.mockClear();
      expect(resetWindowsSandboxAdapterCache()).toBe(true);
      expect(harness.fsRuntime.unlinkSync).not.toHaveBeenCalledWith(
        assemblyPath,
      );
    } finally {
      vi.runAllTimers();
      vi.useRealTimers();
      expect(resetWindowsSandboxAdapterCache()).toBe(true);
    }
  });

  it("reports reset success when an immediate retry clears transient backlogs", () => {
    const harness = createWindowsAdapterHarness();
    const plan = applyWindowsSandbox(
      "tool.exe",
      [],
      {},
      { profileName: "default" },
      {
        platform: "win32",
        fs: harness.fsRuntime,
        windowsAdapterContent: "adapter-bytes",
        windowsAdapterIdleTtlMs: 60_000,
        windowsDir: () => "C:\\Windows",
        tmpdir: () => "C:\\temp",
        randomBytes: (size) => Buffer.alloc(size, 0xb7),
        joinPath: path.win32.join,
        sleepSync: vi.fn(),
        spawnSync: harness.spawnSync,
      },
    );
    const { assemblyPath } = harness.decodeInvocationPaths(plan.args);
    const adapterDirectory = path.win32.dirname(assemblyPath);
    const unlink = harness.fsRuntime.unlinkSync.getMockImplementation();
    let transientFailures = 100;
    harness.fsRuntime.unlinkSync.mockImplementation((value) => {
      if (String(value) === assemblyPath && transientFailures > 0) {
        transientFailures -= 1;
        const error = new Error("helper is temporarily busy");
        error.code = "EACCES";
        throw error;
      }
      return unlink(value);
    });

    plan.cleanup();
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
    expect(transientFailures).toBe(0);
    expect(harness.files.has(assemblyPath)).toBe(false);
    expect(harness.directories.has(adapterDirectory)).toBe(false);
  });

  it("rejects and rematerializes a cached helper when its digest or file identity changes", () => {
    const harness = createWindowsAdapterHarness();
    let helperNonce = 0xc0;
    const runtime = {
      platform: "win32",
      fs: harness.fsRuntime,
      windowsAdapterContent: "param()",
      windowsAdapterIdleTtlMs: 60_000,
      windowsDir: () => "C:\\Windows",
      tmpdir: () => "C:\\temp",
      randomBytes: (size) => {
        helperNonce += 1;
        return Buffer.alloc(size, helperNonce);
      },
      joinPath: path.win32.join,
      spawnSync: harness.spawnSync,
    };

    const first = applyWindowsSandbox(
      "first.exe",
      [],
      {},
      { profileName: "default" },
      runtime,
    );
    const firstAssembly = harness.decodeInvocationPaths(
      first.args,
    ).assemblyPath;
    first.cleanup();
    harness.replaceFile(firstAssembly, "tampered assembly");

    const second = applyWindowsSandbox(
      "second.exe",
      [],
      {},
      { profileName: "default" },
      runtime,
    );
    const secondAssembly = harness.decodeInvocationPaths(
      second.args,
    ).assemblyPath;
    expect(secondAssembly).not.toBe(firstAssembly);
    // Product cleanup refuses to unlink a same-path replacement whose stable
    // file identity no longer matches the helper it created.
    expect(harness.files.has(firstAssembly)).toBe(true);
    harness.fsRuntime.unlinkSync(firstAssembly);
    second.cleanup();

    // Byte-identical replacement still changes stable file identity.
    harness.replaceFile(secondAssembly, "param()");
    const third = applyWindowsSandbox(
      "third.exe",
      [],
      {},
      { profileName: "default" },
      runtime,
    );
    const thirdAssembly = harness.decodeInvocationPaths(
      third.args,
    ).assemblyPath;
    expect(thirdAssembly).not.toBe(secondAssembly);
    expect(harness.files.has(secondAssembly)).toBe(true);
    harness.fsRuntime.unlinkSync(secondAssembly);
    expect(
      harness.logicalCalls.filter(
        ({ args: helperArgs }) => helperArgs[0] === "--probe-helper",
      ),
    ).toHaveLength(3);

    third.cleanup();
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
  });

  it("invalidates the process-local helper when built-in adapter content changes", () => {
    const harness = createWindowsAdapterHarness();
    let helperNonce = 0xd0;
    const runtime = {
      platform: "win32",
      fs: harness.fsRuntime,
      windowsAdapterContent: "param([string]$First)",
      windowsDir: () => "C:\\Windows",
      tmpdir: () => "C:\\temp",
      randomBytes: (size) => {
        helperNonce += 1;
        return Buffer.alloc(size, helperNonce);
      },
      joinPath: path.win32.join,
      spawnSync: harness.spawnSync,
    };

    const first = applyWindowsSandbox(
      "first.exe",
      [],
      {},
      { profileName: "default" },
      runtime,
    );
    const firstAssembly = harness.decodeInvocationPaths(
      first.args,
    ).assemblyPath;
    first.cleanup();
    const second = applyWindowsSandbox(
      "second.exe",
      [],
      {},
      { profileName: "default" },
      {
        ...runtime,
        windowsAdapterContent: "param([string]$Second)",
      },
    );

    const secondAssembly = harness.decodeInvocationPaths(
      second.args,
    ).assemblyPath;
    expect(secondAssembly).not.toBe(firstAssembly);
    expect(harness.files.has(firstAssembly)).toBe(false);
    expect(
      harness.logicalCalls.filter(
        ({ args: helperArgs }) => helperArgs[0] === "--probe-helper",
      ),
    ).toHaveLength(2);
    second.cleanup();
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
  });

  it("returns an attested zero-capability AppContainer plan for required filesystem and network boundaries", () => {
    const appContainerSid = "S-1-15-2-1-2-3-4-5-6-7";
    const helperSpawnSync = vi.fn((helper, helperArgs) => {
      if (helperArgs[0] === "--prepare-appcontainer") {
        return {
          status: 0,
          stdout: JSON.stringify({
            ready: true,
            profileName: helperArgs[1],
            appContainerSid,
            capabilityCount: 0,
            tokenAttested: true,
            restrictedTokenAttested: true,
          }),
          stderr: "",
        };
      }
      if (helperArgs[0] === "--delete-appcontainer") {
        return {
          status: 0,
          stdout: JSON.stringify({
            deleted: true,
            absent: true,
            profileName: helperArgs[1],
          }),
          stderr: "",
        };
      }
      throw new Error(`Unexpected helper invocation: ${helper} ${helperArgs}`);
    });
    const harness = createWindowsAdapterHarness({ helperSpawnSync });
    const plan = applyWindowsSandbox(
      "tool.exe",
      ["run"],
      { env: { PATH: "C:\\Windows" } },
      {
        profileName: "strict",
        requiredBoundaries: [
          SANDBOX_BOUNDARIES.FILESYSTEM,
          SANDBOX_BOUNDARIES.NETWORK,
        ],
        sync: true,
      },
      {
        platform: "win32",
        fs: harness.fsRuntime,
        windowsAdapterContent: "param()",
        tmpdir: () => "C:\\temp",
        randomBytes: (size) => Buffer.alloc(size, 9),
        joinPath: path.win32.join,
        spawnSync: harness.spawnSync,
      },
    );

    expect(plan).toMatchObject({
      applied: true,
      backend: "windows-appcontainer-job-restricted-token",
      enforcement: "windows-appcontainer-job-restricted-token",
      policyAttested: true,
      guarantees: [
        SANDBOX_BOUNDARIES.FILESYSTEM,
        SANDBOX_BOUNDARIES.NETWORK,
        SANDBOX_BOUNDARIES.PROCESS_TREE,
        SANDBOX_BOUNDARIES.RESOURCE_LIMITS,
        SANDBOX_BOUNDARIES.PRIVILEGE_REDUCTION,
      ],
      runtimeProbe: {
        kind: "windows-appcontainer-launch-attestation-v1",
        attempted: true,
        runnable: true,
        reason: null,
      },
      postSpawn: { required: false, mode: "none" },
    });
    const readinessCall = helperSpawnSync.mock.calls[0];
    expect(readinessCall[1]).toEqual([
      "--prepare-appcontainer",
      "ChainlessChain.CliSandbox.090909090909090909090909",
    ]);
    expect(readinessCall[2]).toMatchObject({
      shell: false,
      windowsHide: true,
      encoding: "utf8",
      timeout: 120_000,
    });
    const payload = decodeWindowsLaunchSpec(harness, plan);
    expect(payload).toMatchObject({
      command: "tool.exe",
      args: ["run"],
      allowReparsePaths: false,
      disableAdministratorSids: true,
      appContainerProfileName:
        "ChainlessChain.CliSandbox.090909090909090909090909",
      appContainerSid,
      detached: false,
    });
    expect(payload).not.toHaveProperty("identityPath");
    expect(payload.environment).toMatchObject({
      CC_WINDOWS_APPCONTAINER: "1",
      CC_WINDOWS_APPCONTAINER_PROFILE:
        "ChainlessChain.CliSandbox.090909090909090909090909",
      CC_WINDOWS_APPCONTAINER_SID: appContainerSid,
    });

    plan.cleanup();
    expect(helperSpawnSync.mock.calls[1][1]).toEqual([
      "--delete-appcontainer",
      "ChainlessChain.CliSandbox.090909090909090909090909",
      appContainerSid,
    ]);
    const { assemblyPath } = harness.decodeInvocationPaths(plan.args);
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
    expect(harness.fsRuntime.unlinkSync).toHaveBeenCalledWith(assemblyPath);
  });

  it("retries AppContainer cleanup before reporting a synchronous failure", () => {
    const appContainerSid = "S-1-15-2-71-72-73-74-75-76-77";
    let deletionAttempts = 0;
    const helperSpawnSync = vi.fn((_helper, helperArgs) => {
      if (helperArgs[0] === "--prepare-appcontainer") {
        return {
          status: 0,
          stdout: JSON.stringify({
            ready: true,
            profileName: helperArgs[1],
            appContainerSid,
            capabilityCount: 0,
            tokenAttested: true,
            restrictedTokenAttested: true,
          }),
          stderr: "",
        };
      }
      if (helperArgs[0] === "--delete-appcontainer") {
        deletionAttempts += 1;
        if (deletionAttempts === 1) {
          return {
            status: 125,
            stdout: "",
            stderr: "profile is still in use",
          };
        }
        return {
          status: 0,
          stdout: JSON.stringify({
            deleted: true,
            absent: true,
            profileName: helperArgs[1],
          }),
          stderr: "",
        };
      }
      throw new Error(`Unexpected helper invocation: ${helperArgs}`);
    });
    const harness = createWindowsAdapterHarness({ helperSpawnSync });
    const sleepSync = vi.fn();
    const plan = applyWindowsSandbox(
      "tool.exe",
      [],
      {},
      {
        profileName: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
        sync: true,
      },
      {
        platform: "win32",
        fs: harness.fsRuntime,
        windowsAdapterContent: "adapter-bytes",
        tmpdir: () => "C:\\temp",
        randomBytes: (size) => Buffer.alloc(size, 0x47),
        joinPath: path.win32.join,
        sleepSync,
        spawnSync: harness.spawnSync,
      },
    );

    expect(plan.applied).toBe(true);
    expect(plan.cleanup()).toBe(true);
    expect(deletionAttempts).toBe(2);
    expect(sleepSync).toHaveBeenCalledWith(25);
    expect(plan.cleanup()).toBe(true);
    expect(deletionAttempts).toBe(2);
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
  });

  it("reacquires the helper when AppContainer cleanup succeeds only after a reported failure", () => {
    const appContainerSid = "S-1-15-2-81-82-83-84-85-86-87";
    let deletionAttempts = 0;
    const helperSpawnSync = vi.fn((_helper, helperArgs) => {
      if (helperArgs[0] === "--prepare-appcontainer") {
        return {
          status: 0,
          stdout: JSON.stringify({
            ready: true,
            profileName: helperArgs[1],
            appContainerSid,
            capabilityCount: 0,
            tokenAttested: true,
            restrictedTokenAttested: true,
          }),
          stderr: "",
        };
      }
      if (helperArgs[0] === "--delete-appcontainer") {
        deletionAttempts += 1;
        if (deletionAttempts <= 4) {
          return {
            status: 125,
            stdout: "",
            stderr: "profile is still in use",
          };
        }
        return {
          status: 0,
          stdout: JSON.stringify({
            deleted: true,
            absent: true,
            profileName: helperArgs[1],
          }),
          stderr: "",
        };
      }
      throw new Error(`Unexpected helper invocation: ${helperArgs}`);
    });
    const harness = createWindowsAdapterHarness({ helperSpawnSync });
    const plan = applyWindowsSandbox(
      "tool.exe",
      [],
      {},
      {
        profileName: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
        sync: true,
      },
      {
        platform: "win32",
        fs: harness.fsRuntime,
        windowsAdapterContent: "adapter-bytes",
        tmpdir: () => "C:\\temp",
        randomBytes: (size) => Buffer.alloc(size, 0x51),
        joinPath: path.win32.join,
        sleepSync: vi.fn(),
        spawnSync: harness.spawnSync,
      },
    );

    expect(plan.applied).toBe(true);
    expect(() => plan.cleanup()).toThrow(
      "Windows sandbox cleanup could not be verified for AppContainer profile",
    );
    expect(deletionAttempts).toBe(4);
    expect(plan.cleanup()).toBe(true);
    expect(deletionAttempts).toBe(5);
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
  });

  it("bounds automatic AppContainer cleanup retries after a permanent failure", () => {
    vi.useFakeTimers();
    const appContainerSid = "S-1-15-2-88-89-90-91-92-93-94";
    let deletionAttempts = 0;
    let deletionSucceeds = false;
    const helperSpawnSync = vi.fn((_helper, helperArgs) => {
      if (helperArgs[0] === "--prepare-appcontainer") {
        return {
          status: 0,
          stdout: JSON.stringify({
            ready: true,
            profileName: helperArgs[1],
            appContainerSid,
            capabilityCount: 0,
            tokenAttested: true,
            restrictedTokenAttested: true,
          }),
          stderr: "",
        };
      }
      if (helperArgs[0] === "--delete-appcontainer") {
        deletionAttempts += 1;
        if (!deletionSucceeds) {
          return {
            status: 125,
            stdout: "",
            stderr: "AppContainer APIs remain unavailable",
          };
        }
        return {
          status: 0,
          stdout: JSON.stringify({
            deleted: true,
            absent: true,
            profileName: helperArgs[1],
          }),
          stderr: "",
        };
      }
      throw new Error(`Unexpected helper invocation: ${helperArgs}`);
    });
    const harness = createWindowsAdapterHarness({ helperSpawnSync });
    let plan;
    try {
      plan = applyWindowsSandbox(
        "tool.exe",
        [],
        {},
        {
          profileName: "strict",
          requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
          sync: true,
        },
        {
          platform: "win32",
          fs: harness.fsRuntime,
          windowsAdapterContent: "adapter-bytes",
          tmpdir: () => "C:\\temp",
          randomBytes: (size) => Buffer.alloc(size, 0x58),
          joinPath: path.win32.join,
          sleepSync: vi.fn(),
          spawnSync: harness.spawnSync,
        },
      );

      expect(plan.applied).toBe(true);
      expect(() => plan.cleanup()).toThrow(
        "Windows sandbox cleanup could not be verified for AppContainer profile",
      );
      expect(deletionAttempts).toBe(4);
      vi.runAllTimers();
      expect(deletionAttempts).toBe(7);
      expect(vi.getTimerCount()).toBe(0);

      deletionSucceeds = true;
      expect(resetWindowsSandboxAdapterCache()).toBe(true);
      expect(deletionAttempts).toBe(8);
    } finally {
      deletionSucceeds = true;
      resetWindowsSandboxAdapterCache();
      vi.useRealTimers();
    }
  });

  it("keeps automatic AppContainer backoff independent for staggered profiles", () => {
    vi.useFakeTimers();
    const createFailingProfile = (nonce, appContainerSid) => {
      let deletionAttempts = 0;
      let deletionSucceeds = false;
      const helperSpawnSync = vi.fn((_helper, helperArgs) => {
        if (helperArgs[0] === "--prepare-appcontainer") {
          return {
            status: 0,
            stdout: JSON.stringify({
              ready: true,
              profileName: helperArgs[1],
              appContainerSid,
              capabilityCount: 0,
              tokenAttested: true,
              restrictedTokenAttested: true,
            }),
            stderr: "",
          };
        }
        if (helperArgs[0] === "--delete-appcontainer") {
          deletionAttempts += 1;
          if (!deletionSucceeds) {
            return {
              status: 125,
              stdout: "",
              stderr: "profile remains busy",
            };
          }
          return {
            status: 0,
            stdout: JSON.stringify({
              deleted: true,
              absent: true,
              profileName: helperArgs[1],
            }),
            stderr: "",
          };
        }
        throw new Error(`Unexpected helper invocation: ${helperArgs}`);
      });
      const harness = createWindowsAdapterHarness({ helperSpawnSync });
      const plan = applyWindowsSandbox(
        "tool.exe",
        [],
        {},
        {
          profileName: "strict",
          requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
          sync: true,
        },
        {
          platform: "win32",
          fs: harness.fsRuntime,
          windowsAdapterContent: "adapter-bytes",
          tmpdir: () => "C:\\temp",
          randomBytes: (size) => Buffer.alloc(size, nonce),
          joinPath: path.win32.join,
          sleepSync: vi.fn(),
          spawnSync: harness.spawnSync,
        },
      );
      expect(plan.applied).toBe(true);
      expect(() => plan.cleanup()).toThrow(
        "Windows sandbox cleanup could not be verified for AppContainer profile",
      );
      return {
        attempts: () => deletionAttempts,
        allowCleanup: () => {
          deletionSucceeds = true;
        },
      };
    };

    let first;
    let second;
    try {
      first = createFailingProfile(
        0x61,
        "S-1-15-2-101-102-103-104-105-106-107",
      );
      expect(first.attempts()).toBe(4);
      vi.advanceTimersByTime(250);
      expect(first.attempts()).toBe(5);
      vi.advanceTimersByTime(1_000);
      expect(first.attempts()).toBe(6);

      second = createFailingProfile(
        0x62,
        "S-1-15-2-111-112-113-114-115-116-117",
      );
      expect(second.attempts()).toBe(4);
      vi.advanceTimersByTime(250);
      expect(second.attempts()).toBe(5);
      expect(first.attempts()).toBe(6);
      vi.advanceTimersByTime(1_000);
      expect(second.attempts()).toBe(6);
      expect(first.attempts()).toBe(6);

      first.allowCleanup();
      second.allowCleanup();
      expect(resetWindowsSandboxAdapterCache()).toBe(true);
      expect(first.attempts()).toBe(7);
      expect(second.attempts()).toBe(7);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      first?.allowCleanup();
      second?.allowCleanup();
      resetWindowsSandboxAdapterCache();
      vi.useRealTimers();
    }
  });

  it("tracks AppContainer cleanup when readiness fails before a plan is returned", () => {
    let deletionAttempts = 0;
    const helperSpawnSync = vi.fn((_helper, helperArgs) => {
      if (helperArgs[0] === "--prepare-appcontainer") {
        return {
          status: 125,
          stdout: "",
          stderr: "readiness failed after creating the profile",
        };
      }
      if (helperArgs[0] === "--delete-appcontainer") {
        deletionAttempts += 1;
        if (deletionAttempts === 1) {
          return {
            status: 125,
            stdout: "",
            stderr: "profile is still in use",
          };
        }
        return {
          status: 0,
          stdout: JSON.stringify({
            deleted: true,
            absent: true,
            profileName: helperArgs[1],
          }),
          stderr: "",
        };
      }
      throw new Error(`Unexpected helper invocation: ${helperArgs}`);
    });
    const harness = createWindowsAdapterHarness({ helperSpawnSync });
    const runtime = {
      platform: "win32",
      fs: harness.fsRuntime,
      windowsAdapterContent: "adapter-bytes",
      tmpdir: () => "C:\\temp",
      randomBytes: (size) => Buffer.alloc(size, 0x53),
      joinPath: path.win32.join,
      spawnSync: harness.spawnSync,
    };

    const plan = applyWindowsSandbox(
      "tool.exe",
      [],
      {},
      {
        profileName: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
        sync: true,
      },
      runtime,
    );

    expect(plan).toMatchObject({
      applied: false,
      reason: "windows_appcontainer_readiness_cleanup_unverified",
      runtimeProbe: {
        kind: "windows-appcontainer-launch-attestation-v1",
        attempted: true,
        runnable: false,
        reason:
          "cleanup_unverified_after_probe_failed_helper_exit_125_because_cleanup_failed_helper_exit_125",
      },
    });
    expect(deletionAttempts).toBe(1);
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
    expect(deletionAttempts).toBe(2);
  });

  it("tracks AppContainer cleanup when final invocation creation fails", () => {
    const appContainerSid = "S-1-15-2-91-92-93-94-95-96-97";
    let deletionAttempts = 0;
    const helperSpawnSync = vi.fn((_helper, helperArgs) => {
      if (helperArgs[0] === "--prepare-appcontainer") {
        return {
          status: 0,
          stdout: JSON.stringify({
            ready: true,
            profileName: helperArgs[1],
            appContainerSid,
            capabilityCount: 0,
            tokenAttested: true,
            restrictedTokenAttested: true,
          }),
          stderr: "",
        };
      }
      if (helperArgs[0] === "--delete-appcontainer") {
        deletionAttempts += 1;
        if (deletionAttempts === 1) {
          return {
            status: 125,
            stdout: "",
            stderr: "profile is still in use",
          };
        }
        return {
          status: 0,
          stdout: JSON.stringify({
            deleted: true,
            absent: true,
            profileName: helperArgs[1],
          }),
          stderr: "",
        };
      }
      throw new Error(`Unexpected helper invocation: ${helperArgs}`);
    });
    const harness = createWindowsAdapterHarness({ helperSpawnSync });
    const writeFile = harness.fsRuntime.writeFileSync.getMockImplementation();
    let invocationWrites = 0;
    harness.fsRuntime.writeFileSync.mockImplementation(
      (filePath, content, options) => {
        if (
          String(filePath).includes("chainless-win-sandbox-invocation-") &&
          (invocationWrites += 1) === 3
        ) {
          const error = new Error("final invocation write failed");
          error.code = "EACCES";
          throw error;
        }
        return writeFile(filePath, content, options);
      },
    );
    const runtime = {
      platform: "win32",
      fs: harness.fsRuntime,
      windowsAdapterContent: "adapter-bytes",
      tmpdir: () => "C:\\temp",
      randomBytes: (size) => Buffer.alloc(size, 0x59),
      joinPath: path.win32.join,
      spawnSync: harness.spawnSync,
    };

    const plan = applyWindowsSandbox(
      "tool.exe",
      [],
      {},
      {
        profileName: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
        sync: true,
      },
      runtime,
    );

    expect(plan).toMatchObject({
      applied: false,
      reason: "windows_appcontainer_readiness_cleanup_unverified",
      runtimeProbe: {
        kind: "windows-appcontainer-launch-attestation-v1",
        attempted: true,
        runnable: false,
        reason:
          "cleanup_unverified_after_ready_because_cleanup_failed_helper_exit_125",
      },
    });
    expect(deletionAttempts).toBe(1);
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
    expect(deletionAttempts).toBe(2);
    expect(helperSpawnSync.mock.calls.at(-1)?.[1]).toEqual([
      "--delete-appcontainer",
      "ChainlessChain.CliSandbox.595959595959595959595959",
      appContainerSid,
    ]);
  });

  it("re-attests and refreshes the helper before AppContainer cleanup invocation", () => {
    const appContainerSid = "S-1-15-2-21-22-23-24-25-26-27";
    const helperSpawnSync = vi.fn((_helper, helperArgs) => {
      if (helperArgs[0] === "--prepare-appcontainer") {
        return {
          status: 0,
          stdout: JSON.stringify({
            ready: true,
            profileName: helperArgs[1],
            appContainerSid,
            capabilityCount: 0,
            tokenAttested: true,
            restrictedTokenAttested: true,
          }),
          stderr: "",
        };
      }
      if (helperArgs[0] === "--delete-appcontainer") {
        return {
          status: 0,
          stdout: JSON.stringify({
            deleted: true,
            absent: true,
            profileName: helperArgs[1],
          }),
          stderr: "",
        };
      }
      throw new Error(`Unexpected helper invocation: ${helperArgs}`);
    });
    const harness = createWindowsAdapterHarness({ helperSpawnSync });
    let helperNonce = 0;
    const plan = applyWindowsSandbox(
      "tool.exe",
      [],
      {},
      {
        profileName: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
        sync: true,
      },
      {
        platform: "win32",
        fs: harness.fsRuntime,
        windowsAdapterContent: "param()",
        tmpdir: () => "C:\\temp",
        randomBytes: (size) => {
          if (size === 12) return Buffer.alloc(size, 0x2a);
          helperNonce += 1;
          return Buffer.alloc(size, helperNonce);
        },
        joinPath: path.win32.join,
        spawnSync: harness.spawnSync,
      },
    );
    expect(plan.applied).toBe(true);
    const initialAssembly = harness.decodeInvocationPaths(
      plan.args,
    ).assemblyPath;
    harness.replaceFile(initialAssembly, "tampered before cleanup");

    plan.cleanup();

    expect(harness.logicalCalls[1].invocationPaths.assemblyPath).toBe(
      initialAssembly,
    );
    expect(harness.logicalCalls.at(-1).invocationPaths.assemblyPath).not.toBe(
      initialAssembly,
    );
    expect(helperSpawnSync.mock.calls[1][1][0]).toBe("--delete-appcontainer");
    expect(harness.files.has(initialAssembly)).toBe(true);
    harness.fsRuntime.unlinkSync(initialAssembly);
    expect(
      harness.logicalCalls.filter(
        ({ args: helperArgs }) => helperArgs[0] === "--probe-helper",
      ),
    ).toHaveLength(2);
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
  });

  it("keeps AppContainer guarantees unavailable when synchronous launch attestation fails", () => {
    const warn = vi.fn();
    const helperSpawnSync = vi
      .fn()
      .mockReturnValueOnce({
        status: 125,
        stdout: "",
        stderr:
          "CC_WINDOWS_SANDBOX_ERROR: CreateAppContainerProfile failed (hresult=0x800706D9)",
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({
          deleted: true,
          absent: true,
          profileName: "ChainlessChain.CliSandbox.060606060606060606060606",
        }),
        stderr: "",
      });
    const harness = createWindowsAdapterHarness({ helperSpawnSync });
    const plan = applyWindowsSandbox(
      "tool.exe",
      [],
      {},
      {
        profileName: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
        sync: true,
      },
      {
        platform: "win32",
        fs: harness.fsRuntime,
        windowsAdapterContent: "param()",
        tmpdir: () => "C:\\temp",
        randomBytes: (size) => Buffer.alloc(size, 6),
        joinPath: path.win32.join,
        spawnSync: harness.spawnSync,
        warn,
      },
    );

    expect(plan).toMatchObject({
      applied: false,
      backend: null,
      candidateBackend: "windows-appcontainer-job-restricted-token",
      policyAttested: false,
      reason: "windows_appcontainer_readiness_failed",
      guarantees: [],
      runtimeProbe: {
        kind: "windows-appcontainer-launch-attestation-v1",
        attempted: true,
        runnable: false,
        reason:
          "probe_failed_helper_exit_125_appcontainer_profile_create_0x800706d9",
      },
    });
    expect(plan.policyDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(helperSpawnSync.mock.calls[1][1]).toEqual([
      "--delete-appcontainer",
      "ChainlessChain.CliSandbox.060606060606060606060606",
    ]);
    expect(helperSpawnSync.mock.calls[1][2]).toMatchObject({
      timeout: 120_000,
    });
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
    expect(harness.fsRuntime.unlinkSync).toHaveBeenCalledWith(
      expect.stringMatching(/chainless-win-sandbox-[a-f0-9]+\.dll$/),
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("requires per-target AppContainer identity attestation for asynchronous Windows launches", () => {
    const appContainerSid = "S-1-15-2-11-12-13-14-15-16-17";
    let identityPath;
    const readFileSync = vi.fn((filePath) => {
      identityPath = filePath;
      return JSON.stringify({
        targetPid: 5103,
        helperPid: 4102,
        appContainer: true,
        appContainerSid,
        capabilityCount: 0,
      });
    });
    const helperSpawnSync = vi.fn((helper, helperArgs) => {
      if (helperArgs[0] === "--prepare-appcontainer") {
        return {
          status: 0,
          stdout: JSON.stringify({
            ready: true,
            profileName: helperArgs[1],
            appContainerSid,
            capabilityCount: 0,
            tokenAttested: true,
            restrictedTokenAttested: true,
          }),
          stderr: "",
        };
      }
      if (helperArgs[0] === "--delete-appcontainer") {
        return {
          status: 0,
          stdout: JSON.stringify({
            deleted: true,
            absent: true,
            profileName: helperArgs[1],
          }),
          stderr: "",
        };
      }
      throw new Error(`Unexpected helper invocation: ${helper} ${helperArgs}`);
    });
    const harness = createWindowsAdapterHarness({
      helperSpawnSync,
      readFileSync,
    });
    const plan = applyWindowsSandbox(
      "tool.exe",
      [],
      { stdio: "ignore" },
      {
        profileName: "strict",
        requiredBoundaries: [SANDBOX_BOUNDARIES.NETWORK],
        sync: false,
      },
      {
        platform: "win32",
        fs: harness.fsRuntime,
        windowsAdapterContent: "param()",
        tmpdir: () => "C:\\temp",
        now: vi.fn(() => 100),
        sleepSync: vi.fn(),
        randomBytes: (size) => Buffer.alloc(size, 8),
        joinPath: path.win32.join,
        spawnSync: harness.spawnSync,
      },
    );

    expect(plan.postSpawn).toEqual({ required: true, mode: "sync" });
    const payload = decodeWindowsLaunchSpec(harness, plan);
    expect(payload.identityPath).toMatch(
      /^C:\\temp\\chainless-win-sandbox-identity-[a-f0-9]+\.json$/,
    );
    const child = createChild(4102);
    expect(plan.postSpawnWindows(child)).toEqual({
      targetPid: 5103,
      wrapperPid: 4102,
      appContainerProfileName:
        "ChainlessChain.CliSandbox.080808080808080808080808",
      appContainerSid,
      capabilityCount: 0,
    });
    expect(child).toMatchObject({
      pid: 5103,
      sandboxWrapperPid: 4102,
      sandboxTargetPid: 5103,
      sandboxAppContainerProfile:
        "ChainlessChain.CliSandbox.080808080808080808080808",
      sandboxAppContainerSid: appContainerSid,
      sandboxAppContainerCapabilityCount: 0,
    });
    expect(identityPath).toBe(payload.identityPath);
    const { assemblyPath } = harness.decodeInvocationPaths(plan.args);
    plan.cleanup();
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
    expect(harness.fsRuntime.unlinkSync).toHaveBeenCalledWith(assemblyPath);
  });

  it("uses only documented AppContainer attributes and attests the suspended target before resume", () => {
    expect(windowsSandboxSource).toContain(
      "PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES",
    );
    expect(windowsSandboxSource).toContain("new IntPtr(0x00020009)");
    expect(windowsSandboxSource).toContain("CreateAppContainerProfile");
    expect(windowsSandboxSource).toContain("DeleteAppContainerProfile");
    expect(windowsSandboxSource).toContain("TokenIsAppContainer");
    expect(windowsSandboxSource).toContain("TokenCapabilities");
    expect(windowsSandboxSource).toContain("TokenAppContainerSid");
    expect(windowsSandboxSource).toContain("EqualSid");
    expect(windowsSandboxSource).toContain("CreateProcessAsUser");
    expect(windowsSandboxSource).not.toContain('EntryPoint = "CreateProcessW"');
    expect(windowsSandboxSource).toContain("CreateProcessAsUser(AppContainer)");
    expect(windowsSandboxSource).toContain("TerminateAndAwaitEmptyJob");
    expect(windowsSandboxSource).toContain("DataContractJsonSerializer");
    expect(windowsSandboxSource).not.toContain("System.Web");
    expect(platformSandboxSource).toContain(
      "$ccAssembly=[Reflection.Assembly]::Load($ccAssemblyBytes)",
    );
    expect(platformSandboxSource).toContain(
      String.raw`\\?\GLOBALROOT\SystemRoot`,
    );
    expect(platformSandboxSource).not.toContain("process.env.WINDIR");
    expect(platformSandboxSource).toContain(
      "[IO.File]::Delete($ccPayloadPath)",
    );
    expect(platformSandboxSource).toContain(
      "Windows sandbox adapter input digest mismatch",
    );
    expect(platformSandboxSource).toContain('"powershell.exe"');
    expect(platformSandboxSource).toContain('"-EncodedCommand"');
    expect(platformSandboxSource).not.toContain('"-File"');
    expect(platformSandboxSource).not.toContain('"-CompileOnly"');
    expect(windowsSandboxSource).toMatch(
      /environmentBuffer =\s+BuildEnvironmentBlock\(targetEnvironment\);/,
    );
    expect(windowsSandboxSource).not.toContain("inheritCallerEnvironment");
    expect(windowsSandboxSource).toMatch(
      /CREATE_SUSPENDED\s*\|\s*CREATE_UNICODE_ENVIRONMENT\s*\|\s*EXTENDED_STARTUPINFO_PRESENT/,
    );
    expect(windowsSandboxSource).toMatch(
      /spec == null \|\|\s+String\.IsNullOrWhiteSpace\(spec\.command\) \|\|\s+spec\.environment == null/,
    );
    expect(windowsSandboxSource).toContain(
      "private static extern UInt32 GetDriveType(string rootPathName);",
    );
    expect(windowsSandboxSource).toContain(
      'description + " must use a local DOS drive"',
    );
    expect(windowsSandboxSource).toContain(
      "ValidateExistingLocalNonReparsePath(",
    );
    expect(windowsSandboxSource).not.toContain("Environment.CurrentDirectory");
    expect(windowsSandboxSource).not.toMatch(
      /SetNamedSecurityInfo|AddAccessAllowedAce|SetEntriesInAcl/,
    );
    expect(
      windowsSandboxSource.indexOf(
        "attestedAppContainerSid = AttestAppContainerTarget",
      ),
    ).toBeLessThan(
      windowsSandboxSource.indexOf(
        "if (ResumeThread(processInfo.hThread) == UInt32.MaxValue)",
      ),
    );
  });

  it("keeps Windows MCP plan issuance private and revokes it before cleanup", () => {
    const windowsApplyStart = platformSandboxSource.indexOf(
      "export function applyWindowsSandbox(",
    );
    const windowsApplyEnd = platformSandboxSource.indexOf(
      "export function postSpawnWindowsSandbox(",
      windowsApplyStart,
    );
    const windowsApplySource = platformSandboxSource.slice(
      windowsApplyStart,
      windowsApplyEnd,
    );
    const cleanupStart = windowsApplySource.indexOf("const cleanup = () => {");
    const revokeIndex = windowsApplySource.indexOf(
      "issuedWindowsMcpCodeSnapshotPlans.delete(issuedWindowsMcpPlan)",
      cleanupStart,
    );
    const cleanupWorkIndex = windowsApplySource.indexOf(
      "const failures = []",
      cleanupStart,
    );

    expect(windowsApplySource).toContain(
      "planBindingAuthority === WINDOWS_MCP_CODE_SNAPSHOT_ISSUER",
    );
    expect(cleanupStart).toBeGreaterThanOrEqual(0);
    expect(revokeIndex).toBeGreaterThan(cleanupStart);
    expect(revokeIndex).toBeLessThan(cleanupWorkIndex);

    const unifiedApplyStart = platformSandboxSource.indexOf(
      "export function applySandbox(",
    );
    const unifiedApplySource = platformSandboxSource.slice(unifiedApplyStart);
    expect(unifiedApplySource).toContain(
      "runtimeInjected ? null : WINDOWS_MCP_CODE_SNAPSHOT_ISSUER",
    );

    const consumeStart = platformSandboxSource.indexOf(
      "export function consumeWindowsMcpCodeSnapshotPlanBinding(",
    );
    const consumeEnd = platformSandboxSource.indexOf(
      "function windowsFileIdentity(",
      consumeStart,
    );
    const consumeSource = platformSandboxSource.slice(consumeStart, consumeEnd);
    expect(
      consumeSource.indexOf("issuedWindowsMcpCodeSnapshotPlans.delete(plan)"),
    ).toBeLessThan(consumeSource.indexOf("return ("));

    const postSpawnStart = processExecutionBrokerSource.indexOf(
      "_runPostSpawnSandbox(proc, plan, auditEntry) {",
    );
    const postSpawnEnd = processExecutionBrokerSource.indexOf(
      "_credentialBoundaryEnabled() {",
      postSpawnStart,
    );
    const postSpawnSource = processExecutionBrokerSource.slice(
      postSpawnStart,
      postSpawnEnd,
    );
    expect(postSpawnSource).toContain('"windows_mcp_plan_binding_consumed"');
    expect(
      postSpawnSource.indexOf(
        "admittedWindowsMcpCodeSnapshotPlans.delete(plan)",
      ),
    ).toBeLessThan(postSpawnSource.indexOf("postSpawnAdapter(proc, plan)"));
    expect(processExecutionBrokerSource).toContain(
      "admittedWindowsMcpCodeSnapshotPlans.delete(assertedPlan)",
    );
    expect(processExecutionBrokerSource).not.toContain(
      "applySandboxAdapter.call(",
    );
    expect(processExecutionBrokerSource).toMatch(
      /builtInSandboxAdapter\s*\?\s*_applySandbox\(/,
    );
    expect(consumeSource).toContain(
      "sameWindowsStdio(issued.helperStdio, plan.options?.stdio)",
    );
  });

  it("reapplies restricted-token policy idempotently for nested workers", () => {
    const runStart = windowsSandboxSource.indexOf("public static int Run(");
    const runEnd = windowsSandboxSource.indexOf(
      "public static void WriteIdentityError(",
      runStart,
    );
    const runSource = windowsSandboxSource.slice(runStart, runEnd);

    expect(windowsSandboxSource).toContain(
      "private static bool TokenHasUnexpectedEnabledPrivileges(IntPtr token)",
    );
    expect(windowsSandboxSource).toContain(
      "private static bool TokenWasFiltered(IntPtr token)",
    );
    expect(windowsSandboxSource).toContain(
      "private static bool TokenHasEnabledAdministratorSid(IntPtr token)",
    );
    expect(windowsSandboxSource).toContain(
      "private static extern bool DuplicateTokenEx(",
    );
    expect(windowsSandboxSource).toContain(
      "private static void AssertRestrictedTokenPolicy(",
    );
    expect(runSource).toContain("UInt32 restrictedTokenFlags = 0;");
    expect(runSource).toMatch(
      /!sourceTokenWasFiltered \|\|\s+sourceTokenHasUnexpectedEnabledPrivileges/,
    );
    expect(runSource).toMatch(
      /sourceTokenHasEnabledAdministratorSid\)\s+\{\s+restrictedTokenFlags \|= LUA_TOKEN/,
    );
    expect(runSource).toMatch(
      /restrictedTokenFlags == 0\)[\s\S]*DuplicateTokenEx\([\s\S]*TokenPrimary,[\s\S]*out restrictedToken\)/,
    );
    expect(runSource).toMatch(
      /else\s+\{[\s\S]*CreateRestrictedToken\([\s\S]*restrictedTokenFlags,[\s\S]*out restrictedToken\)/,
    );
    expect(runSource).toMatch(
      /AssertRestrictedTokenPolicy\(\s*restrictedToken,\s*disableAdministratorSids\);/,
    );
    expect(runSource).not.toContain("IsTokenRestricted(");
    expect(runSource).not.toContain("CC_WINDOWS_SANDBOXED");
  });

  it("builds an explicit AppContainer environment for readiness probes", () => {
    const nodeProbeStart = windowsSandboxSource.indexOf(
      "public static int RunNodeSnapshotProbe(",
    );
    const nativeRunStart = windowsSandboxSource.indexOf(
      "public static int Run(",
      nodeProbeStart,
    );
    const nodeProbeSource = windowsSandboxSource.slice(
      nodeProbeStart,
      nativeRunStart,
    );
    expect(nodeProbeSource).toMatch(
      /Environment\.SystemDirectory,\s+null,\s+null,\s+appContainerProfileName,/,
    );

    const prepareStart = windowsSandboxSource.indexOf(
      '"--prepare-appcontainer"',
    );
    const deleteStart = windowsSandboxSource.indexOf(
      '"--delete-appcontainer"',
      prepareStart,
    );
    const prepareSource = windowsSandboxSource.slice(prepareStart, deleteStart);
    expect(prepareSource).toMatch(
      /Environment\.SystemDirectory,\s+null,\s+null,\s+profileName,/,
    );

    const configureStart = windowsSandboxSource.indexOf(
      "private static void ConfigureAppContainerEnvironment(",
    );
    const environmentBlockStart = windowsSandboxSource.indexOf(
      "private static IntPtr BuildEnvironmentBlock(",
      configureStart,
    );
    const configureSource = windowsSandboxSource.slice(
      configureStart,
      environmentBlockStart,
    );
    expect(configureSource).toContain('"LOCALAPPDATA"');
    expect(configureSource).toContain('"TEMP"');
    expect(configureSource).toContain('"TMP"');
    expect(configureSource).toContain('"SystemDrive"');
    expect(configureSource).toContain(
      "Environment.SpecialFolder.LocalApplicationData",
    );
    expect(configureSource).toContain('Path.Combine(localAppData, "Temp")');

    const runStart = windowsSandboxSource.indexOf("public static int Run(");
    const runEnd = windowsSandboxSource.indexOf(
      "public static void WriteIdentityError(",
      runStart,
    );
    const runSource = windowsSandboxSource.slice(runStart, runEnd);
    expect(runSource).not.toContain("inheritCallerEnvironment");
    expect(
      runSource.indexOf("preparedSid = SidToString(appContainerSid);"),
    ).toBeLessThan(runSource.indexOf("ConfigureAppContainerEnvironment("));
    expect(runSource.indexOf("ConfigureAppContainerEnvironment(")).toBeLessThan(
      runSource.indexOf("BuildEnvironmentBlock(targetEnvironment)"),
    );
    expect(windowsSandboxSource).toMatch(
      /spec == null \|\|\s+String\.IsNullOrWhiteSpace\(spec\.command\) \|\|\s+spec\.environment == null/,
    );
    expect(platformSandboxSource).not.toMatch(
      /function windowsSandboxHostEnvironment[\s\S]*LOCALAPPDATA/,
    );
  });

  it("maps Node path-stat identities to the same locked native file", () => {
    expect(windowsSandboxSource).toContain(
      "private const Int32 FileStatInformation = 68;",
    );
    expect(windowsSandboxSource).toMatch(
      /NtQueryInformationFile\(\s*handle,[\s\S]*FileStatInformation\);/,
    );
    expect(windowsSandboxSource).toMatch(
      /"api-ms-win-core-file-l2-1-4\.dll",\s+CharSet = CharSet\.Unicode,\s+ExactSpelling = true,/,
    );

    const fastStatStructStart = windowsSandboxSource.indexOf(
      "private struct FILE_STAT_BASIC_INFORMATION",
    );
    const fastStatStructEnd = windowsSandboxSource.indexOf(
      "private struct JOBOBJECT_BASIC_LIMIT_INFORMATION",
      fastStatStructStart,
    );
    const fastStatStruct = windowsSandboxSource.slice(
      fastStatStructStart,
      fastStatStructEnd,
    );
    expect(
      fastStatStruct.indexOf("public UInt64 VolumeSerialNumber;"),
    ).toBeLessThan(fastStatStruct.indexOf("public FILE_ID_128 FileId128;"));

    const fastProjectionStart = windowsSandboxSource.indexOf(
      "private static bool TryReadFastNodeFileIdentityProjections(",
    );
    const readIdentityStart = windowsSandboxSource.indexOf(
      "private static LaunchPathFileIdentity ReadLaunchPathFileIdentity(",
      fastProjectionStart,
    );
    const fastProjectionSource = windowsSandboxSource.slice(
      fastProjectionStart,
      readIdentityStart,
    );
    expect(fastProjectionSource).toMatch(
      /information\.VolumeSerialNumber !=\s+handleIdentity\.VolumeSerialNumber/,
    );
    expect(fastProjectionSource).toMatch(
      /information\.FileId128\.LowPart !=\s+handleIdentity\.FileId\.LowPart/,
    );
    expect(fastProjectionSource).toMatch(
      /information\.FileId128\.HighPart !=\s+handleIdentity\.FileId\.HighPart/,
    );
    expect(fastProjectionSource).toContain(
      "pathStatFileId != handlePathStatFileId",
    );
    expect(fastProjectionSource).toMatch(
      /fixedProjection = new NodeFileIdentityProjection\(\s*information\.VolumeSerialNumber & UInt32\.MaxValue,\s*pathStatFileId\);/,
    );
    expect(fastProjectionSource).toMatch(
      /node22Projection = new NodeFileIdentityProjection\(\s*information\.FileId128\.HighPart,\s*pathStatFileId\);/,
    );

    const matchStart = windowsSandboxSource.indexOf(
      "private static bool MatchesExpectedNodeFileIdentity(",
    );
    const normalizeStart = windowsSandboxSource.indexOf(
      "private static string NormalizeFinalPath(",
      matchStart,
    );
    const matchSource = windowsSandboxSource.slice(matchStart, normalizeStart);
    for (const projection of [
      "LegacyNodeIdentity",
      "FixedFastNodeIdentity",
      "Node22FastNodeIdentity",
    ]) {
      expect(matchSource).toContain(`identity.${projection}`);
    }
    expect(windowsSandboxSource).toMatch(
      /VolumeSerialNumber = fileId\.VolumeSerialNumber,[\s\S]*FileIdLow = fileId\.FileId\.LowPart,[\s\S]*FileIdHigh = fileId\.FileId\.HighPart,/,
    );
    expect(windowsSandboxSource).toContain(
      "!SameNodeFileIdentityObservations(before, after)",
    );
    expect(windowsSandboxSource).toMatch(
      /if \(!MatchesExpectedNodeFileIdentity\(\s*before,\s*expectedDevice,\s*expectedFileId\)\)/,
    );
  });

  it("captures verified entry bytes before launch and inherits only the snapshot pipe", () => {
    expect(windowsSandboxSource).toContain(
      "private const UInt32 FSCTL_REQUEST_FILTER_OPLOCK = 0x0009005C;",
    );
    expect(windowsSandboxSource).toContain(
      "private const Int32 ERROR_OPLOCK_NOT_GRANTED = 300;",
    );
    expect(windowsSandboxSource).toContain(
      "private const Int32 LAUNCH_PATH_OPLOCK_MAX_ATTEMPTS = 22;",
    );
    expect(windowsSandboxSource).toContain(
      "private const Int32 LAUNCH_PATH_OPLOCK_RETRY_BASE_DELAY_MS = 50;",
    );
    expect(windowsSandboxSource).toContain(
      "private const UInt32 FILE_READ_ATTRIBUTES = 0x00000080;",
    );
    expect(windowsSandboxSource).toContain(
      "private const UInt32 FILE_SHARE_DELETE = 0x00000004;",
    );
    const acquireStart = windowsSandboxSource.indexOf(
      "private static LaunchPathLock AcquireLaunchPathLock(",
    );
    const acquireEnd = windowsSandboxSource.indexOf(
      "private static List<LaunchPathLock> AcquireLaunchPathLocks(",
      acquireStart,
    );
    const acquireSource = windowsSandboxSource.slice(acquireStart, acquireEnd);
    const acquireOnceStart = acquireSource.indexOf(
      "private static LaunchPathLock AcquireLaunchPathLockOnce(",
    );
    const retrySource = acquireSource.slice(0, acquireOnceStart);
    const acquireOnceSource = acquireSource.slice(acquireOnceStart);
    expect(acquireOnceStart).toBeGreaterThan(-1);
    expect(retrySource).toContain("return AcquireLaunchPathLockOnce(spec);");
    expect(retrySource).toMatch(
      /catch \(Win32Exception error\)[\s\S]*error\.NativeErrorCode != ERROR_OPLOCK_NOT_GRANTED \|\|[\s\S]*attempt == LAUNCH_PATH_OPLOCK_MAX_ATTEMPTS[\s\S]*throw;/,
    );
    expect(retrySource).toMatch(
      /int retryDelay = Math\.Min\(\s*250,\s*LAUNCH_PATH_OPLOCK_RETRY_BASE_DELAY_MS \*\s*attempt\);\s*Thread\.Sleep\(retryDelay\);/,
    );
    expect(acquireSource).toContain("attributes.bInheritHandle = false;");
    expect(acquireOnceSource).toMatch(
      /lockingHandle = CreateFile\(\s*expectedPath,\s*FILE_READ_ATTRIBUTES,\s*FILE_SHARE_READ \| FILE_SHARE_WRITE \| FILE_SHARE_DELETE,\s*ref attributes,\s*OPEN_EXISTING,\s*FILE_FLAG_OVERLAPPED,/,
    );
    expect(acquireSource).toMatch(
      /DeviceIoControl\(\s*lockingHandle,\s*FSCTL_REQUEST_FILTER_OPLOCK,/,
    );
    expect(acquireSource).toMatch(
      /if \(completed \|\| oplockError != ERROR_IO_PENDING\)[\s\S]*FSCTL_REQUEST_FILTER_OPLOCK was not granted/,
    );
    expect(acquireOnceSource).toMatch(
      /int oplockError = completed\s*\? 0\s*: Marshal\.GetLastWin32Error\(\);/,
    );
    expect(acquireOnceSource).toContain('", role=" + spec.role + ")"');
    expect(acquireOnceSource).toMatch(
      /finally\s*\{\s*ReleaseLaunchPathLockHandles\([\s\S]*oplockPending\);\s*\}/,
    );

    const filterOplock = acquireSource.indexOf("DeviceIoControl(");
    const secondReadHandle = acquireSource.indexOf("readHandle = CreateFile(");
    const lockingIdentity = acquireSource.indexOf(
      "ReadLaunchPathFileIdentity(lockingHandle)",
    );
    const readIdentity = acquireSource.indexOf(
      "ReadLaunchPathFileIdentity(readHandle)",
    );
    const finalPath = acquireSource.indexOf("before.FinalPath");
    const contentHash = acquireSource.indexOf(
      "HashLaunchPathHandle(readHandle)",
    );
    const contentSnapshot = acquireSource.indexOf(
      "SnapshotLaunchPathHandle(readHandle, before.Bytes)",
    );
    expect(filterOplock).toBeGreaterThan(-1);
    expect(secondReadHandle).toBeGreaterThan(filterOplock);
    expect(lockingIdentity).toBeGreaterThan(secondReadHandle);
    expect(readIdentity).toBeGreaterThan(lockingIdentity);
    expect(finalPath).toBeGreaterThan(readIdentity);
    expect(contentHash).toBeGreaterThan(finalPath);
    expect(contentSnapshot).toBeGreaterThan(contentHash);
    expect(windowsSandboxSource).toContain('"process.exitCode=73;"');
    expect(windowsSandboxSource).toContain('"delete process._eval;"');
    expect(windowsSandboxSource).toContain("if (probeExitCode != 73)");
    expect(windowsSandboxSource).toContain(
      '"chainless-node-entry-snapshot-probe-" +',
    );
    expect(windowsSandboxSource).toContain(
      "Directory.Exists(probeDirectory) || File.Exists(probeEntry)",
    );
    expect(windowsSandboxSource).toContain(
      "Node entry snapshot probe did not execute its verified source",
    );

    const createProcessCall = windowsSandboxSource.indexOf(
      "bool processCreated = CreateProcessAsUser(",
      acquireEnd,
    );
    const acquireLocksCall = windowsSandboxSource.indexOf(
      "launchPathLocks = AcquireLaunchPathLocks(",
      acquireEnd,
    );
    const releaseLocksCall = windowsSandboxSource.indexOf(
      "ReleaseLaunchPathLocks(launchPathLocks);",
      createProcessCall,
    );
    expect(createProcessCall).toBeGreaterThan(acquireLocksCall);
    expect(createProcessCall).toBeGreaterThan(acquireEnd);
    expect(releaseLocksCall).toBeGreaterThan(createProcessCall);
    const snapshotArgumentsCall = windowsSandboxSource.indexOf(
      "arguments = BuildSnapshotNodeArguments(",
      acquireLocksCall,
    );
    const createSnapshotPipeCall = windowsSandboxSource.indexOf(
      "CreateEntrySnapshotPipe(",
      acquireLocksCall,
    );
    expect(createSnapshotPipeCall).toBeGreaterThan(acquireLocksCall);
    expect(snapshotArgumentsCall).toBeGreaterThan(createSnapshotPipeCall);
    expect(createProcessCall).toBeGreaterThan(snapshotArgumentsCall);

    expect(windowsSandboxSource).not.toContain("WaitForMultipleObjects(");
    expect(windowsSandboxSource).toMatch(
      /IMAGE_FILE_MACHINE_I386[\s\S]*IntPtr\.Size == sizeof\(Int32\)/,
    );
    expect(windowsSandboxSource).toMatch(
      /IMAGE_FILE_MACHINE_AMD64[\s\S]*IntPtr\.Size == sizeof\(Int64\)/,
    );
    expect(
      windowsSandboxSource.indexOf(
        "AssertSnapshotRuntimeBitness(application);",
      ),
    ).toBeLessThan(createSnapshotPipeCall);
    for (const name of [
      "NODE_OPTIONS",
      "NODE_CHANNEL_FD",
      "OPENSSL_CONF",
      "OPENSSL_CONF_INCLUDE",
      "OPENSSL_ENGINES",
      "OPENSSL_MODULES",
    ]) {
      expect(windowsSandboxSource).toMatch(
        new RegExp(
          `RemoveEnvironmentValue\\(\\s*targetEnvironment,\\s*"${name}"\\);`,
        ),
      );
    }

    const inheritedStart = windowsSandboxSource.indexOf(
      "private static IntPtr BuildInheritedHandleList(",
    );
    const inheritedEnd = windowsSandboxSource.indexOf(
      "private static IntPtr BuildProcessAttributeList(",
      inheritedStart,
    );
    const inheritedSource = windowsSandboxSource.slice(
      inheritedStart,
      inheritedEnd,
    );
    expect(inheritedSource).not.toMatch(/launchPath/i);
    expect(inheritedSource).toContain("handles.Add(standardInput);");
    expect(inheritedSource).toContain("_get_osfhandle(nodeIpcFd)");
    expect(inheritedSource).toContain("handles.Add(entrySnapshotHandle);");

    const inheritedCallStart = windowsSandboxSource.indexOf(
      "inheritedHandleBuffer = BuildInheritedHandleList(",
      acquireEnd,
    );
    const inheritedCallEnd = windowsSandboxSource.indexOf(
      "attributeList = BuildProcessAttributeList(",
      inheritedCallStart,
    );
    expect(
      windowsSandboxSource.slice(inheritedCallStart, inheritedCallEnd),
    ).not.toMatch(/launchPath/i);
    expect(
      windowsSandboxSource.slice(inheritedCallStart, inheritedCallEnd),
    ).toContain("entrySnapshotReadHandle");

    const bootstrapStart = windowsSandboxSource.indexOf(
      "private static string[] BuildSnapshotNodeArguments(",
    );
    const bootstrapEnd = windowsSandboxSource.indexOf(
      "private static void CreateEntrySnapshotPipe(",
      bootstrapStart,
    );
    const bootstrapSource = windowsSandboxSource.slice(
      bootstrapStart,
      bootstrapEnd,
    );
    expect(bootstrapSource).toContain("source.length!=={1}");
    expect(bootstrapSource).toContain(
      "crypto.createHash('sha256').update(source).digest('hex')",
    );
    expect(
      bootstrapSource.indexOf("entry snapshot pipe integrity failed"),
    ).toBeLessThan(bootstrapSource.indexOf("main._compile("));

    const resumeCall = windowsSandboxSource.indexOf(
      "if (ResumeThread(processInfo.hThread)",
      createProcessCall,
    );
    const reattestCall = windowsSandboxSource.indexOf(
      "ReattestLaunchPaths(launchPathLocks);",
      createProcessCall,
    );
    expect(reattestCall).toBeGreaterThan(createProcessCall);
    expect(reattestCall).toBeLessThan(releaseLocksCall);
    expect(windowsSandboxSource).toContain(
      "CreateFile(launch path reattestation)",
    );
    expect(releaseLocksCall).toBeLessThan(resumeCall);
    const writeSnapshotCall = windowsSandboxSource.indexOf(
      "WriteEntrySnapshot(",
      resumeCall,
    );
    expect(writeSnapshotCall).toBeGreaterThan(resumeCall);
  });

  it("reports detached numeric file stdio as unavailable on Windows", () => {
    const options = {
      detached: true,
      stdio: ["ignore", 17, 17],
      windowsHide: true,
    };
    const plan = applyWindowsSandbox(
      "node.exe",
      ["worker.mjs"],
      options,
      { profileName: "default" },
      { platform: "win32" },
    );

    expect(plan).toMatchObject({
      applied: false,
      backend: "windows-job-restricted-token",
      reason: "windows_detached_file_stdio_unsupported",
      command: "node.exe",
      args: ["worker.mjs"],
      options,
      guarantees: [],
    });
  });

  it("reports Windows unavailable when its native host is missing", () => {
    const harness = createWindowsAdapterHarness();
    const exists = harness.fsRuntime.existsSync.getMockImplementation();
    harness.fsRuntime.existsSync.mockImplementation((value) =>
      String(value).toLowerCase().endsWith("\\powershell.exe")
        ? false
        : exists(value),
    );
    const plan = applyWindowsSandbox(
      "tool.exe",
      [],
      {},
      { profileName: "strict" },
      {
        platform: "win32",
        fs: harness.fsRuntime,
        windowsDir: () => "C:\\Windows",
        windowsAdapterContent: "param()",
        tmpdir: () => "C:\\temp",
        randomBytes: () => Buffer.alloc(12, 3),
        joinPath: path.win32.join,
      },
    );
    expect(plan).toMatchObject({
      applied: false,
      reason: "windows_powershell_host_unavailable",
    });
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
  });

  it("retains a retryable cleanup record when a host-missing helper cannot be removed", () => {
    const harness = createWindowsAdapterHarness();
    const exists = harness.fsRuntime.existsSync.getMockImplementation();
    harness.fsRuntime.existsSync.mockImplementation((value) =>
      String(value).toLowerCase().endsWith("\\powershell.exe")
        ? false
        : exists(value),
    );
    const unlink = harness.fsRuntime.unlinkSync.getMockImplementation();
    harness.fsRuntime.unlinkSync.mockImplementation((value) => {
      if (String(value).toLowerCase().endsWith(".dll")) {
        const error = new Error("helper is still open");
        error.code = "EACCES";
        throw error;
      }
      return unlink(value);
    });

    const plan = applyWindowsSandbox(
      "tool.exe",
      [],
      {},
      { profileName: "strict", sync: true },
      {
        platform: "win32",
        fs: harness.fsRuntime,
        windowsAdapterContent: "adapter-bytes",
        tmpdir: () => "C:\\temp",
        randomBytes: (size) => Buffer.alloc(size, 0x33),
        joinPath: path.win32.join,
        sleepSync: vi.fn(),
        spawnSync: harness.spawnSync,
      },
    );

    expect(plan).toMatchObject({
      applied: false,
      reason: "windows_native_adapter_compile_cleanup_unverified",
    });
    expect(resetWindowsSandboxAdapterCache()).toBe(false);
    harness.fsRuntime.unlinkSync.mockImplementation(unlink);
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
    expect(
      [...harness.files].some((value) => value.toLowerCase().endsWith(".dll")),
    ).toBe(false);
  });

  it("preserves Node IPC stdio in the Windows restricted-token plan", () => {
    const harness = createWindowsAdapterHarness();
    const plan = applyWindowsSandbox(
      process.execPath,
      ["child.js"],
      { stdio: ["ignore", "pipe", "pipe", "ipc"] },
      { profileName: "default" },
      {
        platform: "win32",
        fs: harness.fsRuntime,
        windowsAdapterContent: "param()",
        tmpdir: () => "C:\\temp",
        randomBytes: (size) => Buffer.alloc(size, 4),
        joinPath: path.win32.join,
        spawnSync: harness.spawnSync,
      },
    );
    expect(plan).toMatchObject({
      applied: true,
      enforcement: "windows-job-restricted-token",
      options: { stdio: ["ignore", "pipe", "pipe", "ipc"] },
      postSpawn: { required: false, mode: "none" },
    });
    plan.cleanup();
  });

  it("fails closed for unsupported Windows descriptors above the IPC fd", () => {
    const plan = applyWindowsSandbox(
      process.execPath,
      ["child.js"],
      { stdio: ["ignore", "pipe", "pipe", "ipc", "pipe"] },
      { profileName: "strict" },
      {
        platform: "win32",
        fs: { existsSync: vi.fn(() => true) },
      },
    );
    expect(plan).toMatchObject({
      applied: false,
      command: process.execPath,
      args: ["child.js"],
      reason: "windows_extra_descriptor_unsupported",
    });
  });

  it("resolves detached Windows launches to the target PID synchronously", () => {
    const readFileSync = vi.fn(() =>
      JSON.stringify({ targetPid: 5103, helperPid: 4102 }),
    );
    const harness = createWindowsAdapterHarness({ readFileSync });
    const plan = applyWindowsSandbox(
      process.execPath,
      ["worker.js"],
      { detached: true, stdio: "ignore" },
      { profileName: "default" },
      {
        platform: "win32",
        fs: harness.fsRuntime,
        windowsAdapterContent: "param()",
        tmpdir: () => "C:\\temp",
        randomBytes: (size) => Buffer.alloc(size, 5),
        joinPath: path.win32.join,
        spawnSync: harness.spawnSync,
      },
    );
    expect(plan).toMatchObject({
      applied: true,
      enforcement: "windows-job-restricted-token",
      // The helper remains attached as supervisor; only the target launch
      // encoded in the payload is detached.
      options: { detached: false, stdio: "ignore" },
      postSpawn: { required: true, mode: "sync" },
    });
    const payload = decodeWindowsLaunchSpec(harness, plan);
    expect(payload).toMatchObject({
      command: process.execPath,
      args: ["worker.js"],
      detached: true,
      nodeIpcFd: -1,
    });
    const child = createChild(4102);
    expect(plan.postSpawnWindows(child)).toEqual({
      targetPid: 5103,
      wrapperPid: 4102,
    });
    expect(child).toMatchObject({
      pid: 5103,
      sandboxTargetPid: 5103,
      sandboxWrapperPid: 4102,
    });
    expect(readFileSync).toHaveBeenCalledOnce();
    expect(harness.fsRuntime.unlinkSync).toHaveBeenCalledWith(
      payload.identityPath,
    );
    const { assemblyPath } = harness.decodeInvocationPaths(plan.args);
    plan.cleanup();
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
    expect(harness.fsRuntime.unlinkSync).toHaveBeenCalledWith(assemblyPath);
  });

  it("reports Linux unavailable when the wrapper is missing", () => {
    const plan = applySandbox("node", [], {}, "default", {
      platform: "linux",
      fs: { existsSync: vi.fn(() => false) },
    });

    expect(plan).toMatchObject({
      applied: false,
      command: "node",
      args: [],
      reason: "linux_prlimit_unavailable",
    });
  });
});

describe.runIf(process.platform === "win32")(
  "Windows sandbox live enforcement",
  () => {
    const liveNodeExecutable = fs.realpathSync.native(process.execPath);

    it("loads only verified helper bytes when the temp directory contains loader sidecars", () => {
      const workspace = fs.mkdtempSync(
        path.join(os.tmpdir(), "cc-windows-byte-helper-live-"),
      );
      const adapterOwner = installWindowsSandboxAdapterTestRoot();
      expect(adapterOwner.installed).toBe(true);
      const adapterRoot = adapterOwner.rootPath;
      const plantedSidecars = [
        "mscoree.dll",
        "mscoreei.dll",
        "version.dll",
      ].map((name) => path.join(adapterRoot, name));
      const trustedWindowsDirectory = fs.realpathSync.native(
        String.raw`\\?\GLOBALROOT\SystemRoot`,
      );
      const previousWindir = process.env.WINDIR;
      const previousSystemRoot = process.env.SystemRoot;
      let plan;
      let helperConfigPath = null;
      try {
        for (const plantedPath of plantedSidecars) {
          fs.writeFileSync(
            plantedPath,
            `untrusted-${path.basename(plantedPath)}`,
          );
        }
        process.env.WINDIR = workspace;
        process.env.SystemRoot = workspace;
        expect(resetWindowsSandboxAdapterCache()).toBe(true);
        plan = applyWindowsSandbox(
          path.join(trustedWindowsDirectory, "System32", "cmd.exe"),
          ["/d", "/s", "/c", "echo byte-helper-ok"],
          {
            cwd: workspace,
            encoding: "utf8",
            timeout: 30_000,
            windowsHide: true,
            env: process.env,
          },
          { profileName: "strict", sync: true },
          { platform: "win32", windowsAdapterTempRoot: adapterRoot },
        );

        expect(plan.applied, plan.reason).toBe(true);
        expect(
          [
            path.join(
              path.parse(trustedWindowsDirectory).root,
              "Program Files",
              "PowerShell",
              "7",
              "pwsh.exe",
            ),
            path.join(
              trustedWindowsDirectory,
              "System32",
              "WindowsPowerShell",
              "v1.0",
              "powershell.exe",
            ),
          ].map((value) => value.toLowerCase()),
        ).toContain(plan.command.toLowerCase());
        expect(plan.options.cwd.toLowerCase()).toBe(
          path.join(trustedWindowsDirectory, "System32").toLowerCase(),
        );
        expect(plan.options.env).toMatchObject({
          SystemRoot: trustedWindowsDirectory,
          WINDIR: trustedWindowsDirectory,
        });
        const adapterFiles = fs.readdirSync(adapterRoot);
        expect(
          adapterFiles.filter((name) =>
            /^chainless-win-sandbox-[a-f0-9]+\.exe$/i.test(name),
          ),
        ).toEqual([]);
        const helperNames = adapterFiles.filter((name) =>
          /^chainless-win-sandbox-[a-f0-9]+\.dll$/i.test(name),
        );
        expect(helperNames).toHaveLength(1);
        helperConfigPath = path.join(adapterRoot, `${helperNames[0]}.config`);
        fs.writeFileSync(
          helperConfigPath,
          "<configuration><runtime>untrusted</runtime></configuration>",
        );

        const result = nativeSpawnSync(plan.command, [...plan.args], {
          ...plan.options,
        });
        expect(result.error).toBeUndefined();
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout.trim()).toBe("byte-helper-ok");
        expect(result.stderr).toBe("");
      } finally {
        if (previousWindir === undefined) {
          delete process.env.WINDIR;
        } else {
          process.env.WINDIR = previousWindir;
        }
        if (previousSystemRoot === undefined) {
          delete process.env.SystemRoot;
        } else {
          process.env.SystemRoot = previousSystemRoot;
        }
        let cacheCleaned = false;
        try {
          plan?.cleanup?.();
        } finally {
          try {
            cacheCleaned = resetWindowsSandboxAdapterCache();
          } finally {
            for (const plantedPath of plantedSidecars) {
              fs.rmSync(plantedPath, { force: true });
            }
            if (helperConfigPath) fs.rmSync(helperConfigPath, { force: true });
            fs.rmSync(workspace, { recursive: true, force: true });
            adapterOwner.teardown();
          }
        }
        expect(cacheCleaned).toBe(true);
      }
    }, 120_000);

    it("rejects helper bytes changed after the final launch plan is issued", () => {
      const workspace = fs.mkdtempSync(
        path.join(os.tmpdir(), "cc-windows-byte-helper-tamper-"),
      );
      const adapterOwner = installWindowsSandboxAdapterTestRoot();
      expect(adapterOwner.installed).toBe(true);
      const adapterRoot = adapterOwner.rootPath;
      const targetMarker = path.join(workspace, "target-ran.txt");
      let plan;
      let tamperedHelperPath = null;
      try {
        expect(resetWindowsSandboxAdapterCache()).toBe(true);
        plan = applyWindowsSandbox(
          liveNodeExecutable,
          [
            "-e",
            `require('node:fs').writeFileSync(${JSON.stringify(
              targetMarker,
            )}, 'ran')`,
          ],
          {
            cwd: workspace,
            encoding: "utf8",
            timeout: 30_000,
            windowsHide: true,
            env: process.env,
          },
          { profileName: "strict", sync: true },
          { platform: "win32", windowsAdapterTempRoot: adapterRoot },
        );

        expect(plan.applied, plan.reason).toBe(true);
        const helperNames = fs
          .readdirSync(adapterRoot)
          .filter((name) =>
            /^chainless-win-sandbox-[a-f0-9]+\.dll$/i.test(name),
          );
        expect(helperNames).toHaveLength(1);
        tamperedHelperPath = path.join(adapterRoot, helperNames[0]);
        fs.writeFileSync(tamperedHelperPath, "changed-after-attestation");

        const result = nativeSpawnSync(plan.command, [...plan.args], {
          ...plan.options,
        });
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(125);
        expect(result.stderr).toContain(
          "Windows sandbox adapter input digest mismatch",
        );
        expect(fs.existsSync(targetMarker)).toBe(false);
      } finally {
        let cacheCleaned = false;
        try {
          plan?.cleanup?.();
        } finally {
          try {
            if (tamperedHelperPath) {
              fs.rmSync(tamperedHelperPath, { force: true });
            }
            cacheCleaned = resetWindowsSandboxAdapterCache();
          } finally {
            fs.rmSync(workspace, { recursive: true, force: true });
            adapterOwner.teardown();
          }
        }
        expect(cacheCleaned).toBe(true);
      }
    }, 120_000);

    it("rejects remote target paths before the helper performs target lookup", () => {
      const workspace = fs.mkdtempSync(
        path.join(os.tmpdir(), "cc-windows-local-path-live-"),
      );
      const adapterOwner = installWindowsSandboxAdapterTestRoot();
      expect(adapterOwner.installed).toBe(true);
      const adapterRoot = adapterOwner.rootPath;
      const remotePath = String.raw`\\localhost\cc-sandbox-must-not-open`;
      let activePlan;
      try {
        expect(resetWindowsSandboxAdapterCache()).toBe(true);
        for (const targetCase of [
          {
            command: process.execPath,
            cwd: remotePath,
            expected: "Target working directory must use a local DOS drive",
          },
          {
            command: `${remotePath}\\target.exe`,
            cwd: workspace,
            expected: "Target application must use a local DOS drive",
          },
        ]) {
          activePlan = applyWindowsSandbox(
            targetCase.command,
            ["-e", "process.exitCode = 91"],
            {
              cwd: targetCase.cwd,
              encoding: "utf8",
              timeout: 30_000,
              windowsHide: true,
              env: process.env,
            },
            { profileName: "strict", sync: true },
            { platform: "win32", windowsAdapterTempRoot: adapterRoot },
          );
          expect(activePlan.applied, activePlan.reason).toBe(true);

          const result = nativeSpawnSync(
            activePlan.command,
            [...activePlan.args],
            { ...activePlan.options },
          );
          expect(result.error).toBeUndefined();
          expect(result.status, result.stderr).toBe(125);
          expect(result.stderr).toContain(targetCase.expected);
          activePlan.cleanup();
          activePlan = null;
        }
      } finally {
        let cacheCleaned = false;
        try {
          activePlan?.cleanup?.();
        } finally {
          try {
            cacheCleaned = resetWindowsSandboxAdapterCache();
          } finally {
            fs.rmSync(workspace, { recursive: true, force: true });
            adapterOwner.teardown();
          }
        }
        expect(cacheCleaned).toBe(true);
      }
    }, 120_000);

    it("launches an attested AppContainer target and leaves no profile behind when the OS supports it", () => {
      const command = path.join(process.env.WINDIR, "System32", "cmd.exe");
      const appContainerProfileName = `ChainlessChain.CliSandbox.${"6a".repeat(
        12,
      )}`;
      let acknowledgeUnavailableCleanup = false;
      const runtime = {
        platform: "win32",
        // This case deliberately retries a retained AppContainer cleanup
        // record through the already-attested helper below.
        windowsAdapterIdleTtlMs: 60_000,
        randomBytes: (size) =>
          size === 12 ? Buffer.alloc(size, 0x6a) : crypto.randomBytes(size),
        spawnSync: (...spawnArgs) =>
          acknowledgeUnavailableCleanup
            ? {
                status: 0,
                stdout: JSON.stringify({
                  deleted: true,
                  absent: true,
                  profileName: appContainerProfileName,
                }),
                stderr: "",
              }
            : nativeSpawnSync(...spawnArgs),
      };
      const plan = applyWindowsSandbox(
        command,
        ["/d", "/c", "echo %CC_WINDOWS_APPCONTAINER%"],
        {
          encoding: "utf8",
          timeout: 30_000,
          windowsHide: true,
          env: process.env,
        },
        {
          profileName: "strict",
          requiredBoundaries: [
            SANDBOX_BOUNDARIES.FILESYSTEM,
            SANDBOX_BOUNDARIES.NETWORK,
          ],
          sync: true,
        },
        runtime,
      );

      if (!plan.applied) {
        expect(plan).toMatchObject({
          backend: null,
          candidateBackend: "windows-appcontainer-job-restricted-token",
          policyAttested: false,
          reason: expect.stringMatching(
            /^windows_appcontainer_readiness_(?:failed|cleanup_unverified)$/,
          ),
          guarantees: [],
          runtimeProbe: {
            kind: "windows-appcontainer-launch-attestation-v1",
            attempted: true,
            runnable: false,
          },
        });
        if (
          plan.reason === "windows_appcontainer_readiness_cleanup_unverified"
        ) {
          // Some Windows installations cannot service AppContainer APIs at
          // all. Preserve the fail-closed assertion while letting this live
          // test acknowledge the deliberately retained cleanup record; the
          // mock-only retry behavior is covered by the unit contracts above.
          acknowledgeUnavailableCleanup = true;
          expect(resetWindowsSandboxAdapterCache()).toBe(true);
        }
        return;
      }

      let result;
      try {
        result = nativeSpawnSync(plan.command, [...plan.args], {
          ...plan.options,
        });
      } finally {
        plan.cleanup();
      }
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe("1");
    }, 180_000);

    it("runs or fails closed on a nested Broker launch from an already restricted worker", () => {
      const previousStrict = process.env.CC_SANDBOX_STRICT;
      const previousDisable = process.env.CC_SANDBOX_DISABLE;
      const previousSandboxEnabled = executionBroker._sandboxEnabled;
      const previousPlatformEnabled = executionBroker._platformSandboxEnabled;
      const nodeExecutable = fs.realpathSync.native(process.execPath);
      const brokerModuleUrl = new URL(
        "../../src/lib/process-execution-broker/index.js",
        import.meta.url,
      ).href;
      process.env.CC_SANDBOX_STRICT = "1";
      delete process.env.CC_SANDBOX_DISABLE;
      executionBroker._sandboxEnabled = true;
      executionBroker._platformSandboxEnabled = true;
      try {
        const result = executionBroker.spawnSync(
          nodeExecutable,
          [
            "--no-warnings",
            "-e",
            [
              "(async () => {",
              `  const { executionBroker } = await import(${JSON.stringify(
                brokerModuleUrl,
              )});`,
              "  executionBroker._sandboxEnabled = true;",
              "  executionBroker._platformSandboxEnabled = true;",
              "  delete process.env.CC_SANDBOX_STRICT;",
              "  let nested = null;",
              "  let launchError = null;",
              "  try {",
              "    nested = executionBroker.spawnSync(",
              "      'git',",
              "      ['--version'],",
              "      {",
              "        origin: 'test:windows-nested-restricted-broker',",
              "        policy: 'allow',",
              "        encoding: 'utf8',",
              "        timeout: 30000,",
              "        env: process.env,",
              "        requiredBoundaries: ['process-tree'],",
              "      },",
              "    );",
              "  } catch (error) {",
              "    launchError = {",
              "      code: error.code || null,",
              "      sandboxReason: error.sandboxReason || null,",
              "      sandboxCandidateReason: error.sandboxCandidateReason || null,",
              "      missingBoundaries: error.missingBoundaries || [],",
              "    };",
              "  }",
              "  const audit = executionBroker.getAuditLog(1)[0];",
              "  process.stdout.write(JSON.stringify({",
              "    status: nested?.status ?? null,",
              "    stdout: nested?.stdout || '',",
              "    stderr: nested?.stderr || '',",
              "    sandboxBackend: audit?.sandboxBackend || null,",
              "    sandboxCandidateBackend: audit?.sandboxCandidateBackend || null,",
              "    sandboxState: audit?.sandboxState || null,",
              "    sandboxGuarantees: audit?.sandboxGuarantees || [],",
              "    error: launchError || (nested?.error",
              "      ? { code: nested.error.code, message: nested.error.message }",
              "      : null),",
              "  }));",
              "})().catch((error) => {",
              "  process.stderr.write(error.stack || error.message);",
              "  process.exitCode = 91;",
              "});",
            ].join("\n"),
          ],
          {
            origin: "test:windows-outer-restricted-broker",
            policy: "allow",
            encoding: "utf8",
            timeout: 90_000,
            env: {
              ...process.env,
              NODE_OPTIONS: [process.env.NODE_OPTIONS, "--no-warnings"]
                .filter(Boolean)
                .join(" "),
            },
          },
        );
        expect(result.error).toBeUndefined();
        expect(result.status, result.stderr).toBe(0);
        expect(result.stderr).toBe("");
        const nestedReport = JSON.parse(result.stdout);
        if (nestedReport.error) {
          expect(nestedReport).toMatchObject({
            status: null,
            stdout: "",
            stderr: "",
            sandboxState: "denied",
            error: {
              code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
              sandboxReason: "required_boundaries_unsatisfied",
              missingBoundaries: ["process-tree"],
            },
          });
          expect(nestedReport.sandboxGuarantees).not.toContain("process-tree");
          return;
        }
        expect(nestedReport).toMatchObject({
          status: 0,
          error: null,
          sandboxBackend: "windows-job-restricted-token",
          sandboxGuarantees: expect.arrayContaining(["process-tree"]),
        });
        expect(nestedReport.stderr).toBe("");
        expect(nestedReport.stdout).toMatch(/^git version /);
      } finally {
        if (previousStrict === undefined) {
          delete process.env.CC_SANDBOX_STRICT;
        } else {
          process.env.CC_SANDBOX_STRICT = previousStrict;
        }
        if (previousDisable === undefined) {
          delete process.env.CC_SANDBOX_DISABLE;
        } else {
          process.env.CC_SANDBOX_DISABLE = previousDisable;
        }
        executionBroker._sandboxEnabled = previousSandboxEnabled;
        executionBroker._platformSandboxEnabled = previousPlatformEnabled;
      }
    }, 180_000);

    it("starts a real child only after the native wrapper is active", () => {
      const previousStrict = process.env.CC_SANDBOX_STRICT;
      const previousDisable = process.env.CC_SANDBOX_DISABLE;
      const previousSandboxEnabled = executionBroker._sandboxEnabled;
      const previousPlatformEnabled = executionBroker._platformSandboxEnabled;
      process.env.CC_SANDBOX_STRICT = "1";
      delete process.env.CC_SANDBOX_DISABLE;
      executionBroker._sandboxEnabled = true;
      executionBroker._platformSandboxEnabled = true;
      let grandchildPid;
      try {
        const result = executionBroker.spawnSync(
          liveNodeExecutable,
          [
            "-e",
            [
              "const { spawn } = require('node:child_process');",
              "const grandchild = spawn(",
              "  process.execPath,",
              "  ['-e', 'setTimeout(() => process.exit(0), 30000); setInterval(() => {}, 1000)'],",
              "  { detached: true, stdio: 'ignore' },",
              ");",
              "grandchild.unref();",
              "process.stdout.write(JSON.stringify({",
              "  sandboxed: process.env.CC_WINDOWS_SANDBOXED,",
              "  profile: process.env.CC_WINDOWS_SANDBOX_PROFILE,",
              "  grandchildPid: grandchild.pid,",
              "}));",
            ].join("\n"),
          ],
          {
            origin: "test:windows-native-sandbox-live",
            policy: "allow",
            encoding: "utf8",
            timeout: 30_000,
            env: process.env,
          },
        );
        expect(result.error).toBeUndefined();
        expect(result.status, result.stderr).toBe(0);
        expect(result.stderr).toBe("");
        const childReport = JSON.parse(result.stdout);
        expect(childReport).toMatchObject({
          sandboxed: "1",
          profile: "strict",
        });
        expect(childReport.grandchildPid).toBeGreaterThan(0);
        grandchildPid = childReport.grandchildPid;

        // Query the restricted token through a second direct adapter launch.
        // Starting whoami as a nested process is flaky on hosted Windows
        // runners (STATUS_DLL_INIT_FAILED) and tests the nested loader more
        // than the token assigned by this adapter.
        const privilegeResult = executionBroker.spawnSync(
          path.join(process.env.WINDIR, "System32", "whoami.exe"),
          ["/priv"],
          {
            origin: "test:windows-restricted-token-live",
            policy: "allow",
            encoding: "utf8",
            timeout: 30_000,
            env: process.env,
          },
        );
        expect(privilegeResult.error).toBeUndefined();
        expect(privilegeResult.status, privilegeResult.stderr).toBe(0);
        const privileges = [
          ...(privilegeResult.stdout || "").matchAll(
            /\bSe[A-Za-z]+Privilege\b/g,
          ),
        ].map((match) => match[0]);
        expect(privileges).not.toHaveLength(0);
        // DISABLE_MAX_PRIVILEGE disables unexpected privileges; it does not
        // promise to remove their names from TokenPrivileges/whoami output.
        // Native AssertRestrictedTokenPolicy above is the authoritative
        // enabled-state check.
        expect(privileges).toContain("SeChangeNotifyPrivilege");
        expect(() => process.kill(grandchildPid, 0)).toThrow();
        grandchildPid = null;
        expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
          sandboxed: true,
          sandboxState: "ready",
          sandboxEnforcement: "windows-job-restricted-token",
        });

        const shellResult = executionBroker.spawnSync(
          "echo windows-shell-ok",
          [],
          {
            origin: "test:windows-native-sandbox-shell",
            policy: "allow",
            shell: true,
            encoding: "utf8",
            timeout: 30_000,
            env: process.env,
          },
        );
        expect(shellResult.status, shellResult.stderr).toBe(0);
        expect(shellResult.stdout.trim()).toBe("windows-shell-ok");

        const quotedShellResult = executionBroker.spawnSync(
          `"${process.execPath}" -e "process.stdout.write('quoted-shell-ok')"`,
          [],
          {
            origin: "test:windows-native-sandbox-quoted-shell",
            policy: "allow",
            shell: true,
            encoding: "utf8",
            timeout: 30_000,
            env: process.env,
          },
        );
        expect(quotedShellResult.status, quotedShellResult.stderr).toBe(0);
        expect(quotedShellResult.stdout).toBe("quoted-shell-ok");

        const largeShellResult = executionBroker.spawnSync(
          `"${process.execPath}" -e "process.stdout.write('x'.repeat(2*1024*1024))"`,
          [],
          {
            origin: "test:windows-native-sandbox-large-shell",
            policy: "allow",
            shell: true,
            encoding: "utf8",
            maxBuffer: 64 * 1024 * 1024,
            timeout: 30_000,
            env: process.env,
          },
        );
        expect(largeShellResult.status, largeShellResult.stderr).toBe(0);
        expect(largeShellResult.stdout).toHaveLength(2 * 1024 * 1024);
      } finally {
        if (grandchildPid) {
          try {
            process.kill(grandchildPid);
          } catch {
            // The Job normally reaps the nested detached process.
          }
        }
        if (previousStrict === undefined) {
          delete process.env.CC_SANDBOX_STRICT;
        } else {
          process.env.CC_SANDBOX_STRICT = previousStrict;
        }
        if (previousDisable === undefined) {
          delete process.env.CC_SANDBOX_DISABLE;
        } else {
          process.env.CC_SANDBOX_DISABLE = previousDisable;
        }
        executionBroker._sandboxEnabled = previousSandboxEnabled;
        executionBroker._platformSandboxEnabled = previousPlatformEnabled;
      }
    }, 180_000);

    it("preserves a real Node fd3 IPC channel through the native adapter", async () => {
      const previousStrict = process.env.CC_SANDBOX_STRICT;
      const previousDisable = process.env.CC_SANDBOX_DISABLE;
      const previousSandboxEnabled = executionBroker._sandboxEnabled;
      const previousPlatformEnabled = executionBroker._platformSandboxEnabled;
      process.env.CC_SANDBOX_STRICT = "1";
      delete process.env.CC_SANDBOX_DISABLE;
      executionBroker._sandboxEnabled = true;
      executionBroker._platformSandboxEnabled = true;
      let child;
      let ipcTimer;
      try {
        child = executionBroker.spawn(
          liveNodeExecutable,
          [
            "-e",
            [
              "process.on('message', (message) => {",
              "  process.send({",
              "    echo: message,",
              "    sandboxed: process.env.CC_WINDOWS_SANDBOXED,",
              "    pid: process.pid,",
              "  }, () => {",
              "    process.disconnect();",
              "    setTimeout(() => process.exit(0), 500);",
              "  });",
              "});",
              "process.send({ ready: true });",
            ].join("\n"),
          ],
          {
            origin: "test:windows-native-sandbox-ipc-live",
            policy: "allow",
            stdio: ["ignore", "pipe", "pipe", "ipc"],
            timeout: 30_000,
            env: process.env,
          },
        );
        const stderr = [];
        child.stderr.on("data", (chunk) => stderr.push(chunk));
        const disconnectPromise = once(child, "disconnect");
        const exitPromise = once(child, "exit");
        void disconnectPromise.catch(() => {});
        void exitPromise.catch(() => {});
        const report = await new Promise((resolve, reject) => {
          let settled = false;
          const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(ipcTimer);
            child.off("error", onError);
            child.off("exit", onEarlyExit);
            child.off("message", onMessage);
            callback(value);
          };
          const onError = (error) => finish(reject, error);
          const onEarlyExit = (code, signal) =>
            finish(
              reject,
              new Error(
                `Sandbox IPC child exited before echo (${code}/${signal}): ${Buffer.concat(
                  stderr,
                ).toString()}`,
              ),
            );
          const onMessage = (message) => {
            if (message?.ready) {
              child.send({ ping: "pong" }, (error) => {
                if (error) finish(reject, error);
              });
              return;
            }
            finish(resolve, message);
          };
          ipcTimer = setTimeout(
            () =>
              finish(reject, new Error("Timed out waiting for sandbox IPC")),
            30_000,
          );
          child.once("error", onError);
          child.once("exit", onEarlyExit);
          child.on("message", onMessage);
        });
        expect(report).toMatchObject({
          echo: { ping: "pong" },
          sandboxed: "1",
        });
        expect(report.pid).toBeGreaterThan(0);
        await disconnectPromise;
        expect(child.connected).toBe(false);
        expect(child.exitCode).toBeNull();
        const [code, signal] = await exitPromise;
        expect({
          code,
          signal,
          stderr: Buffer.concat(stderr).toString(),
        }).toEqual({
          code: 0,
          signal: null,
          stderr: "",
        });
        expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
          sandboxed: true,
          sandboxState: "ready",
          sandboxEnforcement: "windows-job-restricted-token",
        });
      } finally {
        clearTimeout(ipcTimer);
        try {
          child?.kill();
        } catch {
          // The child normally exits after its echo.
        }
        if (previousStrict === undefined) {
          delete process.env.CC_SANDBOX_STRICT;
        } else {
          process.env.CC_SANDBOX_STRICT = previousStrict;
        }
        if (previousDisable === undefined) {
          delete process.env.CC_SANDBOX_DISABLE;
        } else {
          process.env.CC_SANDBOX_DISABLE = previousDisable;
        }
        executionBroker._sandboxEnabled = previousSandboxEnabled;
        executionBroker._platformSandboxEnabled = previousPlatformEnabled;
      }
    }, 120_000);

    it("exposes and supervises the real detached target PID", async () => {
      const previousStrict = process.env.CC_SANDBOX_STRICT;
      const previousDisable = process.env.CC_SANDBOX_DISABLE;
      const previousSandboxEnabled = executionBroker._sandboxEnabled;
      const previousPlatformEnabled = executionBroker._platformSandboxEnabled;
      process.env.CC_SANDBOX_STRICT = "1";
      delete process.env.CC_SANDBOX_DISABLE;
      executionBroker._sandboxEnabled = true;
      executionBroker._platformSandboxEnabled = true;
      let child;
      let targetPid;
      try {
        child = executionBroker.spawn(
          liveNodeExecutable,
          ["-e", "setInterval(() => {}, 1000)"],
          {
            origin: "test:windows-native-sandbox-detached-live",
            policy: "allow",
            detached: true,
            stdio: "ignore",
            timeout: 30_000,
            env: process.env,
          },
        );
        targetPid = child.pid;
        expect(child).toMatchObject({
          pid: targetPid,
          sandboxTargetPid: targetPid,
        });
        expect(child.sandboxWrapperPid).toBeGreaterThan(0);
        expect(child.sandboxWrapperPid).not.toBe(targetPid);
        expect(() => process.kill(targetPid, 0)).not.toThrow();
        expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
          pid: targetPid,
          sandboxWrapperPid: child.sandboxWrapperPid,
          sandboxTargetPid: targetPid,
          sandboxed: true,
          sandboxState: "ready",
          sandboxEnforcement: "windows-job-restricted-token",
        });

        const exitPromise = once(child, "exit");
        expect(child.kill()).toBe(true);
        await exitPromise;
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          try {
            process.kill(targetPid, 0);
          } catch {
            targetPid = null;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect(targetPid).toBeNull();
      } finally {
        try {
          child?.kill();
        } catch {
          // Best-effort cleanup for a failed assertion.
        }
        if (targetPid) {
          try {
            process.kill(targetPid);
          } catch {
            // The Job may already have reaped it.
          }
        }
        if (previousStrict === undefined) {
          delete process.env.CC_SANDBOX_STRICT;
        } else {
          process.env.CC_SANDBOX_STRICT = previousStrict;
        }
        if (previousDisable === undefined) {
          delete process.env.CC_SANDBOX_DISABLE;
        } else {
          process.env.CC_SANDBOX_DISABLE = previousDisable;
        }
        executionBroker._sandboxEnabled = previousSandboxEnabled;
        executionBroker._platformSandboxEnabled = previousPlatformEnabled;
      }
    }, 120_000);

    it("fails closed for detached numeric file stdio in strict mode", () => {
      const previousStrict = process.env.CC_SANDBOX_STRICT;
      const previousDisable = process.env.CC_SANDBOX_DISABLE;
      const previousSandboxEnabled = executionBroker._sandboxEnabled;
      const previousPlatformEnabled = executionBroker._platformSandboxEnabled;
      process.env.CC_SANDBOX_STRICT = "1";
      delete process.env.CC_SANDBOX_DISABLE;
      executionBroker._sandboxEnabled = true;
      executionBroker._platformSandboxEnabled = true;
      let unexpectedChild;
      try {
        let failure;
        try {
          unexpectedChild = executionBroker.spawn(
            process.execPath,
            ["worker.mjs"],
            {
              origin: "test:windows-native-sandbox-detached-file-stdio-live",
              policy: "allow",
              detached: true,
              stdio: ["ignore", 17, 17],
              windowsHide: true,
              timeout: 30_000,
              env: process.env,
            },
          );
        } catch (error) {
          failure = error;
        }
        expect(failure).toMatchObject({
          code: "ERR_PROCESS_SANDBOX",
          sandboxReason: "windows_detached_file_stdio_unsupported",
        });
        expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
          sandboxed: false,
          sandboxState: "denied",
          sandboxReason: "windows_detached_file_stdio_unsupported",
        });
      } finally {
        try {
          unexpectedChild?.kill();
        } catch {
          // A correct fail-closed launch never creates this child.
        }
        if (previousStrict === undefined) {
          delete process.env.CC_SANDBOX_STRICT;
        } else {
          process.env.CC_SANDBOX_STRICT = previousStrict;
        }
        if (previousDisable === undefined) {
          delete process.env.CC_SANDBOX_DISABLE;
        } else {
          process.env.CC_SANDBOX_DISABLE = previousDisable;
        }
        executionBroker._sandboxEnabled = previousSandboxEnabled;
        executionBroker._platformSandboxEnabled = previousPlatformEnabled;
      }
    }, 90_000);
  },
);

describe("ProcessExecutionBroker sandbox-plan consumption", () => {
  let originalNative;
  let originalAdapter;
  let originalSandboxEnabled;
  let originalPlatformSandboxEnabled;
  let originalCredentialFiltering;
  let originalCredentialAgentEnabled;
  let originalDisable;
  let originalStrict;
  let emitWarning;
  let normalizeSandboxExecutionContract;

  beforeEach(() => {
    originalNative = executionBroker._native;
    originalAdapter = executionBroker._sandboxAdapter;
    originalSandboxEnabled = executionBroker._sandboxEnabled;
    originalPlatformSandboxEnabled = executionBroker._platformSandboxEnabled;
    originalCredentialFiltering = executionBroker._credentialFilteringEnabled;
    originalCredentialAgentEnabled = executionBroker._credentialAgentEnabled;
    originalDisable = process.env.CC_SANDBOX_DISABLE;
    originalStrict = process.env.CC_SANDBOX_STRICT;

    delete process.env.CC_SANDBOX_DISABLE;
    delete process.env.CC_SANDBOX_STRICT;
    executionBroker._sandboxEnabled = true;
    executionBroker._platformSandboxEnabled = true;
    executionBroker._credentialFilteringEnabled = false;
    executionBroker._credentialAgentEnabled = false;
    executionBroker.flushAuditLog();
    emitWarning = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    normalizeSandboxExecutionContract = null;
  });

  afterEach(() => {
    executionBroker._native = originalNative;
    executionBroker._sandboxAdapter = originalAdapter;
    executionBroker._sandboxEnabled = originalSandboxEnabled;
    executionBroker._platformSandboxEnabled = originalPlatformSandboxEnabled;
    executionBroker._credentialFilteringEnabled = originalCredentialFiltering;
    executionBroker._credentialAgentEnabled = originalCredentialAgentEnabled;
    if (originalDisable === undefined) {
      delete process.env.CC_SANDBOX_DISABLE;
    } else {
      process.env.CC_SANDBOX_DISABLE = originalDisable;
    }
    if (originalStrict === undefined) {
      delete process.env.CC_SANDBOX_STRICT;
    } else {
      process.env.CC_SANDBOX_STRICT = originalStrict;
    }
    executionBroker.flushAuditLog();
    normalizeSandboxExecutionContract?.mockRestore();
    emitWarning.mockRestore();
  });

  it("passes adapter command, args, and options to async native spawn", () => {
    const child = createChild();
    const nativeSpawn = vi.fn(() => child);
    const apply = vi.fn((command, args, options) =>
      appliedPlan("sandbox-wrapper", ["--", command, ...args], {
        ...options,
        sandboxOption: true,
      }),
    );
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: apply,
      postSpawnSandbox: vi.fn(),
    };

    const returned = executionBroker.spawn("tool", ["run"], {
      origin: "test:sandbox-plan",
      policy: "allow",
      env: { PATH: "safe" },
    });

    expect(returned).toBe(child);
    expect(nativeSpawn).toHaveBeenCalledWith(
      "sandbox-wrapper",
      ["--", "tool", "run"],
      expect.objectContaining({
        sandboxOption: true,
        env: { PATH: "safe" },
      }),
    );
    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      sandboxed: true,
      sandboxProfile: "default",
      sandboxEnforcement: "test-sandbox",
      sandboxBackend: "test-sandbox",
      sandboxRequired: [],
      sandboxGuarantees: [],
      sandboxState: "ready",
    });
  });

  it("does not dispatch an injected adapter through its mutable call property", () => {
    const child = createChild();
    const nativeSpawn = vi.fn(() => child);
    const poisonedCall = vi.fn(() => {
      throw new Error("poisoned Function.call must not run");
    });
    const apply = vi.fn((command, args, options) =>
      appliedPlan("sandbox-wrapper", ["--", command, ...args], options),
    );
    Object.defineProperty(apply, "call", {
      configurable: true,
      value: poisonedCall,
    });
    let getterReads = 0;
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      get applySandbox() {
        getterReads += 1;
        return apply;
      },
      postSpawnSandbox: vi.fn(),
    };

    expect(
      executionBroker.spawn("tool", ["run"], {
        origin: "test:poisoned-adapter-call",
        policy: "allow",
      }),
    ).toBe(child);
    expect(getterReads).toBe(1);
    expect(apply).toHaveBeenCalledOnce();
    expect(poisonedCall).not.toHaveBeenCalled();
    expect(nativeSpawn).toHaveBeenCalledOnce();
  });

  it("rejects a structurally valid Linux bwrap plan from an injected adapter", () => {
    const nativeSpawn = vi.fn();
    const cleanup = vi.fn();
    const plan = appliedLinuxBwrapPluginTreePlan(
      "tool",
      ["run"],
      {
        cwd: "/workspace",
        shell: false,
        stdio: ["pipe", "pipe", "pipe", 41, 42],
      },
      { cleanup },
    );
    expect(
      executionBroker._validateSandboxPlan(
        plan,
        trustedBuiltInLinuxLaunchContext({
          cwd: "/workspace",
          requiredBoundaries: [
            SANDBOX_BOUNDARIES.FILESYSTEM,
            SANDBOX_BOUNDARIES.NETWORK,
          ],
        }),
      ),
    ).toMatchObject({
      applied: true,
      backend: "linux-bwrap",
    });
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: vi.fn(() => plan),
      postSpawnSandbox: vi.fn(),
    };

    expect(() =>
      executionBroker.spawn("tool", ["run"], {
        origin: "plugin:bin",
        policy: "allow",
        cwd: "/workspace",
        shell: false,
        requiredBoundaries: [
          SANDBOX_BOUNDARIES.FILESYSTEM,
          SANDBOX_BOUNDARIES.NETWORK,
        ],
      }),
    ).toThrow(
      "Applied Linux bubblewrap plans require the built-in sandbox adapter",
    );
    expect(nativeSpawn).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("rejects a reserved bwrap backend declared for another platform", () => {
    const nativeSpawn = vi.fn();
    const cleanup = vi.fn();
    const plan = appliedPlan(
      "/bin/evil",
      [],
      {},
      {
        platform: "darwin",
        enforcement: "linux-bwrap",
        backend: "linux-bwrap",
        guarantees: [SANDBOX_BOUNDARIES.FILESYSTEM],
        cleanup,
      },
    );
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: vi.fn(() => plan),
      postSpawnSandbox: vi.fn(),
    };

    expect(() =>
      executionBroker.spawn("tool", ["run"], {
        origin: "test:cross-platform-reserved-bwrap",
        policy: "allow",
        sandboxPolicy: {
          requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
        },
      }),
    ).toThrow("Reserved Linux bubblewrap backends require platform linux");
    expect(nativeSpawn).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("rejects the reserved Linux FD snapshot backend outside its built-in Linux authority", () => {
    const nativeSpawn = vi.fn();
    const nativeSpawnSync = vi.fn();
    const asyncCleanup = vi.fn();
    const syncCleanup = vi.fn();
    const createForgedPlan = (cleanup) =>
      appliedPlan(
        "/bin/evil",
        [],
        {},
        {
          platform: "darwin",
          enforcement: "linux-fd-code-snapshot",
          backend: "linux-fd-code-snapshot",
          guarantees: [SANDBOX_BOUNDARIES.FILESYSTEM],
          cleanup,
        },
      );
    executionBroker._native = {
      spawn: nativeSpawn,
      spawnSync: nativeSpawnSync,
    };
    executionBroker._sandboxAdapter = {
      applySandbox: vi
        .fn()
        .mockReturnValueOnce(createForgedPlan(asyncCleanup))
        .mockReturnValueOnce(createForgedPlan(syncCleanup)),
      postSpawnSandbox: vi.fn(),
    };
    const options = {
      origin: "test:cross-platform-reserved-fd-snapshot",
      policy: "allow",
      sandboxPolicy: {
        requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
      },
    };

    expect(() => executionBroker.spawn("tool", ["run"], options)).toThrow(
      "Reserved Linux FD code snapshot backend requires platform linux",
    );
    expect(() => executionBroker.spawnSync("tool", ["run"], options)).toThrow(
      "Reserved Linux FD code snapshot backend requires platform linux",
    );
    expect(nativeSpawn).not.toHaveBeenCalled();
    expect(nativeSpawnSync).not.toHaveBeenCalled();
    expect(asyncCleanup).toHaveBeenCalledOnce();
    expect(syncCleanup).toHaveBeenCalledOnce();

    expect(() =>
      executionBroker._validateSandboxPlan(
        {
          ...createForgedPlan(vi.fn()),
          platform: "linux",
        },
        trustedBuiltInLinuxLaunchContext(),
      ),
    ).toThrow(
      "Reserved Linux FD code snapshot backend requires the code-snapshot guarantee",
    );

    const missingBackendPlan = {
      ...createForgedPlan(vi.fn()),
      platform: "linux",
      guarantees: [SANDBOX_BOUNDARIES.CODE_SNAPSHOT],
    };
    delete missingBackendPlan.backend;
    for (const mismatchedPlan of [
      missingBackendPlan,
      { ...missingBackendPlan, backend: undefined },
      { ...missingBackendPlan, backend: null },
      {
        ...missingBackendPlan,
        backend: "linux-fd-code-snapshot",
        enforcement: "not-linux-fd-code-snapshot",
      },
    ]) {
      expect(() =>
        executionBroker._validateSandboxPlan(
          mismatchedPlan,
          trustedBuiltInLinuxLaunchContext({
            requiredBoundaries: [SANDBOX_BOUNDARIES.CODE_SNAPSHOT],
          }),
        ),
      ).toThrow(
        "Reserved Linux FD code snapshot backend requires exact backend and enforcement names",
      );
    }
  });

  it("rejects plugin bwrap plans that attach a workspace-only PTY policy", () => {
    const nativeSpawn = vi.fn();
    const cleanup = vi.fn();
    const plan = appliedLinuxBwrapPluginTreePlan(
      "tool",
      ["run"],
      {
        cwd: "/workspace",
        shell: false,
        stdio: ["pipe", "pipe", "pipe", 41, 42],
      },
      {
        cleanup,
        ptyPolicy: { mode: "dedicated-controlling-terminal" },
      },
    );
    expect(plan.ptyPolicy).toEqual({
      mode: "dedicated-controlling-terminal",
    });
    expect(() =>
      executionBroker._validateSandboxPlan(
        plan,
        trustedBuiltInLinuxLaunchContext(),
      ),
    ).toThrow(
      "Applied Linux bubblewrap plans require the exact typed descriptor scrubber launch contract",
    );
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: vi.fn(() => plan),
      postSpawnSandbox: vi.fn(),
    };

    expect(() =>
      executionBroker.spawn("tool", ["run"], {
        origin: "test:plugin-bwrap-forged-pty-policy",
        policy: "allow",
        sandboxPolicy: {
          requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
        },
      }),
    ).toThrow(
      "Applied Linux bubblewrap plans require the built-in sandbox adapter",
    );
    expect(nativeSpawn).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("rejects a stateful sandbox-plan command getter before native launch", () => {
    const nativeSpawn = vi.fn();
    const cleanup = vi.fn();
    const plan = appliedLinuxBwrapPluginTreePlan(
      "tool",
      ["run"],
      {
        cwd: "/workspace",
        shell: false,
        stdio: ["pipe", "pipe", "pipe", 41, 42],
      },
      { cleanup },
    );
    const validCommand = plan.command;
    let commandReads = 0;
    Object.defineProperty(plan, "command", {
      configurable: true,
      enumerable: true,
      get() {
        commandReads += 1;
        return commandReads === 1 ? validCommand : "/bin/evil";
      },
    });
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: vi.fn(() => plan),
      postSpawnSandbox: vi.fn(),
    };

    expect(() =>
      executionBroker.spawn("tool", ["run"], {
        origin: "test:stateful-sandbox-command-getter",
        policy: "allow",
        sandboxPolicy: {
          requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
        },
      }),
    ).toThrow("Sandbox spawn plan must use own data properties");
    expect(commandReads).toBe(0);
    expect(nativeSpawn).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("rejects a stateful sandbox-plan applied getter before native launch", () => {
    const nativeSpawn = vi.fn();
    const cleanup = vi.fn();
    const plan = appliedLinuxBwrapPluginTreePlan(
      "tool",
      ["run"],
      {
        cwd: "/workspace",
        shell: false,
        stdio: ["pipe", "pipe", "pipe", 41, 42],
      },
      { cleanup },
    );
    let appliedReads = 0;
    Object.defineProperty(plan, "applied", {
      configurable: true,
      enumerable: true,
      get() {
        appliedReads += 1;
        return appliedReads >= 6;
      },
    });
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: vi.fn(() => plan),
      postSpawnSandbox: vi.fn(),
    };

    expect(() =>
      executionBroker.spawn("tool", ["run"], {
        origin: "test:stateful-sandbox-applied-getter",
        policy: "allow",
        sandboxPolicy: {
          requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
        },
      }),
    ).toThrow("Sandbox spawn plan must use own data properties");
    expect(appliedReads).toBe(0);
    expect(nativeSpawn).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("preserves extended runtime probe evidence in the audit log", () => {
    const child = createChild();
    const nativeSpawn = vi.fn(() => child);
    const runtimeProbe = {
      kind: "windows-plugin-node-entry-snapshot-v1",
      attempted: true,
      runnable: true,
      reason: null,
      probeRuntime: "node",
      targetRuntime: "node",
      contentSnapshot: true,
      handleAtomic: false,
      contentSnapshotScope: "plugin-entry-source",
      contentSnapshotMechanism:
        "verified-handle-inherited-pipe-module-compile-v1",
    };
    const apply = vi.fn((command, args, options) =>
      appliedPlan("sandbox-wrapper", ["--", command, ...args], options, {
        runtimeProbe,
      }),
    );
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: apply,
      postSpawnSandbox: vi.fn(),
    };

    executionBroker.spawn("tool", ["run"], {
      origin: "test:sandbox-runtime-probe",
      policy: "allow",
    });

    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      sandboxRuntimeProbe: runtimeProbe,
    });
  });

  it("validates Node plugin-tree evidence but rejects its injected adapter", () => {
    const nativeSpawn = vi.fn();
    const cleanup = vi.fn();
    const runtimeProbe = createLinuxPluginTreeRuntimeProbe();
    const plan = appliedLinuxBwrapPluginTreePlan(
      "tool",
      ["run"],
      {},
      {
        runtimeProbe,
        cleanup,
      },
    );
    expect(
      executionBroker._validateSandboxPlan(
        plan,
        trustedBuiltInLinuxLaunchContext(),
      ).runtimeProbe,
    ).toEqual(expectedLinuxDescriptorRuntimeProbe(runtimeProbe));
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: vi.fn(() => plan),
      postSpawnSandbox: vi.fn(),
    };

    expect(() =>
      executionBroker.spawn("tool", ["run"], {
        origin: "test:plugin-tree-runtime-probe",
        policy: "allow",
        sandboxPolicy: {
          requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
        },
      }),
    ).toThrow(
      "Applied Linux bubblewrap plans require the built-in sandbox adapter",
    );
    expect(nativeSpawn).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "forged complete-tree scope",
      {
        pluginTreeContentSnapshotScope: "plugin-entry-source",
      },
    ],
    [
      "incomplete evidence",
      {
        pluginTreeContentSnapshotMechanism: undefined,
      },
    ],
    [
      "atomic claim",
      {
        pluginTreeSnapshotAtomic: true,
      },
    ],
    [
      "regular-file count above 256",
      {
        pluginTreeContentSnapshotFiles: 257,
      },
    ],
    [
      "aggregate bytes above 256 MiB",
      {
        pluginTreeContentSnapshotBytes: 256 * 1024 * 1024 + 1,
      },
    ],
    [
      "with attempted=false",
      {
        attempted: false,
      },
    ],
    [
      "with a non-null reason",
      {
        reason: "forged_success",
      },
    ],
    [
      "with a non-Node probe runtime",
      {
        probeRuntime: "python",
      },
    ],
    [
      "without a bound supervisor",
      {
        supervisorDescriptorBound: false,
        supervisorExecutablePinned: false,
        supervisorDescriptorContained: false,
        supervisorDescriptorConsumedBeforeTarget: false,
        supervisorStagingPathHidden: false,
        supervisorTemporaryCopyObscured: false,
      },
    ],
    [
      "on a non-Linux platform",
      {},
      {
        platform: "darwin",
      },
    ],
    [
      "with a candidate backend",
      {},
      {
        candidateBackend: "linux-bwrap",
      },
    ],
    [
      "from a non-bwrap backend",
      {},
      {
        backend: "forged-backend",
      },
    ],
    [
      "with non-bwrap enforcement",
      {},
      {
        enforcement: "forged-enforcement",
      },
    ],
    [
      "without policy attestation",
      {},
      {
        policyAttested: false,
      },
    ],
    [
      "without a policy digest",
      {},
      {
        policyDigest: undefined,
      },
    ],
    [
      "without both strong guarantees",
      {},
      {
        guarantees: [SANDBOX_BOUNDARIES.FILESYSTEM],
      },
    ],
  ])(
    "rejects Node plugin-tree snapshot %s before native spawn",
    (_label, runtimeProbeOverrides, planOverrides = {}) => {
      const nativeSpawn = vi.fn();
      executionBroker._native = { spawn: nativeSpawn };
      const plan = appliedLinuxBwrapPluginTreePlan(
        "tool",
        ["run"],
        {},
        {
          runtimeProbe: createLinuxPluginTreeRuntimeProbe(
            runtimeProbeOverrides,
          ),
          ...planOverrides,
        },
      );

      expect(() =>
        executionBroker._validateSandboxPlan(
          plan,
          trustedBuiltInLinuxLaunchContext({
            requiredBoundaries: [SANDBOX_BOUNDARIES.PROCESS_TREE],
          }),
        ),
      ).toThrow(
        _label === "on a non-Linux platform"
          ? /Reserved Linux bubblewrap backends require platform linux/
          : _label === "from a non-bwrap backend"
            ? /descriptor scrubber evidence requires an applied bubblewrap backend/
            : /plugin tree snapshot evidence/,
      );
      expect(nativeSpawn).not.toHaveBeenCalled();
    },
  );

  it("validates dynamic ELF graph evidence but rejects its injected adapter", () => {
    const nativeSpawn = vi.fn();
    const cleanup = vi.fn();
    const runtimeProbe = createLinuxDynamicNativeRuntimeProbe();
    const plan = appliedLinuxBwrapDynamicNativePlan(
      "tool",
      ["run"],
      {},
      {
        runtimeProbe,
        cleanup,
      },
    );
    expect(
      executionBroker._validateSandboxPlan(
        plan,
        trustedBuiltInLinuxLaunchContext(),
      ).runtimeProbe,
    ).toEqual(expectedLinuxDescriptorRuntimeProbe(runtimeProbe));
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: vi.fn(() => plan),
      postSpawnSandbox: vi.fn(),
    };

    expect(() =>
      executionBroker.spawn("tool", ["run"], {
        origin: "test:dynamic-native-runtime-probe",
        policy: "allow",
        sandboxPolicy: {
          requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
        },
      }),
    ).toThrow(
      "Applied Linux bubblewrap plans require the built-in sandbox adapter",
    );
    expect(nativeSpawn).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("preserves a zero-capability runtime attestation through plan validation", () => {
    const plan = appliedPlan(
      "sandbox-helper",
      ["payload"],
      {},
      {
        backend: "test-sandbox",
        guarantees: [],
        runtimeProbe: {
          kind: "windows-appcontainer-launch-attestation-v1",
          attempted: true,
          runnable: true,
          reason: null,
          capabilityCount: 0,
        },
      },
    );

    expect(executionBroker._validateSandboxPlan(plan).runtimeProbe).toEqual(
      plan.runtimeProbe,
    );
  });

  it.each([
    ["missing", undefined],
    ["nonzero", 1],
  ])(
    "rejects %s capability evidence for a Windows AppContainer runtime attestation",
    (_label, capabilityCount) => {
      const runtimeProbe = {
        kind: "windows-appcontainer-launch-attestation-v1",
        attempted: true,
        runnable: true,
        reason: null,
        ...(capabilityCount === undefined ? {} : { capabilityCount }),
      };
      const plan = appliedPlan(
        "sandbox-helper",
        ["payload"],
        {},
        {
          backend: "test-sandbox",
          guarantees: [],
          runtimeProbe,
        },
      );

      expect(() => executionBroker._validateSandboxPlan(plan)).toThrow(
        "Windows AppContainer runtime evidence must attest zero capabilities",
      );
    },
  );

  it("does not fabricate capability evidence for a failed AppContainer probe", () => {
    const plan = appliedPlan(
      "sandbox-helper",
      ["payload"],
      {},
      {
        backend: "test-sandbox",
        guarantees: [],
        runtimeProbe: {
          kind: "windows-appcontainer-launch-attestation-v1",
          attempted: true,
          runnable: false,
          reason: "probe_failed",
        },
      },
    );

    expect(executionBroker._validateSandboxPlan(plan).runtimeProbe).toEqual(
      plan.runtimeProbe,
    );
  });

  it("validates static native tree evidence but rejects its injected adapter", () => {
    const nativeSpawn = vi.fn();
    const cleanup = vi.fn();
    const runtimeProbe = createLinuxStaticNativeRuntimeProbe();
    const plan = appliedLinuxBwrapPluginTreePlan(
      "tool",
      ["run"],
      {},
      {
        runtimeProbe,
        cleanup,
      },
    );
    expect(
      executionBroker._validateSandboxPlan(
        plan,
        trustedBuiltInLinuxLaunchContext(),
      ).runtimeProbe,
    ).toEqual(expectedLinuxDescriptorRuntimeProbe(runtimeProbe));
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: vi.fn(() => plan),
      postSpawnSandbox: vi.fn(),
    };

    expect(() =>
      executionBroker.spawn("tool", ["run"], {
        origin: "test:static-native-tree-runtime-probe",
        policy: "allow",
        sandboxPolicy: {
          requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
        },
      }),
    ).toThrow(
      "Applied Linux bubblewrap plans require the built-in sandbox adapter",
    );
    expect(nativeSpawn).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "missing complete-tree evidence",
      {
        pluginTreeContentSnapshot: undefined,
        pluginTreeContentSnapshotScope: undefined,
        pluginTreeContentSnapshotMechanism: undefined,
        pluginTreeContentSnapshotFiles: undefined,
        pluginTreeContentSnapshotBytes: undefined,
        pluginTreeContentSnapshotDigest: undefined,
        pluginTreeSnapshotConsistency: undefined,
        pluginTreeSnapshotContractBound: undefined,
        pluginTreeSnapshotAtomic: undefined,
      },
      /requires a complete plugin tree snapshot/,
    ],
    [
      "Node entry scope",
      { pluginTreeContentSnapshotScope: "plugin-entry-source" },
      /plugin tree snapshot evidence/,
    ],
  ])(
    "rejects successful dynamic native evidence with %s before native spawn",
    (_label, runtimeProbeOverrides, expectedError) => {
      const nativeSpawn = vi.fn();
      executionBroker._native = { spawn: nativeSpawn };
      const plan = appliedLinuxBwrapDynamicNativePlan(
        "tool",
        ["run"],
        {},
        {
          runtimeProbe: createLinuxDynamicNativeRuntimeProbe(
            runtimeProbeOverrides,
          ),
        },
      );

      expect(() =>
        executionBroker._validateSandboxPlan(
          plan,
          trustedBuiltInLinuxLaunchContext(),
        ),
      ).toThrow(expectedError);
      expect(nativeSpawn).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      "a missing pathname-closure discriminator",
      {
        runtimeSharedLibraryPathnameClosure: undefined,
        supervisorPid1ExecutableExposure: "procfs",
      },
      /pathname shared-library evidence requires runtimeSharedLibraryPathnameClosure/,
    ],
    [
      "a forged exclusion boundary",
      { runtimeSharedLibraryPathnameClosureExcludes: "all-executable-memory" },
    ],
    [
      "a forged pathname scope",
      { runtimeSharedLibraryClosureScope: "all-native-code" },
    ],
    [
      "a forged enforcement mechanism",
      { runtimeSharedLibraryClosureMechanism: "startup-graph-scan" },
    ],
    ["an empty load set", { runtimeSharedLibraryLoadSetFiles: 0 }],
    ["an oversized load set", { runtimeSharedLibraryLoadSetFiles: 513 }],
    ["zero attested bytes", { runtimeSharedLibraryLoadSetBytes: 0 }],
    [
      "an oversized byte aggregate",
      { runtimeSharedLibraryLoadSetBytes: 1024 * 1024 * 1024 + 1 },
    ],
    [
      "an invalid load-set digest",
      { runtimeSharedLibraryLoadSetDigest: "F".repeat(64) },
      /runtimeSharedLibraryLoadSetDigest must be a lowercase SHA-256 value/,
    ],
    ["an unbound load set", { runtimeLoadSetPolicyBound: false }],
    ["a writable filesystem", { runtimeWritableFilesystems: true }],
    ["a mounted procfs", { runtimeProcfsMounted: true }],
    ["a mounted devfs", { runtimeDevfsMounted: true }],
    ["writable scratch", { runtimeScratchWritable: true }],
    ["descriptor reopen paths", { runtimeDescriptorReopenPaths: true }],
    [
      "procfs supervisor exposure",
      { supervisorPid1ExecutableExposure: "procfs" },
      /bound supervisor evidence/,
    ],
  ])(
    "rejects dynamic runtime pathname closure evidence with %s",
    (_label, runtimeProbeOverrides, expectedError) => {
      const nativeSpawn = vi.fn();
      executionBroker._native = { spawn: nativeSpawn };
      const plan = appliedLinuxBwrapDynamicNativePlan(
        "tool",
        ["run"],
        {},
        {
          runtimeProbe: createLinuxDynamicNativeRuntimeProbe(
            runtimeProbeOverrides,
          ),
        },
      );

      expect(() =>
        executionBroker._validateSandboxPlan(
          plan,
          trustedBuiltInLinuxLaunchContext(),
        ),
      ).toThrow(expectedError || /typed read-only no-proc bwrap contract/);
      expect(nativeSpawn).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      "a procfs mount",
      (args, separator) => args.splice(separator, 0, "--proc", "/proc"),
    ],
    [
      "an unknown future bwrap option",
      (args, separator) =>
        args.splice(separator, 0, "--future-filesystem-option", "/unapproved"),
    ],
    [
      "an injected loader environment variable",
      (args, separator) =>
        args.splice(separator, 0, "--setenv", "LD_PRELOAD", "/unapproved.so"),
    ],
    [
      "an unapproved writable tmpfs",
      (args) => {
        args[args.indexOf("/run", args.indexOf("--tmpfs"))] = "/tmp";
      },
    ],
    [
      "an unbound host pathname mount",
      (args, separator) =>
        args.splice(
          separator,
          0,
          "--ro-bind",
          "/host/unapproved.so",
          "/lib/unapproved.so",
        ),
    ],
    [
      "an extra descriptor-created regular file",
      (args, separator) =>
        args.splice(
          separator,
          0,
          "--file",
          "10",
          "/opt/chainless/plugin/unapproved.so",
        ),
    ],
    [
      "a non-sequential load-set descriptor",
      (args) => {
        args[args.indexOf("--ro-bind-fd") + 1] = "8";
      },
    ],
    [
      "a caller-owned raw Node runtime descriptor",
      (args) => {
        const runtimeDestination = args.indexOf("/opt/chainless/runtime/node");
        args.splice(
          runtimeDestination - 4,
          5,
          "--ro-bind-fd",
          "4",
          "/opt/chainless/runtime/node",
        );
      },
    ],
    [
      "a mismatched seccomp descriptor",
      (args) => {
        args[args.indexOf("--seccomp") + 1] = "10";
      },
    ],
    [
      "remount ordering after the writable overlay",
      (args) => {
        const rootRemount = args.indexOf("--remount-ro");
        const pair = args.splice(rootRemount, 2);
        const runRemount = args.lastIndexOf("--remount-ro");
        args.splice(runRemount + 2, 0, ...pair);
      },
    ],
  ])(
    "rejects a dynamic runtime pathname closure plan with %s",
    (_label, mutateArgs) => {
      const nativeSpawn = vi.fn();
      executionBroker._native = { spawn: nativeSpawn };
      const plan = appliedLinuxBwrapDynamicNativePlan("tool", ["run"], {});
      const forgedArgs = [...plan.args];
      mutateArgs(forgedArgs, forgedArgs.indexOf("--"));
      const forgedPlan = { ...plan, args: forgedArgs };

      expect(() =>
        executionBroker._validateSandboxPlan(
          forgedPlan,
          trustedBuiltInLinuxLaunchContext(),
        ),
      ).toThrow(/typed read-only no-proc bwrap contract/);
      expect(nativeSpawn).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      "forged scope",
      {
        initialDynamicLoadClosureScope: "all-runtime-files",
      },
    ],
    [
      "forged mechanism",
      {
        initialDynamicLoadClosureMechanism: "path-based-loader-closure",
      },
    ],
    [
      "interpreter outside system roots",
      {
        initialDynamicInterpreter: "/tmp/ld-linux.so",
      },
    ],
    [
      "non-canonical interpreter",
      {
        initialDynamicInterpreter: "/lib64/../lib64/ld-linux-x86-64.so.2",
      },
    ],
    [
      "dependency edge count above 1024",
      {
        initialDynamicDependencyCount: 1025,
      },
    ],
    [
      "runtime file count above 256",
      {
        initialDynamicRuntimeFileCount: 257,
      },
    ],
    [
      "aggregate runtime bytes above 512 MiB",
      {
        initialDynamicRuntimeBytes: 512 * 1024 * 1024 + 1,
      },
    ],
    [
      "missing aggregate runtime bytes",
      {
        initialDynamicRuntimeBytes: undefined,
      },
    ],
    [
      "a forged arbitrary shared-library closure claim",
      {
        sharedLibraryClosure: true,
      },
    ],
    [
      "invalid digest",
      {
        initialDynamicLoadClosureDigest: "D".repeat(64),
      },
    ],
    [
      "non-dynamic kind",
      {
        kind: "linux-bwrap-plugin-native-static-elf-policy-v1",
      },
      /plugin tree snapshot evidence/,
    ],
    [
      "non-dynamic target runtime",
      {
        targetRuntime: "native-static-elf",
      },
      /plugin tree snapshot evidence/,
    ],
    [
      "atomic handle claim",
      {
        handleAtomic: true,
      },
      /plugin tree snapshot evidence/,
    ],
    [
      "without descriptor binding",
      {
        initialDynamicLoadClosureDescriptorBound: false,
      },
    ],
  ])(
    "rejects dynamic ELF recursive startup-graph evidence with %s before native spawn",
    (_label, runtimeProbeOverrides, expectedError) => {
      const nativeSpawn = vi.fn();
      executionBroker._native = { spawn: nativeSpawn };
      const plan = appliedLinuxBwrapDynamicNativePlan(
        "tool",
        ["run"],
        {},
        {
          runtimeProbe: createLinuxDynamicNativeRuntimeProbe(
            runtimeProbeOverrides,
          ),
        },
      );

      expect(() =>
        executionBroker._validateSandboxPlan(
          plan,
          trustedBuiltInLinuxLaunchContext(),
        ),
      ).toThrow(
        expectedError ||
          /initialDynamicLoadClosure|initial recursive dynamic system graph/,
      );
      expect(nativeSpawn).not.toHaveBeenCalled();
    },
  );

  it("rejects successful dynamic ELF evidence without a descriptor-bound recursive startup graph", () => {
    const nativeSpawn = vi.fn();
    executionBroker._native = { spawn: nativeSpawn };
    const plan = appliedLinuxBwrapDynamicNativePlan(
      "tool",
      ["run"],
      {},
      {
        runtimeProbe: createLinuxDynamicNativeRuntimeProbe({
          initialDynamicLoadClosureDescriptorBound: undefined,
          initialDynamicLoadClosureScope: undefined,
          initialDynamicLoadClosureMechanism: undefined,
          initialDynamicInterpreter: undefined,
          initialDynamicDependencyCount: undefined,
          initialDynamicRuntimeFileCount: undefined,
          initialDynamicRuntimeBytes: undefined,
          initialDynamicLoadClosureDigest: undefined,
        }),
      },
    );

    expect(() =>
      executionBroker._validateSandboxPlan(
        plan,
        trustedBuiltInLinuxLaunchContext(),
      ),
    ).toThrow(/successful dynamic ELF evidence/);
    expect(nativeSpawn).not.toHaveBeenCalled();
  });

  it("preserves complete bwrap supervisor evidence in the audit log", () => {
    const child = createChild();
    const nativeSpawn = vi.fn(() => child);
    const runtimeProbe = createLinuxSupervisorRuntimeProbe();
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: vi.fn((command, args, options) =>
        appliedPlan("sandbox-wrapper", ["--", command, ...args], options, {
          runtimeProbe,
        }),
      ),
      postSpawnSandbox: vi.fn(),
    };

    const returned = executionBroker.spawn("tool", ["run"], {
      origin: "test:bwrap-supervisor-runtime-probe",
      policy: "allow",
    });

    expect(returned).toBe(child);
    expect(nativeSpawn).toHaveBeenCalledOnce();
    expect(executionBroker.getAuditLog(1)[0].sandboxRuntimeProbe).toEqual(
      runtimeProbe,
    );
  });

  it.each([
    "supervisorDescriptorBound",
    "supervisorExecutablePinned",
    "supervisorDescriptorContained",
    "supervisorDescriptorConsumedBeforeTarget",
    "supervisorStagingPathHidden",
    "supervisorTemporaryCopyObscured",
  ])("rejects a non-boolean runtime probe %s before native spawn", (field) => {
    const nativeSpawn = vi.fn();
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: vi.fn((command, args, options) =>
        appliedPlan(command, args, options, {
          runtimeProbe: createLinuxSupervisorRuntimeProbe({
            [field]: "yes",
          }),
        }),
      ),
      postSpawnSandbox: vi.fn(),
    };

    expect(() =>
      executionBroker.spawn("tool", ["run"], {
        origin: `test:invalid-bwrap-supervisor-boolean-${field}`,
        policy: "allow",
        sandboxPolicy: {
          requiredBoundaries: [SANDBOX_BOUNDARIES.PROCESS_TREE],
        },
      }),
    ).toThrow(/Sandbox runtime probe/);
    expect(nativeSpawn).not.toHaveBeenCalled();
  });

  it.each([
    ["supervisorBindingScope", ""],
    ["supervisorBindingScope", "generic"],
    ["supervisorDescriptorBindingMechanism", []],
    ["supervisorDescriptorBindingMechanism", "other"],
    ["supervisorPid1ExecutableExposure", null],
    ["supervisorPid1ExecutableExposure", "hidden"],
  ])(
    "rejects an invalid runtime probe %s string before native spawn",
    (field, value) => {
      const nativeSpawn = vi.fn();
      executionBroker._native = { spawn: nativeSpawn };
      executionBroker._sandboxAdapter = {
        applySandbox: vi.fn((command, args, options) =>
          appliedPlan(command, args, options, {
            runtimeProbe: createLinuxSupervisorRuntimeProbe({
              [field]: value,
            }),
          }),
        ),
        postSpawnSandbox: vi.fn(),
      };

      expect(() =>
        executionBroker.spawn("tool", ["run"], {
          origin: `test:invalid-bwrap-supervisor-string-${field}`,
          policy: "allow",
          sandboxPolicy: {
            requiredBoundaries: [SANDBOX_BOUNDARIES.PROCESS_TREE],
          },
        }),
      ).toThrow(/Sandbox runtime probe/);
      expect(nativeSpawn).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["object", null],
    [
      "path",
      createLinuxSupervisorExecutableIdentity({
        path: "",
      }),
    ],
    [
      "sha256",
      createLinuxSupervisorExecutableIdentity({
        sha256: "not-a-sha256",
      }),
    ],
    [
      "fileId",
      createLinuxSupervisorExecutableIdentity({
        fileId: { dev: "11" },
      }),
    ],
    [
      "bytes",
      createLinuxSupervisorExecutableIdentity({
        bytes: -1,
      }),
    ],
    [
      "oversized bytes",
      createLinuxSupervisorExecutableIdentity({
        bytes: 256 * 1024 * 1024 + 1,
      }),
    ],
    [
      "mtimeMs",
      createLinuxSupervisorExecutableIdentity({
        mtimeMs: "1234",
      }),
    ],
    [
      "mode",
      createLinuxSupervisorExecutableIdentity({
        mode: 0.5,
      }),
    ],
    [
      "unsafe mode",
      createLinuxSupervisorExecutableIdentity({
        mode: 0o100777,
      }),
    ],
    [
      "uid",
      createLinuxSupervisorExecutableIdentity({
        uid: -1,
      }),
    ],
    [
      "non-root uid",
      createLinuxSupervisorExecutableIdentity({
        uid: 1,
      }),
    ],
    [
      "gid",
      createLinuxSupervisorExecutableIdentity({
        gid: "0",
      }),
    ],
  ])(
    "rejects an invalid bwrap supervisor executable identity %s before native spawn",
    (_field, supervisorExecutableIdentity) => {
      const nativeSpawn = vi.fn();
      executionBroker._native = { spawn: nativeSpawn };
      executionBroker._sandboxAdapter = {
        applySandbox: vi.fn((command, args, options) =>
          appliedPlan(command, args, options, {
            runtimeProbe: createLinuxSupervisorRuntimeProbe({
              supervisorExecutableIdentity,
            }),
          }),
        ),
        postSpawnSandbox: vi.fn(),
      };

      expect(() =>
        executionBroker.spawn("tool", ["run"], {
          origin: "test:invalid-bwrap-supervisor-executable-identity",
          policy: "allow",
          sandboxPolicy: {
            requiredBoundaries: [SANDBOX_BOUNDARIES.PROCESS_TREE],
          },
        }),
      ).toThrow(/Sandbox runtime probe/);
      expect(nativeSpawn).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["contentSnapshot", "yes", "must be boolean"],
    ["contentSnapshotScope", true, "must be a non-empty string"],
    ["contentSnapshotMechanism", [], "must be a non-empty string"],
  ])(
    "rejects an invalid runtime probe %s field before native spawn",
    (field, value, expectedMessage) => {
      const nativeSpawn = vi.fn();
      executionBroker._native = { spawn: nativeSpawn };
      executionBroker._sandboxAdapter = {
        applySandbox: vi.fn((command, args, options) =>
          appliedPlan(command, args, options, {
            runtimeProbe: {
              kind: "windows-plugin-node-entry-snapshot-v1",
              attempted: true,
              runnable: true,
              reason: null,
              [field]: value,
            },
          }),
        ),
        postSpawnSandbox: vi.fn(),
      };

      expect(() =>
        executionBroker.spawn("tool", ["run"], {
          origin: `test:invalid-runtime-probe-${field}`,
          policy: "allow",
          sandboxPolicy: {
            requiredBoundaries: [SANDBOX_BOUNDARIES.PROCESS_TREE],
          },
        }),
      ).toThrow(expectedMessage);
      expect(nativeSpawn).not.toHaveBeenCalled();
    },
  );

  it("enforces and audits a satisfied typed boundary policy", async () => {
    const child = createChild();
    const nativeSpawn = vi.fn(() => child);
    const apply = vi.fn((command, args, options, profile) =>
      appliedPlan("seatbelt-wrapper", [command, ...args], options, {
        platform: "darwin",
        profile,
        enforcement: "macos-seatbelt",
        backend: "macos-seatbelt",
        guarantees: [SANDBOX_BOUNDARIES.FILESYSTEM, SANDBOX_BOUNDARIES.NETWORK],
      }),
    );
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: apply,
      postSpawnSandbox: vi.fn(),
    };

    executionBroker.spawn("tool", ["run"], {
      origin: "test:sandbox-required-satisfied",
      policy: "allow",
      sandboxPolicy: {
        profile: "strict",
        requiredBoundaries: [
          SANDBOX_BOUNDARIES.FILESYSTEM,
          SANDBOX_BOUNDARIES.NETWORK,
        ],
      },
    });

    expect(apply).toHaveBeenCalledWith(
      "tool",
      ["run"],
      expect.not.objectContaining({
        sandboxPolicy: expect.anything(),
        requiredBoundaries: expect.anything(),
      }),
      "strict",
      undefined,
      {
        profile: "strict",
        requiredBoundaries: [
          SANDBOX_BOUNDARIES.FILESYSTEM,
          SANDBOX_BOUNDARIES.NETWORK,
        ],
        sync: false,
      },
    );
    const nativeOptions = nativeSpawn.mock.calls[0][2];
    expect(nativeOptions).not.toHaveProperty("sandboxPolicy");
    expect(nativeOptions).not.toHaveProperty("requiredBoundaries");
    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      sandboxed: true,
      sandboxBackend: "macos-seatbelt",
      sandboxRequired: [
        SANDBOX_BOUNDARIES.FILESYSTEM,
        SANDBOX_BOUNDARIES.NETWORK,
      ],
      sandboxGuarantees: [
        SANDBOX_BOUNDARIES.FILESYSTEM,
        SANDBOX_BOUNDARIES.NETWORK,
      ],
      sandboxState: "ready",
    });
    await expect(child.sandboxReady).resolves.toEqual({
      applied: true,
      backend: "macos-seatbelt",
      guarantees: [SANDBOX_BOUNDARIES.FILESYSTEM, SANDBOX_BOUNDARIES.NETWORK],
    });
  });

  it("validates Linux FD snapshots but rejects their injected adapter", () => {
    const nativeSpawn = vi.fn();
    const cleanup = vi.fn();
    const runtimePath = "/runtime/node";
    const entryPath = "/plugin/server.cjs";
    const executionContract = normalizedMcpCapsuleContract({
      runtimePath,
      entryPath,
    });
    normalizeSandboxExecutionContract = vi
      .spyOn(executionBroker, "_normalizeSandboxExecutionContract")
      .mockReturnValue(executionContract);
    const validPlan = appliedPlan(
      "/proc/self/fd/3",
      ["-e", MCP_STDIO_FD_ENTRY_BOOTSTRAP, "--", "--stdio"],
      { shell: false },
      {
        platform: "linux",
        enforcement: "linux-fd-code-snapshot",
        backend: "linux-fd-code-snapshot",
        candidateBackend: null,
        policyAttested: true,
        policyDigest: "9".repeat(64),
        guarantees: [SANDBOX_BOUNDARIES.CODE_SNAPSHOT],
        cleanup,
        runtimeProbe: {
          kind: "linux-mcp-capsule-code-snapshot-v1",
          attempted: true,
          runnable: true,
          reason: null,
          probeRuntime: "node",
          targetRuntime: "node",
          contentSnapshot: true,
          contentSnapshotScope: "mcp-capsule-entry-and-node-runtime",
          contentSnapshotMechanism:
            "verified-o_tmpfile-copy-inherited-fd-module-compile-v1",
          handleAtomic: true,
          entrySnapshotAtomic: true,
          runtimeLaunchAtomic: true,
          runtimeLaunchMechanism: "inherited-executable-fd-v1",
          entrySnapshotBootstrapSha256: MCP_STDIO_FD_ENTRY_BOOTSTRAP_SHA256,
          sharedLibraryClosure: false,
          runtimeSnapshotSha256: "a".repeat(64),
          runtimeSnapshotBytes: 100,
          entrySnapshotSha256: "b".repeat(64),
          entrySnapshotBytes: 200,
        },
      },
    );
    const launchContext = trustedBuiltInLinuxLaunchContext({
      command: runtimePath,
      args: [entryPath, "--stdio"],
      shell: false,
      executionContract,
      requiredBoundaries: [SANDBOX_BOUNDARIES.CODE_SNAPSHOT],
    });
    expect(
      executionBroker._validateSandboxPlan(validPlan, launchContext),
    ).toMatchObject({
      applied: true,
      backend: "linux-fd-code-snapshot",
      runtimeProbe: {
        handleAtomic: true,
        runtimeSnapshotSha256: "a".repeat(64),
        entrySnapshotSha256: "b".repeat(64),
      },
    });
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: vi.fn(() => validPlan),
      postSpawnSandbox: vi.fn(),
    };

    expect(() =>
      executionBroker.spawn(runtimePath, [entryPath, "--stdio"], {
        origin: "test:mcp-code-snapshot",
        policy: "allow",
        shell: false,
        requiredBoundaries: [SANDBOX_BOUNDARIES.CODE_SNAPSHOT],
        sandboxExecutionContract: Object.freeze({}),
      }),
    ).toThrow(
      "Applied Linux FD code snapshot plans require the built-in sandbox adapter",
    );
    expect(nativeSpawn).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(() =>
      executionBroker._validateSandboxPlan(
        validPlan,
        trustedBuiltInLinuxLaunchContext({
          command: runtimePath,
          args: [entryPath, "--stdio"],
          shell: false,
          executionContract: normalizedMcpCapsuleContract({
            runtimePath,
            entryPath,
            entrySha256: "c".repeat(64),
          }),
          requiredBoundaries: [SANDBOX_BOUNDARIES.CODE_SNAPSHOT],
        }),
      ),
    ).toThrow(
      "Code snapshot guarantee requires typed atomic MCP capsule evidence",
    );
    expect(() =>
      executionBroker._validateSandboxPlan(
        {
          ...validPlan,
          args: ["-e", MCP_STDIO_FD_ENTRY_BOOTSTRAP, "--", "--tampered"],
        },
        launchContext,
      ),
    ).toThrow(
      "Code snapshot guarantee requires typed atomic MCP capsule evidence",
    );
    expect(() =>
      executionBroker._validateSandboxPlan(
        {
          ...validPlan,
          runtimeProbe: {
            ...validPlan.runtimeProbe,
            runtimeAttestedSha256: "a".repeat(64),
            runtimeAttestedBytes: 100,
          },
        },
        launchContext,
      ),
    ).toThrow(
      "Code snapshot guarantee requires typed atomic MCP capsule evidence",
    );
  });

  it("validates Linux bwrap snapshots but rejects their injected adapter", () => {
    const nativeSpawn = vi.fn();
    const cleanup = vi.fn();
    const runtimePath = "/opt/chainless/runtime/node";
    const entryPath = "/opt/chainless/plugin/server.cjs";
    const sourceRuntimePath = "/runtime/node";
    const sourceEntryPath = "/plugin/server.cjs";
    const executionContract = normalizedMcpCapsuleContract({
      runtimePath: sourceRuntimePath,
      entryPath: sourceEntryPath,
    });
    normalizeSandboxExecutionContract = vi
      .spyOn(executionBroker, "_normalizeSandboxExecutionContract")
      .mockReturnValue(executionContract);
    const runtimeProbe = createLinuxPluginTreeRuntimeProbe({
      mcpCapsuleCodeSnapshot: true,
      entrySnapshotAtomic: true,
      runtimeLaunchAtomic: true,
      runtimeLaunchMechanism: "bwrap-descriptor-mount-node-runtime-exec-v1",
      sharedLibraryClosure: false,
      runtimeSnapshotSha256: "a".repeat(64),
      runtimeSnapshotBytes: 100,
      entrySnapshotSha256: "b".repeat(64),
      entrySnapshotBytes: 200,
      runtimeLaunchPath: runtimePath,
      entrySnapshotPath: entryPath,
    });
    const buildPlan = (probe = runtimeProbe, planOverrides = {}) =>
      appliedLinuxBwrapPluginTreePlan(
        runtimePath,
        [entryPath, "--", "--stdio"],
        { shell: false },
        {
          guarantees: [
            SANDBOX_BOUNDARIES.FILESYSTEM,
            SANDBOX_BOUNDARIES.NETWORK,
            SANDBOX_BOUNDARIES.PROCESS_TREE,
            SANDBOX_BOUNDARIES.CODE_SNAPSHOT,
          ],
          runtimeProbe: probe,
          cleanup,
          ...planOverrides,
        },
      );
    const validPlan = buildPlan();
    const launchContext = trustedBuiltInLinuxLaunchContext({
      command: sourceRuntimePath,
      args: [sourceEntryPath, "--", "--stdio"],
      shell: false,
      executionContract,
      requiredBoundaries: [
        SANDBOX_BOUNDARIES.CODE_SNAPSHOT,
        SANDBOX_BOUNDARIES.FILESYSTEM,
        SANDBOX_BOUNDARIES.NETWORK,
      ],
    });
    expect(
      executionBroker._validateSandboxPlan(validPlan, launchContext),
    ).toMatchObject({
      applied: true,
      backend: "linux-bwrap",
      runtimeProbe: {
        mcpCapsuleCodeSnapshot: true,
        entrySnapshotAtomic: true,
        runtimeLaunchAtomic: true,
        runtimeLaunchPath: runtimePath,
        entrySnapshotPath: entryPath,
      },
    });
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: vi.fn(() => validPlan),
      postSpawnSandbox: vi.fn(),
    };

    expect(() =>
      executionBroker.spawn(
        sourceRuntimePath,
        [sourceEntryPath, "--", "--stdio"],
        {
          origin: "test:forged-linux-bwrap-mcp-code-snapshot",
          policy: "allow",
          shell: false,
          requiredBoundaries: [
            SANDBOX_BOUNDARIES.CODE_SNAPSHOT,
            SANDBOX_BOUNDARIES.FILESYSTEM,
            SANDBOX_BOUNDARIES.NETWORK,
          ],
          sandboxExecutionContract: Object.freeze({}),
        },
      ),
    ).toThrow(
      "Applied Linux bubblewrap plans require the built-in sandbox adapter",
    );
    expect(nativeSpawn).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();

    expect(() =>
      executionBroker._validateSandboxPlan(
        buildPlan({ ...runtimeProbe, runtimeLaunchAtomic: false }),
        launchContext,
      ),
    ).toThrow(
      "Code snapshot guarantee requires typed atomic MCP capsule evidence",
    );
    expect(() =>
      executionBroker._validateSandboxPlan(
        {
          ...validPlan,
          args: [
            "--",
            "/bin/evil",
            "--",
            runtimePath,
            entryPath,
            "--",
            "--stdio",
          ],
        },
        launchContext,
      ),
    ).toThrow(
      "Applied Linux bubblewrap plans require the exact typed descriptor scrubber launch contract",
    );
    expect(() =>
      executionBroker._validateSandboxPlan(
        appliedLinuxBwrapPluginTreePlan(
          runtimePath,
          ["/opt/chainless/plugin/../evil", "--", "--stdio"],
          { shell: false },
          {
            guarantees: validPlan.guarantees,
            runtimeProbe: {
              ...runtimeProbe,
              entrySnapshotPath: "/opt/chainless/plugin/../evil",
            },
          },
        ),
        launchContext,
      ),
    ).toThrow(
      "Code snapshot guarantee requires typed atomic MCP capsule evidence",
    );
  });

  it("rejects macOS CODE_SNAPSHOT evidence without an atomic runtime launch", () => {
    const nativeSpawn = vi.fn();
    const cleanup = vi.fn();
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: vi.fn((_command, _args, options) =>
        appliedPlan(
          "/private/tmp/chainlesschain-node-snapshot",
          ["-e", MCP_STDIO_FD_ENTRY_BOOTSTRAP, "--", "--stdio"],
          options,
          {
            platform: "darwin",
            enforcement: "macos-fd-code-snapshot",
            backend: "macos-fd-code-snapshot",
            candidateBackend: null,
            policyAttested: true,
            policyDigest: "7".repeat(64),
            guarantees: [SANDBOX_BOUNDARIES.CODE_SNAPSHOT],
            cleanup,
            runtimeProbe: {
              kind: "darwin-mcp-capsule-code-snapshot-v1",
              attempted: true,
              runnable: true,
              reason: null,
              probeRuntime: "node",
              targetRuntime: "node",
              contentSnapshot: true,
              contentSnapshotScope: "mcp-capsule-entry-and-node-runtime",
              contentSnapshotMechanism:
                "verified-private-runtime-copy-and-unlinked-entry-fd-module-compile-v1",
              handleAtomic: false,
              entrySnapshotAtomic: true,
              runtimeLaunchAtomic: false,
              runtimeLaunchMechanism:
                "verified-private-tempfile-synchronous-spawn-unlink-v1",
              entrySnapshotBootstrapSha256: MCP_STDIO_FD_ENTRY_BOOTSTRAP_SHA256,
              sharedLibraryClosure: false,
              runtimeSnapshotSha256: "a".repeat(64),
              runtimeSnapshotBytes: 100,
              entrySnapshotSha256: "b".repeat(64),
              entrySnapshotBytes: 200,
            },
          },
        ),
      ),
      postSpawnSandbox: vi.fn(),
    };

    expect(() =>
      executionBroker.spawn("node", ["server.cjs", "--stdio"], {
        origin: "test:macos-mcp-code-snapshot",
        policy: "allow",
        shell: false,
        requiredBoundaries: [SANDBOX_BOUNDARIES.CODE_SNAPSHOT],
      }),
    ).toThrow(
      "Code snapshot guarantee requires typed atomic MCP capsule evidence",
    );
    expect(nativeSpawn).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("preserves macOS fail-closed atomic evidence before native spawn", () => {
    const nativeSpawn = vi.fn();
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: vi.fn((command, args, options) => ({
        ...appliedPlan(command, args, options),
        applied: false,
        enforcement: null,
        backend: null,
        candidateBackend: "macos-fd-code-snapshot",
        policyAttested: false,
        policyDigest: null,
        guarantees: [],
        reason: "macos_atomic_runtime_exec_unavailable",
        runtimeProbe: {
          kind: "darwin-mcp-capsule-code-snapshot-v1",
          attempted: true,
          runnable: false,
          reason: "public_api_has_no_descriptor_bound_exec",
          probeRuntime: "node",
          targetRuntime: "node",
          contentSnapshot: false,
          handleAtomic: false,
          entrySnapshotAtomic: false,
          runtimeLaunchAtomic: false,
          runtimeLaunchMechanism: "darwin-public-api-pathname-exec-only-v1",
          sharedLibraryClosure: false,
        },
      })),
      postSpawnSandbox: vi.fn(),
    };

    let error;
    try {
      executionBroker.spawn("node", ["server.cjs"], {
        origin: "test:macos-code-snapshot-fail-closed",
        policy: "allow",
        shell: false,
        requiredBoundaries: [SANDBOX_BOUNDARIES.CODE_SNAPSHOT],
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
      sandboxCandidateBackend: "macos-fd-code-snapshot",
      sandboxCandidateReason: "macos_atomic_runtime_exec_unavailable",
      sandboxRuntimeProbe: {
        attempted: true,
        runnable: false,
        reason: "public_api_has_no_descriptor_bound_exec",
        contentSnapshot: false,
        entrySnapshotAtomic: false,
        runtimeLaunchAtomic: false,
        runtimeLaunchMechanism: "darwin-public-api-pathname-exec-only-v1",
        sharedLibraryClosure: false,
      },
    });
    expect(nativeSpawn).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a structurally complete unissued plan",
      (plan, context) => ({ plan, context }),
    ],
    [
      "mutated helper arguments",
      (plan, context) => ({
        plan: { ...plan, args: [...plan.args, "--forged"] },
        context,
      }),
    ],
    [
      "mutated caller-lifeline stdio",
      (plan, context) => {
        const stdio = [...plan.options.stdio];
        stdio[8] = "ignore";
        return {
          plan: { ...plan, options: { ...plan.options, stdio } },
          context,
        };
      },
    ],
    [
      "mutated environment",
      (plan, context) => ({
        plan: {
          ...plan,
          options: {
            ...plan.options,
            env: { ...plan.options.env, DYLD_INSERT_LIBRARIES: "/tmp/evil" },
          },
        },
        context,
      }),
    ],
    [
      "a different execution-contract object",
      (plan, context) => ({
        plan,
        context: {
          ...context,
          executionContract: { ...context.executionContract },
        },
      }),
    ],
  ])("rejects macOS signed-root MCP authority from %s", (_label, mutate) => {
    const runtimePath = "/usr/local/bin/node";
    const entryPath = "/Users/test/capsule/server.cjs";
    const contract = normalizedMcpCapsuleContract({ runtimePath, entryPath });
    const originalArgs = [entryPath, "--stdio"];
    const originalOptions = {
      cwd: contract.pluginRoot,
      shell: false,
      detached: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: { PATH: "/usr/bin:/bin" },
    };
    const requiredBoundaries = [
      SANDBOX_BOUNDARIES.CODE_SNAPSHOT,
      SANDBOX_BOUNDARIES.FILESYSTEM,
      SANDBOX_BOUNDARIES.NETWORK,
    ];
    const basePlan = appliedMacSignedRootMcpPlan(
      runtimePath,
      originalArgs,
      originalOptions,
      contract,
    );
    const baseContext = {
      command: runtimePath,
      args: originalArgs,
      cwd: contract.pluginRoot,
      shell: false,
      detached: false,
      executionContract: contract,
      profile: "default",
      requiredBoundaries,
      sync: false,
      builtInSandboxAdapter: true,
    };
    const { plan, context } = mutate(basePlan, baseContext);

    expect(
      consumeMacMcpCodeSnapshotPlanBinding(plan, {
        ...context,
      }),
    ).toBe(false);
    expect(() => executionBroker._validateSandboxPlan(plan, context)).toThrow(
      "Code snapshot guarantee requires typed atomic MCP capsule evidence",
    );
  });

  it("burns and validates macOS MCP plan bindings before native spawn", () => {
    expect(
      macMcpTargetEnvironment(
        { PATH: "/usr/bin", PKG_EXECPATH: "/forged/executable" },
        { packaged: true, inheritedEnvironment: {} },
      ),
    ).toEqual({
      PATH: "/usr/bin",
      PKG_EXECPATH: MACOS_PKG_EXECPATH_MAGIC,
    });
    expect(
      macMcpTargetEnvironment({ PATH: "/usr/bin" }, { packaged: false }),
    ).toEqual({ PATH: "/usr/bin" });
    expect(processExecutionBrokerSource).toContain(
      "isMacosMcpLauncherPackageVersion(",
    );
    const consumeStart = platformSandboxSource.indexOf(
      "export function consumeMacMcpCodeSnapshotPlanBinding(",
    );
    const consumeEnd = platformSandboxSource.indexOf(
      "function validateMacMcpCapsuleContract(",
      consumeStart,
    );
    const consumeSource = platformSandboxSource.slice(consumeStart, consumeEnd);
    expect(
      consumeSource.indexOf("issuedMacMcpCodeSnapshotPlans.delete(plan)"),
    ).toBeLessThan(consumeSource.indexOf("return ("));
    expect(consumeSource).toContain(
      "issued.executionContract === expected.executionContract",
    );
    expect(consumeSource).toContain(
      "sameStringArray(plan.args, issued.helperArgs)",
    );
    expect(consumeSource).toContain(
      "macEnvironmentDigest(plan.options?.env) === issued.environmentDigest",
    );
    expect(consumeSource).toContain(
      "sameMacStdio(issued.stdio, plan.options?.stdio)",
    );

    const asyncAdmissionStart = processExecutionBrokerSource.indexOf(
      "const macPlanBindingDeclared =",
      processExecutionBrokerSource.indexOf("spawn(command"),
    );
    const asyncSpawn = processExecutionBrokerSource.indexOf(
      "proc = nativeSpawnFn(command, args, optsForSpawn)",
      asyncAdmissionStart,
    );
    const asyncAdmission = processExecutionBrokerSource.slice(
      asyncAdmissionStart,
      asyncSpawn,
    );
    expect(asyncAdmission).toContain(
      "admittedMacMcpCodeSnapshotPlans.delete(sandboxPlan)",
    );
    expect(processExecutionBrokerSource.slice(asyncSpawn)).toContain(
      "const callerLifeline = proc?.stdio?.[8]",
    );
    expect(processExecutionBrokerSource.slice(asyncSpawn)).toContain(
      'Object.defineProperty(proc, "macosMcpCallerLifeline"',
    );
    const syncSpawn = processExecutionBrokerSource.indexOf(
      "const result = nativeSpawnSyncFn(command, args, optsForSync)",
    );
    const syncAdmission = processExecutionBrokerSource.slice(
      processExecutionBrokerSource.lastIndexOf(
        "const macPlanBindingDeclared =",
        syncSpawn,
      ),
      syncSpawn,
    );
    expect(syncAdmission).toContain(
      "admittedMacMcpCodeSnapshotPlans.delete(sandboxPlan)",
    );
    expect(syncAdmission).toContain(
      "spawnSync owns the parent endpoint for stdio[8]",
    );
  });

  it("rejects Windows MCP authority minted through an injected runtime adapter", () => {
    const nativeSpawn = vi.fn();
    const runtimePath = "C:\\runtime\\node.exe";
    const entryPath = "C:\\capsule\\server.cjs";
    const appContainerSid = "S-1-15-2-71-72-73-74-75-76-77";
    const requiredBoundaries = [
      SANDBOX_BOUNDARIES.CODE_SNAPSHOT,
      SANDBOX_BOUNDARIES.FILESYSTEM,
      SANDBOX_BOUNDARIES.NETWORK,
    ];
    const contract = normalizedMcpCapsuleContract({
      runtimePath,
      entryPath,
    });
    normalizeSandboxExecutionContract = vi
      .spyOn(executionBroker, "_normalizeSandboxExecutionContract")
      .mockReturnValue(contract);
    const helperSpawnSync = vi.fn((_helper, helperArgs) => {
      if (helperArgs[0] === "--prepare-appcontainer") {
        return {
          status: 0,
          stdout: JSON.stringify({
            ready: true,
            profileName: helperArgs[1],
            appContainerSid,
            capabilityCount: 0,
            tokenAttested: true,
            restrictedTokenAttested: true,
            probeRuntime: "node",
            targetRuntime: "node",
          }),
          stderr: "",
        };
      }
      if (helperArgs[0] === "--delete-appcontainer") {
        return {
          status: 0,
          stdout: JSON.stringify({
            deleted: true,
            absent: true,
            profileName: helperArgs[1],
          }),
          stderr: "",
        };
      }
      throw new Error(`Unexpected helper invocation: ${helperArgs}`);
    });
    const harness = createWindowsAdapterHarness({
      helperSpawnSync,
      readFileSync: vi.fn(() =>
        JSON.stringify({
          targetPid: 5103,
          helperPid: 4102,
          appContainer: true,
          appContainerSid,
          capabilityCount: 0,
        }),
      ),
    });
    const injectedPlan = applyWindowsSandbox(
      runtimePath,
      [entryPath, "--stdio"],
      {
        cwd: "C:\\capsule",
        shell: false,
        detached: false,
        stdio: ["pipe", "pipe", "pipe"],
      },
      {
        profileName: "default",
        requiredBoundaries,
        sync: false,
        executionContract: contract,
      },
      {
        platform: "win32",
        fs: harness.fsRuntime,
        windowsAdapterContent: "param()",
        tmpdir: () => "C:\\temp",
        now: vi.fn(() => 100),
        sleepSync: vi.fn(),
        randomBytes: (size) => Buffer.alloc(size, 0x7b),
        joinPath: path.win32.join,
        spawnSync: harness.spawnSync,
      },
    );
    expect(injectedPlan.runtimeProbe).toMatchObject({
      planBindingMechanism: "windows-mcp-code-snapshot-plan-binding-v1",
      planBindingDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(Object.isFrozen(injectedPlan.options.stdio)).toBe(true);
    expect(() => {
      injectedPlan.options.stdio[0] = 17;
    }).toThrow(TypeError);
    expect(consumeWindowsMcpCodeSnapshotPlanBinding(injectedPlan, {})).toBe(
      false,
    );
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: vi.fn(() => injectedPlan),
      postSpawnSandbox: vi.fn(() => {
        throw new Error("injected post-spawn adapter must not be used");
      }),
    };

    expect(() =>
      executionBroker.spawn(runtimePath, [entryPath, "--stdio"], {
        origin: "test:injected-windows-mcp-code-snapshot",
        policy: "allow",
        shell: false,
        cwd: "C:\\capsule",
        detached: false,
        requiredBoundaries,
        sandboxExecutionContract: Object.freeze({}),
      }),
    ).toThrow(
      "Code snapshot guarantee requires typed atomic MCP capsule evidence",
    );

    expect(nativeSpawn).not.toHaveBeenCalled();
    expect(
      executionBroker._sandboxAdapter.postSpawnSandbox,
    ).not.toHaveBeenCalled();
    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      sandboxed: false,
      sandboxState: "denied",
      sandboxReason: "invalid_sandbox_plan",
    });
    expect(resetWindowsSandboxAdapterCache()).toBe(true);
  });

  it("fails closed instead of re-entering a consumed Windows MCP post-spawn plan", () => {
    const child = createChild();
    const postSpawnWindows = vi.fn();
    const injectedPostSpawn = vi.fn();
    const plan = appliedPlan(
      "windows-helper.exe",
      ["payload"],
      {},
      {
        platform: "win32",
        backend: "windows-job-restricted-token",
        enforcement: "windows-job-restricted-token",
        guarantees: [SANDBOX_BOUNDARIES.CODE_SNAPSHOT],
        requiredBoundaries: [SANDBOX_BOUNDARIES.CODE_SNAPSHOT],
        runtimeProbe: {
          planBindingMechanism: "windows-mcp-code-snapshot-plan-binding-v1",
        },
        postSpawn: { required: true, mode: "sync" },
        postSpawnWindows,
      },
    );
    executionBroker._sandboxAdapter = {
      applySandbox: vi.fn(),
      postSpawnSandbox: injectedPostSpawn,
    };

    expect(() => executionBroker._runPostSpawnSandbox(child, plan, {})).toThrow(
      "Windows MCP sandbox plan binding is unavailable or already consumed",
    );
    expect(postSpawnWindows).not.toHaveBeenCalled();
    expect(injectedPostSpawn).not.toHaveBeenCalled();
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it("rejects an unissued Windows helper plan even when evidence matches the launch contract", () => {
    const nativeSpawn = vi.fn();
    const cleanup = vi.fn();
    const runtimePath = "C:\\runtime\\node.exe";
    const entryPath = "C:\\capsule\\server.cjs";
    normalizeSandboxExecutionContract = vi
      .spyOn(executionBroker, "_normalizeSandboxExecutionContract")
      .mockReturnValue(
        normalizedMcpCapsuleContract({ runtimePath, entryPath }),
      );
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: vi.fn((_command, _args, options) =>
        appliedPlan("windows-helper.exe", ["payload"], options, {
          platform: "win32",
          enforcement: "windows-appcontainer-job-restricted-token",
          backend: "windows-appcontainer-job-restricted-token",
          candidateBackend: null,
          policyAttested: true,
          policyDigest: "8".repeat(64),
          guarantees: [
            SANDBOX_BOUNDARIES.FILESYSTEM,
            SANDBOX_BOUNDARIES.NETWORK,
            SANDBOX_BOUNDARIES.PROCESS_TREE,
            SANDBOX_BOUNDARIES.RESOURCE_LIMITS,
            SANDBOX_BOUNDARIES.PRIVILEGE_REDUCTION,
            SANDBOX_BOUNDARIES.CODE_SNAPSHOT,
          ],
          runtimeProbe: {
            kind: "windows-appcontainer-launch-attestation-v1",
            attempted: true,
            runnable: true,
            reason: null,
            probeRuntime: "node",
            targetRuntime: "node",
            contentSnapshot: true,
            contentSnapshotScope: "mcp-capsule-entry-source",
            contentSnapshotMechanism:
              "verified-handle-inherited-pipe-module-compile-v1",
            handleAtomic: false,
            runtimeAttestedSha256: "a".repeat(64),
            runtimeAttestedBytes: 100,
            entrySnapshotSha256: "b".repeat(64),
            entrySnapshotBytes: 200,
            entrySnapshotAtomic: true,
            runtimeLaunchAtomic: true,
            runtimeLaunchMechanism:
              "filter-oplock-locked-createprocess-suspended-image-v1",
            sharedLibraryClosure: false,
            planBindingMechanism: "windows-mcp-code-snapshot-plan-binding-v1",
            planBindingDigest: "9".repeat(64),
          },
          cleanup,
        }),
      ),
      postSpawnSandbox: vi.fn(),
    };
    const createUnissuedWindowsPlan =
      executionBroker._sandboxAdapter.applySandbox;

    expect(() =>
      executionBroker.spawn(runtimePath, [entryPath, "--stdio"], {
        origin: "test:forged-windows-mcp-code-snapshot",
        policy: "allow",
        shell: false,
        requiredBoundaries: [
          SANDBOX_BOUNDARIES.CODE_SNAPSHOT,
          SANDBOX_BOUNDARIES.FILESYSTEM,
          SANDBOX_BOUNDARIES.NETWORK,
        ],
        sandboxExecutionContract: Object.freeze({}),
      }),
    ).toThrow(
      "Code snapshot guarantee requires typed atomic MCP capsule evidence",
    );
    expect(nativeSpawn).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();

    executionBroker._sandboxAdapter.applySandbox = vi.fn((...adapterArgs) => {
      const unissuedPlan = createUnissuedWindowsPlan(...adapterArgs);
      return Object.freeze({
        ...unissuedPlan,
        runtimeProbe: Object.freeze({
          ...unissuedPlan.runtimeProbe,
          runtimeSnapshotSha256: "a".repeat(64),
          runtimeSnapshotBytes: 100,
        }),
      });
    });
    expect(() =>
      executionBroker.spawn(runtimePath, [entryPath, "--stdio"], {
        origin: "test:mixed-windows-runtime-evidence-family",
        policy: "allow",
        shell: false,
        requiredBoundaries: [
          SANDBOX_BOUNDARIES.CODE_SNAPSHOT,
          SANDBOX_BOUNDARIES.FILESYSTEM,
          SANDBOX_BOUNDARIES.NETWORK,
        ],
        sandboxExecutionContract: Object.freeze({}),
      }),
    ).toThrow(
      "Code snapshot guarantee requires typed atomic MCP capsule evidence",
    );
    expect(nativeSpawn).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(2);

    executionBroker._sandboxAdapter.applySandbox = vi.fn((...adapterArgs) => {
      const unissuedPlan = createUnissuedWindowsPlan(...adapterArgs);
      return Object.freeze({
        ...unissuedPlan,
        runtimeProbe: Object.freeze({
          ...unissuedPlan.runtimeProbe,
          kind: "windows-plugin-node-entry-snapshot-v1",
        }),
      });
    });
    expect(() =>
      executionBroker.spawn(runtimePath, [entryPath, "--stdio"], {
        origin: "test:mismatched-windows-backend-probe-kind",
        policy: "allow",
        shell: false,
        requiredBoundaries: [
          SANDBOX_BOUNDARIES.CODE_SNAPSHOT,
          SANDBOX_BOUNDARIES.FILESYSTEM,
          SANDBOX_BOUNDARIES.NETWORK,
        ],
        sandboxExecutionContract: Object.freeze({}),
      }),
    ).toThrow(
      "Code snapshot guarantee requires typed atomic MCP capsule evidence",
    );
    expect(nativeSpawn).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(3);
  });

  it("rejects a forged code snapshot guarantee before native spawn", () => {
    const nativeSpawn = vi.fn();
    const cleanup = vi.fn();
    const plan = appliedPlan(
      "/proc/self/fd/3",
      ["/proc/self/fd/4"],
      { shell: false },
      {
        platform: "linux",
        enforcement: "linux-fd-code-snapshot",
        backend: "linux-fd-code-snapshot",
        candidateBackend: null,
        policyAttested: true,
        policyDigest: "9".repeat(64),
        guarantees: [SANDBOX_BOUNDARIES.CODE_SNAPSHOT],
        cleanup,
        runtimeProbe: {
          kind: "linux-mcp-capsule-code-snapshot-v1",
          attempted: true,
          runnable: true,
          reason: null,
          probeRuntime: "node",
          targetRuntime: "node",
          contentSnapshot: true,
          contentSnapshotScope: "mcp-capsule-entry-and-node-runtime",
          contentSnapshotMechanism:
            "verified-o_tmpfile-copy-inherited-fd-exec-v1",
          handleAtomic: false,
          sharedLibraryClosure: false,
          runtimeSnapshotSha256: "a".repeat(64),
          runtimeSnapshotBytes: 100,
          entrySnapshotSha256: "b".repeat(64),
          entrySnapshotBytes: 200,
        },
      },
    );
    expect(() =>
      executionBroker._validateSandboxPlan(
        plan,
        trustedBuiltInLinuxLaunchContext({
          command: "node",
          args: ["server.cjs"],
          requiredBoundaries: [SANDBOX_BOUNDARIES.CODE_SNAPSHOT],
        }),
      ),
    ).toThrow(
      "Code snapshot guarantee requires typed atomic MCP capsule evidence",
    );
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: vi.fn(() => plan),
      postSpawnSandbox: vi.fn(),
    };

    expect(() =>
      executionBroker.spawn("node", ["server.cjs"], {
        origin: "test:forged-code-snapshot",
        policy: "allow",
        shell: false,
        requiredBoundaries: [SANDBOX_BOUNDARIES.CODE_SNAPSHOT],
      }),
    ).toThrow(
      "Applied Linux FD code snapshot plans require the built-in sandbox adapter",
    );
    expect(nativeSpawn).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("rejects a code snapshot guarantee with no runtime evidence", () => {
    const nativeSpawn = vi.fn();
    const cleanup = vi.fn();
    const plan = appliedPlan(
      "/proc/self/fd/3",
      ["/proc/self/fd/4"],
      { shell: false },
      {
        platform: "linux",
        enforcement: "linux-fd-code-snapshot",
        backend: "linux-fd-code-snapshot",
        candidateBackend: null,
        policyAttested: true,
        policyDigest: "9".repeat(64),
        guarantees: [SANDBOX_BOUNDARIES.CODE_SNAPSHOT],
        cleanup,
      },
    );
    expect(() =>
      executionBroker._validateSandboxPlan(
        plan,
        trustedBuiltInLinuxLaunchContext({
          command: "node",
          args: ["server.cjs"],
          requiredBoundaries: [SANDBOX_BOUNDARIES.CODE_SNAPSHOT],
        }),
      ),
    ).toThrow(
      "Code snapshot guarantee requires typed atomic MCP capsule evidence",
    );
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: vi.fn(() => plan),
      postSpawnSandbox: vi.fn(),
    };

    expect(() =>
      executionBroker.spawn("node", ["server.cjs"], {
        origin: "test:missing-code-snapshot-evidence",
        policy: "allow",
        shell: false,
        requiredBoundaries: [SANDBOX_BOUNDARIES.CODE_SNAPSHOT],
      }),
    ).toThrow(
      "Applied Linux FD code snapshot plans require the built-in sandbox adapter",
    );
    expect(nativeSpawn).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("fails closed before spawn when actual guarantees miss a required boundary", () => {
    const nativeSpawn = vi.fn();
    const cleanup = vi.fn();
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: (command, args, options) =>
        appliedPlan(command, args, options, {
          platform: "win32",
          enforcement: "windows-job-restricted-token",
          backend: "windows-job-restricted-token",
          guarantees: [
            SANDBOX_BOUNDARIES.PROCESS_TREE,
            SANDBOX_BOUNDARIES.RESOURCE_LIMITS,
            SANDBOX_BOUNDARIES.PRIVILEGE_REDUCTION,
          ],
          cleanup,
        }),
      postSpawnSandbox: vi.fn(),
    };

    let error;
    try {
      executionBroker.spawn("tool.exe", [], {
        origin: "test:sandbox-required-unsatisfied",
        policy: "allow",
        sandboxPolicy: {
          requiredBoundaries: [
            SANDBOX_BOUNDARIES.FILESYSTEM,
            SANDBOX_BOUNDARIES.NETWORK,
          ],
        },
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
      sandboxReason: "required_boundaries_unsatisfied",
      sandboxFailClosed: true,
      requiredBoundaries: [
        SANDBOX_BOUNDARIES.FILESYSTEM,
        SANDBOX_BOUNDARIES.NETWORK,
      ],
      actualGuarantees: [
        SANDBOX_BOUNDARIES.PROCESS_TREE,
        SANDBOX_BOUNDARIES.RESOURCE_LIMITS,
        SANDBOX_BOUNDARIES.PRIVILEGE_REDUCTION,
      ],
      missingBoundaries: [
        SANDBOX_BOUNDARIES.FILESYSTEM,
        SANDBOX_BOUNDARIES.NETWORK,
      ],
      sandboxBackend: "windows-job-restricted-token",
    });
    expect(nativeSpawn).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      permissionDecision: "deny",
      sandboxed: false,
      sandboxState: "denied",
      sandboxReason: "required_boundaries_unsatisfied",
      sandboxRequired: [
        SANDBOX_BOUNDARIES.FILESYSTEM,
        SANDBOX_BOUNDARIES.NETWORK,
      ],
      sandboxGuarantees: [
        SANDBOX_BOUNDARIES.PROCESS_TREE,
        SANDBOX_BOUNDARIES.RESOURCE_LIMITS,
        SANDBOX_BOUNDARIES.PRIVILEGE_REDUCTION,
      ],
      sandboxMissing: [
        SANDBOX_BOUNDARIES.FILESYSTEM,
        SANDBOX_BOUNDARIES.NETWORK,
      ],
      sandboxBackend: "windows-job-restricted-token",
    });
  });

  it("fails closed before native spawn when a Linux strong policy has no trusted execution contract", () => {
    const nativeSpawn = vi.fn();
    const probeSpawnSync = vi.fn(() => ({ status: 0 }));
    const apply = vi.fn(
      (command, args, options, profile, _runtime, sandboxRequest) =>
        applySandbox(
          command,
          args,
          options,
          profile,
          {
            platform: "linux",
            fs: { existsSync: vi.fn(() => true) },
            spawnSync: probeSpawnSync,
          },
          sandboxRequest,
        ),
    );
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: apply,
      postSpawnSandbox: vi.fn(),
    };

    let error;
    try {
      executionBroker.spawn("target-with-side-effect", [], {
        origin: "test:linux-bwrap-policy-unattested",
        policy: "allow",
        sandboxPolicy: {
          profile: "strict",
          requiredBoundaries: [
            SANDBOX_BOUNDARIES.FILESYSTEM,
            SANDBOX_BOUNDARIES.NETWORK,
          ],
        },
      });
    } catch (caught) {
      error = caught;
    }

    expect(apply).toHaveBeenCalledWith(
      "target-with-side-effect",
      [],
      expect.not.objectContaining({
        sandboxPolicy: expect.anything(),
        requiredBoundaries: expect.anything(),
      }),
      "strict",
      undefined,
      {
        profile: "strict",
        requiredBoundaries: [
          SANDBOX_BOUNDARIES.FILESYSTEM,
          SANDBOX_BOUNDARIES.NETWORK,
        ],
        sync: false,
      },
    );
    expect(error).toMatchObject({
      code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
      sandboxReason: "required_boundaries_unsatisfied",
      sandboxFailClosed: true,
      actualGuarantees: [],
      missingBoundaries: [
        SANDBOX_BOUNDARIES.FILESYSTEM,
        SANDBOX_BOUNDARIES.NETWORK,
      ],
      sandboxBackend: null,
      sandboxCandidateBackend: "linux-bwrap",
      sandboxPolicyAttested: false,
      sandboxCandidateReason: "linux_bwrap_execution_contract_missing",
      sandboxRuntimeProbe: {
        attempted: false,
        runnable: false,
        reason: "execution_contract_missing",
      },
    });
    expect(probeSpawnSync).not.toHaveBeenCalled();
    expect(nativeSpawn).not.toHaveBeenCalled();
    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      permissionDecision: "deny",
      sandboxed: false,
      sandboxState: "denied",
      sandboxRequired: [
        SANDBOX_BOUNDARIES.FILESYSTEM,
        SANDBOX_BOUNDARIES.NETWORK,
      ],
      sandboxGuarantees: [],
      sandboxBackend: null,
      sandboxCandidateBackend: "linux-bwrap",
      sandboxPolicyAttested: false,
      sandboxCandidateReason: "linux_bwrap_execution_contract_missing",
      sandboxRuntimeProbe: {
        attempted: false,
        runnable: false,
        reason: "execution_contract_missing",
      },
    });
  });

  it("rejects a forged Plugin Node contract before adapter or native execution", () => {
    const nativeSpawn = vi.fn();
    const apply = vi.fn();
    const pluginRoot = path.resolve("forged-plugin");
    const entryPath = path.join(pluginRoot, "bin", "tool.js");
    const entryIdentity = Object.freeze({
      realPath: entryPath,
      sha256: "a".repeat(64),
      bytes: 1,
      dev: "1",
      ino: "2",
      mtimeMs: 1234,
    });
    const forgedContract = Object.freeze({
      contractVersion: 1,
      kind: "strict-plugin-node-bin",
      pluginRoot,
      workingDirectory: pluginRoot,
      runtimePath: process.execPath,
      entryIdentity,
      runtimeIdentity: Object.freeze({
        requestedPath: process.execPath,
        realPath: process.execPath,
        sha256: "b".repeat(64),
        bytes: 1,
        dev: "1",
        ino: "3",
        mtimeMs: 1234,
      }),
    });
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: apply,
      postSpawnSandbox: vi.fn(),
    };

    let error;
    try {
      executionBroker.spawn(process.execPath, [entryPath], {
        cwd: pluginRoot,
        origin: "plugin:bin",
        policy: "allow",
        shell: false,
        pluginId: "forged-plugin",
        pluginVersion: "1.0.0",
        pluginSource: path.join(pluginRoot, "plugin.json"),
        pluginExecutableIdentity: entryIdentity,
        sandboxPolicy: {
          requiredBoundaries: [
            SANDBOX_BOUNDARIES.FILESYSTEM,
            SANDBOX_BOUNDARIES.NETWORK,
          ],
        },
        sandboxExecutionContract: forgedContract,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
      sandboxReason: "invalid_sandbox_execution_contract",
      sandboxFailClosed: true,
      missingBoundaries: [
        SANDBOX_BOUNDARIES.FILESYSTEM,
        SANDBOX_BOUNDARIES.NETWORK,
      ],
    });
    expect(error.message).toMatch(/was not issued/);
    expect(apply).not.toHaveBeenCalled();
    expect(nativeSpawn).not.toHaveBeenCalled();
    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      permissionDecision: "deny",
      sandboxReason: "invalid_sandbox_execution_contract",
      sandboxState: "denied",
    });
  });

  it("supports the top-level requiredBoundaries alias on spawnSync", () => {
    const nativeSpawnSync = vi.fn(() => ({ status: 0 }));
    executionBroker._native = { spawnSync: nativeSpawnSync };
    executionBroker._sandboxAdapter = {
      applySandbox: (command, args, options) =>
        appliedPlan(command, args, options, {
          platform: "linux",
          enforcement: "linux-prlimit",
          backend: "linux-prlimit",
          guarantees: [SANDBOX_BOUNDARIES.RESOURCE_LIMITS],
        }),
      postSpawnSandbox: vi.fn(),
    };

    executionBroker.spawnSync("tool", [], {
      origin: "test:sandbox-required-sync",
      policy: "allow",
      requiredBoundaries: [SANDBOX_BOUNDARIES.RESOURCE_LIMITS],
    });

    expect(nativeSpawnSync).toHaveBeenCalledOnce();
    expect(nativeSpawnSync.mock.calls[0][2]).not.toHaveProperty(
      "requiredBoundaries",
    );
    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      sandboxBackend: "linux-prlimit",
      sandboxRequired: [SANDBOX_BOUNDARIES.RESOURCE_LIMITS],
      sandboxGuarantees: [SANDBOX_BOUNDARIES.RESOURCE_LIMITS],
    });
  });

  it("rejects unknown boundary identifiers before consulting the adapter", () => {
    const nativeSpawn = vi.fn();
    const apply = vi.fn();
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: apply,
      postSpawnSandbox: vi.fn(),
    };

    let error;
    try {
      executionBroker.spawn("tool", [], {
        origin: "test:sandbox-required-invalid",
        policy: "allow",
        requiredBoundaries: ["imaginary-boundary"],
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({
      code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
      sandboxReason: "invalid_required_boundary",
      missingBoundaries: ["imaginary-boundary"],
    });
    expect(apply).not.toHaveBeenCalled();
    expect(nativeSpawn).not.toHaveBeenCalled();
  });

  it("fails closed when a native PTY cannot provide a required boundary", () => {
    const ptyModule = { spawn: vi.fn() };
    const requiredBoundaries = [SANDBOX_BOUNDARIES.FILESYSTEM];
    executionBroker._sandboxAdapter = {
      applySandbox: vi.fn((command, args, options) =>
        executionBroker._sandboxUnavailablePlan(
          command,
          args,
          options,
          "native_pty_host_boundary",
          { requiredBoundaries },
        ),
      ),
      postSpawnSandbox: vi.fn(),
    };
    let error;
    try {
      executionBroker.spawnPty(ptyModule, "shell", [], {
        origin: "test:pty-required-boundary",
        policy: "allow",
        requiredBoundaries,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: "ERR_PROCESS_SANDBOX_BOUNDARY_UNSATISFIED",
      sandboxReason: "required_boundaries_unsatisfied",
      requiredBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
      missingBoundaries: [SANDBOX_BOUNDARIES.FILESYSTEM],
    });
    expect(ptyModule.spawn).not.toHaveBeenCalled();
    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      permissionDecision: "deny",
      sandboxRequired: [SANDBOX_BOUNDARIES.FILESYSTEM],
      sandboxGuarantees: [],
      sandboxBackend: null,
      sandboxState: "denied",
    });
  }, 20_000);

  it("passes adapter command, args, and options to native spawnSync", () => {
    const nativeSpawnSync = vi.fn(() => ({ status: 0 }));
    const apply = vi.fn((command, args, options) =>
      appliedPlan("sandbox-wrapper", ["--", command, ...args], {
        ...options,
        sandboxOption: true,
      }),
    );
    executionBroker._native = { spawnSync: nativeSpawnSync };
    executionBroker._sandboxAdapter = {
      applySandbox: apply,
      postSpawnSandbox: vi.fn(),
    };

    executionBroker.spawnSync("tool", ["run"], {
      origin: "test:sandbox-plan-sync",
      policy: "allow",
    });

    expect(nativeSpawnSync).toHaveBeenCalledWith(
      "sandbox-wrapper",
      ["--", "tool", "run"],
      expect.objectContaining({ sandboxOption: true }),
    );
    expect(apply.mock.calls[0][5]).toEqual({
      profile: "default",
      requiredBoundaries: [],
      sync: true,
    });
    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      sandboxed: true,
      sandboxEnforcement: "test-sandbox",
    });
  });

  it("honors CC_SANDBOX_DISABLE without calling the adapter", () => {
    process.env.CC_SANDBOX_DISABLE = "1";
    const child = createChild();
    const nativeSpawn = vi.fn(() => child);
    const apply = vi.fn();
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: apply,
      postSpawnSandbox: vi.fn(),
    };

    executionBroker.spawn("tool", ["run"], {
      origin: "test:sandbox-disabled",
      policy: "allow",
    });

    expect(apply).not.toHaveBeenCalled();
    expect(nativeSpawn).toHaveBeenCalledWith(
      "tool",
      ["run"],
      expect.any(Object),
    );
    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      sandboxed: false,
      sandboxState: "unavailable",
      sandboxReason: "disabled_by_environment",
    });
  });

  it("does not let CC_SANDBOX_DISABLE bypass strict mode", () => {
    process.env.CC_SANDBOX_DISABLE = "1";
    process.env.CC_SANDBOX_STRICT = "1";
    const nativeSpawn = vi.fn();
    const apply = vi.fn();
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: apply,
      postSpawnSandbox: vi.fn(),
    };

    expect(() =>
      executionBroker.spawn("tool", [], {
        origin: "test:sandbox-disabled-strict",
        policy: "allow",
      }),
    ).toThrow(/disabled_by_environment/);
    expect(apply).not.toHaveBeenCalled();
    expect(nativeSpawn).not.toHaveBeenCalled();
  });

  it("rejects an unavailable platform before spawn in strict mode", () => {
    process.env.CC_SANDBOX_STRICT = "1";
    const nativeSpawn = vi.fn();
    const apply = vi.fn((command, args, options, profile) => ({
      contractVersion: 1,
      applied: false,
      platform: "win32",
      profile,
      command,
      args,
      options,
      enforcement: null,
      reason: "windows_native_job_object_unavailable",
      postSpawn: { required: false, mode: "none" },
    }));
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: apply,
      postSpawnSandbox: vi.fn(),
    };

    expect(() =>
      executionBroker.spawn("tool", [], {
        origin: "test:sandbox-strict",
        policy: "allow",
      }),
    ).toThrow(/windows_native_job_object_unavailable/);
    expect(apply).toHaveBeenCalledWith(
      "tool",
      [],
      expect.any(Object),
      "strict",
      undefined,
      {
        profile: "strict",
        requiredBoundaries: [],
        sync: false,
      },
    );
    expect(nativeSpawn).not.toHaveBeenCalled();
    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      sandboxed: false,
      sandboxState: "denied",
      sandboxReason: "windows_native_job_object_unavailable",
    });
  });

  it("rejects the legacy newCommand/newArgs adapter shape", () => {
    process.env.CC_SANDBOX_STRICT = "1";
    const nativeSpawn = vi.fn();
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: () => ({
        applied: true,
        newCommand: "legacy-wrapper",
        newArgs: ["tool"],
      }),
      postSpawnSandbox: vi.fn(),
    };

    expect(() =>
      executionBroker.spawn("tool", [], {
        origin: "test:sandbox-legacy-plan",
        policy: "allow",
      }),
    ).toThrow(/contractVersion must be 1/);
    expect(nativeSpawn).not.toHaveBeenCalled();
  });

  it("rejects required async post-spawn enforcement before strict spawn", () => {
    process.env.CC_SANDBOX_STRICT = "1";
    const nativeSpawn = vi.fn();
    const cleanup = vi.fn();
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: (command, args, options) =>
        appliedPlan(command, args, options, {
          postSpawn: { required: true, mode: "async" },
          cleanup,
        }),
      postSpawnSandbox: vi.fn(),
    };

    expect(() =>
      executionBroker.spawn("tool", [], {
        origin: "test:sandbox-strict-async",
        policy: "allow",
      }),
    ).toThrow(/synchronous post-spawn enforcement/);
    expect(nativeSpawn).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("cleans an applied plan when spawnSync cannot run post-spawn enforcement", () => {
    process.env.CC_SANDBOX_STRICT = "1";
    const nativeSpawnSync = vi.fn();
    const cleanup = vi.fn();
    executionBroker._native = { spawnSync: nativeSpawnSync };
    executionBroker._sandboxAdapter = {
      applySandbox: (command, args, options) =>
        appliedPlan(command, args, options, {
          postSpawn: { required: true, mode: "sync" },
          cleanup,
        }),
      postSpawnSandbox: vi.fn(),
    };

    expect(() =>
      executionBroker.spawnSync("tool", [], {
        origin: "test:sandbox-sync-post-spawn",
        policy: "allow",
      }),
    ).toThrow(/spawnSync cannot satisfy required post-spawn/);
    expect(nativeSpawnSync).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("kills the child and throws when strict synchronous post-spawn fails", () => {
    process.env.CC_SANDBOX_STRICT = "1";
    const child = createChild();
    const nativeSpawn = vi.fn(() => child);
    executionBroker._native = { spawn: nativeSpawn };
    executionBroker._sandboxAdapter = {
      applySandbox: (command, args, options) =>
        appliedPlan(command, args, options, {
          postSpawn: { required: true, mode: "sync" },
        }),
      postSpawnSandbox: () => {
        throw new Error("job association failed");
      },
    };

    expect(() =>
      executionBroker.spawn("tool", [], {
        origin: "test:sandbox-post-spawn",
        policy: "allow",
      }),
    ).toThrow(/Post-spawn sandbox setup failed/);
    expect(nativeSpawn).toHaveBeenCalledOnce();
    expect(child.kill).toHaveBeenCalledOnce();
    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      sandboxed: false,
      sandboxState: "denied",
      sandboxReason: "post_spawn_failed",
    });
  });

  it("exposes non-strict asynchronous post-spawn failure on sandboxReady", async () => {
    const child = createChild();
    executionBroker._native = { spawn: vi.fn(() => child) };
    executionBroker._sandboxAdapter = {
      applySandbox: (command, args, options) =>
        appliedPlan(command, args, options, {
          postSpawn: { required: true, mode: "async" },
        }),
      postSpawnSandbox: () => Promise.reject(new Error("late failure")),
    };

    executionBroker.spawn("tool", [], {
      origin: "test:sandbox-async-observable",
      policy: "allow",
    });

    await expect(child.sandboxReady).rejects.toThrow("late failure");
    expect(executionBroker.getAuditLog(1)[0]).toMatchObject({
      sandboxed: false,
      sandboxState: "failed",
      sandboxReason: "post_spawn_failed: late failure",
    });
    expect(emitWarning).toHaveBeenCalled();
  });
});
