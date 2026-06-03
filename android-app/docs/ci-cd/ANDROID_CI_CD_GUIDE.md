# Android CI/CD Guide

Complete guide for setting up and using the GitHub Actions-based CI/CD pipeline for Android native app automation.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [GitHub Secrets Setup](#github-secrets-setup)
3. [Keystore Management](#keystore-management)
4. [GitHub CLI Setup](#github-cli-setup)
5. [Workflow Triggers](#workflow-triggers)
6. [Release Automation](#release-automation)
7. [Play Store Deployment](#play-store-deployment)
8. [Troubleshooting](#troubleshooting)

## Prerequisites

### Required Tools

- **Git** (latest version)
- **GitHub CLI** (`gh`) for release automation
- **Java 17** (for Android builds)
- **Android SDK** (API levels 26, 30, 34)
- **Gradle 8.2+**

### System Requirements

- **Windows**: Windows 10/11 with PowerShell 5.1+
- **macOS**: macOS 10.15+ with Bash 4.0+
- **Linux**: Ubuntu 20.04+ or equivalent with Bash 4.0+

## GitHub Secrets Setup

### Step 1: Generate Android Keystore

```bash
# Create a new keystore (if you don't have one)
keytool -genkey -v \
  -keystore chainlesschain-release.jks \
  -alias chainlesschain \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -storepass YOUR_STORE_PASSWORD \
  -keypass YOUR_KEY_PASSWORD
```

**Important**: Save your passwords securely! You'll need them for GitHub Secrets.

### Step 2: Encode Keystore to Base64

```bash
# Linux/macOS
base64 -i chainlesschain-release.jks -o keystore.base64

# Windows (PowerShell)
[Convert]::ToBase64String([IO.File]::ReadAllBytes("chainlesschain-release.jks")) | Out-File keystore.base64
```

### Step 3: Add GitHub Secrets

Navigate to your GitHub repository → Settings → Secrets and variables → Actions → New repository secret

Add the following secrets:

| Secret Name                  | Description                      | Example Value                      |
| ---------------------------- | -------------------------------- | ---------------------------------- |
| `KEYSTORE_BASE64`            | Base64-encoded keystore file     | (paste content of keystore.base64) |
| `KEYSTORE_PASSWORD`          | Keystore password                | `your_store_password`              |
| `KEY_ALIAS`                  | Key alias name                   | `chainlesschain`                   |
| `KEY_PASSWORD`               | Key password                     | `your_key_password`                |
| `PLAY_STORE_SERVICE_ACCOUNT` | Google Play service account JSON | (see Play Store section)           |
| `SLACK_WEBHOOK`              | Slack webhook URL (optional)     | `https://hooks.slack.com/...`      |

### Step 4: Verify Secrets

After adding secrets, you should see them listed (values are hidden):

```
✓ KEYSTORE_BASE64
✓ KEYSTORE_PASSWORD
✓ KEY_ALIAS
✓ KEY_PASSWORD
✓ PLAY_STORE_SERVICE_ACCOUNT
✓ SLACK_WEBHOOK
```

## Keystore Management

### Security Best Practices

1. **Never commit keystores to git**
   - Add `*.jks` to `.gitignore`
   - Keep keystores in secure, encrypted storage

2. **Use strong passwords**
   - Minimum 12 characters
   - Mix of uppercase, lowercase, numbers, symbols

3. **Backup keystores**
   - Store in multiple secure locations
   - Use encrypted cloud storage

4. **Rotate keys periodically**
   - Google recommends key rotation every 2-3 years
   - Plan ahead for migration

### Local Development Setup

Copy the signing configuration template:

```bash
cd android-app/app
cp build.gradle.signing.example build.gradle.signing
```

Edit `build.gradle.signing` and configure for local development:

```groovy
android {
    signingConfigs {
        release {
            // Local development - use gradle.properties
            storeFile file(project.findProperty("KEYSTORE_FILE") ?: "../keystore.jks")
            storePassword project.findProperty("KEYSTORE_PASSWORD")
            keyAlias project.findProperty("KEY_ALIAS")
            keyPassword project.findProperty("KEY_PASSWORD")
        }
    }
}
```

Create `gradle.properties` in your home directory (`~/.gradle/gradle.properties`):

```properties
KEYSTORE_FILE=/path/to/chainlesschain-release.jks
KEYSTORE_PASSWORD=your_store_password
KEY_ALIAS=chainlesschain
KEY_PASSWORD=your_key_password
```

**Important**: Never commit `gradle.properties` to git!

## GitHub CLI Setup

### Installation

```bash
# macOS
brew install gh

# Windows (via Chocolatey)
choco install gh

# Linux (Debian/Ubuntu)
sudo apt install gh

# Or download from: https://cli.github.com/
```

### Authentication

```bash
# Login to GitHub
gh auth login

# Select options:
# - What account do you want to log into? → GitHub.com
# - What is your preferred protocol for Git operations? → HTTPS
# - Authenticate Git with your GitHub credentials? → Yes
# - How would you like to authenticate GitHub CLI? → Login with a web browser

# Verify authentication
gh auth status
```

### Grant Permissions

For release automation, ensure your GitHub token has:

- ✓ `repo` (Full control of private repositories)
- ✓ `workflow` (Update GitHub Action workflows)
- ✓ `write:packages` (Upload packages to GitHub Package Registry)

## Workflow Triggers

### Automatic Triggers

The CI/CD workflow runs automatically on:

1. **Push to main branch**

   ```bash
   git push origin main
   ```

   - Runs: lint, unit-tests, build-debug

2. **Pull Request to main**

   ```bash
   gh pr create --base main
   ```

   - Runs: lint, unit-tests, instrumentation-tests, build-debug

3. **Git Tag (vX.Y.Z)**

   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

   - Runs: **Full pipeline** (all 10 jobs)
   - Triggers: Play Store deployment, GitHub release

### Manual Triggers

Run workflow manually from GitHub UI:

1. Go to Actions → Android CI/CD
2. Click "Run workflow"
3. Select branch
4. Click "Run workflow" button

Or via GitHub CLI:

```bash
gh workflow run "Android CI/CD" --ref main
```

### Workflow Jobs Overview

| Job                     | Description             | Runs On      |
| ----------------------- | ----------------------- | ------------ |
| `lint`                  | Code quality checks     | All triggers |
| `unit-tests`            | JUnit tests             | All triggers |
| `instrumentation-tests` | Android emulator tests  | PR, Tag      |
| `build-debug`           | Debug APK build         | All triggers |
| `build-release`         | Signed release APK      | Tag only     |
| `build-bundle`          | Signed App Bundle       | Tag only     |
| `deploy-play-store`     | Deploy to Google Play   | Tag only     |
| `create-release`        | GitHub release          | Tag only     |
| `security-scan`         | MobSF security analysis | Tag only     |
| `notify`                | Slack notification      | Tag only     |

## Release Automation

### Using Release Scripts

The release scripts automate:

- ✓ Version bumping
- ✓ Running tests
- ✓ Building APK/Bundle
- ✓ Creating git tags
- ✓ Pushing to GitHub
- ✓ Creating GitHub releases

### Linux/macOS Release

```bash
cd android-app/scripts

# Make script executable
chmod +x release.sh

# Run release (default: patch version bump)
./release.sh

# Or specify version bump type
./release.sh patch  # 1.0.0 -> 1.0.1
./release.sh minor  # 1.0.0 -> 1.1.0
./release.sh major  # 1.0.0 -> 2.0.0
```

**Example Output**:

```
[INFO] Starting Android release process...
[INFO] Checking requirements...
[INFO] Requirements check passed
[INFO] Current version: 1.0.0 (1)
[INFO] New version: 1.0.1 (2)

[WARN] About to release version 1.0.1 (2)
Continue? (y/n) y

[INFO] Running tests...
[INFO] Running lint...
BUILD SUCCESSFUL in 15s
[INFO] Running unit tests...
BUILD SUCCESSFUL in 8s
[INFO] Tests passed

[INFO] Building release...
[INFO] Building release APK...
BUILD SUCCESSFUL in 45s
[INFO] Building app bundle...
BUILD SUCCESSFUL in 30s
[INFO] Build completed

[INFO] Creating git tag...
[main 1a2b3c4] chore: bump version to 1.0.1
[INFO] Git tag v1.0.1 created

[INFO] Pushing to remote...
[INFO] Pushed to remote

[INFO] Creating GitHub release...
[INFO] GitHub release created: https://github.com/user/repo/releases/tag/v1.0.1

[INFO] Release completed successfully! 🎉
[INFO] Version 1.0.1 is now available
```

### Windows Release

```batch
cd android-app\scripts

REM Run release (default: patch version bump)
release.bat

REM Or specify version bump type
release.bat patch
release.bat minor
release.bat major
```

### Manual Version Management

Edit `android-app/version.properties`:

```properties
VERSION_NAME=1.2.3
VERSION_CODE=10
```

Then build manually:

```bash
cd android-app
./gradlew assembleRelease bundleRelease
```

### Version History Tracking

The `version.properties` file automatically appends version history:

```properties
VERSION_NAME=1.0.1
VERSION_CODE=2

# Version history
# 1.0.0 (1) - Initial release
# 1.0.1 (2) - 2024-01-15
```

## Play Store Deployment

### Step 1: Create Service Account

1. Go to [Google Play Console](https://play.google.com/console)
2. Navigate to Setup → API access
3. Click "Create new service account"
4. Follow the link to Google Cloud Console
5. Create service account:
   - Name: `chainlesschain-github-actions`
   - Role: `Service Account User`
6. Create JSON key:
   - Click on service account
   - Keys → Add Key → Create new key
   - Select JSON
   - Download the key file

### Step 2: Grant Play Console Access

1. Return to Play Console → API access
2. Find your service account
3. Click "Grant access"
4. Permissions:
   - ✓ Releases: Manage production releases
   - ✓ Release to testing tracks: Create and modify
5. Click "Invite user"

### Step 3: Add Service Account to GitHub

```bash
# Copy service account JSON to clipboard
cat google-play-service-account.json | pbcopy  # macOS
cat google-play-service-account.json | xclip   # Linux
```

Add as GitHub Secret:

- Name: `PLAY_STORE_SERVICE_ACCOUNT`
- Value: (paste JSON content)

### Step 4: Configure Track

Edit `.github/workflows/android-build.yml`:

```yaml
- name: Deploy to Play Store
  uses: r0adkll/upload-google-play@v1
  with:
    serviceAccountJsonPlainText: ${{ secrets.PLAY_STORE_SERVICE_ACCOUNT }}
    packageName: com.chainlesschain.android
    releaseFiles: android-app/app/build/outputs/bundle/release/*.aab
    track: internal # Change to: internal, alpha, beta, or production
    status: completed
```

### Deployment Tracks

| Track        | Purpose          | User Access       |
| ------------ | ---------------- | ----------------- |
| `internal`   | Internal testing | Up to 100 testers |
| `alpha`      | Closed testing   | Selected testers  |
| `beta`       | Open testing     | Anyone with link  |
| `production` | Public release   | All users         |

### Rollout Strategy

For production releases, use staged rollout:

```yaml
- name: Deploy to Play Store
  uses: r0adkll/upload-google-play@v1
  with:
    track: production
    inAppUpdatePriority: 2
    userFraction: 0.1 # Roll out to 10% of users
    status: inProgress # Manual completion required
```

Then manually increase rollout percentage in Play Console.

## Troubleshooting

### Build Failures

#### Issue: Keystore not found

```
Error: Keystore file not found: /path/to/keystore.jks
```

**Solution**:

1. Verify `KEYSTORE_BASE64` secret is set
2. Check keystore decoding step in workflow
3. Ensure base64 encoding was successful

#### Issue: Signing configuration failed

```
Error: Keystore password not set
```

**Solution**:

1. Verify all signing secrets are set:
   - `KEYSTORE_PASSWORD`
   - `KEY_ALIAS`
   - `KEY_PASSWORD`
2. Check for typos in secret names
3. Ensure secrets are available in workflow scope

#### Issue: Gradle build failed

```
Error: Could not resolve all dependencies
```

**Solution**:

1. Check `build.gradle` dependencies
2. Verify Java 17 is being used
3. Clear Gradle cache: `./gradlew clean`

### Test Failures

#### Issue: Instrumentation tests failing

```
Error: No connected devices!
```

**Solution**:

1. Check emulator configuration in workflow:
   ```yaml
   - name: Run instrumentation tests
     uses: reactivecircus/android-emulator-runner@v2
     with:
       api-level: 30
       target: google_apis
       arch: x86_64
   ```
2. Increase emulator boot timeout
3. Check AVD cache is working

#### Issue: Unit tests failing locally but passing in CI

**Solution**:

1. Ensure same Java version (17)
2. Check for environment-specific configurations
3. Verify test resources are committed

### Deployment Issues

#### Issue: Play Store upload failed

```
Error: Package not found: com.chainlesschain.android
```

**Solution**:

1. Verify app is created in Play Console
2. Check package name matches
3. Ensure service account has correct permissions
4. Upload first release manually to initialize

#### Issue: GitHub release creation failed

```
Error: Resource not accessible by integration
```

**Solution**:

1. Check GitHub token permissions
2. Verify `gh` is authenticated: `gh auth status`
3. Grant `repo` and `workflow` scopes

### Script Issues

#### Issue: Release script permission denied (Linux/macOS)

```bash
chmod +x android-app/scripts/release.sh
./android-app/scripts/release.sh
```

#### Issue: Git push rejected

```
Error: ! [rejected] main -> main (fetch first)
```

**Solution**:

```bash
git pull origin main --rebase
git push origin main
```

#### Issue: Tag already exists

```
Error: Tag v1.0.0 already exists
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

### Debug Tips

1. **Enable GitHub Actions debug logging**:
   - Add secrets: `ACTIONS_STEP_DEBUG=true`, `ACTIONS_RUNNER_DEBUG=true`

2. **Check workflow logs**:

   ```bash
   gh run list
   gh run view <run-id> --log
   ```

3. **Test workflow locally**:

   ```bash
   # Install act (GitHub Actions local runner)
   brew install act  # macOS

   # Run workflow locally
   act push
   ```

4. **Validate signing configuration**:

   ```bash
   cd android-app
   ./gradlew assembleRelease --info
   ```

5. **Check APK signature**:
   ```bash
   jarsigner -verify -verbose -certs app/build/outputs/apk/release/app-release.apk
   ```

## Best Practices

### Version Management

1. **Follow Semantic Versioning**:
   - MAJOR: Breaking changes (2.0.0)
   - MINOR: New features (1.1.0)
   - PATCH: Bug fixes (1.0.1)

2. **Maintain CHANGELOG.md**:
   - Document all changes
   - Link to related issues/PRs
   - Include migration guides

3. **Tag releases consistently**:
   - Always use `v` prefix: `v1.0.0`
   - Never delete published tags
   - Use annotated tags: `git tag -a v1.0.0 -m "Release 1.0.0"`

### Security

1. **Protect secrets**:
   - Never log secret values
   - Rotate credentials regularly
   - Use environment-specific secrets

2. **Code signing**:
   - Use separate keystores for debug/release
   - Keep release keystore offline when possible
   - Enable Play App Signing

3. **Dependency management**:
   - Keep dependencies up to date
   - Use Dependabot for automated updates
   - Review security advisories

### Testing

1. **Run tests before release**:
   - Unit tests: Fast feedback
   - Integration tests: Cross-component validation
   - UI tests: User flow verification

2. **Use emulator matrix**:
   - Test on multiple API levels
   - Cover min/max supported versions
   - Include different screen sizes

3. **Monitor test coverage**:
   ```bash
   ./gradlew jacocoTestReport
   open app/build/reports/jacoco/html/index.html
   ```

### Deployment

1. **Staged rollout**:
   - Start with internal track
   - Move to alpha/beta for wider testing
   - Use production staged rollout (10% → 50% → 100%)

2. **Monitor crashes**:
   - Check Play Console crash reports
   - Use Firebase Crashlytics
   - Set up alerts for crash rate spikes

3. **Release cadence**:
   - Regular releases (weekly/bi-weekly)
   - Emergency patches when needed
   - Communicate schedule to users

## Additional Resources

- [Android Developer Guide](https://developer.android.com/guide)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Google Play Console Help](https://support.google.com/googleplay/android-developer)
- [GitHub CLI Manual](https://cli.github.com/manual/)
- [Gradle User Manual](https://docs.gradle.org/current/userguide/userguide.html)

## Support

For issues or questions:

1. Check this guide's troubleshooting section
2. Review GitHub Actions workflow logs
3. Search existing GitHub issues
4. Create new issue with:
   - Error message
   - Workflow run logs
   - Steps to reproduce
   - Environment details (OS, Java version, etc.)

---

**Last Updated**: 2024-01-15
**Pipeline Version**: 1.0.0
**Maintainer**: ChainlessChain Team
