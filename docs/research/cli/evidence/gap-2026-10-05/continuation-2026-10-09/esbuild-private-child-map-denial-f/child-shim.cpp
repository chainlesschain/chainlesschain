// Independent private-map bootstrap for frozen esbuild. Preserves actual API results.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <sddl.h>
#include <winternl.h>
#include <cstdio>
#include <cstring>
#include <cwchar>
#include <cstdint>

using ProcFn = FARPROC(WINAPI*)(HMODULE,LPCSTR);
using FileFn = HANDLE(WINAPI*)(LPCWSTR,DWORD,DWORD,LPSECURITY_ATTRIBUTES,DWORD,DWORD,HANDLE);
using FindFn = HANDLE(WINAPI*)(LPCWSTR,LPWIN32_FIND_DATAW);
using FindExFn = HANDLE(WINAPI*)(LPCWSTR,FINDEX_INFO_LEVELS,LPVOID,FINDEX_SEARCH_OPS,LPVOID,DWORD);
using InfoFn = BOOL(WINAPI*)(HANDLE,FILE_INFO_BY_HANDLE_CLASS,LPVOID,DWORD);
static ProcFn originalProc=nullptr;
static FileFn originalFile=nullptr;
static FindFn originalFind=nullptr;
static FindExFn originalFindEx=nullptr;
static InfoFn originalInfo=nullptr;
static HANDLE trace=nullptr;
static volatile LONG sequence=0, overflow=0;
static DWORD patches=0;
static bool installed=false;
static void record(const char* api,const WCHAR* requested,BOOL success,DWORD error,DWORD kind=0) {
  DWORD saved=GetLastError();
  LONG index=InterlockedIncrement(&sequence);
  if(index>512){InterlockedExchange(&overflow,1);SetLastError(saved);return;}
  char raw[4096]={},escaped[8192]={},line[9216]={};
  if(requested && !WideCharToMultiByte(CP_UTF8,WC_ERR_INVALID_CHARS,requested,-1,raw,sizeof(raw),nullptr,nullptr)) {
    InterlockedExchange(&overflow,1);SetLastError(saved);return;
  }
  size_t offset=0;
  for(const unsigned char* p=reinterpret_cast<const unsigned char*>(raw);*p;p++){
    if(*p<32 || offset+3>=sizeof(escaped)){InterlockedExchange(&overflow,1);SetLastError(saved);return;}
    if(*p=='\\'||*p=='"')escaped[offset++]='\\';
    escaped[offset++]=static_cast<char>(*p);
  }
  int count=std::snprintf(line,sizeof(line),
    "{\"sequence\":%ld,\"pid\":%lu,\"api\":\"%s\",\"requestedPath\":\"%s\",\"success\":%s,\"error\":%lu,\"kind\":%lu,\"patches\":%lu,\"overflow\":%ld}\n",
    index,GetCurrentProcessId(),api,escaped,success?"true":"false",error,kind,patches,InterlockedCompareExchange(&overflow,0,0));
  DWORD written=0;
  if(count<1||static_cast<size_t>(count)>=sizeof(line)||!WriteFile(trace,line,static_cast<DWORD>(count),&written,nullptr)||written!=static_cast<DWORD>(count))
    InterlockedExchange(&overflow,1);
  SetLastError(saved);
}
static HANDLE WINAPI tracedFile(LPCWSTR name,DWORD access,DWORD share,LPSECURITY_ATTRIBUTES sa,DWORD disposition,DWORD flags,HANDLE templ) {
  HANDLE result=originalFile(name,access,share,sa,disposition,flags,templ);DWORD error=GetLastError();
  record("CreateFileW",name,result!=INVALID_HANDLE_VALUE,error,access);SetLastError(error);return result;
}
static HANDLE WINAPI tracedFind(LPCWSTR name,LPWIN32_FIND_DATAW data) {
  HANDLE result=originalFind(name,data);DWORD error=GetLastError();
  record("FindFirstFileW",name,result!=INVALID_HANDLE_VALUE,error);SetLastError(error);return result;
}
static HANDLE WINAPI tracedFindEx(LPCWSTR name,FINDEX_INFO_LEVELS level,LPVOID data,FINDEX_SEARCH_OPS search,LPVOID filter,DWORD flags) {
  HANDLE result=originalFindEx(name,level,data,search,filter,flags);DWORD error=GetLastError();
  record("FindFirstFileExW",name,result!=INVALID_HANDLE_VALUE,error,level);SetLastError(error);return result;
}
static BOOL WINAPI tracedInfo(HANDLE handle,FILE_INFO_BY_HANDLE_CLASS kind,LPVOID value,DWORD bytes) {
  BOOL result=originalInfo(handle,kind,value,bytes);DWORD error=GetLastError();
  WCHAR canonical[4096]={};
  DWORD count=GetFinalPathNameByHandleW(handle,canonical,4096,VOLUME_NAME_NT);
  if(!count||count>=4096)canonical[0]=0;
  record("GetFileInformationByHandleEx",canonical,result,error,kind);SetLastError(error);return result;
}
template<class Function> static FARPROC erased(Function fn){static_assert(sizeof(fn)==sizeof(FARPROC),"Windows x64 pointer ABI");FARPROC value=nullptr;memcpy(&value,&fn,sizeof(value));return value;}
static FARPROC WINAPI tracedProc(HMODULE module,LPCSTR name) {
  FARPROC result=originalProc(module,name);DWORD error=GetLastError();
  if(result && reinterpret_cast<uintptr_t>(name)>65535 &&
      (module==GetModuleHandleW(L"kernel32.dll")||module==GetModuleHandleW(L"kernelbase.dll"))){
    if(!strcmp(name,"CreateFileW")){originalFile=reinterpret_cast<FileFn>(result);result=erased(tracedFile);record("resolve:CreateFileW",nullptr,TRUE,0);}
    else if(!strcmp(name,"FindFirstFileW")){originalFind=reinterpret_cast<FindFn>(result);result=erased(tracedFind);record("resolve:FindFirstFileW",nullptr,TRUE,0);}
    else if(!strcmp(name,"FindFirstFileExW")){originalFindEx=reinterpret_cast<FindExFn>(result);result=erased(tracedFindEx);record("resolve:FindFirstFileExW",nullptr,TRUE,0);}
    else if(!strcmp(name,"GetFileInformationByHandleEx")){originalInfo=reinterpret_cast<InfoFn>(result);result=erased(tracedInfo);record("resolve:GetFileInformationByHandleEx",nullptr,TRUE,0);}
  }
  SetLastError(error);return result;
}
static bool identity(){
  WCHAR value[32]={},expected[192]={};DWORD length=GetEnvironmentVariableW(L"CC_ESBUILD_TRACE_HANDLE",value,32);
  if(!length||length>=32||!GetEnvironmentVariableW(L"CC_ESBUILD_TRACE_SID",expected,192))return false;
  uintptr_t raw=0;
  for(DWORD i=0;i<length;i++){unsigned d=value[i]>='0'&&value[i]<='9'?value[i]-'0':value[i]>='a'&&value[i]<='f'?value[i]-'a'+10:16;if(d>15||raw>(UINTPTR_MAX-d)/16)return false;raw=raw*16+d;}
  trace=reinterpret_cast<HANDLE>(raw);
  if(!trace||GetFileType(trace)!=FILE_TYPE_DISK)return false;
  HANDLE token=nullptr;DWORD used=0,isContainer=0;BOOL inJob=FALSE;
  alignas(void*) BYTE sidBytes[256]={},caps[4096]={};
  if(!OpenProcessToken(GetCurrentProcess(),TOKEN_QUERY,&token))return false;
  bool valid=GetTokenInformation(token,TokenIsAppContainer,&isContainer,sizeof(isContainer),&used)&&isContainer==1&&
    GetTokenInformation(token,TokenAppContainerSid,sidBytes,sizeof(sidBytes),&used)&&
    GetTokenInformation(token,TokenCapabilities,caps,sizeof(caps),&used)&&reinterpret_cast<TOKEN_GROUPS*>(caps)->GroupCount==0&&
    IsProcessInJob(GetCurrentProcess(),nullptr,&inJob)&&inJob;
  LPWSTR actual=nullptr;
  if(valid)valid=ConvertSidToStringSidW(reinterpret_cast<TOKEN_APPCONTAINER_INFORMATION*>(sidBytes)->TokenAppContainer,&actual)&&!wcscmp(actual,expected);
  if(actual)LocalFree(actual);CloseHandle(token);return valid;
}
static bool attestInheritedMap(){
  WCHAR text[32]={};DWORD length=GetEnvironmentVariableW(L"CC_ESBUILD_TRACE_MAP_HANDLE",text,32);
  if(!length||length>=32)return false;uintptr_t value=0;
  for(DWORD i=0;i<length;i++){unsigned d=text[i]>='0'&&text[i]<='9'?text[i]-'0':text[i]>='a'&&text[i]<='f'?text[i]-'a'+10:16;if(d>15||value>(UINTPTR_MAX-d)/16)return false;value=value*16+d;}
  HANDLE map=reinterpret_cast<HANDLE>(value);
  using QueryFn=NTSTATUS(NTAPI*)(HANDLE,ULONG,PVOID,ULONG,PULONG);
  auto query=reinterpret_cast<QueryFn>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"),"NtQueryObject"));
  alignas(void*) BYTE basic[56]={};ULONG used=0,access=0;
  if(!query)return false;NTSTATUS basicStatus=query(map,0,basic,sizeof(basic),&used);memcpy(&access,basic+4,4);
  record("device-map-handle-access",nullptr,basicStatus>=0,static_cast<DWORD>(basicStatus),access);
  if(basicStatus<0||used<8)return false;
  if(access!=3)return false;
  CloseHandle(map);record("device-map-supervisor-handle",nullptr,TRUE,0,access);return true;
}
static bool mappedRoot(){
  WCHAR expectedNt[4096]={},expectedId[96]={},actualNt[4096]={},actualId[96]={};
  DWORD expectedChars=GetEnvironmentVariableW(L"CC_ESBUILD_TRACE_ROOT_NT",expectedNt,4096);
  DWORD idChars=GetEnvironmentVariableW(L"CC_ESBUILD_TRACE_ROOT_ID",expectedId,96);
  if(!expectedChars||expectedChars>=4096||!idChars||idChars>=96)return false;
  HANDLE root=CreateFileW(L"X:\\",GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_FLAG_BACKUP_SEMANTICS|FILE_FLAG_OPEN_REPARSE_POINT,nullptr);
  DWORD openError=root==INVALID_HANDLE_VALUE?GetLastError():0;record("inherited-x-root-open",L"X:\\",root!=INVALID_HANDLE_VALUE,openError);SetLastError(openError);if(root==INVALID_HANDLE_VALUE)return false;
  BY_HANDLE_FILE_INFORMATION info={};bool valid=GetFileInformationByHandle(root,&info)&&
    (info.dwFileAttributes&FILE_ATTRIBUTE_DIRECTORY)&&!(info.dwFileAttributes&FILE_ATTRIBUTE_REPARSE_POINT);
  DWORD chars=GetFinalPathNameByHandleW(root,actualNt,4096,VOLUME_NAME_NT);
  swprintf(actualId,96,L"%08lx:%08lx:%08lx",info.dwVolumeSerialNumber,info.nFileIndexHigh,info.nFileIndexLow);
  valid=valid&&chars>0&&chars<4096&&!wcscmp(actualNt,expectedNt)&&!wcscmp(actualId,expectedId);
  CloseHandle(root);if(!valid)return false;
  record("device-map-root-proven",actualNt,TRUE,0);
  record("device-map-file-id-proven",actualId,TRUE,0);
  // These are real negative controls, not replacements for esbuild API results.
  HANDLE host=CreateFileW(L"C:\\",GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_FLAG_BACKUP_SEMANTICS,nullptr);
  DWORD hostError=GetLastError();bool hostDenied=host==INVALID_HANDLE_VALUE&&hostError==ERROR_ACCESS_DENIED;
  if(host!=INVALID_HANDLE_VALUE)CloseHandle(host);record("namespace-host-root-denied",L"C:\\",hostDenied,hostError);
  if(!hostDenied)return false;
  HANDLE write=CreateFileW(L"X:\\workspace\\forbidden.txt",GENERIC_WRITE,FILE_SHARE_READ,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr);
  DWORD writeError=GetLastError();bool writeDenied=write==INVALID_HANDLE_VALUE&&writeError==ERROR_ACCESS_DENIED;
  if(write!=INVALID_HANDLE_VALUE)CloseHandle(write);record("namespace-workspace-write-denied",L"X:\\workspace\\forbidden.txt",writeDenied,writeError);
  if(!writeDenied)return false;
  HANDLE traversed=CreateFileW(L"X:\\workspace\\..\\..",GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_FLAG_BACKUP_SEMANTICS,nullptr);
  WCHAR boundedNt[4096]={};DWORD boundedChars=GetFinalPathNameByHandleW(traversed,boundedNt,4096,VOLUME_NAME_NT);
  bool confined=traversed!=INVALID_HANDLE_VALUE&&boundedChars>0&&boundedChars<4096&&!wcscmp(boundedNt,expectedNt);
  if(traversed!=INVALID_HANDLE_VALUE)CloseHandle(traversed);record("namespace-traversal-confined",boundedNt,confined,confined?0:GetLastError());
  if(!confined)return false;
  return SetCurrentDirectoryW(L"X:\\workspace")!=FALSE;
}
static bool patch(){
  BYTE* base=reinterpret_cast<BYTE*>(GetModuleHandleW(nullptr));
  auto* dos=reinterpret_cast<IMAGE_DOS_HEADER*>(base);
  auto* nt=reinterpret_cast<IMAGE_NT_HEADERS64*>(base+dos->e_lfanew);
  if(dos->e_magic!=IMAGE_DOS_SIGNATURE||nt->Signature!=IMAGE_NT_SIGNATURE||nt->FileHeader.Machine!=IMAGE_FILE_MACHINE_AMD64)return false;
  auto directory=nt->OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_IMPORT];
  auto* descriptor=reinterpret_cast<IMAGE_IMPORT_DESCRIPTOR*>(base+directory.VirtualAddress);
  for(;descriptor->Name;descriptor++){
    if(_stricmp(reinterpret_cast<const char*>(base+descriptor->Name),"kernel32.dll"))continue;
    auto* name=reinterpret_cast<IMAGE_THUNK_DATA64*>(base+descriptor->OriginalFirstThunk);
    auto* slot=reinterpret_cast<IMAGE_THUNK_DATA64*>(base+descriptor->FirstThunk);
    for(;name->u1.AddressOfData;name++,slot++){
      if(IMAGE_SNAP_BY_ORDINAL64(name->u1.Ordinal))continue;
      auto* imported=reinterpret_cast<IMAGE_IMPORT_BY_NAME*>(base+name->u1.AddressOfData);
      if(strcmp(reinterpret_cast<const char*>(imported->Name),"GetProcAddress"))continue;
      auto before=reinterpret_cast<ProcFn>(slot->u1.Function);
      if(originalProc&&before!=originalProc)return false;
      originalProc=before;DWORD protection=0,ignored=0;
      if(!VirtualProtect(&slot->u1.Function,sizeof(slot->u1.Function),PAGE_READWRITE,&protection))return false;
      InterlockedExchangePointer(reinterpret_cast<void* volatile*>(&slot->u1.Function),reinterpret_cast<void*>(tracedProc));
      if(!VirtualProtect(&slot->u1.Function,sizeof(slot->u1.Function),protection,&ignored))return false;
      patches++;
    }
  }
  return patches==2;
}
BOOL WINAPI DllMain(HINSTANCE,DWORD reason,LPVOID) {
  if(reason==DLL_PROCESS_ATTACH){if(!identity()){if(trace&&GetFileType(trace)==FILE_TYPE_DISK)record("identity-failed",nullptr,FALSE,GetLastError());return FALSE;}record("identity-accepted",nullptr,TRUE,0);if((false&&!attestInheritedMap())||!mappedRoot()){record("device-map-root-failed",nullptr,FALSE,GetLastError());return FALSE;}if(!patch()){record("patch-failed",nullptr,FALSE,GetLastError());return FALSE;}installed=true;record("installed",nullptr,TRUE,0);}
  else if(reason==DLL_PROCESS_DETACH&&installed){record("exit",nullptr,TRUE,0);FlushFileBuffers(trace);}
  return TRUE;
}
