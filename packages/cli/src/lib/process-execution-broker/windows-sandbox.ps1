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
        private const UInt32 DETACHED_PROCESS = 0x00000008;
        private const UInt32 CREATE_NEW_PROCESS_GROUP = 0x00000200;
        private const UInt32 CREATE_UNICODE_ENVIRONMENT = 0x00000400;
        private const UInt32 EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
        private const UInt32 STARTF_USESHOWWINDOW = 0x00000001;
        private const UInt32 STARTF_USESTDHANDLES = 0x00000100;
        private const UInt16 SW_HIDE = 0;
        private const UInt32 INFINITE = 0xffffffff;
        private const UInt32 WAIT_OBJECT_0 = 0x00000000;
        private const UInt32 HANDLE_FLAG_INHERIT = 0x00000001;
        private const Int32 ERROR_INSUFFICIENT_BUFFER = 122;
        private const Int32 HRESULT_FROM_WIN32_ERROR_ALREADY_EXISTS =
            unchecked((Int32)0x800700B7);
        private const Int32 TokenPrivileges = 3;
        private const Int32 TokenIsAppContainer = 29;
        private const Int32 TokenCapabilities = 30;
        private const Int32 TokenAppContainerSid = 31;
        private static readonly IntPtr PROC_THREAD_ATTRIBUTE_HANDLE_LIST =
            new IntPtr(0x00020002);
        private static readonly IntPtr PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES =
            new IntPtr(0x00020009);
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
        private const Int32 JobObjectBasicAccountingInformation = 1;
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

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct STARTUPINFOEX
        {
            public STARTUPINFO StartupInfo;
            public IntPtr lpAttributeList;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct SECURITY_CAPABILITIES
        {
            public IntPtr AppContainerSid;
            public IntPtr Capabilities;
            public UInt32 CapabilityCount;
            public UInt32 Reserved;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct LUID
        {
            public UInt32 LowPart;
            public Int32 HighPart;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct LUID_AND_ATTRIBUTES
        {
            public LUID Luid;
            public UInt32 Attributes;
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

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION
        {
            public Int64 TotalUserTime;
            public Int64 TotalKernelTime;
            public Int64 ThisPeriodTotalUserTime;
            public Int64 ThisPeriodTotalKernelTime;
            public UInt32 TotalPageFaultCount;
            public UInt32 TotalProcesses;
            public UInt32 ActiveProcesses;
            public UInt32 TotalTerminatedProcesses;
        }

        [DllImport("kernel32.dll")]
        private static extern IntPtr GetCurrentProcess();

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CloseHandle(IntPtr handle);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr LocalFree(IntPtr memory);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern IntPtr FreeSid(IntPtr sid);

        [DllImport("advapi32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool EqualSid(IntPtr firstSid, IntPtr secondSid);

        [DllImport(
            "advapi32.dll",
            CharSet = CharSet.Unicode,
            SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool ConvertSidToStringSid(
            IntPtr sid,
            out IntPtr stringSid);

        [DllImport("userenv.dll", CharSet = CharSet.Unicode)]
        private static extern Int32 CreateAppContainerProfile(
            string appContainerName,
            string displayName,
            string description,
            IntPtr capabilities,
            UInt32 capabilityCount,
            out IntPtr appContainerSid);

        [DllImport("userenv.dll", CharSet = CharSet.Unicode)]
        private static extern Int32 DeriveAppContainerSidFromAppContainerName(
            string appContainerName,
            out IntPtr appContainerSid);

        [DllImport("userenv.dll", CharSet = CharSet.Unicode)]
        private static extern Int32 DeleteAppContainerProfile(
            string appContainerName);

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
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool InitializeProcThreadAttributeList(
            IntPtr attributeList,
            Int32 attributeCount,
            Int32 flags,
            ref IntPtr size);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool UpdateProcThreadAttribute(
            IntPtr attributeList,
            UInt32 flags,
            IntPtr attribute,
            IntPtr value,
            IntPtr size,
            IntPtr previousValue,
            IntPtr returnSize);

        [DllImport("kernel32.dll")]
        private static extern void DeleteProcThreadAttributeList(
            IntPtr attributeList);

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

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool TerminateJobObject(
            IntPtr job,
            UInt32 exitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool QueryInformationJobObject(
            IntPtr job,
            Int32 infoClass,
            IntPtr info,
            UInt32 infoLength,
            out UInt32 returnLength);

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

        [DllImport("advapi32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool IsTokenRestricted(IntPtr token);

        [DllImport("advapi32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetTokenInformation(
            IntPtr token,
            Int32 tokenInformationClass,
            IntPtr tokenInformation,
            UInt32 tokenInformationLength,
            out UInt32 returnLength);

        [DllImport(
            "advapi32.dll",
            CharSet = CharSet.Unicode,
            SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool LookupPrivilegeName(
            string systemName,
            ref LUID luid,
            StringBuilder name,
            ref UInt32 nameLength);

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
            ref STARTUPINFOEX startupInfo,
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

        private static void ThrowHResult(string operation, Int32 hresult)
        {
            Exception systemError = Marshal.GetExceptionForHR(hresult);
            throw new COMException(
                String.Format(
                    CultureInfo.InvariantCulture,
                    "{0} failed (hresult=0x{1:X8}: {2})",
                    operation,
                    unchecked((UInt32)hresult),
                    systemError == null ? "unknown error" : systemError.Message),
                hresult);
        }

        private static void ValidateAppContainerName(string appContainerName)
        {
            if (
                String.IsNullOrWhiteSpace(appContainerName) ||
                appContainerName.Length > 64)
            {
                throw new ArgumentException(
                    "AppContainer profile name must contain 1-64 characters");
            }
            foreach (char current in appContainerName)
            {
                if (
                    Char.IsLetterOrDigit(current) ||
                    current == '-' ||
                    current == '_' ||
                    current == '.' ||
                    current == ' ')
                {
                    continue;
                }
                throw new ArgumentException(
                    "AppContainer profile name contains an unsupported character");
            }
        }

        private static IntPtr EnsureAppContainerProfile(string appContainerName)
        {
            ValidateAppContainerName(appContainerName);
            IntPtr appContainerSid;
            Int32 hresult = CreateAppContainerProfile(
                appContainerName,
                "ChainlessChain CLI Sandbox",
                "Zero-capability process sandbox for ChainlessChain CLI",
                IntPtr.Zero,
                0,
                out appContainerSid);
            if (hresult == HRESULT_FROM_WIN32_ERROR_ALREADY_EXISTS)
            {
                hresult = DeriveAppContainerSidFromAppContainerName(
                    appContainerName,
                    out appContainerSid);
            }
            if (hresult < 0)
                ThrowHResult("CreateAppContainerProfile", hresult);
            if (IsInvalidHandle(appContainerSid))
                throw new InvalidDataException(
                    "AppContainer profile did not return a SID");
            return appContainerSid;
        }

        private static string SidToString(IntPtr sid)
        {
            if (IsInvalidHandle(sid))
                throw new InvalidDataException("Cannot stringify an invalid SID");
            IntPtr stringSid;
            if (!ConvertSidToStringSid(sid, out stringSid))
                ThrowLastError("ConvertSidToStringSid");
            try
            {
                string value = Marshal.PtrToStringUni(stringSid);
                if (String.IsNullOrWhiteSpace(value))
                    throw new InvalidDataException(
                        "ConvertSidToStringSid returned an empty SID");
                return value;
            }
            finally
            {
                LocalFree(stringSid);
            }
        }

        public static string PrepareAppContainerProfile(string appContainerName)
        {
            IntPtr appContainerSid = IntPtr.Zero;
            try
            {
                appContainerSid = EnsureAppContainerProfile(appContainerName);
                return SidToString(appContainerSid);
            }
            finally
            {
                if (!IsInvalidHandle(appContainerSid))
                    FreeSid(appContainerSid);
            }
        }

        public static void DeletePreparedAppContainerProfile(
            string appContainerName,
            string expectedAppContainerSid)
        {
            // DeleteAppContainerProfile is idempotent for an absent profile.
            // Deriving the deterministic SID first keeps both the native
            // finally path and the broker fallback bound to the same profile.
            ValidateAppContainerName(appContainerName);
            if (!String.IsNullOrWhiteSpace(expectedAppContainerSid))
            {
                IntPtr derivedSid = IntPtr.Zero;
                try
                {
                    Int32 deriveResult =
                        DeriveAppContainerSidFromAppContainerName(
                            appContainerName,
                            out derivedSid);
                    if (deriveResult < 0)
                    {
                        ThrowHResult(
                            "DeriveAppContainerSidFromAppContainerName",
                            deriveResult);
                    }
                    string actualSid = SidToString(derivedSid);
                    if (!String.Equals(
                        actualSid,
                        expectedAppContainerSid,
                        StringComparison.OrdinalIgnoreCase))
                    {
                        throw new InvalidDataException(
                            "Refusing to delete an AppContainer profile whose SID does not match");
                    }
                }
                finally
                {
                    if (!IsInvalidHandle(derivedSid))
                        FreeSid(derivedSid);
                }
            }

            Int32 deleteResult = 0;
            for (int attempt = 0; attempt < 40; attempt++)
            {
                deleteResult = DeleteAppContainerProfile(appContainerName);
                if (deleteResult >= 0)
                    return;
                if (attempt < 39)
                    System.Threading.Thread.Sleep(25);
            }
            ThrowHResult("DeleteAppContainerProfile", deleteResult);
        }

        public static void AssertAppContainerProfileAbsent(
            string appContainerName)
        {
            ValidateAppContainerName(appContainerName);
            IntPtr verificationSid = IntPtr.Zero;
            bool createdVerificationProfile = false;
            string verificationSidText = null;
            try
            {
                Int32 createResult = CreateAppContainerProfile(
                    appContainerName,
                    "ChainlessChain CLI Sandbox Cleanup Verification",
                    "Ephemeral profile used to verify sandbox cleanup",
                    IntPtr.Zero,
                    0,
                    out verificationSid);
                if (createResult == HRESULT_FROM_WIN32_ERROR_ALREADY_EXISTS)
                {
                    throw new InvalidDataException(
                        "AppContainer profile still exists after cleanup");
                }
                if (createResult < 0)
                    ThrowHResult(
                        "CreateAppContainerProfile(cleanup verification)",
                        createResult);
                createdVerificationProfile = true;
                verificationSidText = SidToString(verificationSid);
            }
            finally
            {
                if (!IsInvalidHandle(verificationSid))
                    FreeSid(verificationSid);
                if (createdVerificationProfile)
                {
                    DeletePreparedAppContainerProfile(
                        appContainerName,
                        verificationSidText);
                }
            }
        }

        private static void TerminateAndAwaitEmptyJob(IntPtr job)
        {
            if (job == IntPtr.Zero)
                return;
            if (!TerminateJobObject(job, 125))
                ThrowLastError("TerminateJobObject");

            int informationSize = Marshal.SizeOf(
                typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION));
            IntPtr information = Marshal.AllocHGlobal(informationSize);
            try
            {
                for (int attempt = 0; attempt < 100; attempt++)
                {
                    UInt32 returnLength;
                    if (!QueryInformationJobObject(
                        job,
                        JobObjectBasicAccountingInformation,
                        information,
                        checked((UInt32)informationSize),
                        out returnLength))
                    {
                        ThrowLastError("QueryInformationJobObject");
                    }
                    JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting =
                        (JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)
                            Marshal.PtrToStructure(
                                information,
                                typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION));
                    if (accounting.ActiveProcesses == 0)
                        return;
                    System.Threading.Thread.Sleep(10);
                }
                throw new TimeoutException(
                    "Windows sandbox Job retained active processes after termination");
            }
            finally
            {
                Marshal.FreeHGlobal(information);
            }
        }

        private static IntPtr ReadTokenInformation(
            IntPtr token,
            Int32 informationClass,
            out UInt32 informationLength)
        {
            informationLength = 0;
            bool probeSucceeded = GetTokenInformation(
                token,
                informationClass,
                IntPtr.Zero,
                0,
                out informationLength);
            int probeError = Marshal.GetLastWin32Error();
            if (
                probeSucceeded ||
                probeError != ERROR_INSUFFICIENT_BUFFER ||
                informationLength == 0)
            {
                throw new Win32Exception(
                    probeError,
                    "GetTokenInformation(size) failed");
            }

            IntPtr information = Marshal.AllocHGlobal(
                checked((Int32)informationLength));
            try
            {
                for (int offset = 0; offset < checked((Int32)informationLength); offset++)
                    Marshal.WriteByte(information, offset, 0);
                if (!GetTokenInformation(
                    token,
                    informationClass,
                    information,
                    informationLength,
                    out informationLength))
                {
                    ThrowLastError("GetTokenInformation");
                }
                return information;
            }
            catch
            {
                Marshal.FreeHGlobal(information);
                throw;
            }
        }

        private static string AttestAppContainerTarget(
            IntPtr process,
            IntPtr expectedAppContainerSid)
        {
            IntPtr targetToken = IntPtr.Zero;
            IntPtr isAppContainerBuffer = IntPtr.Zero;
            IntPtr capabilitiesBuffer = IntPtr.Zero;
            IntPtr appContainerBuffer = IntPtr.Zero;
            IntPtr privilegesBuffer = IntPtr.Zero;
            try
            {
                if (!OpenProcessToken(process, TOKEN_QUERY, out targetToken))
                    ThrowLastError("OpenProcessToken(target)");

                UInt32 informationLength;
                isAppContainerBuffer = ReadTokenInformation(
                    targetToken,
                    TokenIsAppContainer,
                    out informationLength);
                if (
                    informationLength < sizeof(Int32) ||
                    Marshal.ReadInt32(isAppContainerBuffer) == 0)
                {
                    throw new InvalidDataException(
                        "Target token is not an AppContainer token");
                }

                capabilitiesBuffer = ReadTokenInformation(
                    targetToken,
                    TokenCapabilities,
                    out informationLength);
                if (
                    informationLength < sizeof(Int32) ||
                    Marshal.ReadInt32(capabilitiesBuffer) != 0)
                {
                    throw new InvalidDataException(
                        "Target AppContainer token is not zero-capability");
                }

                appContainerBuffer = ReadTokenInformation(
                    targetToken,
                    TokenAppContainerSid,
                    out informationLength);
                if (informationLength < IntPtr.Size)
                    throw new InvalidDataException(
                        "Target AppContainer token omitted its SID");
                IntPtr actualAppContainerSid =
                    Marshal.ReadIntPtr(appContainerBuffer);
                if (
                    IsInvalidHandle(actualAppContainerSid) ||
                    !EqualSid(actualAppContainerSid, expectedAppContainerSid))
                {
                    throw new InvalidDataException(
                        "Target AppContainer SID does not match the prepared profile");
                }

                privilegesBuffer = ReadTokenInformation(
                    targetToken,
                    TokenPrivileges,
                    out informationLength);
                if (informationLength < sizeof(Int32))
                    throw new InvalidDataException(
                        "Target token omitted its privilege list");
                Int32 privilegeCount = Marshal.ReadInt32(privilegesBuffer);
                int privilegeOffset = sizeof(Int32);
                int privilegeSize = Marshal.SizeOf(
                    typeof(LUID_AND_ATTRIBUTES));
                for (int index = 0; index < privilegeCount; index++)
                {
                    int entryOffset = checked(
                        privilegeOffset + index * privilegeSize);
                    if (
                        checked((UInt32)(entryOffset + privilegeSize)) >
                        informationLength)
                        throw new InvalidDataException(
                            "Target token privilege list is truncated");
                    LUID_AND_ATTRIBUTES privilege =
                        (LUID_AND_ATTRIBUTES)Marshal.PtrToStructure(
                            IntPtr.Add(privilegesBuffer, entryOffset),
                            typeof(LUID_AND_ATTRIBUTES));
                    UInt32 privilegeNameLength = 0;
                    LookupPrivilegeName(
                        null,
                        ref privilege.Luid,
                        null,
                        ref privilegeNameLength);
                    if (privilegeNameLength == 0)
                        ThrowLastError("LookupPrivilegeName(size)");
                    StringBuilder privilegeName = new StringBuilder(
                        checked((Int32)privilegeNameLength + 1));
                    if (!LookupPrivilegeName(
                        null,
                        ref privilege.Luid,
                        privilegeName,
                        ref privilegeNameLength))
                    {
                        ThrowLastError("LookupPrivilegeName");
                    }
                    if (!String.Equals(
                        privilegeName.ToString(),
                        "SeChangeNotifyPrivilege",
                        StringComparison.Ordinal))
                    {
                        throw new InvalidDataException(
                            "Target AppContainer token retained an unexpected privilege");
                    }
                }
                return SidToString(actualAppContainerSid);
            }
            finally
            {
                if (privilegesBuffer != IntPtr.Zero)
                    Marshal.FreeHGlobal(privilegesBuffer);
                if (appContainerBuffer != IntPtr.Zero)
                    Marshal.FreeHGlobal(appContainerBuffer);
                if (capabilitiesBuffer != IntPtr.Zero)
                    Marshal.FreeHGlobal(capabilitiesBuffer);
                if (isAppContainerBuffer != IntPtr.Zero)
                    Marshal.FreeHGlobal(isAppContainerBuffer);
                if (targetToken != IntPtr.Zero)
                    CloseHandle(targetToken);
            }
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
            // stdin/stdout/stderr are transferred by STARTUPINFO. Only attach
            // the CRT descriptor table when Node needs a descriptor above fd 2
            // (its fd 3 IPC channel); this also preserves the previously proven
            // non-IPC startup contract on hosted Windows runners.
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

        private static IntPtr BuildInheritedHandleList(
            IntPtr standardInput,
            IntPtr standardOutput,
            IntPtr standardError,
            int nodeIpcFd,
            out IntPtr handleBytes)
        {
            List<IntPtr> handles = new List<IntPtr>();
            handles.Add(standardInput);
            if (!handles.Contains(standardOutput))
                handles.Add(standardOutput);
            if (!handles.Contains(standardError))
                handles.Add(standardError);

            if (nodeIpcFd >= 0)
            {
                IntPtr ipcHandle = _get_osfhandle(nodeIpcFd);
                if (IsInvalidHandle(ipcHandle))
                    throw new InvalidDataException(
                        "Node IPC descriptor has no inherited OS handle");
                if (!handles.Contains(ipcHandle))
                    handles.Add(ipcHandle);
            }

            foreach (IntPtr handle in handles)
            {
                if (IsInvalidHandle(handle))
                    throw new InvalidDataException(
                        "Inherited standard handle is invalid");
                if (!SetHandleInformation(
                    handle,
                    HANDLE_FLAG_INHERIT,
                    HANDLE_FLAG_INHERIT))
                    ThrowLastError("SetHandleInformation(handle list)");
            }

            int bufferSize = checked(handles.Count * IntPtr.Size);
            IntPtr buffer = Marshal.AllocHGlobal(bufferSize);
            try
            {
                for (int index = 0; index < handles.Count; index++)
                    Marshal.WriteIntPtr(
                        buffer,
                        checked(index * IntPtr.Size),
                        handles[index]);
                handleBytes = new IntPtr(bufferSize);
                return buffer;
            }
            catch
            {
                Marshal.FreeHGlobal(buffer);
                throw;
            }
        }

        private static IntPtr BuildProcessAttributeList(
            IntPtr inheritedHandles,
            IntPtr inheritedHandleBytes,
            IntPtr appContainerSid,
            out IntPtr securityCapabilitiesBuffer)
        {
            securityCapabilitiesBuffer = IntPtr.Zero;
            bool useAppContainer = !IsInvalidHandle(appContainerSid);
            IntPtr attributeBytes = IntPtr.Zero;
            bool probeSucceeded = InitializeProcThreadAttributeList(
                IntPtr.Zero,
                useAppContainer ? 2 : 1,
                0,
                ref attributeBytes);
            int probeError = Marshal.GetLastWin32Error();
            if (probeSucceeded || probeError != ERROR_INSUFFICIENT_BUFFER)
                throw new Win32Exception(
                    probeError,
                    "InitializeProcThreadAttributeList(size) failed");

            IntPtr attributeList = Marshal.AllocHGlobal(attributeBytes);
            bool initialized = false;
            try
            {
                if (!InitializeProcThreadAttributeList(
                    attributeList,
                    useAppContainer ? 2 : 1,
                    0,
                    ref attributeBytes))
                    ThrowLastError("InitializeProcThreadAttributeList");
                initialized = true;
                if (!UpdateProcThreadAttribute(
                    attributeList,
                    0,
                    PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                    inheritedHandles,
                    inheritedHandleBytes,
                    IntPtr.Zero,
                    IntPtr.Zero))
                    ThrowLastError("UpdateProcThreadAttribute(handle list)");

                if (useAppContainer)
                {
                    SECURITY_CAPABILITIES securityCapabilities =
                        new SECURITY_CAPABILITIES();
                    securityCapabilities.AppContainerSid = appContainerSid;
                    securityCapabilities.Capabilities = IntPtr.Zero;
                    securityCapabilities.CapabilityCount = 0;
                    securityCapabilities.Reserved = 0;
                    int securityCapabilitiesSize = Marshal.SizeOf(
                        typeof(SECURITY_CAPABILITIES));
                    securityCapabilitiesBuffer = Marshal.AllocHGlobal(
                        securityCapabilitiesSize);
                    Marshal.StructureToPtr(
                        securityCapabilities,
                        securityCapabilitiesBuffer,
                        false);
                    if (!UpdateProcThreadAttribute(
                        attributeList,
                        0,
                        PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
                        securityCapabilitiesBuffer,
                        new IntPtr(securityCapabilitiesSize),
                        IntPtr.Zero,
                        IntPtr.Zero))
                    {
                        ThrowLastError(
                            "UpdateProcThreadAttribute(security capabilities)");
                    }
                }
                return attributeList;
            }
            catch
            {
                if (securityCapabilitiesBuffer != IntPtr.Zero)
                {
                    Marshal.FreeHGlobal(securityCapabilitiesBuffer);
                    securityCapabilitiesBuffer = IntPtr.Zero;
                }
                if (initialized)
                    DeleteProcThreadAttributeList(attributeList);
                Marshal.FreeHGlobal(attributeList);
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
            bool detached,
            bool windowsHide,
            string identityPath,
            string appContainerProfileName,
            string expectedAppContainerSid)
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
            IntPtr appContainerSid = IntPtr.Zero;
            IntPtr job = IntPtr.Zero;
            IntPtr limitBuffer = IntPtr.Zero;
            IntPtr descriptorBuffer = IntPtr.Zero;
            IntPtr inheritedHandleBuffer = IntPtr.Zero;
            IntPtr attributeList = IntPtr.Zero;
            IntPtr securityCapabilitiesBuffer = IntPtr.Zero;
            List<IntPtr> ownedStandardHandles = new List<IntPtr>();
            PROCESS_INFORMATION processInfo = new PROCESS_INFORMATION();
            bool useAppContainer =
                !String.IsNullOrWhiteSpace(appContainerProfileName);
            string attestedAppContainerSid = null;
            bool targetExited = false;
            int targetExitCode = 125;
            Exception launchError = null;

            try
            {
                if (useAppContainer)
                {
                    if (String.IsNullOrWhiteSpace(expectedAppContainerSid))
                        throw new ArgumentException(
                            "AppContainer launch omitted its expected profile SID");
                    appContainerSid = EnsureAppContainerProfile(
                        appContainerProfileName);
                    string preparedSid = SidToString(appContainerSid);
                    if (!String.Equals(
                        preparedSid,
                        expectedAppContainerSid,
                        StringComparison.OrdinalIgnoreCase))
                    {
                        throw new InvalidDataException(
                            "Prepared AppContainer SID does not match launch payload");
                    }
                }

                UInt32 tokenAccess =
                    TOKEN_ASSIGN_PRIMARY |
                    TOKEN_DUPLICATE |
                    TOKEN_QUERY |
                    TOKEN_ADJUST_DEFAULT |
                    TOKEN_ADJUST_SESSIONID;
                if (!OpenProcessToken(
                    GetCurrentProcess(),
                    tokenAccess,
                    out sourceToken))
                {
                    ThrowLastError("OpenProcessToken");
                }

                UInt32 restrictedTokenFlags = DISABLE_MAX_PRIVILEGE;
                // Re-applying LUA_TOKEN to an already restricted parent can
                // fail with ERROR_INVALID_PARAMETER. Preserve the parent's
                // existing restrictions and always remove maximum privileges.
                if (!IsTokenRestricted(sourceToken))
                    restrictedTokenFlags |= LUA_TOKEN;
                if (!CreateRestrictedToken(
                    sourceToken,
                    restrictedTokenFlags,
                    0,
                    IntPtr.Zero,
                    0,
                    IntPtr.Zero,
                    0,
                    IntPtr.Zero,
                    out restrictedToken))
                {
                    ThrowLastError("CreateRestrictedToken");
                }

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
                // table in STARTUPINFO.cbReserved2/lpReserved2. Standard
                // descriptors remain in STARTUPINFO's dedicated handle fields.
                STARTUPINFOEX startup = new STARTUPINFOEX();
                startup.StartupInfo.cb = checked(
                    (UInt32)Marshal.SizeOf(typeof(STARTUPINFOEX)));
                startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
                if (windowsHide)
                {
                    startup.StartupInfo.dwFlags |= STARTF_USESHOWWINDOW;
                    startup.StartupInfo.wShowWindow = SW_HIDE;
                }
                startup.StartupInfo.hStdInput = PrepareStandardHandle(
                    -10,
                    GENERIC_READ,
                    ownedStandardHandles);
                startup.StartupInfo.hStdOutput = PrepareStandardHandle(
                    -11,
                    GENERIC_WRITE,
                    ownedStandardHandles);
                startup.StartupInfo.hStdError = PrepareStandardHandle(
                    -12,
                    GENERIC_WRITE,
                    ownedStandardHandles);
                UInt16 descriptorBytes;
                descriptorBuffer = BuildNodeDescriptorTable(
                    nodeIpcFd,
                    startup.StartupInfo.hStdInput,
                    startup.StartupInfo.hStdOutput,
                    startup.StartupInfo.hStdError,
                    out descriptorBytes);
                startup.StartupInfo.cbReserved2 = descriptorBytes;
                startup.StartupInfo.lpReserved2 = descriptorBuffer;

                IntPtr inheritedHandleBytes;
                inheritedHandleBuffer = BuildInheritedHandleList(
                    startup.StartupInfo.hStdInput,
                    startup.StartupInfo.hStdOutput,
                    startup.StartupInfo.hStdError,
                    nodeIpcFd,
                    out inheritedHandleBytes);
                attributeList = BuildProcessAttributeList(
                    inheritedHandleBuffer,
                    inheritedHandleBytes,
                    appContainerSid,
                    out securityCapabilitiesBuffer);
                startup.lpAttributeList = attributeList;

                StringBuilder commandLine =
                    new StringBuilder(
                        BuildCreateProcessCommandLine(application, arguments));
                UInt32 creationFlags =
                    CREATE_SUSPENDED |
                    CREATE_UNICODE_ENVIRONMENT |
                    EXTENDED_STARTUPINFO_PRESENT;
                if (detached)
                    creationFlags |= DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP;
                bool processCreated = CreateProcessAsUser(
                    restrictedToken,
                    application,
                    commandLine,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    true,
                    creationFlags,
                    IntPtr.Zero,
                    Environment.CurrentDirectory,
                    ref startup,
                    out processInfo);
                if (!processCreated)
                {
                    ThrowLastError(
                        useAppContainer
                            ? "CreateProcessAsUser(AppContainer)"
                            : "CreateProcessAsUser");
                }

                if (useAppContainer)
                {
                    try
                    {
                        attestedAppContainerSid = AttestAppContainerTarget(
                            processInfo.hProcess,
                            appContainerSid);
                    }
                    catch
                    {
                        TerminateProcess(processInfo.hProcess, 125);
                        throw;
                    }
                }

                // The target now owns its inherited copy of the duplex IPC
                // pipe. Close the helper's CRT descriptor so process.disconnect
                // and channel EOF retain native Node child semantics even while
                // the helper continues waiting on the target process handle.
                if (nodeIpcFd >= 0)
                {
                    int ipcDescriptor = nodeIpcFd;
                    nodeIpcFd = -1;
                    if (_close(ipcDescriptor) != 0)
                    {
                        TerminateProcess(processInfo.hProcess, 125);
                        throw new IOException(
                            "Closing the Windows sandbox IPC relay descriptor failed");
                    }
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
                    string identity = new JavaScriptSerializer().Serialize(
                        new
                        {
                            targetPid = processInfo.dwProcessId,
                            helperPid =
                                System.Diagnostics.Process.GetCurrentProcess().Id,
                            appContainer = useAppContainer,
                            appContainerSid = attestedAppContainerSid,
                            capabilityCount = useAppContainer ? 0 : -1
                        });
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

                UInt32 waitResult = WaitForSingleObject(
                    processInfo.hProcess,
                    INFINITE);
                if (waitResult != WAIT_OBJECT_0)
                    ThrowLastError("WaitForSingleObject(target)");
                targetExited = true;
                UInt32 exitCode;
                if (!GetExitCodeProcess(processInfo.hProcess, out exitCode))
                    ThrowLastError("GetExitCodeProcess");
                targetExitCode = unchecked((int)exitCode);
            }
            catch (Exception error)
            {
                launchError = error;
            }
            finally
            {
                Exception cleanupError = null;
                if (processInfo.hProcess != IntPtr.Zero && !targetExited)
                    TerminateProcess(processInfo.hProcess, 125);
                if (job != IntPtr.Zero)
                {
                    try
                    {
                        TerminateAndAwaitEmptyJob(job);
                    }
                    catch (Exception error)
                    {
                        cleanupError = error;
                    }
                    CloseHandle(job);
                    job = IntPtr.Zero;
                }
                if (processInfo.hProcess != IntPtr.Zero && !targetExited)
                {
                    UInt32 cleanupWait = WaitForSingleObject(
                        processInfo.hProcess,
                        10000);
                    if (cleanupWait != WAIT_OBJECT_0)
                    {
                        Exception waitError = new IOException(
                            "Timed out terminating the Windows sandbox target");
                        cleanupError =
                            cleanupError == null
                                ? waitError
                                : new AggregateException(
                                    "Windows sandbox process-tree cleanup failed",
                                    cleanupError,
                                    waitError);
                    }
                }
                if (processInfo.hThread != IntPtr.Zero) CloseHandle(processInfo.hThread);
                if (processInfo.hProcess != IntPtr.Zero) CloseHandle(processInfo.hProcess);
                if (attributeList != IntPtr.Zero)
                {
                    DeleteProcThreadAttributeList(attributeList);
                    Marshal.FreeHGlobal(attributeList);
                }
                if (securityCapabilitiesBuffer != IntPtr.Zero)
                    Marshal.FreeHGlobal(securityCapabilitiesBuffer);
                if (inheritedHandleBuffer != IntPtr.Zero)
                    Marshal.FreeHGlobal(inheritedHandleBuffer);
                if (descriptorBuffer != IntPtr.Zero)
                    Marshal.FreeHGlobal(descriptorBuffer);
                foreach (IntPtr handle in ownedStandardHandles)
                    CloseHandle(handle);
                if (limitBuffer != IntPtr.Zero) Marshal.FreeHGlobal(limitBuffer);
                if (!IsInvalidHandle(appContainerSid)) FreeSid(appContainerSid);
                if (restrictedToken != IntPtr.Zero) CloseHandle(restrictedToken);
                if (sourceToken != IntPtr.Zero) CloseHandle(sourceToken);
                if (nodeIpcFd >= 0)
                    _close(nodeIpcFd);
                if (useAppContainer)
                {
                    try
                    {
                        DeletePreparedAppContainerProfile(
                            appContainerProfileName,
                            expectedAppContainerSid);
                    }
                    catch (Exception error)
                    {
                        cleanupError =
                            cleanupError == null
                                ? error
                                : new AggregateException(
                                    "AppContainer target and profile cleanup failed",
                                    cleanupError,
                                    error);
                    }
                }
                if (cleanupError != null)
                {
                    launchError =
                        launchError == null
                            ? cleanupError
                            : new AggregateException(
                                "AppContainer launch and cleanup failed",
                                launchError,
                                cleanupError);
                }
            }
            if (launchError != null)
                throw launchError;
            return targetExitCode;
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
            public bool detached { get; set; }
            public bool windowsHide { get; set; }
            public string identityPath { get; set; }
            public string appContainerProfileName { get; set; }
            public string appContainerSid { get; set; }
        }

        public static int Main(string[] args)
        {
            LaunchSpec spec = null;
            try
            {
                if (
                    args != null &&
                    args.Length == 2 &&
                    String.Equals(
                        args[0],
                        "--prepare-appcontainer",
                        StringComparison.Ordinal))
                {
                    string profileName = args[1];
                    string probeSid = null;
                    string preparedSid = null;
                    bool leavePreparedProfile = false;
                    try
                    {
                        probeSid = Native.PrepareAppContainerProfile(
                            profileName);
                        preparedSid = probeSid;
                        int probeExitCode = Native.Run(
                            Path.Combine(Environment.SystemDirectory, "cmd.exe"),
                            new[] { "/d", "/s", "/c", "exit 0" },
                            0,
                            0,
                            1,
                            -1,
                            false,
                            true,
                            null,
                            profileName,
                            probeSid);
                        if (probeExitCode != 0)
                            throw new InvalidDataException(
                                "AppContainer readiness target returned a non-zero exit code");

                        preparedSid = Native.PrepareAppContainerProfile(
                            profileName);
                        if (!String.Equals(
                            preparedSid,
                            probeSid,
                            StringComparison.OrdinalIgnoreCase))
                        {
                            throw new InvalidDataException(
                                "AppContainer SID changed during readiness attestation");
                        }
                        string readiness =
                            new JavaScriptSerializer().Serialize(
                                new
                                {
                                    ready = true,
                                    profileName = profileName,
                                    appContainerSid = preparedSid,
                                    capabilityCount = 0,
                                    tokenAttested = true,
                                    restrictedTokenAttested = true
                                });
                        Console.Out.Write(readiness);
                        leavePreparedProfile = true;
                        return 0;
                    }
                    finally
                    {
                        if (
                            !leavePreparedProfile &&
                            !String.IsNullOrWhiteSpace(preparedSid))
                        {
                            Native.DeletePreparedAppContainerProfile(
                                profileName,
                                preparedSid);
                        }
                    }
                }

                if (
                    args != null &&
                    (args.Length == 2 || args.Length == 3) &&
                    String.Equals(
                        args[0],
                        "--delete-appcontainer",
                        StringComparison.Ordinal))
                {
                    string expectedSid = args.Length == 3 ? args[2] : null;
                    Native.DeletePreparedAppContainerProfile(
                        args[1],
                        expectedSid);
                    Native.AssertAppContainerProfileAbsent(args[1]);
                    Console.Out.Write(
                        new JavaScriptSerializer().Serialize(
                            new
                            {
                                deleted = true,
                                absent = true,
                                profileName = args[1]
                            }));
                    return 0;
                }

                if (
                    args != null &&
                    args.Length == 2 &&
                    String.Equals(
                        args[0],
                        "--assert-appcontainer-absent",
                        StringComparison.Ordinal))
                {
                    Native.AssertAppContainerProfileAbsent(args[1]);
                    Console.Out.Write(
                        new JavaScriptSerializer().Serialize(
                            new
                            {
                                absent = true,
                                profileName = args[1]
                            }));
                    return 0;
                }

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
                    spec.detached,
                    spec.windowsHide,
                    spec.identityPath,
                    spec.appContainerProfileName,
                    spec.appContainerSid);
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
  if (Test-Path -LiteralPath $CacheExecutable) {
    throw "Refusing to trust a pre-existing native adapter executable"
  }
  $temporaryExecutable = (
    $CacheExecutable + "." + [Diagnostics.Process]::GetCurrentProcess().Id + ".exe"
  )
  if (Test-Path -LiteralPath $temporaryExecutable) {
    throw "Refusing to overwrite a pre-existing native adapter compile output"
  }
  try {
    Add-Type `
      -TypeDefinition $nativeSource `
      -Language CSharp `
      -ReferencedAssemblies "System.Web.Extensions" `
      -OutputAssembly $temporaryExecutable `
      -OutputType ConsoleApplication
    [IO.File]::Move($temporaryExecutable, $CacheExecutable)
  }
  finally {
    if (Test-Path -LiteralPath $temporaryExecutable) {
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
