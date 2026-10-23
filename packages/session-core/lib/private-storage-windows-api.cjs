// ABI-only adapter. All mutation policy lives in private-storage-windows-native.
const { failure } = require("./private-storage-windows-native.cjs");
let cached;
function createWindowsApi() {
  if (cached) return cached;
  if (process.platform !== "win32")
    throw failure("UNSUPPORTED_PLATFORM", "initialize");
  const koffi = require("koffi");
  const kernel = koffi.load("kernel32.dll");
  const advapi = koffi.load("advapi32.dll");
  const H = koffi.pointer("CcPrivateAclHandle", koffi.opaque());
  const INFO = koffi.struct("CcPrivateAclFileInfo", {
    attributes: "uint32_t",
    creationLow: "uint32_t",
    creationHigh: "uint32_t",
    accessLow: "uint32_t",
    accessHigh: "uint32_t",
    writeLow: "uint32_t",
    writeHigh: "uint32_t",
    volume: "uint32_t",
    sizeHigh: "uint32_t",
    sizeLow: "uint32_t",
    links: "uint32_t",
    indexHigh: "uint32_t",
    indexLow: "uint32_t",
  });
  const ACL_INFO = koffi.struct("CcPrivateAclSizeInfo", {
    count: "uint32_t",
    used: "uint32_t",
    free: "uint32_t",
  });
  const CreateFile = kernel.func(
    "CcPrivateAclHandle __stdcall CreateFileW(str16 name, uint32_t access, uint32_t share, void *security, uint32_t disposition, uint32_t flags, void *templateFile)",
  );
  const GetFileInfo = kernel.func(
    "int __stdcall GetFileInformationByHandle(CcPrivateAclHandle handle, _Out_ CcPrivateAclFileInfo *information)",
  );
  const CloseHandle = kernel.func(
    "int __stdcall CloseHandle(CcPrivateAclHandle handle)",
  );
  const GetLastError = kernel.func("uint32_t __stdcall GetLastError()");
  const GetCurrentProcess = kernel.func(
    "CcPrivateAclHandle __stdcall GetCurrentProcess()",
  );
  const LocalFree = kernel.func("void * __stdcall LocalFree(void *memory)");
  const OpenProcessToken = advapi.func(
    "int __stdcall OpenProcessToken(CcPrivateAclHandle process, uint32_t access, _Out_ CcPrivateAclHandle *token)",
  );
  const GetTokenInformation = advapi.func(
    "int __stdcall GetTokenInformation(CcPrivateAclHandle token, int kind, void *buffer, uint32_t size, _Out_ uint32_t *required)",
  );
  const ConvertSid = advapi.func(
    "int __stdcall ConvertSidToStringSidW(void *sid, _Out_ void **text)",
  );
  const GetSecurityInfo = advapi.func(
    "uint32_t __stdcall GetSecurityInfo(CcPrivateAclHandle handle, int objectType, uint32_t information, _Out_ void **owner, void *group, _Out_ void **dacl, void *sacl, _Out_ void **descriptor)",
  );
  const GetControl = advapi.func(
    "int __stdcall GetSecurityDescriptorControl(void *descriptor, _Out_ uint16_t *control, _Out_ uint32_t *revision)",
  );
  const GetAclInformation = advapi.func(
    "int __stdcall GetAclInformation(void *acl, _Out_ CcPrivateAclSizeInfo *information, uint32_t size, int kind)",
  );
  const GetAce = advapi.func(
    "int __stdcall GetAce(void *acl, uint32_t index, _Out_ void **ace)",
  );
  const ConvertDescriptor = advapi.func(
    "int __stdcall ConvertStringSecurityDescriptorToSecurityDescriptorW(str16 text, uint32_t revision, _Out_ void **descriptor, void *size)",
  );
  const GetOwner = advapi.func(
    "int __stdcall GetSecurityDescriptorOwner(void *descriptor, _Out_ void **owner, _Out_ int *defaulted)",
  );
  const GetDacl = advapi.func(
    "int __stdcall GetSecurityDescriptorDacl(void *descriptor, _Out_ int *present, _Out_ void **dacl, _Out_ int *defaulted)",
  );
  const SetSecurityInfo = advapi.func(
    "uint32_t __stdcall SetSecurityInfo(CcPrivateAclHandle handle, int objectType, uint32_t information, void *owner, void *group, void *dacl, void *sacl)",
  );
  const CreateMutex = kernel.func(
    "CcPrivateAclHandle __stdcall CreateMutexW(void *attributes, int owner, str16 name)",
  );
  const WaitForSingleObject = kernel.func(
    "uint32_t __stdcall WaitForSingleObject(CcPrivateAclHandle handle, uint32_t timeout)",
  );
  const ReleaseMutex = kernel.func(
    "int __stdcall ReleaseMutex(CcPrivateAclHandle handle)",
  );
  const GetFullPathName = kernel.func(
    "uint32_t __stdcall GetFullPathNameW(str16 name, uint32_t size, _Out_ uint16_t *buffer, void *filePart)",
  );
  const LCMapStringEx = kernel.func(
    "int __stdcall LCMapStringEx(str16 locale, uint32_t flags, str16 source, int sourceLength, _Out_ uint16_t *destination, int destinationLength, void *version, void *reserved, intptr_t sortHandle)",
  );
  const check = (ok, stage) => {
    if (!ok) throw failure("WIN32_FAILURE", stage, GetLastError());
  };
  const checkStatus = (status, stage) => {
    if (status !== 0) throw failure("WIN32_FAILURE", stage, status);
  };
  const extended = (value) =>
    value.startsWith("\\\\?\\")
      ? value
      : value.startsWith("\\\\")
        ? "\\\\?\\UNC\\" + value.slice(2)
        : "\\\\?\\" + value;
  const close = (handle) => check(CloseHandle(handle), "close");
  const sidString = (sid) => {
    if (!sid) throw failure("INVALID_SECURITY_DESCRIPTOR", "verify");
    const output = [null];
    check(ConvertSid(sid, output), "verify");
    try {
      const value = koffi.decode(output[0], "char16_t", -1);
      if (!/^S-[0-9]+(?:-[0-9]+){1,16}$/u.test(value))
        throw failure("INVALID_SID", "verify");
      return value;
    } finally {
      LocalFree(output[0]);
    }
  };
  const api = {
    open(target, access) {
      // Directory traversal callers request FILE_TRAVERSE to activate sharing
      // checks without FILE_LIST_DIRECTORY. Metadata-only file handles do not
      // pin names; the engine binds writes to identity and freshly checks paths.
      const handle = CreateFile(
        extended(target),
        access,
        3,
        null,
        3,
        0x02200000,
        null,
      );
      if (
        handle === null ||
        BigInt.asUintN(koffi.sizeof("void *") * 8, koffi.address(handle)) ===
          (1n << BigInt(koffi.sizeof("void *") * 8)) - 1n
      ) {
        const code = GetLastError();
        if (code === 2 || code === 3) return null;
        throw failure("OPEN_FAILED", "lookup", code);
      }
      return handle;
    },
    close,
    information(handle) {
      const value = {};
      check(GetFileInfo(handle, value), "lookup");
      return {
        attributes: value.attributes,
        identity: `${value.volume}:${value.indexHigh}:${value.indexLow}:${value.creationHigh}:${value.creationLow}`,
        links: value.links,
      };
    },
    token() {
      const output = [null];
      check(OpenProcessToken(GetCurrentProcess(), 8, output), "initialize");
      try {
        const read = (kind) => {
          const size = [0];
          const probed = GetTokenInformation(output[0], kind, null, 0, size);
          if (
            probed ||
            GetLastError() !== 122 ||
            size[0] < koffi.sizeof("void *") ||
            size[0] > 65536
          )
            throw failure("TOKEN_INFORMATION_INVALID", "initialize");
          const buffer = Buffer.alloc(size[0]);
          check(
            GetTokenInformation(output[0], kind, buffer, buffer.length, size),
            "initialize",
          );
          return sidString(koffi.decode(buffer, "void *"));
        };
        return { userSid: read(1), ownerSid: read(4) };
      } finally {
        close(output[0]);
      }
    },
    security(handle) {
      const owner = [null],
        dacl = [null],
        descriptor = [null];
      checkStatus(
        GetSecurityInfo(handle, 1, 5, owner, null, dacl, null, descriptor),
        "verify-read",
      );
      try {
        const control = [0];
        check(GetControl(descriptor[0], control, [0]), "verify-read");
        const rules = [];
        if (dacl[0] !== null) {
          const size = {};
          check(
            GetAclInformation(dacl[0], size, koffi.sizeof(ACL_INFO), 2),
            "verify-rules",
          );
          if (size.count > 4096 || size.used < 8 || size.used > 65535)
            throw failure("ACL_SIZE_INVALID", "verify-rules");
          for (let i = 0; i < size.count; i++) {
            const output = [null];
            check(GetAce(dacl[0], i, output), "verify-rules");
            const header = Buffer.from(koffi.decode(output[0], "uint8_t", 4));
            const length = header.readUInt16LE(2);
            if (length < 4 || length > size.used)
              throw failure("ACE_SIZE_INVALID", "verify-rules");
            if (header[0] !== 0 || length < 16) {
              rules.push({
                type: header[0],
                flags: header[1],
                mask: 0,
                sid: null,
              });
              continue;
            }
            const bytes = Buffer.from(
              koffi.decode(output[0], "uint8_t", length),
            );
            // Standard ACCESS_ALLOWED_ACE layout has SID at byte offset eight.
            if (8 + 8 + bytes[9] * 4 > length)
              throw failure("ACE_SID_INVALID", "verify-rules");
            rules.push({
              type: bytes[0],
              flags: bytes[1],
              mask: bytes.readUInt32LE(4),
              sid: sidString(bytes.subarray(8)),
            });
          }
        }
        return {
          ownerSid: sidString(owner[0]),
          protected: Boolean(control[0] & 0x1000),
          rules,
        };
      } finally {
        LocalFree(descriptor[0]);
      }
    },
    writeSecurity(handle, sid, directory, changeOwner) {
      if (!/^S-[0-9]+(?:-[0-9]+){1,16}$/u.test(sid))
        throw failure("INVALID_SID", "repair-write");
      const descriptor = [null];
      check(
        ConvertDescriptor(
          `O:${sid}D:P(A;${directory ? "OICI" : ""};FA;;;${sid})`,
          1,
          descriptor,
          null,
        ),
        "repair-write",
      );
      try {
        const owner = [null],
          dacl = [null],
          present = [0];
        check(GetOwner(descriptor[0], owner, [0]), "repair-write");
        check(GetDacl(descriptor[0], present, dacl, [0]), "repair-write");
        if (!present[0] || !dacl[0])
          throw failure("INVALID_SECURITY_DESCRIPTOR", "repair-write");
        checkStatus(
          SetSecurityInfo(
            handle,
            1,
            (0x80000004 | (changeOwner ? 1 : 0)) >>> 0,
            changeOwner ? owner[0] : null,
            null,
            dacl[0],
            null,
          ),
          "repair-write",
        );
      } finally {
        LocalFree(descriptor[0]);
      }
    },
    createMutex(name) {
      const handle = CreateMutex(null, 0, name);
      check(handle, "repair-lock");
      return handle;
    },
    waitMutex(handle, milliseconds) {
      const result = WaitForSingleObject(handle, milliseconds);
      if (result === 0 || result === 0x80) return true;
      if (result === 0x102) return false;
      throw failure("MUTEX_WAIT_FAILED", "repair-lock", GetLastError());
    },
    releaseMutex(handle) {
      check(ReleaseMutex(handle), "repair-lock");
    },
    fullPath(value) {
      const buffer = Buffer.alloc(65536);
      const count = GetFullPathName(value, buffer.length / 2, buffer, null);
      if (!count || count >= buffer.length / 2)
        throw failure("FULL_PATH_INVALID", "traversal", GetLastError());
      return buffer.toString("utf16le", 0, count * 2);
    },
    invariantUpper(value) {
      const count = LCMapStringEx(
        "",
        0x200,
        value,
        value.length,
        null,
        0,
        null,
        null,
        0,
      );
      if (!count || count > 32768)
        throw failure(
          "INVARIANT_CASE_UNAVAILABLE",
          "initialize",
          GetLastError(),
        );
      const buffer = Buffer.alloc(count * 2);
      check(
        LCMapStringEx(
          "",
          0x200,
          value,
          value.length,
          buffer,
          count,
          null,
          null,
          0,
        ),
        "initialize",
      );
      return buffer.toString("utf16le");
    },
  };
  cached = Object.freeze(api);
  return cached;
}
module.exports = { createWindowsApi };
