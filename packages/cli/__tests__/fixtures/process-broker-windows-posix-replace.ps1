[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$SourcePath,

  [Parameter(Mandatory = $true)]
  [string]$DestinationPath
)

$ErrorActionPreference = "Stop"

$sourceFullPath = [System.IO.Path]::GetFullPath($SourcePath)
$destinationFullPath = [System.IO.Path]::GetFullPath($DestinationPath)

if (-not [System.IO.File]::Exists($sourceFullPath)) {
  throw "Replacement source does not exist: $sourceFullPath"
}
if (-not [System.IO.File]::Exists($destinationFullPath)) {
  throw "Replacement destination does not exist: $destinationFullPath"
}

$nativeSource = @'
using System;
using System.ComponentModel;
using System.IO;
using Microsoft.Win32.SafeHandles;
using System.Runtime.InteropServices;
using System.Text;

namespace ChainlessChain.WindowsSandboxLive
{
    public static class PosixReplace
    {
        private const UInt32 DELETE = 0x00010000;
        private const UInt32 FILE_SHARE_READ = 0x00000001;
        private const UInt32 FILE_SHARE_WRITE = 0x00000002;
        private const UInt32 FILE_SHARE_DELETE = 0x00000004;
        private const UInt32 OPEN_EXISTING = 3;
        private const UInt32 FILE_ATTRIBUTE_NORMAL = 0x00000080;
        private const UInt32 FILE_RENAME_FLAG_REPLACE_IF_EXISTS = 0x00000001;
        private const UInt32 FILE_RENAME_FLAG_POSIX_SEMANTICS = 0x00000002;
        private const Int32 FileRenameInfoEx = 22;

        [DllImport(
            "kernel32.dll",
            CharSet = CharSet.Unicode,
            SetLastError = true)]
        private static extern SafeFileHandle CreateFileW(
            string fileName,
            UInt32 desiredAccess,
            UInt32 shareMode,
            IntPtr securityAttributes,
            UInt32 creationDisposition,
            UInt32 flagsAndAttributes,
            IntPtr templateFile);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetFileInformationByHandle(
            SafeFileHandle file,
            Int32 fileInformationClass,
            IntPtr fileInformation,
            UInt32 bufferSize);

        public static void Replace(string sourcePath, string destinationPath)
        {
            string source = Path.GetFullPath(sourcePath);
            string destination = Path.GetFullPath(destinationPath);
            byte[] destinationBytes = Encoding.Unicode.GetBytes(destination);
            int rootDirectoryOffset = IntPtr.Size == 8 ? 8 : 4;
            int fileNameLengthOffset = checked(rootDirectoryOffset + IntPtr.Size);
            int fileNameOffset = checked(fileNameLengthOffset + sizeof(UInt32));
            int structureSize = IntPtr.Size == 8 ? 24 : 16;
            int bufferSize = checked(structureSize + destinationBytes.Length);
            IntPtr buffer = Marshal.AllocHGlobal(bufferSize);
            try
            {
                for (int offset = 0; offset < bufferSize; offset++)
                    Marshal.WriteByte(buffer, offset, 0);
                Marshal.WriteInt32(
                    buffer,
                    0,
                    unchecked((Int32)(
                        FILE_RENAME_FLAG_REPLACE_IF_EXISTS |
                        FILE_RENAME_FLAG_POSIX_SEMANTICS)));
                Marshal.WriteIntPtr(buffer, rootDirectoryOffset, IntPtr.Zero);
                Marshal.WriteInt32(
                    buffer,
                    fileNameLengthOffset,
                    destinationBytes.Length);
                Marshal.Copy(
                    destinationBytes,
                    0,
                    IntPtr.Add(buffer, fileNameOffset),
                    destinationBytes.Length);

                using (SafeFileHandle sourceHandle = CreateFileW(
                    source,
                    DELETE,
                    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                    IntPtr.Zero,
                    OPEN_EXISTING,
                    FILE_ATTRIBUTE_NORMAL,
                    IntPtr.Zero))
                {
                    if (sourceHandle.IsInvalid)
                        throw new Win32Exception(
                            Marshal.GetLastWin32Error(),
                            "CreateFileW(replacement source)");

                    Console.Out.WriteLine(
                        "{\"state\":\"ATTEMPTING\",\"api\":\"SetFileInformationByHandle\",\"class\":\"FileRenameInfoEx\",\"flags\":[\"REPLACE_IF_EXISTS\",\"POSIX_SEMANTICS\"]}");
                    Console.Out.Flush();

                    if (!SetFileInformationByHandle(
                        sourceHandle,
                        FileRenameInfoEx,
                        buffer,
                        checked((UInt32)bufferSize)))
                    {
                        throw new Win32Exception(
                            Marshal.GetLastWin32Error(),
                            "SetFileInformationByHandle(FileRenameInfoEx)");
                    }
                }
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }
    }
}
'@

Add-Type -TypeDefinition $nativeSource -Language CSharp
[ChainlessChain.WindowsSandboxLive.PosixReplace]::Replace(
  $sourceFullPath,
  $destinationFullPath
)
[Console]::Out.WriteLine(
  '{"state":"REPLACED","api":"SetFileInformationByHandle","class":"FileRenameInfoEx"}'
)
[Console]::Out.Flush()
