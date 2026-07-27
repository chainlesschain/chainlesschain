[CmdletBinding()]
param(
    [switch] $Check
)

$ErrorActionPreference = "Stop"

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$cliRoot = Split-Path -Parent $scriptDirectory
$brokerDirectory = Join-Path $cliRoot "src\lib\process-execution-broker"
$sourcePath = Join-Path $brokerDirectory "windows-sandbox.cs"
$assemblyPath = Join-Path $brokerDirectory "windows-sandbox-helper.dll"
$sourcePlaceholder = "__CHAINLESS_WINDOWS_SANDBOX_SOURCE_SHA256__"

function Get-Sha256Hex {
    param([byte[]] $Bytes)

    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try {
        return -join (
            $algorithm.ComputeHash($Bytes) |
                ForEach-Object { $_.ToString("x2") }
        )
    }
    finally {
        $algorithm.Dispose()
    }
}

function Get-EmbeddedSourceDigest {
    param([string] $Path)

    $assemblyBytes = [System.IO.File]::ReadAllBytes($Path)
    $assembly = [System.Reflection.Assembly]::Load($assemblyBytes)
    $nativeType = $assembly.GetType(
        "ChainlessChain.WindowsSandbox.Native",
        $true
    )
    $digestField = $nativeType.GetField(
        "SourceSha256",
        [System.Reflection.BindingFlags]"Public,Static"
    )
    if ($null -eq $digestField -or -not $digestField.IsLiteral) {
        throw "Windows sandbox helper omits its source digest contract"
    }
    return [string] $digestField.GetRawConstantValue()
}

$sourceBytes = [System.IO.File]::ReadAllBytes($sourcePath)
$strictUtf8 = New-Object System.Text.UTF8Encoding($false, $true)
$sourceText = $strictUtf8.GetString($sourceBytes)
$firstPlaceholder = $sourceText.IndexOf(
    $sourcePlaceholder,
    [System.StringComparison]::Ordinal
)
$lastPlaceholder = $sourceText.LastIndexOf(
    $sourcePlaceholder,
    [System.StringComparison]::Ordinal
)
if ($firstPlaceholder -lt 0 -or $firstPlaceholder -ne $lastPlaceholder) {
    throw "Windows sandbox source must contain exactly one digest placeholder"
}
$sourceDigest = Get-Sha256Hex -Bytes $sourceBytes

if ($Check) {
    if (-not (Test-Path -LiteralPath $assemblyPath -PathType Leaf)) {
        throw "Windows sandbox helper assembly is missing: $assemblyPath"
    }
    $embeddedDigest = Get-EmbeddedSourceDigest -Path $assemblyPath
    if (-not [string]::Equals(
        $embeddedDigest,
        $sourceDigest,
        [System.StringComparison]::Ordinal
    )) {
        throw (
            "Windows sandbox helper is stale: embedded source digest " +
            "$embeddedDigest, expected $sourceDigest"
        )
    }
    Write-Output "Windows sandbox helper source digest verified: $sourceDigest"
    return
}

$compiledSource = $sourceText.Replace($sourcePlaceholder, $sourceDigest)
$buildDirectory = Join-Path $brokerDirectory (
    ".windows-sandbox-build-" + [Guid]::NewGuid().ToString("N")
)
$temporaryAssembly = Join-Path $buildDirectory "windows-sandbox-helper.dll"
[System.IO.Directory]::CreateDirectory($buildDirectory) | Out-Null

try {
    Add-Type `
        -TypeDefinition $compiledSource `
        -ReferencedAssemblies "System.Web.Extensions" `
        -OutputAssembly $temporaryAssembly `
        -OutputType Library

    $embeddedDigest = Get-EmbeddedSourceDigest -Path $temporaryAssembly
    if (-not [string]::Equals(
        $embeddedDigest,
        $sourceDigest,
        [System.StringComparison]::Ordinal
    )) {
        throw "Compiled Windows sandbox helper has an invalid source digest"
    }
    Move-Item `
        -LiteralPath $temporaryAssembly `
        -Destination $assemblyPath `
        -Force
}
finally {
    if (Test-Path -LiteralPath $temporaryAssembly) {
        Remove-Item -LiteralPath $temporaryAssembly -Force
    }
    if (Test-Path -LiteralPath $buildDirectory -PathType Container) {
        Remove-Item -LiteralPath $buildDirectory -Force
    }
}

Write-Output "Built Windows sandbox helper: $assemblyPath"
Write-Output "Embedded source digest: $sourceDigest"
