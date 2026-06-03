# ChainlessChain Android - Test Writing Guide

**For**: Developers writing new tests
**Purpose**: Learn best practices and patterns
**Last Updated**: 2026-01-28

---

## 📖 Table of Contents

1. [Test Naming Conventions](#test-naming-conventions)
2. [Test Structure (AAA Pattern)](#test-structure-aaa-pattern)
3. [Writing Unit Tests](#writing-unit-tests)
4. [Writing DAO Tests](#writing-dao-tests)
5. [Writing Integration Tests](#writing-integration-tests)
6. [Writing UI Tests](#writing-ui-tests)
7. [Writing E2E Tests](#writing-e2e-tests)
8. [Testing Async Code](#testing-async-code)
9. [Mocking Dependencies](#mocking-dependencies)
10. [Common Patterns](#common-patterns)
11. [Anti-Patterns to Avoid](#anti-patterns-to-avoid)
12. [Code Examples](#code-examples)

---

## 1. Test Naming Conventions

### Use Backtick Syntax for Readability

✅ **GOOD**:

```kotlin
@Test
fun `encrypt creates valid RatchetMessage with header`()

@Test
fun `getUnreadCount returns count of unacknowledged incoming messages`()

@Test
fun `MessageList displays user and assistant messages correctly`()
```

❌ **BAD**:

```kotlin
@Test
fun testEncrypt()

@Test
fun test_getUnreadCount()

@Test
fun shouldDisplayMessages()
```

### Naming Pattern

```
[function/component] [action/scenario] [expected result]
```

**Examples**:

- `encrypt creates valid ciphertext`
- `DAO returns empty list when no data exists`
- `UI shows loading indicator when data is fetching`
- `Complete workflow from login to dashboard succeeds`

---

## 2. Test Structure (AAA Pattern)

Always follow **Arrange → Act → Assert** pattern:

```kotlin
@Test
fun `example test following AAA pattern`() = runTest {
    // ARRANGE: Setup test data and dependencies
    val testMessage = "Hello World"
    val testKey = generateKey()

    // ACT: Execute the function being tested
    val result = encrypt(testMessage, testKey)

    // ASSERT: Verify the result
    assertNotNull(result)
    assertTrue(result.isNotEmpty())
    assertNotEquals(testMessage, result) // ciphertext != plaintext
}
```

### Use Comments for Complex Tests

```kotlin
@Test
fun `complete E2EE workflow from key exchange to message decryption`() = runTest {
    // ARRANGE: Alice and Bob generate keys
    val aliceKeys = keyManager.generateKeyPair()
    val bobKeys = keyManager.generateKeyPair()

    // ACT: Perform key exchange
    val aliceSecret = keyExchange.senderX3DH(bobKeys)
    val bobSecret = keyExchange.receiverX3DH(aliceKeys)

    // ASSERT: Both derive same secret
    assertArrayEquals(aliceSecret, bobSecret)

    // ACT: Alice encrypts message
    val plaintext = "Hello Bob"
    val encrypted = encrypt(plaintext.toByteArray(), aliceSecret)

    // ASSERT: Bob can decrypt
    val decrypted = decrypt(encrypted, bobSecret)
    assertEquals(plaintext, String(decrypted))
}
```

---

## 3. Writing Unit Tests

### Basic Unit Test Template

```kotlin
package com.chainlesschain.android.module

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class MyClassTest {

    @Test
    fun `function name does expected behavior`() {
        // Arrange
        val input = "test input"

        // Act
        val result = MyClass.functionName(input)

        // Assert
        assertNotNull(result)
        assertEquals("expected output", result)
    }
}
```

### Testing Pure Functions

Pure functions (no side effects) are easiest to test:

```kotlin
@Test
fun `calculateHash returns consistent SHA-256 hash`() {
    val input = "test string"

    val hash1 = calculateHash(input)
    val hash2 = calculateHash(input)

    assertEquals(hash1, hash2) // deterministic
    assertEquals(64, hash1.length) // SHA-256 = 64 hex chars
}
```

### Testing Edge Cases

Always test edge cases:

```kotlin
@Test
fun `encrypt handles empty input`() {
    val emptyInput = ByteArray(0)
    val result = encrypt(emptyInput, key)
    assertNotNull(result) // should not crash
}

@Test
fun `encrypt handles large input (10MB)`() {
    val largeInput = ByteArray(10 * 1024 * 1024) { it.toByte() }
    val result = encrypt(largeInput, key)
    assertTrue(result.size > largeInput.size) // includes overhead
}

@Test
fun `encrypt throws exception for invalid key`() {
    val invalidKey = ByteArray(0)
    assertThrows<IllegalArgumentException> {
        encrypt("test".toByteArray(), invalidKey)
    }
}
```

---

## 4. Writing DAO Tests

### DAO Test Template

```kotlin
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class MyDaoTest {

    private lateinit var database: ChainlessChainDatabase
    private lateinit var dao: MyDao

    @Before
    fun setup() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = Room.inMemoryDatabaseBuilder(context, ChainlessChainDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        dao = database.myDao()
    }

    @After
    fun tearDown() = database.close()

    @Test
    fun `insert and retrieve entity`() = runTest {
        val entity = createTestEntity(id = "1", name = "Test")

        dao.insert(entity)
        val retrieved = dao.getById("1")

        assertNotNull(retrieved)
        assertEquals("Test", retrieved.name)
    }

    private fun createTestEntity(
        id: String,
        name: String,
        createdAt: Long = System.currentTimeMillis()
    ) = MyEntity(id, name, createdAt)
}
```

### Testing Flow Responses with Turbine

```kotlin
@Test
fun `getAllItems Flow emits updates on insert`() = runTest {
    dao.getAllItems().test {
        // Initial empty state
        val initial = awaitItem()
        assertEquals(0, initial.size)

        // Insert item
        dao.insert(createTestEntity(id = "1"))

        // Verify emission
        val updated = awaitItem()
        assertEquals(1, updated.size)

        cancelAndIgnoreRemainingEvents()
    }
}
```

### Testing Complex Queries

```kotlin
@Test
fun `getItemsByPriority returns items in correct order`() = runTest {
    // Insert items with different priorities
    dao.insertAll(listOf(
        createTestEntity(id = "1", priority = "LOW"),
        createTestEntity(id = "2", priority = "HIGH"),
        createTestEntity(id = "3", priority = "NORMAL")
    ))

    val results = dao.getItemsByPriority()

    assertEquals(3, results.size)
    assertEquals("HIGH", results[0].priority) // Highest first
    assertEquals("NORMAL", results[1].priority)
    assertEquals("LOW", results[2].priority)
}
```

---

## 5. Writing Integration Tests

### Integration Test Template

```kotlin
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class MyIntegrationTest {

    @get:Rule(order = 0)
    val hiltRule = HiltAndroidRule(this)

    @Inject
    lateinit var component1: Component1

    @Inject
    lateinit var component2: Component2

    @Before
    fun setup() {
        hiltRule.inject()
    }

    @Test
    fun testComponentsWorkTogether() = runBlocking {
        // Test interaction between multiple components
        val data = component1.fetchData()
        val processed = component2.process(data)

        assertNotNull(processed)
    }
}
```

### Testing Complete Workflows

```kotlin
@Test
fun testCompleteE2EEWorkflow() = runBlocking {
    // Step 1: Key generation
    val aliceKeys = identityKeyManager.getIdentityKeyPair()
    val bobPreKeys = identityKeyManager.generatePreKeyBundle()

    // Step 2: Key exchange
    val sharedSecret = keyExchange.initiateSession(
        remoteIdentityKey = bobPreKeys.identityKey,
        remoteSignedPreKey = bobPreKeys.signedPreKey,
        remoteOneTimePreKey = bobPreKeys.oneTimePreKey
    )

    // Step 3: Create session
    sessionManager.createSession(
        peerId = "bob",
        sharedSecret = sharedSecret,
        isInitiator = true
    )

    // Step 4: Encrypt message
    val plaintext = "Hello Bob"
    val encrypted = sessionManager.encryptMessage("bob", plaintext.toByteArray())

    // Step 5: Decrypt message
    val decrypted = sessionManager.decryptMessage("bob", encrypted)

    // Verify
    assertEquals(plaintext, String(decrypted))
}
```

---

## 6. Writing UI Tests

### UI Test Template (Jetpack Compose)

```kotlin
@RunWith(AndroidJUnit4::class)
class MyUITest {

    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun `component displays data correctly`() {
        val testData = listOf("Item 1", "Item 2", "Item 3")

        composeTestRule.setContent {
            MyComponent(items = testData)
        }

        // Verify all items displayed
        testData.forEach { item ->
            composeTestRule.onNodeWithText(item).assertIsDisplayed()
        }
    }
}
```

### Testing User Interactions

```kotlin
@Test
fun `button click triggers callback`() {
    var clicked = false

    composeTestRule.setContent {
        MyButton(onClick = { clicked = true })
    }

    composeTestRule.onNodeWithText("Click Me").performClick()

    assertTrue(clicked)
}

@Test
fun `text input updates state`() {
    var capturedText = ""

    composeTestRule.setContent {
        MyTextField(onTextChange = { capturedText = it })
    }

    composeTestRule.onNodeWithTag("input_field")
        .performTextInput("Hello World")

    assertEquals("Hello World", capturedText)
}
```

### Using Test Tags

```kotlin
// In your Composable
@Composable
fun MyComponent() {
    TextField(
        value = text,
        onValueChange = { text = it },
        modifier = Modifier.testTag("email_input") // Add test tag
    )
}

// In your test
@Test
fun `test uses tag to find element`() {
    composeTestRule.setContent { MyComponent() }

    composeTestRule.onNodeWithTag("email_input")
        .assertIsDisplayed()
        .performTextInput("test@example.com")
}
```

---

## 7. Writing E2E Tests

### E2E Test Template

```kotlin
@HiltAndroidTest
@RunWith(AndroidJUnit4::class)
class MyE2ETest {

    @get:Rule(order = 0)
    val hiltRule = HiltAndroidRule(this)

    @get:Rule(order = 1)
    val composeTestRule = createAndroidComposeRule<MainActivity>()

    @Before
    fun setup() {
        hiltRule.inject()
        composeTestRule.waitForLoadingToComplete()
    }

    @Test
    fun testCompleteUserJourney() {
        // Step 1: Navigate to feature
        composeTestRule.clickOnText("Feature Name")
        composeTestRule.waitForLoadingToComplete()

        // Step 2: Perform action
        composeTestRule.typeTextInField("Input Field", "Test Data")
        composeTestRule.clickOnText("Submit")

        // Step 3: Verify result
        composeTestRule.waitForText("Success", timeoutMillis = 5000)
        composeTestRule.assertTextExists("Success")
    }
}
```

### Helper Functions for E2E Tests

```kotlin
// Extension functions for common E2E operations
fun ComposeTestRule.clickOnText(text: String, substring: Boolean = false) {
    onNodeWithText(text, substring = substring).performClick()
}

fun ComposeTestRule.typeTextInField(label: String, text: String) {
    onNodeWithText(label).performTextInput(text)
}

fun ComposeTestRule.waitForText(
    text: String,
    substring: Boolean = false,
    timeoutMillis: Long = 3000
) {
    waitUntil(timeoutMillis) {
        onAllNodesWithText(text, substring = substring)
            .fetchSemanticsNodes().isNotEmpty()
    }
}

fun ComposeTestRule.waitForLoadingToComplete() {
    waitForIdle()
    // Additional wait logic if needed
}
```

---

## 8. Testing Async Code

### Using `runTest` for Coroutines

```kotlin
@Test
fun `async function returns expected result`() = runTest {
    val result = suspendingFunction()
    assertEquals("expected", result)
}
```

### Testing with Delays

```kotlin
@Test
fun `function completes within timeout`() = runTest {
    val result = withTimeout(5000) {
        longRunningOperation()
    }
    assertNotNull(result)
}
```

### Testing Flow Emissions

```kotlin
@Test
fun `flow emits expected values`() = runTest {
    myFlow.test {
        assertEquals("first", awaitItem())
        assertEquals("second", awaitItem())
        assertEquals("third", awaitItem())
        awaitComplete()
    }
}
```

### Handling Race Conditions

```kotlin
@Test
fun `concurrent operations produce correct result`() = runTest {
    val jobs = (1..100).map { i ->
        launch { dao.insert(createEntity(id = "$i")) }
    }

    jobs.joinAll() // Wait for all to complete

    val result = dao.getAll()
    assertEquals(100, result.size)
}
```

---

## 9. Mocking Dependencies

### Using MockK

```kotlin
import io.mockk.*

@Test
fun `function calls dependency correctly`() = runTest {
    // Create mock
    val mockRepository = mockk<Repository>()

    // Define behavior
    coEvery { mockRepository.fetchData() } returns "mocked data"

    // Use mock
    val viewModel = ViewModel(mockRepository)
    val result = viewModel.getData()

    // Verify
    assertEquals("mocked data", result)
    coVerify { mockRepository.fetchData() }
}
```

### Mocking Final Classes

```kotlin
@Test
fun `mock final class with MockK`() {
    val mock = mockkClass(FinalClass::class)

    every { mock.method() } returns "mocked"

    assertEquals("mocked", mock.method())
}
```

### Partial Mocking

```kotlin
@Test
fun `spy on real object`() {
    val realObject = RealClass()
    val spy = spyk(realObject)

    // Use real implementation for some methods
    every { spy.methodToMock() } returns "mocked"

    // methodToMock() returns "mocked"
    // other methods use real implementation
}
```

---

## 10. Common Patterns

### Pattern 1: Helper Functions

Reduce test boilerplate with helper functions:

```kotlin
private fun createTestEntity(
    id: String = "test-${System.currentTimeMillis()}",
    name: String = "Test Name",
    age: Int = 25,
    createdAt: Long = System.currentTimeMillis()
) = MyEntity(id, name, age, createdAt)

@Test
fun `test uses helper function`() = runTest {
    // Easy to create test data
    val entity1 = createTestEntity(id = "1", name = "Alice")
    val entity2 = createTestEntity(id = "2", name = "Bob")
    val entity3 = createTestEntity() // uses defaults
}
```

### Pattern 2: Test Fixtures

Create reusable test data:

```kotlin
object TestFixtures {
    fun validUser() = User(
        id = "user1",
        name = "John Doe",
        email = "john@example.com"
    )

    fun validConversation() = Conversation(
        id = "conv1",
        title = "Test Conversation",
        createdAt = System.currentTimeMillis()
    )
}

@Test
fun `test uses fixtures`() = runTest {
    val user = TestFixtures.validUser()
    val conversation = TestFixtures.validConversation()
}
```

### Pattern 3: Parameterized Tests

Test multiple inputs efficiently:

```kotlin
@Test
fun `function handles various inputs correctly`() {
    val testCases = listOf(
        "input1" to "expected1",
        "input2" to "expected2",
        "input3" to "expected3"
    )

    testCases.forEach { (input, expected) ->
        val result = myFunction(input)
        assertEquals(expected, result, "Failed for input: $input")
    }
}
```

### Pattern 4: Test Organization with Section Comments

```kotlin
class MyTest {

    // ========================================
    // CRUD Tests (5 tests)
    // ========================================

    @Test
    fun `insert creates new record`() { /* ... */ }

    @Test
    fun `update modifies existing record`() { /* ... */ }

    // ========================================
    // Query Tests (3 tests)
    // ========================================

    @Test
    fun `getAll returns all records`() { /* ... */ }

    @Test
    fun `getById returns single record`() { /* ... */ }
}
```

---

## 11. Anti-Patterns to Avoid

### ❌ Don't: Multiple Assertions Without Context

```kotlin
// BAD: Hard to debug which assertion failed
@Test
fun badTest() {
    assertEquals("John", user.firstName)
    assertEquals("Doe", user.lastName)
    assertEquals(25, user.age)
    assertEquals("john@example.com", user.email)
}
```

✅ **Do: Clear assertions with descriptive messages**

```kotlin
// GOOD: Clear failure messages
@Test
fun `user has correct properties`() {
    assertEquals("John", user.firstName, "First name mismatch")
    assertEquals("Doe", user.lastName, "Last name mismatch")
    assertEquals(25, user.age, "Age mismatch")
    assertEquals("john@example.com", user.email, "Email mismatch")
}
```

### ❌ Don't: Test Implementation Details

```kotlin
// BAD: Testing private implementation
@Test
fun badTest() {
    val privateField = MyClass::class.java
        .getDeclaredField("privateField")
        .apply { isAccessible = true }
        .get(myObject)

    assertEquals("expected", privateField)
}
```

✅ **Do: Test public behavior**

```kotlin
// GOOD: Test public API
@Test
fun `public method returns expected result`() {
    val result = myObject.publicMethod()
    assertEquals("expected", result)
}
```

### ❌ Don't: Tests Depend on Each Other

```kotlin
// BAD: Tests depend on execution order
private var sharedState: String? = null

@Test
fun test1() {
    sharedState = "value"
}

@Test
fun test2() {
    assertEquals("value", sharedState) // Fails if test1 doesn't run first
}
```

✅ **Do: Each test is independent**

```kotlin
// GOOD: Tests are independent
@Test
fun test1() {
    val state = "value"
    assertEquals("value", state)
}

@Test
fun test2() {
    val state = "value"
    assertEquals("value", state)
}
```

### ❌ Don't: Catch Exceptions in Tests

```kotlin
// BAD: Swallowing exceptions
@Test
fun badTest() {
    try {
        riskyOperation()
        assertTrue(true)
    } catch (e: Exception) {
        fail("Should not throw")
    }
}
```

✅ **Do: Let exceptions propagate or use assertThrows**

```kotlin
// GOOD: Clear exception handling
@Test
fun `operation succeeds without exceptions`() {
    assertDoesNotThrow {
        riskyOperation()
    }
}

@Test
fun `operation throws expected exception`() {
    assertThrows<IllegalArgumentException> {
        riskyOperation()
    }
}
```

---

## 12. Code Examples

### Complete Unit Test Example

```kotlin
package com.chainlesschain.android.core.utils

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class HashUtilsTest {

    @Test
    fun `sha256 returns 64-character hex string`() {
        val input = "test string"
        val hash = HashUtils.sha256(input)

        assertEquals(64, hash.length)
        assertTrue(hash.all { it in '0'..'9' || it in 'a'..'f' })
    }

    @Test
    fun `sha256 is deterministic`() {
        val input = "test string"

        val hash1 = HashUtils.sha256(input)
        val hash2 = HashUtils.sha256(input)

        assertEquals(hash1, hash2)
    }

    @Test
    fun `sha256 produces different hashes for different inputs`() {
        val hash1 = HashUtils.sha256("input1")
        val hash2 = HashUtils.sha256("input2")

        assertNotEquals(hash1, hash2)
    }

    @Test
    fun `sha256 handles empty input`() {
        val hash = HashUtils.sha256("")

        assertEquals(64, hash.length) // Still valid hash
    }
}
```

### Complete DAO Test Example

```kotlin
package com.chainlesschain.android.core.database.dao

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import app.cash.turbine.test
import com.chainlesschain.android.core.database.ChainlessChainDatabase
import com.chainlesschain.android.core.database.entity.MessageEntity
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class MessageDaoTest {

    private lateinit var database: ChainlessChainDatabase
    private lateinit var messageDao: MessageDao

    @Before
    fun setup() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = Room.inMemoryDatabaseBuilder(context, ChainlessChainDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        messageDao = database.messageDao()
    }

    @After
    fun tearDown() = database.close()

    @Test
    fun `insert and retrieve message`() = runTest {
        val message = createTestMessage(id = "1", content = "Hello")

        messageDao.insert(message)
        val retrieved = messageDao.getById("1")

        assertEquals("Hello", retrieved?.content)
    }

    @Test
    fun `getAllMessages Flow emits updates`() = runTest {
        messageDao.getAllMessages("conv1").test {
            val initial = awaitItem()
            assertEquals(0, initial.size)

            messageDao.insert(createTestMessage(id = "1", conversationId = "conv1"))

            val updated = awaitItem()
            assertEquals(1, updated.size)

            cancelAndIgnoreRemainingEvents()
        }
    }

    private fun createTestMessage(
        id: String,
        conversationId: String = "conv1",
        role: String = "user",
        content: String = "Test message"
    ) = MessageEntity(
        id = id,
        conversationId = conversationId,
        role = role,
        content = content,
        tokens = content.length / 4,
        createdAt = System.currentTimeMillis(),
        model = "gpt-4",
        finishReason = "stop",
        isStreaming = false,
        error = null
    )
}
```

---

## 🎯 Quick Reference

### Test Checklist

Before committing a test:

- [ ] Test name is descriptive (uses backticks)
- [ ] Follows AAA pattern (Arrange-Act-Assert)
- [ ] Tests one thing (single responsibility)
- [ ] Independent (no shared state)
- [ ] Fast (runs in milliseconds)
- [ ] Deterministic (same result every time)
- [ ] Uses helper functions for test data
- [ ] Includes edge case tests
- [ ] Has clear failure messages

### Common Assertions

```kotlin
// Equality
assertEquals(expected, actual)
assertNotEquals(notExpected, actual)

// Nullability
assertNotNull(value)
assertNull(value)

// Boolean
assertTrue(condition)
assertFalse(condition)

// Collections
assertEquals(3, list.size)
assertTrue(list.contains(item))
assertTrue(list.isEmpty())

// Exceptions
assertThrows<Exception> { code() }
assertDoesNotThrow { code() }

// Arrays
assertArrayEquals(expected, actual)
```

---

**Next Steps**: Start writing tests using these patterns! 🧪✨

For more examples, see:

- `core-e2ee/src/test/java/protocol/` - Unit test examples
- `core-database/src/test/java/dao/` - DAO test examples
- `feature-ai/src/androidTest/java/` - UI/E2E test examples
