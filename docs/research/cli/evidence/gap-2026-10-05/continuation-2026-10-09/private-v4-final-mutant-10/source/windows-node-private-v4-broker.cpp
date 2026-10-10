// Independent v4 experiment. The host creates both processes and retains every
// authoritative process handle. Requests carry only three stdio handle values
// from the registered root process; no PID or borrowed process handle is used.
#define wmain privateMapLeafMain
#include "windows-esbuild-private-map-supervisor.cpp"
#undef wmain
#include "windows-node-private-v4-protocol.h"
#include <cwctype>
#include <shellapi.h>

static std::string fileDigest(HANDLE file) {
 BCRYPT_ALG_HANDLE algorithm=nullptr;BCRYPT_HASH_HANDLE hash=nullptr;DWORD objectBytes=0,used=0;std::string result;
 bool ok=BCryptOpenAlgorithmProvider(&algorithm,BCRYPT_SHA256_ALGORITHM,nullptr,0)==0&&BCryptGetProperty(algorithm,BCRYPT_OBJECT_LENGTH,reinterpret_cast<PUCHAR>(&objectBytes),sizeof(objectBytes),&used,0)==0;
 std::vector<BYTE> object(objectBytes),buffer(65536);BYTE bytes[32]={};LARGE_INTEGER zero={};DWORD count=0;
 if(ok)ok=BCryptCreateHash(algorithm,&hash,object.data(),objectBytes,nullptr,0,0)==0&&SetFilePointerEx(file,zero,nullptr,FILE_BEGIN);
 while(ok){if(!ReadFile(file,buffer.data(),static_cast<DWORD>(buffer.size()),&count,nullptr)){ok=false;break;}if(!count)break;ok=BCryptHashData(hash,buffer.data(),count,0)==0;}
 if(ok)ok=BCryptFinishHash(hash,bytes,32,0)==0;if(hash)BCryptDestroyHash(hash);if(algorithm)BCryptCloseAlgorithmProvider(algorithm,0);
 if(ok){char hex[65]={};for(unsigned i=0;i<32;i++)std::snprintf(hex+2*i,3,"%02x",bytes[i]);result=hex;}return result;
}
// Fixed capacity for the measured frozen dependency closure; not caller-configurable.
static constexpr DWORD kPrivateV4GuardNodeLimit=48000;
static bool guardPrivateTree(Handles& handles,const std::wstring& directory,const std::wstring& owner,const std::wstring& sid,DWORD& count){
 if(++count>kPrivateV4GuardNodeLimit||!protect(directory,owner,sid)||pin(handles,directory,true)==INVALID_HANDLE_VALUE)return false;
 WIN32_FIND_DATAW row={};HANDLE search=FindFirstFileW((directory+L"\\*").c_str(),&row);if(search==INVALID_HANDLE_VALUE)return false;bool ok=true;
 do{if(!wcscmp(row.cFileName,L".")||!wcscmp(row.cFileName,L".."))continue;const auto name=directory+L"\\"+row.cFileName;if(row.dwFileAttributes&FILE_ATTRIBUTE_REPARSE_POINT){ok=false;break;}
 if(row.dwFileAttributes&FILE_ATTRIBUTE_DIRECTORY){if(!guardPrivateTree(handles,name,owner,sid,count)){ok=false;break;}}
 else if(++count>kPrivateV4GuardNodeLimit||!protect(name,owner,sid)||pin(handles,name,false)==INVALID_HANDLE_VALUE){ok=false;break;}
 }while(FindNextFileW(search,&row));DWORD error=GetLastError();FindClose(search);return ok&&error==ERROR_NO_MORE_FILES;
}
static std::wstring handleText(HANDLE handle){WCHAR value[32]={};swprintf(value,32,L"%llx",static_cast<unsigned long long>(reinterpret_cast<uintptr_t>(handle)));return value;}
static std::string randomUuid(){BYTE bytes[16];if(BCryptGenRandom(nullptr,bytes,16,BCRYPT_USE_SYSTEM_PREFERRED_RNG)!=0)return "";bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;char text[37]={};std::snprintf(text,37,"%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",bytes[0],bytes[1],bytes[2],bytes[3],bytes[4],bytes[5],bytes[6],bytes[7],bytes[8],bytes[9],bytes[10],bytes[11],bytes[12],bytes[13],bytes[14],bytes[15]);return text;}
static std::wstring widen(const std::string& value){return std::wstring(value.begin(),value.end());}
static bool writeFresh(const std::wstring& path,const std::string& text){HANDLE file=CreateFileW(path.c_str(),GENERIC_WRITE,0,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL|FILE_FLAG_OPEN_REPARSE_POINT,nullptr);if(file==INVALID_HANDLE_VALUE)return false;DWORD written=0;bool ok=WriteFile(file,text.data(),static_cast<DWORD>(text.size()),&written,nullptr)&&written==text.size()&&FlushFileBuffers(file);CloseHandle(file);return ok;}
static bool stdioObject(HANDLE source,unsigned index,DWORD callerPid,HANDLE expectedDisk,const std::wstring& pipePrefix,DWORD& wanted){
 using QueryFn=LONG(NTAPI*)(HANDLE,ULONG,PVOID,ULONG,PULONG);auto query=reinterpret_cast<QueryFn>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"),"NtQueryObject"));if(!query)return false;
 struct NativeName{USHORT length,capacity;PWSTR value;};alignas(void*) BYTE nameBytes[4096]={},basic[56]={};ULONG used=0,granted=0;if(query(source,0,basic,sizeof(basic),&used)<0||used<8)return false;memcpy(&granted,basic+4,4);
 wanted=index==3?0x12019f:index?0x120116:0x120089; // FILE_GENERIC_WRITE / FILE_GENERIC_READ.
 if((granted&wanted)!=wanted)return false;DWORD type=GetFileType(source);
 if(type==FILE_TYPE_DISK){BY_HANDLE_FILE_INFORMATION actual={},expected={};return index==2&&GetFileInformationByHandle(source,&actual)&&GetFileInformationByHandle(expectedDisk,&expected)&&actual.dwVolumeSerialNumber==expected.dwVolumeSerialNumber&&actual.nFileIndexHigh==expected.nFileIndexHigh&&actual.nFileIndexLow==expected.nFileIndexLow&&actual.nNumberOfLinks==1&&!(actual.dwFileAttributes&FILE_ATTRIBUTE_REPARSE_POINT);}
 if(query(source,1,nameBytes,sizeof(nameBytes),&used)<0||used>sizeof(nameBytes))return false;auto* name=reinterpret_cast<NativeName*>(nameBytes);uintptr_t offset=reinterpret_cast<uintptr_t>(name->value)-reinterpret_cast<uintptr_t>(nameBytes);if(name->length%2||offset<sizeof(NativeName)||offset>sizeof(nameBytes)||name->length>sizeof(nameBytes)-offset)return false;std::wstring value(name->value,name->length/2);
 if(type==FILE_TYPE_CHAR){wanted=index?0x120196:0x120089;return value==L"\\Device\\Null"&&(granted&wanted)==wanted;}
 if(type!=FILE_TYPE_PIPE)return false;
 // libuv's exact per-caller AppContainer LOCAL namespace. Anonymous broker
 // transport pipes cannot satisfy this, even though both are PIPE objects.
 const std::wstring suffix=L"-"+std::to_wstring(callerPid);auto marker=value.rfind(L"\\cc-uv-");if(marker==std::wstring::npos||value.size()<=suffix.size()||value.compare(value.size()-suffix.size(),suffix.size(),suffix))return false;
 const size_t first=marker+7,last=value.size()-suffix.size();if(first==last||last-first>20)return false;for(size_t i=first;i<last;i++)if(value[i]<L'0'||value[i]>L'9')return false;
 return marker==pipePrefix.size()-1&&value.rfind(pipePrefix,0)==0;
}

int wmain(int argc,WCHAR** argv){
 if(argc!=2&&(argc!=3||wcscmp(argv[2],L"--probe-unassigned-worker")))return 64;const bool probeUnassigned=argc==3;const std::wstring root=argv[1],control=root+L"\\control",workspace=root+L"\\workspace",scratch=root+L"\\scratch",node=control+L"\\node.exe",esbuild=workspace+L"\\tree\\node_modules\\@esbuild\\win32-x64\\esbuild.exe",shim=workspace+L"\\adapter\\esbuild-private-shim.dll";
 Handles held;PSID appSid=nullptr;std::wstring sid,profile;HANDLE job=nullptr,restricted=nullptr,readOnlyMap=nullptr,rootGuard=nullptr,nodeGuard=nullptr,requestRead=nullptr,replyWrite=nullptr;PROCESS_INFORMATION rootProcess={},serviceProcess={};
 const char* stage="host-token";DWORD guardNodeCount=0;DWORD failure=0,rootExit=STILL_ACTIVE,serviceExit=STILL_ACTIVE,rootWait=WAIT_FAILED,serviceWait=WAIT_FAILED,active=0xffffffff,requests=0;bool complete=false,cleanup=false,profileDeleted=false,loopback=false,rootProven=false,serviceProven=false,mapInstalled=false,serviceMapInstalled=false;LONG serviceMapStatus=0x7fffffff;
 DriveSnapshot before,after;std::string session=randomUuid(),generation=randomUuid();struct Creation {PROCESS_INFORMATION process;bool jobAssigned=false,tokenProven=false,mapInstalled=false;LONG mapStatus=0x7fffffff;DWORD inheritedHandleCount=0,stdioCount=0;};std::vector<Creation> allCreated;
 struct Actor {PROCESS_INFORMATION process={};HANDLE request=nullptr,reply=nullptr;std::string registration,parent;bool worker=false,helper=false,registered=false,service=false,callerOriginalHandleRetained=false;uint64_t sequence=0,creationSequence=0;bool terminationRequested=false,callerHandleObjectCompared=false;std::string terminationRequester;DWORD terminationExitCode=0,preTerminationWait=WAIT_FAILED,preTerminationExit=STILL_ACTIVE,terminationWait=WAIT_FAILED,actualExit=STILL_ACTIVE;bool terminationCallSucceeded=false;DWORD terminationCallError=0;std::vector<BYTE> pending;};std::vector<Actor> actors;actors.reserve(128);
 std::wstring rootNt,runtimeNt,pipePrefix;std::vector<std::wstring> baseEnvironment;
 auto work=[&]()->bool{
  HANDLE token=nullptr;DWORD used=0,container=0;TOKEN_ELEVATION elevation={};alignas(void*) BYTE ownerBytes[1024]={};
  if(!OpenProcessToken(GetCurrentProcess(),TOKEN_QUERY|TOKEN_DUPLICATE|TOKEN_ASSIGN_PRIMARY,&token))return false;held.add(token);
  if(session.empty()||generation.empty()||!GetTokenInformation(token,TokenIsAppContainer,&container,sizeof(container),&used)||container||!GetTokenInformation(token,TokenElevation,&elevation,sizeof(elevation),&used)||elevation.TokenIsElevated||IsTokenRestricted(token)||!GetTokenInformation(token,TokenUser,ownerBytes,sizeof(ownerBytes),&used))return false;
  LPWSTR ownerString=nullptr;if(!ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER*>(ownerBytes)->User.Sid,&ownerString))return false;std::wstring owner=ownerString;LocalFree(ownerString);
  profile=L"cc.private.v4."+widen(session);stage="profile";HRESULT created=CreateAppContainerProfile(profile.c_str(),profile.c_str(),L"Independent same SID host-created service experiment",nullptr,0,&appSid);if(FAILED(created)){failure=created;return false;}
  LPWSTR sidString=nullptr;if(!ConvertSidToStringSidW(appSid,&sidString))return false;sid=sidString;LocalFree(sidString);loopback=noLoopback(appSid);if(!loopback)return false;
  DWORD tokenSession=0;if(!GetTokenInformation(token,TokenSessionId,&tokenSession,sizeof(tokenSession),&used))return false;pipePrefix=L"\\Device\\NamedPipe\\Sessions\\"+std::to_wstring(tokenSession)+L"\\AppContainerNamedObjects\\"+sid+L"\\";
  stage="manifest";
  std::string files;for(const auto& item:std::vector<std::pair<std::string,std::wstring>>{{"identity",L"windows-node-private-v4-identity.cjs"},{"preload",L"windows-node-private-v4-preload.cjs"},{"addon",L"windows-node-private-v4.node"}}){
   HANDLE file=pin(held,workspace+L"\\adapter\\"+item.second,false);LARGE_INTEGER size={};auto hash=fileDigest(file);if(file==INVALID_HANDLE_VALUE||hash.size()!=64||!GetFileSizeEx(file,&size))return false;
   if(!files.empty())files+=",";files+="\""+item.first+"\":{\"path\":\"workspace/adapter/"+jsonText(item.second)+"\",\"sha256\":\""+hash+"\",\"bytes\":"+std::to_string(size.QuadPart)+"}";
  }
  std::string manifest="{\"schema\":\"chainlesschain.windows-node-private-manifest/v4\",\"status\":\"NOT_ADMITTED\",\"experimental\":true,\"admissionEligible\":false,\"stage\":\"frozen-forks\",\"role\":\"root\",\"sessionId\":\""+session+"\",\"generation\":\""+generation+"\",\"appContainerSid\":\""+jsonText(sid)+"\",\"root\":{\"physical\":\""+jsonText(root)+"\",\"logical\":\"X:\\\\\"},\"runtime\":{\"physical\":\""+jsonText(node)+"\",\"logical\":\"X:\\\\control\\\\node.exe\",\"sha256\":\"ae1a50511be58e987483fdbc12125407443926d2d394669ade2352776e920dd3\",\"bytes\":87074816,\"nodeVersion\":\"22.22.2\",\"modulesAbi\":\"127\"},\"files\":{"+files+"}}\n";

  stage="private-tree-guards";if(!exactNames(root,{L"control",L"workspace",L"scratch"})||!protect(root,owner,sid)||!protect(scratch,owner,sid,true))return false;
  guardNodeCount=0;if(!guardPrivateTree(held,control,owner,sid,guardNodeCount)||!guardPrivateTree(held,workspace,owner,sid,guardNodeCount))return false;
  rootGuard=pin(held,root,true);nodeGuard=pin(held,node,false);HANDLE esbuildGuard=pin(held,esbuild,false),shimGuard=pin(held,shim,false);if(rootGuard==INVALID_HANDLE_VALUE||nodeGuard==INVALID_HANDLE_VALUE||esbuildGuard==INVALID_HANDLE_VALUE||shimGuard==INVALID_HANDLE_VALUE||!hashFile(nodeGuard,"ae1a50511be58e987483fdbc12125407443926d2d394669ade2352776e920dd3")||!hashFile(esbuildGuard,"ec02ee9b14ab332416fedd10614dfb80eed5304d94f67745067c011934a8c3c3"))return false;
  WCHAR nt[4096]={};DWORD chars=GetFinalPathNameByHandleW(rootGuard,nt,4096,VOLUME_NAME_NT);if(!chars||chars>=4096)return false;rootNt=nt;chars=GetFinalPathNameByHandleW(nodeGuard,nt,4096,VOLUME_NAME_NT);if(!chars||chars>=4096)return false;runtimeNt=nt;
  stage="device-map";auto native=GetModuleHandleW(L"ntdll.dll");auto createDir=reinterpret_cast<DirFn>(GetProcAddress(native,"NtCreateDirectoryObject"));auto createLink=reinterpret_cast<LinkFn>(GetProcAddress(native,"NtCreateSymbolicLinkObject"));auto setMap=reinterpret_cast<SetFn>(GetProcAddress(native,"NtSetInformationProcess"));if(!createDir||!createLink||!setMap)return false;
  OBJECT_ATTRIBUTES attrs={};attrs.Length=sizeof(attrs);HANDLE map=nullptr;LONG status=createDir(&map,0xF000F,&attrs);if(status<0){failure=status;return false;}held.add(map);WCHAR drive[]=L"X:";UNICODE_STRING name={4,6,drive},target={static_cast<USHORT>(rootNt.size()*2),static_cast<USHORT>((rootNt.size()+1)*2),rootNt.data()};attrs.RootDirectory=map;attrs.ObjectName=&name;attrs.Attributes=0x40;HANDLE link=nullptr;status=createLink(&link,0xF0001,&attrs,&target);if(status<0){failure=status;return false;}held.add(link);
  if(!DuplicateHandle(GetCurrentProcess(),map,GetCurrentProcess(),&readOnlyMap,3,FALSE,0))return false;held.add(readOnlyMap);before=captureDrive();if(!before.known)return false;
  stage="job-and-token";if(!CreateRestrictedToken(token,DISABLE_MAX_PRIVILEGE,0,nullptr,0,nullptr,0,nullptr,&restricted))return false;held.add(restricted);job=held.add(CreateJobObjectW(nullptr,nullptr));JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits={};limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE|JOB_OBJECT_LIMIT_ACTIVE_PROCESS|JOB_OBJECT_LIMIT_PROCESS_MEMORY;limits.BasicLimitInformation.ActiveProcessLimit=6;limits.ProcessMemoryLimit=768*1024*1024;if(!job||!SetInformationJobObject(job,JobObjectExtendedLimitInformation,&limits,sizeof(limits)))return false;
  SECURITY_ATTRIBUTES sa={sizeof(sa),nullptr,TRUE};HANDLE nodeRequest=nullptr,nodeReply=nullptr;if(!CreatePipe(&requestRead,&nodeRequest,&sa,4096)||!CreatePipe(&nodeReply,&replyWrite,&sa,4096))return false;held.add(requestRead);held.add(nodeRequest);held.add(nodeReply);held.add(replyWrite);if(!SetHandleInformation(requestRead,HANDLE_FLAG_INHERIT,0)||!SetHandleInformation(replyWrite,HANDLE_FLAG_INHERIT,0))return false;
  HANDLE nullRead=held.add(CreateFileW(L"NUL",0x120089,3,&sa,OPEN_EXISTING,0,nullptr)),nullWrite=held.add(CreateFileW(L"NUL",0x120196,3,&sa,OPEN_EXISTING,0,nullptr));
  HANDLE rootCopy=nullptr,nodeCopy=nullptr;if(!DuplicateHandle(GetCurrentProcess(),rootGuard,GetCurrentProcess(),&rootCopy,GENERIC_READ,TRUE,0))return false;held.add(rootCopy);if(!DuplicateHandle(GetCurrentProcess(),nodeGuard,GetCurrentProcess(),&nodeCopy,GENERIC_READ,TRUE,0))return false;held.add(nodeCopy);
  HANDLE input=held.add(CreateFileW((scratch+L"\\stdin").c_str(),GENERIC_READ,FILE_SHARE_READ,&sa,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr)),output=held.add(CreateFileW((scratch+L"\\stdout").c_str(),GENERIC_WRITE,FILE_SHARE_READ,&sa,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr)),error=held.add(CreateFileW((scratch+L"\\stderr").c_str(),GENERIC_WRITE,FILE_SHARE_READ,&sa,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr));
  WCHAR system[4096]={};DWORD systemChars=GetEnvironmentVariableW(L"SystemRoot",system,4096);if(!systemChars||systemChars>=4096)return false;
  WCHAR localAppData[MAX_PATH]={};if(FAILED(SHGetFolderPathW(nullptr,CSIDL_LOCAL_APPDATA,nullptr,SHGFP_TYPE_CURRENT,localAppData)))return false;
  baseEnvironment={std::wstring(L"SystemRoot=")+system,std::wstring(L"WINDIR=")+system,std::wstring(L"SystemDrive=")+std::wstring(system,2),std::wstring(L"LOCALAPPDATA=")+localAppData,L"TEMP=X:\\scratch",L"TMP=X:\\scratch",L"CC_WINDOWS_APPCONTAINER_SID="+sid,L"CC_PRIVATE_V4_SESSION="+widen(session),L"CC_PRIVATE_V4_GENERATION="+widen(generation),L"CC_PRIVATE_V4_ROOT_DOS="+root,L"CC_PRIVATE_V4_ROOT_NT="+rootNt};
  auto spawn=[&](const std::wstring& application,std::wstring command,const std::vector<HANDLE>& handles,std::vector<std::wstring> entries,bool leaf,const std::vector<BYTE>& crt,const std::wstring& cwd,PROCESS_INFORMATION& process)->bool{
   for(HANDLE h:handles)if(!h||h==INVALID_HANDLE_VALUE)return false;
   std::sort(entries.begin(),entries.end());std::vector<WCHAR> env;for(const auto& row:entries){env.insert(env.end(),row.begin(),row.end());env.push_back(0);}env.push_back(0);
   SIZE_T bytes=0;InitializeProcThreadAttributeList(nullptr,3,0,&bytes);std::vector<BYTE> store(bytes);auto attributes=reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(store.data());if(!InitializeProcThreadAttributeList(attributes,3,0,&bytes))return false;
   stage=leaf?"service-attributes":"root-attributes";SECURITY_CAPABILITIES caps={appSid,nullptr,0,0};DWORD policy=leaf||command.find(L" -p ")!=std::wstring::npos?1:0;bool valid=UpdateProcThreadAttribute(attributes,0,PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,&caps,sizeof(caps),nullptr,nullptr)&&UpdateProcThreadAttribute(attributes,0,PROC_THREAD_ATTRIBUTE_HANDLE_LIST,const_cast<HANDLE*>(handles.data()),handles.size()*sizeof(HANDLE),nullptr,nullptr)&&UpdateProcThreadAttribute(attributes,0,PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY,&policy,sizeof(policy),nullptr,nullptr);
   STARTUPINFOEXW start={};start.StartupInfo.cb=sizeof(start);start.StartupInfo.dwFlags=STARTF_USESTDHANDLES;start.StartupInfo.hStdInput=handles[0];start.StartupInfo.hStdOutput=handles[1];start.StartupInfo.hStdError=handles[2];start.lpAttributeList=attributes;start.StartupInfo.cbReserved2=static_cast<WORD>(crt.size());start.StartupInfo.lpReserved2=crt.empty()?nullptr:const_cast<BYTE*>(crt.data());
   if(!valid){failure=GetLastError();DeleteProcThreadAttributeList(attributes);return false;}stage=leaf?"service-create-process":"root-create-process";
   BOOL ok=CreateProcessAsUserW(restricted,application.c_str(),command.data(),nullptr,nullptr,TRUE,CREATE_SUSPENDED|CREATE_UNICODE_ENVIRONMENT|EXTENDED_STARTUPINFO_PRESENT|DETACHED_PROCESS,env.data(),cwd.c_str(),&start.StartupInfo,&process);DWORD createError=GetLastError();DeleteProcThreadAttributeList(attributes);if(!ok){failure=createError;return false;}held.add(process.hProcess);held.add(process.hThread);
   allCreated.push_back({process});auto& creation=allCreated.back();creation.inheritedHandleCount=static_cast<DWORD>(handles.size());creation.stdioCount=3;if(!crt.empty())memcpy(&creation.stdioCount,crt.data(),4);if(probeUnassigned&&!leaf&&command.find(L"workers")!=std::wstring::npos){stage="probe-unassigned-worker";failure=ERROR_CANCELLED;return false;}creation.jobAssigned=AssignProcessToJobObject(job,process.hProcess)!=FALSE;if(!creation.jobAssigned)return false;creation.tokenProven=tokenProof(process.hProcess,appSid,job);if(!creation.tokenProven)return false;LONG mapped=setMap(process.hProcess,23,&readOnlyMap,sizeof(readOnlyMap));creation.mapStatus=mapped;creation.mapInstalled=mapped>=0;if(leaf)serviceMapStatus=mapped;if(mapped<0){failure=mapped;return false;}return true;
  };

  auto channels=[&](HANDLE& incoming,HANDLE& outgoing,HANDLE& childRequest,HANDLE& childReply)->bool{
   if(!CreatePipe(&incoming,&childRequest,&sa,4096)||!CreatePipe(&childReply,&outgoing,&sa,4096))return false;
   for(HANDLE h:{incoming,outgoing,childRequest,childReply})held.add(h);
   return SetHandleInformation(incoming,HANDLE_FLAG_INHERIT,0)&&SetHandleInformation(outgoing,HANDLE_FLAG_INHERIT,0);
  };
  auto actorManifest=[&](Actor& actor)->bool{
   std::string role=actor.helper?"report-helper":actor.worker?"worker":"root";
   std::string data=manifest;const std::string old="\"role\":\"root\"";auto roleAt=data.find(old);if(roleAt==std::string::npos)return false;
   data.replace(roleAt,old.size(),"\"role\":\""+role+"\",\"actor\":{\"registrationId\":\""+actor.registration+"\",\"pid\":"+std::to_string(actor.process.dwProcessId)+",\"role\":\""+role+"\",\"parentRegistrationId\":"+(actor.worker?"\""+actor.parent+"\"":"null")+"}");
   std::wstring path=control+L"\\windows-node-private-v4"+(actor.helper?L".report-helper-"+widen(actor.registration):actor.worker?L".worker-"+widen(actor.registration):L"")+L".manifest.json";
   return writeFresh(path,data)&&protect(path,owner,sid)&&pin(held,path,false)!=INVALID_HANDLE_VALUE;
  };
  auto nodeEnvironment=[&](std::vector<std::wstring> entries,HANDLE req,HANDLE rep,const std::string& registration,bool worker,bool helper){
   entries.insert(entries.end(),{L"CC_WINDOWS_NULL_READ_V3="+handleText(nullRead),L"CC_WINDOWS_NULL_WRITE_V3="+handleText(nullWrite),L"CC_PRIVATE_V4_REQUEST="+handleText(req),L"CC_PRIVATE_V4_REPLY="+handleText(rep),L"CC_PRIVATE_V4_ROOT_HANDLE="+handleText(rootCopy),L"CC_PRIVATE_V4_RUNTIME_HANDLE="+handleText(nodeCopy),L"CC_PRIVATE_V4_MANIFEST=X:\\control\\windows-node-private-v4"+(helper?L".report-helper-"+widen(registration):worker?L".worker-"+widen(registration):L"")+L".manifest.json",L"NODE_OPTIONS=--preserve-symlinks --preserve-symlinks-main --require X:\\workspace\\adapter\\windows-node-private-v4-preload.cjs"});return entries;
  };
  stage="create-root";Actor rootActor;rootActor.registration=randomUuid();rootActor.request=requestRead;rootActor.reply=replyWrite;
  auto rootEnv=nodeEnvironment(baseEnvironment,nodeRequest,nodeReply,rootActor.registration,false,false);
  if(!spawn(node,L"\""+node+L"\" --preserve-symlinks --preserve-symlinks-main X:\\control\\check.cjs",{input,output,error,nullRead,nullWrite,nodeRequest,nodeReply,rootCopy,nodeCopy},rootEnv,false,{},workspace,rootProcess))return false;
  rootActor.process=rootProcess;rootProven=true;mapInstalled=true;if(!actorManifest(rootActor))return false;actors.push_back(rootActor);if(ResumeThread(rootProcess.hThread)!=1)return false;
  stage="broker-loop";ULONGLONG deadline=GetTickCount64()+180000;
  while(GetTickCount64()<deadline){
   if(WaitForSingleObject(rootProcess.hProcess,0)==WAIT_OBJECT_0)break;bool progress=false;
   for(size_t actorIndex=0;actorIndex<actors.size();actorIndex++){
    Actor& caller=actors[actorIndex];if(caller.service||WaitForSingleObject(caller.process.hProcess,0)==WAIT_OBJECT_0)continue;
    DWORD available=0;if(!PeekNamedPipe(caller.request,nullptr,0,nullptr,&available,nullptr)){failure=GetLastError();return false;}
    if(available){
     if(caller.pending.size()>=kPrivateV4MaxFrame){failure=ERROR_BUFFER_OVERFLOW;return false;}
     BYTE bytes[4096];DWORD read=0;DWORD count=std::min<DWORD>(available,std::min<DWORD>(sizeof(bytes),static_cast<DWORD>(kPrivateV4MaxFrame-caller.pending.size())));
     if(!ReadFile(caller.request,bytes,count,&read,nullptr)||read!=count)return false;caller.pending.insert(caller.pending.end(),bytes,bytes+read);progress=true;
    }
    if(caller.pending.size()<sizeof(PrivateV4Request))continue;
    PrivateV4Request request={};memcpy(&request,caller.pending.data(),sizeof(request));
    if(request.magic!=kPrivateV4Magic||request.version!=2||request.bytes<sizeof(request)||request.bytes>kPrivateV4MaxFrame||request.reserved){failure=ERROR_INVALID_DATA;return false;}
    if(caller.pending.size()<request.bytes)continue;if(caller.pending.size()!=request.bytes){failure=ERROR_INVALID_DATA;return false;}
    if(request.operation==0){
     PrivateV4Request expected={};expected.magic=kPrivateV4Magic;expected.version=2;expected.bytes=sizeof(expected);
     if(caller.registered||memcmp(&request,&expected,sizeof(expected))){failure=ERROR_INVALID_DATA;return false;}
     PrivateV4Registration registration={};registration.magic=kPrivateV4Magic;registration.version=2;registration.bytes=sizeof(registration);registration.processId=caller.process.dwProcessId;registration.role=caller.helper?3:caller.worker?2:1;
     strcpy(registration.registrationId,caller.registration.c_str());strcpy(registration.parentRegistrationId,caller.parent.c_str());strcpy(registration.sessionId,session.c_str());strcpy(registration.generation,generation.c_str());std::string sidUtf8=jsonText(sid);if(sidUtf8.size()>=sizeof(registration.appContainerSid))return false;strcpy(registration.appContainerSid,sidUtf8.c_str());
     DWORD written=0;if(!WriteFile(caller.reply,&registration,sizeof(registration),&written,nullptr)||written!=sizeof(registration))return false;caller.registered=true;caller.pending.clear();continue;
    }

    if(request.operation==4){
     stage="broker-termination-policy";
     if(!caller.registered||caller.helper||request.bytes!=sizeof(request)||request.sequence!=caller.sequence+1||request.descriptorCount||request.commandChars||request.environmentChars||request.directoryChars||request.descriptorFlags[0]||request.descriptorFlags[1]||request.descriptorFlags[2]||request.descriptorFlags[3]||!request.standardHandles[0]||request.standardHandles[1]!=1||!request.standardHandles[2]||request.standardHandles[3]){failure=ERROR_INVALID_DATA;return false;}
     Actor* target=nullptr;for(auto& a:actors)if(a.parent==caller.registration&&a.creationSequence==request.standardHandles[0]){if(target){failure=ERROR_INVALID_DATA;return false;}target=&a;}
     if(!target||!target->worker||target->helper||target->terminationRequested){failure=ERROR_INVALID_DATA;return false;}
     HANDLE observed=nullptr;using CompareFn=BOOL(WINAPI*)(HANDLE,HANDLE);auto compare=reinterpret_cast<CompareFn>(GetProcAddress(GetModuleHandleW(L"kernelbase.dll"),"CompareObjectHandles"));
     if(!compare||!DuplicateHandle(caller.process.hProcess,reinterpret_cast<HANDLE>(request.standardHandles[2]),GetCurrentProcess(),&observed,0,FALSE,DUPLICATE_SAME_ACCESS))return false;
     bool same=compare(observed,target->process.hProcess)!=FALSE;CloseHandle(observed);if(!same){failure=ERROR_ACCESS_DENIED;return false;}
     target->callerHandleObjectCompared=true;target->preTerminationWait=WaitForSingleObject(target->process.hProcess,0);if((target->preTerminationWait!=WAIT_TIMEOUT&&target->preTerminationWait!=WAIT_OBJECT_0)||!GetExitCodeProcess(target->process.hProcess,&target->preTerminationExit)){failure=ERROR_INVALID_STATE;return false;}
     target->terminationCallSucceeded=TerminateProcess(target->process.hProcess,1)!=FALSE;target->terminationCallError=target->terminationCallSucceeded?ERROR_SUCCESS:GetLastError();target->terminationWait=WaitForSingleObject(target->process.hProcess,3000);if(target->terminationWait!=WAIT_OBJECT_0||!GetExitCodeProcess(target->process.hProcess,&target->actualExit)||target->actualExit==STILL_ACTIVE)return false;
     if(target->terminationCallSucceeded){if(target->preTerminationWait!=WAIT_TIMEOUT||target->preTerminationExit!=STILL_ACTIVE||target->actualExit!=1){failure=ERROR_INVALID_STATE;return false;}target->terminationRequested=true;target->callerHandleObjectCompared=true;target->terminationRequester=caller.registration;target->terminationExitCode=1;}
     else if(target->terminationCallError!=ERROR_ACCESS_DENIED){failure=target->terminationCallError;return false;}
     caller.sequence=request.sequence;PrivateV4Response response={kPrivateV4Magic,2,sizeof(PrivateV4Response),target->terminationCallError,request.sequence,0,0,target->process.dwProcessId,0,{0,0}};DWORD written=0;if(!WriteFile(caller.reply,&response,sizeof(response),&written,nullptr)||written!=sizeof(response))return false;caller.pending.clear();stage="broker-loop";continue;
    }

    stage="broker-request-policy";bool helper=request.operation==3,worker=request.operation==2||helper,leaf=request.operation==1;
    if(!caller.registered||caller.helper||(!leaf&&!worker)||request.sequence!=caller.sequence+1||request.sequence>512||requests>=512||actors.size()>=128||(worker&&!helper&&caller.worker)||request.descriptorCount!=(worker&&!helper?4u:3u)){failure=ERROR_INVALID_DATA;return false;}
    if(request.descriptorCount==3&&(request.standardHandles[3]||request.descriptorFlags[3])){failure=ERROR_INVALID_DATA;return false;}
    if(leaf&&(request.bytes!=sizeof(request)||request.commandChars||request.directoryChars||request.environmentChars||request.standardHandles[3]||request.descriptorFlags[3])){failure=ERROR_INVALID_DATA;return false;}
    unsigned liveWorkers=0,liveServices=0;for(const auto& actor:actors)if(WaitForSingleObject(actor.process.hProcess,0)!=WAIT_OBJECT_0){if(actor.worker&&!actor.helper)liveWorkers++;if(actor.service){liveServices++;if(actor.parent==caller.registration&&leaf){failure=ERROR_BUSY;return false;}}}
    if((worker&&!helper&&liveWorkers>=2)||(leaf&&liveServices>=3)){failure=ERROR_TOO_MANY_CMDS;return false;}
    std::wstring workerCommand;auto workerEnv=baseEnvironment;
    if(worker){
     const uint64_t chars=static_cast<uint64_t>(request.commandChars)+request.directoryChars+request.environmentChars;
     if(!request.commandChars||request.commandChars>8192||!request.directoryChars||request.directoryChars>4096||request.environmentChars<2||request.environmentChars>16384||sizeof(request)+chars*2!=request.bytes){failure=ERROR_INVALID_DATA;return false;}
     const WCHAR* command=reinterpret_cast<const WCHAR*>(caller.pending.data()+sizeof(request));const WCHAR* cwd=command+request.commandChars;const WCHAR* environment=cwd+request.directoryChars;
     if(command[request.commandChars-1]||wcsnlen(command,request.commandChars)!=request.commandChars-1||cwd[request.directoryChars-1]||wcsnlen(cwd,request.directoryChars)!=request.directoryChars-1||wcscmp(cwd,L"X:\\workspace\\tree\\packages\\cli")||environment[request.environmentChars-1]||environment[request.environmentChars-2]){failure=ERROR_INVALID_DATA;return false;}
     stage="worker-command-policy";int argc=0;LPWSTR* args=CommandLineToArgvW(command,&argc);bool commandOkay=args&&argc>=2&&(node==args[0]||!wcscmp(args[0],L"X:\\control\\node.exe"));
     const std::wstring workerEntry=L"X:\\workspace\\tree\\node_modules\\vitest\\dist\\workers\\forks.js",warnings=L"X:\\workspace\\tree\\node_modules\\vitest\\suppress-warnings.cjs";
     if(commandOkay&&helper)commandOkay=argc==3&&!wcscmp(args[1],L"-p")&&!wcscmp(args[2],L"const r=require('node:process').report;r.excludeNetwork=true;console.log(JSON.stringify(r.getReport().header));");
     if(commandOkay&&!helper){std::wstring entry=args[argc-1];std::replace(entry.begin(),entry.end(),L'/',L'\\');commandOkay=entry==workerEntry;}
     for(int i=1;commandOkay&&!helper&&i<argc-1;i++){
      std::wstring arg=args[i];if(arg==L"--experimental-import-meta-resolve"||arg==L"--preserve-symlinks"||arg==L"--preserve-symlinks-main")continue;
      if(arg==L"--require"&&i+1<argc-1){std::wstring required=args[++i];std::replace(required.begin(),required.end(),L'/',L'\\');if(required==warnings)continue;}
      if(arg.rfind(L"--conditions=",0)==0||(arg==L"--conditions"&&i+1<argc-1)){std::wstring value=arg==L"--conditions"?args[++i]:arg.substr(13);bool valid=!value.empty()&&value.size()<64;for(WCHAR c:value)if(!((c>=L'a'&&c<=L'z')||(c>=L'A'&&c<=L'Z')||(c>=L'0'&&c<=L'9')||c==L'-'||c==L'_'))valid=false;if(valid)continue;}
      commandOkay=false;
     }
     if(args)LocalFree(args);if(!commandOkay){std::fwprintf(stderr,L"Rejected worker command: %ls\n",command);failure=ERROR_NOT_SUPPORTED;return false;}workerCommand=command;
     stage="worker-environment-policy";bool ipcFd=false,ipcMode=false;std::vector<std::wstring> keys;
     size_t offset=0;for(;offset+1<request.environmentChars&&environment[offset];){
      size_t length=wcsnlen(environment+offset,request.environmentChars-offset);if(!length||offset+length>=request.environmentChars)return false;std::wstring row(environment+offset,length);offset+=length+1;auto equals=row.find(L'=');if(!equals||equals==std::wstring::npos)return false;
      std::wstring key=row.substr(0,equals);std::transform(key.begin(),key.end(),key.begin(),towupper);if(std::find(keys.begin(),keys.end(),key)!=keys.end())return false;keys.push_back(key);
      if(key==L"NODE_CHANNEL_FD"){if(row.substr(equals+1)!=L"3")return false;ipcFd=true;}
      if(key==L"NODE_CHANNEL_SERIALIZATION_MODE"){if(row.substr(equals+1)!=L"advanced")return false;ipcMode=true;}
      bool controlled=(key.rfind(L"CC_PRIVATE_V4_",0)==0||key.rfind(L"CC_WINDOWS_NULL_",0)==0||key==L"CC_WINDOWS_APPCONTAINER_SID")||key==L"NODE_OPTIONS"||key==L"NODE_PATH"||key==L"PATH"||key==L"SYSTEMROOT"||key==L"WINDIR"||key==L"SYSTEMDRIVE"||key==L"LOCALAPPDATA"||key==L"TEMP"||key==L"TMP";
      if(!controlled)workerEnv.push_back(row);
     }
     if(offset!=request.environmentChars-1||(!helper&&(!ipcFd||!ipcMode))||(helper&&(ipcFd||ipcMode)))return false;
    }
    caller.sequence=request.sequence;requests++;
    stage="broker-stdio-identity";Handles childHandles;std::vector<HANDLE> standards;
    for(unsigned i=0;i<request.descriptorCount;i++){
     HANDLE observed=nullptr;if(!request.standardHandles[i]||!DuplicateHandle(caller.process.hProcess,reinterpret_cast<HANDLE>(request.standardHandles[i]),GetCurrentProcess(),&observed,0,FALSE,DUPLICATE_SAME_ACCESS))return false;childHandles.add(observed);DWORD wanted=0;
     if(!stdioObject(observed,i,caller.process.dwProcessId,error,pipePrefix,wanted)){failure=ERROR_NOT_SUPPORTED;return false;}DWORD type=GetFileType(observed);BYTE expected=type==FILE_TYPE_PIPE?0x09:type==FILE_TYPE_DISK?0x01:0x41;if(request.descriptorFlags[i]!=expected)return false;
     HANDLE reduced=nullptr;if(!DuplicateHandle(GetCurrentProcess(),observed,GetCurrentProcess(),&reduced,wanted,TRUE,0))return false;childHandles.add(reduced);standards.push_back(reduced);
    }
    Actor child;child.creationSequence=request.sequence;child.callerOriginalHandleRetained=GetProcessId(caller.process.hProcess)==caller.process.dwProcessId;if(!child.callerOriginalHandleRetained)return false;child.worker=worker;child.helper=helper;child.service=leaf;child.registration=randomUuid();child.parent=caller.registration;if(child.registration.empty())return false;
    if(worker){
     HANDLE req=nullptr,rep=nullptr;if(!channels(child.request,child.reply,req,rep))return false;
     HANDLE workerRuntime=childHandles.add(CreateFileW(node.c_str(),GENERIC_READ,FILE_SHARE_READ,&sa,OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT,nullptr));if(workerRuntime==INVALID_HANDLE_VALUE)return false;
     workerEnv=nodeEnvironment(workerEnv,req,rep,child.registration,true,helper);for(auto& row:workerEnv)if(row.rfind(L"CC_PRIVATE_V4_RUNTIME_HANDLE=",0)==0)row=L"CC_PRIVATE_V4_RUNTIME_HANDLE="+handleText(workerRuntime);auto handles=standards;handles.insert(handles.end(),{nullRead,nullWrite,req,rep,rootCopy,workerRuntime});
     uint32_t descriptors=request.descriptorCount;std::vector<BYTE> crt(4+descriptors+descriptors*sizeof(HANDLE));memcpy(crt.data(),&descriptors,4);memcpy(crt.data()+4,request.descriptorFlags,descriptors);memcpy(crt.data()+4+descriptors,standards.data(),descriptors*sizeof(HANDLE));
     if(!spawn(node,workerCommand,handles,workerEnv,false,crt,workspace+L"\\tree\\packages\\cli",child.process)||!actorManifest(child))return false;
    }else{
     const std::wstring traceName=scratch+L"\\esbuild-trace-"+std::to_wstring(requests)+L".jsonl";
     HANDLE trace=childHandles.add(CreateFileW(traceName.c_str(),GENERIC_WRITE,FILE_SHARE_READ,&sa,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr)),mapCopy=nullptr;if(!DuplicateHandle(GetCurrentProcess(),readOnlyMap,GetCurrentProcess(),&mapCopy,3,TRUE,0))return false;childHandles.add(mapCopy);
     BY_HANDLE_FILE_INFORMATION rootInfo={};if(!GetFileInformationByHandle(rootGuard,&rootInfo))return false;WCHAR rootId[96]={};swprintf(rootId,96,L"%08lx:%08lx:%08lx",rootInfo.dwVolumeSerialNumber,rootInfo.nFileIndexHigh,rootInfo.nFileIndexLow);
     auto serviceEnv=baseEnvironment;serviceEnv.insert(serviceEnv.end(),{L"CC_ESBUILD_TRACE_HANDLE="+handleText(trace),L"CC_ESBUILD_TRACE_MAP_HANDLE="+handleText(mapCopy),L"CC_ESBUILD_TRACE_SID="+sid,L"CC_ESBUILD_TRACE_ROOT_NT="+rootNt,std::wstring(L"CC_ESBUILD_TRACE_ROOT_ID=")+rootId});
     if(!spawn(esbuild,L"\""+esbuild+L"\" --service=0.28.1 --ping",{standards[0],standards[1],standards[2],trace,mapCopy},serviceEnv,true,{},workspace,child.process))return false;
     serviceProcess=child.process;serviceProven=true;serviceMapInstalled=true;
     stage="service-shim";std::wstring loaderPath=L"\\\\?\\GLOBALROOT"+rootNt+L"\\workspace\\adapter\\esbuild-private-shim.dll";SIZE_T bytes=(loaderPath.size()+1)*2,written=0;void* remote=VirtualAllocEx(child.process.hProcess,nullptr,bytes,MEM_COMMIT|MEM_RESERVE,PAGE_READWRITE);if(!remote||!WriteProcessMemory(child.process.hProcess,remote,loaderPath.c_str(),bytes,&written)||written!=bytes||!QueueUserAPC(reinterpret_cast<PAPCFUNC>(GetProcAddress(GetModuleHandleW(L"kernel32.dll"),"LoadLibraryW")),child.process.hThread,reinterpret_cast<ULONG_PTR>(remote)))return false;
    }
    PrivateV4Response response={kPrivateV4Magic,2,sizeof(PrivateV4Response),0,request.sequence,0,0,child.process.dwProcessId,child.process.dwThreadId,{0,0}};HANDLE processCopy=nullptr,threadCopy=nullptr;
    if(!DuplicateHandle(GetCurrentProcess(),child.process.hProcess,caller.process.hProcess,&processCopy,SYNCHRONIZE|PROCESS_QUERY_LIMITED_INFORMATION,FALSE,0)||!DuplicateHandle(GetCurrentProcess(),child.process.hThread,caller.process.hProcess,&threadCopy,SYNCHRONIZE,FALSE,0))return false;
    response.processHandle=reinterpret_cast<uintptr_t>(processCopy);response.threadHandle=reinterpret_cast<uintptr_t>(threadCopy);
    DWORD replied=0;if(ResumeThread(child.process.hThread)!=1||!WriteFile(caller.reply,&response,sizeof(response),&replied,nullptr)||replied!=sizeof(response))return false;
    caller.pending.clear();actors.push_back(std::move(child));stage="broker-loop";
   }
   if(!progress)Sleep(2);
  }
  stage="root-settlement";rootWait=WaitForSingleObject(rootProcess.hProcess,0);if(rootWait!=WAIT_OBJECT_0){failure=rootWait==WAIT_TIMEOUT?ERROR_TIMEOUT:GetLastError();return false;}if(!GetExitCodeProcess(rootProcess.hProcess,&rootExit)){failure=GetLastError();return false;}
  for(const auto& actor:actors){DWORD exit=STILL_ACTIVE;DWORD wait=WaitForSingleObject(actor.process.hProcess,3000);if(wait!=WAIT_OBJECT_0||!GetExitCodeProcess(actor.process.hProcess,&exit)){failure=wait==WAIT_TIMEOUT?ERROR_TIMEOUT:GetLastError();return false;}if(actor.process.hProcess!=rootProcess.hProcess&&exit&&!(actor.worker&&!actor.helper&&exit==1&&actor.terminationRequested&&actor.callerHandleObjectCompared&&actor.terminationExitCode==1&&actor.terminationRequester==actor.parent)){failure=exit;return false;}if(!actor.service&&!actor.registered){failure=ERROR_INVALID_STATE;return false;}if(actor.service){serviceWait=wait;serviceExit=exit;}}
  if(rootExit){failure=rootExit;return false;}stage="completed";return true;
 };
 complete=work();if(!complete&&!failure)failure=GetLastError();if(job)TerminateJobObject(job,125);
 bool stopped=true;for(auto& created:allCreated){auto& process=created.process;if(WaitForSingleObject(process.hProcess,0)!=WAIT_OBJECT_0)TerminateProcess(process.hProcess,125);DWORD exit=STILL_ACTIVE;stopped=WaitForSingleObject(process.hProcess,3000)==WAIT_OBJECT_0&&GetExitCodeProcess(process.hProcess,&exit)&&exit!=STILL_ACTIVE&&stopped;}
 if(job){JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting={};if(QueryInformationJobObject(job,JobObjectBasicAccountingInformation,&accounting,sizeof(accounting),nullptr))active=accounting.ActiveProcesses;}cleanup=stopped&&(!job||active==0);after=captureDrive();
 if(appSid){loopback=loopback&&noLoopback(appSid);profileDeleted=cleanup&&SUCCEEDED(DeleteAppContainerProfile(profile.c_str()));FreeSid(appSid);}
 std::string ledger="[";for(size_t i=0;i<allCreated.size();i++){const auto& c=allCreated[i];DWORD exit=STILL_ACTIVE;DWORD wait=WaitForSingleObject(c.process.hProcess,0);bool exitKnown=GetExitCodeProcess(c.process.hProcess,&exit)!=FALSE;const Actor* actor=nullptr;for(const auto& a:actors)if(a.process.hProcess==c.process.hProcess)actor=&a;if(i)ledger+=",";ledger+="{\"terminationCallError\":"+std::to_string(actor?actor->terminationCallError:0)+",\"preTerminationWait\":"+std::to_string(actor?actor->preTerminationWait:WAIT_FAILED)+",\"preTerminationExit\":"+std::to_string(actor?actor->preTerminationExit:STILL_ACTIVE)+",\"terminationCallSucceeded\":"+(actor&&actor->terminationCallSucceeded?"true":"false")+",\"terminationWait\":"+std::to_string(actor?actor->terminationWait:WAIT_FAILED)+",\"actualExit\":"+std::to_string(actor?actor->actualExit:STILL_ACTIVE)+",\"creationSequence\":"+std::to_string(actor?actor->creationSequence:0)+",\"terminationChildSequence\":"+std::to_string(actor&&actor->terminationRequested?actor->creationSequence:0)+",\"terminationRequested\":"+(actor&&actor->terminationRequested?"true":"false")+",\"terminationRequesterRegistrationId\":"+(actor&&actor->terminationRequested?"\""+actor->terminationRequester+"\"":"null")+",\"terminationExitCode\":"+std::to_string(actor?actor->terminationExitCode:0)+",\"callerHandleObjectCompared\":"+(actor&&actor->callerHandleObjectCompared?"true":"false")+",\"inheritedHandleCount\":"+std::to_string(c.inheritedHandleCount)+",\"stdioCount\":"+std::to_string(c.stdioCount)+",\"callerOriginalHandleRetained\":"+(actor&&actor->callerOriginalHandleRetained?"true":"false")+",\"commandKind\":\""+(actor?actor->service?"fixed-esbuild-service":actor->helper?"fixed-node-report-header":actor->worker?"frozen-vitest-forks-entry":"trusted-root-checker":"unsettled-created-process")+"\",\"pid\":"+std::to_string(c.process.dwProcessId)+",\"jobAssigned\":"+(c.jobAssigned?"true":"false")+",\"tokenAndSameJobProven\":"+(c.tokenProven?"true":"false")+",\"mapInstalled\":"+(c.mapInstalled?"true":"false")+",\"mapStatus\":"+std::to_string(static_cast<DWORD>(c.mapStatus))+",\"wait\":"+std::to_string(wait)+",\"exitKnown\":"+(exitKnown?"true":"false")+",\"exit\":"+std::to_string(exit)+",\"kind\":\""+(actor?actor->service?"esbuild-service":actor->helper?"report-helper":actor->worker?"vitest-worker":"root":"unregistered-created-process")+"\",\"registrationId\":\""+(actor?actor->registration:"")+"\",\"parentRegistrationId\":"+(actor&&!actor->parent.empty()?"\""+actor->parent+"\"":"null")+",\"registered\":"+(actor&&actor->registered?"true":"false")+",\"launchRequests\":"+std::to_string(actor?actor->sequence:0)+"}";}ledger+="]";
 std::printf("{\"guardNodeCount\":%lu,\"guardNodeLimit\":%lu,\"creationLedger\":%s,\"schema\":\"chainlesschain.windows-private-broker/v4\",\"status\":\"NOT_ADMITTED\",\"completed\":%s,\"stage\":\"%s\",\"error\":%lu,\"hostPid\":%lu,\"rootPid\":%lu,\"servicePid\":%lu,\"rootTokenAndSameJobProven\":%s,\"serviceTokenAndSameJobProven\":%s,\"rootMapInstalled\":%s,\"serviceMapInstalled\":%s,\"serviceMapStatus\":%lu,\"rootWait\":%lu,\"serviceWait\":%lu,\"rootExit\":%lu,\"serviceExit\":%lu,\"requests\":%lu,\"serviceParent\":\"host-custodian\",\"cleanupConfirmed\":%s,\"jobActiveProcesses\":%lu,\"profileDeleted\":%s,\"loopbackExemptionAbsent\":%s,\"hostMapUnchanged\":%s,\"sessionId\":\"%s\",\"generation\":\"%s\",\"appContainerSid\":\"%s\"}\n",guardNodeCount,kPrivateV4GuardNodeLimit,ledger.c_str(),complete?"true":"false",stage,failure,GetCurrentProcessId(),rootProcess.dwProcessId,serviceProcess.dwProcessId,rootProven?"true":"false",serviceProven?"true":"false",mapInstalled?"true":"false",serviceMapInstalled?"true":"false",static_cast<DWORD>(serviceMapStatus),rootWait,serviceWait,rootExit,serviceExit,requests,cleanup?"true":"false",active,profileDeleted?"true":"false",loopback?"true":"false",sameDrive(before,after)?"true":"false",session.c_str(),generation.c_str(),jsonText(sid).c_str());
 return complete&&cleanup&&profileDeleted&&loopback&&sameDrive(before,after)?0:2;
}
