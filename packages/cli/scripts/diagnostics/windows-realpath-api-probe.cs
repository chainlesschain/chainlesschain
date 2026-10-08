// Fixed finite Win32 controls. No ACL, namespace or canonical-path substitution.
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.IO;

internal static class WindowsRealpathApiProbe
{
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateFileW(string path, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern uint GetFinalPathNameByHandleW(IntPtr file, StringBuilder path, uint size, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] static extern uint GetCurrentProcessId();
    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int id);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool WriteFile(IntPtr handle, byte[] bytes, uint count, out uint written, IntPtr overlapped);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetTokenInformation(IntPtr token, int kind, out uint value, uint size, out uint returned);
    static readonly IntPtr Invalid = new IntPtr(-1);
    static uint pid, appContainer;
    static string Quote(string value) { return "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\""; }
    static bool Emit(string value)
    {
        byte[] bytes = Encoding.UTF8.GetBytes("CC_REALPATH_API:" + value + "\n");
        uint written;
        return WriteFile(GetStdHandle(-11), bytes, (uint)bytes.Length, out written, IntPtr.Zero) && written == bytes.Length;
    }
    static bool Probe(string label, string path, uint share)
    {
        IntPtr file = CreateFileW(path, 0, share, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero);
        int openError = file == Invalid ? Marshal.GetLastWin32Error() : 0;
        string[] names = { "normalized-dos", "opened-dos", "normalized-nt" };
        uint[] flags = { 0, 8, 2 };
        string rows = "";
        for (int index = 0; index < flags.Length; index++)
        {
            StringBuilder result = new StringBuilder(32768);
            uint length = file == Invalid ? 0 : GetFinalPathNameByHandleW(file, result, (uint)result.Capacity, flags[index]);
            int error = file == Invalid ? openError : length == 0 ? Marshal.GetLastWin32Error() : 0;
            if (length >= result.Capacity) return false;
            if (index != 0) rows += ",";
            rows += "{\"kind\":" + Quote(names[index]) + ",\"flags\":" + flags[index] +
                ",\"success\":" + (length > 0 ? "true" : "false") + ",\"win32Error\":" + error +
                ",\"length\":" + length + ",\"path\":" + Quote(length > 0 ? result.ToString() : "") + "}";
        }
        bool closed = file == Invalid || CloseHandle(file);
        return Emit("{\"label\":" + Quote(label) + ",\"pid\":" + pid + ",\"tokenIsAppContainer\":" + appContainer +
            ",\"share\":" + share + ",\"openSucceeded\":" + (file != Invalid ? "true" : "false") +
            ",\"openError\":" + openError + ",\"handleClosed\":" + (closed ? "true" : "false") + ",\"queries\":[" + rows + "]}") && closed;
    }
    public static int Main(string[] args)
    {
        if (args.Length != 2 || !Path.IsPathRooted(args[0]) || !Path.IsPathRooted(args[1])) return 81;
        pid = GetCurrentProcessId();
        IntPtr token; uint returned;
        if (!OpenProcessToken(GetCurrentProcess(), 8, out token)) return 82;
        bool tokenOk = GetTokenInformation(token, 29, out appContainer, 4, out returned);
        bool tokenClosed = CloseHandle(token);
        if (!tokenOk || !tokenClosed || returned != 4 || appContainer != 1) return 83;
        string scratch = Path.Combine(args[1], "tmp"), workspace = Path.Combine(args[0], "reference.txt");
        Directory.CreateDirectory(scratch);
        return Probe("scratch-libuv", scratch, 0) && Probe("workspace-libuv", workspace, 0) &&
            Probe("scratch-shared", scratch, 7) && Probe("workspace-shared", workspace, 7) ? 0 : 84;
    }
}
