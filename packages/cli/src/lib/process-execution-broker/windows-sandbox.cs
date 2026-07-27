using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Globalization;
using System.IO;
using Microsoft.Win32.SafeHandles;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace ChainlessChain.WindowsSandbox
{
    public static class Native
    {
        public const string SourceSha256 =
            "__CHAINLESS_WINDOWS_SANDBOX_SOURCE_SHA256__";

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
        private const UInt32 WAIT_TIMEOUT = 0x00000102;
        private const UInt32 HANDLE_FLAG_INHERIT = 0x00000001;
        private const Int32 ERROR_INSUFFICIENT_BUFFER = 122;
        private const Int32 ERROR_IO_PENDING = 997;
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
        private const UInt32 DRIVE_UNKNOWN = 0;
        private const UInt32 DRIVE_NO_ROOT_DIR = 1;
        private const UInt32 DRIVE_REMOTE = 4;
        private const UInt16 IMAGE_FILE_MACHINE_I386 = 0x014c;
        private const UInt16 IMAGE_FILE_MACHINE_ARMNT = 0x01c4;
        private const UInt16 IMAGE_FILE_MACHINE_AMD64 = 0x8664;
        private const UInt16 IMAGE_FILE_MACHINE_ARM64 = 0xaa64;
        private const UInt32 GENERIC_READ = 0x80000000;
        private const UInt32 GENERIC_WRITE = 0x40000000;
        private const UInt32 FILE_SHARE_READ = 0x00000001;
        private const UInt32 FILE_SHARE_WRITE = 0x00000002;
        private const UInt32 OPEN_EXISTING = 3;
        private const UInt32 FILE_ATTRIBUTE_DIRECTORY = 0x00000010;
        private const UInt32 FILE_ATTRIBUTE_NORMAL = 0x00000080;
        private const UInt32 FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400;
        private const UInt32 FILE_FLAG_OVERLAPPED = 0x40000000;
        private const UInt32 FSCTL_REQUEST_FILTER_OPLOCK = 0x0009005C;
        private const UInt32 VOLUME_NAME_DOS = 0x00000000;
        private const UInt32 FILE_NAME_NORMALIZED = 0x00000000;
        private const Int32 FileIdInfo = 18;

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
        private struct NATIVE_OVERLAPPED
        {
            public UIntPtr Internal;
            public UIntPtr InternalHigh;
            public UInt32 Offset;
            public UInt32 OffsetHigh;
            public IntPtr EventHandle;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct FILE_TIME
        {
            public UInt32 LowDateTime;
            public UInt32 HighDateTime;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct BY_HANDLE_FILE_INFORMATION
        {
            public UInt32 FileAttributes;
            public FILE_TIME CreationTime;
            public FILE_TIME LastAccessTime;
            public FILE_TIME LastWriteTime;
            public UInt32 VolumeSerialNumber;
            public UInt32 FileSizeHigh;
            public UInt32 FileSizeLow;
            public UInt32 NumberOfLinks;
            public UInt32 FileIndexHigh;
            public UInt32 FileIndexLow;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct FILE_ID_128
        {
            public UInt64 LowPart;
            public UInt64 HighPart;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct FILE_ID_INFO
        {
            public UInt64 VolumeSerialNumber;
            public FILE_ID_128 FileId;
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

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        private static extern UInt32 GetDriveType(string rootPathName);

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

        [DllImport(
            "kernel32.dll",
            CharSet = CharSet.Unicode,
            SetLastError = true)]
        private static extern IntPtr CreateEvent(
            IntPtr eventAttributes,
            [MarshalAs(UnmanagedType.Bool)] bool manualReset,
            [MarshalAs(UnmanagedType.Bool)] bool initialState,
            string name);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CreatePipe(
            out IntPtr readPipe,
            out IntPtr writePipe,
            ref SECURITY_ATTRIBUTES pipeAttributes,
            UInt32 size);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool DeviceIoControl(
            IntPtr device,
            UInt32 controlCode,
            IntPtr inputBuffer,
            UInt32 inputBufferSize,
            IntPtr outputBuffer,
            UInt32 outputBufferSize,
            out UInt32 bytesReturned,
            IntPtr overlapped);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CancelIoEx(
            IntPtr handle,
            IntPtr overlapped);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetFileInformationByHandle(
            IntPtr file,
            out BY_HANDLE_FILE_INFORMATION information);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetFileInformationByHandleEx(
            IntPtr file,
            Int32 informationClass,
            out FILE_ID_INFO information,
            UInt32 informationSize);

        [DllImport(
            "kernel32.dll",
            CharSet = CharSet.Unicode,
            SetLastError = true)]
        private static extern UInt32 GetFinalPathNameByHandle(
            IntPtr file,
            StringBuilder path,
            UInt32 pathLength,
            UInt32 flags);

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

        private static string GetEnvironmentValue(
            Dictionary<string, string> environment,
            string name,
            string fallback)
        {
            if (environment != null)
            {
                foreach (KeyValuePair<string, string> entry in environment)
                {
                    if (String.Equals(
                        entry.Key,
                        name,
                        StringComparison.OrdinalIgnoreCase))
                    {
                        return entry.Value;
                    }
                }
            }
            return fallback;
        }

        private static Dictionary<string, string> CaptureCurrentEnvironment()
        {
            Dictionary<string, string> captured =
                new Dictionary<string, string>(
                    StringComparer.OrdinalIgnoreCase);
            foreach (
                System.Collections.DictionaryEntry entry in
                    Environment.GetEnvironmentVariables())
            {
                string name = Convert.ToString(
                    entry.Key,
                    CultureInfo.InvariantCulture);
                string value = Convert.ToString(
                    entry.Value,
                    CultureInfo.InvariantCulture);
                if (!String.IsNullOrEmpty(name))
                    captured[name] = value ?? String.Empty;
            }
            return captured;
        }

        private static void RemoveEnvironmentValue(
            Dictionary<string, string> environment,
            string name)
        {
            if (environment == null) return;
            string matched = null;
            foreach (string key in environment.Keys)
            {
                if (String.Equals(
                    key,
                    name,
                    StringComparison.OrdinalIgnoreCase))
                {
                    matched = key;
                    break;
                }
            }
            if (matched != null) environment.Remove(matched);
        }

        private static IntPtr BuildEnvironmentBlock(
            Dictionary<string, string> environment)
        {
            SortedDictionary<string, string> sorted =
                new SortedDictionary<string, string>(
                    StringComparer.OrdinalIgnoreCase);
            if (environment != null)
            {
                foreach (KeyValuePair<string, string> entry in environment)
                {
                    if (
                        String.IsNullOrEmpty(entry.Key) ||
                        entry.Key.IndexOf('=') >= 0 ||
                        entry.Key.IndexOf('\0') >= 0 ||
                        (entry.Value ?? String.Empty).IndexOf('\0') >= 0)
                    {
                        throw new InvalidDataException(
                            "Target environment contains an invalid entry");
                    }
                    if (sorted.ContainsKey(entry.Key))
                        throw new InvalidDataException(
                            "Target environment contains duplicate keys");
                    sorted.Add(entry.Key, entry.Value ?? String.Empty);
                }
            }

            StringBuilder block = new StringBuilder();
            foreach (KeyValuePair<string, string> entry in sorted)
            {
                block.Append(entry.Key);
                block.Append('=');
                block.Append(entry.Value);
                block.Append('\0');
            }
            if (sorted.Count == 0) block.Append('\0');
            block.Append('\0');
            if (block.Length > 32767)
                throw new InvalidDataException(
                    "Target environment exceeds the Windows environment-block limit");
            return Marshal.StringToHGlobalUni(block.ToString());
        }

        private static bool IsLocalDosDriveRoot(string root)
        {
            return
                !String.IsNullOrEmpty(root) &&
                root.Length == 3 &&
                Char.IsLetter(root[0]) &&
                root[1] == ':' &&
                (root[2] == '\\' || root[2] == '/');
        }

        private static string NormalizeLocalDosPath(
            string value,
            string baseDirectory,
            string description)
        {
            if (
                String.IsNullOrWhiteSpace(value) ||
                value.IndexOf('\0') >= 0)
            {
                throw new InvalidDataException(
                    description + " is empty or invalid");
            }

            string fullPath;
            if (Path.IsPathRooted(value))
            {
                string suppliedRoot = Path.GetPathRoot(value);
                if (!IsLocalDosDriveRoot(suppliedRoot))
                {
                    throw new InvalidDataException(
                        description + " must use a local DOS drive");
                }
                fullPath = Path.GetFullPath(value);
            }
            else
            {
                if (String.IsNullOrWhiteSpace(baseDirectory))
                {
                    throw new InvalidDataException(
                        description + " must be an absolute local path");
                }
                fullPath = Path.GetFullPath(
                    Path.Combine(baseDirectory, value));
            }

            string root = Path.GetPathRoot(fullPath);
            if (!IsLocalDosDriveRoot(root))
            {
                throw new InvalidDataException(
                    description + " must use a local DOS drive");
            }
            UInt32 driveType = GetDriveType(root);
            if (
                driveType == DRIVE_UNKNOWN ||
                driveType == DRIVE_NO_ROOT_DIR ||
                driveType == DRIVE_REMOTE)
            {
                throw new InvalidDataException(
                    description + " must not use a remote or unavailable drive");
            }
            return fullPath;
        }

        private static FileAttributes ValidateExistingLocalNonReparsePath(
            string fullPath,
            string description)
        {
            string root = Path.GetPathRoot(fullPath);
            string current = root;
            FileAttributes attributes = File.GetAttributes(root);
            string relative = fullPath.Substring(root.Length);
            string[] components = relative.Split(
                new[] { '\\', '/' },
                StringSplitOptions.RemoveEmptyEntries);
            foreach (string component in components)
            {
                current = Path.Combine(current, component);
                attributes = File.GetAttributes(current);
                if ((attributes & FileAttributes.ReparsePoint) != 0)
                {
                    throw new InvalidDataException(
                        description + " contains a reparse component");
                }
            }
            return attributes;
        }

        private static void ValidateExistingLocalNonReparseFile(
            string fullPath,
            string description)
        {
            FileAttributes attributes =
                ValidateExistingLocalNonReparsePath(fullPath, description);
            if ((attributes & FileAttributes.Directory) != 0)
            {
                throw new FileNotFoundException(
                    description + " is not a regular file",
                    fullPath);
            }
        }

        private static bool TryValidateExistingLocalNonReparseDirectory(
            string fullPath)
        {
            try
            {
                FileAttributes attributes =
                    ValidateExistingLocalNonReparsePath(
                        fullPath,
                        "Target PATH directory");
                return (attributes & FileAttributes.Directory) != 0;
            }
            catch (FileNotFoundException)
            {
                return false;
            }
            catch (DirectoryNotFoundException)
            {
                return false;
            }
        }

        private static string ResolveApplication(
            string application,
            string workingDirectory,
            Dictionary<string, string> environment)
        {
            if (
                String.IsNullOrWhiteSpace(application) ||
                application.IndexOf('\0') >= 0)
                throw new ArgumentException("Target application is empty");

            if (Path.IsPathRooted(application) || application.IndexOf('\\') >= 0 ||
                application.IndexOf('/') >= 0)
            {
                string rooted = NormalizeLocalDosPath(
                    application,
                    workingDirectory,
                    "Target application");
                ValidateExistingLocalNonReparseFile(
                    rooted,
                    "Target application");
                return rooted;
            }

            string[] extensions;
            if (Path.HasExtension(application))
            {
                extensions = new[] { String.Empty };
            }
            else
            {
                string pathExt = GetEnvironmentValue(
                    environment,
                    "PATHEXT",
                    ".COM;.EXE;.BAT;.CMD");
                string[] configured = pathExt.Split(
                    new[] { ';' },
                    StringSplitOptions.RemoveEmptyEntries);
                extensions = new string[configured.Length + 1];
                extensions[0] = String.Empty;
                for (int index = 0; index < configured.Length; index++)
                {
                    string extension = configured[index].Trim();
                    if (
                        extension.Length < 2 ||
                        extension[0] != '.' ||
                        extension.IndexOfAny(
                            new[] { '\\', '/', ':', '"', '\0' }) >= 0)
                    {
                        throw new InvalidDataException(
                            "Target PATHEXT contains an invalid extension");
                    }
                    extensions[index + 1] = extension;
                }
            }

            string searchPath = GetEnvironmentValue(
                environment,
                "PATH",
                String.Empty);
            foreach (string directory in searchPath.Split(Path.PathSeparator))
            {
                if (String.IsNullOrWhiteSpace(directory)) continue;
                string searchDirectory = directory.Trim().Trim('"');
                searchDirectory = NormalizeLocalDosPath(
                    searchDirectory,
                    workingDirectory,
                    "Target PATH directory");
                if (!TryValidateExistingLocalNonReparseDirectory(
                    searchDirectory))
                {
                    continue;
                }
                foreach (string extension in extensions)
                {
                    string candidate = Path.Combine(
                        searchDirectory,
                        application + extension);
                    try
                    {
                        ValidateExistingLocalNonReparseFile(
                            candidate,
                            "Target application");
                        return candidate;
                    }
                    catch (FileNotFoundException)
                    {
                        // Continue searching the remaining local PATH entries.
                    }
                    catch (DirectoryNotFoundException)
                    {
                        // Continue searching the remaining local PATH entries.
                    }
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

        private static void AssertSnapshotRuntimeBitness(string application)
        {
            SECURITY_ATTRIBUTES attributes = new SECURITY_ATTRIBUTES();
            attributes.nLength = checked(
                (UInt32)Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)));
            attributes.bInheritHandle = false;
            IntPtr runtimeHandle = CreateFile(
                application,
                GENERIC_READ,
                FILE_SHARE_READ,
                ref attributes,
                OPEN_EXISTING,
                FILE_ATTRIBUTE_NORMAL,
                IntPtr.Zero);
            if (IsInvalidHandle(runtimeHandle))
                ThrowLastError("CreateFile(entry snapshot runtime)");

            UInt16 machine;
            try
            {
                using (SafeFileHandle safeHandle =
                    new SafeFileHandle(runtimeHandle, false))
                using (FileStream stream =
                    new FileStream(safeHandle, FileAccess.Read))
                using (BinaryReader reader = new BinaryReader(stream))
                {
                    if (stream.Length < 64 || reader.ReadUInt16() != 0x5a4d)
                        throw new InvalidDataException(
                            "Entry snapshot runtime is not a PE image");
                    stream.Position = 0x3c;
                    Int32 peOffset = reader.ReadInt32();
                    if (peOffset < 64 || peOffset > stream.Length - 6)
                        throw new InvalidDataException(
                            "Entry snapshot runtime has an invalid PE header");
                    stream.Position = peOffset;
                    if (reader.ReadUInt32() != 0x00004550)
                        throw new InvalidDataException(
                            "Entry snapshot runtime has an invalid PE signature");
                    machine = reader.ReadUInt16();
                }
            }
            finally
            {
                CloseHandle(runtimeHandle);
            }

            bool compatible =
                ((machine == IMAGE_FILE_MACHINE_I386 ||
                  machine == IMAGE_FILE_MACHINE_ARMNT) &&
                 IntPtr.Size == sizeof(Int32)) ||
                ((machine == IMAGE_FILE_MACHINE_AMD64 ||
                  machine == IMAGE_FILE_MACHINE_ARM64) &&
                 IntPtr.Size == sizeof(Int64));
            if (!compatible)
            {
                throw new InvalidDataException(
                    "Entry snapshot runtime bitness does not match the Windows sandbox helper");
            }
        }

        private static bool IsInvalidHandle(IntPtr handle)
        {
            return
                handle == IntPtr.Zero ||
                handle == new IntPtr(-1) ||
                handle == new IntPtr(-2);
        }

        public sealed class LaunchPathLockSpec
        {
            public string role { get; set; }
            public string path { get; set; }
            public string sha256 { get; set; }
            public long bytes { get; set; }
            public string dev { get; set; }
            public string ino { get; set; }
        }

        private sealed class LaunchPathFileIdentity
        {
            public UInt64 VolumeSerialNumber;
            public UInt64 FileIdLow;
            public UInt64 FileIdHigh;
            public UInt64 NodeDevice;
            public UInt64 NodeFileId;
            public UInt64 Bytes;
            public UInt32 Links;
            public UInt32 Attributes;
            public string FinalPath;
        }

        private sealed class LaunchPathLock : IDisposable
        {
            public readonly string Role;
            public readonly string ExpectedPath;
            public readonly IntPtr BreakEvent;
            public readonly LaunchPathFileIdentity Identity;
            public readonly byte[] SnapshotContent;
            private IntPtr lockingHandle;
            private IntPtr readHandle;
            private IntPtr eventHandle;
            private IntPtr overlapped;
            private bool oplockPending;
            private bool disposed;

            public LaunchPathLock(
                LaunchPathLockSpec spec,
                IntPtr lockingHandleValue,
                IntPtr readHandleValue,
                IntPtr eventHandleValue,
                IntPtr overlappedValue,
                LaunchPathFileIdentity identity,
                byte[] snapshotContent)
            {
                Role = spec.role;
                ExpectedPath = spec.path;
                lockingHandle = lockingHandleValue;
                readHandle = readHandleValue;
                eventHandle = eventHandleValue;
                BreakEvent = eventHandleValue;
                overlapped = overlappedValue;
                oplockPending = true;
                Identity = identity;
                SnapshotContent = snapshotContent;
            }

            public void Dispose()
            {
                if (disposed) return;
                disposed = true;
                ReleaseLaunchPathLockHandles(
                    ref readHandle,
                    ref lockingHandle,
                    ref eventHandle,
                    ref overlapped,
                    oplockPending);
                oplockPending = false;
            }
        }

        private static void ReleaseLaunchPathLockHandles(
            ref IntPtr readHandle,
            ref IntPtr lockingHandle,
            ref IntPtr eventHandle,
            ref IntPtr overlapped,
            bool oplockPending)
        {
            if (!IsInvalidHandle(readHandle))
            {
                CloseHandle(readHandle);
                readHandle = IntPtr.Zero;
            }

            bool abandonOverlappedStorage = false;
            if (!IsInvalidHandle(lockingHandle) && oplockPending)
            {
                // A Filter oplock owns one pending OVERLAPPED operation until
                // it breaks or is cancelled. Cancel and wait before freeing
                // that fixed native storage. On the defensive timeout path,
                // keep the event/storage allocated until this short-lived
                // helper exits so the kernel can never write into freed memory.
                CancelIoEx(lockingHandle, overlapped);
                UInt32 cancelWait = IsInvalidHandle(eventHandle)
                    ? WAIT_TIMEOUT
                    : WaitForSingleObject(eventHandle, 10000);
                abandonOverlappedStorage = cancelWait != WAIT_OBJECT_0;
            }

            if (!IsInvalidHandle(lockingHandle))
            {
                CloseHandle(lockingHandle);
                lockingHandle = IntPtr.Zero;
            }
            if (!abandonOverlappedStorage)
            {
                if (!IsInvalidHandle(eventHandle))
                {
                    CloseHandle(eventHandle);
                    eventHandle = IntPtr.Zero;
                }
                if (overlapped != IntPtr.Zero)
                {
                    Marshal.FreeHGlobal(overlapped);
                    overlapped = IntPtr.Zero;
                }
            }
        }

        private static bool SameLaunchPathFile(
            LaunchPathFileIdentity left,
            LaunchPathFileIdentity right)
        {
            return
                left.VolumeSerialNumber == right.VolumeSerialNumber &&
                left.FileIdLow == right.FileIdLow &&
                left.FileIdHigh == right.FileIdHigh;
        }

        private static string NormalizeFinalPath(string value)
        {
            string normalized = value;
            if (normalized.StartsWith(
                @"\\?\UNC\",
                StringComparison.OrdinalIgnoreCase))
            {
                normalized = @"\\" + normalized.Substring(8);
            }
            else if (normalized.StartsWith(
                @"\\?\",
                StringComparison.OrdinalIgnoreCase))
            {
                normalized = normalized.Substring(4);
            }
            return Path.GetFullPath(normalized);
        }

        private static string GetHandleFinalPath(IntPtr handle)
        {
            UInt32 capacity = 512;
            while (capacity <= 32768)
            {
                StringBuilder output = new StringBuilder(checked((int)capacity));
                UInt32 written = GetFinalPathNameByHandle(
                    handle,
                    output,
                    capacity,
                    FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
                if (written == 0) ThrowLastError("GetFinalPathNameByHandle");
                if (written < capacity)
                    return NormalizeFinalPath(output.ToString());
                capacity = checked(written + 1);
            }
            throw new PathTooLongException(
                "Launch path exceeds the supported final-path limit");
        }

        private static LaunchPathFileIdentity ReadLaunchPathFileIdentity(
            IntPtr handle)
        {
            BY_HANDLE_FILE_INFORMATION basic;
            if (!GetFileInformationByHandle(handle, out basic))
                ThrowLastError("GetFileInformationByHandle(launch path)");
            if (
                (basic.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0 ||
                (basic.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
            {
                throw new InvalidDataException(
                    "Launch path handle is not a regular non-reparse file");
            }

            FILE_ID_INFO fileId;
            if (!GetFileInformationByHandleEx(
                handle,
                FileIdInfo,
                out fileId,
                checked((UInt32)Marshal.SizeOf(typeof(FILE_ID_INFO)))))
            {
                ThrowLastError("GetFileInformationByHandleEx(FileIdInfo)");
            }
            return new LaunchPathFileIdentity
            {
                VolumeSerialNumber = fileId.VolumeSerialNumber,
                FileIdLow = fileId.FileId.LowPart,
                FileIdHigh = fileId.FileId.HighPart,
                NodeDevice = basic.VolumeSerialNumber,
                NodeFileId =
                    ((UInt64)basic.FileIndexHigh << 32) |
                    (UInt64)basic.FileIndexLow,
                Bytes =
                    ((UInt64)basic.FileSizeHigh << 32) |
                    (UInt64)basic.FileSizeLow,
                Links = basic.NumberOfLinks,
                Attributes = basic.FileAttributes,
                FinalPath = GetHandleFinalPath(handle)
            };
        }

        private static string ValidateLocalNonReparsePath(string value)
        {
            if (String.IsNullOrWhiteSpace(value) || value.IndexOf('\0') >= 0)
                throw new InvalidDataException("Launch path is empty or invalid");
            string fullPath = NormalizeLocalDosPath(
                NormalizeFinalPath(value),
                null,
                "Launch path");
            ValidateExistingLocalNonReparseFile(fullPath, "Launch path");
            return fullPath;
        }

        private static bool IsLowercaseSha256(string value)
        {
            if (String.IsNullOrEmpty(value) || value.Length != 64) return false;
            foreach (char character in value)
            {
                bool digit = character >= '0' && character <= '9';
                bool lowerHex = character >= 'a' && character <= 'f';
                if (!digit && !lowerHex) return false;
            }
            return true;
        }

        private static string HashLaunchPathHandle(IntPtr handle)
        {
            using (SafeFileHandle safeHandle = new SafeFileHandle(handle, false))
            using (FileStream stream = new FileStream(
                safeHandle,
                FileAccess.Read,
                1024 * 1024,
                false))
            using (SHA256 algorithm = SHA256.Create())
            {
                byte[] digest = algorithm.ComputeHash(stream);
                StringBuilder encoded = new StringBuilder(digest.Length * 2);
                foreach (byte value in digest)
                    encoded.Append(value.ToString("x2", CultureInfo.InvariantCulture));
                return encoded.ToString();
            }
        }

        private static byte[] SnapshotLaunchPathHandle(
            IntPtr handle,
            UInt64 expectedBytes)
        {
            if (expectedBytes > Int32.MaxValue)
                throw new InvalidDataException(
                    "Launch path snapshot exceeds the supported memory limit");
            byte[] content = new byte[checked((Int32)expectedBytes)];
            using (SafeFileHandle safeHandle = new SafeFileHandle(handle, false))
            using (FileStream stream = new FileStream(
                safeHandle,
                FileAccess.Read,
                1024 * 1024,
                false))
            {
                stream.Position = 0;
                int offset = 0;
                while (offset < content.Length)
                {
                    int read = stream.Read(
                        content,
                        offset,
                        content.Length - offset);
                    if (read == 0)
                        throw new EndOfStreamException(
                            "Launch path ended while taking its content snapshot");
                    offset += read;
                }
                if (stream.ReadByte() != -1)
                    throw new InvalidDataException(
                        "Launch path grew while taking its content snapshot");
            }
            return content;
        }

        private static string HashBytes(byte[] content)
        {
            using (SHA256 algorithm = SHA256.Create())
            {
                byte[] digest = algorithm.ComputeHash(content);
                StringBuilder encoded = new StringBuilder(digest.Length * 2);
                foreach (byte value in digest)
                    encoded.Append(value.ToString("x2", CultureInfo.InvariantCulture));
                return encoded.ToString();
            }
        }

        private static LaunchPathLock AcquireLaunchPathLock(
            LaunchPathLockSpec spec)
        {
            UInt64 expectedDevice;
            UInt64 expectedFileId;
            if (
                spec == null ||
                (spec.role != "runtime" && spec.role != "entry") ||
                !IsLowercaseSha256(spec.sha256) ||
                !UInt64.TryParse(
                    spec.dev,
                    NumberStyles.None,
                    CultureInfo.InvariantCulture,
                    out expectedDevice) ||
                !UInt64.TryParse(
                    spec.ino,
                    NumberStyles.None,
                    CultureInfo.InvariantCulture,
                    out expectedFileId) ||
                spec.bytes < 0 ||
                (spec.role == "runtime" && spec.bytes > 256L * 1024L * 1024L) ||
                (spec.role == "entry" && spec.bytes > 64L * 1024L * 1024L))
            {
                throw new InvalidDataException(
                    "Launch path lock specification is invalid");
            }
            string expectedPath = ValidateLocalNonReparsePath(spec.path);
            spec.path = expectedPath;

            SECURITY_ATTRIBUTES attributes = new SECURITY_ATTRIBUTES();
            attributes.nLength = checked(
                (UInt32)Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)));
            attributes.bInheritHandle = false;
            IntPtr lockingHandle = IntPtr.Zero;
            IntPtr readHandle = IntPtr.Zero;
            IntPtr eventHandle = IntPtr.Zero;
            IntPtr overlapped = IntPtr.Zero;
            bool oplockPending = false;
            try
            {
                lockingHandle = CreateFile(
                    expectedPath,
                    0,
                    FILE_SHARE_READ,
                    ref attributes,
                    OPEN_EXISTING,
                    FILE_FLAG_OVERLAPPED,
                    IntPtr.Zero);
                if (IsInvalidHandle(lockingHandle))
                    ThrowLastError("CreateFile(launch path locking handle)");

                eventHandle = CreateEvent(IntPtr.Zero, true, false, null);
                if (IsInvalidHandle(eventHandle))
                    ThrowLastError("CreateEvent(launch path oplock)");
                NATIVE_OVERLAPPED nativeOverlapped = new NATIVE_OVERLAPPED();
                nativeOverlapped.EventHandle = eventHandle;
                overlapped = Marshal.AllocHGlobal(
                    Marshal.SizeOf(typeof(NATIVE_OVERLAPPED)));
                Marshal.StructureToPtr(nativeOverlapped, overlapped, false);

                UInt32 returned;
                bool completed = DeviceIoControl(
                    lockingHandle,
                    FSCTL_REQUEST_FILTER_OPLOCK,
                    IntPtr.Zero,
                    0,
                    IntPtr.Zero,
                    0,
                    out returned,
                    overlapped);
                int oplockError = Marshal.GetLastWin32Error();
                if (completed || oplockError != ERROR_IO_PENDING)
                {
                    throw new Win32Exception(
                        oplockError,
                        "FSCTL_REQUEST_FILTER_OPLOCK was not granted");
                }
                oplockPending = true;

                readHandle = CreateFile(
                    expectedPath,
                    GENERIC_READ,
                    FILE_SHARE_READ,
                    ref attributes,
                    OPEN_EXISTING,
                    FILE_ATTRIBUTE_NORMAL,
                    IntPtr.Zero);
                if (IsInvalidHandle(readHandle))
                    ThrowLastError("CreateFile(launch path read handle)");

                LaunchPathFileIdentity lockingIdentity =
                    ReadLaunchPathFileIdentity(lockingHandle);
                LaunchPathFileIdentity before =
                    ReadLaunchPathFileIdentity(readHandle);
                if (
                    !SameLaunchPathFile(lockingIdentity, before) ||
                    !String.Equals(
                        lockingIdentity.FinalPath,
                        expectedPath,
                        StringComparison.OrdinalIgnoreCase) ||
                    !String.Equals(
                        before.FinalPath,
                        expectedPath,
                        StringComparison.OrdinalIgnoreCase))
                {
                    throw new InvalidDataException(
                        "Launch path changed while acquiring its Filter oplock");
                }
                if (before.Bytes != checked((UInt64)spec.bytes))
                    throw new InvalidDataException(
                        "Launch path size does not match its execution contract");
                if (
                    before.NodeDevice != expectedDevice ||
                    before.NodeFileId != expectedFileId)
                {
                    throw new InvalidDataException(
                        "Launch path file ID does not match its execution contract");
                }
                string actualSha256 = HashLaunchPathHandle(readHandle);
                byte[] snapshotContent =
                    spec.role == "entry"
                        ? SnapshotLaunchPathHandle(readHandle, before.Bytes)
                        : null;
                LaunchPathFileIdentity afterLocking =
                    ReadLaunchPathFileIdentity(lockingHandle);
                LaunchPathFileIdentity after =
                    ReadLaunchPathFileIdentity(readHandle);
                if (
                    !SameLaunchPathFile(lockingIdentity, afterLocking) ||
                    !SameLaunchPathFile(before, after) ||
                    !SameLaunchPathFile(afterLocking, after) ||
                    before.Bytes != after.Bytes ||
                    before.NodeDevice != after.NodeDevice ||
                    before.NodeFileId != after.NodeFileId ||
                    before.Links != after.Links ||
                    before.Attributes != after.Attributes ||
                    !String.Equals(
                        after.FinalPath,
                        expectedPath,
                        StringComparison.OrdinalIgnoreCase) ||
                    !String.Equals(
                        actualSha256,
                        spec.sha256,
                        StringComparison.Ordinal) ||
                    (snapshotContent != null &&
                        !String.Equals(
                            HashBytes(snapshotContent),
                            spec.sha256,
                            StringComparison.Ordinal)))
                {
                    throw new InvalidDataException(
                        "Launch path identity or content changed during attestation");
                }
                UInt32 breakState = WaitForSingleObject(eventHandle, 0);
                if (breakState != WAIT_TIMEOUT)
                {
                    if (breakState == UInt32.MaxValue)
                        ThrowLastError("WaitForSingleObject(launch path oplock)");
                    throw new InvalidDataException(
                        "Launch path Filter oplock broke during attestation");
                }
                ValidateLocalNonReparsePath(expectedPath);

                LaunchPathLock result = new LaunchPathLock(
                    spec,
                    lockingHandle,
                    readHandle,
                    eventHandle,
                    overlapped,
                    after,
                    snapshotContent);
                lockingHandle = IntPtr.Zero;
                readHandle = IntPtr.Zero;
                eventHandle = IntPtr.Zero;
                overlapped = IntPtr.Zero;
                oplockPending = false;
                return result;
            }
            finally
            {
                ReleaseLaunchPathLockHandles(
                    ref readHandle,
                    ref lockingHandle,
                    ref eventHandle,
                    ref overlapped,
                    oplockPending);
            }
        }

        private static List<LaunchPathLock> AcquireLaunchPathLocks(
            LaunchPathLockSpec[] specs,
            string application,
            string[] arguments)
        {
            List<LaunchPathLock> locks = new List<LaunchPathLock>();
            if (specs == null) return locks;
            try
            {
                if (specs.Length != 2)
                    throw new InvalidDataException(
                        "Plugin Node launch requires runtime and entry path locks");
                LaunchPathLockSpec runtimeSpec = null;
                LaunchPathLockSpec entrySpec = null;
                foreach (LaunchPathLockSpec spec in specs)
                {
                    if (spec != null && spec.role == "runtime" && runtimeSpec == null)
                        runtimeSpec = spec;
                    else if (spec != null && spec.role == "entry" && entrySpec == null)
                        entrySpec = spec;
                    else
                        throw new InvalidDataException(
                            "Launch path lock roles must be unique");
                }
                if (
                    runtimeSpec == null ||
                    entrySpec == null ||
                    !String.Equals(
                        NormalizeFinalPath(application),
                        NormalizeFinalPath(runtimeSpec.path),
                        StringComparison.OrdinalIgnoreCase) ||
                    arguments == null ||
                    arguments.Length == 0 ||
                    !String.Equals(
                        NormalizeFinalPath(arguments[0]),
                        NormalizeFinalPath(entrySpec.path),
                        StringComparison.OrdinalIgnoreCase))
                {
                    throw new InvalidDataException(
                        "Launch command does not match its path lock contract");
                }

                LaunchPathLock runtimeLock = AcquireLaunchPathLock(runtimeSpec);
                locks.Add(runtimeLock);
                LaunchPathLock entryLock = AcquireLaunchPathLock(entrySpec);
                locks.Add(entryLock);
                if (SameLaunchPathFile(runtimeLock.Identity, entryLock.Identity))
                    throw new InvalidDataException(
                        "Runtime and entry path locks unexpectedly name one file");
                return locks;
            }
            catch
            {
                foreach (LaunchPathLock launchLock in locks)
                    launchLock.Dispose();
                throw;
            }
        }

        private static void AssertLaunchPathLocksIntact(
            List<LaunchPathLock> locks)
        {
            foreach (LaunchPathLock launchLock in locks)
            {
                UInt32 state = WaitForSingleObject(launchLock.BreakEvent, 0);
                if (state == WAIT_TIMEOUT) continue;
                if (state == UInt32.MaxValue)
                    ThrowLastError("WaitForSingleObject(launch path lock)");
                throw new InvalidDataException(
                    "Launch path Filter oplock broke before target resume (" +
                    launchLock.Role +
                    ")");
            }
        }

        private static void ReattestLaunchPaths(
            List<LaunchPathLock> locks)
        {
            AssertLaunchPathLocksIntact(locks);
            SECURITY_ATTRIBUTES attributes = new SECURITY_ATTRIBUTES();
            attributes.nLength = checked(
                (UInt32)Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)));
            attributes.bInheritHandle = false;
            foreach (LaunchPathLock launchLock in locks)
            {
                IntPtr pathHandle = CreateFile(
                    launchLock.ExpectedPath,
                    0,
                    FILE_SHARE_READ,
                    ref attributes,
                    OPEN_EXISTING,
                    FILE_ATTRIBUTE_NORMAL,
                    IntPtr.Zero);
                if (IsInvalidHandle(pathHandle))
                    ThrowLastError("CreateFile(launch path reattestation)");
                try
                {
                    LaunchPathFileIdentity current =
                        ReadLaunchPathFileIdentity(pathHandle);
                    if (
                        !SameLaunchPathFile(launchLock.Identity, current) ||
                        !String.Equals(
                            current.FinalPath,
                            launchLock.ExpectedPath,
                            StringComparison.OrdinalIgnoreCase))
                    {
                        throw new InvalidDataException(
                            "Launch path identity changed before target resume (" +
                            launchLock.Role +
                            ")");
                    }
                }
                finally
                {
                    CloseHandle(pathHandle);
                }
            }
            AssertLaunchPathLocksIntact(locks);
        }

        private static void ReleaseLaunchPathLocks(
            List<LaunchPathLock> locks)
        {
            foreach (LaunchPathLock launchLock in locks)
                launchLock.Dispose();
            locks.Clear();
        }

        private static byte[] TakeEntrySnapshot(
            List<LaunchPathLock> locks)
        {
            byte[] snapshot = null;
            for (int index = locks.Count - 1; index >= 0; index--)
            {
                LaunchPathLock launchLock = locks[index];
                if (launchLock.Role != "entry") continue;
                if (snapshot != null || launchLock.SnapshotContent == null)
                    throw new InvalidDataException(
                        "Plugin Node launch has an invalid entry snapshot");
                snapshot = launchLock.SnapshotContent;
                // Once copied into helper-owned memory, the Plugin Node entry
                // no longer needs a pathname or open file handle. Release its
                // stream guard before CreateProcess; the target receives only
                // the verified bytes through the private inherited pipe.
                launchLock.Dispose();
                locks.RemoveAt(index);
            }
            if (locks.Count > 0 && snapshot == null)
                throw new InvalidDataException(
                    "Plugin Node launch has no verified entry snapshot");
            return snapshot;
        }

        private static void AwaitSnapshotTestGate(
            byte[] entrySnapshot,
            LaunchPathLockSpec[] launchPathLockSpecs,
            string gateToken,
            string releasePath)
        {
            bool hasGateToken = !String.IsNullOrWhiteSpace(gateToken);
            bool hasReleasePath = !String.IsNullOrWhiteSpace(releasePath);
            if (!hasGateToken && !hasReleasePath) return;
            if (
                !hasGateToken ||
                !hasReleasePath ||
                entrySnapshot == null ||
                launchPathLockSpecs == null ||
                !IsLowercaseSha256(gateToken))
            {
                throw new InvalidDataException(
                    "Entry snapshot test gate is incomplete");
            }

            string release = Path.GetFullPath(releasePath);
            if (
                !Path.IsPathRooted(release) ||
                File.Exists(release))
            {
                throw new InvalidDataException(
                    "Entry snapshot test gate paths are invalid");
            }

            Console.Out.WriteLine(
                new JavaScriptSerializer().Serialize(
                    new
                    {
                        eventName = "SNAPSHOT_CAPTURED",
                        token = gateToken
                    }));
            Console.Out.Flush();

            DateTime deadline = DateTime.UtcNow.AddSeconds(30);
            while (!File.Exists(release))
            {
                if (DateTime.UtcNow >= deadline)
                    throw new TimeoutException(
                        "Timed out waiting for the entry snapshot test gate");
                Thread.Sleep(10);
            }
        }

        private static string[] BuildSnapshotNodeArguments(
            string[] arguments,
            int snapshotFd,
            byte[] snapshot)
        {
            if (arguments == null || arguments.Length == 0)
                throw new InvalidDataException(
                    "Plugin Node entry snapshot has no original entry path");
            string expectedSha256 = HashBytes(snapshot);
            string bootstrap = String.Format(
                CultureInfo.InvariantCulture,
                "const fs=require('node:fs'),crypto=require('node:crypto')," +
                "Module=require('node:module')," +
                "path=require('node:path');" +
                "const filename=process.argv[1];let source;" +
                "try{{source=fs.readFileSync({0});}}" +
                "finally{{fs.closeSync({0});}}" +
                "if(source.length!=={1}||" +
                "crypto.createHash('sha256').update(source).digest('hex')!==" +
                "'{2}')throw new Error('entry snapshot pipe integrity failed');" +
                "const main=new Module(filename,null);main.id='.';" +
                "main.filename=filename;" +
                "main.paths=Module._nodeModulePaths(path.dirname(filename));" +
                "process.mainModule=main;process.execArgv.length=0;" +
                "delete process._eval;" +
                "Module._cache[filename]=main;" +
                "try{{main._compile(source.toString('utf8'),filename);" +
                "main.loaded=true;}}" +
                "catch(error){{delete Module._cache[filename];throw error;}}",
                snapshotFd,
                snapshot.Length,
                expectedSha256);
            string[] snapshotArguments = new string[arguments.Length + 3];
            snapshotArguments[0] = "--eval";
            snapshotArguments[1] = bootstrap;
            snapshotArguments[2] = "--";
            Array.Copy(
                arguments,
                0,
                snapshotArguments,
                3,
                arguments.Length);
            return snapshotArguments;
        }

        private static void CreateEntrySnapshotPipe(
            int nodeIpcFd,
            out int snapshotFd,
            out IntPtr snapshotReadHandle,
            out IntPtr snapshotWriteHandle)
        {
            snapshotFd = 4;
            if (nodeIpcFd == snapshotFd)
                throw new InvalidDataException(
                    "Node IPC descriptor conflicts with the entry snapshot pipe");
            SECURITY_ATTRIBUTES attributes = new SECURITY_ATTRIBUTES();
            attributes.nLength = checked(
                (UInt32)Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)));
            attributes.bInheritHandle = true;
            if (!CreatePipe(
                out snapshotReadHandle,
                out snapshotWriteHandle,
                ref attributes,
                64 * 1024))
            {
                ThrowLastError("CreatePipe(entry snapshot)");
            }
            if (!SetHandleInformation(
                snapshotWriteHandle,
                HANDLE_FLAG_INHERIT,
                0))
            {
                CloseHandle(snapshotReadHandle);
                snapshotReadHandle = IntPtr.Zero;
                CloseHandle(snapshotWriteHandle);
                snapshotWriteHandle = IntPtr.Zero;
                ThrowLastError("SetHandleInformation(entry snapshot writer)");
            }
        }

        private static void WriteEntrySnapshot(
            IntPtr snapshotWriteHandle,
            byte[] snapshot)
        {
            using (SafeFileHandle safeHandle =
                new SafeFileHandle(snapshotWriteHandle, false))
            using (FileStream stream = new FileStream(
                safeHandle,
                FileAccess.Write,
                64 * 1024,
                false))
            {
                stream.Write(snapshot, 0, snapshot.Length);
                stream.Flush();
            }
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
            int entrySnapshotFd,
            IntPtr entrySnapshotHandle,
            IntPtr standardInput,
            IntPtr standardOutput,
            IntPtr standardError,
            out UInt16 descriptorBytes)
        {
            descriptorBytes = 0;
            // stdin/stdout/stderr are transferred by STARTUPINFO. Higher CRT
            // descriptors carry the optional Node IPC channel and the verified
            // Plugin Node entry snapshot pipe.
            if (nodeIpcFd < 0 && entrySnapshotFd < 0) return IntPtr.Zero;
            if (nodeIpcFd > 255 || entrySnapshotFd > 255)
                throw new InvalidDataException(
                    "Node descriptor is outside the CRT table range");

            int descriptorCount = Math.Max(
                3,
                Math.Max(nodeIpcFd, entrySnapshotFd) + 1);
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
                    else if (fd == entrySnapshotFd)
                        handle = entrySnapshotHandle;
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
                        if (fd == nodeIpcFd || fd == entrySnapshotFd)
                            throw new InvalidDataException(
                                "Node descriptor has no inherited OS handle");
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
            IntPtr entrySnapshotHandle,
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
            if (!IsInvalidHandle(entrySnapshotHandle) &&
                !handles.Contains(entrySnapshotHandle))
            {
                handles.Add(entrySnapshotHandle);
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

        public static int RunNodeSnapshotProbe(
            string application,
            string appContainerProfileName,
            string expectedAppContainerSid)
        {
            string probeDirectory = Path.Combine(
                Path.GetTempPath(),
                "chainless-node-entry-snapshot-probe-" +
                    Guid.NewGuid().ToString("N"));
            string probeEntry = Path.Combine(probeDirectory, "entry.cjs");
            if (Directory.Exists(probeDirectory) || File.Exists(probeEntry))
                throw new IOException(
                    "Node entry snapshot probe path unexpectedly exists");
            byte[] probeSource = Encoding.UTF8.GetBytes(
                "if(require.main!==module||process.mainModule!==module||" +
                "process.execArgv.length!==0||" +
                "Object.prototype.hasOwnProperty.call(process,'_eval')||" +
                "__filename!==process.argv[1])" +
                "throw new Error('entry snapshot transport probe failed');" +
                "process.exitCode=73;");
            int probeExitCode = Run(
                application,
                new[] { probeEntry },
                0,
                256L * 1024L * 1024L,
                1,
                -1,
                false,
                true,
                Environment.SystemDirectory,
                CaptureCurrentEnvironment(),
                null,
                appContainerProfileName,
                expectedAppContainerSid,
                null,
                probeSource,
                null,
                null);
            if (probeExitCode != 73)
                throw new InvalidDataException(
                    "Node entry snapshot probe did not execute its verified source");
            return 0;
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
            string workingDirectory,
            Dictionary<string, string> targetEnvironment,
            string identityPath,
            string appContainerProfileName,
            string expectedAppContainerSid,
            LaunchPathLockSpec[] launchPathLockSpecs,
            byte[] entrySnapshotOverride,
            string snapshotTestGateToken,
            string snapshotTestGateReleasePath)
        {
            targetEnvironment =
                targetEnvironment ?? CaptureCurrentEnvironment();
            workingDirectory = NormalizeLocalDosPath(
                String.IsNullOrWhiteSpace(workingDirectory)
                    ? Environment.SystemDirectory
                    : workingDirectory,
                null,
                "Target working directory");
            FileAttributes workingDirectoryAttributes =
                ValidateExistingLocalNonReparsePath(
                    workingDirectory,
                    "Target working directory");
            if (
                (workingDirectoryAttributes & FileAttributes.Directory) == 0)
            {
                throw new DirectoryNotFoundException(
                    "Target working directory was not found: " +
                    workingDirectory);
            }
            application = ResolveApplication(
                application,
                workingDirectory,
                targetEnvironment);
            string extension = Path.GetExtension(application);
            if (extension.Equals(".cmd", StringComparison.OrdinalIgnoreCase) ||
                extension.Equals(".bat", StringComparison.OrdinalIgnoreCase))
            {
                string commandText = BuildCommandLine(application, arguments);
                application = ResolveApplication(
                    GetEnvironmentValue(
                        targetEnvironment,
                        "ComSpec",
                        Path.Combine(
                            Environment.SystemDirectory,
                            "cmd.exe")),
                    workingDirectory,
                    targetEnvironment);
                arguments = new[] { "/d", "/s", "/c", commandText };
            }

            IntPtr sourceToken = IntPtr.Zero;
            IntPtr restrictedToken = IntPtr.Zero;
            IntPtr appContainerSid = IntPtr.Zero;
            IntPtr job = IntPtr.Zero;
            IntPtr limitBuffer = IntPtr.Zero;
            IntPtr descriptorBuffer = IntPtr.Zero;
            IntPtr inheritedHandleBuffer = IntPtr.Zero;
            IntPtr environmentBuffer = IntPtr.Zero;
            IntPtr attributeList = IntPtr.Zero;
            IntPtr securityCapabilitiesBuffer = IntPtr.Zero;
            IntPtr entrySnapshotReadHandle = IntPtr.Zero;
            IntPtr entrySnapshotWriteHandle = IntPtr.Zero;
            int entrySnapshotFd = -1;
            byte[] entrySnapshot = null;
            List<IntPtr> ownedStandardHandles = new List<IntPtr>();
            List<LaunchPathLock> launchPathLocks = new List<LaunchPathLock>();
            PROCESS_INFORMATION processInfo = new PROCESS_INFORMATION();
            bool useAppContainer =
                !String.IsNullOrWhiteSpace(appContainerProfileName);
            string attestedAppContainerSid = null;
            bool targetExited = false;
            int targetExitCode = 125;
            Exception launchError = null;

            try
            {
                launchPathLocks = AcquireLaunchPathLocks(
                    launchPathLockSpecs,
                    application,
                    arguments);
                entrySnapshot = TakeEntrySnapshot(launchPathLocks);
                if (entrySnapshotOverride != null)
                {
                    if (entrySnapshot != null || launchPathLocks.Count != 0)
                        throw new InvalidDataException(
                            "Entry snapshot probe cannot use launch path locks");
                    entrySnapshot = entrySnapshotOverride;
                }
                AwaitSnapshotTestGate(
                    entrySnapshot,
                    launchPathLockSpecs,
                    snapshotTestGateToken,
                    snapshotTestGateReleasePath);
                if (entrySnapshot != null)
                {
                    RemoveEnvironmentValue(
                        targetEnvironment,
                        "NODE_OPTIONS");
                    RemoveEnvironmentValue(
                        targetEnvironment,
                        "NODE_CHANNEL_FD");
                    RemoveEnvironmentValue(
                        targetEnvironment,
                        "OPENSSL_CONF");
                    RemoveEnvironmentValue(
                        targetEnvironment,
                        "OPENSSL_CONF_INCLUDE");
                    RemoveEnvironmentValue(
                        targetEnvironment,
                        "OPENSSL_ENGINES");
                    RemoveEnvironmentValue(
                        targetEnvironment,
                        "OPENSSL_MODULES");
                    AssertSnapshotRuntimeBitness(application);
                    CreateEntrySnapshotPipe(
                        nodeIpcFd,
                        out entrySnapshotFd,
                        out entrySnapshotReadHandle,
                        out entrySnapshotWriteHandle);
                    arguments = BuildSnapshotNodeArguments(
                        arguments,
                        entrySnapshotFd,
                        entrySnapshot);
                }
                environmentBuffer = BuildEnvironmentBlock(targetEnvironment);
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
                    entrySnapshotFd,
                    entrySnapshotReadHandle,
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
                    entrySnapshotReadHandle,
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
                AssertLaunchPathLocksIntact(launchPathLocks);
                bool processCreated = CreateProcessAsUser(
                    restrictedToken,
                    application,
                    commandLine,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    true,
                    creationFlags,
                    environmentBuffer,
                    workingDirectory,
                    ref startup,
                    out processInfo);
                if (!processCreated)
                {
                    ThrowLastError(
                        useAppContainer
                            ? "CreateProcessAsUser(AppContainer)"
                            : "CreateProcessAsUser");
                }
                AssertLaunchPathLocksIntact(launchPathLocks);

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
                AssertLaunchPathLocksIntact(launchPathLocks);

                if (!IsInvalidHandle(entrySnapshotReadHandle))
                {
                    CloseHandle(entrySnapshotReadHandle);
                    entrySnapshotReadHandle = IntPtr.Zero;
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
                ReattestLaunchPaths(launchPathLocks);
                // The suspended process has already created its image section.
                // Release all remaining runtime stream guards before resume so
                // target code can never deadlock waiting for a break owned by
                // the helper. This is not a pathname-atomic runtime launch.
                ReleaseLaunchPathLocks(launchPathLocks);
                if (ResumeThread(processInfo.hThread) == UInt32.MaxValue)
                {
                    TerminateProcess(processInfo.hProcess, 125);
                    ThrowLastError("ResumeThread");
                }
                if (entrySnapshot != null)
                {
                    try
                    {
                        WriteEntrySnapshot(
                            entrySnapshotWriteHandle,
                            entrySnapshot);
                    }
                    finally
                    {
                        if (!IsInvalidHandle(entrySnapshotWriteHandle))
                        {
                            CloseHandle(entrySnapshotWriteHandle);
                            entrySnapshotWriteHandle = IntPtr.Zero;
                        }
                    }
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

                UInt32 targetWait = WaitForSingleObject(
                    processInfo.hProcess,
                    INFINITE);
                if (targetWait != WAIT_OBJECT_0)
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
                if (!IsInvalidHandle(entrySnapshotReadHandle))
                    CloseHandle(entrySnapshotReadHandle);
                if (!IsInvalidHandle(entrySnapshotWriteHandle))
                    CloseHandle(entrySnapshotWriteHandle);
                foreach (LaunchPathLock launchPathLock in launchPathLocks)
                    launchPathLock.Dispose();
                launchPathLocks.Clear();
                if (attributeList != IntPtr.Zero)
                {
                    DeleteProcThreadAttributeList(attributeList);
                    Marshal.FreeHGlobal(attributeList);
                }
                if (securityCapabilitiesBuffer != IntPtr.Zero)
                    Marshal.FreeHGlobal(securityCapabilitiesBuffer);
                if (inheritedHandleBuffer != IntPtr.Zero)
                    Marshal.FreeHGlobal(inheritedHandleBuffer);
                if (environmentBuffer != IntPtr.Zero)
                    Marshal.FreeHGlobal(environmentBuffer);
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
            public string workingDirectory { get; set; }
            public Dictionary<string, string> environment { get; set; }
            public string identityPath { get; set; }
            public string appContainerProfileName { get; set; }
            public string appContainerSid { get; set; }
            public Native.LaunchPathLockSpec[] launchPathLocks { get; set; }
            public string snapshotTestGateToken { get; set; }
            public string snapshotTestGateReleasePath { get; set; }
        }

        public static int Main(string[] args)
        {
            LaunchSpec spec = null;
            try
            {
                if (
                    args != null &&
                    args.Length == 1 &&
                    String.Equals(
                        args[0],
                        "--probe-helper",
                        StringComparison.Ordinal))
                {
                    Console.Out.Write(
                        new JavaScriptSerializer().Serialize(
                            new
                            {
                                ready = true,
                                hostRuntime = "powershell-byte-assembly-v1",
                                sourceSha256 = Native.SourceSha256
                            }));
                    return 0;
                }

                if (
                    args != null &&
                    args.Length == 2 &&
                    String.Equals(
                        args[0],
                        "--probe-node-snapshot",
                        StringComparison.Ordinal))
                {
                    int probeExitCode = Native.RunNodeSnapshotProbe(
                        args[1],
                        null,
                        null);
                    if (probeExitCode != 0)
                        throw new InvalidDataException(
                            "Node entry snapshot probe returned a non-zero exit code");
                    Console.Out.Write(
                        new JavaScriptSerializer().Serialize(
                            new
                            {
                                ready = true,
                                targetRuntime = "node",
                                contentSnapshot = true
                            }));
                    return 0;
                }

                if (
                    args != null &&
                    (args.Length == 2 || args.Length == 3) &&
                    String.Equals(
                        args[0],
                        "--prepare-appcontainer",
                        StringComparison.Ordinal))
                {
                    string profileName = args[1];
                    string nodeRuntime =
                        args.Length == 3 ? args[2] : null;
                    string probeSid = null;
                    string preparedSid = null;
                    bool leavePreparedProfile = false;
                    try
                    {
                        probeSid = Native.PrepareAppContainerProfile(
                            profileName);
                        preparedSid = probeSid;
                        int probeExitCode =
                            String.IsNullOrWhiteSpace(nodeRuntime)
                                ? Native.Run(
                                    Path.Combine(
                                        Environment.SystemDirectory,
                                        "cmd.exe"),
                                    new[] { "/d", "/s", "/c", "exit 0" },
                                    0,
                                    0,
                                    1,
                                    -1,
                                    false,
                                    true,
                                    Environment.SystemDirectory,
                                    null,
                                    null,
                                    profileName,
                                    probeSid,
                                    null,
                                    null,
                                    null,
                                    null)
                                : Native.RunNodeSnapshotProbe(
                                    nodeRuntime,
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
                                    restrictedTokenAttested = true,
                                    probeRuntime =
                                        String.IsNullOrWhiteSpace(nodeRuntime)
                                            ? "cmd"
                                            : "node",
                                    targetRuntime =
                                        String.IsNullOrWhiteSpace(nodeRuntime)
                                            ? "cmd"
                                            : "node"
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
                    spec.workingDirectory,
                    spec.environment,
                    spec.identityPath,
                    spec.appContainerProfileName,
                    spec.appContainerSid,
                    spec.launchPathLocks,
                    null,
                    spec.snapshotTestGateToken,
                    spec.snapshotTestGateReleasePath);
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
