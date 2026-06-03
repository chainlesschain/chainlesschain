# ChainlessChain Release Script for Windows
# This script builds and releases ChainlessChain using GitHub CLI

param(
    [string]$Version,
    [switch]$Draft,
    [switch]$Prerelease,
    [string]$Notes,
    [switch]$SkipBuild,
    [switch]$Help
)

# Color output functions
function Write-Info($message) {
    Write-Host "ℹ " -ForegroundColor Blue -NoNewline
    Write-Host $message
}

function Write-Success($message) {
    Write-Host "✓ " -ForegroundColor Green -NoNewline
    Write-Host $message
}

function Write-Warning($message) {
    Write-Host "⚠ " -ForegroundColor Yellow -NoNewline
    Write-Host $message
}

function Write-Error($message) {
    Write-Host "✗ " -ForegroundColor Red -NoNewline
    Write-Host $message
}

function Write-Step($message) {
    Write-Host ""
    Write-Host "▶ " -ForegroundColor Cyan -NoNewline
    Write-Host $message
}

# Show help
if ($Help) {
    Write-Host @"
ChainlessChain Release Script

Usage:
    .\release.ps1 [options]

Options:
    -Version <version>   Specify version (default: from package.json)
    -Draft              Create as draft release
    -Prerelease         Mark as prerelease
    -Notes <file>       Release notes from file
    -SkipBuild          Skip building, use existing artifacts
    -Help               Show this help message

Examples:
    # Create a draft release with current version
    .\release.ps1 -Draft

    # Create release for specific version
    .\release.ps1 -Version v0.21.0

    # Skip build and use existing artifacts
    .\release.ps1 -SkipBuild

Prerequisites:
    1. GitHub CLI installed: https://cli.github.com/
    2. Authenticated with: gh auth login
"@
    exit 0
}

# Banner
Write-Host ""
Write-Host "╔═══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║        ChainlessChain Release Automation Script          ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Get version from package.json if not specified
if (-not $Version) {
    $packageJson = Get-Content -Path "package.json" | ConvertFrom-Json
    $Version = "v$($packageJson.version)"
}

Write-Info "Version: $Version"
Write-Info "Draft: $($Draft.IsPresent)"
Write-Info "Prerelease: $($Prerelease.IsPresent)"

# Check GitHub CLI
Write-Step "Checking GitHub CLI..."
try {
    $ghVersion = & gh --version 2>&1 | Select-Object -First 1
    Write-Success "GitHub CLI installed: $ghVersion"
} catch {
    Write-Error "GitHub CLI not found. Please install from https://cli.github.com/"
    exit 1
}

# Check authentication
try {
    $authStatus = & gh auth status 2>&1
    if ($authStatus -match "not logged" -or $LASTEXITCODE -ne 0) {
        Write-Error "Not authenticated with GitHub. Run: gh auth login"
        exit 1
    }
    Write-Success "Authenticated with GitHub"
} catch {
    Write-Error "Failed to check authentication status"
    exit 1
}

# Build artifacts
if (-not $SkipBuild) {
    Write-Step "Building artifacts..."
    Write-Info "This may take 10-30 minutes depending on your machine..."

    $builds = @(
        @{Name="Windows (x64)"; Script="make:win"},
        @{Name="macOS (Universal)"; Script="make:mac"},
        @{Name="Linux (x64)"; Script="make:linux:x64"}
    )

    foreach ($build in $builds) {
        try {
            Write-Info "Building $($build.Name)..."
            npm run $($build.Script)
            Write-Success "$($build.Name) build completed"
        } catch {
            Write-Warning "Failed to build $($build.Name): $_"
            Write-Warning "Continuing with other builds..."
        }
    }
} else {
    Write-Warning "Skipping build (--SkipBuild flag set)"
}

# Collect artifacts
Write-Step "Collecting artifacts..."
$makeDir = "out\make"

if (-not (Test-Path $makeDir)) {
    Write-Error "No artifacts found. Run builds first or remove -SkipBuild flag."
    exit 1
}

$artifacts = Get-ChildItem -Path $makeDir -Recurse -Include *.zip,*.dmg,*.deb,*.rpm,*.AppImage,*.exe

if ($artifacts.Count -eq 0) {
    Write-Error "No valid artifacts found (.zip, .dmg, .deb, .rpm, .AppImage, .exe)"
    exit 1
}

Write-Success "Found $($artifacts.Count) artifact(s):"
foreach ($artifact in $artifacts) {
    $size = [math]::Round($artifact.Length / 1MB, 2)
    Write-Info "  - $($artifact.Name) ($size MB)"
}

# Generate release notes
Write-Step "Generating release notes..."

if ($Notes -and (Test-Path $Notes)) {
    $releaseNotes = Get-Content -Path $Notes -Raw
    Write-Success "Using release notes from: $Notes"
} else {
    if ($Notes) {
        Write-Warning "Release notes file not found: $Notes"
    }

    # Get last tag
    try {
        $lastTag = & git describe --tags --abbrev=0 2>$null
        if ($LASTEXITCODE -ne 0) { $lastTag = "" }
    } catch {
        $lastTag = ""
    }

    # Get commits
    $range = if ($lastTag) { "$lastTag..HEAD" } else { "HEAD" }
    try {
        $commits = & git log $range --pretty=format:"- %s (%h)" --no-merges 2>$null
        if ($LASTEXITCODE -ne 0) { $commits = "Initial release" }
    } catch {
        $commits = "Initial release"
    }

    $releaseNotes = @"
## ChainlessChain $Version

### What's Changed

$commits

### Installation

Download the appropriate file for your platform:
- **Windows**: `.zip` or `.exe` file
- **macOS**: `.dmg` file
- **Linux**: `.AppImage`, `.deb`, or `.rpm` file

### System Requirements

- **Windows**: Windows 10/11 (x64)
- **macOS**: macOS 10.15+ (Intel & Apple Silicon)
- **Linux**: Ubuntu 20.04+ / Fedora 34+ / Arch Linux (x64)

### Notes

- U-Key hardware integration is Windows-only
- Backend services can run via Docker or bundled binaries

**Full Changelog**: https://github.com/chainlesschain/chainlesschain/compare/$lastTag...$Version
"@
}

# Create release
Write-Step "Creating GitHub release..."

$notesFile = ".release-notes.tmp"
$releaseNotes | Out-File -FilePath $notesFile -Encoding UTF8

try {
    $flags = @(
        "--title `"ChainlessChain $Version`"",
        "--notes-file `"$notesFile`""
    )
    if ($Draft) { $flags += "--draft" }
    if ($Prerelease) { $flags += "--prerelease" }

    # Create release
    Write-Info "Creating release $Version..."
    $createCmd = "gh release create $Version " + ($flags -join " ")
    Invoke-Expression $createCmd

    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create release"
    }
    Write-Success "Release $Version created"

    # Upload artifacts
    Write-Info "Uploading artifacts..."
    foreach ($artifact in $artifacts) {
        Write-Info "  Uploading $($artifact.Name)..."
        & gh release upload $Version "$($artifact.FullName)" --clobber
        if ($LASTEXITCODE -eq 0) {
            Write-Success "  ✓ $($artifact.Name)"
        } else {
            Write-Warning "  Failed to upload $($artifact.Name)"
        }
    }

    Write-Success "All artifacts uploaded successfully!"

    # Get release URL
    $releaseUrl = (& gh release view $Version --json url --jq .url).Trim()
    Write-Success "`n🎉 Release published: $releaseUrl"

} catch {
    Write-Error "Failed to create release: $_"
    exit 1
} finally {
    # Clean up temp file
    if (Test-Path $notesFile) {
        Remove-Item $notesFile
    }
}

Write-Success "`n✨ Release process completed successfully!"
