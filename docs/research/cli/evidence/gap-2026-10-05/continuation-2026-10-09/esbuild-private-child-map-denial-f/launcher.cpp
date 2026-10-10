// Independent, fixed-path trace launcher. All child handles are listed explicitly.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <sddl.h>
#include <node_api.h>
#include <cstdio>
#include <cwchar>
#include <string>
#include <vector>
#include <algorithm>

#ifndef PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY
#define PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY ProcThreadAttributeValue(14,FALSE,TRUE,FALSE)
#endif
static HMODULE ownModule=nullptr;
BOOL WINAPI DllMain(HINSTANCE module,DWORD reason,LPVOID){if(reason==DLL_PROCESS_ATTACH)ownModule=module;return TRUE;}
struct Handles {
  std::vector<HANDLE> items;
  ~Handles(){for(HANDLE item:items)if(item&&item!=INVALID_HANDLE_VALUE)CloseHandle(item);}
  HANDLE add(HANDLE value){if(value&&value!=INVALID_HANDLE_VALUE)items.push_back(value);return value;}
  HANDLE duplicate(HANDLE value){HANDLE copy=nullptr;if(!DuplicateHandle(GetCurrentProcess(),value,GetCurrentProcess(),&copy,0,TRUE,DUPLICATE_SAME_ACCESS))return nullptr;return add(copy);}
};
static bool tokenProof(HANDLE process,std::wstring& sid){
  HANDLE token=nullptr;DWORD used=0,container=0;BOOL inJob=FALSE;
  alignas(void*) BYTE sidBytes[256]={},caps[4096]={};
  if(!OpenProcessToken(process,TOKEN_QUERY,&token))return false;
  bool valid=GetTokenInformation(token,TokenIsAppContainer,&container,sizeof(container),&used)&&container==1&&
    GetTokenInformation(token,TokenAppContainerSid,sidBytes,sizeof(sidBytes),&used)&&
    GetTokenInformation(token,TokenCapabilities,caps,sizeof(caps),&used)&&reinterpret_cast<TOKEN_GROUPS*>(caps)->GroupCount==0&&
    IsProcessInJob(process,nullptr,&inJob)&&inJob;
  LPWSTR text=nullptr;
  if(valid)valid=ConvertSidToStringSidW(reinterpret_cast<TOKEN_APPCONTAINER_INFORMATION*>(sidBytes)->TokenAppContainer,&text);
  if(valid)sid=text;
  if(text)LocalFree(text);CloseHandle(token);return valid;
}
static napi_value resultString(napi_env env,const char* json){
  auto make=reinterpret_cast<decltype(&napi_create_string_utf8)>(GetProcAddress(GetModuleHandleW(nullptr),"napi_create_string_utf8"));
  napi_value value=nullptr;if(!make||make(env,json,NAPI_AUTO_LENGTH,&value)!=napi_ok)return nullptr;return value;
}
static napi_value run(napi_env env,napi_callback_info){
  const char* stage="root-token";DWORD failure=0,childExit=0xffffffff;bool complete=false,imagePinned=false,created=false,rootTokenProven=false,childTokenProven=false;
  PROCESS_INFORMATION child={};std::wstring sid,childSid;Handles handles;
  auto work=[&]()->bool{
    if(!tokenProof(GetCurrentProcess(),sid))return false;rootTokenProven=true;
    WCHAR module[4096]={};DWORD chars=GetModuleFileNameW(ownModule,module,4096);
    if(!chars||chars>=4096)return false;
    std::wstring loaded=module;
    if(loaded.rfind(L"\\\\?\\",0)==0)loaded=loaded.substr(4);
    const std::wstring suffix=L"\\workspace\\tree\\adapter\\esbuild-trace-launcher.node";
    if(loaded.size()<=suffix.size()||loaded.compare(loaded.size()-suffix.size(),suffix.size(),suffix))return false;
    const std::wstring root=loaded.substr(0,loaded.size()-suffix.size()),workspace=root+L"\\workspace",
      application=workspace+L"\\tree\\esbuild.exe",shim=workspace+L"\\tree\\adapter\\esbuild-trace-shim.dll";
    stage="pin-image";
    HANDLE image=handles.add(CreateFileW(application.c_str(),GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT,nullptr));
    BY_HANDLE_FILE_INFORMATION imageInfo={};
    if(image==INVALID_HANDLE_VALUE||!GetFileInformationByHandle(image,&imageInfo)||
      (imageInfo.dwFileAttributes&(FILE_ATTRIBUTE_REPARSE_POINT|FILE_ATTRIBUTE_DIRECTORY))||imageInfo.nNumberOfLinks!=1)return false;
    imagePinned=true;
    stage="stdio";
    HANDLE stdio[]={handles.duplicate(GetStdHandle(STD_INPUT_HANDLE)),handles.duplicate(GetStdHandle(STD_OUTPUT_HANDLE)),handles.duplicate(GetStdHandle(STD_ERROR_HANDLE))};
    for(HANDLE handle:stdio)if(!handle||(GetFileType(handle)!=FILE_TYPE_DISK&&GetFileType(handle)!=FILE_TYPE_PIPE))return false;
    SECURITY_ATTRIBUTES sa={sizeof(sa),nullptr,TRUE};
    HANDLE trace=handles.add(CreateFileW((root+L"\\scratch\\esbuild-api-trace.jsonl").c_str(),GENERIC_WRITE,FILE_SHARE_READ,&sa,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr));
    if(trace==INVALID_HANDLE_VALUE)return false;
    std::vector<HANDLE> inherited={stdio[0],stdio[1],stdio[2],trace};
    stage="environment";
    std::vector<std::wstring> entries;LPWCH original=GetEnvironmentStringsW();if(!original)return false;
    for(const WCHAR* entry=original;*entry;entry+=wcslen(entry)+1){
      std::wstring row=entry;if(row.rfind(L"CC_ESBUILD_TRACE_HANDLE=",0)==0||row.rfind(L"CC_ESBUILD_TRACE_SID=",0)==0||row.rfind(L"CC_ESBUILD_TRACE_MAP_HANDLE=",0)==0)continue;entries.push_back(row);
    }
    FreeEnvironmentStringsW(original);
    WCHAR handleText[64];swprintf(handleText,64,L"CC_ESBUILD_TRACE_HANDLE=%llx",static_cast<unsigned long long>(reinterpret_cast<uintptr_t>(trace)));
    entries.emplace_back(handleText);entries.push_back(L"CC_ESBUILD_TRACE_SID="+sid);
    std::sort(entries.begin(),entries.end(),[](const auto&a,const auto&b){return _wcsicmp(a.c_str(),b.c_str())<0;});
    std::vector<WCHAR> environment;for(const auto& entry:entries){environment.insert(environment.end(),entry.begin(),entry.end());environment.push_back(0);}environment.push_back(0);
    stage="handle-and-leaf-policy";
    SIZE_T attributeBytes=0;InitializeProcThreadAttributeList(nullptr,2,0,&attributeBytes);
    if(!attributeBytes||attributeBytes>65536)return false;std::vector<BYTE> storage(attributeBytes);
    auto* attributes=reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(storage.data());
    if(!InitializeProcThreadAttributeList(attributes,2,0,&attributeBytes))return false;
    DWORD leafPolicy=1;
    bool attributesReady=UpdateProcThreadAttribute(attributes,0,PROC_THREAD_ATTRIBUTE_HANDLE_LIST,inherited.data(),inherited.size()*sizeof(HANDLE),nullptr,nullptr)&&
      UpdateProcThreadAttribute(attributes,0,PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY,&leafPolicy,sizeof(leafPolicy),nullptr,nullptr);
    if(!attributesReady){DeleteProcThreadAttributeList(attributes);return false;}
    STARTUPINFOEXW startup={};startup.StartupInfo.cb=sizeof(startup);startup.StartupInfo.dwFlags=STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput=stdio[0];startup.StartupInfo.hStdOutput=stdio[1];startup.StartupInfo.hStdError=stdio[2];startup.lpAttributeList=attributes;
    std::wstring command=L"\""+application+L"\" \""+workspace+L"\\tree\\entry.js\" --bundle --platform=node --outfile=\""+root+L"\\scratch\\bundle.js\"";
    stage="create-suspended";
    // CREATE_NO_WINDOW still requests console initialization. With the leaf
    // process policy this exits before the shim on this host (0xC0000142).
    // DETACHED_PROCESS avoids that console; all stdio remains explicit handles.
    BOOL ok=CreateProcessW(application.c_str(),command.data(),nullptr,nullptr,TRUE,
      CREATE_SUSPENDED|CREATE_UNICODE_ENVIRONMENT|EXTENDED_STARTUPINFO_PRESENT|DETACHED_PROCESS,environment.data(),workspace.c_str(),&startup.StartupInfo,&child);
    failure=ok?0:GetLastError();DeleteProcThreadAttributeList(attributes);if(!ok)return false;created=true;
    handles.add(child.hProcess);handles.add(child.hThread);
    stage="child-token-image";
    WCHAR actual[4096]={};DWORD actualChars=4096;
    if(!tokenProof(child.hProcess,childSid)||childSid!=sid)return false;childTokenProven=true;
    if(!QueryFullProcessImageNameW(child.hProcess,0,actual,&actualChars))return false;HANDLE actualImage=handles.add(CreateFileW(actual,GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT,nullptr));BY_HANDLE_FILE_INFORMATION actualInfo={};if(actualImage==INVALID_HANDLE_VALUE||!GetFileInformationByHandle(actualImage,&actualInfo)||actualInfo.dwVolumeSerialNumber!=imageInfo.dwVolumeSerialNumber||actualInfo.nFileIndexHigh!=imageInfo.nFileIndexHigh||actualInfo.nFileIndexLow!=imageInfo.nFileIndexLow||actualInfo.nNumberOfLinks!=1||(actualInfo.dwFileAttributes&FILE_ATTRIBUTE_REPARSE_POINT))return false;
    stage="lowbox-set-child-map";WCHAR mapText[32]={};if(!GetEnvironmentVariableW(L"CC_ESBUILD_TRACE_MAP_HANDLE",mapText,32))return false;HANDLE mapHandle=reinterpret_cast<HANDLE>(static_cast<uintptr_t>(wcstoull(mapText,nullptr,16)));using SetMapFn=LONG(NTAPI*)(HANDLE,ULONG,PVOID,ULONG);auto setter=reinterpret_cast<SetMapFn>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"),"NtSetInformationProcess"));if(!setter)return false;LONG setterStatus=setter(child.hProcess,23,&mapHandle,sizeof(mapHandle));if(setterStatus<0){failure=static_cast<DWORD>(setterStatus);return false;}stage="queue-primary-loader";
    HANDLE shimGuard=handles.add(CreateFileW(shim.c_str(),GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT,nullptr));WCHAR shimNt[4096]={};DWORD shimChars=GetFinalPathNameByHandleW(shimGuard,shimNt,4096,VOLUME_NAME_NT);if(shimGuard==INVALID_HANDLE_VALUE||!shimChars||shimChars>=4096)return false;std::wstring loadPath=std::wstring(L"\\\\?\\GLOBALROOT")+shimNt;SIZE_T size=(loadPath.size()+1)*sizeof(WCHAR),written=0;
    void* remote=VirtualAllocEx(child.hProcess,nullptr,size,MEM_COMMIT|MEM_RESERVE,PAGE_READWRITE);
    if(!remote)return false;
    if(!WriteProcessMemory(child.hProcess,remote,loadPath.c_str(),size,&written)||written!=size)return false;
    // Initialize the AppContainer on the original primary thread, then load
    // the shim before entering Go. Keep its path allocation until child exit.
    auto loader=reinterpret_cast<PAPCFUNC>(GetProcAddress(GetModuleHandleW(L"kernel32.dll"),"LoadLibraryW"));
    if(!loader||!QueueUserAPC(loader,child.hThread,reinterpret_cast<ULONG_PTR>(remote)))return false;
    stage="resume";
    if(ResumeThread(child.hThread)!=1)return false;
    stage="wait";
    if(WaitForSingleObject(child.hProcess,5000)!=WAIT_OBJECT_0){failure=WAIT_TIMEOUT;return false;}
    if(!GetExitCodeProcess(child.hProcess,&childExit))return false;
    stage="child-exit-status";if(childExit>1){failure=childExit;return false;}
    stage="completed";return true;
  };
  complete=work();if(!complete&&!failure)failure=GetLastError();
  if(created&&!complete){TerminateProcess(child.hProcess,125);WaitForSingleObject(child.hProcess,3000);GetExitCodeProcess(child.hProcess,&childExit);}
  char sidText[256]={},json[1024]={};WideCharToMultiByte(CP_UTF8,0,sid.c_str(),-1,sidText,sizeof(sidText),nullptr,nullptr);
  std::snprintf(json,sizeof(json),"{\"stage\":\"%s\",\"error\":%lu,\"completed\":%s,\"rootPid\":%lu,\"childPid\":%lu,\"childExit\":%lu,\"appContainerSid\":\"%s\",\"capabilityCount\":%s,\"rootTokenProven\":%s,\"childTokenProven\":%s,\"imagePinned\":%s,\"leafRestricted\":%s,\"exactHandles\":%s,\"consoleMode\":\"detached\",\"loaderStrategy\":\"primary-thread-apc\"}",
    stage,failure,complete?"true":"false",GetCurrentProcessId(),child.dwProcessId,childExit,sidText,rootTokenProven?"0":"null",rootTokenProven?"true":"false",childTokenProven?"true":"false",imagePinned?"true":"false",created?"true":"false",created?"true":"false");
  return resultString(env,json);
}
NAPI_MODULE_INIT(){
  HMODULE host=GetModuleHandleW(nullptr);
  auto make=reinterpret_cast<decltype(&napi_create_function)>(GetProcAddress(host,"napi_create_function"));
  auto set=reinterpret_cast<decltype(&napi_set_named_property)>(GetProcAddress(host,"napi_set_named_property"));
  napi_value fn=nullptr;if(!make||!set||make(env,"run",NAPI_AUTO_LENGTH,run,nullptr,&fn)!=napi_ok||set(env,exports,"run",fn)!=napi_ok)return nullptr;return exports;
}

