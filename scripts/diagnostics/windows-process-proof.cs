// Read-only observation helper. It grants no sandbox or durable authority.
// All process facts are read through one handle; no WMI/CIM service is used.
using System;
using System.ComponentModel;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;

[DataContract]
sealed class ProcessProof
{
    [DataMember] public string schema = "chainlesschain.windows-process-proof/v1";
    [DataMember] public string sourceDigest = "sha256:__PROCESS_PROOF_SOURCE_SHA256__";
    [DataMember] public int processId;
    [DataMember] public string startIdentity;
    [DataMember] public string executable;
    [DataMember] public string commandLine;
    // The legacy binding uses process creation time, not an independently
    // measured Windows boot ID. Preserve that scope and its exact identity.
    [DataMember] public string bootIdentity = "windows-process-start";
    [DataMember] public bool aliveBefore;
    [DataMember] public bool aliveAfter;
}

static class WindowsProcessProof
{
    const uint QUERY_LIMITED_INFORMATION = 0x1000;
    const uint SYNCHRONIZE = 0x00100000;
    const uint WAIT_TIMEOUT = 258;
    const int ProcessCommandLineInformation = 60;
    const int MaxCommandLineBytes = 128 * 1024;

    [StructLayout(LayoutKind.Sequential)]
    struct FileTime { public uint low; public uint high; }
    [StructLayout(LayoutKind.Sequential)]
    struct UnicodeString { public ushort length; public ushort maximumLength; public IntPtr buffer; }

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(uint access, bool inherit, int processId);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetProcessTimes(IntPtr handle, out FileTime creation, out FileTime exit, out FileTime kernel, out FileTime user);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool QueryFullProcessImageName(IntPtr handle, uint flags, StringBuilder name, ref uint size);
    [DllImport("ntdll.dll")]
    static extern int NtQueryInformationProcess(IntPtr handle, int informationClass, IntPtr information, int length, out int returned);

    static void Check(bool condition, string detail)
    {
        if (!condition) throw new InvalidOperationException(detail);
    }
    static string Creation(IntPtr handle)
    {
        FileTime creation, exit, kernel, user;
        if (!GetProcessTimes(handle, out creation, out exit, out kernel, out user))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "GetProcessTimes");
        long fileTime = ((long)creation.high << 32) | creation.low;
        return DateTime.FromFileTimeUtc(fileTime).Ticks.ToString(CultureInfo.InvariantCulture);
    }
    static string Image(IntPtr handle)
    {
        var text = new StringBuilder(32768);
        uint size = (uint)text.Capacity;
        if (!QueryFullProcessImageName(handle, 0, text, ref size))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "QueryFullProcessImageName");
        Check(size > 0 && size < text.Capacity, "Process image is empty or truncated");
        return text.ToString();
    }
    static string Command(IntPtr handle)
    {
        int needed;
        NtQueryInformationProcess(handle, ProcessCommandLineInformation, IntPtr.Zero, 0, out needed);
        Check(needed >= Marshal.SizeOf(typeof(UnicodeString)) && needed <= MaxCommandLineBytes,
            "Command line query returned an invalid bounded size");
        IntPtr memory = Marshal.AllocHGlobal(needed);
        try
        {
            int returned;
            int status = NtQueryInformationProcess(handle, ProcessCommandLineInformation, memory, needed, out returned);
            Check(status == 0 && returned > 0 && returned <= needed, "Command line query failed: " + status);
            var text = (UnicodeString)Marshal.PtrToStructure(memory, typeof(UnicodeString));
            long offset = text.buffer.ToInt64() - memory.ToInt64();
            Check(text.length > 0 && text.length % 2 == 0 && text.maximumLength >= text.length &&
                offset >= Marshal.SizeOf(typeof(UnicodeString)) && offset <= returned - text.length,
                "Command line query returned an invalid string extent");
            return Marshal.PtrToStringUni(text.buffer, text.length / 2);
        }
        finally { Marshal.FreeHGlobal(memory); }
    }
    public static int Main(string[] args)
    {
        try
        {
            int processId;
            Check(args.Length == 1 && Int32.TryParse(args[0], NumberStyles.None,
                CultureInfo.InvariantCulture, out processId) && processId > 0, "One positive process ID is required");
            // Int32.TryParse above is short circuited; assign again for the compiler.
            processId = Int32.Parse(args[0], CultureInfo.InvariantCulture);
            IntPtr handle = OpenProcess(QUERY_LIMITED_INFORMATION | SYNCHRONIZE, false, processId);
            if (handle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "OpenProcess");
            ProcessProof proof;
            try
            {
                Check(WaitForSingleObject(handle, 0) == WAIT_TIMEOUT, "Target process is not alive");
                proof = new ProcessProof {
                    processId = processId, startIdentity = Creation(handle),
                    executable = Image(handle), commandLine = Command(handle), aliveBefore = true
                };
                Check(proof.startIdentity == Creation(handle) && proof.executable == Image(handle) &&
                    proof.commandLine == Command(handle), "Process identity changed during the query");
                Check(WaitForSingleObject(handle, 0) == WAIT_TIMEOUT, "Target process exited during the query");
                proof.aliveAfter = true;
            }
            finally { Check(CloseHandle(handle), "CloseHandle failed"); }
            using (var stream = new MemoryStream())
            {
                new DataContractJsonSerializer(typeof(ProcessProof)).WriteObject(stream, proof);
                Console.OutputEncoding = new UTF8Encoding(false);
                Console.WriteLine(Encoding.UTF8.GetString(stream.ToArray()));
            }
            return 0;
        }
        catch (Exception error)
        {
            var nativeError = error as Win32Exception;
            Console.Error.WriteLine(error.GetType().Name + ": " + error.Message +
                (nativeError == null ? "" : " (Win32 " + nativeError.NativeErrorCode + ")"));
            return 1;
        }
    }
}
