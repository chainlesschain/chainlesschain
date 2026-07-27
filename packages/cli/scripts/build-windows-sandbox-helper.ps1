[CmdletBinding()]
param(
    [switch] $Check
)

$ErrorActionPreference = "Stop"

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$cliRoot = Split-Path -Parent $scriptDirectory
$brokerDirectory = Join-Path $cliRoot "src\lib\process-execution-broker"
$sourcePath = Join-Path $brokerDirectory "windows-sandbox.cs"
$libraryPath = Join-Path $brokerDirectory "windows-sandbox-helper.dll"
$executablePath = Join-Path $brokerDirectory "windows-sandbox-helper.exe"
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

function Assert-SourceContract {
    param(
        [string] $Path,
        [string] $ExpectedDigest
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Windows sandbox helper is missing: $Path"
    }
    $embeddedDigest = Get-EmbeddedSourceDigest -Path $Path
    if (-not [string]::Equals(
        $embeddedDigest,
        $ExpectedDigest,
        [System.StringComparison]::Ordinal
    )) {
        throw (
            "Windows sandbox helper is stale: embedded source digest " +
            "$embeddedDigest, expected $ExpectedDigest ($Path)"
        )
    }
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
    Assert-SourceContract -Path $libraryPath -ExpectedDigest $sourceDigest
    Assert-SourceContract -Path $executablePath -ExpectedDigest $sourceDigest
    Write-Output "Windows sandbox helper source digest verified: $sourceDigest"
    return
}

$compiledSource = $sourceText.Replace($sourcePlaceholder, $sourceDigest)
$buildDirectory = Join-Path (
    [System.IO.Path]::GetTempPath()
) ("chainless-windows-sandbox-build-" + [Guid]::NewGuid().ToString("N"))
$compiledSourcePath = Join-Path $buildDirectory "windows-sandbox.compiled.cs"
$temporaryLibrary = Join-Path $buildDirectory "windows-sandbox-helper.dll"
$temporaryExecutable = Join-Path $buildDirectory "windows-sandbox-helper.exe"
$frameworkDirectory = [System.Runtime.InteropServices.RuntimeEnvironment]::
    GetRuntimeDirectory()
$compiler = Join-Path $frameworkDirectory "csc.exe"
[System.IO.Directory]::CreateDirectory($buildDirectory) | Out-Null

try {
    if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) {
        throw "C# compiler is unavailable: $compiler"
    }
    [System.IO.File]::WriteAllText(
        $compiledSourcePath,
        $compiledSource,
        (New-Object System.Text.UTF8Encoding($false))
    )

    & $compiler `
        /nologo `
        /target:library `
        /optimize+ `
        /reference:System.Runtime.Serialization.dll `
        /out:$temporaryLibrary `
        $compiledSourcePath
    if ($LASTEXITCODE -ne 0) {
        throw "Windows sandbox helper library compilation failed"
    }

    & $compiler `
        /nologo `
        /target:exe `
        /optimize+ `
        /reference:System.Runtime.Serialization.dll `
        /out:$temporaryExecutable `
        $compiledSourcePath
    if ($LASTEXITCODE -ne 0) {
        throw "Windows sandbox helper executable compilation failed"
    }

    Assert-SourceContract `
        -Path $temporaryLibrary `
        -ExpectedDigest $sourceDigest
    Assert-SourceContract `
        -Path $temporaryExecutable `
        -ExpectedDigest $sourceDigest

    Move-Item `
        -LiteralPath $temporaryLibrary `
        -Destination $libraryPath `
        -Force
    Move-Item `
        -LiteralPath $temporaryExecutable `
        -Destination $executablePath `
        -Force
}
finally {
    if (Test-Path -LiteralPath $buildDirectory -PathType Container) {
        Remove-Item -LiteralPath $buildDirectory -Recurse -Force
    }
}

Write-Output "Built Windows sandbox helper library: $libraryPath"
Write-Output "Built Windows sandbox helper executable: $executablePath"
Write-Output "Embedded source digest: $sourceDigest"
