// Experimental pipe and private-canonical-path adapter. The AppContainer token remains the boundary.
// Build as an x64 DLL named .node; N-API symbols are resolved from node.exe.
#define WIN32_LEAN_AND_MEAN
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0A00
#endif
#include <windows.h>
#include <winioctl.h>
#include <sddl.h>
#include <bcrypt.h>
#include <shellapi.h>
#include <node_api.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <wchar.h>
#include <algorithm>
#include <string>
#include <vector>

namespace {
constexpr char kSchema[] = "chainlesschain/windows-node-runtime-adapter@4";
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
using FinalPathFn = DWORD(WINAPI*)(HANDLE, LPWSTR, DWORD, DWORD);
FinalPathFn originalFinalPath = nullptr;
void** finalPathSlot = nullptr;
DWORD finalPathProtection = 0;
HMODULE adapterModule = nullptr;
constexpr DWORD kPathChars = 4096;
constexpr size_t kMaxDepth = 64;
HANDLE rootHandle = INVALID_HANDLE_VALUE;
WCHAR rootDos[kPathChars] = {}, rootNt[kPathChars] = {};
FILE_ID_INFO rootId = {};
volatile LONG64 realpathCalls = 0, realpathFallbacks = 0, realpathMapped = 0, realpathRejected = 0;
volatile LONG realpathLastError = 0;

#include "windows-node-private-v4-adapter.h"

bool normalizedNt(HANDLE handle, WCHAR (&result)[kPathChars]) {
  DWORD count = originalFinalPath(handle, result, kPathChars, VOLUME_NAME_NT);
  return count && count < kPathChars && result[count] == 0;
}
bool plainObject(HANDLE handle, bool requireDirectory) {
  FILE_ATTRIBUTE_TAG_INFO attributes = {};
  BY_HANDLE_FILE_INFORMATION basic = {};
  if (!GetFileInformationByHandleEx(handle, FileAttributeTagInfo, &attributes, sizeof(attributes)) ||
      !GetFileInformationByHandle(handle, &basic)) return false;
  return !(attributes.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) &&
      (!requireDirectory || (attributes.FileAttributes & FILE_ATTRIBUTE_DIRECTORY)) &&
      basic.nNumberOfLinks == 1;
}
bool sameId(HANDLE handle, const FILE_ID_INFO& expected) {
  FILE_ID_INFO actual = {};
  return GetFileInformationByHandleEx(handle, FileIdInfo, &actual, sizeof(actual)) &&
      actual.VolumeSerialNumber == expected.VolumeSerialNumber &&
      !memcmp(&actual.FileId, &expected.FileId, sizeof(actual.FileId));
}
bool validComponent(const WCHAR* start, size_t count) {
  if (!count || count > 255 || start[count - 1] == L'.' || start[count - 1] == L' ') return false;
  for (size_t i = 0; i < count; ++i) {
    WCHAR character = start[i];
    if (character < 32 || wcschr(L"\\/:*?\"<>|", character)) return false;
  }
  return true;
}
// Pure canonical-name boundary check. Case-sensitive comparison avoids merging
// distinct directories on a case-sensitive NTFS subtree.
bool privateSuffix(const WCHAR* canonical, const WCHAR* root, const WCHAR*& suffix) {
  size_t count = wcslen(root);
  if (!count || wcsncmp(canonical, root, count) ||
      (canonical[count] && canonical[count] != L'\\')) return false;
  suffix = canonical + count;
  return true;
}
bool moduleDrivePath(const WCHAR* loaded, const WCHAR*& drivePath) {
  drivePath = loaded;
  // uv_dlopen loads absolute Windows paths with this DOS long-path prefix.
  // Only remove that exact spelling before validating a drive-rooted path;
  // UNC, NT device, relative, and other namespace aliases stay unsupported.
  if (!wcsncmp(drivePath, L"\\\\?\\", 4)) drivePath += 4;
  if (wcslen(drivePath) < 3 ||
      !((drivePath[0] >= L'A' && drivePath[0] <= L'Z') ||
        (drivePath[0] >= L'a' && drivePath[0] <= L'z')) ||
      drivePath[1] != L':' || drivePath[2] != L'\\') return false;
  const WCHAR* component = drivePath + 3;
  while (*component) {
    const WCHAR* end = wcschr(component, L'\\');
    if (!end) end = component + wcslen(component);
    if (!validComponent(component, static_cast<size_t>(end - component))) return false;
    component = *end ? end + 1 : end;
    if (*end && !*component) return false;
  }
  return true;
}
#include "windows-node-private-v4-paired.h"
bool initializeRoot(){return initializePrivatePair();}
struct WalkHandles {
  HANDLE handles[kMaxDepth] = {};
  size_t count = 0;
  ~WalkHandles() { while (count) CloseHandle(handles[--count]); }
};
bool canonicalPrivateDos(HANDLE target, WCHAR (&dos)[kPathChars]) {
  if (rootHandle == INVALID_HANDLE_VALUE || !plainObject(target, false) ||
      !sameId(rootHandle, rootId)) return false;
  WCHAR canonical[kPathChars];
  if (!normalizedNt(target, canonical)) return false;
  const WCHAR* suffix = nullptr;
  if (!privateSuffix(canonical, rootNt, suffix)) return false;
  FILE_ID_INFO targetId = {};
  if (!GetFileInformationByHandleEx(target, FileIdInfo, &targetId, sizeof(targetId))) return false;
  const WCHAR* logicalDos=L"X:";size_t rootChars = wcslen(logicalDos), suffixChars = wcslen(suffix);
  if (4 + rootChars + suffixChars >= kPathChars) return false;
  memcpy(dos, L"\\\\?\\", 4 * sizeof(WCHAR));
  memcpy(dos + 4, logicalDos, rootChars * sizeof(WCHAR));
  memcpy(dos + 4 + rootChars, suffix, (suffixChars + 1) * sizeof(WCHAR));
  WalkHandles pinned;
  HANDLE finalHandle = rootHandle;
  const WCHAR* component = suffix;
  while (*component) {
    if (*component++ != L'\\' || pinned.count == kMaxDepth) return false;
    const WCHAR* end = wcschr(component, L'\\');
    if (!end) end = component + wcslen(component);
    if (!validComponent(component, static_cast<size_t>(end - component))) return false;
    size_t boundary = 4 + rootChars + static_cast<size_t>(end - suffix);
    WCHAR saved = dos[boundary]; dos[boundary] = 0;
    HANDLE opened = CreateFileW(dos, 0, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr,
        OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
    dos[boundary] = saved;
    if (opened == INVALID_HANDLE_VALUE) return false;
    pinned.handles[pinned.count++] = opened;
    if (!plainObject(opened, *end != 0)) return false;
    finalHandle = opened;
    component = end;
  }
  if (!sameId(finalHandle, targetId)) return false;
  // Re-query while every component is pinned. The final handle's kernel name
  // must exactly match the target's initial normalized NT name.
  WCHAR confirmed[kPathChars];
  return plainObject(finalHandle, false) && sameId(target, targetId) &&
      normalizedNt(finalHandle, confirmed) && !wcscmp(confirmed, canonical);
}
DWORD WINAPI finalPathHook(HANDLE handle, LPWSTR output, DWORD size, DWORD flags) {
  DWORD entering = GetLastError();
  InterlockedIncrement64(&realpathCalls);
  SetLastError(entering);
  DWORD result = originalFinalPath(handle, output, size, flags);
  DWORD originalError = GetLastError();
  if (result || flags != 0 || originalError != ERROR_ACCESS_DENIED) {
    SetLastError(originalError); return result;
  }
  InterlockedIncrement64(&realpathFallbacks);
  WCHAR dos[kPathChars];
  if (!canonicalPrivateDos(handle, dos)) {
    InterlockedIncrement64(&realpathRejected);
    InterlockedExchange(&realpathLastError, static_cast<LONG>(GetLastError()));
    SetLastError(originalError); return 0;
  }
  size_t length = wcslen(dos);
  InterlockedIncrement64(&realpathMapped);
  InterlockedExchange(&realpathLastError, 0);
  if (size <= length) {
    SetLastError(ERROR_INSUFFICIENT_BUFFER);
    return static_cast<DWORD>(length + 1);
  }
  if (!output) { SetLastError(ERROR_INVALID_PARAMETER); return 0; }
  memcpy(output, dos, (length + 1) * sizeof(WCHAR));
  SetLastError(ERROR_SUCCESS);
  return static_cast<DWORD>(length);
}

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
      bool finalPath = strcmp(name, "GetFinalPathNameByHandleW") == 0;
      bool fileW = strcmp(name, "CreateFileW") == 0;
      bool process = strcmp(name, "CreateProcessW") == 0;
      bool terminate = strcmp(name, "TerminateProcess") == 0;
      if (!pipe && !file && !finalPath && !fileW && !process && !terminate) continue;
      // Only the standard imports seen in the pinned Node image are supported.
      if (_stricmp(library, "KERNEL32.dll") && _stricmp(library, "KERNELBASE.dll")) return false;
      HMODULE libraryModule = GetModuleHandleA(library);
      FARPROC expected = libraryModule ? GetProcAddress(libraryModule, name) : nullptr;
      auto** slot = reinterpret_cast<void**>(base + slotRva);
      if (!expected || *slot != reinterpret_cast<void*>(expected)) return false;
      if (pipe) {
        if (pipeSlot) return false;
        pipeSlot = slot; originalPipe = reinterpret_cast<PipeFn>(*slot);
      } else if (file) {
        if (fileSlot) return false;
        fileSlot = slot; originalFile = reinterpret_cast<FileFn>(*slot);
      } else if (fileW) {
        if (fileWSlot) return false;
        fileWSlot = slot; originalFileW = reinterpret_cast<FileWFn>(*slot);
      } else if (terminate) {
        if(terminateSlot)return false;terminateSlot=slot;originalTerminate=reinterpret_cast<TerminateFn>(*slot);
      } else if (process) {
        if (processSlot) return false;
        processSlot = slot; originalProcess = reinterpret_cast<ProcessFn>(*slot);
      } else {
        if (finalPathSlot) return false;
        finalPathSlot = slot; originalFinalPath = reinterpret_cast<FinalPathFn>(*slot);
      }
    }
  }
  return terminated && pipeSlot && fileSlot && finalPathSlot && fileWSlot && processSlot && terminateSlot;
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
    ok = GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS |
                           GET_MODULE_HANDLE_EX_FLAG_PIN,
                           reinterpret_cast<LPCWSTR>(&pipeHook), &adapterModule) != FALSE;
  }
  if (ok) {
    SetLastError(ERROR_ACCESS_DENIED);
    ok = initializeRoot();
  }
  if (ok) ok = initializeNull();
  if (ok) ok = initializeBroker();
  if (ok) {
    struct Patch { void** slot; void* original; void* hook; DWORD* protection; };
    Patch patches[] = {
      {pipeSlot, reinterpret_cast<void*>(originalPipe), reinterpret_cast<void*>(&pipeHook), &pipeProtection},
      {fileSlot, reinterpret_cast<void*>(originalFile), reinterpret_cast<void*>(&fileHook), &fileProtection},
      {finalPathSlot, reinterpret_cast<void*>(originalFinalPath), reinterpret_cast<void*>(&finalPathHook), &finalPathProtection},
      {fileWSlot, reinterpret_cast<void*>(originalFileW), reinterpret_cast<void*>(&nullFileHook), &fileWProtection},
      {processSlot, reinterpret_cast<void*>(originalProcess), reinterpret_cast<void*>(&processHook), &processProtection},
      {terminateSlot,reinterpret_cast<void*>(originalTerminate),reinterpret_cast<void*>(&terminateHook),&terminateProtection}
    };
    installStage = "patch-six-imports";
    size_t completed = 0;
    for (auto& patch : patches) {
      if (!exchangeSlot(patch.slot, patch.original, patch.hook, *patch.protection)) { ok = false; break; }
      ++completed;
    }
    if (!ok) {
      DWORD error = GetLastError(), ignored = 0;
      while (completed) {
        auto& patch = patches[--completed];
        if (!exchangeSlot(patch.slot, patch.hook, patch.original, ignored)) TerminateProcess(GetCurrentProcess(), 126);
      }
      SetLastError(error);
    }
  }
  installError = ok ? ERROR_SUCCESS : GetLastError();
  if (!ok && !installError) installError = ERROR_ACCESS_DENIED;
  if (!ok && rootHandle != INVALID_HANDLE_VALUE) {
    CloseHandle(rootHandle); rootHandle = INVALID_HANDLE_VALUE;
    SetLastError(installError);
  }
  if (!ok) {
    if (nullRead) CloseHandle(nullRead);
    if (nullWrite) CloseHandle(nullWrite);
    nullRead = nullWrite = nullptr;
  }
  installStage = ok ? "installed" : installStage;
  InterlockedExchange(&state, ok ? 2 : 3);
  SetLastError(installError);
  return ok;
}

bool jsonPath(const WCHAR* value, char* result, size_t capacity) {
  char utf8[4 * kPathChars];
  int count = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value, -1,
      utf8, sizeof(utf8), nullptr, nullptr);
  if (!count) return false;
  size_t written = 0;
  for (int i = 0; i < count - 1; ++i) {
    unsigned char character = static_cast<unsigned char>(utf8[i]);
    if (character < 32) return false;
    if (character == '\\' || character == '"') {
      if (written + 1 >= capacity) return false;
      result[written++] = '\\';
    }
    if (written + 1 >= capacity) return false;
    result[written++] = static_cast<char>(character);
  }
  result[written] = 0;
  return true;
}
napi_value snapshot(napi_env env) {
  char json[80000], dosJson[32768], ntJson[32768], idHex[33];
  if (!jsonPath(rootDos, dosJson, sizeof(dosJson)) ||
      !jsonPath(rootNt, ntJson, sizeof(ntJson))) {
    api.napi_throw_error(env, "ADAPTER_RECEIPT", "Private root is not representable"); return nullptr;
  }
  for (size_t i = 0; i < 16; ++i) snprintf(idHex + 2 * i, 3, "%02x", rootId.FileId.Identifier[i]);
  int patches = (pipeSlot && *pipeSlot == reinterpret_cast<void*>(&pipeHook) ? 1 : 0) +
      (fileSlot && *fileSlot == reinterpret_cast<void*>(&fileHook) ? 1 : 0) +
      (finalPathSlot && *finalPathSlot == reinterpret_cast<void*>(&finalPathHook) ? 1 : 0) +
      (fileWSlot && *fileWSlot == reinterpret_cast<void*>(&nullFileHook) ? 1 : 0) +
      (processSlot && *processSlot == reinterpret_cast<void*>(&processHook) ? 1 : 0) + (terminateSlot && *terminateSlot == reinterpret_cast<void*>(&terminateHook) ? 1 : 0);
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
      "\"originalGetFinalPathNameByHandleW\":\"%p\",\"finalPathSlot\":\"%p\",\"finalPathProtection\":%lu,"
      "\"supportedPrivateRealpath\":%s,\"rootProof\":{\"dos\":\"%s\",\"nt\":\"%s\","
      "\"volumeSerial\":\"%llu\",\"fileId\":\"%s\",\"normalizedNtFlags\":2,\"handlePinned\":%s,"
      "\"ancestorAuthority\":\"supervisor-private-tree-guards\",\"componentPolicy\":\"pinned-no-reparse-single-link-file-id\"},"
      "\"realpathCalls\":%lld,\"realpathFallbacks\":%lld,\"realpathMapped\":%lld,\"realpathRejected\":%lld,\"realpathLastError\":%ld,"
      "\"nullProof\":{\"readAttested\":%s,\"writeAttested\":%s,\"object\":\"\\\\Device\\\\Null\",\"readAccess\":1179785,\"writeAccess\":1180054,\"mode\":32},"
      "\"nullFallbacks\":%lld,\"nullMapped\":%lld,\"nullRejected\":%lld,\"launches\":%lld,\"launched\":%lld,\"launchRejected\":%lld,\"launchError\":%ld,\"launchStage\":\"%s\","
      "\"unsupported\":[\"nonexact-NUL-calls\",\"outside-private-root-realpath\",\"uninstrumented-descendants\"]}",
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
      static_cast<long>(InterlockedCompareExchange(&clientError, 0, 0)),
      reinterpret_cast<void*>(originalFinalPath), static_cast<void*>(finalPathSlot),
      static_cast<unsigned long>(finalPathProtection),
      state == 2 && rootHandle != INVALID_HANDLE_VALUE ? "true" : "false", dosJson, ntJson,
      static_cast<unsigned long long>(rootId.VolumeSerialNumber), idHex,
      rootHandle != INVALID_HANDLE_VALUE ? "true" : "false",
      static_cast<long long>(InterlockedCompareExchange64(&realpathCalls, 0, 0)),
      static_cast<long long>(InterlockedCompareExchange64(&realpathFallbacks, 0, 0)),
      static_cast<long long>(InterlockedCompareExchange64(&realpathMapped, 0, 0)),
      static_cast<long long>(InterlockedCompareExchange64(&realpathRejected, 0, 0)),
      static_cast<long>(InterlockedCompareExchange(&realpathLastError, 0, 0)),
      nullObject(nullRead, kNullRead) ? "true" : "false", nullObject(nullWrite, kNullWrite) ? "true" : "false",
      static_cast<long long>(nullFallbacks), static_cast<long long>(nullMapped), static_cast<long long>(nullRejected),
      static_cast<long long>(launches), static_cast<long long>(launched), static_cast<long long>(launchRejected),
      static_cast<long>(launchError), launchStage);
  napi_value result;
  if (api.napi_create_string_utf8(env, json, NAPI_AUTO_LENGTH, &result) != napi_ok) return nullptr;
  return result;
}

#ifdef CC_RUNTIME_ADAPTER_SELF_TEST
// Compile as an ordinary EXE to exercise the actual C++ parser and refusal
// path. This test does not install hooks or require AppContainer privileges.
FinalPathFn selfTestNativeFinalPath = nullptr;
DWORD WINAPI selfTestFinalPath(HANDLE handle, LPWSTR output, DWORD size, DWORD flags) {
  // Simulate only the observed DOS denial. All NT queries and file identity /
  // component checks below use the actual Windows filesystem APIs.
  if (flags == 0) { SetLastError(ERROR_ACCESS_DENIED); return 0; }
  return selfTestNativeFinalPath(handle, output, size, flags);
}
int testPrivateRealpath() {
  const WCHAR* plain = nullptr;
  if (!moduleDrivePath(L"\\\\?\\C:\\private root\\workspace\\adapter\\example.node", plain) ||
      wcscmp(plain, L"C:\\private root\\workspace\\adapter\\example.node") ||
      !moduleDrivePath(L"C:\\private root\\workspace\\adapter\\example.node", plain)) return 88;
  const WCHAR* aliases[] = {L"\\\\?\\UNC\\host\\share\\example.node", L"\\\\host\\share\\example.node",
      L"\\??\\C:\\private\\example.node", L"\\Device\\HarddiskVolume3\\private\\example.node",
      L"C:relative.node", L"C:\\private\\..\\example.node", L"C:\\private\\alias.\\example.node"};
  for (const auto* alias : aliases) if (moduleDrivePath(alias, plain)) return 89;
  struct Boundary { const WCHAR* canonical; const WCHAR* root; bool accepted; };
  const Boundary boundaries[] = {
    {L"\\Device\\HarddiskVolume3\\private", L"\\Device\\HarddiskVolume3\\private", true},
    {L"\\Device\\HarddiskVolume3\\private\\nested", L"\\Device\\HarddiskVolume3\\private", true},
    {L"\\Device\\HarddiskVolume3\\private-other\\file", L"\\Device\\HarddiskVolume3\\private", false},
    {L"\\Device\\HarddiskVolume4\\private\\file", L"\\Device\\HarddiskVolume3\\private", false},
    {L"\\Device\\HarddiskVolume3\\Private\\file", L"\\Device\\HarddiskVolume3\\private", false},
    {L"\\Device\\HarddiskVolume3\\other", L"\\Device\\HarddiskVolume3\\private", false},
    {L"x", L"", false},
  };
  for (const auto& item : boundaries) {
    const WCHAR* suffix = nullptr;
    if (privateSuffix(item.canonical, item.root, suffix) != item.accepted) return 90;
  }
  const WCHAR* invalid[] = {L"", L".", L"..", L"name.", L"name ", L"stream:ads",
      L"embedded/slash", L"embedded\\slash", L"wild*card", L"bad\tname"};
  for (const auto* item : invalid) if (validComponent(item, wcslen(item))) return 91;
  if (!validComponent(L"normal-name.txt", 15) || !validComponent(L".hidden", 7)) return 92;
  WCHAR temp[kPathChars], nested[kPathChars], file[kPathChars], alias[kPathChars];
  DWORD tempChars = GetTempPathW(kPathChars, temp);
  if (!tempChars || tempChars + 100 >= kPathChars) return 93;
  int count = swprintf(rootDos, kPathChars, L"%lscc-runtime-adapter-test-%lu-%llu", temp,
      static_cast<unsigned long>(GetCurrentProcessId()), static_cast<unsigned long long>(GetTickCount64()));
  if (count <= 0 || !CreateDirectoryW(rootDos, nullptr)) return 94;
  swprintf(nested, kPathChars, L"%ls\\nested", rootDos);
  swprintf(file, kPathChars, L"%ls\\ordinary.txt", nested);
  swprintf(alias, kPathChars, L"%ls\\hardlink.txt", nested);
  if (!CreateDirectoryW(nested, nullptr)) return 95;
  HANDLE target = CreateFileW(file, GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
      nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (target == INVALID_HANDLE_VALUE) return 96;
  CloseHandle(target);
  target = CreateFileW(file, 0, 0, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  rootHandle = CreateFileW(rootDos, 0, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr,
      OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
  selfTestNativeFinalPath = reinterpret_cast<FinalPathFn>(
      GetProcAddress(GetModuleHandleW(L"kernel32.dll"), "GetFinalPathNameByHandleW"));
  originalFinalPath = selfTestFinalPath;
  if (target == INVALID_HANDLE_VALUE || rootHandle == INVALID_HANDLE_VALUE ||
      !normalizedNt(rootHandle, rootNt) ||
      !GetFileInformationByHandleEx(rootHandle, FileIdInfo, &rootId, sizeof(rootId))) return 97;
  WCHAR output[kPathChars], expected[kPathChars];
  swprintf(expected, kPathChars, L"\\\\?\\%ls", file);
  if (!canonicalPrivateDos(target, output) || wcscmp(output, expected)) return 98;
  DWORD needed = finalPathHook(target, nullptr, 0, 0);
  if (needed != wcslen(expected) + 1 || GetLastError() != ERROR_INSUFFICIENT_BUFFER) return 99;
  output[0] = L'!';
  if (finalPathHook(target, output, needed - 1, 0) != needed || output[0] != L'!') return 100;
  if (finalPathHook(target, output, needed, 0) != needed - 1 || wcscmp(output, expected)) return 101;
  if (!finalPathHook(target, output, kPathChars, VOLUME_NAME_NT) || wcsncmp(output, rootNt, wcslen(rootNt))) return 102;
  HANDLE outside = CreateFileW(temp, 0, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr,
      OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, nullptr);
  if (outside == INVALID_HANDLE_VALUE) return 103;
  if (finalPathHook(outside, output, kPathChars, 0) || GetLastError() != ERROR_ACCESS_DENIED) return 104;
  CloseHandle(outside);
  CloseHandle(target);
  if (!CreateHardLinkW(alias, file, nullptr)) return 105;
  target = CreateFileW(file, 0, 0, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (target == INVALID_HANDLE_VALUE || canonicalPrivateDos(target, output)) return 106;
  CloseHandle(target);
  CloseHandle(rootHandle); rootHandle = INVALID_HANDLE_VALUE;
  if (!DeleteFileW(alias) || !DeleteFileW(file) || !RemoveDirectoryW(nested) || !RemoveDirectoryW(rootDos)) return 107;
  rootDos[0] = rootNt[0] = 0;
  return 0;
}
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
  int nullTest = testNullV3();
  if (nullTest) { fprintf(stderr, "Null v3 test failed %d (Win32 %lu)\n", nullTest, static_cast<unsigned long>(GetLastError())); return nullTest; }
  int realpathTest = testPrivateRealpath();
  if (realpathTest) { fprintf(stderr, "private realpath test failed %d (Win32 %lu)\n", realpathTest, static_cast<unsigned long>(GetLastError())); return realpathTest; }
  // Wrong PID must fail before imports, even if run inside an AppContainer.
  if (install("S-1-15-2-1", GetCurrentProcessId() + 1) ||
      state != 3 || pipeSlot || fileSlot || targetPid) return 80;
  if (install("S-1-15-2-1", GetCurrentProcessId()) ||
      GetLastError() != ERROR_ALREADY_EXISTS || state != 3) return 81;
  printf("{\"parserCases\":%u,\"readonlySwapAndRollback\":true,\"privateRealpathBoundaryAndIdentity\":true,\"realpathSizeContract\":true,\"outsideAndHardlinkRejected\":true,\"wrongPidRejected\":true,\"retryRejected\":true,\"patches\":0}\n", tested);
  return 0;
}
#endif
napi_value snapshotCallback(napi_env env, napi_callback_info) { return snapshot(env); }
// Read-only diagnostic: no caller-selected namespace and no reparse translation.
napi_value probeReparseCallback(napi_env env, napi_callback_info info) {
  constexpr char expected[] = "X:\\scratch\\private-v4-junction-probe\\link";
  napi_value args[2]; size_t count = 2, bytes = 0;
  char input[sizeof(expected)] = {};
  if (state != 2 || api.napi_get_cb_info(env, info, &count, args, nullptr, nullptr) != napi_ok ||
      count != 1 || api.napi_get_value_string_utf8(env, args[0], nullptr, 0, &bytes) != napi_ok ||
      bytes != sizeof(expected) - 1 ||
      api.napi_get_value_string_utf8(env, args[0], input, sizeof(input), &bytes) != napi_ok ||
      memcmp(input, expected, sizeof(expected))) {
    api.napi_throw_error(env, "REPARSE_PROBE_ARGUMENT", "Expected installed adapter and exact fixed junction probe path");
    return nullptr;
  }
  WalkHandles pinned;
  const WCHAR* ancestors[] = {L"X:\\scratch", L"X:\\scratch\\private-v4-junction-probe"};
  for (const WCHAR* ancestor : ancestors) {
    HANDLE handle = CreateFileW(ancestor, 0, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr,
        OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
    if (handle == INVALID_HANDLE_VALUE) {
      char message[96]; snprintf(message, sizeof(message), "Probe ancestor open failed (Win32 %lu)",
          static_cast<unsigned long>(GetLastError()));
      api.napi_throw_error(env, "REPARSE_PROBE_GUARD", message); return nullptr;
    }
    pinned.handles[pinned.count++] = handle;
    WCHAR canonical[kPathChars];
    std::wstring exact = L"\\\\?\\"; exact += ancestor;
    if (!plainObject(handle, true) || !canonicalPrivateDos(handle, canonical) || exact != canonical) {
      api.napi_throw_error(env, "REPARSE_PROBE_GUARD", "Probe ancestor is not the exact plain private directory");
      return nullptr;
    }
  }
  HANDLE handle = CreateFileW(L"X:\\scratch\\private-v4-junction-probe\\link", 0,
      FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING,
      FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
  DWORD openError = handle == INVALID_HANDLE_VALUE ? GetLastError() : 0;
  FILE_ATTRIBUTE_TAG_INFO attributes = {};
  DWORD attributeError = 0, reparseError = 0, returned = 0;
  bool attributeRead = false, reparseRead = false;
  unsigned char buffer[16384] = {};
  if (handle != INVALID_HANDLE_VALUE) {
    pinned.handles[pinned.count++] = handle;
    attributeRead = GetFileInformationByHandleEx(handle, FileAttributeTagInfo, &attributes, sizeof(attributes)) != FALSE;
    if (!attributeRead) attributeError = GetLastError();
    reparseRead = DeviceIoControl(handle, FSCTL_GET_REPARSE_POINT, nullptr, 0, buffer,
        sizeof(buffer), &returned, nullptr) != FALSE;
    if (!reparseRead) reparseError = GetLastError();
  }
  DWORD tag = 0; WORD dataLength = 0;
  bool decoded = false;
  std::string substitute = "null", print = "null";
  if (reparseRead && returned >= 8) {
    memcpy(&tag, buffer, sizeof(tag)); memcpy(&dataLength, buffer + 4, sizeof(dataLength));
    if (tag == IO_REPARSE_TAG_MOUNT_POINT && dataLength >= 8 &&
        static_cast<DWORD>(dataLength) + 8 <= returned) {
      WORD offsets[4]; memcpy(offsets, buffer + 8, sizeof(offsets));
      auto decode = [&](WORD offset, WORD length, std::string& output) {
        if ((offset | length) & 1 || static_cast<unsigned>(offset) + length > dataLength - 8u) return false;
        output = "\"";
        for (unsigned i = 0; i < length; i += 2) {
          WORD unit; memcpy(&unit, buffer + 16 + offset + i, sizeof(unit));
          char escaped[7]; snprintf(escaped, sizeof(escaped), "\\u%04x", static_cast<unsigned>(unit));
          output += escaped;
        }
        output += "\""; return true;
      };
      decoded = decode(offsets[0], offsets[1], substitute) && decode(offsets[2], offsets[3], print);
      if (!decoded) { substitute = "null"; print = "null"; }
    }
  }
  char header[512];
  snprintf(header, sizeof(header),
      "{\"readOnly\":true,\"openError\":%lu,\"attributeRead\":%s,\"attributeError\":%lu,"
      "\"attributes\":%lu,\"attributeTag\":%lu,\"reparseRead\":%s,\"reparseError\":%lu,"
      "\"returnedBytes\":%lu,\"rawTag\":%lu,\"dataLength\":%u,\"mountPointDecoded\":%s,\"substituteName\":",
      static_cast<unsigned long>(openError), attributeRead ? "true" : "false",
      static_cast<unsigned long>(attributeError), static_cast<unsigned long>(attributes.FileAttributes),
      static_cast<unsigned long>(attributes.ReparseTag), reparseRead ? "true" : "false",
      static_cast<unsigned long>(reparseError), static_cast<unsigned long>(returned),
      static_cast<unsigned long>(tag), static_cast<unsigned>(dataLength), decoded ? "true" : "false");
  std::string json = header; json += substitute; json += ",\"printName\":"; json += print; json += "}";
  napi_value result;
  if (api.napi_create_string_utf8(env, json.c_str(), NAPI_AUTO_LENGTH, &result) != napi_ok) return nullptr;
  return result;
}
napi_value privateIdentityCallback(napi_env env,napi_callback_info){auto json=privateIdentityJson();if(json.empty()){api.napi_throw_error(env,"PRIVATE_IDENTITY","Held physical/logical identity differs");return nullptr;}napi_value value;if(api.napi_create_string_utf8(env,json.c_str(),NAPI_AUTO_LENGTH,&value)!=napi_ok)return nullptr;return value;}
HANDLE unlistedEvent = nullptr;
ULONG unlistedEventType = 0;
WCHAR unlistedEventName[kPathChars] = {};
napi_value unlistedEventBegin(napi_env env, napi_callback_info) {
  if (state != 2 || unlistedEvent) {
    api.napi_throw_error(env, "ADAPTER_TRAP", "Event trap requires fresh installed process"); return nullptr;
  }
  SECURITY_ATTRIBUTES sa = {sizeof(sa), nullptr, TRUE};
  WCHAR name[192];
  swprintf(name, 192, L"Local\\cc-null-v3-unlisted-%lu-%llu", GetCurrentProcessId(), GetTickCount64());
  unlistedEvent = CreateEventW(&sa, FALSE, FALSE, name);
  DWORD error = GetLastError();
  auto query = reinterpret_cast<QueryObjectFn>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "NtQueryObject"));
  alignas(void*) BYTE bytes[8192] = {}; ULONG used = 0; DWORD flags = 0;
  bool ok = unlistedEvent && error != ERROR_ALREADY_EXISTS &&
      GetHandleInformation(unlistedEvent, &flags) && (flags & HANDLE_FLAG_INHERIT) &&
      objectString(unlistedEvent, 2, L"Event") && query &&
      query(unlistedEvent, 1, bytes, sizeof(bytes), &used) == 0 && used <= sizeof(bytes);
  if (ok) {
    auto* value = reinterpret_cast<NativeString*>(bytes);
    uintptr_t offset = reinterpret_cast<uintptr_t>(value->buffer) - reinterpret_cast<uintptr_t>(bytes);
    ok = value->length && value->length % 2 == 0 && value->length < sizeof(unlistedEventName) &&
        value->maximum >= value->length && offset >= sizeof(NativeString) && offset <= sizeof(bytes) &&
        value->maximum <= sizeof(bytes) - offset;
    if (ok) memcpy(unlistedEventName, value->buffer, value->length);
  }
  bool present = false; ULONG_PTR handleCount = 0;
  ok = ok && snapshotHandleType(unlistedEvent, present, unlistedEventType, handleCount) && present;
  char escaped[32768], json[33000];
  if (!ok || !jsonPath(unlistedEventName, escaped, sizeof(escaped))) {
    if (unlistedEvent) CloseHandle(unlistedEvent); unlistedEvent = nullptr;
    api.napi_throw_error(env, "ADAPTER_TRAP", "Unique inheritable Event creation/identity failed"); return nullptr;
  }
  snprintf(json, sizeof(json), "{\"handle\":\"%llx\",\"objectName\":\"%s\",\"type\":\"Event\",\"inheritable\":true,\"expectedTypeIndex\":%lu}",
      static_cast<unsigned long long>(reinterpret_cast<uintptr_t>(unlistedEvent)), escaped, unlistedEventType);
  napi_value value;
  if (api.napi_create_string_utf8(env, json, NAPI_AUTO_LENGTH, &value) != napi_ok) return nullptr;
  return value;
}
napi_value unlistedEventProbe(napi_env env, napi_callback_info) {
  WCHAR value[32], name[kPathChars], expected[8]; HANDLE handle = nullptr; ULONG expectedType = 0;
  DWORD count = GetEnvironmentVariableW(L"CC_WINDOWS_UNLISTED_EVENT_HANDLE_V3", value, 32);
  DWORD chars = GetEnvironmentVariableW(L"CC_WINDOWS_UNLISTED_EVENT_NAME_V3", name, kPathChars);
  DWORD typeChars = GetEnvironmentVariableW(L"CC_WINDOWS_UNLISTED_EVENT_TYPE_V3", expected, 8);
  if (state != 2 || !count || count >= 32 || !chars || chars >= kPathChars || !parseHandle(value, handle) ||
      !typeChars || typeChars >= 8 || !parseTypeIndex(expected, expectedType)) {
    api.napi_throw_error(env, "ADAPTER_TRAP", "Missing bounded parent Event trap identity"); return nullptr;
  }
  // Strict handle checking terminates on invalid-handle queries. Enumerate the
  // current process handle snapshot instead of touching a possibly absent
  // numeric value. The type index is sampled atomically with the value. A
  // different kernel object type cannot be the parent's still-live Event;
  // the same Event type remains unsupported without touching that handle.
  bool present = false; ULONG type = 0; ULONG_PTR handleCount = 0;
  if (!snapshotHandleType(handle, present, type, handleCount)) {
    api.napi_throw_error(env, "ADAPTER_TRAP", "Bounded own-process handle snapshot failed"); return nullptr;
  }
  if (!excludesEvent(present, type, expectedType)) {
    api.napi_throw_error(env, "ADAPTER_TRAP", "Parent Event handle value has the same Event type; exclusion is unproven"); return nullptr;
  }
  char escaped[32768], json[33000];
  if (!jsonPath(name, escaped, sizeof(escaped))) {
    api.napi_throw_error(env, "ADAPTER_TRAP", "Unlisted handle probe failed unexpectedly"); return nullptr;
  }
  char actualType[16];
  if (present) snprintf(actualType, sizeof(actualType), "%lu", type);
  else memcpy(actualType, "null", 5);
  snprintf(json, sizeof(json), "{\"handle\":\"%llx\",\"objectName\":\"%s\",\"present\":%s,\"typeIndex\":%s,\"expectedTypeIndex\":%lu,\"inherited\":false,\"method\":\"own-process-handle-snapshot\",\"handleCount\":%llu}",
      static_cast<unsigned long long>(reinterpret_cast<uintptr_t>(handle)), escaped,
      present ? "true" : "false", actualType, expectedType,
      static_cast<unsigned long long>(handleCount));
  napi_value result;
  if (api.napi_create_string_utf8(env, json, NAPI_AUTO_LENGTH, &result) != napi_ok) return nullptr;
  return result;
}
napi_value unlistedEventEnd(napi_env env, napi_callback_info) {
  DWORD flags = 0;
  bool valid = unlistedEvent && GetHandleInformation(unlistedEvent, &flags) && (flags & HANDLE_FLAG_INHERIT) &&
      objectString(unlistedEvent, 2, L"Event") && objectString(unlistedEvent, 1, unlistedEventName);
  bool present = false; ULONG actualType = 0; ULONG_PTR handleCount = 0;
  valid = valid && snapshotHandleType(unlistedEvent, present, actualType, handleCount) && present &&
      actualType == unlistedEventType;
  if (!valid || !CloseHandle(unlistedEvent)) {
    api.napi_throw_error(env, "ADAPTER_TRAP", "Parent Event trap was not retained until child settlement"); return nullptr;
  }
  unlistedEvent = nullptr;
  napi_value result;
  if (api.napi_create_string_utf8(env, "{\"sameObjectRetained\":true,\"closed\":true}", NAPI_AUTO_LENGTH, &result) != napi_ok) return nullptr;
  return result;
}
napi_value unknownHandleCallback(napi_env env, napi_callback_info) {
  if (state != 2 || !unknownHandleNegative()) {
    api.napi_throw_error(env, "ADAPTER_NEGATIVE", "Unknown inheritable event handle was not rejected"); return nullptr;
  }
  return snapshot(env);
}

napi_value protocolNegativeCallback(napi_env env, napi_callback_info) {
 if(state!=2||brokerActor.role!=1||brokerSequence){api.napi_throw_error(env,"ADAPTER_NEGATIVE","Fresh registered root required");return nullptr;}
 PrivateV4Request request={};request.magic=kPrivateV4Magic;request.version=2;request.bytes=sizeof(request);request.operation=0xffff;request.sequence=1;
 PrivateV4Response response={};AcquireSRWLockExclusive(&brokerLock);bool accepted=brokerTransfer(&request,sizeof(request),&response,sizeof(response));ReleaseSRWLockExclusive(&brokerLock);
 api.napi_throw_error(env,"ADAPTER_NEGATIVE",accepted?"Invalid operation unexpectedly replied":"Broker closed invalid operation");return nullptr;
}

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

#ifdef CC_RUNTIME_ADAPTER_SELF_TEST
int main() { return runSelfTest(); }
#endif

extern "C" __declspec(dllexport) int32_t NAPI_CDECL node_api_module_get_api_version_v1() { return 8; }
extern "C" __declspec(dllexport) napi_value NAPI_CDECL napi_register_module_v1(napi_env env, napi_value exports) {
  HMODULE node = GetModuleHandleW(nullptr);
#define RESOLVE(name) api.name = reinterpret_cast<decltype(api.name)>(GetProcAddress(node, #name)); if (!api.name) return nullptr;
  NAPI_SYMBOLS(RESOLVE)
#undef RESOLVE
  napi_value fn;
  if (api.napi_create_function(env, "probeReparse", NAPI_AUTO_LENGTH, probeReparseCallback, nullptr, &fn) != napi_ok ||
      api.napi_set_named_property(env, exports, "probeReparse", fn) != napi_ok) return nullptr;
  if (api.napi_create_function(env, "install", NAPI_AUTO_LENGTH, installCallback, nullptr, &fn) != napi_ok ||
      api.napi_set_named_property(env, exports, "install", fn) != napi_ok ||
      api.napi_create_function(env, "snapshot", NAPI_AUTO_LENGTH, snapshotCallback, nullptr, &fn) != napi_ok ||
      api.napi_set_named_property(env, exports, "snapshot", fn) != napi_ok) return nullptr;
  if (api.napi_create_function(env, "unknownHandleNegative", NAPI_AUTO_LENGTH, unknownHandleCallback, nullptr, &fn) != napi_ok ||
      api.napi_set_named_property(env, exports, "unknownHandleNegative", fn) != napi_ok) return nullptr;
  if (api.napi_create_function(env, "unlistedEventBegin", NAPI_AUTO_LENGTH, unlistedEventBegin, nullptr, &fn) != napi_ok ||
      api.napi_set_named_property(env, exports, "unlistedEventBegin", fn) != napi_ok ||
      api.napi_create_function(env, "unlistedEventProbe", NAPI_AUTO_LENGTH, unlistedEventProbe, nullptr, &fn) != napi_ok ||
      api.napi_set_named_property(env, exports, "unlistedEventProbe", fn) != napi_ok ||
      api.napi_create_function(env, "unlistedEventEnd", NAPI_AUTO_LENGTH, unlistedEventEnd, nullptr, &fn) != napi_ok ||
      api.napi_set_named_property(env, exports, "unlistedEventEnd", fn) != napi_ok) return nullptr;
  if(api.napi_create_function(env,"inspectPrivateIdentity",NAPI_AUTO_LENGTH,privateIdentityCallback,nullptr,&fn)!=napi_ok||api.napi_set_named_property(env,exports,"inspectPrivateIdentity",fn)!=napi_ok)return nullptr;
  if(api.napi_create_function(env,"protocolNegative",NAPI_AUTO_LENGTH,protocolNegativeCallback,nullptr,&fn)!=napi_ok||api.napi_set_named_property(env,exports,"protocolNegative",fn)!=napi_ok)return nullptr;
  return exports;
}
