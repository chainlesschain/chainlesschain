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

#include "windows-node-private-v4-protocol.h"
HANDLE brokerRequest=nullptr,brokerReply=nullptr;
SRWLOCK brokerLock=SRWLOCK_INIT;
uint64_t brokerSequence=0;
using TerminateFn=BOOL(WINAPI*)(HANDLE,UINT);TerminateFn originalTerminate=nullptr;void** terminateSlot=nullptr;DWORD terminateProtection=0;
using CompareHandlesFn=BOOL(WINAPI*)(HANDLE,HANDLE);CompareHandlesFn compareHandles=nullptr;
struct IssuedProcess {HANDLE borrowed,pinned;uint64_t sequence;};std::vector<IssuedProcess> issuedProcesses;
PrivateV4Registration brokerActor={};
bool brokerTransfer(const void* data,DWORD bytes,void* result,DWORD resultBytes){
 DWORD written=0,read=0;
 return WriteFile(brokerRequest,data,bytes,&written,nullptr)&&written==bytes&&ReadFile(brokerReply,result,resultBytes,&read,nullptr)&&read==resultBytes;
}
bool uuidWire(const char* text){
 if(text[36])return false;for(unsigned i=0;i<36;i++){if(i==8||i==13||i==18||i==23){if(text[i]!='-')return false;}else if(!((text[i]>='0'&&text[i]<='9')||(text[i]>='a'&&text[i]<='f')))return false;}return true;
}
bool initializeBroker(){
 installStage="private-broker-registration";compareHandles=reinterpret_cast<CompareHandlesFn>(GetProcAddress(GetModuleHandleW(L"kernelbase.dll"),"CompareObjectHandles"));if(!compareHandles)return false;
 WCHAR request[32]={},reply[32]={};HANDLE inheritedRequest=nullptr,inheritedReply=nullptr;
 DWORD requestChars=GetEnvironmentVariableW(L"CC_PRIVATE_V4_REQUEST",request,32),replyChars=GetEnvironmentVariableW(L"CC_PRIVATE_V4_REPLY",reply,32);
 if(!requestChars||requestChars>=32||!replyChars||replyChars>=32||!parseHandle(request,inheritedRequest)||!parseHandle(reply,inheritedReply)||inheritedRequest==inheritedReply||GetFileType(inheritedRequest)!=FILE_TYPE_PIPE||GetFileType(inheritedReply)!=FILE_TYPE_PIPE)return false;
 if(!DuplicateHandle(GetCurrentProcess(),inheritedRequest,GetCurrentProcess(),&brokerRequest,0,FALSE,DUPLICATE_SAME_ACCESS)||!DuplicateHandle(GetCurrentProcess(),inheritedReply,GetCurrentProcess(),&brokerReply,0,FALSE,DUPLICATE_SAME_ACCESS))return false;
 if(!CloseHandle(inheritedRequest)||!CloseHandle(inheritedReply)||!SetEnvironmentVariableW(L"CC_PRIVATE_V4_REQUEST",nullptr)||!SetEnvironmentVariableW(L"CC_PRIVATE_V4_REPLY",nullptr))return false;
 PrivateV4Request registration={};registration.magic=kPrivateV4Magic;registration.version=2;registration.bytes=sizeof(registration);
 if(!brokerTransfer(&registration,sizeof(registration),&brokerActor,sizeof(brokerActor)))return false;
 return brokerActor.magic==kPrivateV4Magic&&brokerActor.version==2&&brokerActor.bytes==sizeof(brokerActor)&&brokerActor.processId==GetCurrentProcessId()&&
   (brokerActor.role==1||brokerActor.role==2||brokerActor.role==3)&&uuidWire(brokerActor.registrationId)&&uuidWire(brokerActor.sessionId)&&uuidWire(brokerActor.generation)&&
   (brokerActor.role==1?brokerActor.parentRegistrationId[0]==0:uuidWire(brokerActor.parentRegistrationId))&&brokerActor.appContainerSid[191]==0&&!strcmp(brokerActor.appContainerSid,targetSid);
}

BOOL WINAPI terminateHook(HANDLE process,UINT exitCode){
 AcquireSRWLockExclusive(&brokerLock);const IssuedProcess* issued=nullptr;for(auto it=issuedProcesses.rbegin();it!=issuedProcesses.rend();++it)if(it->borrowed==process&&compareHandles(process,it->pinned)){issued=&*it;break;}
 if(!issued){ReleaseSRWLockExclusive(&brokerLock);return originalTerminate(process,exitCode);}if(exitCode!=1){ReleaseSRWLockExclusive(&brokerLock);SetLastError(ERROR_NOT_SUPPORTED);return FALSE;}
 PrivateV4Request request={};request.magic=kPrivateV4Magic;request.version=2;request.bytes=sizeof(request);request.operation=4;request.sequence=++brokerSequence;request.standardHandles[0]=issued->sequence;request.standardHandles[1]=exitCode;request.standardHandles[2]=reinterpret_cast<uintptr_t>(process);
 PrivateV4Response response={};bool ok=brokerTransfer(&request,sizeof(request),&response,sizeof(response));ReleaseSRWLockExclusive(&brokerLock);
 ok=ok&&response.magic==kPrivateV4Magic&&response.version==2&&response.bytes==sizeof(response)&&response.sequence==request.sequence&&!response.error&&!response.processHandle&&!response.threadHandle&&response.processId&&!response.threadId&&!response.reserved[0]&&!response.reserved[1];SetLastError(ok?0:ERROR_ACCESS_DENIED);return ok?TRUE:FALSE;
}

BOOL WINAPI processHook(LPCWSTR application, LPWSTR command, LPSECURITY_ATTRIBUTES processAttributes,
    LPSECURITY_ATTRIBUTES threadAttributes, BOOL inherit, DWORD flags, LPVOID environment,
    LPCWSTR directory, LPSTARTUPINFOW startup, LPPROCESS_INFORMATION information) {
 InterlockedIncrement64(&launches);auto refuse=[](){InterlockedIncrement64(&launchRejected);InterlockedExchange(&launchError,ERROR_NOT_SUPPORTED);SetLastError(ERROR_NOT_SUPPORTED);return FALSE;};
 launchStage="private-launch-shape";
 if(!application||!command||!information||processAttributes||threadAttributes||inherit!=TRUE||!(flags&CREATE_UNICODE_ENVIRONMENT)||(flags&~(CREATE_UNICODE_ENVIRONMENT|CREATE_NO_WINDOW))||!directory||!brokerRequest||!brokerActor.processId)return refuse();
 const WCHAR* service=L"X:\\workspace\\tree\\node_modules\\@esbuild\\win32-x64\\esbuild.exe";std::wstring servicePhysical=rootDos;servicePhysical+=L"\\workspace\\tree\\node_modules\\@esbuild\\win32-x64\\esbuild.exe";
 std::wstring nodePhysical=rootDos;nodePhysical+=L"\\control\\node.exe";
 bool leaf=!wcscmp(application,service)||servicePhysical==application;
 bool worker=!wcscmp(application,L"X:\\control\\node.exe")||nodePhysical==application;
 bool helper=false;if(worker){int argc=0;LPWSTR* args=CommandLineToArgvW(command,&argc);helper=args&&argc==3&&!wcscmp(args[0],application)&&!wcscmp(args[1],L"-p")&&!wcscmp(args[2],L"const r=require('node:process').report;r.excludeNetwork=true;console.log(JSON.stringify(r.getReport().header));");if(args)LocalFree(args);}
 if(brokerActor.role==3||(!leaf&&!worker))return refuse();if(worker&&!helper&&brokerActor.role!=1)return refuse();
 if(leaf){int argc=0;LPWSTR* args=CommandLineToArgvW(command,&argc);bool okay=args&&argc==3&&!wcscmp(args[0],application)&&!wcscmp(args[1],L"--service=0.28.1")&&!wcscmp(args[2],L"--ping");if(args)LocalFree(args);if(!okay)return refuse();}
 launchStage="private-launch-stdio";std::vector<HANDLE> handles;
 if(!parseStdio(startup,handles)){launchStage="private-launch-stdio-parse";return refuse();}uint32_t descriptorCount=0;memcpy(&descriptorCount,startup->lpReserved2,4);if(descriptorCount!=(worker&&!helper?4u:3u)){launchStage="private-launch-stdio-count";return refuse();}
 PrivateV4Request request={};request.magic=kPrivateV4Magic;request.version=2;request.operation=helper?3:worker?2:1;request.descriptorCount=descriptorCount;
 OwnedHandles copies;
 for(unsigned i=0;i<descriptorCount;i++){HANDLE original=nullptr;memcpy(&original,startup->lpReserved2+4+descriptorCount+i*sizeof(HANDLE),sizeof(original));HANDLE copy=copies.copy(original,TRUE);if(!copy||!validStdioHandle(copy,startup->lpReserved2[4+i])||!SetHandleInformation(copy,HANDLE_FLAG_INHERIT,0))return refuse();request.standardHandles[i]=reinterpret_cast<uintptr_t>(copy);request.descriptorFlags[i]=startup->lpReserved2[4+i];}
 std::vector<BYTE> frame(sizeof(request));
 if(worker){
  if(!environment)return refuse();size_t commandChars=wcsnlen(command,8192),directoryChars=wcsnlen(directory,4096),envChars=0;const WCHAR* env=static_cast<const WCHAR*>(environment);
  while(envChars+1<16384&&(env[envChars]||env[envChars+1]))envChars++;
  if(commandChars==8192||directoryChars==4096||envChars+1>=16384)return refuse();envChars+=2;
  request.commandChars=static_cast<uint32_t>(commandChars+1);request.directoryChars=static_cast<uint32_t>(directoryChars+1);request.environmentChars=static_cast<uint32_t>(envChars);
  for(const auto& part:std::vector<std::pair<const WCHAR*,size_t>>{{command,commandChars+1},{directory,directoryChars+1},{env,envChars}}){const BYTE* begin=reinterpret_cast<const BYTE*>(part.first);frame.insert(frame.end(),begin,begin+part.second*sizeof(WCHAR));}
 }
 if(frame.size()>kPrivateV4MaxFrame)return refuse();request.bytes=static_cast<uint32_t>(frame.size());
 launchStage="private-launch-broker";AcquireSRWLockExclusive(&brokerLock);request.sequence=++brokerSequence;memcpy(frame.data(),&request,sizeof(request));PrivateV4Response response={};bool ok=brokerTransfer(frame.data(),request.bytes,&response,sizeof(response));ReleaseSRWLockExclusive(&brokerLock);
 if(!ok||response.magic!=kPrivateV4Magic||response.version!=2||response.bytes!=sizeof(response)||response.sequence!=request.sequence||response.error||response.reserved[0]||response.reserved[1]||!response.processHandle||!response.threadHandle||!response.processId||!response.threadId)return refuse();
 HANDLE pinned=nullptr;if(!DuplicateHandle(GetCurrentProcess(),reinterpret_cast<HANDLE>(response.processHandle),GetCurrentProcess(),&pinned,0,FALSE,DUPLICATE_SAME_ACCESS))return refuse();AcquireSRWLockExclusive(&brokerLock);issuedProcesses.push_back({reinterpret_cast<HANDLE>(response.processHandle),pinned,request.sequence});ReleaseSRWLockExclusive(&brokerLock);
 information->hProcess=reinterpret_cast<HANDLE>(response.processHandle);information->hThread=reinterpret_cast<HANDLE>(response.threadHandle);information->dwProcessId=response.processId;information->dwThreadId=response.threadId;InterlockedIncrement64(&launched);InterlockedExchange(&launchError,0);launchStage=worker?"host-created-private-worker":"host-created-private-service";SetLastError(0);return TRUE;
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
