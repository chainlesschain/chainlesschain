// Independent non-elevated direct-leaf AppContainer device-map diagnostic.
// Never part of the production launcher allowlist. The parent owns the original
// CREATE_SUSPENDED child handle; no PID request can authorize its map setter.
// The private unnamed map contains one link to a held, canonical, non-reparse
// root. Only its QUERY|TRAVERSE handle is inherited; the child cannot edit it.
// The fixed bootstrap must prove root FileId/NT path and negative controls before
// Go runs. This minimal entry proof does not admit service/config/fork execution.
#define _WIN32_WINNT 0x0A00
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <winternl.h>
#include <sddl.h>
#include <aclapi.h>
#include <userenv.h>
#include <appmodel.h>
#include <shlobj.h>
#include <bcrypt.h>
#include <cstdio>
#include <cwchar>
#include <cstring>
#include <string>
#include <vector>
#include <algorithm>
#include <set>
#ifndef PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES
#define PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES ProcThreadAttributeValue(9,FALSE,TRUE,FALSE)
#endif
#ifndef PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY
#define PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY ProcThreadAttributeValue(14,FALSE,TRUE,FALSE)
#endif
using DirFn=NTSTATUS(NTAPI*)(PHANDLE,ACCESS_MASK,POBJECT_ATTRIBUTES);
using LinkFn=NTSTATUS(NTAPI*)(PHANDLE,ACCESS_MASK,POBJECT_ATTRIBUTES,PUNICODE_STRING);
using SetFn=NTSTATUS(NTAPI*)(HANDLE,ULONG,PVOID,ULONG);
struct Handles{std::vector<HANDLE> values;HANDLE add(HANDLE h){if(h&&h!=INVALID_HANDLE_VALUE)values.push_back(h);return h;}~Handles(){for(HANDLE h:values)CloseHandle(h);}};
static std::string jsonText(const std::wstring& text){
 char utf8[8192]={};if(!WideCharToMultiByte(CP_UTF8,0,text.c_str(),-1,utf8,sizeof(utf8),nullptr,nullptr))return "";std::string escaped;
 for(const char* p=utf8;*p;p++){if(*p=='\\'||*p=='"')escaped+='\\';escaped+=*p;}return escaped;
}
struct DriveSnapshot {
 bool captured=false,known=false;
 DWORD characters=0,error=ERROR_GEN_FAILURE;
 WCHAR value[4096]={};
 const char* status() const {return !captured?"not-captured":!known?"unknown":characters?"mapped":"absent";}
 std::string json() const {
  std::string hex;char unit[5]={};for(DWORD i=0;i<characters&&i<4096;i++){std::snprintf(unit,sizeof(unit),"%04x",static_cast<unsigned>(value[i]));hex+=unit;}
  char header[160]={};std::snprintf(header,sizeof(header),"{\"status\":\"%s\",\"characters\":%lu,\"error\":%lu,\"valueHex\":\"",status(),characters,error);
  return std::string(header)+hex+"\"}";
 }
};
static DriveSnapshot captureDrive(){
 DriveSnapshot snapshot;snapshot.captured=true;SetLastError(0);
 snapshot.characters=QueryDosDeviceW(L"X:",snapshot.value,4096);
 // GetLastError is not defined on success; normalize it only after real success.
 snapshot.error=snapshot.characters?ERROR_SUCCESS:GetLastError();
 snapshot.known=(snapshot.characters>0&&snapshot.characters<=4096&&snapshot.value[snapshot.characters-1]==0)||
   (snapshot.characters==0&&snapshot.error==ERROR_FILE_NOT_FOUND);
 return snapshot;
}
static bool sameDrive(const DriveSnapshot& before,const DriveSnapshot& after){
 return before.known&&after.known&&before.characters==after.characters&&before.error==after.error&&
   !memcmp(before.value,after.value,before.characters*sizeof(WCHAR));
}
static bool noLoopback(PSID sid){
 HMODULE dll=LoadLibraryW(L"FirewallAPI.dll");if(!dll)return false;
 using Fn=DWORD(WINAPI*)(DWORD*,SID_AND_ATTRIBUTES**);auto fn=reinterpret_cast<Fn>(GetProcAddress(dll,"NetworkIsolationGetAppContainerConfig"));
 DWORD count=0;SID_AND_ATTRIBUTES* rows=nullptr;bool valid=fn&&fn(&count,&rows)==0&&count<=65536&&(!count||rows);
 if(valid)for(DWORD i=0;i<count;i++)if(EqualSid(rows[i].Sid,sid))valid=false;
 if(rows){for(DWORD i=0;i<count&&i<65536;i++)HeapFree(GetProcessHeap(),0,rows[i].Sid);HeapFree(GetProcessHeap(),0,rows);}FreeLibrary(dll);return valid;
}
static bool tokenProof(HANDLE process,PSID expected,HANDLE job){
 HANDLE token=nullptr;DWORD used=0,isContainer=0;alignas(void*) BYTE sid[256]={},caps[4096]={};BOOL inJob=FALSE;
 if(!OpenProcessToken(process,TOKEN_QUERY,&token))return false;
 bool ok=GetTokenInformation(token,TokenIsAppContainer,&isContainer,sizeof(isContainer),&used)&&isContainer==1&&
 GetTokenInformation(token,TokenAppContainerSid,sid,sizeof(sid),&used)&&EqualSid(reinterpret_cast<TOKEN_APPCONTAINER_INFORMATION*>(sid)->TokenAppContainer,expected)&&
 GetTokenInformation(token,TokenCapabilities,caps,sizeof(caps),&used)&&reinterpret_cast<TOKEN_GROUPS*>(caps)->GroupCount==0&&IsProcessInJob(process,job,&inJob)&&inJob;
 CloseHandle(token);return ok;
}
static bool protect(const std::wstring& name,const std::wstring& owner,const std::wstring& sid,bool scratch=false){
 std::wstring sddl=L"D:P(A;OICI;FA;;;"+owner+L")(A;OICI;FA;;;SY)(A;"+(scratch?std::wstring(L"OICI"):std::wstring())+L";"+(scratch?std::wstring(L"0x1301bf"):std::wstring(L"0x1200a9"))+L";;;"+sid+L")";
 PSECURITY_DESCRIPTOR sd=nullptr;if(!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.c_str(),SDDL_REVISION_1,&sd,nullptr))return false;
 PACL acl=nullptr;BOOL present=FALSE,def=FALSE;bool ok=GetSecurityDescriptorDacl(sd,&present,&acl,&def)&&present&&SetNamedSecurityInfoW(const_cast<LPWSTR>(name.c_str()),SE_FILE_OBJECT,DACL_SECURITY_INFORMATION|PROTECTED_DACL_SECURITY_INFORMATION,nullptr,nullptr,acl,nullptr)==ERROR_SUCCESS;LocalFree(sd);return ok;
}
static HANDLE pin(Handles& handles,const std::wstring& path,bool directory,BY_HANDLE_FILE_INFORMATION* result=nullptr){
 HANDLE h=handles.add(CreateFileW(path.c_str(),GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT|(directory?FILE_FLAG_BACKUP_SEMANTICS:0),nullptr));
 BY_HANDLE_FILE_INFORMATION info={};WCHAR actual[4096]={};DWORD count=GetFinalPathNameByHandleW(h,actual,4096,FILE_NAME_NORMALIZED);
 if(h==INVALID_HANDLE_VALUE||!GetFileInformationByHandle(h,&info)||!count||count>=4096||std::wstring(actual)!=L"\\\\?\\"+path||(info.dwFileAttributes&FILE_ATTRIBUTE_REPARSE_POINT)||bool(info.dwFileAttributes&FILE_ATTRIBUTE_DIRECTORY)!=directory||(!directory&&info.nNumberOfLinks!=1))return INVALID_HANDLE_VALUE;
 if(result)*result=info;return h;
}
static bool exactNames(const std::wstring& directory,const std::set<std::wstring>& expected){
 WIN32_FIND_DATAW row={};HANDLE search=FindFirstFileW((directory+L"\\*").c_str(),&row);if(search==INVALID_HANDLE_VALUE)return false;std::set<std::wstring> actual;
 do{if(wcscmp(row.cFileName,L".")&&wcscmp(row.cFileName,L".."))actual.insert(row.cFileName);}while(FindNextFileW(search,&row));DWORD error=GetLastError();FindClose(search);return error==ERROR_NO_MORE_FILES&&actual==expected;
}
static bool hashFile(HANDLE file,const char* expected){
 BCRYPT_ALG_HANDLE algorithm=nullptr;BCRYPT_HASH_HANDLE hash=nullptr;DWORD objectBytes=0,used=0;bool ok=BCryptOpenAlgorithmProvider(&algorithm,BCRYPT_SHA256_ALGORITHM,nullptr,0)==0&&BCryptGetProperty(algorithm,BCRYPT_OBJECT_LENGTH,reinterpret_cast<PUCHAR>(&objectBytes),sizeof(objectBytes),&used,0)==0;
 std::vector<BYTE> object(objectBytes),buffer(65536);BYTE digest[32]={};if(ok)ok=BCryptCreateHash(algorithm,&hash,object.data(),objectBytes,nullptr,0,0)==0;
 DWORD bytes=0;LARGE_INTEGER zero={};if(ok)ok=SetFilePointerEx(file,zero,nullptr,FILE_BEGIN);
 while(ok){if(!ReadFile(file,buffer.data(),static_cast<DWORD>(buffer.size()),&bytes,nullptr)){ok=false;break;}if(!bytes)break;ok=BCryptHashData(hash,buffer.data(),bytes,0)==0;}
 if(ok)ok=BCryptFinishHash(hash,digest,sizeof(digest),0)==0;if(hash)BCryptDestroyHash(hash);if(algorithm)BCryptCloseAlgorithmProvider(algorithm,0);
 char hex[65]={};for(unsigned i=0;i<32;i++)std::snprintf(hex+2*i,3,"%02x",digest[i]);return ok&&!strcmp(hex,expected);
}
int wmain(int argc,WCHAR** argv){
 const bool probeUnassigned=argc==4&&!wcscmp(argv[3],L"--probe-unassigned-cleanup");
 if(argc!=3&&!probeUnassigned)return 64;const std::wstring root=argv[1],shimHashW=argv[2],workspace=root+L"\\workspace",scratch=root+L"\\scratch",application=workspace+L"\\esbuild.exe";
 char shimHash[65]={};if(shimHashW.size()!=64||!WideCharToMultiByte(CP_UTF8,0,shimHashW.c_str(),-1,shimHash,65,nullptr,nullptr))return 65;
 const char* stage="host-token";DWORD failure=0,childExit=0xffffffff;NTSTATUS setterStatus=0x7fffffff;bool complete=false,hostProven=false,childProven=false,mapPrepared=false,mapInstalled=false,parentUnchanged=false,cleanup=false,profileDeleted=false,loopback=false,imagePinned=false;
 Handles handles;PROCESS_INFORMATION child={};HANDLE job=nullptr;PSID appSid=nullptr;std::wstring profile,sid,guardedRootNt,guardedRootId;bool created=false,jobAssigned=false,childExitRead=false,childExited=false,jobQuerySucceeded=false,directTerminationAttempted=false,directTerminationSucceeded=false;DWORD childWaitStatus=WAIT_FAILED,jobActiveProcesses=0xffffffff,directTerminationError=0;DriveSnapshot beforeMap,afterSetterMap,afterChildMap;
 auto work=[&]()->bool{
  HANDLE token=nullptr;if(!OpenProcessToken(GetCurrentProcess(),TOKEN_QUERY|TOKEN_DUPLICATE|TOKEN_ASSIGN_PRIMARY,&token))return false;handles.add(token);
  DWORD used=0,container=0;TOKEN_ELEVATION elevation={};alignas(void*) BYTE ownerBytes[1024]={};
  if(!GetTokenInformation(token,TokenIsAppContainer,&container,sizeof(container),&used)||container||!GetTokenInformation(token,TokenElevation,&elevation,sizeof(elevation),&used)||elevation.TokenIsElevated||IsTokenRestricted(token)||!GetTokenInformation(token,TokenUser,ownerBytes,sizeof(ownerBytes),&used))return false;hostProven=true;
  LPWSTR ownerText=nullptr;if(!ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER*>(ownerBytes)->User.Sid,&ownerText))return false;std::wstring owner=ownerText;LocalFree(ownerText);
  WCHAR profileName[96]={};swprintf(profileName,96,L"cc.esbuild.map.%lu.%llu",GetCurrentProcessId(),static_cast<unsigned long long>(GetTickCount64()));profile=profileName;
  stage="create-profile";HRESULT hr=CreateAppContainerProfile(profile.c_str(),profile.c_str(),L"Independent zero capability private map proof",nullptr,0,&appSid);if(FAILED(hr)){failure=hr;return false;}
  LPWSTR sidText=nullptr;if(!ConvertSidToStringSidW(appSid,&sidText))return false;sid=sidText;LocalFree(sidText);
  stage="loopback-proof";if(!noLoopback(appSid))return false;loopback=true;
  stage="exact-private-tree";if(!exactNames(root,{L"workspace",L"scratch"})||!exactNames(workspace,{L"esbuild.exe",L"entry.js",L"shim.dll"})||!exactNames(scratch,{}))return false;
  stage="private-acl";for(const auto& file:{root,workspace,application,workspace+L"\\entry.js",workspace+L"\\shim.dll"})if(!protect(file,owner,sid))return false;if(!protect(scratch,owner,sid,true))return false;
  stage="pin-root-image";BY_HANDLE_FILE_INFORMATION rootInfo={};HANDLE rootGuard=pin(handles,root,true,&rootInfo);if(rootGuard==INVALID_HANDLE_VALUE||pin(handles,workspace,true)==INVALID_HANDLE_VALUE||pin(handles,scratch,true)==INVALID_HANDLE_VALUE)return false;
  HANDLE image=pin(handles,application,false),entry=pin(handles,workspace+L"\\entry.js",false),shim=pin(handles,workspace+L"\\shim.dll",false);
  if(image==INVALID_HANDLE_VALUE||entry==INVALID_HANDLE_VALUE||shim==INVALID_HANDLE_VALUE||!hashFile(image,"ec02ee9b14ab332416fedd10614dfb80eed5304d94f67745067c011934a8c3c3")||!hashFile(shim,shimHash))return false;
  char entryBytes[128]={};DWORD entryCount=0;if(!ReadFile(entry,entryBytes,sizeof(entryBytes),&entryCount,nullptr)||entryCount!=sizeof("export const answer = 42;\n")-1||memcmp(entryBytes,"export const answer = 42;\n",entryCount))return false;imagePinned=true;
  WCHAR rootNt[4096]={},rootId[96]={};DWORD rootChars=GetFinalPathNameByHandleW(rootGuard,rootNt,4096,VOLUME_NAME_NT);if(!rootChars||rootChars>=4096||wcsncmp(rootNt,L"\\Device\\",8))return false;
  swprintf(rootId,96,L"%08lx:%08lx:%08lx",rootInfo.dwVolumeSerialNumber,rootInfo.nFileIndexHigh,rootInfo.nFileIndexLow);guardedRootNt=rootNt;guardedRootId=rootId;
  stage="prepare-map";HMODULE nt=GetModuleHandleW(L"ntdll.dll");auto createDir=reinterpret_cast<DirFn>(GetProcAddress(nt,"NtCreateDirectoryObject"));auto createLink=reinterpret_cast<LinkFn>(GetProcAddress(nt,"NtCreateSymbolicLinkObject"));auto setProcess=reinterpret_cast<SetFn>(GetProcAddress(nt,"NtSetInformationProcess"));if(!createDir||!createLink||!setProcess)return false;
  OBJECT_ATTRIBUTES dirAttrs={};dirAttrs.Length=sizeof(dirAttrs);HANDLE map=nullptr;NTSTATUS status=createDir(&map,0xF000F,&dirAttrs);if(status<0){failure=status;return false;}handles.add(map);
  WCHAR drive[]=L"X:";UNICODE_STRING name={4,6,drive},target={static_cast<USHORT>(rootChars*2),static_cast<USHORT>((rootChars+1)*2),rootNt};OBJECT_ATTRIBUTES linkAttrs={};linkAttrs.Length=sizeof(linkAttrs);linkAttrs.RootDirectory=map;linkAttrs.ObjectName=&name;linkAttrs.Attributes=0x40;
  HANDLE link=nullptr;status=createLink(&link,0xF0001,&linkAttrs,&target);if(status<0){failure=status;return false;}handles.add(link);
  HANDLE readOnlyMap=nullptr;if(!DuplicateHandle(GetCurrentProcess(),map,GetCurrentProcess(),&readOnlyMap,3,TRUE,0))return false;handles.add(readOnlyMap);mapPrepared=true;
  stage="parent-map-before";beforeMap=captureDrive();if(!beforeMap.known){failure=beforeMap.error;return false;}
  stage="stdio";SECURITY_ATTRIBUTES sa={sizeof(sa),nullptr,TRUE};HANDLE input=handles.add(CreateFileW((scratch+L"\\stdin").c_str(),GENERIC_READ,FILE_SHARE_READ,&sa,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr));
  HANDLE output=handles.add(CreateFileW((scratch+L"\\stdout").c_str(),GENERIC_WRITE,FILE_SHARE_READ,&sa,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr));HANDLE error=handles.add(CreateFileW((scratch+L"\\stderr").c_str(),GENERIC_WRITE,FILE_SHARE_READ,&sa,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr));HANDLE trace=handles.add(CreateFileW((scratch+L"\\trace.jsonl").c_str(),GENERIC_WRITE,FILE_SHARE_READ,&sa,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr));
  HANDLE inherited[]={input,output,error,trace,readOnlyMap};for(HANDLE h:inherited)if(!h||h==INVALID_HANDLE_VALUE)return false;
  std::vector<std::wstring> entries;WCHAR systemRoot[4096]={};DWORD systemChars=GetEnvironmentVariableW(L"SystemRoot",systemRoot,4096);if(!systemChars||systemChars>=4096)return false;
  WCHAR localAppData[MAX_PATH]={};if(FAILED(SHGetFolderPathW(nullptr,CSIDL_LOCAL_APPDATA,nullptr,SHGFP_TYPE_CURRENT,localAppData)))return false;
  WCHAR traceEnv[80]={},mapEnv[80]={};swprintf(traceEnv,80,L"CC_ESBUILD_TRACE_HANDLE=%llx",static_cast<unsigned long long>(reinterpret_cast<uintptr_t>(trace)));swprintf(mapEnv,80,L"CC_ESBUILD_TRACE_MAP_HANDLE=%llx",static_cast<unsigned long long>(reinterpret_cast<uintptr_t>(readOnlyMap)));
  entries={traceEnv,mapEnv,L"CC_ESBUILD_TRACE_SID="+sid,std::wstring(L"CC_ESBUILD_TRACE_ROOT_NT=")+rootNt,std::wstring(L"CC_ESBUILD_TRACE_ROOT_ID=")+rootId,std::wstring(L"SystemRoot=")+systemRoot,std::wstring(L"WINDIR=")+systemRoot,std::wstring(L"LOCALAPPDATA=")+localAppData,std::wstring(L"TEMP=")+localAppData+L"\\Temp",std::wstring(L"TMP=")+localAppData+L"\\Temp",std::wstring(L"SystemDrive=")+std::wstring(systemRoot,2)};std::sort(entries.begin(),entries.end());std::vector<WCHAR> env;for(const auto& row:entries){env.insert(env.end(),row.begin(),row.end());env.push_back(0);}env.push_back(0);
  stage="restricted-token";HANDLE restricted=nullptr;if(!CreateRestrictedToken(token,DISABLE_MAX_PRIVILEGE,0,nullptr,0,nullptr,0,nullptr,&restricted))return false;handles.add(restricted);
  stage="job";job=handles.add(CreateJobObjectW(nullptr,nullptr));JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits={};limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE|JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION|JOB_OBJECT_LIMIT_ACTIVE_PROCESS|JOB_OBJECT_LIMIT_PROCESS_MEMORY;limits.BasicLimitInformation.ActiveProcessLimit=1;limits.ProcessMemoryLimit=256*1024*1024;if(!job||!SetInformationJobObject(job,JobObjectExtendedLimitInformation,&limits,sizeof(limits)))return false;
  stage="attributes";SIZE_T bytes=0;InitializeProcThreadAttributeList(nullptr,3,0,&bytes);std::vector<BYTE> storage(bytes);auto attributes=reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(storage.data());if(!InitializeProcThreadAttributeList(attributes,3,0,&bytes))return false;
  SECURITY_CAPABILITIES caps={appSid,nullptr,0,0};DWORD leaf=1;bool ready=UpdateProcThreadAttribute(attributes,0,PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,&caps,sizeof(caps),nullptr,nullptr)&&UpdateProcThreadAttribute(attributes,0,PROC_THREAD_ATTRIBUTE_HANDLE_LIST,inherited,sizeof(inherited),nullptr,nullptr)&&UpdateProcThreadAttribute(attributes,0,PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY,&leaf,sizeof(leaf),nullptr,nullptr);
  if(!ready){DeleteProcThreadAttributeList(attributes);return false;}STARTUPINFOEXW startup={};startup.StartupInfo.cb=sizeof(startup);startup.StartupInfo.dwFlags=STARTF_USESTDHANDLES;startup.StartupInfo.hStdInput=input;startup.StartupInfo.hStdOutput=output;startup.StartupInfo.hStdError=error;startup.lpAttributeList=attributes;
  std::wstring command=L"\""+application+L"\" X:\\workspace\\entry.js --bundle --platform=node --outfile=X:\\scratch\\bundle.js";
  stage="create-leaf";BOOL ok=CreateProcessAsUserW(restricted,application.c_str(),command.data(),nullptr,nullptr,TRUE,CREATE_SUSPENDED|CREATE_UNICODE_ENVIRONMENT|EXTENDED_STARTUPINFO_PRESENT|DETACHED_PROCESS,env.data(),workspace.c_str(),&startup.StartupInfo,&child);DWORD createError=GetLastError();DeleteProcThreadAttributeList(attributes);if(!ok){failure=createError;return false;}created=true;handles.add(child.hProcess);handles.add(child.hThread);
  // Explicit diagnostic fault injection exercises cleanup of a real child that
  // was created successfully but never became a Job member. It can only fail.
  if(probeUnassigned){stage="probe-unassigned-child";failure=ERROR_CANCELLED;return false;}
  stage="assign-job";if(!AssignProcessToJobObject(job,child.hProcess))return false;jobAssigned=true;
  stage="child-proof";if(!tokenProof(child.hProcess,appSid,job))return false;childProven=true;WCHAR childImage[4096]={};DWORD childChars=4096;if(!QueryFullProcessImageNameW(child.hProcess,0,childImage,&childChars)||application!=childImage)return false;
  stage="supervisor-set-child-map";setterStatus=setProcess(child.hProcess,23,&readOnlyMap,sizeof(readOnlyMap));
  afterSetterMap=captureDrive();parentUnchanged=sameDrive(beforeMap,afterSetterMap);
  if(setterStatus<0){failure=setterStatus;return false;}mapInstalled=true;if(!parentUnchanged)return false;
  stage="queue-shim";std::wstring shimPath=std::wstring(L"\\\\?\\GLOBALROOT")+rootNt+L"\\workspace\\shim.dll";SIZE_T pathBytes=(shimPath.size()+1)*sizeof(WCHAR),written=0;void* remote=VirtualAllocEx(child.hProcess,nullptr,pathBytes,MEM_COMMIT|MEM_RESERVE,PAGE_READWRITE);if(!remote||!WriteProcessMemory(child.hProcess,remote,shimPath.c_str(),pathBytes,&written)||written!=pathBytes)return false;
  auto loader=reinterpret_cast<PAPCFUNC>(GetProcAddress(GetModuleHandleW(L"kernel32.dll"),"LoadLibraryW"));if(!loader||!QueueUserAPC(loader,child.hThread,reinterpret_cast<ULONG_PTR>(remote)))return false;
  stage="run";if(ResumeThread(child.hThread)!=1||WaitForSingleObject(child.hProcess,10000)!=WAIT_OBJECT_0||!GetExitCodeProcess(child.hProcess,&childExit))return false;if(childExit){failure=childExit;return false;}
  stage="final-source-and-parent-map";if(!exactNames(root,{L"workspace",L"scratch"})||!exactNames(workspace,{L"esbuild.exe",L"entry.js",L"shim.dll"})||!hashFile(image,"ec02ee9b14ab332416fedd10614dfb80eed5304d94f67745067c011934a8c3c3")||!hashFile(shim,shimHash))return false;
  stage="completed";return true;
 };
 complete=work();if(!complete&&!failure)failure=GetLastError();
 // Job termination alone cannot settle a child whose assignment failed.
 // The retained handle from our own successful CreateProcess is authoritative.
 if(created){
  if(job)TerminateJobObject(job,125);
  if(WaitForSingleObject(child.hProcess,0)!=WAIT_OBJECT_0){
   directTerminationAttempted=true;directTerminationSucceeded=TerminateProcess(child.hProcess,125)!=FALSE;
   if(!directTerminationSucceeded)directTerminationError=GetLastError();
  }
  childWaitStatus=WaitForSingleObject(child.hProcess,3000);
  childExitRead=GetExitCodeProcess(child.hProcess,&childExit)!=FALSE;
  childExited=childWaitStatus==WAIT_OBJECT_0&&childExitRead&&childExit!=STILL_ACTIVE;
 }
 if(job){JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting={};jobQuerySucceeded=QueryInformationJobObject(job,JobObjectBasicAccountingInformation,&accounting,sizeof(accounting),nullptr)!=FALSE;if(jobQuerySucceeded)jobActiveProcesses=accounting.ActiveProcesses;}
 cleanup=(!created||childExited)&&(!job||(jobQuerySucceeded&&jobActiveProcesses==0));
 if(beforeMap.captured)afterChildMap=captureDrive();
 parentUnchanged=sameDrive(beforeMap,afterSetterMap)&&sameDrive(beforeMap,afterChildMap);
 if(complete&&!parentUnchanged){complete=false;stage="final-parent-map";failure=afterChildMap.error?afterChildMap.error:ERROR_INVALID_DATA;}
 if(complete&&!cleanup){complete=false;stage="cleanup-unconfirmed";failure=ERROR_PROCESS_ABORTED;}
 if(appSid){loopback=loopback&&noLoopback(appSid);profileDeleted=cleanup&&SUCCEEDED(DeleteAppContainerProfile(profile.c_str()));FreeSid(appSid);}else profileDeleted=true;
 char sidText[256]={};WideCharToMultiByte(CP_UTF8,0,sid.c_str(),-1,sidText,sizeof(sidText),nullptr,nullptr);
 std::printf("{\"experimental\":true,\"status\":\"NOT_ADMITTED\",\"completed\":%s,\"stage\":\"%s\",\"error\":%lu,\"setterStatus\":%lu,\"hostNonElevatedUnrestricted\":%s,\"rootPid\":%lu,\"childPid\":%lu,\"childExit\":%lu,\"childTokenProven\":%s,\"appContainerSid\":\"%s\",\"capabilityCount\":%s,\"imagePinned\":%s,\"leafRestricted\":%s,\"exactHandleCount\":%u,\"mapPrepared\":%s,\"mapInstalled\":%s,\"parentMapUnchanged\":%s,\"cleanupConfirmed\":%s,\"profileDeleted\":%s,\"loopbackExemptionAbsent\":%s,\"guardedRootNt\":\"%s\",\"guardedRootFileId\":\"%s\",\"childCreated\":%s,\"jobAssigned\":%s,\"childWaitStatus\":%lu,\"childExitRead\":%s,\"childExited\":%s,\"jobQuerySucceeded\":%s,\"jobActiveProcesses\":%lu,\"directTerminationAttempted\":%s,\"directTerminationSucceeded\":%s,\"directTerminationError\":%lu,\"beforeMap\":%s,\"afterSetterMap\":%s,\"afterChildMap\":%s}\n",complete?"true":"false",stage,failure,static_cast<DWORD>(setterStatus),hostProven?"true":"false",GetCurrentProcessId(),child.dwProcessId,childExit,childProven?"true":"false",sidText,childProven?"0":"null",imagePinned?"true":"false",created?"true":"false",created?5:0,mapPrepared?"true":"false",mapInstalled?"true":"false",parentUnchanged?"true":"false",cleanup?"true":"false",profileDeleted?"true":"false",loopback?"true":"false",jsonText(guardedRootNt).c_str(),jsonText(guardedRootId).c_str(),created?"true":"false",jobAssigned?"true":"false",childWaitStatus,childExitRead?"true":"false",childExited?"true":"false",jobQuerySucceeded?"true":"false",jobActiveProcesses,directTerminationAttempted?"true":"false",directTerminationSucceeded?"true":"false",directTerminationError,beforeMap.json().c_str(),afterSetterMap.json().c_str(),afterChildMap.json().c_str());return complete&&cleanup&&profileDeleted&&loopback?0:2;
}
