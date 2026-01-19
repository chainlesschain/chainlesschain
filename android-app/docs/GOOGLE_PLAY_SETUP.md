# Google Play Console Setup Guide

Complete guide for setting up Google Play Console and automating APK/AAB uploads via GitHub Actions.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Google Play Console Setup](#google-play-console-setup)
3. [Create Service Account](#create-service-account)
4. [Configure API Access](#configure-api-access)
5. [Add GitHub Secret](#add-github-secret)
6. [Configure Workflow](#configure-workflow)
7. [Testing](#testing)
8. [Troubleshooting](#troubleshooting)

## Prerequisites

### Required

- ✓ Google Play Developer Account ($25 one-time fee)
- ✓ App created in Play Console
- ✓ First release published manually (required to enable API access)
- ✓ Signed AAB/APK ready
- ✓ GitHub repository with admin access

### Optional

- Google Cloud Console access
- Understanding of service accounts
- Basic knowledge of OAuth 2.0

## Google Play Console Setup

### Step 1: Create Google Play Developer Account

1. **Visit**: https://play.google.com/console/signup
2. **Pay**: $25 one-time registration fee
3. **Complete**: Developer profile
4. **Accept**: Developer Distribution Agreement

**Note**: This step only needs to be done once per organization.

### Step 2: Create App in Play Console

1. **Navigate to**: https://play.google.com/console
2. **Click**: "Create app"
3. **Fill in details**:
   - **App name**: ChainlessChain
   - **Default language**: English (US) or your preference
   - **App or game**: App
   - **Free or paid**: Free (or Paid)
4. **Declarations**:
   - ✓ Follow Play policies
   - ✓ Export laws compliance
5. **Click**: "Create app"

### Step 3: Complete Store Listing

Before API access is available, complete minimum requirements:

**Required sections**:

1. **App content** → Content ratings
2. **App content** → Target audience
3. **App content** → Privacy policy
4. **Store presence** → Main store listing
5. **Store presence** → Store settings

**Main store listing**:

- App name: ChainlessChain
- Short description: (50 characters max)
- Full description: (4000 characters max)
- Screenshots: At least 2 (required)
- App icon: 512x512 px
- Feature graphic: 1024x500 px

### Step 4: Create First Release Manually

**Why**: Play Console API only works after first release is created manually.

1. **Navigate to**: Production → Create new release
2. **Upload**: Signed AAB (app-release.aab)
3. **Release name**: ChainlessChain 1.0.0
4. **Release notes**: Initial release
5. **Review**: Release summary
6. **Save**: (Don't publish yet, save as draft)

**Note**: You don't need to publish, just save as draft. This enables API access.

## Create Service Account

### Step 1: Access Google Cloud Console

1. **Navigate to**: https://console.cloud.google.com/
2. **Sign in**: With same account as Play Console
3. **Select project**: (or create new project for Play Console)

**If no project exists**:

- Click: "Select a project" → "New Project"
- Name: "ChainlessChain Play Console API"
- Click: "Create"

### Step 2: Enable Google Play Developer API

1. **Navigate to**: APIs & Services → Library
2. **Search**: "Google Play Android Developer API"
3. **Click**: Google Play Android Developer API
4. **Click**: "Enable"

**Wait**: 1-2 minutes for API to be enabled

### Step 3: Create Service Account

1. **Navigate to**: IAM & Admin → Service Accounts
2. **Click**: "Create Service Account"
3. **Service account details**:
   - **Name**: `chainlesschain-github-actions`
   - **Description**: `Service account for GitHub Actions CI/CD`
4. **Click**: "Create and Continue"
5. **Grant access** (optional step):
   - **Role**: None needed for Play Console
   - **Click**: "Continue"
6. **Grant users access** (optional step):
   - Skip (not needed)
   - **Click**: "Done"

### Step 4: Create Service Account Key

1. **Find**: Your service account in list
2. **Click**: Email address (chainlesschain-github-actions@...)
3. **Navigate to**: Keys tab
4. **Click**: "Add Key" → "Create new key"
5. **Key type**: JSON
6. **Click**: "Create"

**Download**: JSON file will download automatically (e.g., `chainlesschain-play-console-api-xxxxx.json`)

**⚠️ SECURITY WARNING**:

- This file contains private credentials
- Store securely (password manager)
- Never commit to git
- Delete local copy after adding to GitHub Secrets

### Step 5: Note Service Account Email

From the JSON file or console, note the service account email:

```
chainlesschain-github-actions@PROJECT_ID.iam.gserviceaccount.com
```

You'll need this for Play Console access configuration.

## Configure API Access

### Step 1: Grant Play Console Access

1. **Navigate to**: https://play.google.com/console
2. **Go to**: Settings (gear icon) → Users and permissions
3. **Click**: "Invite new users"
4. **Email address**: Paste service account email
   ```
   chainlesschain-github-actions@PROJECT_ID.iam.gserviceaccount.com
   ```
5. **App permissions**:
   - **Select app**: ChainlessChain
   - **Permissions**: (check all that apply)
     - ✓ View app information
     - ✓ Manage production releases
     - ✓ Manage testing track releases
     - ✓ Release to production, exclude devices, and use Play App Signing

**Recommended permissions**:

```
App access level:
  ✓ View app information and download bulk reports

Release management:
  ✓ Manage production releases
  ✓ Manage testing track releases
  ✓ Release to production, exclude devices, and use Play App Signing

Store presence:
  (Optional) ✓ Edit store listing, pricing & distribution

Financial data:
  (Optional) View financial data, orders, and cancellation survey responses
```

6. **Account permissions**: None needed
7. **Click**: "Invite user"
8. **Status**: Service account is now linked (no email verification needed)

### Step 2: Verify API Access

Test the service account has access:

```bash
# Using Google Play Developer API (requires access token)
# This is handled automatically by GitHub Actions workflow
```

**Manual verification** (optional):

- Install Google Play Developer Publishing API client library
- Test authentication with service account JSON
- Attempt to list apps

## Add GitHub Secret

### Step 1: Prepare Service Account JSON

Open the downloaded JSON file:

```json
{
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "xxxxx",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "chainlesschain-github-actions@your-project-id.iam.gserviceaccount.com",
  "client_id": "xxxxx",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/..."
}
```

### Step 2: Copy JSON Content

```bash
# Copy entire JSON content
cat chainlesschain-play-console-api-xxxxx.json | pbcopy  # macOS
cat chainlesschain-play-console-api-xxxxx.json | xclip   # Linux
```

**Windows**:

- Open file in text editor
- Select all (Ctrl+A)
- Copy (Ctrl+C)

### Step 3: Add to GitHub Secrets

1. **Navigate to**: https://github.com/YOUR_USERNAME/chainlesschain/settings/secrets/actions
2. **Click**: "New repository secret"
3. **Name**: `PLAY_STORE_SERVICE_ACCOUNT`
4. **Value**: Paste entire JSON content
5. **Click**: "Add secret"

### Step 4: Verify Secret Added

You should see:

```
Secrets (5)
✓ KEYSTORE_BASE64
✓ KEYSTORE_PASSWORD
✓ KEY_ALIAS
✓ KEY_PASSWORD
✓ PLAY_STORE_SERVICE_ACCOUNT
```

### Step 5: Delete Local JSON File

```bash
# Securely delete the JSON file
rm chainlesschain-play-console-api-xxxxx.json

# Or on Windows
del chainlesschain-play-console-api-xxxxx.json

# Clear clipboard
pbcopy < /dev/null  # macOS
```

**Store backup**: Keep encrypted copy in password manager (e.g., 1Password secure notes).

## Configure Workflow

### Current Configuration

The workflow is already configured in `.github/workflows/release.yml`:

```yaml
- name: Deploy to Play Store
  uses: r0adkll/upload-google-play@v1
  with:
    serviceAccountJsonPlainText: ${{ secrets.PLAY_STORE_SERVICE_ACCOUNT }}
    packageName: com.chainlesschain.android
    releaseFiles: android-app/app/build/outputs/bundle/release/*.aab
    track: internal # Change this!
    status: completed
```

### Deployment Tracks

Choose appropriate track for your release:

| Track        | Purpose          | Audience                   | Rollback  |
| ------------ | ---------------- | -------------------------- | --------- |
| `internal`   | Internal testing | Up to 100 internal testers | Easy      |
| `alpha`      | Closed testing   | Invited testers only       | Easy      |
| `beta`       | Open testing     | Anyone with link           | Easy      |
| `production` | Public release   | All users                  | Difficult |

### Recommended Configuration

**For automated releases** (modify `.github/workflows/release.yml`):

```yaml
- name: Deploy to Play Store
  uses: r0adkll/upload-google-play@v1
  with:
    serviceAccountJsonPlainText: ${{ secrets.PLAY_STORE_SERVICE_ACCOUNT }}
    packageName: com.chainlesschain.android
    releaseFiles: android-app/app/build/outputs/bundle/release/*.aab
    track: internal # Start with internal
    status: completed # Or 'draft' for manual review
    inAppUpdatePriority: 2 # 0-5, higher = more urgent
    userFraction: 1.0 # 1.0 = 100% of track users
    whatsNewDirectory: android-app/whatsnew/ # Optional: release notes
```

### Release Notes (Optional)

Create release notes directory:

```bash
mkdir -p android-app/whatsnew
```

Create release notes files (by language):

```bash
# English
echo "- First release" > android-app/whatsnew/whatsnew-en-US

# Chinese
echo "- 首次发布" > android-app/whatsnew/whatsnew-zh-CN
```

**Commit**:

```bash
git add android-app/whatsnew/
git commit -m "docs: add Play Store release notes"
```

### Staged Rollout Configuration

For production releases with staged rollout:

```yaml
- name: Deploy to Play Store (Staged)
  uses: r0adkll/upload-google-play@v1
  with:
    serviceAccountJsonPlainText: ${{ secrets.PLAY_STORE_SERVICE_ACCOUNT }}
    packageName: com.chainlesschain.android
    releaseFiles: android-app/app/build/outputs/bundle/release/*.aab
    track: production
    status: inProgress # Requires manual completion
    inAppUpdatePriority: 3
    userFraction: 0.1 # Start with 10% of users
    whatsNewDirectory: android-app/whatsnew/
```

**To increase rollout**:

- Go to Play Console → Production → Manage release
- Click "Update rollout"
- Increase percentage: 10% → 20% → 50% → 100%

## Testing

### Test 1: Internal Track Deployment

```bash
# Create release tag
git tag v0.20.0-internal
git push origin v0.20.0-internal
```

**Monitor workflow**:

```bash
gh run watch
```

**Verify in Play Console**:

1. Navigate to: Testing → Internal testing
2. Check: Latest release shows v0.20.0-internal
3. Download: APK from internal testing track
4. Install: On test device

### Test 2: Manual Testing Track

**Internal testers setup**:

1. **Navigate to**: Testing → Internal testing → Testers
2. **Click**: "Create email list"
3. **Add emails**: Your team members
4. **Save**: Email list

**Share testing link**:

1. **Copy link**: Internal testing opt-in URL
2. **Send to**: Internal testers
3. **Testers**: Click link → Opt in → Download from Play Store

### Test 3: Alpha/Beta Track

**Promote from internal**:

1. **Navigate to**: Testing → Internal testing
2. **Select**: Release to promote
3. **Click**: "Promote release"
4. **Select track**: Alpha or Beta
5. **Review**: Release details
6. **Click**: "Start rollout to Alpha/Beta"

## Troubleshooting

### Issue 1: API access denied

**Error**:

```
Error: The caller does not have permission
```

**Solutions**:

1. Verify service account email is correct
2. Check Play Console permissions:
   - Settings → Users and permissions
   - Service account should be listed
   - Permissions should include "Manage production releases"
3. Wait 10-15 minutes after granting permissions
4. Verify API is enabled in Google Cloud Console

### Issue 2: App not found

**Error**:

```
Error: Package name not found: com.chainlesschain.android
```

**Solutions**:

1. Verify package name matches AndroidManifest.xml:
   ```xml
   <manifest package="com.chainlesschain.android">
   ```
2. Verify app exists in Play Console
3. Verify first release was created (even as draft)

### Issue 3: Invalid AAB

**Error**:

```
Error: Invalid Android App Bundle
```

**Solutions**:

1. Verify AAB is signed correctly:
   ```bash
   jarsigner -verify app-release.aab
   ```
2. Check version code is incremented
3. Verify minSdkVersion, targetSdkVersion are valid
4. Test AAB locally with bundletool

### Issue 4: Version conflict

**Error**:

```
Error: Version code 1 has already been used
```

**Solutions**:

1. Increment VERSION_CODE in version.properties
2. Never reuse version codes
3. Each release must have unique version code

### Issue 5: Service account JSON invalid

**Error**:

```
Error: Could not authenticate service account
```

**Solutions**:

1. Verify JSON is complete (starts with `{`, ends with `}`)
2. Check for formatting issues (newlines in private_key are OK)
3. Regenerate service account key if corrupted
4. Verify secret name matches workflow: `PLAY_STORE_SERVICE_ACCOUNT`

## Best Practices

### Release Strategy

**Recommended workflow**:

1. **Internal** → Test with 10-20 internal testers (1-2 days)
2. **Alpha** → Test with 100-500 early adopters (3-5 days)
3. **Beta** → Open testing with 1000+ users (1-2 weeks)
4. **Production** → Staged rollout:
   - Day 1: 10% of users
   - Day 3: 20% of users
   - Day 7: 50% of users
   - Day 14: 100% of users

### Monitoring

After each release:

- Monitor crash reports (first 24-48 hours)
- Check ANR (Application Not Responding) rate
- Review user feedback
- Watch for spike in uninstalls

**In Play Console**:

- Vitals → Crashes and ANRs
- Quality → Pre-launch report
- User feedback → Ratings and reviews

### Automation Tips

1. **Use internal track for CI/CD**: Automatic deployment to internal track, manual promotion to production
2. **Version code automation**: Auto-increment in CI/CD
3. **Release notes**: Generate from git commits
4. **Rollback plan**: Keep previous APK ready

## References

- [Google Play Console](https://play.google.com/console)
- [Play Console API](https://developers.google.com/android-publisher)
- [Service Accounts](https://cloud.google.com/iam/docs/service-accounts)
- [upload-google-play Action](https://github.com/r0adkll/upload-google-play)
- [Play Developer API](https://developers.google.com/android-publisher/api-ref)

## Quick Reference

### Create Service Account

```
1. https://console.cloud.google.com/
2. APIs & Services → Enable "Google Play Android Developer API"
3. IAM & Admin → Service Accounts → Create Service Account
4. Create Key (JSON)
5. Copy service account email
```

### Grant Play Console Access

```
1. https://play.google.com/console
2. Settings → Users and permissions → Invite new users
3. Paste service account email
4. Grant permissions: View app + Manage releases
5. Invite
```

### Add to GitHub

```
1. Repository → Settings → Secrets → New repository secret
2. Name: PLAY_STORE_SERVICE_ACCOUNT
3. Value: <paste entire JSON>
4. Add secret
```

### Deploy to Internal Track

```yaml
track: internal
status: completed
```

### Deploy to Production (Staged)

```yaml
track: production
status: inProgress
userFraction: 0.1
```

---

**Document Version**: 1.0.0
**Last Updated**: 2024-01-19
**Status**: ✅ Production Ready
**Maintainer**: ChainlessChain Team

## Next Steps

1. ⏭️ Pay $25 for Google Play Developer Account
2. ⏭️ Create app in Play Console
3. ⏭️ Complete store listing
4. ⏭️ Create service account
5. ⏭️ Add GitHub Secret
6. ⏭️ Test internal track deployment
7. ⏭️ Plan production release strategy
