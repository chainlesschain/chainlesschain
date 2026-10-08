// Experimental pipe-only adapter. The AppContainer token remains the boundary.
// Build as an x64 DLL named .node; N-API symbols are resolved from node.exe.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <sddl.h>
#include <node_api.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

namespace {
constexpr char kSchema[] = "chainlesschain/windows-node-pipe-adapter@1";
constexpr char kPrefix[] = "\\\\?\\pipe\\uv\\";
volatile LONG state = 0;  // 0 fresh, 1 installing, 2 installed, 3 failed
DWORD targetPid = 0;
char targetSid[192] = {};
DWORD installError = 0;
const char* installStage = "fresh";
volatile LONG64 serverCalls = 0, clientCalls = 0;
volatile LONG64 serverMapped = 0, clientMapped = 0;
volatile LONG64 serverFailures = 0, clientFailures = 0;
volatile LONG serverError = 0, clientError = 0;
volatile LONG serverFirstError = 0, clientFirstError = 0;
using PipeFn = HANDLE(WINAPI*)(LPCSTR, DWORD, DWORD, DWORD, DWORD, DWORD,
                              DWORD, LPSECURITY_ATTRIBUTES);
using FileFn = HANDLE(WINAPI*)(LPCSTR, DWORD, DWORD, LPSECURITY_ATTRIBUTES,
                              DWORD, DWORD, HANDLE);
PipeFn originalPipe = nullptr;
FileFn originalFile = nullptr;
void** pipeSlot = nullptr;
void** fileSlot = nullptr;
DWORD pipeProtection = 0, fileProtection = 0;

#define NAPI_SYMBOLS(X) \
  X(napi_get_cb_info) X(napi_get_value_string_utf8) X(napi_get_value_uint32) \
  X(napi_get_value_double) X(napi_create_string_utf8) X(napi_create_function) \
  X(napi_set_named_property) X(napi_throw_error)
struct Api {
#define FIELD(name) decltype(&::name) name;
  NAPI_SYMBOLS(FIELD)
#undef FIELD
} api = {};

// libuv v1.51.0: "\\\\?\\pipe\\uv\\%llu-%lu". No aliases, other PIDs,
// noncanonical decimal values, overflow, suffixes, or arbitrary pipe names.
bool decimal(const char*& cursor, uint64_t limit, uint64_t& value) {
  const char* start = cursor;
  value = 0;
  if (*cursor < '0' || *cursor > '9') return false;
  do {
    unsigned digit = static_cast<unsigned>(*cursor - '0');
    if (value > (limit - digit) / 10) return false;
    value = value * 10 + digit;
    ++cursor;
  } while (*cursor >= '0' && *cursor <= '9');
  return cursor - start == 1 || *start != '0';
}
bool mapPipe(const char* name, DWORD pid, char (&mapped)[96]) {
  if (!name || !pid || strncmp(name, kPrefix, sizeof(kPrefix) - 1)) return false;
  const char* cursor = name + sizeof(kPrefix) - 1;
  uint64_t nonce = 0, owner = 0;
  if (!decimal(cursor, UINT64_MAX, nonce) || *cursor++ != '-' ||
      !decimal(cursor, UINT32_MAX, owner) || *cursor || owner != pid) return false;
  int count = snprintf(mapped, sizeof(mapped), "\\\\.\\pipe\\LOCAL\\cc-uv-%llu-%lu",
                       static_cast<unsigned long long>(nonce),
                       static_cast<unsigned long>(pid));
  return count > 0 && static_cast<size_t>(count) < sizeof(mapped);
}

HANDLE WINAPI pipeHook(LPCSTR name, DWORD openMode, DWORD pipeMode,
                       DWORD instances, DWORD outSize, DWORD inSize,
                       DWORD timeout, LPSECURITY_ATTRIBUTES security) {
  DWORD entering = GetLastError();
  InterlockedIncrement64(&serverCalls);
  char mapped[96];
  bool matched = mapPipe(name, targetPid, mapped);
  if (matched) InterlockedIncrement64(&serverMapped);
  SetLastError(entering);
  HANDLE result = originalPipe(matched ? mapped : name, openMode, pipeMode,
                               instances, outSize, inSize, timeout, security);
  DWORD error = GetLastError();
  if (matched && result == INVALID_HANDLE_VALUE) {
    InterlockedIncrement64(&serverFailures);
    InterlockedCompareExchange(&serverFirstError, static_cast<LONG>(error), 0);
  }
  if (matched) InterlockedExchange(&serverError,
      result == INVALID_HANDLE_VALUE ? static_cast<LONG>(error) : 0);
  SetLastError(error);
  return result;
}
HANDLE WINAPI fileHook(LPCSTR name, DWORD access, DWORD share,
                       LPSECURITY_ATTRIBUTES security, DWORD disposition,
                       DWORD flags, HANDLE templateFile) {
  DWORD entering = GetLastError();
  InterlockedIncrement64(&clientCalls);
  char mapped[96];
  bool matched = mapPipe(name, targetPid, mapped);
  if (matched) InterlockedIncrement64(&clientMapped);
  SetLastError(entering);
  HANDLE result = originalFile(matched ? mapped : name, access, share, security,
                               disposition, flags, templateFile);
  DWORD error = GetLastError();
  if (matched && result == INVALID_HANDLE_VALUE) {
    InterlockedIncrement64(&clientFailures);
    InterlockedCompareExchange(&clientFirstError, static_cast<LONG>(error), 0);
  }
  if (matched) InterlockedExchange(&clientError,
      result == INVALID_HANDLE_VALUE ? static_cast<LONG>(error) : 0);
  SetLastError(error);
  return result;
}

bool attest(const char* expectedSid, DWORD expectedPid) {
  installStage = "token-attestation";
  if (!expectedPid || expectedPid != GetCurrentProcessId()) {
    SetLastError(ERROR_INVALID_PARAMETER); return false;
  }
  HANDLE token = nullptr;
  BOOL inJob = FALSE;
  if (!IsProcessInJob(GetCurrentProcess(), nullptr, &inJob)) return false;
  if (!inJob) { SetLastError(ERROR_ACCESS_DENIED); return false; }
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) return false;
  auto fail = [token](DWORD error) {
    CloseHandle(token); SetLastError(error); return false;
  };
  DWORD used = 0, appContainer = 0;
  if (!GetTokenInformation(token, TokenIsAppContainer, &appContainer,
                           sizeof(appContainer), &used)) return fail(GetLastError());
  if (appContainer != 1) return fail(ERROR_ACCESS_DENIED);
  alignas(void*) BYTE groups[65536] = {};
  if (!GetTokenInformation(token, TokenCapabilities, groups,
                           sizeof(groups), &used)) return fail(GetLastError());
  if (reinterpret_cast<TOKEN_GROUPS*>(groups)->GroupCount != 0)
    return fail(ERROR_ACCESS_DENIED);
  alignas(void*) BYTE sidInfo[1024] = {};
  if (!GetTokenInformation(token, TokenAppContainerSid, sidInfo,
                           sizeof(sidInfo), &used)) return fail(GetLastError());
  PSID expected = nullptr;
  if (!ConvertStringSidToSidA(expectedSid, &expected)) return fail(GetLastError());
  PSID actual = reinterpret_cast<TOKEN_APPCONTAINER_INFORMATION*>(sidInfo)->TokenAppContainer;
  bool ok = actual && IsValidSid(actual) && EqualSid(actual, expected);
  LPSTR actualText = nullptr;
  if (ok) ok = ConvertSidToStringSidA(actual, &actualText) != FALSE;
  if (ok) ok = strcmp(expectedSid, actualText) == 0;
  DWORD error = ok ? ERROR_SUCCESS : ERROR_ACCESS_DENIED;
  if (expected) LocalFree(expected);
  CloseHandle(token);
  if (ok) {
    targetPid = expectedPid;
    memcpy(targetSid, actualText, strlen(actualText) + 1);
  }
  if (actualText) LocalFree(actualText);
  SetLastError(error);
  return ok;
}

bool inImage(size_t rva, size_t bytes, size_t imageBytes) {
  return rva < imageBytes && bytes <= imageBytes - rva;
}
bool imageString(BYTE* base, size_t rva, size_t imageBytes) {
  return inImage(rva, 1, imageBytes) &&
      memchr(base + rva, 0, imageBytes - rva) != nullptr;
}
bool findSlots() {
  installStage = "node-image-imports";
  BYTE* base = reinterpret_cast<BYTE*>(GetModuleHandleW(nullptr));
  if (!base) return false;
  auto* dos = reinterpret_cast<IMAGE_DOS_HEADER*>(base);
  if (dos->e_magic != IMAGE_DOS_SIGNATURE || dos->e_lfanew <= 0 ||
      dos->e_lfanew > 1024 * 1024) return false;
  auto* pe = reinterpret_cast<IMAGE_NT_HEADERS64*>(base + dos->e_lfanew);
  if (pe->Signature != IMAGE_NT_SIGNATURE ||
      pe->FileHeader.Machine != IMAGE_FILE_MACHINE_AMD64 ||
      pe->OptionalHeader.Magic != IMAGE_NT_OPTIONAL_HDR64_MAGIC ||
      pe->OptionalHeader.NumberOfRvaAndSizes <= IMAGE_DIRECTORY_ENTRY_IMPORT) return false;
  size_t imageBytes = pe->OptionalHeader.SizeOfImage;
  IMAGE_DATA_DIRECTORY imports = pe->OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_IMPORT];
  if (!imports.VirtualAddress || !inImage(imports.VirtualAddress, imports.Size, imageBytes)) return false;
  bool terminated = false;
  for (size_t offset = 0; offset + sizeof(IMAGE_IMPORT_DESCRIPTOR) <= imports.Size;
       offset += sizeof(IMAGE_IMPORT_DESCRIPTOR)) {
    auto* descriptor = reinterpret_cast<IMAGE_IMPORT_DESCRIPTOR*>(base + imports.VirtualAddress + offset);
    if (!descriptor->Name) { terminated = true; break; }
    if (!imageString(base, descriptor->Name, imageBytes) ||
        !descriptor->OriginalFirstThunk || !descriptor->FirstThunk) return false;
    const char* library = reinterpret_cast<const char*>(base + descriptor->Name);
    for (size_t index = 0;; ++index) {
      size_t nameRva = descriptor->OriginalFirstThunk + index * sizeof(IMAGE_THUNK_DATA64);
      size_t slotRva = descriptor->FirstThunk + index * sizeof(IMAGE_THUNK_DATA64);
      if (!inImage(nameRva, sizeof(IMAGE_THUNK_DATA64), imageBytes) ||
          !inImage(slotRva, sizeof(IMAGE_THUNK_DATA64), imageBytes)) return false;
      auto* nameThunk = reinterpret_cast<IMAGE_THUNK_DATA64*>(base + nameRva);
      if (!nameThunk->u1.AddressOfData) break;
      if (IMAGE_SNAP_BY_ORDINAL64(nameThunk->u1.Ordinal)) continue;
      size_t rva = static_cast<size_t>(nameThunk->u1.AddressOfData);
      if (!inImage(rva, 3, imageBytes) || !imageString(base, rva + 2, imageBytes)) return false;
      const char* name = reinterpret_cast<const char*>(base + rva + 2);
      bool pipe = strcmp(name, "CreateNamedPipeA") == 0;
      bool file = strcmp(name, "CreateFileA") == 0;
      if (!pipe && !file) continue;
      // Only the standard imports seen in the pinned Node image are supported.
      if (_stricmp(library, "KERNEL32.dll") && _stricmp(library, "KERNELBASE.dll")) return false;
      HMODULE libraryModule = GetModuleHandleA(library);
      FARPROC expected = libraryModule ? GetProcAddress(libraryModule, name) : nullptr;
      auto** slot = reinterpret_cast<void**>(base + slotRva);
      if (!expected || *slot != reinterpret_cast<void*>(expected)) return false;
      if (pipe) {
        if (pipeSlot) return false;
        pipeSlot = slot; originalPipe = reinterpret_cast<PipeFn>(*slot);
      } else {
        if (fileSlot) return false;
        fileSlot = slot; originalFile = reinterpret_cast<FileFn>(*slot);
      }
    }
  }
  return terminated && pipeSlot && fileSlot;
}

// Each write immediately restores its original page protection. Failed or
// concurrently changed slots are rolled back. An unrecoverable rollback exits
// the current sandboxed process instead of running with a partial adapter.
bool exchangeSlot(void** slot, void* expected, void* desired, DWORD& protection) {
  DWORD old = 0;
  if (!VirtualProtect(slot, sizeof(void*), PAGE_READWRITE, &old)) return false;
  protection = old;
  void* previous = InterlockedCompareExchangePointer(slot, desired, expected);
  DWORD ignored = 0;
  if (!VirtualProtect(slot, sizeof(void*), old, &ignored)) {
    InterlockedCompareExchangePointer(slot, expected, desired);
    if (!VirtualProtect(slot, sizeof(void*), old, &ignored))
      TerminateProcess(GetCurrentProcess(), 126);
    SetLastError(ERROR_WRITE_FAULT); return false;
  }
  if (previous != expected) { SetLastError(ERROR_INVALID_STATE); return false; }
  return true;
}
bool install(const char* sid, DWORD pid) {
  if (InterlockedCompareExchange(&state, 1, 0) != 0) {
    SetLastError(ERROR_ALREADY_EXISTS); return false;
  }
  bool ok = attest(sid, pid);
  if (ok) {
    SetLastError(ERROR_BAD_EXE_FORMAT);
    ok = findSlots();
  }
  if (ok) {
    installStage = "pin-adapter";
    HMODULE pinned = nullptr;
    ok = GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS |
                           GET_MODULE_HANDLE_EX_FLAG_PIN,
                           reinterpret_cast<LPCWSTR>(&pipeHook), &pinned) != FALSE;
  }
  if (ok) {
    installStage = "patch-pipe-import";
    ok = exchangeSlot(pipeSlot, reinterpret_cast<void*>(originalPipe),
                      reinterpret_cast<void*>(&pipeHook), pipeProtection);
    if (ok) {
      installStage = "patch-file-import";
      ok = exchangeSlot(fileSlot, reinterpret_cast<void*>(originalFile),
                        reinterpret_cast<void*>(&fileHook), fileProtection);
      if (!ok) {
        DWORD error = GetLastError(), ignored = 0;
        if (!exchangeSlot(pipeSlot, reinterpret_cast<void*>(&pipeHook),
                          reinterpret_cast<void*>(originalPipe), ignored))
          TerminateProcess(GetCurrentProcess(), 126);
        SetLastError(error);
      }
    }
  }
  installError = ok ? ERROR_SUCCESS : GetLastError();
  installStage = ok ? "installed" : installStage;
  InterlockedExchange(&state, ok ? 2 : 3);
  return ok;
}

napi_value snapshot(napi_env env) {
  char json[2048];
  int patches = (pipeSlot && *pipeSlot == reinterpret_cast<void*>(&pipeHook) ? 1 : 0) +
      (fileSlot && *fileSlot == reinterpret_cast<void*>(&fileHook) ? 1 : 0);
  snprintf(json, sizeof(json),
      "{\"schema\":\"%s\",\"experimental\":true,\"admissionEligible\":false,"
      "\"pid\":%lu,\"appContainerSid\":\"%s\",\"capabilityCount\":%s,\"inJob\":%s,"
      "\"state\":%ld,\"stage\":\"%s\",\"installError\":%lu,"
      "\"patches\":%d,\"originalCreateNamedPipeA\":\"%p\","
      "\"originalCreateFileA\":\"%p\",\"pipeSlot\":\"%p\",\"fileSlot\":\"%p\","
      "\"pipeProtection\":%lu,\"fileProtection\":%lu,"
      "\"serverCalls\":%lld,\"clientCalls\":%lld,\"serverMapped\":%lld,\"clientMapped\":%lld,"
      "\"serverFailures\":%lld,\"clientFailures\":%lld,\"serverFirstError\":%ld,\"clientFirstError\":%ld,"
      "\"serverLastError\":%ld,\"clientLastError\":%ld,"
      "\"unsupported\":[\"NUL\",\"realpath\",\"uninstrumented-descendants\"]}",
      kSchema, static_cast<unsigned long>(targetPid), targetSid,
      targetPid ? "0" : "null", targetPid ? "true" : "false",
      static_cast<long>(InterlockedCompareExchange(&state, 0, 0)), installStage,
      static_cast<unsigned long>(installError), patches,
      reinterpret_cast<void*>(originalPipe), reinterpret_cast<void*>(originalFile),
      static_cast<void*>(pipeSlot), static_cast<void*>(fileSlot),
      static_cast<unsigned long>(pipeProtection), static_cast<unsigned long>(fileProtection),
      static_cast<long long>(InterlockedCompareExchange64(&serverCalls, 0, 0)),
      static_cast<long long>(InterlockedCompareExchange64(&clientCalls, 0, 0)),
      static_cast<long long>(InterlockedCompareExchange64(&serverMapped, 0, 0)),
      static_cast<long long>(InterlockedCompareExchange64(&clientMapped, 0, 0)),
      static_cast<long long>(InterlockedCompareExchange64(&serverFailures, 0, 0)),
      static_cast<long long>(InterlockedCompareExchange64(&clientFailures, 0, 0)),
      static_cast<long>(InterlockedCompareExchange(&serverFirstError, 0, 0)),
      static_cast<long>(InterlockedCompareExchange(&clientFirstError, 0, 0)),
      static_cast<long>(InterlockedCompareExchange(&serverError, 0, 0)),
      static_cast<long>(InterlockedCompareExchange(&clientError, 0, 0)));
  napi_value result;
  if (api.napi_create_string_utf8(env, json, NAPI_AUTO_LENGTH, &result) != napi_ok) return nullptr;
  return result;
}

#ifdef CC_PIPE_ADAPTER_SELF_TEST
// Compile as an ordinary EXE to exercise the actual C++ parser and refusal
// path. This test does not install hooks or require AppContainer privileges.
int runSelfTest() {
  struct Case { const char* name; DWORD pid; const char* expected; };
  const Case cases[] = {
    {"\\\\?\\pipe\\uv\\0-123", 123, "\\\\.\\pipe\\LOCAL\\cc-uv-0-123"},
    {"\\\\?\\pipe\\uv\\18446744073709551615-4294967295", 4294967295UL,
      "\\\\.\\pipe\\LOCAL\\cc-uv-18446744073709551615-4294967295"},
    {nullptr, 123, nullptr}, {"", 123, nullptr},
    {"\\\\?\\pipe\\uv\\1-123", 124, nullptr},
    {"\\\\?\\pipe\\uv\\1-0", 0, nullptr},
    {"\\\\?\\pipe\\uv\\18446744073709551616-123", 123, nullptr},
    {"\\\\?\\pipe\\uv\\1-4294967296", 123, nullptr},
    {"\\\\?\\pipe\\uv\\01-123", 123, nullptr},
    {"\\\\?\\pipe\\uv\\1-0123", 123, nullptr},
    {"\\\\?\\pipe\\uv\\+1-123", 123, nullptr},
    {"\\\\?\\pipe\\uv\\1--123", 123, nullptr},
    {"\\\\?\\pipe\\uv\\1-123\\extra", 123, nullptr},
    {"\\\\?\\pipe\\uv\\1-123 ", 123, nullptr},
    {"\\\\.\\pipe\\uv\\1-123", 123, nullptr},
    {"\\\\?\\PIPE\\uv\\1-123", 123, nullptr},
    {"\\\\?\\pipe\\other\\1-123", 123, nullptr},
    {"C:\\tmp\\uv\\1-123", 123, nullptr},
    {"NUL", 123, nullptr}, {"\\\\?\\pipe\\uv\\", 123, nullptr},
    {"\\\\?\\pipe\\uv\\1", 123, nullptr},
  };
  unsigned tested = 0;
  for (const auto& item : cases) {
    char mapped[96] = {};
    bool actual = mapPipe(item.name, item.pid, mapped);
    if (actual != (item.expected != nullptr) ||
        (actual && strcmp(mapped, item.expected))) return 10 + tested;
    ++tested;
  }
  // Exercise real IAT-style readonly page swaps, compare rejection, rollback,
  // and protection restoration without modifying any process import table.
  auto** slot = static_cast<void**>(VirtualAlloc(nullptr, 4096,
      MEM_RESERVE | MEM_COMMIT, PAGE_READWRITE));
  if (!slot) return 70;
  void* before = reinterpret_cast<void*>(&pipeHook);
  void* after = reinterpret_cast<void*>(&fileHook);
  *slot = before;
  DWORD ignored = 0, protection = 0;
  if (!VirtualProtect(slot, 4096, PAGE_READONLY, &ignored)) return 71;
  if (!exchangeSlot(slot, before, after, protection) ||
      protection != PAGE_READONLY || *slot != after) return 72;
  MEMORY_BASIC_INFORMATION info = {};
  if (!VirtualQuery(slot, &info, sizeof(info)) || info.Protect != PAGE_READONLY) return 73;
  if (exchangeSlot(slot, before, after, ignored) || *slot != after ||
      GetLastError() != ERROR_INVALID_STATE) return 74;
  if (!VirtualQuery(slot, &info, sizeof(info)) || info.Protect != PAGE_READONLY) return 75;
  if (exchangeSlot(nullptr, before, after, ignored)) return 76;
  if (!exchangeSlot(slot, after, before, ignored) || *slot != before ||
      !VirtualQuery(slot, &info, sizeof(info)) || info.Protect != PAGE_READONLY) return 77;
  if (!VirtualFree(slot, 0, MEM_RELEASE)) return 78;
  // Wrong PID must fail before imports, even if run inside an AppContainer.
  if (install("S-1-15-2-1", GetCurrentProcessId() + 1) ||
      state != 3 || pipeSlot || fileSlot || targetPid) return 80;
  if (install("S-1-15-2-1", GetCurrentProcessId()) ||
      GetLastError() != ERROR_ALREADY_EXISTS || state != 3) return 81;
  printf("{\"parserCases\":%u,\"readonlySwapAndRollback\":true,\"wrongPidRejected\":true,\"retryRejected\":true,\"patches\":0}\n", tested);
  return 0;
}
#endif
napi_value snapshotCallback(napi_env env, napi_callback_info) { return snapshot(env); }
napi_value installCallback(napi_env env, napi_callback_info info) {
  napi_value args[2]; size_t count = 2, sidBytes = 0;
  char sid[sizeof(targetSid)]; double numericPid = 0; uint32_t pid = 0;
  if (api.napi_get_cb_info(env, info, &count, args, nullptr, nullptr) != napi_ok || count != 2 ||
      api.napi_get_value_string_utf8(env, args[0], nullptr, 0, &sidBytes) != napi_ok ||
      sidBytes < 9 || sidBytes >= sizeof(sid) ||
      api.napi_get_value_string_utf8(env, args[0], sid, sizeof(sid), &sidBytes) != napi_ok ||
      strlen(sid) != sidBytes || strncmp(sid, "S-1-15-2-", 9) ||
      api.napi_get_value_double(env, args[1], &numericPid) != napi_ok ||
      api.napi_get_value_uint32(env, args[1], &pid) != napi_ok ||
      !pid || numericPid != static_cast<double>(pid)) {
    api.napi_throw_error(env, "ADAPTER_ARGUMENT", "Expected AppContainer SID and exact positive process PID");
    return nullptr;
  }
  for (size_t i = 9; i < sidBytes; ++i) {
    if ((sid[i] < '0' || sid[i] > '9') && sid[i] != '-') {
      api.napi_throw_error(env, "ADAPTER_ARGUMENT", "Invalid AppContainer SID"); return nullptr;
    }
  }
  if (!install(sid, pid)) {
    char error[256];
    snprintf(error, sizeof(error), "Adapter rejected installation at %s (Win32 %lu)",
             installStage, static_cast<unsigned long>(GetLastError()));
    api.napi_throw_error(env, "ADAPTER_INSTALL", error); return nullptr;
  }
  return snapshot(env);
}
}  // namespace

#ifdef CC_PIPE_ADAPTER_SELF_TEST
int main() { return runSelfTest(); }
#endif

extern "C" __declspec(dllexport) int32_t NAPI_CDECL node_api_module_get_api_version_v1() { return 8; }
extern "C" __declspec(dllexport) napi_value NAPI_CDECL napi_register_module_v1(napi_env env, napi_value exports) {
  HMODULE node = GetModuleHandleW(nullptr);
#define RESOLVE(name) api.name = reinterpret_cast<decltype(api.name)>(GetProcAddress(node, #name)); if (!api.name) return nullptr;
  NAPI_SYMBOLS(RESOLVE)
#undef RESOLVE
  napi_value fn;
  if (api.napi_create_function(env, "install", NAPI_AUTO_LENGTH, installCallback, nullptr, &fn) != napi_ok ||
      api.napi_set_named_property(env, exports, "install", fn) != napi_ok ||
      api.napi_create_function(env, "snapshot", NAPI_AUTO_LENGTH, snapshotCallback, nullptr, &fn) != napi_ok ||
      api.napi_set_named_property(env, exports, "snapshot", fn) != napi_ok) return nullptr;
  return exports;
}
