# CI/CD Architecture - Unified Multi-Platform Release

## Overview

ChainlessChain采用统一的CI/CD架构，支持所有平台（Windows、macOS、Linux、Android）的自动化构建和发布。通过单一的git tag触发，可以同时构建和发布所有平台的应用程序。

## Architecture Design

### Unified Release Workflow

```
git tag v1.0.0
     │
     ├─ Triggers: .github/workflows/release.yml
     │
     ├─────────────┬─────────────┬─────────────┬─────────────┐
     │             │             │             │             │
     v             v             v             v             v
Windows      macOS (x64)  macOS (ARM)   Linux      Android
     │             │             │             │             │
     ├─ Node.js    ├─ Node.js    ├─ Node.js    ├─ Node.js    ├─ JDK 17
     ├─ Electron   ├─ Electron   ├─ Electron   ├─ Electron   ├─ Gradle
     ├─ Build      ├─ Build      ├─ Build      ├─ Build      ├─ Build
     │             │             │             │             │
     v             v             v             v             v
  .exe/.zip   .dmg/.zip    .dmg/.zip   .deb/.rpm    .apk/.aab
                                        .AppImage
     │             │             │             │             │
     └─────────────┴─────────────┴─────────────┴─────────────┘
                              │
                              v
                    GitHub Release (Unified)
                    - Windows artifacts
                    - macOS artifacts
                    - Linux artifacts
                    - Android artifacts
```

### Workflow Files

| Workflow            | Purpose                 | Trigger                     | Platform      |
| ------------------- | ----------------------- | --------------------------- | ------------- |
| `release.yml`       | **统一发布** (主工作流) | Git tag `v*.*.*`            | All platforms |
| `android-build.yml` | Android测试和质量检查   | Push/PR to `android-app/**` | Android only  |
| `test.yml`          | Desktop应用测试         | Push/PR                     | Desktop only  |
| `code-quality.yml`  | 代码质量检查            | Push/PR                     | All           |

## Release Workflow Details

### File: `.github/workflows/release.yml`

#### Jobs

| Job                   | Platform            | Duration | Artifacts                           |
| --------------------- | ------------------- | -------- | ----------------------------------- |
| `build-windows`       | Windows x64         | ~10 min  | `.exe`, `.zip`                      |
| `build-macos` (x64)   | macOS Intel         | ~12 min  | `.dmg`, `.zip`                      |
| `build-macos` (arm64) | macOS Apple Silicon | ~12 min  | `.dmg`, `.zip`                      |
| `build-linux`         | Linux x64           | ~10 min  | `.deb`, `.rpm`, `.AppImage`, `.zip` |
| `build-android`       | Android (API 26+)   | ~8 min   | `.apk`, `.aab`                      |
| `create-release`      | All platforms       | ~2 min   | GitHub Release                      |

**Total pipeline time**: ~15 minutes (parallel execution)

#### Trigger Methods

1. **Git Tag** (推荐):

   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

2. **Manual Dispatch**:
   - Go to GitHub Actions → Release → Run workflow
   - Input version (e.g., v0.20.0)
   - Select draft/prerelease options

#### Secrets Required

| Secret              | Purpose                           | Used By              |
| ------------------- | --------------------------------- | -------------------- |
| `KEYSTORE_BASE64`   | Android keystore (Base64 encoded) | Android build        |
| `KEYSTORE_PASSWORD` | Keystore password                 | Android build        |
| `KEY_ALIAS`         | Key alias                         | Android build        |
| `KEY_PASSWORD`      | Key password                      | Android build        |
| `GITHUB_TOKEN`      | GitHub release creation           | Automatic (no setup) |

**Note**: Desktop builds don't require signing secrets (可选code signing for macOS/Windows)

## Android Testing Workflow

### File: `.github/workflows/android-build.yml`

#### Purpose

Separate workflow focused on **testing and quality assurance** for Android app:

- Runs on every push/PR to `android-app/**`
- Does NOT build release APKs (handled by `release.yml`)
- Provides fast feedback for developers

#### Jobs

| Job                     | Purpose                               | Duration | Runs On     |
| ----------------------- | ------------------------------------- | -------- | ----------- |
| `lint`                  | Code quality checks                   | ~2 min   | All commits |
| `unit-tests`            | JUnit tests                           | ~3 min   | All commits |
| `instrumentation-tests` | UI tests on emulator (API 26, 30, 34) | ~15 min  | PR only     |
| `build-debug`           | Debug APK build                       | ~5 min   | All commits |
| `security-scan`         | MobSF security analysis               | ~10 min  | All commits |

**Total time**: ~5 minutes for push, ~25 minutes for PR

#### Trigger

```bash
# Automatically triggers on:
git push origin main  # Push to android-app/
gh pr create          # PR to android-app/
```

## Comparison: Before vs After

### Before (Separated Workflows)

```
Desktop Release:
  git tag v1.0.0 → release.yml → Desktop artifacts

Android Release:
  git tag android-v1.0.0 → android-build.yml → Android artifacts

Problems:
  ❌ Separate tags for each platform
  ❌ Separate GitHub Releases
  ❌ Inconsistent versioning
  ❌ Manual coordination required
```

### After (Unified Workflow)

```
Unified Release:
  git tag v1.0.0 → release.yml → All platform artifacts

Benefits:
  ✅ Single tag for all platforms
  ✅ Single GitHub Release with all artifacts
  ✅ Consistent versioning across platforms
  ✅ Automated coordination
  ✅ Easier release management
```

## Usage Guide

### For Developers (Daily Development)

#### Desktop Development

```bash
# Work on desktop app
cd desktop-app-vue
npm run dev

# Push changes - triggers test.yml
git push origin feature-branch

# Create PR - triggers test.yml + code-quality.yml
gh pr create
```

#### Android Development

```bash
# Work on Android app
cd android-app
./gradlew assembleDebug

# Push changes - triggers android-build.yml
git push origin feature-branch

# Create PR - triggers android-build.yml (full tests)
gh pr create
```

### For Release Managers (Release Process)

#### Option 1: Using Release Script (推荐)

**Desktop + Android unified release**:

```bash
# From project root
git tag v1.0.0
git push origin v1.0.0

# Workflow automatically builds all platforms
# Wait ~15 minutes for completion
# Check: https://github.com/user/repo/actions
```

**Android-only release** (using local script):

```bash
cd android-app/scripts

# Linux/macOS
./release.sh patch  # 1.0.0 -> 1.0.1

# Windows
release.bat patch
```

#### Option 2: Manual GitHub Actions

1. Go to: https://github.com/user/repo/actions/workflows/release.yml
2. Click "Run workflow"
3. Input:
   - Version: `v1.0.0`
   - Draft: ✓ (for testing)
   - Prerelease: ✗
4. Click "Run workflow"
5. Wait for completion
6. Review draft release
7. Publish when ready

### Release Checklist

**Before Release**:

- [ ] Update `desktop-app-vue/package.json` version
- [ ] Update `android-app/version.properties` version
- [ ] Update `CHANGELOG.md` for both platforms
- [ ] Merge all feature branches
- [ ] Run tests locally: `npm test && cd android-app && ./gradlew test`
- [ ] Test builds locally

**Create Release**:

- [ ] Create git tag: `git tag v1.0.0`
- [ ] Push tag: `git push origin v1.0.0`
- [ ] Monitor GitHub Actions: https://github.com/user/repo/actions
- [ ] Wait for all jobs to complete (~15 min)

**After Release**:

- [ ] Verify artifacts in GitHub Release
- [ ] Test downloads for each platform
- [ ] Update documentation
- [ ] Announce release (社交媒体、论坛等)
- [ ] Monitor crash reports (Firebase Crashlytics for Android)

## Release Artifacts Structure

### GitHub Release Structure

```
ChainlessChain v1.0.0
│
├── Windows
│   ├── ChainlessChain-win32-x64-1.0.0.zip
│   └── ChainlessChain-Setup-1.0.0.exe (optional)
│
├── macOS
│   ├── ChainlessChain-darwin-x64-1.0.0.dmg
│   ├── ChainlessChain-darwin-arm64-1.0.0.dmg
│   ├── ChainlessChain-darwin-x64-1.0.0.zip
│   └── ChainlessChain-darwin-arm64-1.0.0.zip
│
├── Linux
│   ├── ChainlessChain-1.0.0.AppImage
│   ├── chainlesschain_1.0.0_amd64.deb
│   ├── chainlesschain-1.0.0.x86_64.rpm
│   └── ChainlessChain-linux-x64-1.0.0.zip
│
└── Android
    ├── app-release.apk
    └── app-release.aab
```

### Artifact Naming Convention

| Platform              | Format                                      | Example                                 |
| --------------------- | ------------------------------------------- | --------------------------------------- |
| Windows               | `ChainlessChain-win32-x64-{version}.zip`    | `ChainlessChain-win32-x64-1.0.0.zip`    |
| macOS (Intel)         | `ChainlessChain-darwin-x64-{version}.dmg`   | `ChainlessChain-darwin-x64-1.0.0.dmg`   |
| macOS (Apple Silicon) | `ChainlessChain-darwin-arm64-{version}.dmg` | `ChainlessChain-darwin-arm64-1.0.0.dmg` |
| Linux (AppImage)      | `ChainlessChain-{version}.AppImage`         | `ChainlessChain-1.0.0.AppImage`         |
| Linux (DEB)           | `chainlesschain_{version}_amd64.deb`        | `chainlesschain_1.0.0_amd64.deb`        |
| Linux (RPM)           | `chainlesschain-{version}.x86_64.rpm`       | `chainlesschain-1.0.0.x86_64.rpm`       |
| Android (APK)         | `app-release.apk`                           | `app-release.apk`                       |
| Android (Bundle)      | `app-release.aab`                           | `app-release.aab`                       |

## Versioning Strategy

### Semantic Versioning (SemVer)

```
v{MAJOR}.{MINOR}.{PATCH}

Examples:
  v1.0.0    - Initial release
  v1.0.1    - Bug fix (PATCH)
  v1.1.0    - New feature (MINOR)
  v2.0.0    - Breaking change (MAJOR)
```

### Version Synchronization

**All platforms use the same version number**:

- Desktop: `desktop-app-vue/package.json` → `version: "1.0.0"`
- Android: `android-app/version.properties` → `VERSION_NAME=1.0.0`
- Git Tag: `v1.0.0`

**Automated version bumping**:

```bash
# Desktop (manual)
cd desktop-app-vue
npm version patch  # 1.0.0 -> 1.0.1
npm version minor  # 1.0.0 -> 1.1.0
npm version major  # 1.0.0 -> 2.0.0

# Android (script)
cd android-app/scripts
./release.sh patch  # Updates version.properties
```

## Monitoring & Debugging

### Monitor Workflow Progress

```bash
# List recent workflow runs
gh run list

# View specific run
gh run view <run-id>

# View logs
gh run view <run-id> --log

# Download artifacts
gh run download <run-id>
```

### Common Issues

#### Issue 1: Android build fails (no keystore)

**Symptom**:

```
⚠️ No keystore found, using debug signing
```

**Solution**:

- Add GitHub Secrets: `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, etc.
- See: `android-app/docs/ANDROID_CI_CD_GUIDE.md`

#### Issue 2: Desktop build fails (dependencies)

**Symptom**:

```
Error: Cannot find module 'electron'
```

**Solution**:

```bash
cd desktop-app-vue
npm ci  # Clean install
npm run build:main
npm run build:renderer
```

#### Issue 3: Release creation fails (permissions)

**Symptom**:

```
Error: Resource not accessible by integration
```

**Solution**:

- Ensure workflow has `contents: write` permission (already configured)
- Check repository settings → Actions → General → Workflow permissions

#### Issue 4: Tag already exists

**Symptom**:

```
Error: tag 'v1.0.0' already exists
```

**Solution**:

```bash
# Delete local tag
git tag -d v1.0.0

# Delete remote tag (careful!)
git push origin :refs/tags/v1.0.0

# Create new tag
git tag v1.0.1
git push origin v1.0.1
```

### Debug Mode

Enable GitHub Actions debug logging:

1. Go to: Settings → Secrets → Actions
2. Add secrets:
   - `ACTIONS_STEP_DEBUG` = `true`
   - `ACTIONS_RUNNER_DEBUG` = `true`
3. Re-run workflow
4. Check detailed logs

## Performance Optimization

### Current Performance

| Metric                  | Target  | Actual  | Status |
| ----------------------- | ------- | ------- | ------ |
| Full release build time | <20 min | ~15 min | ✅     |
| Parallel job execution  | Yes     | Yes     | ✅     |
| Artifact upload         | <5 min  | ~2 min  | ✅     |
| Release creation        | <2 min  | ~1 min  | ✅     |

### Optimization Strategies

1. **Parallel Execution**: All platform builds run concurrently
2. **Caching**: Gradle, npm, AVD caching enabled
3. **Conditional Jobs**: Android tests only on PR, not every push
4. **Artifact Retention**: 7 days for CI artifacts, permanent for releases

## Cost Analysis

### GitHub Actions Free Tier

**Public repositories**: Unlimited minutes
**Private repositories**: 2,000 minutes/month

### Estimated Monthly Cost (Private Repo)

```
Per release:
  - Windows build: 10 min
  - macOS x64 build: 12 min
  - macOS ARM build: 12 min
  - Linux build: 10 min
  - Android build: 8 min
  - Release creation: 2 min
  Total: ~15 min (parallel) × 2 (macOS counted separately) = ~24 min

4 releases/month × 24 min = 96 min
40 pushes/month × 5 min (tests only) = 200 min
Total: ~300 min/month → Within free tier ✅
```

## Future Enhancements

### Planned Features

1. **Auto-deploy to stores**:
   - Google Play Store (internal track) - 已实现，需配置
   - Apple App Store (via Fastlane)
   - Microsoft Store (via MSIX)

2. **Beta testing distribution**:
   - Firebase App Distribution (Android)
   - TestFlight (iOS)
   - GitHub Releases (pre-release tag)

3. **Automated changelog generation**:
   - Parse commit messages
   - Generate categorized changelog
   - Update CHANGELOG.md automatically

4. **Cross-platform testing**:
   - E2E tests on multiple OS
   - Automated smoke tests
   - Performance benchmarks

5. **Notification enhancements**:
   - Slack/Discord integration
   - Email notifications
   - Webhook for custom integrations

## References

### Documentation

- **Main Guide**: `ANDROID_CI_CD_GUIDE.md` - Android setup guide
- **Implementation**: `ANDROID_CI_CD_COMPLETE.md` - Android implementation details
- **This Document**: `CI_CD_ARCHITECTURE.md` - Overall CI/CD architecture

### External Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Electron Forge Documentation](https://www.electronforge.io/)
- [Android Gradle Plugin](https://developer.android.com/studio/build)
- [Semantic Versioning](https://semver.org/)

### Support

For issues or questions:

1. Check workflow logs: `gh run view <run-id> --log`
2. Review documentation in `android-app/docs/`
3. Search existing GitHub issues
4. Create new issue with:
   - Workflow run URL
   - Error message
   - Steps to reproduce
   - Environment details

---

**Document Version**: 1.0.0
**Last Updated**: 2024-01-19
**Status**: ✅ Production Ready
**Maintainer**: ChainlessChain Team
