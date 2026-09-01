param(
  [Parameter(Mandatory = $true)]
  [string]$RequestBase64
)

$ErrorActionPreference = "Stop"

if (-not ("P110OwnedJob" -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class P110OwnedJob
{
    private const uint CREATE_SUSPENDED = 0x00000004;
    private const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    private const uint CREATE_NO_WINDOW = 0x08000000;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    private const uint WAIT_OBJECT_0 = 0x00000000;
    private const uint WAIT_TIMEOUT = 0x00000102;
    private const uint INFINITE = 0xFFFFFFFF;

    [StructLayout(LayoutKind.Sequential)]
    private struct SECURITY_ATTRIBUTES
    {
        public int nLength;
        public IntPtr lpSecurityDescriptor;
        public int bInheritHandle;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public uint dwX;
        public uint dwY;
        public uint dwXSize;
        public uint dwYSize;
        public uint dwXCountChars;
        public uint dwYCountChars;
        public uint dwFillAttribute;
        public uint dwFlags;
        public short wShowWindow;
        public short cbReserved2;
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
        public uint dwProcessId;
        public uint dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
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

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION
    {
        public long TotalUserTime;
        public long TotalKernelTime;
        public long ThisPeriodTotalUserTime;
        public long ThisPeriodTotalKernelTime;
        public uint TotalPageFaultCount;
        public uint TotalProcesses;
        public uint ActiveProcesses;
        public uint TotalTerminatedProcesses;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr attributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(
        IntPtr job,
        int informationClass,
        IntPtr information,
        uint informationLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool QueryInformationJobObject(
        IntPtr job,
        int informationClass,
        IntPtr information,
        uint informationLength,
        IntPtr returnLength);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcess(
        string applicationName,
        StringBuilder commandLine,
        IntPtr processAttributes,
        IntPtr threadAttributes,
        bool inheritHandles,
        uint creationFlags,
        IntPtr environment,
        string currentDirectory,
        ref STARTUPINFO startupInfo,
        out PROCESS_INFORMATION processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint ResumeThread(IntPtr thread);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateJobObject(IntPtr job, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateProcess(IntPtr process, uint exitCode);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    private static void ThrowLastError(string operation)
    {
        throw new Win32Exception(Marshal.GetLastWin32Error(), operation);
    }

    private static string Quote(string value)
    {
        if (value.Length > 0 && value.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return value;
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char character in value)
        {
            if (character == '\\')
            {
                slashes++;
            }
            else if (character == '"')
            {
                result.Append('\\', slashes * 2 + 1).Append('"');
                slashes = 0;
            }
            else
            {
                result.Append('\\', slashes).Append(character);
                slashes = 0;
            }
        }
        result.Append('\\', slashes * 2).Append('"');
        return result.ToString();
    }

    private static uint ActiveProcesses(IntPtr job)
    {
        int size = Marshal.SizeOf(typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION));
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try
        {
            if (!QueryInformationJobObject(job, 1, buffer, (uint)size, IntPtr.Zero))
                ThrowLastError("QueryInformationJobObject");
            return ((JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)Marshal.PtrToStructure(
                buffer,
                typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION))).ActiveProcesses;
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    public static int Run(string executable, string[] arguments, string workingDirectory, uint timeoutMs)
    {
        IntPtr job = IntPtr.Zero;
        IntPtr limits = IntPtr.Zero;
        PROCESS_INFORMATION process = new PROCESS_INFORMATION();
        bool processCreated = false;
        bool jobAssigned = false;
        bool cleanupConfirmed = false;
        try
        {
            job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) ThrowLastError("CreateJobObject");

            var extended = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            extended.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            int limitSize = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            limits = Marshal.AllocHGlobal(limitSize);
            Marshal.StructureToPtr(extended, limits, false);
            if (!SetInformationJobObject(job, 9, limits, (uint)limitSize))
                ThrowLastError("SetInformationJobObject");

            var command = new StringBuilder(Quote(executable));
            foreach (string argument in arguments) command.Append(' ').Append(Quote(argument));
            var startup = new STARTUPINFO();
            startup.cb = Marshal.SizeOf(typeof(STARTUPINFO));
            if (!CreateProcess(
                executable,
                command,
                IntPtr.Zero,
                IntPtr.Zero,
                false,
                CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW,
                IntPtr.Zero,
                workingDirectory,
                ref startup,
                out process)) ThrowLastError("CreateProcess");
            processCreated = true;
            if (!AssignProcessToJobObject(job, process.hProcess))
                ThrowLastError("AssignProcessToJobObject");
            jobAssigned = true;
            if (ResumeThread(process.hThread) == 0xFFFFFFFF) ThrowLastError("ResumeThread");

            uint wait = WaitForSingleObject(process.hProcess, timeoutMs);
            bool timedOut = wait == WAIT_TIMEOUT;
            if (wait != WAIT_OBJECT_0 && !timedOut) ThrowLastError("WaitForSingleObject");
            uint exitCode = 124;
            if (!timedOut && !GetExitCodeProcess(process.hProcess, out exitCode))
                ThrowLastError("GetExitCodeProcess");

            // Always terminate the Job after the main process exits. This makes
            // a nominally successful harness unable to leave descendants alive.
            if (!TerminateJobObject(job, timedOut ? 124u : exitCode))
                ThrowLastError("TerminateJobObject");
            DateTime cleanupDeadline = DateTime.UtcNow.AddSeconds(10);
            while (ActiveProcesses(job) != 0 && DateTime.UtcNow < cleanupDeadline)
                Thread.Sleep(25);
            if (ActiveProcesses(job) != 0)
                throw new InvalidOperationException("Windows harness Job Object did not become empty");
            cleanupConfirmed = true;
            return timedOut ? 124 : unchecked((int)exitCode);
        }
        finally
        {
            // A suspended process that failed assignment is not owned by the
            // Job Object. Closing its handle would leak it forever, so kill
            // and wait for that exact process before releasing any handle.
            if (processCreated && !jobAssigned && process.hProcess != IntPtr.Zero)
            {
                if (WaitForSingleObject(process.hProcess, 0) == WAIT_TIMEOUT)
                    TerminateProcess(process.hProcess, 125);
                WaitForSingleObject(process.hProcess, INFINITE);
            }
            else if (jobAssigned && !cleanupConfirmed && job != IntPtr.Zero)
            {
                // Any exception after assignment still empties the whole Job.
                TerminateJobObject(job, 125);
                DateTime emergencyDeadline = DateTime.UtcNow.AddSeconds(10);
                while (ActiveProcesses(job) != 0 && DateTime.UtcNow < emergencyDeadline)
                    Thread.Sleep(25);
            }
            if (process.hThread != IntPtr.Zero) CloseHandle(process.hThread);
            if (process.hProcess != IntPtr.Zero) CloseHandle(process.hProcess);
            if (limits != IntPtr.Zero) Marshal.FreeHGlobal(limits);
            if (job != IntPtr.Zero) CloseHandle(job);
        }
    }
}
'@
}

try {
  $requestBytes = [Convert]::FromBase64String($RequestBase64)
  $requestJson = [Text.Encoding]::UTF8.GetString($requestBytes)
  $request = $requestJson | ConvertFrom-Json
  if (-not $request.executable -or -not $request.args -or -not $request.timeoutMs) {
    throw "Invalid owned-process request"
  }
  $arguments = @($request.args | ForEach-Object { [string]$_ })
  $exitCode = [P110OwnedJob]::Run(
    [string]$request.executable,
    $arguments,
    [Environment]::CurrentDirectory,
    [uint32]$request.timeoutMs
  )
  exit $exitCode
}
catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 125
}
