// Bounded diagnostic fixture: no retry loop, no ACL changes, no child creation.
using System;
using System.Runtime.InteropServices;
using System.Text;

internal static class WindowsPipeApiProbe {
  [DllImport("kernel32.dll", CharSet = CharSet.Ansi, SetLastError = true)]
  private static extern IntPtr CreateNamedPipeA(string name, uint access, uint mode, uint instances, uint outBytes, uint inBytes, uint timeout, IntPtr security);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] private static extern uint GetCurrentProcessId();
  [DllImport("kernel32.dll")] private static extern ulong GetTickCount64();
  [DllImport("kernel32.dll")] private static extern IntPtr GetStdHandle(int id);
  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool WriteFile(IntPtr handle, byte[] bytes, uint count, out uint written, IntPtr overlapped);
  [DllImport("advapi32.dll", SetLastError = true)]
  private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError = true)]
  private static extern bool GetTokenInformation(IntPtr token, int kind, out uint value, uint size, out uint returned);

  private static readonly IntPtr Invalid = new IntPtr(-1);
  private static uint appContainer;
  private static uint pid;
  private static bool Emit(string label, IntPtr handle, int error, ulong start) {
    bool success = handle != Invalid;
    bool closed = !success || CloseHandle(handle);
    string line = "CC_PIPE_API:{\"label\":\"" + label + "\",\"pid\":" + pid +
      ",\"tokenIsAppContainer\":" + appContainer + ",\"success\":" + (success ? "true" : "false") +
      ",\"win32Error\":" + error + ",\"handleClosed\":" + (closed ? "true" : "false") +
      ",\"elapsedMs\":" + (GetTickCount64() - start) + "}\n";
    byte[] bytes = Encoding.ASCII.GetBytes(line);
    uint written;
    return closed && WriteFile(GetStdHandle(-11), bytes, (uint)bytes.Length, out written, IntPtr.Zero) && written == bytes.Length;
  }

  public static int Main() {
    pid = GetCurrentProcessId();
    IntPtr token;
    uint returned;
    if (!OpenProcessToken(GetCurrentProcess(), 8, out token)) return 81;
    bool identity = GetTokenInformation(token, 29, out appContainer, 4, out returned);
    bool tokenClosed = CloseHandle(token);
    if (!identity || !tokenClosed || returned != 4) return 82;
    string suffix = "cc-api-" + pid + "-" + GetTickCount64();
    // Match libuv's duplex, overlapped, WRITE_DAC and first-instance flags.
    string[] names = {
      @"\\?\pipe\uv\" + suffix + "-1",
      @"\\?\pipe\uv\" + suffix + "-2",
      @"\\?\pipe\uv\" + suffix + "-3",
      @"\\.\pipe\LOCAL\" + suffix,
      @"\\?\pipe\LOCAL\" + suffix
    };
    string[] labels = { "libuv-name-1", "libuv-name-2", "libuv-name-3", "local-dot", "local-extended" };
    for (int index = 0; index < names.Length; index++) {
      ulong start = GetTickCount64();
      IntPtr handle = CreateNamedPipeA(names[index], 0x400C0003, 0, 1, 65536, 65536, 0, IntPtr.Zero);
      int error = handle == Invalid ? Marshal.GetLastWin32Error() : 0;
      if (!Emit(labels[index], handle, error, start)) return 83;
    }
    ulong nulStart = GetTickCount64();
    // FILE_GENERIC_READ / sharing / disposition from uv__create_nul_handle.
    IntPtr nul = CreateFileW("NUL", 0x120089, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
    int nulError = nul == Invalid ? Marshal.GetLastWin32Error() : 0;
    return Emit("nul-stdin", nul, nulError, nulStart) ? 0 : 84;
  }
}
