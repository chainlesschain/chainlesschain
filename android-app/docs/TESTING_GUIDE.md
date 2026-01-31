# Android 测试指南

## 版本信息
- **版本**: v1.0
- **创建日期**: 2026-01-23
- **状态**: 生效中

---

## 1. 概述

本文档提供 ChainlessChain Android 应用的完整测试策略和最佳实践。

### 1.1 测试金字塔

```
        ┌─────────────┐
        │  E2E Tests  │ 10% - 关键流程测试
        │   (UI 测试)  │
        └─────────────┘
      ┌─────────────────┐
      │Integration Tests│ 20% - 模块集成测试
      │  (数据库/网络)   │
      └─────────────────┘
    ┌─────────────────────┐
    │   Unit Tests        │ 70% - 单元逻辑测试
    │ (ViewModel/Repo)    │
    └─────────────────────┘
```

### 1.2 测试覆盖率目标

| 层级 | 目标覆盖率 | 当前覆盖率 |
|------|-----------|-----------|
| Unit Tests | ≥80% | 65% |
| Integration Tests | ≥60% | 40% |
| UI Tests | ≥40% | 20% |

---

## 2. 环境配置

### 2.1 依赖配置

在 `app/build.gradle.kts` 中添加：

```kotlin
dependencies {
    // JUnit 4
    testImplementation("junit:junit:4.13.2")

    // MockK (Mocking 框架)
    testImplementation("io.mockk:mockk:1.13.9")
    testImplementation("io.mockk:mockk-android:1.13.9")

    // Coroutines Testing
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.7.3")

    // Turbine (Flow 测试)
    testImplementation("app.cash.turbine:turbine:1.0.0")

    // Truth (Assertions)
    testImplementation("com.google.truth:truth:1.1.5")

    // AndroidX Test (Instrumentation)
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.1")

    // Compose Testing
    androidTestImplementation(platform("androidx.compose:compose-bom:2024.02.00"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")

    // Hilt Testing
    androidTestImplementation("com.google.dagger:hilt-android-testing:2.50")
    kspAndroidTest("com.google.dagger:hilt-compiler:2.50")

    // Room Testing
    testImplementation("androidx.room:room-testing:2.6.1")
}
```

### 2.2 测试配置

创建 `app/src/test/resources/mockito-extensions/org.mockito.plugins.MockMaker`：

```
mock-maker-inline
```

---

## 3. 单元测试

### 3.1 Repository 测试

**示例：`SocialRepositoryTest.kt`**

```kotlin
@ExperimentalCoroutinesApi
class SocialRepositoryTest {

    private lateinit var repository: SocialRepositoryImpl
    private lateinit var friendDao: FriendDao
    private lateinit var postDao: PostDao
    private lateinit var p2pService: P2PService
    private lateinit var didService: DIDService

    private val testDispatcher = UnconfinedTestDispatcher()

    @Before
    fun setup() {
        friendDao = mockk()
        postDao = mockk()
        p2pService = mockk(relaxed = true)
        didService = mockk()

        repository = SocialRepositoryImpl(
            friendDao = friendDao,
            postDao = postDao,
            interactionDao = mockk(),
            notificationDao = mockk(),
            p2pService = p2pService,
            didService = didService,
            dispatcher = testDispatcher
        )
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `getAllFriends should return friends from database`() = runTest {
        // Given
        val friendEntities = listOf(
            createTestFriendEntity(did = "did:user1", nickname = "Alice"),
            createTestFriendEntity(did = "did:user2", nickname = "Bob")
        )
        every { friendDao.getAllFriends() } returns flowOf(friendEntities)

        // When
        val result = repository.getAllFriends().first()

        // Then
        assertThat(result.isSuccess).isTrue()
        assertThat(result.getOrNull()).hasSize(2)
        assertThat(result.getOrNull()?.get(0)?.nickname).isEqualTo("Alice")
        assertThat(result.getOrNull()?.get(1)?.nickname).isEqualTo("Bob")
    }

    @Test
    fun `publishPost should insert to database and broadcast to P2P`() = runTest {
        // Given
        val request = CreatePostRequest(
            content = "Test post content",
            images = listOf("image1.jpg"),
            visibility = PostVisibility.PUBLIC
        )
        val currentDid = "did:current-user"

        coEvery { didService.getCurrentDid() } returns currentDid
        coEvery { postDao.insert(any()) } just Runs
        coEvery { p2pService.broadcastPost(any()) } just Runs

        // When
        val result = repository.publishPost(request)

        // Then
        assertThat(result.isSuccess).isTrue()
        coVerify { postDao.insert(any()) }
        coVerify { p2pService.broadcastPost(any()) }
    }

    @Test
    fun `likePost should update database and notify author`() = runTest {
        // Given
        val postId = "post123"
        val authorDid = "did:author"
        val currentDid = "did:current-user"
        val post = createTestPostEntity(id = postId, authorDid = authorDid, likeCount = 5)

        coEvery { didService.getCurrentDid() } returns currentDid
        coEvery { postDao.getPostById(postId) } returns post
        coEvery { interactionDao.insertLike(any()) } just Runs
        coEvery { postDao.updateLikeStatus(any(), any(), any()) } just Runs
        coEvery { p2pService.sendLike(any(), any()) } just Runs

        // When
        val result = repository.likePost(postId)

        // Then
        assertThat(result.isSuccess).isTrue()
        coVerify { interactionDao.insertLike(any()) }
        coVerify { postDao.updateLikeStatus(postId, 6, true) }
        coVerify { p2pService.sendLike(postId, authorDid) }
    }

    @Test
    fun `likePost should fail when post not found`() = runTest {
        // Given
        val postId = "nonexistent"
        coEvery { didService.getCurrentDid() } returns "did:user"
        coEvery { postDao.getPostById(postId) } returns null

        // When
        val result = repository.likePost(postId)

        // Then
        assertThat(result.isFailure).isTrue()
        assertThat(result.exceptionOrNull()).isInstanceOf(IllegalStateException::class.java)
    }

    // Helper functions
    private fun createTestFriendEntity(
        did: String,
        nickname: String
    ) = FriendEntity(
        did = did,
        nickname = nickname,
        avatar = null,
        bio = null,
        remarkName = null,
        groupId = null,
        addedAt = System.currentTimeMillis(),
        status = FriendStatus.ACCEPTED,
        isBlocked = false,
        lastActiveAt = null
    )

    private fun createTestPostEntity(
        id: String,
        authorDid: String,
        likeCount: Int
    ) = PostEntity(
        id = id,
        authorDid = authorDid,
        content = "Test content",
        images = emptyList(),
        linkUrl = null,
        linkPreview = null,
        tags = emptyList(),
        mentions = emptyList(),
        visibility = PostVisibility.PUBLIC,
        createdAt = System.currentTimeMillis(),
        updatedAt = null,
        isPinned = false,
        likeCount = likeCount,
        commentCount = 0,
        shareCount = 0,
        isLiked = false
    )
}
```

### 3.2 ViewModel 测试

**示例：`PostViewModelTest.kt`**

```kotlin
@ExperimentalCoroutinesApi
class PostViewModelTest {

    private lateinit var viewModel: PostViewModel
    private lateinit var socialRepository: SocialRepository

    private val testDispatcher = UnconfinedTestDispatcher()

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    @Before
    fun setup() {
        socialRepository = mockk()
        viewModel = PostViewModel(socialRepository)
    }

    @Test
    fun `initial state should be correct`() {
        // Then
        assertThat(viewModel.uiState.value.isRefreshing).isFalse()
        assertThat(viewModel.uiState.value.isLoadingMore).isFalse()
        assertThat(viewModel.uiState.value.isPublishing).isFalse()
    }

    @Test
    fun `publishPost should update state and emit success event`() = runTest {
        // Given
        val request = CreatePostRequest(content = "Test post")
        val postId = "post123"

        coEvery { socialRepository.publishPost(request) } returns Result.success(postId)

        // When
        viewModel.publishPost(request)
        advanceUntilIdle()

        // Then
        assertThat(viewModel.uiState.value.isPublishing).isFalse()

        // Verify event was emitted
        viewModel.eventFlow.test {
            val event = awaitItem()
            assertThat(event).isInstanceOf(PostEvent.PublishSuccess::class.java)
            assertThat((event as PostEvent.PublishSuccess).postId).isEqualTo(postId)
        }
    }

    @Test
    fun `publishPost should handle error`() = runTest {
        // Given
        val request = CreatePostRequest(content = "Test post")
        val errorMessage = "Network error"

        coEvery { socialRepository.publishPost(request) } returns Result.failure(
            Exception(errorMessage)
        )

        // When
        viewModel.publishPost(request)
        advanceUntilIdle()

        // Then
        assertThat(viewModel.uiState.value.isPublishing).isFalse()

        viewModel.eventFlow.test {
            val event = awaitItem()
            assertThat(event).isInstanceOf(PostEvent.PublishError::class.java)
            assertThat((event as PostEvent.PublishError).message).contains(errorMessage)
        }
    }

    @Test
    fun `refreshTimeline should update isRefreshing state`() = runTest {
        // Given
        val posts = listOf(createTestPost("post1"), createTestPost("post2"))
        every { socialRepository.getTimeline(0, 20) } returns flowOf(Result.success(posts))

        // When
        viewModel.refreshTimeline()

        // Then
        assertThat(viewModel.uiState.value.isRefreshing).isTrue()

        advanceUntilIdle()

        assertThat(viewModel.uiState.value.isRefreshing).isFalse()
    }

    @Test
    fun `toggleLike should call repository likePost when not liked`() = runTest {
        // Given
        val postId = "post123"
        val posts = listOf(createTestPost(postId, isLiked = false))

        every { socialRepository.getTimeline(any(), any()) } returns flowOf(Result.success(posts))
        coEvery { socialRepository.likePost(postId) } returns Result.success(Unit)

        // When
        viewModel.toggleLike(postId)
        advanceUntilIdle()

        // Then
        coVerify { socialRepository.likePost(postId) }
    }

    @Test
    fun `toggleLike should call repository unlikePost when already liked`() = runTest {
        // Given
        val postId = "post123"
        val posts = listOf(createTestPost(postId, isLiked = true))

        every { socialRepository.getTimeline(any(), any()) } returns flowOf(Result.success(posts))
        coEvery { socialRepository.unlikePost(postId) } returns Result.success(Unit)

        // When
        viewModel.toggleLike(postId)
        advanceUntilIdle()

        // Then
        coVerify { socialRepository.unlikePost(postId) }
    }

    // Helper functions
    private fun createTestPost(
        id: String,
        isLiked: Boolean = false
    ) = Post(
        id = id,
        author = User(did = "did:author", nickname = "Author", avatar = null),
        content = "Test content",
        images = emptyList(),
        linkPreview = null,
        tags = emptyList(),
        createdAt = System.currentTimeMillis(),
        updatedAt = null,
        isPinned = false,
        stats = PostStats(likeCount = 10, commentCount = 5, shareCount = 2),
        isLiked = isLiked
    )
}

// Main dispatcher rule for ViewModel tests
@ExperimentalCoroutinesApi
class MainDispatcherRule(
    private val testDispatcher: TestDispatcher = UnconfinedTestDispatcher()
) : TestWatcher() {
    override fun starting(description: Description) {
        Dispatchers.setMain(testDispatcher)
    }

    override fun finished(description: Description) {
        Dispatchers.resetMain()
    }
}
```

### 3.3 Flow 测试

**使用 Turbine 测试 Flow：**

```kotlin
@Test
fun `getTimeline should emit posts flow`() = runTest {
    // Given
    val posts = listOf(createTestPost("post1"), createTestPost("post2"))
    every { socialRepository.getTimeline(0, 20) } returns flowOf(Result.success(posts))

    // When & Then
    socialRepository.getTimeline(0, 20).test {
        val result = awaitItem()
        assertThat(result.isSuccess).isTrue()
        assertThat(result.getOrNull()).hasSize(2)
        awaitComplete()
    }
}

@Test
fun `notification flow should emit unread count updates`() = runTest {
    // Given
    val countFlow = MutableStateFlow(0)
    every { notificationDao.getUnreadCount() } returns countFlow

    // When & Then
    notificationDao.getUnreadCount().test {
        assertThat(awaitItem()).isEqualTo(0)

        countFlow.value = 5
        assertThat(awaitItem()).isEqualTo(5)

        countFlow.value = 0
        assertThat(awaitItem()).isEqualTo(0)
    }
}
```

---

## 4. 集成测试

### 4.1 数据库测试

**示例：`PostDaoTest.kt`**

```kotlin
@RunWith(AndroidJUnit4::class)
class PostDaoTest {

    private lateinit var database: ChainlessChainDatabase
    private lateinit var postDao: PostDao

    @Before
    fun setup() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = Room.inMemoryDatabaseBuilder(
            context,
            ChainlessChainDatabase::class.java
        ).allowMainThreadQueries().build()

        postDao = database.postDao()
    }

    @After
    fun tearDown() {
        database.close()
    }

    @Test
    fun insertAndGetPost() = runTest {
        // Given
        val post = createTestPostEntity(
            id = "post1",
            authorDid = "did:user1",
            content = "Test content"
        )

        // When
        postDao.insert(post)
        val retrieved = postDao.getPostById("post1")

        // Then
        assertThat(retrieved).isNotNull()
        assertThat(retrieved?.id).isEqualTo("post1")
        assertThat(retrieved?.content).isEqualTo("Test content")
    }

    @Test
    fun getTimelineShouldReturnPostsFromFriends() = runTest {
        // Given
        val myDid = "did:me"
        val friendDids = listOf("did:friend1", "did:friend2")

        val post1 = createTestPostEntity(id = "post1", authorDid = "did:friend1")
        val post2 = createTestPostEntity(id = "post2", authorDid = "did:friend2")
        val post3 = createTestPostEntity(id = "post3", authorDid = "did:stranger")

        postDao.insert(post1)
        postDao.insert(post2)
        postDao.insert(post3)

        // When
        val timeline = postDao.getTimeline(friendDids, myDid, limit = 10, offset = 0).first()

        // Then
        assertThat(timeline).hasSize(2)
        assertThat(timeline.map { it.id }).containsExactly("post2", "post1") // Newest first
    }

    @Test
    fun updateLikeStatusShouldUpdateCorrectly() = runTest {
        // Given
        val post = createTestPostEntity(id = "post1", likeCount = 5, isLiked = false)
        postDao.insert(post)

        // When
        postDao.updateLikeStatus("post1", count = 6, isLiked = true)
        val updated = postDao.getPostById("post1")

        // Then
        assertThat(updated?.likeCount).isEqualTo(6)
        assertThat(updated?.isLiked).isTrue()
    }

    @Test
    fun deletePostShouldRemoveFromDatabase() = runTest {
        // Given
        val post = createTestPostEntity(id = "post1")
        postDao.insert(post)

        // When
        postDao.delete("post1")
        val retrieved = postDao.getPostById("post1")

        // Then
        assertThat(retrieved).isNull()
    }

    @Test
    fun searchPostsShouldFindByContent() = runTest {
        // Given
        val post1 = createTestPostEntity(id = "post1", content = "Hello world")
        val post2 = createTestPostEntity(id = "post2", content = "Kotlin is awesome")
        val post3 = createTestPostEntity(id = "post3", content = "Hello Kotlin")

        postDao.insert(post1)
        postDao.insert(post2)
        postDao.insert(post3)

        // When
        val results = postDao.searchPosts("Kotlin", null).first()

        // Then
        assertThat(results).hasSize(2)
        assertThat(results.map { it.id }).containsExactly("post3", "post2")
    }

    private fun createTestPostEntity(
        id: String,
        authorDid: String = "did:user",
        content: String = "Test content",
        likeCount: Int = 0,
        isLiked: Boolean = false
    ) = PostEntity(
        id = id,
        authorDid = authorDid,
        content = content,
        images = emptyList(),
        linkUrl = null,
        linkPreview = null,
        tags = emptyList(),
        mentions = emptyList(),
        visibility = PostVisibility.PUBLIC,
        createdAt = System.currentTimeMillis(),
        updatedAt = null,
        isPinned = false,
        likeCount = likeCount,
        commentCount = 0,
        shareCount = 0,
        isLiked = isLiked
    )
}
```

---

## 5. UI 测试 (Compose)

### 5.1 基础组件测试

**示例：`PostCardTest.kt`**

```kotlin
@RunWith(AndroidJUnit4::class)
class PostCardTest {

    @get:Rule
    val composeTestRule = createComposeRule()

    private val testPost = Post(
        id = "post1",
        author = User(
            did = "did:author",
            nickname = "Test Author",
            avatar = null
        ),
        content = "This is a test post content",
        images = emptyList(),
        linkPreview = null,
        tags = listOf("test", "compose"),
        createdAt = System.currentTimeMillis(),
        updatedAt = null,
        isPinned = false,
        stats = PostStats(likeCount = 10, commentCount = 5, shareCount = 2),
        isLiked = false
    )

    @Test
    fun postCard_displaysCorrectContent() {
        composeTestRule.setContent {
            PostCard(
                post = testPost,
                onPostClick = {},
                onUserClick = {},
                onLikeClick = {},
                onCommentClick = {},
                onShareClick = {}
            )
        }

        // Verify content is displayed
        composeTestRule.onNodeWithText("Test Author").assertIsDisplayed()
        composeTestRule.onNodeWithText("This is a test post content").assertIsDisplayed()
        composeTestRule.onNodeWithText("#test").assertIsDisplayed()
        composeTestRule.onNodeWithText("#compose").assertIsDisplayed()
    }

    @Test
    fun postCard_displaysCorrectStats() {
        composeTestRule.setContent {
            PostCard(
                post = testPost,
                onPostClick = {},
                onUserClick = {},
                onLikeClick = {},
                onCommentClick = {},
                onShareClick = {}
            )
        }

        composeTestRule.onNodeWithText("10").assertIsDisplayed() // Like count
        composeTestRule.onNodeWithText("5").assertIsDisplayed()  // Comment count
        composeTestRule.onNodeWithText("2").assertIsDisplayed()  // Share count
    }

    @Test
    fun postCard_likeButtonTogglesState() {
        var likeClicked = false

        composeTestRule.setContent {
            PostCard(
                post = testPost.copy(isLiked = false),
                onPostClick = {},
                onUserClick = {},
                onLikeClick = { likeClicked = true },
                onCommentClick = {},
                onShareClick = {}
            )
        }

        // Click like button
        composeTestRule.onNodeWithText("点赞").performClick()

        // Verify callback was called
        assertThat(likeClicked).isTrue()
    }

    @Test
    fun postCard_pinnedIconIsDisplayedWhenPinned() {
        composeTestRule.setContent {
            PostCard(
                post = testPost.copy(isPinned = true),
                onPostClick = {},
                onUserClick = {},
                onLikeClick = {},
                onCommentClick = {},
                onShareClick = {}
            )
        }

        composeTestRule.onNodeWithContentDescription("置顶").assertIsDisplayed()
    }

    @Test
    fun postCard_clickingAuthorNameTriggersCallback() {
        var userClicked = false

        composeTestRule.setContent {
            PostCard(
                post = testPost,
                onPostClick = {},
                onUserClick = { userClicked = true },
                onLikeClick = {},
                onCommentClick = {},
                onShareClick = {}
            )
        }

        composeTestRule.onNodeWithText("Test Author").performClick()
        assertThat(userClicked).isTrue()
    }
}
```

### 5.2 屏幕测试

**示例：`FriendListScreenTest.kt`**

```kotlin
@RunWith(AndroidJUnit4::class)
@HiltAndroidTest
class FriendListScreenTest {

    @get:Rule(order = 0)
    val hiltRule = HiltAndroidRule(this)

    @get:Rule(order = 1)
    val composeTestRule = createAndroidComposeRule<MainActivity>()

    @Before
    fun setup() {
        hiltRule.inject()
    }

    @Test
    fun friendListScreen_displaysEmptyStateWhenNoFriends() {
        composeTestRule.setContent {
            FriendListScreen(
                viewModel = FriendViewModel(MockSocialRepository(friends = emptyList())),
                onFriendClick = {},
                onAddFriendClick = {}
            )
        }

        composeTestRule.onNodeWithText("暂无好友").assertIsDisplayed()
    }

    @Test
    fun friendListScreen_displaysFriendList() {
        val friends = listOf(
            Friend(did = "did:user1", nickname = "Alice", avatar = null, bio = null, remarkName = null, isOnline = true, lastActiveAt = null),
            Friend(did = "did:user2", nickname = "Bob", avatar = null, bio = null, remarkName = null, isOnline = false, lastActiveAt = null)
        )

        composeTestRule.setContent {
            FriendListScreen(
                viewModel = FriendViewModel(MockSocialRepository(friends = friends)),
                onFriendClick = {},
                onAddFriendClick = {}
            )
        }

        composeTestRule.onNodeWithText("Alice").assertIsDisplayed()
        composeTestRule.onNodeWithText("Bob").assertIsDisplayed()
    }

    @Test
    fun friendListScreen_searchFiltersFriends() {
        val friends = listOf(
            Friend(did = "did:user1", nickname = "Alice", avatar = null, bio = null, remarkName = null, isOnline = true, lastActiveAt = null),
            Friend(did = "did:user2", nickname = "Bob", avatar = null, bio = null, remarkName = null, isOnline = false, lastActiveAt = null)
        )

        composeTestRule.setContent {
            FriendListScreen(
                viewModel = FriendViewModel(MockSocialRepository(friends = friends)),
                onFriendClick = {},
                onAddFriendClick = {}
            )
        }

        // Type search query
        composeTestRule.onNodeWithText("搜索好友").performTextInput("Alice")

        // Verify only Alice is shown
        composeTestRule.onNodeWithText("Alice").assertIsDisplayed()
        composeTestRule.onNodeWithText("Bob").assertDoesNotExist()
    }

    @Test
    fun friendListScreen_addFriendButtonNavigates() {
        var addFriendClicked = false

        composeTestRule.setContent {
            FriendListScreen(
                viewModel = FriendViewModel(MockSocialRepository()),
                onFriendClick = {},
                onAddFriendClick = { addFriendClicked = true }
            )
        }

        composeTestRule.onNodeWithContentDescription("添加好友").performClick()
        assertThat(addFriendClicked).isTrue()
    }
}
```

### 5.3 语义测试

**使用 Semantics 进行无障碍测试：**

```kotlin
@Test
fun allButtonsHaveContentDescriptions() {
    composeTestRule.setContent {
        PostCard(
            post = testPost,
            onPostClick = {},
            onUserClick = {},
            onLikeClick = {},
            onCommentClick = {},
            onShareClick = {}
        )
    }

    // Verify all interactive elements have content descriptions
    composeTestRule.onAllNodes(hasClickAction())
        .assertAll(hasAnyDescendant(hasContentDescription()) or hasContentDescription())
}

@Test
fun screenIsNavigableByKeyboard() {
    composeTestRule.setContent {
        FriendListScreen(
            viewModel = viewModel,
            onFriendClick = {},
            onAddFriendClick = {}
        )
    }

    // Verify keyboard navigation works
    composeTestRule.onNodeWithTag("friend-list")
        .performKeyInput {
            pressKey(Key.DirectionDown)
            pressKey(Key.Enter)
        }
}
```

---

## 6. 性能测试

### 6.1 启动性能测试

**示例：`StartupBenchmark.kt`**

```kotlin
@RunWith(AndroidJUnit4::class)
class StartupBenchmark {

    @get:Rule
    val benchmarkRule = MacrobenchmarkRule()

    @Test
    fun startup() = benchmarkRule.measureRepeated(
        packageName = "com.chainlesschain.android",
        metrics = listOf(StartupTimingMetric()),
        iterations = 5,
        startupMode = StartupMode.COLD
    ) {
        pressHome()
        startActivityAndWait()
    }
}
```

### 6.2 滚动性能测试

```kotlin
@Test
fun scrollPostTimeline() = benchmarkRule.measureRepeated(
    packageName = "com.chainlesschain.android",
    metrics = listOf(FrameTimingMetric()),
    iterations = 5,
    setupBlock = {
        startActivityAndWait()
    }
) {
    val postList = device.findObject(By.res("post-timeline"))
    postList.setGestureMargin(device.displayWidth / 5)
    postList.fling(Direction.DOWN)
    device.waitForIdle()
}
```

### 6.3 内存泄漏测试

**使用 LeakCanary 进行内存泄漏检测：**

```kotlin
@Test
fun fragmentDoesNotLeak() {
    val scenario = launchFragmentInContainer<PostDetailFragment>()

    scenario.moveToState(Lifecycle.State.DESTROYED)

    // LeakCanary will automatically detect leaks
    // Check the LeakCanary report in logcat
}
```

### 6.4 数据库性能测试

```kotlin
@Test
fun insertLargeNumberOfPosts() = runTest {
    val posts = (1..1000).map { createTestPostEntity(id = "post$it") }

    val startTime = System.currentTimeMillis()
    posts.forEach { postDao.insert(it) }
    val duration = System.currentTimeMillis() - startTime

    assertThat(duration).isLessThan(5000) // Should complete within 5 seconds
}

@Test
fun queryPerformance() = runTest {
    // Insert test data
    repeat(1000) { postDao.insert(createTestPostEntity(id = "post$it")) }

    val startTime = System.currentTimeMillis()
    val results = postDao.getTimeline(emptyList(), "did:me", 20, 0).first()
    val duration = System.currentTimeMillis() - startTime

    assertThat(duration).isLessThan(100) // Should complete within 100ms
    assertThat(results).hasSize(20)
}
```

---

## 7. 测试最佳实践

### 7.1 命名规范

**测试方法命名格式：**
```
functionName_scenario_expectedResult
```

**示例：**
```kotlin
@Test
fun publishPost_withValidData_shouldInsertToDatabase()

@Test
fun likePost_whenPostDoesNotExist_shouldReturnError()

@Test
fun friendList_whenEmpty_shouldShowEmptyState()
```

### 7.2 Given-When-Then 结构

```kotlin
@Test
fun example() {
    // Given - 设置测试数据和前置条件
    val input = "test"
    every { repository.getData() } returns flowOf(Result.success(data))

    // When - 执行被测试的操作
    val result = viewModel.processData(input)

    // Then - 验证结果
    assertThat(result).isEqualTo(expectedResult)
    verify { repository.getData() }
}
```

### 7.3 测试数据管理

**创建测试工厂类：**

```kotlin
object TestDataFactory {
    fun createFriend(
        did: String = "did:test-user",
        nickname: String = "Test User",
        isOnline: Boolean = false
    ) = Friend(
        did = did,
        nickname = nickname,
        avatar = null,
        bio = null,
        remarkName = null,
        isOnline = isOnline,
        lastActiveAt = null
    )

    fun createPost(
        id: String = UUID.randomUUID().toString(),
        content: String = "Test content",
        isLiked: Boolean = false
    ) = Post(
        id = id,
        author = createUser(),
        content = content,
        images = emptyList(),
        linkPreview = null,
        tags = emptyList(),
        createdAt = System.currentTimeMillis(),
        updatedAt = null,
        isPinned = false,
        stats = PostStats(0, 0, 0),
        isLiked = isLiked
    )
}
```

### 7.4 避免常见错误

**❌ 不要：**
```kotlin
@Test
fun testEverything() {
    // Testing too many things in one test
    viewModel.loadFriends()
    viewModel.searchFriends("Alice")
    viewModel.sendFriendRequest("did:user")
    // ...
}
```

**✅ 应该：**
```kotlin
@Test
fun loadFriends_shouldUpdateUiState() {
    // One test, one concern
}

@Test
fun searchFriends_shouldFilterResults() {
    // Separate test for search
}

@Test
fun sendFriendRequest_shouldEmitSuccessEvent() {
    // Separate test for request
}
```

---

## 8. 持续集成 (CI)

### 8.1 GitHub Actions 配置

创建 `.github/workflows/android-test.yml`：

```yaml
name: Android Tests

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main, develop ]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
    - uses: actions/checkout@v3

    - name: Set up JDK 17
      uses: actions/setup-java@v3
      with:
        java-version: '17'
        distribution: 'temurin'

    - name: Cache Gradle packages
      uses: actions/cache@v3
      with:
        path: |
          ~/.gradle/caches
          ~/.gradle/wrapper
        key: ${{ runner.os }}-gradle-${{ hashFiles('**/*.gradle*', '**/gradle-wrapper.properties') }}
        restore-keys: |
          ${{ runner.os }}-gradle-

    - name: Run Unit Tests
      run: ./gradlew testDebugUnitTest

    - name: Generate Coverage Report
      run: ./gradlew jacocoTestReport

    - name: Upload Coverage to Codecov
      uses: codecov/codecov-action@v3
      with:
        file: ./app/build/reports/jacoco/jacocoTestReport/jacocoTestReport.xml

    - name: Run Detekt
      run: ./gradlew detekt

    - name: Upload Test Results
      if: always()
      uses: actions/upload-artifact@v3
      with:
        name: test-results
        path: app/build/test-results/
```

### 8.2 代码覆盖率配置

在 `app/build.gradle.kts` 添加：

```kotlin
android {
    buildTypes {
        debug {
            enableAndroidTestCoverage = true
            enableUnitTestCoverage = true
        }
    }
}

// JaCoCo 配置
tasks.register<JacocoReport>("jacocoTestReport") {
    dependsOn("testDebugUnitTest")

    reports {
        xml.required.set(true)
        html.required.set(true)
    }

    val fileFilter = listOf(
        "**/R.class",
        "**/R$*.class",
        "**/BuildConfig.*",
        "**/Manifest*.*",
        "**/*Test*.*",
        "android/**/*.*"
    )

    val debugTree = fileTree("${project.buildDir}/tmp/kotlin-classes/debug") {
        exclude(fileFilter)
    }

    sourceDirectories.setFrom(files("src/main/kotlin", "src/main/java"))
    classDirectories.setFrom(files(debugTree))
    executionData.setFrom(fileTree(project.buildDir) {
        include("**/*.exec", "**/*.ec")
    })
}
```

---

## 9. 测试执行命令

### 9.1 本地测试命令

```bash
# 运行所有单元测试
./gradlew test

# 运行特定模块测试
./gradlew :app:testDebugUnitTest

# 运行特定测试类
./gradlew test --tests "SocialRepositoryTest"

# 运行特定测试方法
./gradlew test --tests "SocialRepositoryTest.publishPost_*"

# 运行所有 UI 测试（需要设备/模拟器）
./gradlew connectedAndroidTest

# 生成覆盖率报告
./gradlew jacocoTestReport

# 运行 Detekt 代码检查
./gradlew detekt
```

### 9.2 查看测试报告

```bash
# 单元测试报告
open app/build/reports/tests/testDebugUnitTest/index.html

# 覆盖率报告
open app/build/reports/jacoco/jacocoTestReport/html/index.html

# Detekt 报告
open app/build/reports/detekt/detekt.html
```

---

## 10. 故障排查

### 10.1 常见问题

**问题 1：Flow 测试超时**
```kotlin
// ❌ 错误
@Test
fun testFlow() = runTest {
    repository.getData().collect {
        // 这会一直等待
    }
}

// ✅ 正确
@Test
fun testFlow() = runTest {
    repository.getData().test {
        val item = awaitItem()
        assertThat(item).isNotNull()
        awaitComplete()
    }
}
```

**问题 2：Compose 测试找不到节点**
```kotlin
// 确保使用正确的 matcher
composeTestRule.onNodeWithText("Text", useUnmergedTree = true)

// 添加测试标签
Modifier.testTag("my-component")
composeTestRule.onNodeWithTag("my-component")
```

**问题 3：数据库测试冲突**
```kotlin
// 每个测试使用独立的内存数据库
@Before
fun setup() {
    database = Room.inMemoryDatabaseBuilder(
        context,
        ChainlessChainDatabase::class.java
    )
    .allowMainThreadQueries()  // 仅测试使用
    .build()
}

@After
fun tearDown() {
    database.close()  // 确保关闭
}
```

---

## 11. 下一步计划

- [ ] 提升单元测试覆盖率到 80%
- [ ] 添加更多 UI 测试
- [ ] 集成 Baseline Profile 测试
- [ ] 添加性能回归测试
- [ ] 建立 CI/CD 测试流水线

---

**文档维护者：** Android 团队
**最后更新：** 2026-01-23
