// Standalone lifecycle diagnostic. This is not a sandbox, service or WFP backend.
// The custodian keeps the ORIGINAL unnamed Job handle throughout the experiment.
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

internal static class JobRecoveryProbe
{
    const uint Suspended = 4, NoWindow = 0x08000000, Signaled = 0;
    const uint QueryLimited = 0x1000, Synchronize = 0x100000;
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct Startup {
        public int cb; public string reserved, desktop, title;
        public uint x, y, xSize, ySize, xChars, yChars, fill, flags;
        public ushort show, reserved2; public IntPtr reservedPtr, input, output, error;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct ProcessInfo { public IntPtr process, thread; public uint pid, tid; }
    [StructLayout(LayoutKind.Sequential)]
    struct Limits {
        public long processTime, jobTime; public uint flags;
        public UIntPtr minimum, maximum; public uint active;
        public UIntPtr affinity; public uint priority, scheduling;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct Io { public ulong readOps, writeOps, otherOps, readBytes, writeBytes, otherBytes; }
    [StructLayout(LayoutKind.Sequential)]
    struct Extended { public Limits basic; public Io io; public UIntPtr processMemory, jobMemory, peakProcess, peakJob; }
    [StructLayout(LayoutKind.Sequential)]
    struct Accounting {
        public long user, kernel, periodUser, periodKernel;
        public uint faults, total, active, terminated;
    }
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int kind, ref Extended data, int size);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool QueryInformationJobObject(IntPtr job, int kind, out Accounting data, int size, IntPtr length);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", SetLastError = true, EntryPoint = "QueryInformationJobObject")]
    static extern bool QueryJobPids(IntPtr job, int kind, IntPtr data, int size, IntPtr length);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcess(string image, StringBuilder command, IntPtr pa, IntPtr ta,
        bool inherit, uint flags, IntPtr environment, string cwd, ref Startup startup, out ProcessInfo info);

    static void Check(bool ok, string operation) {
        if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error(), operation);
    }
    static uint Active(IntPtr job) {
        Accounting value;
        Check(QueryInformationJobObject(job, 1, out value, Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero), "QueryInformationJobObject");
        return value.active;
    }
    static bool Member(IntPtr process, IntPtr job) {
        bool result; Check(IsProcessInJob(process, job, out result), "IsProcessInJob"); return result;
    }
    static object Inventory(IntPtr job) {
        IntPtr buffer = Marshal.AllocHGlobal(4096);
        try {
            Check(QueryJobPids(job, 3, buffer, 4096, IntPtr.Zero), "QueryInformationJobObject(inventory)");
            int count = Marshal.ReadInt32(buffer, 4);
            List<object> values = new List<object>();
            for (int i = 0; i < count; i++) {
                int pid = (int)Marshal.ReadIntPtr(buffer, 8 + i * IntPtr.Size).ToInt64();
                string name;
                try { using (Process p = Process.GetProcessById(pid)) name = p.ProcessName; } catch { name = "unavailable"; }
                values.Add(new { pid = pid, image = name });
            }
            return values; // Observational only; not used for termination or proof.
        } finally { Marshal.FreeHGlobal(buffer); }
    }
    static void Empty(IntPtr job) {
        Stopwatch wait = Stopwatch.StartNew();
        while (Active(job) != 0) {
            if (wait.ElapsedMilliseconds >= 5000) throw new Exception("Job cleanup remains unconfirmed");
            Thread.Sleep(10);
        }
    }
    static ProcessInfo Launch(string image, string arguments) {
        Startup startup = new Startup(); startup.cb = Marshal.SizeOf(typeof(Startup));
        ProcessInfo info;
        Check(CreateProcess(image, new StringBuilder("\"" + image + "\" " + arguments),
            IntPtr.Zero, IntPtr.Zero, false, Suspended | NoWindow, IntPtr.Zero, null, ref startup, out info), "CreateProcess");
        return info;
    }
    sealed class Peer : IDisposable {
        public TcpClient client; public StreamReader reader; public StreamWriter writer;
        public string role; public IntPtr process;
        public void Ping(string nonce) {
            writer.WriteLine("PING " + nonce);
            if (reader.ReadLine() != "PONG " + nonce + " " + role) throw new Exception("Live socket challenge failed");
        }
        public string terminal;
        public bool Closed() {
            try { if (reader.ReadLine() == null) { terminal = "eof"; return true; } return false; }
            catch (IOException error) {
                SocketException socket = error.InnerException as SocketException;
                if (socket != null && socket.SocketErrorCode == SocketError.ConnectionReset) {
                    terminal = "reset"; return true;
                }
                throw; // A read timeout or any other error is not a closed connection.
            }
        }
        public void Dispose() { if (process != IntPtr.Zero) CloseHandle(process); if (client != null) client.Close(); }
    }
    // This binding exists only in the surviving custodian's memory. No serialized
    // handle number, PID, age or replayed receipt can reopen or clear this Job.
    sealed class Fence {
        readonly IntPtr job; readonly string nonce; readonly IntPtr owner;
        public Fence(IntPtr originalJob, string execution, IntPtr originalOwner) { job = originalJob; nonce = execution; owner = originalOwner; }
        public bool Matches(IntPtr candidateJob, string candidateNonce) {
            return candidateJob == job && candidateNonce == nonce && Member(owner, job);
        }
        public void Revoke(IntPtr candidateJob, string candidateNonce) {
            if (!Matches(candidateJob, candidateNonce)) throw new Exception("Retained Job identity mismatch");
            Check(TerminateJobObject(job, 125), "TerminateJobObject");
        }
    }
    static void Event(List<object> events, string name, params object[] pairs) {
        Dictionary<string, object> value = new Dictionary<string, object>(); value["name"] = name;
        for (int i = 0; i < pairs.Length; i += 2) value[(string)pairs[i]] = pairs[i + 1];
        events.Add(value);
    }
    static int Fixture(string[] args) {
        string role = args[1], nonce = args[3]; int port = int.Parse(args[2]);
        using (TcpClient client = new TcpClient()) {
            client.Connect(IPAddress.Loopback, port);
            Check(SetHandleInformation(client.Client.Handle, 1, 0), "SetHandleInformation(fixture socket)");
            client.ReceiveTimeout = 45000; client.SendTimeout = 5000;
            using (StreamReader reader = new StreamReader(client.GetStream(), Encoding.ASCII))
            using (StreamWriter writer = new StreamWriter(client.GetStream(), Encoding.ASCII)) {
                writer.AutoFlush = true;
                writer.WriteLine("HELLO " + nonce + " " + role + " " + Process.GetCurrentProcess().Id);
                if (role != "grandchild") {
                    string next = role == "owner" ? "child" : "grandchild";
                    ProcessStartInfo start = new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName,
                        "fixture " + next + " " + port + " " + nonce);
                    start.UseShellExecute = false; start.CreateNoWindow = true;
                    using (Process descendant = Process.Start(start)) { }
                }
                string line;
                while ((line = reader.ReadLine()) != null) {
                    if (line != "PING " + nonce) return 3;
                    writer.WriteLine("PONG " + nonce + " " + role);
                }
            }
        }
        return 0;
    }
    static int Probe(string nonce, bool unassignedFailure) {
        Guid execution;
        if (!Guid.TryParseExact(nonce, "D", out execution)) throw new Exception("Invalid execution nonce");
        Dictionary<string, object> report = new Dictionary<string, object>();
        List<object> events = new List<object>();
        report["schema"] = "chainlesschain.windows-job-recovery-native/v1";
        report["executionId"] = nonce; report["status"] = "NOT_ADMITTED";
        report["completed"] = false; report["cleanupConfirmed"] = false;
        report["custodianRestartTested"] = false; report["wfpTested"] = false;
        report["unassignedFailureInjected"] = unassignedFailure;
        report["events"] = events;
        IntPtr job = IntPtr.Zero, wrongJob = IntPtr.Zero;
        ProcessInfo owner = new ProcessInfo();
        Dictionary<string, Peer> peers = new Dictionary<string, Peer>();
        TcpListener listener = null;
        bool completed = false;
        try {
            bool elevated = new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);
            report["nonElevated"] = !elevated;
            if (elevated) throw new Exception("Run this diagnostic as a non-elevated operator");
            job = CreateJobObject(IntPtr.Zero, null); Check(job != IntPtr.Zero, "CreateJobObject");
            wrongJob = CreateJobObject(IntPtr.Zero, null); Check(wrongJob != IntPtr.Zero, "CreateJobObject(negative)");
            Extended limit = new Extended(); limit.basic.flags = 0x2000; // KILL_ON_JOB_CLOSE; no breakaway
            Check(SetInformationJobObject(job, 9, ref limit, Marshal.SizeOf(typeof(Extended))), "SetInformationJobObject");
            listener = new TcpListener(IPAddress.Loopback, 0); listener.Start();
            int port = ((IPEndPoint)listener.LocalEndpoint).Port;
            owner = Launch(Process.GetCurrentProcess().MainModule.FileName, "fixture owner " + port + " " + nonce);
            if (unassignedFailure) throw new Exception("Injected failure before Job assignment and resume");
            Check(AssignProcessToJobObject(job, owner.process), "AssignProcessToJobObject");
            Event(events, "assigned-before-resume", "ownerInJob", Member(owner.process, job), "jobActive", Active(job));
            if (ResumeThread(owner.thread) == UInt32.MaxValue) Check(false, "ResumeThread");
            for (int i = 0; i < 3; i++) {
                IAsyncResult accept = listener.BeginAcceptTcpClient(null, null);
                using (WaitHandle ready = accept.AsyncWaitHandle) {
                    if (!ready.WaitOne(7000)) throw new Exception("Fixture connection deadline exceeded");
                }
                Peer peer = new Peer();
                try {
                    peer.client = listener.EndAcceptTcpClient(accept);
                    peer.client.ReceiveTimeout = 5000; peer.client.SendTimeout = 5000;
                    peer.reader = new StreamReader(peer.client.GetStream(), Encoding.ASCII);
                    peer.writer = new StreamWriter(peer.client.GetStream(), Encoding.ASCII); peer.writer.AutoFlush = true;
                    string hello = peer.reader.ReadLine();
                    string[] parts = hello == null ? new string[0] : hello.Split(' ');
                    uint pid;
                    if (parts.Length != 4 || parts[0] != "HELLO" || parts[1] != nonce ||
                        !(parts[2] == "owner" || parts[2] == "child" || parts[2] == "grandchild") ||
                        !UInt32.TryParse(parts[3], out pid) || peers.ContainsKey(parts[2])) throw new Exception("Invalid fixture handshake");
                    peer.role = parts[2];
                    // PID locates a handle only. Membership and subsequent waits use
                    // that retained handle, never a later PID liveness observation.
                    peer.process = OpenProcess(QueryLimited | Synchronize, false, pid);
                    Check(peer.process != IntPtr.Zero, "OpenProcess(fixture)");
                    if (!Member(peer.process, job) || WaitForSingleObject(peer.process, 0) == Signaled)
                        throw new Exception("Fixture is not a live member of the retained Job");
                    peer.Ping(nonce); peers.Add(peer.role, peer); peer = null;
                } finally { if (peer != null) peer.Dispose(); }
            }
            Event(events, "live-tree", "jobActive", Active(job), "socketChallenges", 3, "handlesJobVerified", true, "inventory", Inventory(job));
            Fence fence = new Fence(job, nonce, owner.process);
            bool wrongRejected = false, staleRejected = false;
            try { fence.Revoke(wrongJob, nonce); } catch { wrongRejected = true; }
            try { fence.Revoke(job, Guid.NewGuid().ToString("D")); } catch { staleRejected = true; }
            bool wrongMember = Member(owner.process, wrongJob);
            foreach (Peer peer in peers.Values) peer.Ping(nonce);
            Event(events, "negative-identities", "wrongJobRejected", wrongRejected, "staleIdentityRejected", staleRejected,
                "ownerInWrongJob", wrongMember, "wrongJobActive", Active(wrongJob), "jobActive", Active(job), "socketChallenges", 3);
            if (!wrongRejected || !staleRejected || wrongMember) throw new Exception("Negative identity rejection failed");
            Check(TerminateProcess(owner.process, 91), "TerminateProcess(owner crash)");
            if (WaitForSingleObject(owner.process, 5000) != Signaled) throw new Exception("Original owner handle did not signal");
            if (!peers["owner"].Closed()) throw new Exception("Owner socket did not close");
            peers["child"].Ping(nonce); peers["grandchild"].Ping(nonce);
            uint afterCrash = Active(job);
            Event(events, "owner-crashed", "originalOwnerHandleSignaled", true, "ownerSocketClosed", true,
                "ownerSocketTerminal", peers["owner"].terminal,
                "jobActive", afterCrash, "descendantSocketChallenges", 2, "cleanupConfirmed", false);
            if (afterCrash < 2 || !Member(peers["child"].process, job) || !Member(peers["grandchild"].process, job))
                throw new Exception("Crash did not retain both descendants");
            // Matches uses the retained owner handle even after its process exits.
            fence.Revoke(job, nonce);
            Event(events, "termination-issued", "sameRetainedJob", true);
            Empty(job);
            foreach (Peer peer in peers.Values)
                if (WaitForSingleObject(peer.process, 5000) != Signaled) throw new Exception("Retained process handle did not signal");
            if (!peers["child"].Closed() || !peers["grandchild"].Closed()) throw new Exception("Descendant socket did not close");
            Event(events, "cleanup-fence", "jobActive", Active(job), "originalOwnerHandleSignaled", true,
                "retainedMemberHandlesSignaled", 3, "descendantSocketsClosed", 2,
                "descendantSocketTerminals", new string[] { peers["child"].terminal, peers["grandchild"].terminal });
            completed = true;
        } catch (Exception error) {
            report["error"] = error.Message;
        } finally {
            // A failure is retained. Even exceptional cleanup uses original handles
            // and an empty-Job query; elapsed time is never a successful fence.
            bool jobEmpty = false, ownerEnded = false;
            try {
                if (job != IntPtr.Zero) { Check(TerminateJobObject(job, 125), "TerminateJobObject(finally)"); Empty(job); }
                jobEmpty = true;
            } catch (Exception error) { report["cleanupError"] = error.Message; completed = false; }
            // Always try the ORIGINAL owner handle, including when assignment or
            // the Job termination/query failed. Closing a Job cannot kill a
            // suspended process that was never successfully assigned to it.
            try {
                report["originalOwnerFallbackAttempted"] = false;
                if (owner.process != IntPtr.Zero && WaitForSingleObject(owner.process, 0) != Signaled) {
                    report["originalOwnerFallbackAttempted"] = true;
                    Check(TerminateProcess(owner.process, 125), "TerminateProcess(unassigned owner)");
                    if (WaitForSingleObject(owner.process, 5000) != Signaled) throw new Exception("Owner cleanup unconfirmed");
                }
                ownerEnded = true;
            } catch (Exception error) { report["ownerCleanupError"] = error.Message; completed = false; }
            report["finalJobEmpty"] = jobEmpty;
            report["originalOwnerCleanupConfirmed"] = ownerEnded;
            report["cleanupConfirmed"] = jobEmpty && ownerEnded;
            if (listener != null) listener.Stop();
            foreach (Peer peer in peers.Values) peer.Dispose();
            if (owner.thread != IntPtr.Zero) CloseHandle(owner.thread);
            if (owner.process != IntPtr.Zero) CloseHandle(owner.process);
            if (wrongJob != IntPtr.Zero) CloseHandle(wrongJob);
            if (job != IntPtr.Zero) CloseHandle(job);
        }
        report["completed"] = completed;
        Console.WriteLine(new JavaScriptSerializer().Serialize(report));
        return completed ? 0 : 2;
    }
    public static int Main(string[] args) {
        try {
            Console.OutputEncoding = new UTF8Encoding(false);
            if (args.Length == 4 && args[0] == "fixture") return Fixture(args);
            if (args.Length == 2 && (args[0] == "probe" || args[0] == "probe-unassigned"))
                return Probe(args[1], args[0] == "probe-unassigned");
            return 64;
        } catch (Exception error) { Console.Error.WriteLine(error.Message); return 2; }
    }
}
