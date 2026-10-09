// Standalone finite-set lifecycle experiment, not a sandbox or durable service.
// Only Custodian() creates the target Job handle; it never duplicates/exports it.
// Witness owns a separate safety Job. Atomic JOB_LIST creation protects even
// suspended fixtures if the witness is externally killed before assignment.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal static class CustodianCrashProbe {
    const uint Suspended=4, DetachedProcess=8, ExtendedStartup=0x00080000;
    const uint RetainedRights=0x00101001, QueryLimited=0x1000, HandleInherit=1;
    const uint Timeout=258, StillActive=259, CrashExit=188, FallbackExit=125;
    const uint ActiveLimit=8, KillOnClose=0x2000, Breakaway=0x1800;
    static readonly JavaScriptSerializer Json=new JavaScriptSerializer();
    static readonly string[] Roles={"member-a","member-b","member-c"};
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    struct Startup { public int cb; public string reserved,desktop,title; public uint x,y,xs,ys,xc,yc,fill,flags; public ushort show,reserved2; public IntPtr reservedPtr,input,output,error; }
    [StructLayout(LayoutKind.Sequential)] struct StartupEx { public Startup start; public IntPtr attributes; }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process,thread; public uint pid,tid; }
    [StructLayout(LayoutKind.Sequential)] struct Limits { public long processTime,jobTime; public uint flags; public UIntPtr minimum,maximum; public uint active; public UIntPtr affinity; public uint priority,scheduling; }
    [StructLayout(LayoutKind.Sequential)] struct Io { public ulong a,b,c,d,e,f; }
    [StructLayout(LayoutKind.Sequential)] struct Extended { public Limits basic; public Io io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
    [StructLayout(LayoutKind.Sequential)] struct Accounting { public long a,b,c,d; public uint faults,total,active,terminated; }
    [StructLayout(LayoutKind.Sequential)] struct ObjectBasic { public uint attributes,access,handles,pointers,paged,nonpaged; public uint r1,r2,r3,name,type,security; public long created; }
    [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode,EntryPoint="CreateProcessW")]
    static extern bool CreateProcessEx(string image,StringBuilder args,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref StartupEx startup,out ProcessInfo info);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr bytes);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr bytes,IntPtr previous,IntPtr returned);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle,uint mask,uint flags);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetHandleInformation(IntPtr handle,out uint flags);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool DuplicateHandle(IntPtr source,IntPtr handle,IntPtr target,out IntPtr result,uint access,bool inherit,uint options);
    [DllImport("kernelbase.dll",SetLastError=true)] static extern bool CompareObjectHandles(IntPtr first,IntPtr second);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll",SetLastError=true)] static extern uint GetProcessId(IntPtr process);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr handle,out uint code);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
    [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref Extended value,int bytes);
    [DllImport("kernel32.dll",SetLastError=true,EntryPoint="QueryInformationJobObject")] static extern bool QueryLimits(IntPtr job,int kind,out Extended value,int bytes,IntPtr returned);
    [DllImport("kernel32.dll",SetLastError=true,EntryPoint="QueryInformationJobObject")] static extern bool QueryAccounting(IntPtr job,int kind,out Accounting value,int bytes,IntPtr returned);
    [DllImport("kernel32.dll",SetLastError=true,EntryPoint="QueryInformationJobObject")] static extern bool QueryProcessList(IntPtr job,int kind,IntPtr value,int bytes,IntPtr returned);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool member);
    [DllImport("ntdll.dll")] static extern int NtQueryObject(IntPtr handle,int kind,out ObjectBasic value,int bytes,IntPtr returned);
    static void Check(bool value,string message) { if(!value) throw new Win32Exception(Marshal.GetLastWin32Error(),message); }
    static void Require(bool value,string message) { if(!value) throw new InvalidOperationException(message); }
    static bool Member(IntPtr process,IntPtr job) { bool result; Check(IsProcessInJob(process,job,out result),"IsProcessInJob"); return result; }
    static ObjectBasic ObjectInfo(IntPtr handle) { ObjectBasic value; Require(NtQueryObject(handle,0,out value,Marshal.SizeOf(typeof(ObjectBasic)),IntPtr.Zero)==0,"NtQueryObject failed"); return value; }
    static bool NonInherited(IntPtr handle) { uint flags; Check(GetHandleInformation(handle,out flags),"GetHandleInformation"); return (flags&HandleInherit)==0; }
    static IntPtr Reduce(IntPtr original,uint rights,bool inherit) {
        IntPtr reduced; Check(DuplicateHandle(GetCurrentProcess(),original,GetCurrentProcess(),out reduced,rights,inherit,0),"DuplicateHandle(process only)");
        if(!CompareObjectHandles(original,reduced)) { CloseHandle(reduced); throw new Exception("Process handle object changed"); }
        Require(ObjectInfo(reduced).access==rights,"Unexpected retained process rights"); return reduced;
    }
    static string Command(string args) { return "\""+Process.GetCurrentProcess().MainModule.FileName+"\" "+args; }
    static ProcessInfo LaunchGuarded(string args,IntPtr guard,IntPtr[] inherited) {
        IntPtr bytes=IntPtr.Zero,list=IntPtr.Zero,array=IntPtr.Zero,jobs=IntPtr.Zero; bool initialized=false;
        try {
            int count=inherited.Length==0?1:2;
            InitializeProcThreadAttributeList(IntPtr.Zero,count,0,ref bytes); Require(bytes.ToInt64()>0,"Attribute list size missing");
            list=Marshal.AllocHGlobal(bytes); Check(InitializeProcThreadAttributeList(list,count,0,ref bytes),"InitializeProcThreadAttributeList"); initialized=true;
            jobs=Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobs,guard);
            Check(UpdateProcThreadAttribute(list,0,new IntPtr(0x2000d),jobs,new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero),"Atomic creation JOB_LIST");
            if(inherited.Length>0) {
                array=Marshal.AllocHGlobal(IntPtr.Size*inherited.Length); Marshal.Copy(inherited,0,array,inherited.Length);
                foreach(IntPtr handle in inherited) Check(SetHandleInformation(handle,HandleInherit,HandleInherit),"Mark explicit inheritance");
                Check(UpdateProcThreadAttribute(list,0,new IntPtr(0x20002),array,new IntPtr(IntPtr.Size*inherited.Length),IntPtr.Zero,IntPtr.Zero),"Explicit HANDLE_LIST");
            }
            StartupEx startup=new StartupEx(); startup.start.cb=Marshal.SizeOf(typeof(StartupEx)); startup.attributes=list; ProcessInfo result;
            // Socket-only children do not need a console. DETACHED_PROCESS
            // avoids separate headless console infrastructure in the safety Job.
            Check(CreateProcessEx(Process.GetCurrentProcess().MainModule.FileName,new StringBuilder(Command(args)),IntPtr.Zero,IntPtr.Zero,inherited.Length>0,Suspended|DetachedProcess|ExtendedStartup,IntPtr.Zero,null,ref startup,out result),"CreateProcess(atomic safety Job)"); return result;
        } finally {
            foreach(IntPtr handle in inherited) SetHandleInformation(handle,HandleInherit,0);
            if(initialized) DeleteProcThreadAttributeList(list); if(list!=IntPtr.Zero) Marshal.FreeHGlobal(list); if(array!=IntPtr.Zero) Marshal.FreeHGlobal(array); if(jobs!=IntPtr.Zero) Marshal.FreeHGlobal(jobs);
        }
    }
    public sealed class Binding { public string role; public uint pid; public bool assignedBeforeResume,memberBeforeResume; }
    public sealed class SetupProof { public uint flags,activeLimit,activeMembers,jobHandleCount; public bool unnamed,jobNonInheritable,custodianOutside,witnessOutside,noBreakaway; public int inheritedHandleCount; public Binding[] members; }
    public sealed class Hello { public string role,nonce; public uint pid; public SetupProof setup; }
    sealed class Peer : IDisposable {
        public TcpClient socket; public StreamReader reader; public StreamWriter writer; public Hello hello;
        public Peer(TcpClient client) { socket=client; socket.NoDelay=true; socket.GetStream().ReadTimeout=5000; socket.GetStream().WriteTimeout=5000; reader=new StreamReader(socket.GetStream(),new UTF8Encoding(false,true)); writer=new StreamWriter(socket.GetStream(),new UTF8Encoding(false)); writer.AutoFlush=true; }
        public void Challenge(string nonce) { writer.WriteLine("PING "+nonce); Require(reader.ReadLine()=="PONG "+nonce+" "+hello.role,"Existing socket challenge failed"); }
        public string Terminal(int timeout) {
            socket.GetStream().ReadTimeout=Math.Max(1,timeout);
            try { if(reader.ReadLine()==null) return "eof"; throw new Exception("Unexpected data instead of socket termination"); }
            catch(IOException error) { SocketException cause=error.InnerException as SocketException; if(cause!=null&&cause.SocketErrorCode==SocketError.ConnectionReset) return "reset"; throw; }
        }
        public void Dispose() { socket.Close(); }
    }
    static Peer Connect(int port,Hello hello) { TcpClient client=new TcpClient(); client.Connect(IPAddress.Loopback,port); Peer peer=new Peer(client); peer.hello=hello; peer.writer.WriteLine(Json.Serialize(hello)); return peer; }
    static int Fixture(string[] args) {
        string role=args[1],nonce=args[2]; int port=int.Parse(args[3]);
        using(Peer peer=Connect(port,new Hello {role=role,nonce=nonce,pid=(uint)Process.GetCurrentProcess().Id})) {
            peer.socket.GetStream().ReadTimeout=20000; string line;
            while((line=peer.reader.ReadLine())!=null) { Require(line=="PING "+nonce,"Fixture command differs"); peer.writer.WriteLine("PONG "+nonce+" "+role); }
        }
        return 0;
    }
    static int Custodian(string[] args) {
        bool kill=args[1]=="kill-on-close"; string nonce=args[2]; int port=int.Parse(args[3]); IntPtr witness=new IntPtr(long.Parse(args[4]));
        // The only creation of the target Job. No DuplicateHandle(job), export,
        // graceful CloseHandle(job), TerminateJobObject or cleanup finally exists.
        IntPtr job=CreateJobObject(IntPtr.Zero,null); Check(job!=IntPtr.Zero,"CreateJobObject(unnamed)");
        Check(SetHandleInformation(job,HandleInherit,0),"Job non-inheritable");
        Extended limits=new Extended(); limits.basic.flags=ActiveLimit|(kill?KillOnClose:0); limits.basic.active=3;
        Check(SetInformationJobObject(job,9,ref limits,Marshal.SizeOf(typeof(Extended))),"Set Job close policy");
        Extended readback; Check(QueryLimits(job,9,out readback,Marshal.SizeOf(typeof(Extended)),IntPtr.Zero),"Query Job close policy");
        SetupProof proof=new SetupProof {flags=readback.basic.flags,activeLimit=readback.basic.active,unnamed=true,jobNonInheritable=NonInherited(job),custodianOutside=!Member(GetCurrentProcess(),job),witnessOutside=!Member(witness,job),noBreakaway=(readback.basic.flags&Breakaway)==0,inheritedHandleCount=7,members=new Binding[3]};
        Require(proof.custodianOutside&&proof.witnessOutside&&proof.jobNonInheritable&&proof.noBreakaway,"Job ownership boundary differs");
        for(int i=0;i<3;i++) {
            IntPtr process=new IntPtr(long.Parse(args[5+i*2])),thread=new IntPtr(long.Parse(args[6+i*2]));
            Require(WaitForSingleObject(process,0)==Timeout,"Fixture exited before assignment"); Check(AssignProcessToJobObject(job,process),"Assign suspended fixture");
            proof.members[i]=new Binding {role=Roles[i],pid=GetProcessId(process),assignedBeforeResume=true,memberBeforeResume=Member(process,job)};
            Require(proof.members[i].memberBeforeResume,"Job membership missing"); Require(ResumeThread(thread)==1,"Unexpected fixture suspend count"); CloseHandle(thread);
        }
        Accounting accounting; Check(QueryAccounting(job,1,out accounting,Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero),"Query complete live set");
        proof.activeMembers=accounting.active; proof.jobHandleCount=ObjectInfo(job).handles;
        Require(proof.activeMembers==3&&proof.jobHandleCount==1,"Incomplete finite membership or extra Job handle");
        using(Peer peer=Connect(port,new Hello {role="custodian",nonce=nonce,pid=(uint)Process.GetCurrentProcess().Id,setup=proof})) {
            peer.socket.GetStream().ReadTimeout=20000;
            string line=peer.reader.ReadLine(); Require(line=="PING "+nonce,"Custodian challenge differs"); peer.writer.WriteLine("PONG "+nonce+" custodian");
            // This socket stays open until external abrupt TerminateProcess.
            // A disconnected witness or watchdog exits non-successfully as a fallback.
            peer.reader.ReadLine();
        }
        return 197;
    }
    sealed class Held { public string role; public ProcessInfo original; public IntPtr retained; public Dictionary<string,object> evidence=new Dictionary<string,object>(); }
    static bool End(IntPtr process) {
        if(process==IntPtr.Zero) return true;
        if(WaitForSingleObject(process,0)==0) return true;
        bool terminated=TerminateProcess(process,FallbackExit); int error=Marshal.GetLastWin32Error();
        // A close-policy termination can race this fallback. Only the retained
        // original HANDLE signaling can settle a failed TerminateProcess call.
        if(WaitForSingleObject(process,5000)==0) return true;
        if(!terminated) throw new Win32Exception(error,"Fallback original process termination remained unsignaled");
        return false;
    }
    static uint[] ProcessIds(IntPtr job) {
        int bytes=8+32*IntPtr.Size; IntPtr buffer=Marshal.AllocHGlobal(bytes);
        try {
            Check(QueryProcessList(job,3,buffer,bytes,IntPtr.Zero),"Query Job original process set");
            int assigned=Marshal.ReadInt32(buffer,0),count=Marshal.ReadInt32(buffer,4);
            Require(assigned==count&&count>=0&&count<=32,"Job process list incomplete");
            uint[] result=new uint[count]; for(int i=0;i<count;i++) result[i]=checked((uint)Marshal.ReadIntPtr(buffer,8+i*IntPtr.Size).ToInt64()); return result;
        } finally { Marshal.FreeHGlobal(buffer); }
    }
    static int Witness(string mode,string nonce) {
        Require(mode=="kill-on-close"||mode=="no-kill-control","Unsupported mode");
        Guid parsedNonce; Require(Guid.TryParseExact(nonce,"D",out parsedNonce),"Invalid run nonce");
        bool kill=mode=="kill-on-close",completed=false,expectedRejection=false,cleanup=true,fallback=false;
        string stage="setup"; List<Held> held=new List<Held>(); Dictionary<string,Peer> peers=new Dictionary<string,Peer>();
        TcpListener listener=null; IntPtr selfQuery=IntPtr.Zero,custodian=IntPtr.Zero,custodianThread=IntPtr.Zero,guard=IntPtr.Zero;
        Dictionary<string,object> safety=new Dictionary<string,object>();
        Dictionary<string,object> report=new Dictionary<string,object>(); report["schema"]="chainlesschain.windows-custodian-crash-native/v1"; report["status"]="NOT_ADMITTED"; report["trusted"]=false; report["mode"]=mode; report["nonce"]=nonce;
        report["witnessPid"]=(uint)Process.GetCurrentProcess().Id; report["osVersion"]=Environment.OSVersion.Version.ToString(); report["clrVersion"]=Environment.Version.ToString(); report["process64Bit"]=Environment.Is64BitProcess;
        report["durableRecoveryProven"]=false; report["protectedServiceProven"]=false; report["wfpProven"]=false; report["wholeJobEmptyProven"]=false; report["jobQueriedAfterCrash"]=false; report["witnessTargetJobHandles"]=0;
        try {
            bool elevated=new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator); report["elevated"]=elevated; Require(!elevated,"Non-administrator witness required");
            guard=CreateJobObject(IntPtr.Zero,null); Check(guard!=IntPtr.Zero,"Create safety Job");
            Check(SetHandleInformation(guard,HandleInherit,0),"Safety Job non-inheritable");
            Extended guardLimits=new Extended(); guardLimits.basic.flags=ActiveLimit|KillOnClose; guardLimits.basic.active=4;
            Check(SetInformationJobObject(guard,9,ref guardLimits,Marshal.SizeOf(typeof(Extended))),"Set safety Job policy");
            Extended guardReadback; Check(QueryLimits(guard,9,out guardReadback,Marshal.SizeOf(typeof(Extended)),IntPtr.Zero),"Query safety Job policy");
            safety["flags"]=guardReadback.basic.flags; safety["activeLimit"]=guardReadback.basic.active; safety["unnamed"]=true; safety["nonInheritable"]=NonInherited(guard); safety["witnessOutside"]=!Member(GetCurrentProcess(),guard); safety["handleCount"]=ObjectInfo(guard).handles;
            Require(guardReadback.basic.flags==(ActiveLimit|KillOnClose)&&guardReadback.basic.active==4&&NonInherited(guard)&&!Member(GetCurrentProcess(),guard)&&ObjectInfo(guard).handles==1,"Safety Job ownership or policy differs");
            report["safetyGuard"]=safety;
            listener=new TcpListener(IPAddress.Loopback,0); listener.Start(); int port=((IPEndPoint)listener.LocalEndpoint).Port;
            List<IntPtr> inherited=new List<IntPtr>();
            for(int i=0;i<3;i++) { Held member=new Held(); member.role=Roles[i]; member.original=LaunchGuarded("member "+Roles[i]+" "+nonce+" "+port,guard,new IntPtr[0]); held.Add(member); member.evidence["safetyMemberBeforeResume"]=Member(member.original.process,guard); Require((bool)member.evidence["safetyMemberBeforeResume"],"Atomic fixture safety membership missing"); inherited.Add(member.original.process); inherited.Add(member.original.thread); }
            safety["atomicRootAssignments"]=3;
            selfQuery=Reduce(GetCurrentProcess(),QueryLimited,true); inherited.Add(selfQuery);
            StringBuilder command=new StringBuilder("custodian "+mode+" "+nonce+" "+port+" "+selfQuery.ToInt64());
            foreach(Held member in held) command.Append(" "+member.original.process.ToInt64()+" "+member.original.thread.ToInt64());
            ProcessInfo launched=LaunchGuarded(command.ToString(),guard,inherited.ToArray()); custodian=launched.process; custodianThread=launched.thread;
            safety["custodianMemberBeforeResume"]=Member(custodian,guard); Require((bool)safety["custodianMemberBeforeResume"],"Atomic custodian safety membership missing"); safety["atomicCustodianAssignment"]=true;
            IntPtr reduced=Reduce(custodian,RetainedRights,false); CloseHandle(custodian); custodian=reduced;
            foreach(Held member in held) {
                member.retained=Reduce(member.original.process,RetainedRights,false); CloseHandle(member.original.process); member.original.process=IntPtr.Zero;
                CloseHandle(member.original.thread); member.original.thread=IntPtr.Zero;
                member.evidence["role"]=member.role; member.evidence["pid"]=GetProcessId(member.retained); member.evidence["rights"]=ObjectInfo(member.retained).access; member.evidence["nonInheritable"]=NonInherited(member.retained); member.evidence["sameCreationObject"]=true;
            }
            CloseHandle(selfQuery); selfQuery=IntPtr.Zero; Require(ResumeThread(custodianThread)==1,"Unexpected custodian suspend count"); CloseHandle(custodianThread); custodianThread=IntPtr.Zero;
            stage="live-barrier";
            while(peers.Count<4) {
                IAsyncResult pending=listener.BeginAcceptTcpClient(null,null); Require(pending.AsyncWaitHandle.WaitOne(7000),"Socket registration timeout");
                Peer peer=new Peer(listener.EndAcceptTcpClient(pending)); pending.AsyncWaitHandle.Close();
                try {
                    peer.hello=Json.Deserialize<Hello>(peer.reader.ReadLine()); Require(peer.hello!=null&&peer.hello.nonce==nonce&&!peers.ContainsKey(peer.hello.role),"Socket identity differs");
                    IntPtr expected=custodian; if(peer.hello.role!="custodian") { Held match=held.Find(delegate(Held item){return item.role==peer.hello.role;}); Require(match!=null,"Unknown fixture role"); expected=match.retained; }
                    Require(peer.hello.pid==GetProcessId(expected),"Socket PID differs from retained creation object"); peers.Add(peer.hello.role,peer);
                } catch { peer.Dispose(); throw; }
            }
            SetupProof setup=peers["custodian"].hello.setup; report["setup"]=setup; Require(setup!=null&&setup.members.Length==3&&setup.activeMembers==3&&setup.jobHandleCount==1&&setup.inheritedHandleCount==7,"Custodian setup proof incomplete");
            Require(setup.flags==(ActiveLimit|(kill?KillOnClose:0))&&setup.activeLimit==3&&setup.unnamed&&setup.jobNonInheritable&&setup.custodianOutside&&setup.witnessOutside&&setup.noBreakaway,"Custodian policy readback differs");
            foreach(Held member in held) { Binding binding=Array.Find(setup.members,delegate(Binding item){return item.role==member.role;}); Require(binding!=null&&binding.pid==GetProcessId(member.retained)&&binding.assignedBeforeResume&&binding.memberBeforeResume,"Member assignment differs"); uint wait=WaitForSingleObject(member.retained,0); Require(wait==Timeout,"Member not live before crash"); peers[member.role].Challenge(nonce); member.evidence["preWait"]=wait; member.evidence["liveChallengeBefore"]=true; }
            peers["custodian"].Challenge(nonce); uint custodianPreWait=WaitForSingleObject(custodian,0); Require(custodianPreWait==Timeout,"Custodian not live before external crash"); report["setup"]=setup;
            Dictionary<string,object> owner=new Dictionary<string,object>(); owner["pid"]=GetProcessId(custodian); owner["rights"]=ObjectInfo(custodian).access; owner["nonInheritable"]=NonInherited(custodian); owner["sameCreationObject"]=true; owner["preWait"]=custodianPreWait; owner["liveChallengeBefore"]=true;
            report["custodian"]=owner;
            foreach(Held member in held) { uint wait=WaitForSingleObject(member.retained,0); member.evidence["preWait"]=wait; Require(wait==Timeout,"Member exited after live socket challenge"); }
            Accounting guardActive; Check(QueryAccounting(guard,1,out guardActive,Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero),"Query safety live set"); safety["activeBeforeCrash"]=guardActive.active; safety["handleCountBeforeCrash"]=ObjectInfo(guard).handles;
            uint[] guardPids=ProcessIds(guard); safety["processIdsBeforeCrash"]=guardPids;
            Require(guardPids.Length==4&&Array.IndexOf(guardPids,GetProcessId(custodian))>=0,"Safety Job process set differs");
            foreach(Held member in held) Require(Array.IndexOf(guardPids,GetProcessId(member.retained))>=0,"Safety Job original member missing");
            Require(guardActive.active==4&&ObjectInfo(guard).handles==1&&NonInherited(guard),"Safety Job live set or ownership differs");
            stage="external-abrupt-crash"; Stopwatch crash=Stopwatch.StartNew(); Check(TerminateProcess(custodian,CrashExit),"External abrupt custodian termination"); owner["terminateSucceeded"]=true;
            uint custodianWait=WaitForSingleObject(custodian,5000),custodianExit; Check(GetExitCodeProcess(custodian,out custodianExit),"Original custodian exit"); owner["wait"]=custodianWait; owner["exit"]=custodianExit; Require(custodianWait==0&&custodianExit==CrashExit,"Custodian abrupt exit unconfirmed"); owner["socketTerminal"]=peers["custodian"].Terminal(2000); report["custodian"]=owner;
            stage=kill?"automatic-finite-set-settlement":"negative-live-members";
            foreach(Held member in held) {
                uint wait=WaitForSingleObject(member.retained,kill?(uint)Math.Max(0,5000-crash.ElapsedMilliseconds):0); member.evidence["afterWait"]=wait;
                uint code; Check(GetExitCodeProcess(member.retained,out code),"Original member exit query"); member.evidence["exitKnown"]=true; member.evidence["actualExit"]=code;
                if(kill) { Require(wait==0&&code!=StillActive,"Automatic Job-close termination unconfirmed"); member.evidence["socketTerminal"]=peers[member.role].Terminal((int)Math.Max(1,5000-crash.ElapsedMilliseconds)); }
                else { Require(wait==Timeout&&code==StillActive,"Negative fixture unexpectedly exited"); peers[member.role].Challenge(nonce); member.evidence["liveChallengeAfter"]=true; }
            }
            report["crashElapsedMs"]=crash.ElapsedMilliseconds; Require(crash.ElapsedMilliseconds<=5000,"Crash proof deadline exceeded");
            safety["heldOpenThroughObservation"]=true;
            completed=kill; expectedRejection=!kill; stage=kill?"completed":"negative-control-survived";
        } catch(Exception error) { report["error"]=error.ToString(); }
        finally {
            try { if(custodian!=IntPtr.Zero&&WaitForSingleObject(custodian,0)!=0) fallback=true; cleanup=End(custodian)&&cleanup; } catch(Exception error) { cleanup=false; report["custodianCleanupError"]=error.Message; }
            foreach(Held member in held) {
                IntPtr handle=member.retained!=IntPtr.Zero?member.retained:member.original.process;
                try { if(handle!=IntPtr.Zero&&WaitForSingleObject(handle,0)!=0) fallback=true; bool ended=End(handle); cleanup=ended&&cleanup; member.evidence["finalWait"]=handle==IntPtr.Zero?0:WaitForSingleObject(handle,0); if(peers.ContainsKey(member.role)&&!member.evidence.ContainsKey("socketTerminal")) member.evidence["cleanupSocketTerminal"]=peers[member.role].Terminal(2000); }
                catch(Exception error) { cleanup=false; member.evidence["cleanupError"]=error.Message; }
                if(member.retained!=IntPtr.Zero) CloseHandle(member.retained); if(member.original.process!=IntPtr.Zero) CloseHandle(member.original.process); if(member.original.thread!=IntPtr.Zero) CloseHandle(member.original.thread);
            }
            if(custodian!=IntPtr.Zero) CloseHandle(custodian); if(custodianThread!=IntPtr.Zero) CloseHandle(custodianThread); if(selfQuery!=IntPtr.Zero) CloseHandle(selfQuery);
            if(guard!=IntPtr.Zero) {
                try { Accounting finalGuard; Check(QueryAccounting(guard,1,out finalGuard,Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero),"Query safety Job cleanup"); safety["activeAfterExplicitCleanup"]=finalGuard.active; Require(finalGuard.active==0,"Safety Job retains processes after original HANDLE cleanup"); }
                catch(Exception error) { cleanup=false; safety["cleanupError"]=error.Message; }
                safety["closeAfterOriginalHandleCleanup"]=cleanup; if(!CloseHandle(guard)) { cleanup=false; safety["closeError"]=Marshal.GetLastWin32Error(); }
            }
            foreach(Peer peer in peers.Values) peer.Dispose(); if(listener!=null) listener.Stop();
        }
        report["stage"]=stage; report["completed"]=completed; report["expectedRejection"]=expectedRejection; report["cleanupConfirmed"]=cleanup; report["fallbackCleanupUsed"]=fallback;
        report["members"]=held.ConvertAll(delegate(Held member){return member.evidence;}); Console.WriteLine(Json.Serialize(report)); return completed&&cleanup&&!fallback?0:2;
    }
    public static int Main(string[] args) {
        try { if(args.Length>0&&args[0]=="member") return Fixture(args); if(args.Length>0&&args[0]=="custodian") return Custodian(args); return Witness(args.Length==0?"kill-on-close":args[0],args.Length>1?args[1]:Guid.NewGuid().ToString("D")); }
        catch(Exception error) { Console.Error.WriteLine(error.ToString()); return 2; }
    }
}
