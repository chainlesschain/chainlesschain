# ChainlessChain Release Guide

This guide explains how to create releases for ChainlessChain across Windows, macOS, and Linux platforms.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Release Methods](#release-methods)
  - [Method 1: GitHub Actions (Recommended)](#method-1-github-actions-recommended)
  - [Method 2: Local Build + Script](#method-2-local-build--script)
  - [Method 3: Manual Process](#method-3-manual-process)
- [Version Management](#version-management)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### For All Methods

1. **Git access** with write permissions to the repository
2. **GitHub CLI** installed and authenticated:

   ```bash
   # Install GitHub CLI
   # Windows (via winget):
   winget install --id GitHub.cli

   # macOS (via Homebrew):
   brew install gh

   # Linux (Debian/Ubuntu):
   sudo apt install gh

   # Authenticate
   gh auth login
   ```

### For Local Builds (Method 2)

3. **Node.js 22.12.0+** and **npm 10+**
4. **Platform-specific tools**:
   - **Windows**: Visual Studio Build Tools, Inno Setup (optional)
   - **macOS**: Xcode Command Line Tools
   - **Linux**: `rpm`, `fakeroot`, `dpkg`

## Release Methods

### Method 1: GitHub Actions (Recommended)

This method builds all platforms (Windows, macOS x64/arm64, Linux) in the cloud using GitHub Actions. **This is the recommended approach** as it provides:

- ✅ Consistent builds across all platforms
- ✅ No need for local build environment
- ✅ Automatic checksums and verification
- ✅ Build artifacts are automatically uploaded

#### Steps

1. **Update version in `package.json`**:

   ```bash
   cd desktop-app-vue
   # Edit package.json and bump version to 0.21.0
   npm version 0.21.0 --no-git-tag-version
   ```

2. **Commit and push changes**:

   ```bash
   git add desktop-app-vue/package.json
   git commit -m "chore: bump version to 0.21.0"
   git push origin main
   ```

3. **Create and push a git tag**:

   ```bash
   git tag v0.21.0
   git push origin v0.21.0
   ```

4. **GitHub Actions will automatically**:
   - Build for Windows (x64)
   - Build for macOS (x64 and arm64)
   - Build for Linux (x64)
   - Create GitHub Release
   - Upload all artifacts

5. **Monitor the workflow**:
   - Go to: `https://github.com/YOUR_ORG/chainlesschain/actions`
   - Watch the "Release" workflow
   - Wait for completion (~20-30 minutes)

6. **Verify the release**:
   - Go to: `https://github.com/YOUR_ORG/chainlesschain/releases`
   - Check that all artifacts are uploaded
   - Edit release notes if needed

#### Manual Trigger (Alternative)

You can also manually trigger the workflow without creating a tag:

1. Go to: `https://github.com/YOUR_ORG/chainlesschain/actions`
2. Select "Release" workflow
3. Click "Run workflow"
4. Enter version (e.g., `v0.21.0`)
5. Choose options (draft, prerelease)
6. Click "Run workflow"

### Method 2: Local Build + Script

This method builds artifacts locally and uses a script to create the GitHub release.

⚠️ **Note**: Building for all platforms locally is challenging:

- Windows machines cannot build `.dmg` files for macOS
- macOS/Linux machines cannot build `.exe` installers for Windows
- Cross-compilation is complex and not fully supported

#### Windows (PowerShell)

```powershell
cd desktop-app-vue

# Build all platforms (if possible)
npm run build
npm run make:win
npm run make:mac    # May fail on Windows
npm run make:linux  # May fail on Windows

# Create release
.\scripts\release.ps1 -Draft

# Or specify version
.\scripts\release.ps1 -Version v0.21.0 -Draft

# Skip build if already built
.\scripts\release.ps1 -SkipBuild
```

#### macOS / Linux (Node.js)

```bash
cd desktop-app-vue

# Build all platforms (if possible)
npm run build
npm run make:win    # May fail on macOS/Linux
npm run make:mac
npm run make:linux

# Create release
node scripts/release.js --draft

# Or specify version
node scripts/release.js --version v0.21.0 --draft

# Skip build if already built
node scripts/release.js --skip-build
```

#### Script Options

| Option                                       | Description                                          |
| -------------------------------------------- | ---------------------------------------------------- |
| `--version <version>` / `-Version <version>` | Specify release version (default: from package.json) |
| `--draft` / `-Draft`                         | Create as draft release (recommended for review)     |
| `--prerelease` / `-Prerelease`               | Mark as prerelease (alpha, beta, rc)                 |
| `--notes <file>` / `-Notes <file>`           | Use custom release notes from file                   |
| `--skip-build` / `-SkipBuild`                | Skip building, use existing artifacts                |

### Method 3: Manual Process

For complete manual control:

#### 1. Build Artifacts

```bash
cd desktop-app-vue

# Windows
npm run make:win

# macOS (Intel)
npm run make:mac:x64

# macOS (Apple Silicon)
npm run make:mac:arm64

# Linux
npm run make:linux:x64
```

#### 2. Create Release

```bash
# Create release
gh release create v0.21.0 \
  --title "ChainlessChain v0.21.0" \
  --notes "Release notes here" \
  --draft

# Or use a notes file
gh release create v0.21.0 \
  --title "ChainlessChain v0.21.0" \
  --notes-file RELEASE_NOTES.md \
  --draft
```

#### 3. Upload Artifacts

```bash
# Upload all artifacts from out/make
gh release upload v0.21.0 out/make/**/*.zip
gh release upload v0.21.0 out/make/**/*.dmg
gh release upload v0.21.0 out/make/**/*.deb
gh release upload v0.21.0 out/make/**/*.rpm
gh release upload v0.21.0 out/make/**/*.AppImage
```

#### 4. Publish Release

```bash
# Remove draft status
gh release edit v0.21.0 --draft=false
```

## Version Management

### Version Numbering

ChainlessChain follows [Semantic Versioning](https://semver.org/):

- **Major** (v1.0.0): Breaking changes
- **Minor** (v0.1.0): New features, backward compatible
- **Patch** (v0.0.1): Bug fixes, backward compatible

### Updating Version

1. **In `desktop-app-vue/package.json`**:

   ```json
   {
     "version": "0.21.0"
   }
   ```

2. **Using npm version command**:
   ```bash
   cd desktop-app-vue
   npm version patch  # 0.20.0 -> 0.20.1
   npm version minor  # 0.20.1 -> 0.21.0
   npm version major  # 0.21.0 -> 1.0.0
   ```

### Release Types

- **Stable Release**: `v0.21.0`
- **Release Candidate**: `v0.21.0-rc.1`
- **Beta**: `v0.21.0-beta.1`
- **Alpha**: `v0.21.0-alpha.1`

## Artifacts Overview

### Windows

| File                                     | Type      | Description                             |
| ---------------------------------------- | --------- | --------------------------------------- |
| `ChainlessChain-win32-x64-{version}.zip` | Portable  | Extract and run, no installation        |
| `ChainlessChain-Setup-{version}.exe`     | Installer | Squirrel.Windows installer (if enabled) |

### macOS

| File                                         | Type      | Description              |
| -------------------------------------------- | --------- | ------------------------ |
| `ChainlessChain-darwin-x64-{version}.dmg`    | Installer | Intel Mac disk image     |
| `ChainlessChain-darwin-arm64-{version}.dmg`  | Installer | Apple Silicon disk image |
| `ChainlessChain-darwin-{arch}-{version}.zip` | Portable  | Zip archive              |

### Linux

| File                                     | Type     | Description            |
| ---------------------------------------- | -------- | ---------------------- |
| `chainlesschain_{version}_amd64.deb`     | Package  | Debian/Ubuntu package  |
| `chainlesschain-{version}.x86_64.rpm`    | Package  | Fedora/RHEL package    |
| `ChainlessChain-{version}.AppImage`      | Portable | Universal Linux binary |
| `ChainlessChain-linux-x64-{version}.zip` | Portable | Zip archive            |

## Release Checklist

Before creating a release:

- [ ] Update version in `desktop-app-vue/package.json`
- [ ] Update CHANGELOG.md with changes
- [ ] Test all features on target platforms
- [ ] Run tests: `npm run test:all`
- [ ] Check build: `npm run build`
- [ ] Review security: `npm audit`
- [ ] Update documentation if needed
- [ ] Create git tag with correct version
- [ ] Verify GitHub Actions workflow passes
- [ ] Test installation on each platform
- [ ] Verify auto-update works (if enabled)

## Troubleshooting

### GitHub CLI Issues

**Error: `gh: command not found`**

```bash
# Install GitHub CLI (see Prerequisites)
# Then authenticate
gh auth login
```

**Error: `HTTP 401: Bad credentials`**

```bash
# Re-authenticate
gh auth login --web
```

### Build Issues

**Error: `EPERM: operation not permitted`**

```bash
# Close all running instances of ChainlessChain
# Remove out directory and retry
rm -rf out
npm run make:win
```

**Error: `Cannot find module`**

```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

**Error: Missing native modules**

```bash
# Rebuild native modules
npm run rebuild
# Or
npm rebuild
```

### Platform-Specific Issues

#### Windows

**Error: Squirrel.Windows path issues**

- The Squirrel maker is currently disabled in `forge.config.js`
- Use ZIP distribution instead
- Or fix the nuspec path issues before enabling

#### macOS

**Error: Code signing failed**

- macOS builds require code signing for distribution
- Set `hardenedRuntime: false` for local testing
- For production, configure code signing certificates

**Error: Notarization failed**

- Apple notarization is required for macOS 10.15+
- Configure `afterSign` script in `electron-builder.yml`
- Or distribute as ZIP for testing

#### Linux

**Error: `rpm` command not found**

```bash
# Ubuntu/Debian
sudo apt install rpm

# macOS
brew install rpm
```

**Error: `fakeroot` not found**

```bash
sudo apt install fakeroot
```

## CI/CD Integration

### GitHub Actions Workflow

Location: `.github/workflows/release.yml`

**Triggers:**

- Push tags matching `v*.*.*`
- Manual workflow dispatch

**Jobs:**

1. `build-windows`: Builds Windows artifacts
2. `build-macos`: Builds macOS artifacts (x64 + arm64)
3. `build-linux`: Builds Linux artifacts
4. `create-release`: Creates GitHub Release and uploads artifacts

**Secrets Required:**

- `GITHUB_TOKEN` (automatically provided)

**Optional Secrets** (for code signing):

- `WINDOWS_CERTIFICATE` - Windows code signing certificate
- `WINDOWS_CERTIFICATE_PASSWORD` - Certificate password
- `APPLE_ID` - Apple ID for notarization
- `APPLE_ID_PASSWORD` - App-specific password
- `APPLE_TEAM_ID` - Apple Team ID

## Release Notes Template

```markdown
## ChainlessChain v0.21.0

### 🎉 What's New

- Feature 1: Description
- Feature 2: Description

### 🐛 Bug Fixes

- Fix 1: Description
- Fix 2: Description

### 🔧 Improvements

- Improvement 1: Description
- Improvement 2: Description

### ⚠️ Breaking Changes

- Breaking change 1: Description and migration guide

### 📦 Installation

Download the appropriate file for your platform:

#### Windows

- `ChainlessChain-win32-x64-0.21.0.zip` - Portable version

#### macOS

- `ChainlessChain-darwin-x64-0.21.0.dmg` - Intel Mac
- `ChainlessChain-darwin-arm64-0.21.0.dmg` - Apple Silicon

#### Linux

- `ChainlessChain-0.21.0.AppImage` - Universal
- `chainlesschain_0.21.0_amd64.deb` - Debian/Ubuntu
- `chainlesschain-0.21.0.x86_64.rpm` - Fedora/RHEL

### 🔒 Checksums

SHA256 checksums for verification:
```

<checksums will be auto-generated>
```

### 📋 System Requirements

- **Windows**: Windows 10/11 (x64)
- **macOS**: macOS 10.15+ (Intel & Apple Silicon)
- **Linux**: Ubuntu 20.04+ / Fedora 34+ (x64)

### 🙏 Credits

Thanks to all contributors who made this release possible!

**Full Changelog**: https://github.com/chainlesschain/chainlesschain/compare/v0.20.0...v0.21.0

```

## Support

For issues or questions:
- GitHub Issues: https://github.com/chainlesschain/chainlesschain/issues
- Documentation: https://github.com/chainlesschain/chainlesschain/tree/main/docs
- Community: [Add community link]

---

**Last Updated**: 2024-01-19
```
