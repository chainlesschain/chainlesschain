# Android App Signing Setup Guide

Complete guide for generating keystores and configuring GitHub Secrets for automated Android app signing in CI/CD.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Generate Release Keystore](#generate-release-keystore)
3. [Configure GitHub Secrets](#configure-github-secrets)
4. [Verify Configuration](#verify-configuration)
5. [Security Best Practices](#security-best-practices)
6. [Troubleshooting](#troubleshooting)

## Prerequisites

### Required Tools

- **Java JDK** 8+ (keytool command)
- **GitHub Account** with repository access
- **Text Editor** for editing properties files

### Verify Java Installation

```bash
# Check Java version
java -version

# Check keytool availability
keytool -help
```

If `keytool` is not found, ensure Java bin directory is in your PATH.

## Generate Release Keystore

### Step 1: Create Keystore Directory

```bash
# Create secure directory for keystores
mkdir -p ~/keystores
cd ~/keystores
```

**Windows**:

```batch
mkdir %USERPROFILE%\keystores
cd %USERPROFILE%\keystores
```

### Step 2: Generate Keystore

```bash
keytool -genkey -v \
  -keystore chainlesschain-release.jks \
  -alias chainlesschain \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -storetype JKS
```

**Windows** (single line):

```batch
keytool -genkey -v -keystore chainlesschain-release.jks -alias chainlesschain -keyalg RSA -keysize 2048 -validity 10000 -storetype JKS
```

### Step 3: Enter Keystore Information

You will be prompted for:

```
Enter keystore password:  <ENTER_SECURE_PASSWORD>
Re-enter new password:    <REPEAT_SAME_PASSWORD>

What is your first and last name?
  [Unknown]:  ChainlessChain Team

What is the name of your organizational unit?
  [Unknown]:  Mobile Development

What is the name of your organization?
  [Unknown]:  ChainlessChain

What is the name of your City or Locality?
  [Unknown]:  Your City

What is the name of your State or Province?
  [Unknown]:  Your State

What is the two-letter country code for this unit?
  [Unknown]:  CN

Is CN=ChainlessChain Team, OU=Mobile Development, O=ChainlessChain,
L=Your City, ST=Your State, C=CN correct?
  [no]:  yes

Enter key password for <chainlesschain>
  (RETURN if same as keystore password):  <PRESS_ENTER or ENTER_DIFFERENT_PASSWORD>
```

**IMPORTANT**:

- Use a **strong password** (minimum 12 characters, mix of uppercase, lowercase, numbers, symbols)
- **SAVE THESE PASSWORDS** in a secure password manager
- If you lose the keystore or passwords, you cannot update your app in Play Store

### Step 4: Verify Keystore Creation

```bash
# List keystore info
keytool -list -v -keystore chainlesschain-release.jks
```

You should see output like:

```
Alias name: chainlesschain
Creation date: 2024-01-19
Entry type: PrivateKeyEntry
Certificate chain length: 1
Certificate[1]:
Owner: CN=ChainlessChain Team, OU=Mobile Development, O=ChainlessChain, ...
Issuer: CN=ChainlessChain Team, OU=Mobile Development, O=ChainlessChain, ...
Serial number: 1234567890
Valid from: Fri Jan 19 00:00:00 CST 2024 until: ...
```

### Step 5: Backup Keystore

```bash
# Create encrypted backup
cp chainlesschain-release.jks chainlesschain-release.jks.backup

# Move backup to secure cloud storage
# - Google Drive (encrypted folder)
# - Dropbox (encrypted folder)
# - 1Password / LastPass (secure notes)
# - Hardware encrypted USB drive
```

**CRITICAL**: Store at least 3 copies in different secure locations!

## Configure GitHub Secrets

### Step 1: Encode Keystore to Base64

**Linux/macOS**:

```bash
base64 -i chainlesschain-release.jks -o keystore.base64

# Or output to clipboard
# macOS:
base64 -i chainlesschain-release.jks | pbcopy

# Linux (with xclip):
base64 -i chainlesschain-release.jks | xclip -selection clipboard
```

**Windows (PowerShell)**:

```powershell
# Output to file
[Convert]::ToBase64String([IO.File]::ReadAllBytes("chainlesschain-release.jks")) | Out-File keystore.base64

# Output to clipboard
[Convert]::ToBase64String([IO.File]::ReadAllBytes("chainlesschain-release.jks")) | Set-Clipboard
```

**Windows (WSL)**:

```bash
base64 -w 0 chainlesschain-release.jks > keystore.base64
```

### Step 2: Add GitHub Secrets

1. **Navigate to Repository Settings**:
   - Go to: `https://github.com/YOUR_USERNAME/chainlesschain/settings/secrets/actions`
   - Or: Repository → Settings → Secrets and variables → Actions

2. **Add Repository Secrets** (click "New repository secret"):

| Secret Name         | Description             | Value                                       | Example             |
| ------------------- | ----------------------- | ------------------------------------------- | ------------------- |
| `KEYSTORE_BASE64`   | Base64-encoded keystore | Paste content from `keystore.base64`        | `MIIKJAIBAzCCCe...` |
| `KEYSTORE_PASSWORD` | Keystore password       | Your keystore password                      | `MySecure2024Pass!` |
| `KEY_ALIAS`         | Key alias               | `chainlesschain`                            | `chainlesschain`    |
| `KEY_PASSWORD`      | Key password            | Your key password (may be same as keystore) | `MySecure2024Pass!` |

**For each secret**:

1. Click "New repository secret"
2. Enter **Name** (e.g., `KEYSTORE_BASE64`)
3. Enter **Value** (paste the secret value)
4. Click "Add secret"

### Step 3: Verify Secrets are Added

After adding all secrets, you should see:

```
Secrets (4)
✓ KEYSTORE_BASE64          Updated now
✓ KEYSTORE_PASSWORD        Updated now
✓ KEY_ALIAS                Updated now
✓ KEY_PASSWORD             Updated now
```

**Note**: Secret values are hidden and cannot be viewed after creation.

### Step 4: Delete Temporary Files

```bash
# Delete base64 file (contains sensitive keystore data)
rm keystore.base64

# Keep original keystore in secure location only
# DO NOT commit keystore to git!
```

## Verify Configuration

### Test Locally

**Option 1: Environment Variables (Recommended)**

```bash
# Set environment variables
export KEYSTORE_FILE=~/keystores/chainlesschain-release.jks
export KEYSTORE_PASSWORD="your_keystore_password"
export KEY_ALIAS="chainlesschain"
export KEY_PASSWORD="your_key_password"

# Test build
cd android-app
./gradlew assembleRelease

# Verify APK is signed
jarsigner -verify -verbose -certs app/build/outputs/apk/release/app-release.apk
```

**Option 2: gradle.properties**

Create `~/.gradle/gradle.properties`:

```properties
KEYSTORE_FILE=/Users/you/keystores/chainlesschain-release.jks
KEYSTORE_PASSWORD=your_keystore_password
KEY_ALIAS=chainlesschain
KEY_PASSWORD=your_key_password
```

**NEVER commit this file to git!**

### Test in GitHub Actions

1. **Push a test change** to trigger workflow:

   ```bash
   cd android-app
   echo "# Test" >> README.md
   git add README.md
   git commit -m "test: trigger Android workflow"
   git push origin main
   ```

2. **Check workflow logs**:
   - Go to: Actions tab → Android CI/CD Pipeline
   - Look for "Decode keystore" step
   - Should show: ✅ Keystore decoded successfully

3. **Verify APK is signed**:
   - Download artifacts from workflow
   - Run: `jarsigner -verify app-release.apk`
   - Should show: "jar verified."

## Security Best Practices

### 1. Keystore Security

✅ **DO**:

- Generate unique keystores for each app
- Use strong passwords (12+ characters)
- Store keystores in encrypted storage
- Keep multiple backups in different locations
- Use hardware security modules (HSM) for enterprise
- Rotate keystores every 2-3 years

❌ **DON'T**:

- Commit keystores to git
- Share keystores via email/chat
- Use weak passwords ("password", "123456")
- Store keystores in cloud without encryption
- Reuse passwords across apps
- Lose your keystore (cannot recover!)

### 2. Password Management

**Recommended Tools**:

- 1Password
- LastPass
- Bitwarden
- KeePass

**Storage Format** (example for 1Password):

```
Title: ChainlessChain Android Keystore
Username: chainlesschain
Password: <keystore_password>

Notes:
Keystore File: chainlesschain-release.jks (stored in secure attachments)
Key Alias: chainlesschain
Key Password: <key_password>
Created: 2024-01-19
Validity: 10000 days (until 2051-06-06)
Location: ~/keystores/chainlesschain-release.jks
Backup: Google Drive Encrypted / USB Drive
```

### 3. GitHub Secrets Security

- ✅ Use repository secrets (not environment secrets for sensitive data)
- ✅ Limit access to repository settings
- ✅ Enable 2FA for GitHub account
- ✅ Audit secret access regularly
- ✅ Rotate secrets periodically (every 6-12 months)
- ❌ Never print secret values in logs
- ❌ Don't share secrets across multiple repos unnecessarily

### 4. CI/CD Security

**In your workflow**:

- Keystore is decoded to a temporary file
- Keystore is automatically deleted after build
- Secret values are never printed to logs

**Additional hardening**:

```yaml
# In .github/workflows/release.yml
- name: Clean up keystore
  if: always() # Runs even if build fails
  run: |
    rm -f android-app/keystore.jks
    rm -f android-app/*.jks
```

## Troubleshooting

### Issue 1: Keystore not found

**Error**:

```
Error: Keystore file not found: keystore.jks
```

**Solutions**:

1. Verify `KEYSTORE_BASE64` secret is set correctly
2. Check base64 encoding is complete (no truncation)
3. Verify decode step in workflow ran successfully

**Debug**:

```yaml
- name: Debug keystore
  run: |
    ls -la android-app/*.jks || echo "No keystore files found"
    file android-app/keystore.jks || echo "Keystore file check failed"
```

### Issue 2: Wrong password

**Error**:

```
Error: Keystore was tampered with, or password was incorrect
```

**Solutions**:

1. Verify `KEYSTORE_PASSWORD` matches the password used during generation
2. Check for trailing spaces in password
3. Ensure password is not URL-encoded or escaped

**Test locally**:

```bash
# Try to list keystore with your password
keytool -list -keystore chainlesschain-release.jks -storepass "your_password"
```

### Issue 3: Key alias not found

**Error**:

```
Error: Key alias 'chainlesschain' not found
```

**Solutions**:

1. Verify `KEY_ALIAS` matches the alias used during generation
2. List aliases in keystore:
   ```bash
   keytool -list -keystore chainlesschain-release.jks
   ```

### Issue 4: APK not signed

**Error**:

```
jarsigner: unable to sign jar: java.util.zip.ZipException: invalid entry compressed size
```

**Solutions**:

1. Ensure signing configuration is in `app/build.gradle.kts`
2. Verify all secrets are set
3. Check Gradle build logs for signing errors

**Verify signing**:

```bash
# Check if APK is signed
jarsigner -verify -verbose app-release.apk

# Should show:
# jar verified.
```

### Issue 5: Expired certificate

**Error**:

```
Error: Certificate expired
```

**Solutions**:

1. Generate new keystore with longer validity
2. For existing apps, use the same keystore (cannot change)
3. For new apps, generate keystore with 10000 days validity

**Check certificate expiry**:

```bash
keytool -list -v -keystore chainlesschain-release.jks | grep Valid
```

## Advanced Configuration

### Play App Signing

Google Play offers **Play App Signing** which:

- Google manages the upload key
- Provides additional security
- Allows key reset if lost

**Setup**:

1. Enroll in Play App Signing (recommended)
2. Upload your upload key (different from signing key)
3. Google signs APKs with the app signing key

**Benefits**:

- Key recovery if upload key is lost
- Smaller APK size
- Support for latest signing schemes

### Multiple Build Variants

**debug.keystore** (auto-generated by Android SDK):

```
Location: ~/.android/debug.keystore
Password: android
Alias: androiddebugkey
Key Password: android
```

**Custom keystores per variant**:

```kotlin
// app/build.gradle.kts
android {
    signingConfigs {
        debug {
            storeFile file("debug.keystore")
            storePassword "android"
            keyAlias "androiddebugkey"
            keyPassword "android"
        }

        release {
            // From environment/GitHub Secrets
            storeFile file(System.getenv("KEYSTORE_FILE") ?: "keystore.jks")
            storePassword System.getenv("KEYSTORE_PASSWORD")
            keyAlias System.getenv("KEY_ALIAS")
            keyPassword System.getenv("KEY_PASSWORD")
        }

        staging {
            // Separate staging keystore
            storeFile file(System.getenv("STAGING_KEYSTORE_FILE") ?: "staging.jks")
            // ...
        }
    }
}
```

## References

- [Android App Signing](https://developer.android.com/studio/publish/app-signing)
- [keytool Documentation](https://docs.oracle.com/javase/8/docs/technotes/tools/unix/keytool.html)
- [GitHub Encrypted Secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [Play App Signing](https://support.google.com/googleplay/android-developer/answer/9842756)

## Quick Reference

### Generate Keystore (One Command)

```bash
keytool -genkey -v -keystore chainlesschain-release.jks -alias chainlesschain -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=ChainlessChain Team, OU=Mobile, O=ChainlessChain, L=YourCity, ST=YourState, C=CN" -storepass YOUR_PASSWORD -keypass YOUR_PASSWORD
```

### Verify Keystore

```bash
keytool -list -v -keystore chainlesschain-release.jks -storepass YOUR_PASSWORD
```

### Base64 Encode

```bash
# Linux/macOS
base64 -i chainlesschain-release.jks -o keystore.base64

# Windows
[Convert]::ToBase64String([IO.File]::ReadAllBytes("chainlesschain-release.jks"))
```

### Test Signing

```bash
cd android-app
KEYSTORE_FILE=~/keystores/chainlesschain-release.jks \
KEYSTORE_PASSWORD=your_pass \
KEY_ALIAS=chainlesschain \
KEY_PASSWORD=your_pass \
./gradlew assembleRelease
```

### Verify APK Signature

```bash
jarsigner -verify -verbose -certs app/build/outputs/apk/release/app-release.apk
```

---

**Document Version**: 1.0.0
**Last Updated**: 2024-01-19
**Status**: ✅ Production Ready
**Maintainer**: ChainlessChain Team

## Next Steps

1. ✅ Generate release keystore
2. ✅ Configure GitHub Secrets
3. ✅ Test local build with keystore
4. ⏭️ Test GitHub Actions workflow
5. ⏭️ Set up Play App Signing (recommended)
6. ⏭️ Create release with signed APK
