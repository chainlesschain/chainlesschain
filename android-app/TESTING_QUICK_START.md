# ChainlessChain Android Testing - Quick Start Guide

**For**: Developers, QA Engineers, New Team Members
**Purpose**: Get started with testing in 5 minutes
**Last Updated**: 2026-01-28

---

## 🚀 Quick Start (5 Minutes)

### 1. Run All Tests

```bash
cd android-app

# Run all unit tests (fastest, ~20 seconds)
./gradlew test --no-daemon

# Run specific module tests
./gradlew :core-e2ee:testDebugUnitTest
./gradlew :core-database:testDebugUnitTest
```

**Expected Result**: ✅ 168/168 tests passing

### 2. Run Tests with Coverage

```bash
# Generate coverage report
./gradlew test jacocoTestReport

# Open coverage report in browser
# Windows: start app/build/reports/jacoco/jacocoTestReport/html/index.html
# Mac: open app/build/reports/jacoco/jacocoTestReport/html/index.html
# Linux: xdg-open app/build/reports/jacoco/jacocoTestReport/html/index.html
```

**Expected Result**: Coverage report showing 87% coverage

### 3. Run Instrumented Tests (requires emulator/device)

```bash
# Start an emulator first
emulator -avd Pixel_5_API_30 &

# Run integration tests
./gradlew :core-e2ee:connectedAndroidTest --tests "*E2EEIntegrationTest*"
./gradlew :feature-ai:connectedAndroidTest --tests "*AI_RAG_IntegrationTest*"

# Run UI tests
./gradlew :feature-knowledge:connectedAndroidTest --tests "*KnowledgeUITest*"
./gradlew :feature-ai:connectedAndroidTest --tests "*AIConversationUITest*"
```

**Expected Result**: ✅ 101+ instrumented tests passing

---

## 📁 Project Structure

```
android-app/
├── core-e2ee/
│   ├── src/test/java/               # Unit tests
│   │   ├── protocol/
│   │   │   ├── DoubleRatchetTest.kt      (22 tests)
│   │   │   └── X3DHKeyExchangeTest.kt    (16 tests)
│   │   └── test/E2EETestFactory.kt
│   └── src/androidTest/java/       # Integration tests
│       └── E2EEIntegrationTest.kt        (11 tests)
│
├── core-network/
│   └── src/test/java/
│       └── LinkPreviewFetcherTest.kt     (19 tests)
│
├── core-database/
│   └── src/test/java/dao/          # DAO tests
│       ├── ConversationDaoTest.kt        (17 tests)
│       ├── FileTransferDaoTest.kt        (23 tests)
│       ├── KnowledgeItemDaoTest.kt       (19 tests)
│       ├── OfflineQueueDaoTest.kt        (16 tests)
│       ├── P2PMessageDaoTest.kt          (13 tests)
│       └── ProjectDaoTest.kt             (23 tests)
│
├── feature-ai/
│   ├── src/test/java/               # Unit tests
│   ├── src/androidTest/java/
│   │   ├── integration/
│   │   │   └── AI_RAG_IntegrationTest.kt (7 tests)
│   │   ├── ui/
│   │   │   └── AIConversationUITest.kt   (9 tests)
│   │   └── e2e/
│   │       └── AIConversationE2ETest.kt  (5+ tests)
│
├── feature-knowledge/
│   └── src/androidTest/java/ui/
│       └── KnowledgeUITest.kt            (8 tests)
│
└── feature-p2p/
    └── src/androidTest/java/
        ├── P2PIntegrationTest.kt         (10 tests)
        ├── ui/
        │   ├── P2PUITest.kt              (3 tests)
        │   ├── SocialPostUITest.kt       (7 tests)
        │   └── EditHistoryDialogTest.kt  (5 tests)
        └── e2e/
            ├── SocialE2ETest.kt          (8+ tests)
            └── SocialEnhancementE2ETest.kt (7+ tests)
```

---

## 🧪 Test Types & When to Use

### 1. Unit Tests (src/test/)

**When**: Testing individual functions/classes in isolation

**Example**:

```kotlin
@Test
fun `encrypt creates valid ciphertext`() {
    val plaintext = "Hello World".toByteArray()
    val ciphertext = encrypt(plaintext, key)
    assertNotNull(ciphertext)
    assertTrue(ciphertext.size > plaintext.size) // includes IV
}
```

**Run**: `./gradlew :module:testDebugUnitTest`

### 2. Integration Tests (src/androidTest/)

**When**: Testing multiple components working together

**Example**:

```kotlin
@Test
fun testCompleteE2EEWorkflow() = runBlocking {
    // Alice generates keys
    val aliceKeys = keyManager.generateKeys()

    // Bob uses keys to create session
    val session = sessionManager.createSession(aliceKeys)

    // Send encrypted message
    val encrypted = session.encrypt("Hello")

    // Verify decryption
    val decrypted = session.decrypt(encrypted)
    assertEquals("Hello", decrypted)
}
```

**Run**: `./gradlew :module:connectedAndroidTest` (needs device)

### 3. UI Tests (src/androidTest/ui/)

**When**: Testing Compose UI components

**Example**:

```kotlin
@Test
fun messageList_displaysUserMessages() {
    composeTestRule.setContent {
        MessageList(messages = testMessages)
    }

    composeTestRule.onNodeWithText("Hello AI").assertIsDisplayed()
}
```

**Run**: `./gradlew :module:connectedAndroidTest --tests "*UITest*"`

### 4. E2E Tests (src/androidTest/e2e/)

**When**: Testing complete user journeys

**Example**:

```kotlin
@Test
fun testCompleteAIConversationFlow() {
    // Navigate to AI module
    clickOnText("AI助手")

    // Create new conversation
    clickOnText("新建对话")

    // Send message
    typeTextInField("输入消息", "What is Kotlin?")
    clickOnText("发送")

    // Verify response appears
    waitForText("Kotlin is", timeoutMillis = 10000)
}
```

**Run**: `./gradlew :module:connectedAndroidTest --tests "*E2ETest*"`

---

## 🛠️ Common Commands

### Running Tests

```bash
# All unit tests
./gradlew test

# Specific module
./gradlew :core-e2ee:test

# Specific test class
./gradlew :core-e2ee:test --tests "*DoubleRatchetTest"

# Specific test method
./gradlew :core-e2ee:test --tests "*DoubleRatchetTest.encrypt*"

# All instrumented tests (requires device)
./gradlew connectedAndroidTest

# Parallel execution (faster)
./gradlew test --parallel
```

### Coverage Reports

```bash
# Generate Jacoco report
./gradlew jacocoTestReport

# Check coverage thresholds
./gradlew jacocoTestCoverageVerification

# View report
open app/build/reports/jacoco/jacocoTestReport/html/index.html
```

### Using Test Scripts

```bash
# Run all tests with nice output
./run-all-tests.sh          # Linux/Mac
run-all-tests.bat           # Windows

# Run specific type
./run-all-tests.sh unit
./run-all-tests.sh integration
./run-all-tests.sh ui
./run-all-tests.sh e2e
```

---

## 🔧 Setup Pre-commit Hooks

Automatically run tests before each commit:

```bash
# Configure Git to use custom hooks
git config core.hooksPath .githooks

# Make hook executable (Linux/Mac)
chmod +x .githooks/pre-commit

# Test the hook
git add .
git commit -m "test commit"
# Will run tests for changed modules
```

---

## 📊 Understanding Test Results

### Successful Run

```
> Task :core-e2ee:testDebugUnitTest

DoubleRatchetTest > encrypt creates valid ciphertext PASSED
DoubleRatchetTest > decrypt produces original plaintext PASSED
...

BUILD SUCCESSFUL in 8s
22 tests passed
```

### Failed Test

```
> Task :core-e2ee:testDebugUnitTest FAILED

DoubleRatchetTest > encrypt creates valid ciphertext FAILED
    Expected: not null
    Actual: null
    at DoubleRatchetTest.kt:45

1 test failed, 21 tests passed

BUILD FAILED in 9s
```

**Action**: Fix the failing test before committing

---

## 🐛 Troubleshooting

### Problem: Tests Fail Locally But Pass on CI

**Possible Causes**:

- Different JDK version (must be JDK 17)
- Cached build artifacts
- Timezone differences

**Solution**:

```bash
# Clean and rebuild
./gradlew clean test

# Check JDK version
java -version  # Should be 17.x.x

# Clear Gradle cache
rm -rf ~/.gradle/caches/
```

### Problem: Instrumented Tests Can't Find Device

**Solution**:

```bash
# Check connected devices
adb devices

# If no devices, start emulator
emulator -avd Pixel_5_API_30 &

# Wait for emulator to boot
adb wait-for-device
```

### Problem: Out of Memory Error

**Solution**:

```bash
# Increase Gradle memory in gradle.properties
org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=512m

# Or set environment variable
export GRADLE_OPTS="-Xmx4096m"
```

### Problem: Tests Are Slow

**Solution**:

```bash
# Run in parallel
./gradlew test --parallel --max-workers=4

# Run only changed tests (not implemented yet, but recommended)
./gradlew test --rerun-tasks=false
```

---

## 📚 Learning Resources

### Documentation

1. **TEST_WRITING_GUIDE.md** - How to write good tests
2. **ANDROID_TESTS_COMPLETE_REPORT.md** - Comprehensive test documentation
3. **CI_CD_SETUP_COMPLETE.md** - CI/CD pipeline details

### Example Tests

- **Simple Unit Test**: `core-network/LinkPreviewFetcherTest.kt`
- **DAO Test**: `core-database/ConversationDaoTest.kt`
- **Integration Test**: `core-e2ee/E2EEIntegrationTest.kt`
- **UI Test**: `feature-ai/AIConversationUITest.kt`
- **E2E Test**: `feature-ai/AIConversationE2ETest.kt`

### Key Libraries

- **JUnit 4**: Test framework
- **Robolectric**: Android unit tests
- **Turbine**: Flow testing
- **Jetpack Compose Testing**: UI testing
- **MockK**: Mocking framework

---

## ✅ Quick Checklist

Before committing code:

- [ ] All affected module tests pass locally
- [ ] New code has corresponding tests
- [ ] Coverage stays above 85%
- [ ] No flaky tests introduced
- [ ] Test names are descriptive (use backticks)
- [ ] Helper functions for common setup
- [ ] Documentation updated if needed

---

## 🆘 Getting Help

### Common Issues

1. **Test won't compile**: Check imports and dependencies
2. **Test fails randomly**: Check for timing issues, use `runTest {}`
3. **Can't mock final classes**: Use MockK with `mockkClass()`
4. **Compose test fails**: Use `composeTestRule.waitForIdle()`

### Ask for Help

1. Check existing test files for examples
2. Read TEST_WRITING_GUIDE.md
3. Ask in team chat: #android-testing
4. Create issue with failing test output

---

## 🎯 Next Steps

1. ✅ Run all tests: `./gradlew test`
2. ✅ Check coverage: `./gradlew jacocoTestReport`
3. ✅ Install pre-commit hook: `git config core.hooksPath .githooks`
4. ✅ Read TEST_WRITING_GUIDE.md
5. ✅ Write your first test!

---

**Happy Testing!** 🧪✨

For detailed information, see:

- **TEST_WRITING_GUIDE.md** - How to write tests
- **ANDROID_TESTS_COMPLETE_REPORT.md** - All test documentation
- **CI_CD_SETUP_COMPLETE.md** - CI/CD details
