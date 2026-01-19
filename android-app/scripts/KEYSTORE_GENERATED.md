# Test Keystore Generated Successfully ✅

## Keystore Information

**File**: `chainlesschain-test.jks`
**Created**: 2026-01-19
**Validity**: Until 2053-06-06 (~27 years)

### Credentials (TEST ONLY)

```
Keystore Password: chainlesschain2024
Key Alias: chainlesschain
Key Password: chainlesschain2024
```

**⚠️ WARNING**: These are TEST credentials with a weak password.
**For PRODUCTION**, generate a secure keystore using `generate_keystore.bat` or `generate_keystore.sh`.

## Certificate Details

```
Owner: CN=ChainlessChain Test, OU=Development, O=ChainlessChain, L=Beijing, ST=Beijing, C=CN
Serial: 55c070e9
Valid from: 2026-01-19
Valid until: 2053-06-06
Fingerprint (SHA256): 57:29:7C:CC:B2:5F:55:0C:F6:88:1A:DC:9F:6F:F1:04:A1:9A:36:C0:AD:44:ED:F1:5F:BF:E4:22:5D:6B:DA:4C
```

## Next Steps: Configure GitHub Secrets

### Step 1: Get Base64 Content

The keystore has been encoded to Base64 in: `keystore-test.base64`

**Copy the content**:

```bash
# Windows (PowerShell)
Get-Content keystore-test.base64 | Set-Clipboard

# Linux/macOS
cat keystore-test.base64 | pbcopy  # macOS
cat keystore-test.base64 | xclip   # Linux
```

### Step 2: Add GitHub Secrets

1. **Go to**: https://github.com/YOUR_USERNAME/chainlesschain/settings/secrets/actions

2. **Add these 4 secrets** (click "New repository secret" for each):

| Secret Name         | Value                                   | Notes               |
| ------------------- | --------------------------------------- | ------------------- |
| `KEYSTORE_BASE64`   | (paste content of keystore-test.base64) | ~3KB of Base64 text |
| `KEYSTORE_PASSWORD` | `chainlesschain2024`                    | Keystore password   |
| `KEY_ALIAS`         | `chainlesschain`                        | Key alias name      |
| `KEY_PASSWORD`      | `chainlesschain2024`                    | Key password        |

### Step 3: Verify Secrets Added

After adding all secrets, you should see in GitHub:

```
Secrets (4)
✓ KEYSTORE_BASE64          Updated now
✓ KEYSTORE_PASSWORD        Updated now
✓ KEY_ALIAS                Updated now
✓ KEY_PASSWORD             Updated now
```

### Step 4: Test with GitHub Actions

**Option A: Push to trigger Android workflow**

```bash
cd android-app
echo "# Test $(date)" >> README.md
git add README.md
git commit -m "test: trigger Android CI/CD"
git push origin main
```

**Option B: Create test tag (triggers full release workflow)**

```bash
git tag v0.20.0-test1
git push origin v0.20.0-test1
```

## Verification

### Check APK Signature Locally

If you build locally with this keystore:

```bash
# Set environment variables
set KEYSTORE_FILE=android-app\scripts\chainlesschain-test.jks
set KEYSTORE_PASSWORD=chainlesschain2024
set KEY_ALIAS=chainlesschain
set KEY_PASSWORD=chainlesschain2024

# Build
cd android-app
gradlew assembleRelease

# Verify signature
jarsigner -verify -verbose app\build\outputs\apk\release\app-release.apk
```

Expected output:

```
jar verified.
```

### Check Certificate Details

```bash
jarsigner -verify -verbose -certs app-release.apk | findstr "CN="
```

Expected:

```
CN=ChainlessChain Test, OU=Development, O=ChainlessChain, L=Beijing, ST=Beijing, C=CN
```

## Files Generated

```
android-app/scripts/
├── chainlesschain-test.jks       # Keystore file (2.3KB)
├── keystore-test.base64          # Base64 encoded (for GitHub Secrets)
├── generate_keystore.bat         # Production keystore generator (Windows)
├── generate_keystore.sh          # Production keystore generator (Linux/Mac)
├── generate_test_keystore.bat   # This test keystore generator
└── KEYSTORE_GENERATED.md         # This file
```

## Security Notes

### ✅ Safe for Testing

This test keystore is safe for:

- CI/CD workflow testing
- Development builds
- Internal testing
- Learning and experimentation

### ❌ NOT Safe for Production

Do NOT use this keystore for:

- Production releases
- Google Play Store uploads
- Public distribution
- Long-term app maintenance

**Why?**

- Weak password: "chainlesschain2024" can be easily guessed
- Publicly known: Anyone can see these credentials
- No recovery: If compromised, cannot update app in Play Store

### For Production Release

Generate a secure keystore with:

**Windows**:

```bash
cd android-app\scripts
generate_keystore.bat
```

**Linux/macOS**:

```bash
cd android-app/scripts
./generate_keystore.sh
```

Use:

- Strong password (16+ characters, mixed case, numbers, symbols)
- Unique password (not used anywhere else)
- Secure storage (password manager, encrypted backup)

## Troubleshooting

### Issue: GitHub Actions build fails with "Keystore not found"

**Check**:

1. Verify `KEYSTORE_BASE64` secret is set
2. Check secret name exactly matches: `KEYSTORE_BASE64` (case-sensitive)
3. Verify Base64 content is complete (no truncation)

### Issue: Build fails with "Wrong password"

**Check**:

1. Verify `KEYSTORE_PASSWORD` = `chainlesschain2024`
2. Check for trailing spaces in secret
3. Ensure secret is not URL-encoded

### Issue: APK installed but shows security warning

**Expected**: Android may show warning because:

- Test certificate (not from trusted CA)
- Unknown source (not from Play Store)
- This is normal for test builds

**Solution**: Enable "Install unknown apps" for testing

## Migration to Production

When ready for production release:

1. **Generate production keystore**:

   ```bash
   generate_keystore.bat  # or .sh on Linux/Mac
   ```

2. **Update GitHub Secrets**:
   - Replace `KEYSTORE_BASE64` with production keystore
   - Replace passwords with production passwords

3. **Backup production keystore**:
   - Password manager (1Password, LastPass)
   - Encrypted cloud storage
   - Hardware encrypted USB
   - **Multiple secure locations!**

4. **Never commit keystore to git**:
   ```bash
   # Verify .gitignore includes
   *.jks
   *.keystore
   keystore.base64
   ```

## Support

For detailed guides, see:

- `android-app/docs/ANDROID_SIGNING_SETUP.md` - Complete signing guide
- `android-app/docs/RELEASE_TESTING_GUIDE.md` - Testing workflow
- `android-app/docs/GOOGLE_PLAY_SETUP.md` - Play Store deployment

---

**Generated**: 2026-01-19
**Keystore Type**: JKS (Test)
**Purpose**: CI/CD Testing Only
**Status**: ✅ Ready for testing
