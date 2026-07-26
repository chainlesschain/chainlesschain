param(
  [Parameter(Mandatory = $true)]
  [string]$CacheExecutable,

  [switch]$CompileOnly,

  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$HelperArguments
)

$ErrorActionPreference = "Stop"

$nativeSource = @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;

namespace ChainlessChain.WindowsSandbox
{
    public static class Native
    {
        private const UInt32 TOKEN_ASSIGN_PRIMARY = 0x0001;
        private const UInt32 TOKEN_DUPLICATE = 0x0002;
        private const UInt32 TOKEN_QUERY = 0x0008;
        private const UInt32 TOKEN_ADJUST_DEFAULT = 0x0080;
        private const UInt32 TOKEN_ADJUST_SESSIONID = 0x0100;

        private const UInt32 DISABLE_MAX_PRIVILEGE = 0x00000001;
        private const UInt32 LUA_TOKEN = 0x00000004;

        private const UInt32 CREATE_SUSPENDED = 0x00000004;
        private const UInt32 CREATE_UNICODE_ENVIRONMENT = 0x00000400;
        private const UInt32 STARTF_USESTDHANDLES = 0x00000100;
        private const UInt32 INFINITE = 0xffffffff;
        private const UInt32 HANDLE_FLAG_INHERIT = 0x00000001;
        private const Byte CRT_FOPEN = 0x01;
        private const Byte CRT_FPIPE = 0x08;
        private const Byte CRT_FDEV = 0x40;
        private const UInt32 FILE_TYPE_DISK = 0x0001;
        private const UInt32 FILE_TYPE_CHAR = 0x0002;
        private const UInt32 FILE_TYPE_PIPE = 0x0003;
        private const UInt32 GENERIC_READ = 0x80000000;
        private const UInt32 GENERIC_WRITE = 0x40000000;
        private const UInt32 FILE_SHARE_READ = 0x00000001;
        private const UInt32 FILE_SHARE_WRITE = 0x00000002;
        private const UInt32 OPEN_EXISTING = 3;
        private const UInt32 FILE_ATTRIBUTE_NORMAL = 0x00000080;

        private const UInt32 JOB_OBJECT_LIMIT_PROCESS_TIME = 0x00000002;
        private const UInt32 JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x00000008;
        private const UInt32 JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x00000100;
        private const UInt32 JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
        private const Int32 JobObjectExtendedLimitInformation = 9;

        [StructLayout(LayoutKind.Sequential)]
        private struct SECURITY_ATTRIBUTES
        {
            public UInt32 nLength;
            public IntPtr lpSecurityDescriptor;
            [MarshalAs(UnmanagedType.Bool)]
            public bool bInheritHandle;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct STARTUPINFO
        {
            public UInt32 cb;
            public string lpReserved;
            public string lpDesktop;
            public string lpTitle;
            public UInt32 dwX;
            public UInt32 dwY;
            public UInt32 dwXSize;
            public UInt32 dwYSize;
            public UInt32 dwXCountChars;
            public UInt32 dwYCountChars;
            public UInt32 dwFillAttribute;
            public UInt32 dwFlags;
            public UInt16 wShowWindow;
            public UInt16 cbReserved2;
            public IntPtr lpReserved2;
            public IntPtr hStdInput;
            public IntPtr hStdOutput;
            public IntPtr hStdError;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct PROCESS_INFORMATION
        {
            public IntPtr hProcess;
            public IntPtr hThread;
            public UInt32 dwProcessId;
            public UInt32 dwThreadId;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public Int64 PerProcessUserTimeLimit;
            public Int64 PerJobUserTimeLimit;
            public UInt32 LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public UInt32 ActiveProcessLimit;
            public UIntPtr Affinity;
            public UInt32 PriorityClass;
            public UInt32 SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IO_COUNTERS
        {
            public UInt64 ReadOperationCount;
            public UInt64 WriteOperationCount;
            public UInt64 OtherOperationCount;
            public UInt64 ReadTransferCount;
            public UInt64 WriteTransferCount;
            public UInt64 OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        [DllImport("kernel32.dll")]
        private static extern IntPtr GetCurrentProcess();

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CloseHandle(IntPtr handle);

        [DllImport("msvcrt.dll", CallingConvention = CallingConvention.Cdecl)]
        private static extern IntPtr _get_osfhandle(Int32 fileDescriptor);

        [DllImport("msvcrt.dll", CallingConvention = CallingConvention.Cdecl)]
        private static extern Int32 _close(Int32 fileDescriptor);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetHandleInformation(
            IntPtr handle,
            UInt32 mask,
            UInt32 flags);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern UInt32 GetFileType(IntPtr handle);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateFile(
            string fileName,
            UInt32 desiredAccess,
            UInt32 shareMode,
            ref SECURITY_ATTRIBUTES securityAttributes,
            UInt32 creationDisposition,
            UInt32 flagsAndAttributes,
            IntPtr templateFile);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern UInt32 ResumeThread(IntPtr thread);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern UInt32 WaitForSingleObject(IntPtr handle, UInt32 milliseconds);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetExitCodeProcess(IntPtr process, out UInt32 exitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool TerminateProcess(IntPtr process, UInt32 exitCode);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateJobObject(IntPtr attributes, string name);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetInformationJobObject(
            IntPtr job,
            Int32 infoClass,
            IntPtr info,
            UInt32 infoLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

        [DllImport("advapi32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool OpenProcessToken(
            IntPtr process,
            UInt32 desiredAccess,
            out IntPtr token);

        [DllImport("advapi32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CreateRestrictedToken(
            IntPtr existingToken,
            UInt32 flags,
            UInt32 disableSidCount,
            IntPtr sidsToDisable,
            UInt32 deletePrivilegeCount,
            IntPtr privilegesToDelete,
            UInt32 restrictedSidCount,
            IntPtr sidsToRestrict,
            out IntPtr restrictedToken);

        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CreateProcessAsUser(
            IntPtr token,
            string applicationName,
            StringBuilder commandLine,
            IntPtr processAttributes,
            IntPtr threadAttributes,
            [MarshalAs(UnmanagedType.Bool)] bool inheritHandles,
            UInt32 creationFlags,
            IntPtr environment,
            string currentDirectory,
            ref STARTUPINFO startupInfo,
            out PROCESS_INFORMATION processInformation);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr GetStdHandle(Int32 standardHandle);

        private static void ThrowLastError(string operation)
        {
            int code = Marshal.GetLastWin32Error();
            string systemMessage = new Win32Exception(code).Message;
            throw new Win32Exception(
                code,
                String.Format(
                    CultureInfo.InvariantCulture,
                    "{0} failed (win32={1}: {2})",
                    operation,
                    code,
                    systemMessage));
        }

        public static string QuoteArgument(string value)
        {
            if (value == null) value = String.Empty;
            if (value.Length > 0 &&
                value.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0)
            {
                return value;
            }

            StringBuilder result = new StringBuilder();
            result.Append('"');
            int backslashes = 0;
            foreach (char current in value)
            {
                if (current == '\\')
                {
                    backslashes++;
                    continue;
                }
                if (current == '"')
                {
                    result.Append('\\', backslashes * 2 + 1);
                    result.Append('"');
                    backslashes = 0;
                    continue;
                }
                result.Append('\\', backslashes);
                backslashes = 0;
                result.Append(current);
            }
            result.Append('\\', backslashes * 2);
            result.Append('"');
            return result.ToString();
        }

        public static string BuildCommandLine(string application, string[] arguments)
        {
            StringBuilder line = new StringBuilder(QuoteArgument(application));
            if (arguments != null)
            {
                foreach (string argument in arguments)
                {
                    line.Append(' ');
                    line.Append(QuoteArgument(argument));
                }
            }
            return line.ToString();
        }

        private static string BuildCreateProcessCommandLine(
            string application,
            string[] arguments)
        {
            // cmd.exe /s /c has its own quoting contract: the command after
            // /c must be surrounded by one literal quote pair while quotes
            // inside that command remain untouched. Applying the normal CRT
            // backslash escaping here makes cmd.exe treat those backslashes as
            // data, which silently breaks commands such as:
            //   node -e "process.stdout.write('value')"
            if (
                Path.GetFileName(application).Equals(
                    "cmd.exe",
                    StringComparison.OrdinalIgnoreCase) &&
                arguments != null &&
                arguments.Length == 4 &&
                arguments[0].Equals("/d", StringComparison.OrdinalIgnoreCase) &&
                arguments[1].Equals("/s", StringComparison.OrdinalIgnoreCase) &&
                arguments[2].Equals("/c", StringComparison.OrdinalIgnoreCase))
            {
                return
                    QuoteArgument(application) +
                    " /d /s /c \"" +
                    arguments[3] +
                    "\"";
            }
            return BuildCommandLine(application, arguments);
        }

        private static string ResolveApplication(string application)
        {
            if (String.IsNullOrWhiteSpace(application))
                throw new ArgumentException("Target application is empty");

            if (Path.IsPathRooted(application) || application.IndexOf('\\') >= 0 ||
                application.IndexOf('/') >= 0)
            {
                string rooted = Path.GetFullPath(application);
                if (File.Exists(rooted)) return rooted;
                throw new FileNotFoundException("Target application was not found", rooted);
            }

            string[] extensions;
            if (Path.HasExtension(application))
            {
                extensions = new[] { String.Empty };
            }
            else
            {
                string pathExt = Environment.GetEnvironmentVariable("PATHEXT") ??
                    ".COM;.EXE;.BAT;.CMD";
                string[] configured = pathExt.Split(
                    new[] { ';' },
                    StringSplitOptions.RemoveEmptyEntries);
                extensions = new string[configured.Length + 1];
                extensions[0] = String.Empty;
                Array.Copy(configured, 0, extensions, 1, configured.Length);
            }

            string searchPath = Environment.GetEnvironmentVariable("PATH") ?? String.Empty;
            foreach (string directory in searchPath.Split(Path.PathSeparator))
            {
                if (String.IsNullOrWhiteSpace(directory)) continue;
                foreach (string extension in extensions)
                {
                    string candidate = Path.Combine(
                        directory.Trim().Trim('"'),
                        application + extension);
                    if (File.Exists(candidate)) return Path.GetFullPath(candidate);
                }
            }
            throw new FileNotFoundException(
                "Target application was not found on PATH",
                application);
        }

        private static Byte GetCrtFlags(IntPtr handle)
        {
            UInt32 fileType = GetFileType(handle);
            if (fileType == FILE_TYPE_DISK) return CRT_FOPEN;
            if (fileType == FILE_TYPE_PIPE)
                return CRT_FOPEN | CRT_FPIPE;
            if (fileType == FILE_TYPE_CHAR)
                return CRT_FOPEN | CRT_FDEV;
            throw new InvalidDataException(
                "Inherited descriptor has an unsupported handle type");
        }

        private static bool IsInvalidHandle(IntPtr handle)
        {
            return
                handle == IntPtr.Zero ||
                handle == new IntPtr(-1) ||
                handle == new IntPtr(-2);
        }

        private static IntPtr PrepareStandardHandle(
            Int32 standardHandle,
            UInt32 fallbackAccess,
            List<IntPtr> ownedHandles)
        {
            IntPtr handle = GetStdHandle(standardHandle);
            if (
                !IsInvalidHandle(handle) &&
                SetHandleInformation(
                    handle,
                    HANDLE_FLAG_INHERIT,
                    HANDLE_FLAG_INHERIT))
            {
                return handle;
            }

            SECURITY_ATTRIBUTES attributes = new SECURITY_ATTRIBUTES();
            attributes.nLength = checked(
                (UInt32)Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)));
            attributes.bInheritHandle = true;
            IntPtr fallback = CreateFile(
                "NUL",
                fallbackAccess,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                ref attributes,
                OPEN_EXISTING,
                FILE_ATTRIBUTE_NORMAL,
                IntPtr.Zero);
            if (IsInvalidHandle(fallback))
                ThrowLastError("CreateFile(NUL)");
            ownedHandles.Add(fallback);
            return fallback;
        }

        private static IntPtr BuildNodeDescriptorTable(
            int nodeIpcFd,
            IntPtr standardInput,
            IntPtr standardOutput,
            IntPtr standardError,
            out UInt16 descriptorBytes)
        {
            descriptorBytes = 0;
            if (nodeIpcFd < 0) return IntPtr.Zero;
            if (nodeIpcFd > 255)
                throw new InvalidDataException(
                    "Node IPC descriptor is outside the CRT table range");

            int descriptorCount = Math.Max(3, nodeIpcFd + 1);
            int bufferSize = checked(
                sizeof(Int32) +
                descriptorCount +
                IntPtr.Size * descriptorCount);
            IntPtr buffer = Marshal.AllocHGlobal(bufferSize);
            try
            {
                for (int offset = 0; offset < bufferSize; offset++)
                    Marshal.WriteByte(buffer, offset, 0);
                Marshal.WriteInt32(buffer, descriptorCount);
                for (int fd = 0; fd < descriptorCount; fd++)
                {
                    IntPtr handle;
                    if (fd == 0)
                        handle = standardInput;
                    else if (fd == 1)
                        handle = standardOutput;
                    else if (fd == 2)
                        handle = standardError;
                    else if (fd == nodeIpcFd)
                        handle = _get_osfhandle(fd);
                    else
                        handle = new IntPtr(-1);

                    int handleOffset = checked(
                        sizeof(Int32) +
                        descriptorCount +
                        IntPtr.Size * fd);
                    if (
                        handle == IntPtr.Zero ||
                        handle == new IntPtr(-1) ||
                        handle == new IntPtr(-2))
                    {
                        if (fd == nodeIpcFd)
                            throw new InvalidDataException(
                                "Node IPC descriptor has no inherited OS handle");
                        if (IntPtr.Size == sizeof(Int64))
                            Marshal.WriteInt64(buffer, handleOffset, -1);
                        else
                            Marshal.WriteInt32(buffer, handleOffset, -1);
                        continue;
                    }

                    if (!SetHandleInformation(
                        handle,
                        HANDLE_FLAG_INHERIT,
                        HANDLE_FLAG_INHERIT))
                        ThrowLastError("SetHandleInformation(CRT descriptor)");
                    Marshal.WriteByte(
                        buffer,
                        sizeof(Int32) + fd,
                        GetCrtFlags(handle));
                    if (IntPtr.Size == sizeof(Int64))
                        Marshal.WriteInt64(
                            buffer,
                            handleOffset,
                            handle.ToInt64());
                    else
                        Marshal.WriteInt32(
                            buffer,
                            handleOffset,
                            handle.ToInt32());
                }
                descriptorBytes = checked((UInt16)bufferSize);
                return buffer;
            }
            catch
            {
                Marshal.FreeHGlobal(buffer);
                throw;
            }
        }

        public static int Run(
            string application,
            string[] arguments,
            int cpuSeconds,
            long processMemoryBytes,
            int activeProcessLimit,
            int nodeIpcFd,
            string identityPath)
        {
            application = ResolveApplication(application);
            string extension = Path.GetExtension(application);
            if (extension.Equals(".cmd", StringComparison.OrdinalIgnoreCase) ||
                extension.Equals(".bat", StringComparison.OrdinalIgnoreCase))
            {
                string commandText = BuildCommandLine(application, arguments);
                application = ResolveApplication(
                    Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe");
                arguments = new[] { "/d", "/s", "/c", commandText };
            }

            IntPtr sourceToken = IntPtr.Zero;
            IntPtr restrictedToken = IntPtr.Zero;
            IntPtr job = IntPtr.Zero;
            IntPtr limitBuffer = IntPtr.Zero;
            IntPtr descriptorBuffer = IntPtr.Zero;
            List<IntPtr> ownedStandardHandles = new List<IntPtr>();
            PROCESS_INFORMATION processInfo = new PROCESS_INFORMATION();

            try
            {
                UInt32 tokenAccess =
                    TOKEN_ASSIGN_PRIMARY |
                    TOKEN_DUPLICATE |
                    TOKEN_QUERY |
                    TOKEN_ADJUST_DEFAULT |
                    TOKEN_ADJUST_SESSIONID;
                if (!OpenProcessToken(GetCurrentProcess(), tokenAccess, out sourceToken))
                    ThrowLastError("OpenProcessToken");

                if (!CreateRestrictedToken(
                    sourceToken,
                    DISABLE_MAX_PRIVILEGE | LUA_TOKEN,
                    0,
                    IntPtr.Zero,
                    0,
                    IntPtr.Zero,
                    0,
                    IntPtr.Zero,
                    out restrictedToken))
                    ThrowLastError("CreateRestrictedToken");

                job = CreateJobObject(IntPtr.Zero, null);
                if (job == IntPtr.Zero) ThrowLastError("CreateJobObject");

                JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits =
                    new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
                limits.BasicLimitInformation.LimitFlags =
                    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                if (cpuSeconds > 0)
                {
                    limits.BasicLimitInformation.LimitFlags |=
                        JOB_OBJECT_LIMIT_PROCESS_TIME;
                    limits.BasicLimitInformation.PerProcessUserTimeLimit =
                        checked((long)cpuSeconds * 10000000L);
                }
                if (activeProcessLimit > 0)
                {
                    limits.BasicLimitInformation.LimitFlags |=
                        JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
                    limits.BasicLimitInformation.ActiveProcessLimit =
                        checked((UInt32)activeProcessLimit);
                }
                if (processMemoryBytes > 0)
                {
                    limits.BasicLimitInformation.LimitFlags |=
                        JOB_OBJECT_LIMIT_PROCESS_MEMORY;
                    limits.ProcessMemoryLimit =
                        new UIntPtr(checked((UInt64)processMemoryBytes));
                }

                int limitSize = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
                limitBuffer = Marshal.AllocHGlobal(limitSize);
                Marshal.StructureToPtr(limits, limitBuffer, false);
                if (!SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    limitBuffer,
                    checked((UInt32)limitSize)))
                    ThrowLastError("SetInformationJobObject");

                // Node/libuv communicates Windows stdio entries above fd 2
                // (including its fd 3 IPC channel) through the CRT descriptor
                // table in STARTUPINFO.cbReserved2/lpReserved2. Copy the
                // helper's inherited table into the restricted target instead
                // of reducing the launch contract to stdin/stdout/stderr.
                STARTUPINFO startup = new STARTUPINFO();
                startup.cb = checked((UInt32)Marshal.SizeOf(typeof(STARTUPINFO)));
                startup.dwFlags = STARTF_USESTDHANDLES;
                startup.hStdInput = PrepareStandardHandle(
                    -10,
                    GENERIC_READ,
                    ownedStandardHandles);
                startup.hStdOutput = PrepareStandardHandle(
                    -11,
                    GENERIC_WRITE,
                    ownedStandardHandles);
                startup.hStdError = PrepareStandardHandle(
                    -12,
                    GENERIC_WRITE,
                    ownedStandardHandles);
                UInt16 descriptorBytes;
                descriptorBuffer = BuildNodeDescriptorTable(
                    nodeIpcFd,
                    startup.hStdInput,
                    startup.hStdOutput,
                    startup.hStdError,
                    out descriptorBytes);
                startup.cbReserved2 = descriptorBytes;
                startup.lpReserved2 = descriptorBuffer;

                StringBuilder commandLine =
                    new StringBuilder(
                        BuildCreateProcessCommandLine(application, arguments));
                if (!CreateProcessAsUser(
                    restrictedToken,
                    application,
                    commandLine,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    true,
                    CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT,
                    IntPtr.Zero,
                    Environment.CurrentDirectory,
                    ref startup,
                    out processInfo))
                    ThrowLastError("CreateProcessAsUser");

                // The target now owns its inherited copy of the duplex IPC
                // pipe. Close the helper's CRT descriptor so process.disconnect
                // and channel EOF retain native Node child semantics even while
                // the helper continues waiting on the target process handle.
                if (nodeIpcFd >= 0 && _close(nodeIpcFd) != 0)
                {
                    TerminateProcess(processInfo.hProcess, 125);
                    throw new IOException(
                        "Closing the Windows sandbox IPC relay descriptor failed");
                }

                if (!AssignProcessToJobObject(job, processInfo.hProcess))
                {
                    TerminateProcess(processInfo.hProcess, 125);
                    ThrowLastError("AssignProcessToJobObject");
                }
                if (ResumeThread(processInfo.hThread) == UInt32.MaxValue)
                {
                    TerminateProcess(processInfo.hProcess, 125);
                    ThrowLastError("ResumeThread");
                }

                if (!String.IsNullOrWhiteSpace(identityPath))
                {
                    string identity = String.Format(
                        CultureInfo.InvariantCulture,
                        "{{\"targetPid\":{0},\"helperPid\":{1}}}",
                        processInfo.dwProcessId,
                        System.Diagnostics.Process.GetCurrentProcess().Id);
                    using (FileStream stream = new FileStream(
                        identityPath,
                        FileMode.CreateNew,
                        FileAccess.Write,
                        FileShare.Read))
                    using (StreamWriter writer = new StreamWriter(
                        stream,
                        new UTF8Encoding(false)))
                    {
                        writer.Write(identity);
                    }
                }

                WaitForSingleObject(processInfo.hProcess, INFINITE);
                UInt32 exitCode;
                if (!GetExitCodeProcess(processInfo.hProcess, out exitCode))
                    ThrowLastError("GetExitCodeProcess");
                return unchecked((int)exitCode);
            }
            finally
            {
                if (processInfo.hThread != IntPtr.Zero) CloseHandle(processInfo.hThread);
                if (processInfo.hProcess != IntPtr.Zero) CloseHandle(processInfo.hProcess);
                if (descriptorBuffer != IntPtr.Zero)
                    Marshal.FreeHGlobal(descriptorBuffer);
                foreach (IntPtr handle in ownedStandardHandles)
                    CloseHandle(handle);
                if (limitBuffer != IntPtr.Zero) Marshal.FreeHGlobal(limitBuffer);
                if (job != IntPtr.Zero) CloseHandle(job);
                if (restrictedToken != IntPtr.Zero) CloseHandle(restrictedToken);
                if (sourceToken != IntPtr.Zero) CloseHandle(sourceToken);
            }
        }
    }

    public static class Program
    {
        private sealed class LaunchSpec
        {
            public int cpuSeconds { get; set; }
            public long processMemoryBytes { get; set; }
            public int activeProcessLimit { get; set; }
            public string command { get; set; }
            public string[] args { get; set; }
            public int nodeIpcFd { get; set; }
            public string identityPath { get; set; }
        }

        public static int Main(string[] args)
        {
            LaunchSpec spec = null;
            try
            {
                if (args == null || args.Length != 1)
                    throw new ArgumentException("Expected one encoded launch payload");

                string json = Encoding.UTF8.GetString(
                    Convert.FromBase64String(args[0]));
                spec = new JavaScriptSerializer().Deserialize<LaunchSpec>(json);
                if (spec == null || String.IsNullOrWhiteSpace(spec.command))
                    throw new ArgumentException("Launch payload is incomplete");
                return Native.Run(
                    spec.command,
                    spec.args ?? new string[0],
                    spec.cpuSeconds,
                    spec.processMemoryBytes,
                    spec.activeProcessLimit,
                    spec.nodeIpcFd,
                    spec.identityPath);
            }
            catch (Exception error)
            {
                if (!String.IsNullOrWhiteSpace(spec == null ? null : spec.identityPath))
                {
                    try
                    {
                        string failure = new JavaScriptSerializer().Serialize(
                            new
                            {
                                error = error.ToString(),
                                helperPid =
                                    System.Diagnostics.Process.GetCurrentProcess().Id
                            });
                        File.WriteAllText(
                            spec.identityPath,
                            failure,
                            new UTF8Encoding(false));
                    }
                    catch
                    {
                        // The original native failure remains authoritative.
                    }
                }
                Console.Error.WriteLine(
                    "CC_WINDOWS_SANDBOX_ERROR: " + error.Message);
                return 125;
            }
        }
    }
}
'@

try {
  if (-not (Test-Path -LiteralPath $CacheExecutable)) {
    $temporaryExecutable = (
      $CacheExecutable + "." + [Diagnostics.Process]::GetCurrentProcess().Id + ".exe"
    )
    Add-Type `
      -TypeDefinition $nativeSource `
      -Language CSharp `
      -ReferencedAssemblies "System.Web.Extensions" `
      -OutputAssembly $temporaryExecutable `
      -OutputType ConsoleApplication
    try {
      [IO.File]::Move($temporaryExecutable, $CacheExecutable)
    }
    catch {
      if (-not (Test-Path -LiteralPath $CacheExecutable)) {
        throw
      }
      Remove-Item -LiteralPath $temporaryExecutable -Force -ErrorAction SilentlyContinue
    }
  }
  if ($CompileOnly) {
    exit 0
  }
  & $CacheExecutable @HelperArguments
  exit $LASTEXITCODE
}
catch {
  [Console]::Error.WriteLine(
    "CC_WINDOWS_SANDBOX_ERROR: " + $_.Exception.Message
  )
  exit 125
}
