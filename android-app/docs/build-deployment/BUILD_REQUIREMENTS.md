# Android App Build Requirements

## Current Status: ⚠️ Environment Setup Required

Phase 2 (Week 3-4) authentication functionality is **code-complete** but requires Java 17 to build.

## Required Software

### ✅ Already Configured

- ✅ Gradle 8.7 (via Gradle Wrapper)
- ✅ Android Gradle Plugin 8.5.2
- ✅ Kotlin 1.9.22
- ✅ Android SDK 35 (will be downloaded on first build)

### ❌ Missing Requirements

#### Java Development Kit (JDK) 17+

**Current Version:** Java 11.0.29 (Zulu11.84+17-CA)
**Required Version:** Java 17 or higher
**Location:** `C:\Program Files\Zulu\zulu-11`

**Error Message:**

```
Android Gradle plugin requires Java 17 to run. You are currently using Java 11.
Your current JDK is located in C:\Program Files\Zulu\zulu-11
```

## Installation Instructions

### Option 1: Eclipse Temurin (Recommended)

1. **Download:** https://adoptium.net/temurin/releases/
   - Select: Java 17 (LTS)
   - OS: Windows
   - Architecture: x64
   - Package Type: JDK

2. **Install:**
   - Run installer with default settings
   - Typical location: `C:\Program Files\Eclipse Adoptium\jdk-17.x.x`

3. **Set Environment Variables:**

   ```cmd
   setx JAVA_HOME "C:\Program Files\Eclipse Adoptium\jdk-17.x.x"
   setx PATH "%JAVA_HOME%\bin;%PATH%"
   ```

4. **Verify Installation:**
   ```bash
   java -version
   # Should show: openjdk version "17.x.x"
   ```

### Option 2: Azul Zulu (Alternative)

1. **Download:** https://www.azul.com/downloads/zulu-community/
   - Java Version: 17 (LTS)
   - OS: Windows
   - Architecture: x86 64-bit

2. **Install and configure** (same steps as Option 1)

### Option 3: Gradle-Only Solution (No System-Wide Change)

If you don't want to change the system Java version, configure Gradle to use a specific JDK:

1. **Create/Edit:** `android-app/gradle.properties`
   ```properties
   org.gradle.java.home=C:\\Program Files\\Eclipse Adoptium\\jdk-17.x.x
   ```

## Verification Steps

After installing Java 17:

```bash
# 1. Verify Java version
java -version

# 2. Navigate to project
cd D:/code/chainlesschain/android-app

# 3. Clean previous builds
./gradlew clean

# 4. Run build
./gradlew build

# 5. Run tests
./gradlew test

# Expected output:
# BUILD SUCCESSFUL in Xs
```

## Build Commands Reference

### Basic Commands

```bash
# Clean build
./gradlew clean

# Build all modules
./gradlew build

# Run unit tests
./gradlew test

# Run specific module tests
./gradlew :feature-auth:test

# Build debug APK
./gradlew assembleDebug

# Install on connected device
./gradlew installDebug
```

### Development Workflow

```bash
# 1. Sync Gradle (first time or after dependency changes)
./gradlew build --dry-run

# 2. Compile main process
./gradlew compileDebugKotlin

# 3. Run tests
./gradlew test --info

# 4. Generate test reports
./gradlew test
# Reports: build/reports/tests/test/index.html
```

## Android Studio Setup

### Requirements

- **Android Studio:** Koala | 2024.1.1 or higher
- **Android SDK:** 35 (Android 15)
- **Gradle JDK:** 17+

### Configuration Steps

1. **Open Project:**
   - File → Open → Select `android-app` folder
   - Wait for Gradle sync (5-10 minutes first time)

2. **Configure JDK:**
   - File → Settings → Build, Execution, Deployment → Build Tools → Gradle
   - Gradle JDK: Select "17" or "Download JDK..."
   - Click "Apply"

3. **Sync Project:**
   - File → Sync Project with Gradle Files

4. **Run Tests:**
   - Right-click on `feature-auth/src/test` → Run 'Tests in feature-auth'

## Expected First Build Time

- **Gradle download:** 2-3 minutes (Gradle 8.7)
- **Android SDK download:** 5-10 minutes (SDK 35, build tools)
- **Dependency resolution:** 3-5 minutes (first time)
- **Compilation:** 2-3 minutes

**Total:** ~15-20 minutes (one-time setup)

## Troubleshooting

### Issue: "Gradle daemon failed to start"

**Solution:** Ensure JAVA_HOME points to JDK 17+

### Issue: "SDK location not found"

**Solution:** Create `local.properties`:

```properties
sdk.dir=C\:\\Users\\YourUsername\\AppData\\Local\\Android\\Sdk
```

### Issue: "Could not resolve dependencies"

**Solution:** Check network connection, retry:

```bash
./gradlew build --refresh-dependencies
```

### Issue: "Execution failed for task ':app:compileDebugKotlin'"

**Solution:** Clean and rebuild:

```bash
./gradlew clean build
```

## Current Project Status

| Phase              | Status           | Completion         |
| ------------------ | ---------------- | ------------------ |
| Phase 1 (Week 1-2) | ✅ Complete      | 100%               |
| Phase 2 (Week 3-4) | ✅ Code Complete | 100% (needs build) |
| Phase 3 (Week 5-6) | ⏸️ Pending       | 0%                 |

**Next Steps:**

1. Install Java 17
2. Run `./gradlew test` to verify Phase 2 tests pass
3. Proceed to Week 5-6 (Knowledge Base Management)

## Support

For build issues:

- Check `build/reports/` for error details
- Run with `--stacktrace` flag: `./gradlew build --stacktrace`
- Run with `--debug` flag: `./gradlew build --debug > build-log.txt`

---

**Last Updated:** 2026-01-19
**Author:** Phase 2 Implementation Team
