// Included only by the experimental v3 adapter. No ambient/device substitute.
#include <algorithm>
#include <string>
#include <vector>

using FileWFn = HANDLE(WINAPI*)(LPCWSTR, DWORD, DWORD, LPSECURITY_ATTRIBUTES, DWORD, DWORD, HANDLE);
using ProcessFn = BOOL(WINAPI*)(LPCWSTR, LPWSTR, LPSECURITY_ATTRIBUTES, LPSECURITY_ATTRIBUTES,
    BOOL, DWORD, LPVOID, LPCWSTR, LPSTARTUPINFOW, LPPROCESS_INFORMATION);
FileWFn originalFileW = nullptr;
ProcessFn originalProcess = nullptr;
void** fileWSlot = nullptr;
void** processSlot = nullptr;
DWORD fileWProtection = 0, processProtection = 0;
constexpr DWORD kNullRead = 0x120089, kNullWrite = 0x120196;
constexpr WCHAR kReadEnv[] = L"CC_WINDOWS_NULL_READ_V3";
constexpr WCHAR kWriteEnv[] = L"CC_WINDOWS_NULL_WRITE_V3";
HANDLE nullRead = nullptr, nullWrite = nullptr;
volatile LONG64 nullFallbacks = 0, nullMapped = 0, nullRejected = 0;
volatile LONG64 launches = 0, launchRejected = 0, launched = 0;
volatile LONG launchError = 0;
const char* launchStage = "fresh";
struct NativeString { USHORT length, maximum; PWSTR buffer; };
struct NativeIoStatus { union { LONG status; PVOID pointer; }; ULONG_PTR information; };
using QueryObjectFn = LONG(NTAPI*)(HANDLE, ULONG, PVOID, ULONG, PULONG);
using QueryFileFn = LONG(NTAPI*)(HANDLE, NativeIoStatus*, PVOID, ULONG, ULONG);

bool objectString(HANDLE handle, ULONG kind, const WCHAR* expected) {
  auto query = reinterpret_cast<QueryObjectFn>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "NtQueryObject"));
  alignas(void*) BYTE bytes[4096] = {};
  ULONG used = 0;
  if (!query || query(handle, kind, bytes, sizeof(bytes), &used) != 0 || used > sizeof(bytes)) return false;
  auto* value = reinterpret_cast<NativeString*>(bytes);
  uintptr_t offset = reinterpret_cast<uintptr_t>(value->buffer) - reinterpret_cast<uintptr_t>(bytes);
  size_t expectedBytes = wcslen(expected) * sizeof(WCHAR);
  return value->length == expectedBytes && value->maximum >= value->length &&
      offset >= sizeof(NativeString) && offset <= sizeof(bytes) &&
      value->maximum <= sizeof(bytes) - offset && !memcmp(value->buffer, expected, expectedBytes);
}
bool nullObject(HANDLE handle, DWORD access) {
  if (!handle || handle == INVALID_HANDLE_VALUE || GetFileType(handle) != FILE_TYPE_CHAR) return false;
  auto query = reinterpret_cast<QueryObjectFn>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "NtQueryObject"));
  auto queryFile = reinterpret_cast<QueryFileFn>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "NtQueryInformationFile"));
  alignas(void*) BYTE basic[56] = {};
  ULONG used = 0;
  DWORD granted = 0, mode = 0;
  NativeIoStatus status = {};
  if (!query || !queryFile || query(handle, 0, basic, sizeof(basic), &used) != 0 || used < 8 || used > sizeof(basic)) return false;
  memcpy(&granted, basic + 4, sizeof(granted));
  return granted == access && objectString(handle, 1, L"\\Device\\Null") &&
      objectString(handle, 2, L"File") && queryFile(handle, &status, &mode, sizeof(mode), 16) == 0 && mode == 0x20;
}
struct OwnedHandles {
  std::vector<HANDLE> values;
  ~OwnedHandles() { DWORD error = GetLastError(); for (HANDLE handle : values) CloseHandle(handle); SetLastError(error); }
  HANDLE copy(HANDLE source, BOOL inheritable) {
    HANDLE result = nullptr;
    if (!DuplicateHandle(GetCurrentProcess(), source, GetCurrentProcess(), &result, 0, inheritable, DUPLICATE_SAME_ACCESS)) return nullptr;
    values.push_back(result); return result;
  }
};
bool parseHandle(const WCHAR* text, HANDLE& handle) {
  if (!text || !*text || *text == L'0') return false;
  uintptr_t value = 0; size_t count = 0;
  for (; *text; ++text) {
    unsigned digit = *text >= L'0' && *text <= L'9' ? *text - L'0' :
        (*text >= L'a' && *text <= L'f' ? *text - L'a' + 10 : 16);
    if (digit > 15 || ++count > sizeof(uintptr_t) * 2 || value > (UINTPTR_MAX - digit) / 16) return false;
    value = value * 16 + digit;
  }
  if (!value || value >= UINTPTR_MAX - 2) return false;
  handle = reinterpret_cast<HANDLE>(value); return true;
}
bool initializeNull() {
  installStage = "null-pair-attestation";
  WCHAR readText[32], writeText[32]; HANDLE input = nullptr, output = nullptr;
  DWORD readChars = GetEnvironmentVariableW(kReadEnv, readText, 32);
  DWORD writeChars = GetEnvironmentVariableW(kWriteEnv, writeText, 32);
  if (!readChars || readChars >= 32 || !writeChars || writeChars >= 32 ||
      !parseHandle(readText, input) || !parseHandle(writeText, output) || input == output) return false;
  // Take independent copies first and attest the copies, avoiding a stale value
  // proving an object different from the one we actually retain.
  OwnedHandles copies;
  HANDLE readCopy = copies.copy(input, FALSE), writeCopy = copies.copy(output, FALSE);
  if (!readCopy || !writeCopy || !nullObject(readCopy, kNullRead) || !nullObject(writeCopy, kNullWrite)) return false;
  DWORD readFlags = 0, writeFlags = 0;
  if (!GetHandleInformation(readCopy, &readFlags) || !GetHandleInformation(writeCopy, &writeFlags) ||
      (readFlags & HANDLE_FLAG_INHERIT) || (writeFlags & HANDLE_FLAG_INHERIT)) return false;
  if (!CloseHandle(input) || !CloseHandle(output)) return false;
  if (!SetEnvironmentVariableW(kReadEnv, nullptr) || !SetEnvironmentVariableW(kWriteEnv, nullptr)) return false;
  nullRead = readCopy; nullWrite = writeCopy; copies.values.clear(); return true;
}
bool exactNullCall(LPCWSTR name, DWORD access, DWORD share, LPSECURITY_ATTRIBUTES sa,
    DWORD disposition, DWORD flags, HANDLE templ) {
  return name && !wcscmp(name, L"NUL") && (access == kNullRead || access == kNullWrite) &&
      share == (FILE_SHARE_READ | FILE_SHARE_WRITE) && sa && sa->nLength == sizeof(*sa) &&
      sa->lpSecurityDescriptor == nullptr && sa->bInheritHandle == TRUE &&
      disposition == OPEN_EXISTING && flags == 0 && templ == nullptr;
}
HANDLE WINAPI nullFileHook(LPCWSTR name, DWORD access, DWORD share, LPSECURITY_ATTRIBUTES sa,
    DWORD disposition, DWORD flags, HANDLE templ) {
  HANDLE result = originalFileW(name, access, share, sa, disposition, flags, templ);
  DWORD error = GetLastError();
  if (result != INVALID_HANDLE_VALUE || error != ERROR_ACCESS_DENIED ||
      !exactNullCall(name, access, share, sa, disposition, flags, templ)) { SetLastError(error); return result; }
  InterlockedIncrement64(&nullFallbacks);
  OwnedHandles copies;
  HANDLE duplicate = copies.copy(access == kNullRead ? nullRead : nullWrite, TRUE);
  if (!duplicate || !nullObject(duplicate, access)) {
    InterlockedIncrement64(&nullRejected); SetLastError(error); return INVALID_HANDLE_VALUE;
  }
  copies.values.clear(); InterlockedIncrement64(&nullMapped); SetLastError(ERROR_SUCCESS); return duplicate;
}
bool validStdioHandle(HANDLE handle, BYTE flags) {
  if (!flags) return handle == INVALID_HANDLE_VALUE;
  if (!handle || reinterpret_cast<uintptr_t>(handle) >= UINTPTR_MAX - 2) return false;
  DWORD type = GetFileType(handle), inheritance = 0;
  if (!GetHandleInformation(handle, &inheritance) || !(inheritance & HANDLE_FLAG_INHERIT)) return false;
  if (flags == 0x09) return type == FILE_TYPE_PIPE;
  if (flags == 0x01) return type == FILE_TYPE_DISK;
  if (flags == 0x41) return nullObject(handle, kNullRead) || nullObject(handle, kNullWrite);
  return false;
}
bool parseStdio(const STARTUPINFOW* startup, std::vector<HANDLE>& handles) {
  if (!startup || startup->cb != sizeof(STARTUPINFOW) ||
      startup->dwFlags != (STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW) ||
      startup->lpReserved || startup->lpDesktop || startup->lpTitle ||
      // libuv leaves the ignored geometry fields uninitialized. The exact
      // dwFlags above makes them inoperative; our extended copy zeros them.
      (startup->wShowWindow != SW_HIDE && startup->wShowWindow != SW_SHOWDEFAULT) ||
      !startup->lpReserved2 || startup->cbReserved2 < 4) return false;
  uint32_t count = 0; memcpy(&count, startup->lpReserved2, 4);
  if (count < 3 || count > 256 || startup->cbReserved2 != 4 + count * (1 + sizeof(HANDLE))) return false;
  HANDLE standards[] = {startup->hStdInput, startup->hStdOutput, startup->hStdError};
  for (uint32_t index = 0; index < count; ++index) {
    BYTE flags = startup->lpReserved2[4 + index]; HANDLE handle = nullptr;
    memcpy(&handle, startup->lpReserved2 + 4 + count + index * sizeof(HANDLE), sizeof(handle));
    if (!validStdioHandle(handle, flags) || (index < 3 && standards[index] != handle)) return false;
    if (flags && std::find(handles.begin(), handles.end(), handle) == handles.end()) handles.push_back(handle);
  }
  return true;
}
bool childEnvironment(LPVOID source, HANDLE read, HANDLE write, std::vector<WCHAR>& block) {
  if (!source) return false;
  const WCHAR* input = static_cast<const WCHAR*>(source);
  std::vector<std::wstring> entries;
  size_t offset = 0; bool sid = false, options = false;
  WCHAR expectedSid[192], preload[kPathChars], readValue[64], writeValue[64];
  if (!MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, targetSid, -1, expectedSid, 192)) return false;
  swprintf(preload, kPathChars, L"--require=\"%ls/workspace/adapter/windows-node-null-v3-preload.cjs\"", rootDos);
  for (WCHAR* cursor = preload; *cursor; ++cursor) if (*cursor == L'\\') *cursor = L'/';
  swprintf(readValue, 64, L"%ls=%llx", kReadEnv, static_cast<unsigned long long>(reinterpret_cast<uintptr_t>(read)));
  swprintf(writeValue, 64, L"%ls=%llx", kWriteEnv, static_cast<unsigned long long>(reinterpret_cast<uintptr_t>(write)));
  while (offset < 32767 && input[offset]) {
    size_t length = 0;
    while (offset + length < 32767 && input[offset + length]) ++length;
    if (offset + length >= 32767) return false;
    std::wstring entry(input + offset, length); offset += length + 1;
    size_t equals = entry.find(L'=', entry[0] == L'=' ? 1 : 0);
    if (equals == std::wstring::npos || equals == 0) return false;
    std::wstring key = entry.substr(0, equals), value = entry.substr(equals + 1);
    for (const auto& previous : entries) {
      size_t split = previous.find(L'=', previous[0] == L'=' ? 1 : 0);
      if (!_wcsicmp(key.c_str(), previous.substr(0, split).c_str())) return false;
    }
    if (!_wcsicmp(key.c_str(), kReadEnv) || !_wcsicmp(key.c_str(), kWriteEnv)) return false;
    if (!_wcsicmp(key.c_str(), L"CC_WINDOWS_APPCONTAINER_SID")) { if (sid || value != expectedSid) return false; sid = true; }
    if (!_wcsicmp(key.c_str(), L"NODE_OPTIONS")) { if (options || value != preload) return false; options = true; }
    entries.push_back(entry);
  }
  if (offset >= 32767 || !sid || !options) return false;
  entries.emplace_back(readValue); entries.emplace_back(writeValue);
  std::sort(entries.begin(), entries.end(), [](const auto& a, const auto& b) { return _wcsicmp(a.c_str(), b.c_str()) < 0; });
  for (const auto& entry : entries) { block.insert(block.end(), entry.begin(), entry.end()); block.push_back(0); }
  block.push_back(0); return block.size() <= 32767;
}
BOOL WINAPI processHook(LPCWSTR application, LPWSTR command, LPSECURITY_ATTRIBUTES processAttributes,
    LPSECURITY_ATTRIBUTES threadAttributes, BOOL inherit, DWORD flags, LPVOID environment,
    LPCWSTR directory, LPSTARTUPINFOW startup, LPPROCESS_INFORMATION information) {
  InterlockedIncrement64(&launches);
  auto refuse = []() { InterlockedIncrement64(&launchRejected); InterlockedExchange(&launchError, ERROR_NOT_SUPPORTED); SetLastError(ERROR_NOT_SUPPORTED); return FALSE; };
  launchStage = "launch-shape";
  // Unknown extended attributes, token models and breakaway/detached launches
  // are unsupported. No call falls through to broad implicit inheritance.
  if (!application || !command || !information || processAttributes || threadAttributes || inherit != TRUE ||
      !(flags & CREATE_UNICODE_ENVIRONMENT) || (flags & ~(CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW)) || !directory) return refuse();
  WCHAR expected[kPathChars];
  swprintf(expected, kPathChars, L"%ls\\control\\node.exe", rootDos);
  if (wcscmp(application, expected)) return refuse();
  launchStage = "launch-stdio";
  std::vector<HANDLE> handles;
  if (!parseStdio(startup, handles)) return refuse();
  OwnedHandles copies;
  // Pin caller descriptors using per-launch copies and rebuild the unaligned
  // CRT table. The caller keeps all its handles and cleans them up as usual.
  // Validate each copied object, not merely a potentially reused input value.
  std::vector<BYTE> crt(startup->lpReserved2, startup->lpReserved2 + startup->cbReserved2);
  uint32_t descriptorCount = 0; memcpy(&descriptorCount, crt.data(), 4);
  for (auto& original : handles) {
    HANDLE copy = copies.copy(original, TRUE);
    if (!copy) return refuse();
    for (uint32_t index = 0; index < descriptorCount; ++index) {
      BYTE* slot = crt.data() + 4 + descriptorCount + index * sizeof(HANDLE);
      HANDLE value = nullptr; memcpy(&value, slot, sizeof(value));
      if (value != original) continue;
      if (!validStdioHandle(copy, crt[4 + index])) return refuse();
      memcpy(slot, &copy, sizeof(copy));
    }
    original = copy;
  }
  HANDLE childStandards[3];
  memcpy(childStandards, crt.data() + 4 + descriptorCount, sizeof(childStandards));
  HANDLE read = copies.copy(nullRead, TRUE), write = copies.copy(nullWrite, TRUE);
  launchStage = "launch-null-copies";
  if (!read || !write || !nullObject(read, kNullRead) || !nullObject(write, kNullWrite)) return refuse();
  handles.push_back(read); handles.push_back(write);
  launchStage = "launch-environment";
  std::vector<WCHAR> childEnv;
  if (!childEnvironment(environment, read, write, childEnv)) return refuse();
  SIZE_T bytes = 0;
  InitializeProcThreadAttributeList(nullptr, 1, 0, &bytes);
  if (!bytes || bytes > 65536) return refuse();
  std::vector<BYTE> storage(bytes);
  auto* attributes = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(storage.data());
  launchStage = "launch-handle-list";
  if (!InitializeProcThreadAttributeList(attributes, 1, 0, &bytes)) return refuse();
  if (!UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
      handles.data(), handles.size() * sizeof(HANDLE), nullptr, nullptr)) {
    DeleteProcThreadAttributeList(attributes); return refuse();
  }
  STARTUPINFOEXW extended = {};
  extended.StartupInfo.cb = sizeof(extended);
  extended.StartupInfo.dwFlags = startup->dwFlags;
  extended.StartupInfo.wShowWindow = startup->wShowWindow;
  extended.StartupInfo.cbReserved2 = startup->cbReserved2;
  extended.StartupInfo.lpReserved2 = crt.data();
  extended.StartupInfo.hStdInput = childStandards[0];
  extended.StartupInfo.hStdOutput = childStandards[1];
  extended.StartupInfo.hStdError = childStandards[2];
  extended.lpAttributeList = attributes;
  launchStage = "launch-create-process";
  BOOL result = originalProcess(application, command, nullptr, nullptr, TRUE,
      flags | EXTENDED_STARTUPINFO_PRESENT, childEnv.data(), directory, &extended.StartupInfo, information);
  DWORD error = GetLastError();
  DeleteProcThreadAttributeList(attributes);
  if (result) InterlockedIncrement64(&launched);
  InterlockedExchange(&launchError, result ? 0 : static_cast<LONG>(error));
  launchStage = result ? "launched" : "launch-create-process-failed";
  SetLastError(error); return result;
}

bool snapshotHandleType(HANDLE target, bool& present, ULONG& type, ULONG_PTR& handleCount) {
  using QueryProcessFn = LONG(NTAPI*)(HANDLE, ULONG, PVOID, ULONG, PULONG);
  auto query = reinterpret_cast<QueryProcessFn>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "NtQueryInformationProcess"));
  struct Entry { HANDLE value; ULONG_PTR count, pointers; ULONG access, type, attributes, reserved; };
  static_assert(sizeof(Entry) == 40, "Pinned Windows x64 handle snapshot layout");
  // One attempt, fixed 1 MiB allocation. A growing or larger handle table is
  // unsupported; never query a possibly absent/closed handle by numeric value.
  std::vector<BYTE> bytes(1024 * 1024); ULONG used = 0;
  present = false; type = 0; handleCount = 0;
  if (!query || query(GetCurrentProcess(), 51, bytes.data(), static_cast<ULONG>(bytes.size()), &used) != 0 ||
      used < 2 * sizeof(ULONG_PTR) || used > bytes.size()) return false;
  memcpy(&handleCount, bytes.data(), sizeof(handleCount));
  if (handleCount > (used - 2 * sizeof(ULONG_PTR)) / sizeof(Entry)) return false;
  for (ULONG_PTR index = 0; index < handleCount; ++index) {
    Entry entry; memcpy(&entry, bytes.data() + 2 * sizeof(ULONG_PTR) + index * sizeof(Entry), sizeof(entry));
    if (entry.value != target) continue;
    if (present || !entry.type || entry.type > 65535) return false;
    present = true; type = entry.type;
  }
  return true;
}
bool excludesEvent(bool present, ULONG type, ULONG expectedType) {
  return expectedType && expectedType <= 65535 &&
      ((!present && type == 0) || (present && type && type <= 65535 && type != expectedType));
}
bool parseTypeIndex(const WCHAR* value, ULONG& type) {
  type = 0;
  if (!value || *value < L'1' || *value > L'9') return false;
  for (size_t index = 0; value[index]; ++index) {
    if (index >= 5 || value[index] < L'0' || value[index] > L'9') return false;
    type = type * 10 + static_cast<ULONG>(value[index] - L'0');
  }
  return type <= 65535;
}

#ifdef CC_RUNTIME_ADAPTER_SELF_TEST
HANDLE WINAPI denyNull(LPCWSTR, DWORD, DWORD, LPSECURITY_ATTRIBUTES, DWORD, DWORD, HANDLE) {
  SetLastError(ERROR_ACCESS_DENIED); return INVALID_HANDLE_VALUE;
}
int testNullV3() {
  SECURITY_ATTRIBUTES sa = {sizeof(sa), nullptr, TRUE};
  HANDLE read = CreateFileW(L"NUL", kNullRead, 3, &sa, OPEN_EXISTING, 0, nullptr);
  HANDLE write = CreateFileW(L"NUL", kNullWrite, 3, &sa, OPEN_EXISTING, 0, nullptr);
  {
    auto query = reinterpret_cast<QueryObjectFn>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "NtQueryObject"));
    auto queryFile = reinterpret_cast<QueryFileFn>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "NtQueryInformationFile"));
    for (HANDLE h : {read, write}) {
      BYTE bytes[4096] = {}; ULONG used = 0; DWORD access = 0, mode = 0; NativeIoStatus io = {};
      LONG basicStatus = query(h, 0, bytes, 56, &used); memcpy(&access, bytes + 4, 4);
      LONG modeStatus = queryFile(h, &io, &mode, 4, 16);
      LONG nameStatus = query(h, 1, bytes, sizeof(bytes), &used); auto* name = reinterpret_cast<NativeString*>(bytes);
      fprintf(stderr, "Null probe type=%lu basic=%lx access=%lx modeStatus=%lx mode=%lx nameStatus=%lx name=%.*ls nameOkay=%d typeOkay=%d\n", GetFileType(h), static_cast<unsigned long>(basicStatus), access, static_cast<unsigned long>(modeStatus), mode, static_cast<unsigned long>(nameStatus), name->length / 2, name->buffer, objectString(h, 1, L"\\Device\\Null"), objectString(h, 2, L"File"));
    }
  }
  if (!nullObject(read, kNullRead) || !nullObject(write, kNullWrite)) return 110;
  if (nullObject(read, kNullWrite) || nullObject(write, kNullRead) || nullObject(nullptr, kNullRead) ||
      nullObject(INVALID_HANDLE_VALUE, kNullRead)) return 111;
  HANDLE event = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  if (!event || nullObject(event, kNullRead)) return 112;
  bool present = false; ULONG eventType = 0, otherType = 0; ULONG_PTR handleCount = 0;
  if (!snapshotHandleType(event, present, eventType, handleCount) || !present || !eventType ||
      !objectString(event, 2, L"Event") || excludesEvent(present, eventType, eventType)) return 126;
  HANDLE semaphore = CreateSemaphoreW(nullptr, 0, 1, nullptr);
  if (!semaphore || !snapshotHandleType(semaphore, present, otherType, handleCount) ||
      !present || !excludesEvent(present, otherType, eventType)) return 127;
  CloseHandle(semaphore);
  if (!snapshotHandleType(reinterpret_cast<HANDLE>(static_cast<uintptr_t>(0x7ffffffffffffffc)), present, otherType, handleCount) ||
      present || !excludesEvent(present, otherType, eventType) || excludesEvent(true, 0, eventType)) return 128;
  ULONG parsedType = 0;
  for (const WCHAR* bad : {L"", L"0", L"01", L"65536", L"-1", L"1x", L"123456"})
    if (parseTypeIndex(bad, parsedType)) return 129;
  if (!parseTypeIndex(L"65535", parsedType) || parsedType != 65535) return 130;
  CloseHandle(event);
  HANDLE pipeRead = nullptr, pipeWrite = nullptr;
  if (!CreatePipe(&pipeRead, &pipeWrite, &sa, 0) || nullObject(pipeRead, kNullRead)) return 113;
  CloseHandle(pipeRead); CloseHandle(pipeWrite);
  HANDLE excess = CreateFileW(L"NUL", GENERIC_READ | GENERIC_WRITE, 3, &sa, OPEN_EXISTING, 0, nullptr);
  if (excess == INVALID_HANDLE_VALUE || nullObject(excess, kNullRead) || nullObject(excess, kNullWrite)) return 114;
  CloseHandle(excess);
  HANDLE parsed = nullptr;
  for (const WCHAR* bad : {L"", L"0", L"01", L"-1", L"0x1", L"A", L"ffffffffffffffff", L"10000000000000000"})
    if (parseHandle(bad, parsed)) return 115;
  if (!parseHandle(L"abc", parsed) || reinterpret_cast<uintptr_t>(parsed) != 0xabc) return 116;
  if (!exactNullCall(L"NUL", kNullRead, 3, &sa, OPEN_EXISTING, 0, nullptr)) return 117;
  for (const WCHAR* bad : {L"nul", L"NUL:", L"\\\\.\\NUL", L"C:\\NUL", L"NUL "})
    if (exactNullCall(bad, kNullRead, 3, &sa, OPEN_EXISTING, 0, nullptr)) return 118;
  if (exactNullCall(L"NUL", GENERIC_READ, 3, &sa, OPEN_EXISTING, 0, nullptr) ||
      exactNullCall(L"NUL", kNullRead, 7, &sa, OPEN_EXISTING, 0, nullptr) ||
      exactNullCall(L"NUL", kNullRead, 3, nullptr, OPEN_EXISTING, 0, nullptr) ||
      exactNullCall(L"NUL", kNullRead, 3, &sa, OPEN_EXISTING, FILE_FLAG_OVERLAPPED, nullptr)) return 119;
  nullRead = read; nullWrite = write; originalFileW = denyNull;
  HANDLE mappedRead = nullFileHook(L"NUL", kNullRead, 3, &sa, OPEN_EXISTING, 0, nullptr);
  HANDLE mappedWrite = nullFileHook(L"NUL", kNullWrite, 3, &sa, OPEN_EXISTING, 0, nullptr);
  char input[97] = {}; DWORD received = 99, written = 0;
  if (mappedRead == INVALID_HANDLE_VALUE || mappedWrite == INVALID_HANDLE_VALUE ||
      !ReadFile(mappedRead, input, sizeof(input), &received, nullptr) || received != 0 ||
      !WriteFile(mappedWrite, input, sizeof(input), &written, nullptr) || written != sizeof(input)) return 120;
  CloseHandle(mappedRead); CloseHandle(mappedWrite);
  if (nullFileHook(L"nul", kNullRead, 3, &sa, OPEN_EXISTING, 0, nullptr) != INVALID_HANDLE_VALUE || nullMapped != 2) return 121;
  BYTE table[4 + 3 + 3 * sizeof(HANDLE)] = {}; uint32_t count = 3;
  memcpy(table, &count, 4); table[4] = table[5] = table[6] = 0x41;
  HANDLE stdio[] = {read, write, write};
  memcpy(table + 7, stdio, sizeof(stdio));
  STARTUPINFOW startup = {}; startup.cb = sizeof(startup);
  startup.dwFlags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
  startup.hStdInput = read; startup.hStdOutput = startup.hStdError = write;
  startup.lpReserved2 = table; startup.cbReserved2 = sizeof(table);
  std::vector<HANDLE> handles;
  if (!parseStdio(&startup, handles) || handles.size() != 2) return 122;
  startup.cb = sizeof(STARTUPINFOEXW); handles.clear();
  if (parseStdio(&startup, handles)) return 123;
  startup.cb = sizeof(startup); table[4] = 0xff;
  if (parseStdio(&startup, handles)) return 124;
  table[4] = 0x41;
  PROCESS_INFORMATION information = {}; WCHAR command[] = L"node.exe";
  if (processHook(L"C:\\wrong.exe", command, nullptr, nullptr, TRUE, CREATE_BREAKAWAY_FROM_JOB | CREATE_UNICODE_ENVIRONMENT,
      nullptr, L"C:\\", &startup, &information) || GetLastError() != ERROR_NOT_SUPPORTED) return 125;
  CloseHandle(read); CloseHandle(write); nullRead = nullWrite = nullptr;
  fprintf(stdout, "{\"nullObjectAccessMode\":true,\"wrongRightsAndTypesRejected\":true,\"exactNullMapping\":true,\"eofAndFullWrite\":true,\"crtShapeNegatives\":true,\"breakawayRejected\":true,\"boundedSnapshotTypes\":true,\"sameEventTypeNotExcluded\":true,\"missingOrDifferentTypeExcluded\":true}\n");
  return 0;
}
#endif

// Runs only when explicitly called by the experimental diagnostic. The event
// is a real inheritable non-file handle, deliberately misrepresented in the
// CRT table. Rejection must occur before CreateProcess and cannot create a PID.
bool unknownHandleNegative() {
  SECURITY_ATTRIBUTES sa = {sizeof(sa), nullptr, TRUE};
  HANDLE event = CreateEventW(&sa, FALSE, FALSE, nullptr);
  if (!event) return false;
  OwnedHandles owned; owned.values.push_back(event);
  BYTE table[4 + 3 + 3 * sizeof(HANDLE)] = {}; uint32_t count = 3;
  memcpy(table, &count, 4); table[4] = table[5] = table[6] = 0x01;
  HANDLE handles[] = {event, event, event}; memcpy(table + 7, handles, sizeof(handles));
  STARTUPINFOW startup = {}; startup.cb = sizeof(startup);
  startup.dwFlags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
  startup.hStdInput = startup.hStdOutput = startup.hStdError = event;
  startup.lpReserved2 = table; startup.cbReserved2 = sizeof(table);
  WCHAR application[kPathChars], command[] = L"unsupported-event-stdio";
  swprintf(application, kPathChars, L"%ls\\control\\node.exe", rootDos);
  PROCESS_INFORMATION info = {};
  LONG64 before = InterlockedCompareExchange64(&launched, 0, 0);
  BOOL result = processHook(application, command, nullptr, nullptr, TRUE, CREATE_UNICODE_ENVIRONMENT,
      nullptr, rootDos, &startup, &info);
  return !result && GetLastError() == ERROR_NOT_SUPPORTED && !info.hProcess && !info.hThread && !info.dwProcessId &&
      launched == before && !strcmp(launchStage, "launch-stdio");
}
