# Release Testing Guide

Complete guide for testing the unified multi-platform release workflow.

## Overview

This guide walks you through testing the complete CI/CD pipeline that builds and releases all platforms (Windows, macOS, Linux, Android) from a single git tag.

## Prerequisites

### 1. GitHub Secrets Configured

Verify all secrets are set:

```bash
# Check in GitHub UI:
# Repository → Settings → Secrets and variables → Actions
```

**Required for Android**:

- ✓ `KEYSTORE_BASE64`
- ✓ `KEYSTORE_PASSWORD`
- ✓ `KEY_ALIAS`
- ✓ `KEY_PASSWORD`

**Optional**:

- `PLAY_STORE_SERVICE_ACCOUNT` (for Google Play deployment)
- `SLACK_WEBHOOK` (for notifications)

### 2. Repository Access

- Write access to the repository
- Permission to create tags
- Permission to create releases

### 3. Tools Installed

```bash
# Git
git --version

# GitHub CLI (optional, for easier testing)
gh --version
```

## Test Plan

### Phase 1: Test Android Workflow (Isolated)

**Purpose**: Verify Android build works independently before full release.

#### Step 1: Trigger Android CI/CD

```bash
# Make a small change in android-app
cd android-app
echo "# Test $(date)" >> README.md

# Commit and push
git add README.md
git commit -m "test(android): trigger CI/CD workflow"
git push origin main
```

#### Step 2: Monitor Workflow

```bash
# Using GitHub CLI
gh run list --workflow="Android CI/CD Pipeline"
gh run watch

# Or visit in browser
# https://github.com/YOUR_USERNAME/chainlesschain/actions
```

#### Step 3: Verify Jobs

Expected jobs (on push to main):

- ✓ `lint` - Code quality checks
- ✓ `unit-tests` - JUnit tests
- ✓ `build-debug` - Debug APK build
- ✓ `security-scan` - MobSF security analysis

Expected NOT to run (only on PR):

- ⏭ `instrumentation-tests` - Skipped (PR only)

#### Step 4: Check Artifacts

```bash
# Download artifacts
gh run download <run-id>

# Or download from GitHub UI
# Actions → Select run → Artifacts section
```

**Artifacts to verify**:

- `debug-apk/app-debug.apk`
- `lint-reports/lint-results-*.html`
- `unit-test-reports/index.html`

**Success Criteria**:

- ✅ All jobs pass
- ✅ Debug APK builds successfully
- ✅ No lint errors (or acceptable warnings)
- ✅ All tests pass

### Phase 2: Test Release Workflow (Dry Run)

**Purpose**: Test the full multi-platform release without publishing.

#### Step 1: Create Test Tag

```bash
# Create test tag (semver format)
git tag v0.20.0-test1
git push origin v0.20.0-test1
```

**Note**: Use `-test` suffix to indicate this is a test release.

#### Step 2: Monitor Full Pipeline

```bash
# Watch all workflows
gh run list --limit 10

# Watch specific run
gh run watch <run-id>
```

Expected jobs:

```
release.yml:
  ✓ build-windows     (~10 min)
  ✓ build-macos-x64   (~12 min)
  ✓ build-macos-arm64 (~12 min)
  ✓ build-linux       (~10 min)
  ✓ build-android     (~8 min)
  ✓ create-release    (~2 min)

android-build.yml:
  (Should NOT trigger - release builds handled by release.yml)
```

**Total expected time**: ~15-20 minutes (parallel execution)

#### Step 3: Verify Artifacts

Once workflow completes:

```bash
# List releases
gh release list

# View specific release
gh release view v0.20.0-test1
```

**Expected artifacts**:

**Windows**:

- `ChainlessChain-win32-x64-0.20.0-test1.zip`
- `ChainlessChain-Setup-0.20.0-test1.exe` (if configured)

**macOS**:

- `ChainlessChain-darwin-x64-0.20.0-test1.dmg`
- `ChainlessChain-darwin-x64-0.20.0-test1.zip`
- `ChainlessChain-darwin-arm64-0.20.0-test1.dmg`
- `ChainlessChain-darwin-arm64-0.20.0-test1.zip`

**Linux**:

- `ChainlessChain-0.20.0-test1.AppImage`
- `chainlesschain_0.20.0-test1_amd64.deb`
- `chainlesschain-0.20.0-test1.x86_64.rpm`
- `ChainlessChain-linux-x64-0.20.0-test1.zip`

**Android**:

- `app-release.apk`
- `app-release.aab`

#### Step 4: Download and Test Artifacts

```bash
# Download all release artifacts
gh release download v0.20.0-test1

# Verify checksums (if generated)
sha256sum -c checksums.txt

# Test APK signature
jarsigner -verify -verbose app-release.apk
```

**Manual Testing**:

1. **Windows**: Extract zip or run installer
2. **macOS**: Open DMG and test app
3. **Linux**: Install DEB/RPM or run AppImage
4. **Android**: Install APK on device

#### Step 5: Verify Release Notes

Check release notes include:

- ✅ All platforms listed
- ✅ Installation instructions for each platform
- ✅ System requirements
- ✅ Changelog (generated from commits)

#### Success Criteria

- ✅ All platform builds succeed
- ✅ All artifacts are uploaded
- ✅ Release is created correctly
- ✅ Artifacts download successfully
- ✅ Android APK is signed (verified with jarsigner)
- ✅ Apps launch on each platform
- ✅ No critical errors in logs

### Phase 3: Test Android-Specific Features

#### Test 1: Signed APK Verification

```bash
# Download APK
gh release download v0.20.0-test1 -p "app-release.apk"

# Verify signature
jarsigner -verify -verbose -certs app-release.apk

# Expected output:
# jar verified.
```

**Check certificate details**:

```bash
jarsigner -verify -verbose -certs app-release.apk | grep "CN="

# Should show your certificate:
# CN=ChainlessChain Team, OU=Mobile Development, O=ChainlessChain
```

#### Test 2: APK Size Check

```bash
# Check APK size
ls -lh app-release.apk

# Should be reasonable (< 50MB for initial release)
```

**Compare with debug build**:

```bash
# Debug APK size
ls -lh app-debug.apk

# Release should be smaller due to:
# - ProGuard/R8 code shrinking
# - Resource shrinking
# - Optimized icons (~2.5MB saved)
```

#### Test 3: Install on Device

```bash
# Install via ADB
adb install app-release.apk

# Or manually:
# - Transfer APK to device
# - Open in file manager
# - Install (enable "Unknown Sources" if needed)
```

**Verify**:

- ✅ App installs successfully
- ✅ Icon displays correctly (ChainlessChain logo)
- ✅ App launches without crashes
- ✅ No security warnings
- ✅ Permissions requested properly

#### Test 4: App Bundle (AAB)

```bash
# Download AAB
gh release download v0.20.0-test1 -p "app-release.aab"

# Verify AAB format
zipinfo app-release.aab | head -20
```

**AAB cannot be installed directly**:

- Used for Play Store only
- Play Store generates optimized APKs per device

**Test with bundletool** (optional):

```bash
# Install bundletool
# https://github.com/google/bundletool

# Generate APKs from AAB
bundletool build-apks \
  --bundle=app-release.aab \
  --output=app.apks \
  --ks=~/keystores/chainlesschain-release.jks \
  --ks-key-alias=chainlesschain

# Install to connected device
bundletool install-apks --apks=app.apks
```

### Phase 4: Test Desktop Platforms (Sampling)

#### Windows

```powershell
# Download and extract
Invoke-WebRequest -Uri "https://github.com/user/repo/releases/download/v0.20.0-test1/ChainlessChain-win32-x64-0.20.0-test1.zip" -OutFile app.zip
Expand-Archive app.zip -DestinationPath ChainlessChain

# Run app
cd ChainlessChain
.\ChainlessChain.exe
```

**Verify**:

- ✅ App launches
- ✅ U-Key features work (Windows only)
- ✅ No missing DLL errors
- ✅ Database initializes

#### macOS

```bash
# Download DMG
curl -L -o app.dmg "https://github.com/user/repo/releases/download/v0.20.0-test1/ChainlessChain-darwin-x64-0.20.0-test1.dmg"

# Mount and install
hdiutil attach app.dmg
cp -R /Volumes/ChainlessChain/ChainlessChain.app /Applications/
hdiutil detach /Volumes/ChainlessChain

# Run
open /Applications/ChainlessChain.app
```

**Verify**:

- ✅ App launches (may need to allow in Security settings)
- ✅ Native macOS UI
- ✅ No Gatekeeper issues

#### Linux

```bash
# Test AppImage (most universal)
wget https://github.com/user/repo/releases/download/v0.20.0-test1/ChainlessChain-0.20.0-test1.AppImage
chmod +x ChainlessChain-0.20.0-test1.AppImage
./ChainlessChain-0.20.0-test1.AppImage
```

**Or DEB**:

```bash
wget https://github.com/user/repo/releases/download/v0.20.0-test1/chainlesschain_0.20.0-test1_amd64.deb
sudo dpkg -i chainlesschain_0.20.0-test1_amd64.deb
chainlesschain
```

**Verify**:

- ✅ App launches
- ✅ Desktop integration works
- ✅ Menu items created

### Phase 5: Cleanup Test Release

After verification:

```bash
# Delete test release
gh release delete v0.20.0-test1 --yes

# Delete test tag
git tag -d v0.20.0-test1
git push origin :refs/tags/v0.20.0-test1
```

## Production Release

Once testing is successful, create production release:

### Step 1: Update Version Numbers

```bash
# Desktop app
vim desktop-app-vue/package.json
# Change: "version": "0.20.0"

# Android app
vim android-app/version.properties
# Change: VERSION_NAME=0.20.0
# Change: VERSION_CODE=20

# Update CHANGELOG.md
vim CHANGELOG.md
```

### Step 2: Commit Version Bump

```bash
git add desktop-app-vue/package.json android-app/version.properties CHANGELOG.md
git commit -m "chore: bump version to 0.20.0"
git push origin main
```

### Step 3: Create Production Tag

```bash
# Create production tag (no -test suffix)
git tag v0.20.0
git push origin v0.20.0
```

### Step 4: Monitor and Verify

Same as Phase 2, but:

- ✅ Tag has no `-test` suffix
- ✅ This is the **public release**
- ✅ Will be visible to all users
- ✅ Cannot easily undo (can delete, but not ideal)

### Step 5: Announce Release

Once verified:

- Update project README
- Post on social media
- Notify beta testers
- Update documentation website

## Troubleshooting

### Issue: Workflow not triggered

**Symptoms**:

- Push tag but no workflow runs
- Actions tab shows no activity

**Solutions**:

1. Check tag format: Must be `v*.*.*` (e.g., `v1.0.0`)
2. Verify workflow file exists: `.github/workflows/release.yml`
3. Check workflow is enabled: Actions → Workflows → Release
4. Look for workflow syntax errors in commit logs

### Issue: Build fails on one platform

**Symptoms**:

- Some builds succeed, one fails
- Release partially created

**Solutions**:

1. Check workflow logs for specific platform
2. Common issues:
   - Windows: Node modules, native dependencies
   - macOS: Code signing, notarization
   - Linux: Missing system libraries
   - Android: Keystore, SDK versions
3. Fix issue and re-tag:

   ```bash
   # Delete bad release
   gh release delete v0.20.0-test1 --yes
   git tag -d v0.20.0-test1
   git push origin :refs/tags/v0.20.0-test1

   # Fix code, commit, re-tag
   # ...
   git tag v0.20.0-test2
   git push origin v0.20.0-test2
   ```

### Issue: Android APK unsigned

**Symptoms**:

- APK builds but not signed
- `jarsigner -verify` fails

**Solutions**:

1. Verify GitHub Secrets are set
2. Check secret names match workflow
3. Verify base64 encoding is correct
4. Test keystore locally first

### Issue: Release artifacts missing

**Symptoms**:

- Release created but some artifacts missing
- Expected files not in release

**Solutions**:

1. Check artifact upload step in logs
2. Verify file paths in workflow
3. Check if files were built:
   ```yaml
   - name: List artifacts
     run: ls -R artifacts/
   ```
4. Common issue: Wrong glob pattern in `files:` section

## Best Practices

### Version Numbering

- ✅ Use semantic versioning: `v{MAJOR}.{MINOR}.{PATCH}`
- ✅ Test releases: Add `-test`, `-rc`, `-beta` suffix
- ✅ Synchronize versions across platforms
- ❌ Don't skip versions
- ❌ Don't reuse version numbers

### Testing Strategy

1. **Local Testing First**: Build locally before pushing
2. **CI Testing**: Let CI run on feature branches
3. **Test Releases**: Use `-test` tags for dry runs
4. **Staged Rollout**: Release to beta testers first
5. **Monitor**: Check crash reports after release

### Release Schedule

**Recommended cadence**:

- Major releases: Every 3-6 months
- Minor releases: Monthly
- Patch releases: As needed for critical bugs
- Beta releases: Weekly during development

### Communication

Before each release:

- [ ] Update CHANGELOG.md with all changes
- [ ] Test on all target platforms
- [ ] Create backup of previous release
- [ ] Notify beta testers
- [ ] Prepare release announcement

After each release:

- [ ] Monitor crash reports (first 24 hours)
- [ ] Check user feedback
- [ ] Update documentation
- [ ] Archive release notes

## Quick Reference

### Test Release

```bash
# Create test tag
git tag v0.20.0-test1 && git push origin v0.20.0-test1

# Monitor
gh run watch

# Verify
gh release view v0.20.0-test1

# Cleanup
gh release delete v0.20.0-test1 --yes
git tag -d v0.20.0-test1 && git push origin :refs/tags/v0.20.0-test1
```

### Production Release

```bash
# Update versions
vim desktop-app-vue/package.json android-app/version.properties CHANGELOG.md
git commit -am "chore: bump version to 0.20.0"

# Create tag
git tag v0.20.0 && git push origin v0.20.0

# Monitor
gh run watch

# Verify
gh release view v0.20.0
```

### Verify Android APK

```bash
# Download
gh release download v0.20.0 -p "app-release.apk"

# Verify signature
jarsigner -verify -verbose -certs app-release.apk

# Install
adb install app-release.apk
```

---

**Document Version**: 1.0.0
**Last Updated**: 2024-01-19
**Status**: ✅ Production Ready
**Maintainer**: ChainlessChain Team

## Next Steps

1. ⏭️ Create test tag to verify workflow
2. ⏭️ Test all platform downloads
3. ⏭️ Verify Android app signature
4. ⏭️ Create production release
5. ⏭️ Set up Google Play deployment (optional)
