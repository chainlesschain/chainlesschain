package com.chainlesschain.android.feature.knowledge.e2e

import android.content.Context
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.test.core.app.ApplicationProvider
import com.chainlesschain.android.core.common.util.DeviceIdManager
import com.chainlesschain.android.feature.knowledge.data.repository.KnowledgeRepository
import com.chainlesschain.android.core.database.entity.KnowledgeItemEntity
import com.chainlesschain.android.feature.knowledge.domain.model.KnowledgeType
import com.chainlesschain.android.feature.knowledge.presentation.FilterMode
import com.chainlesschain.android.feature.knowledge.presentation.KnowledgeListScreen
import com.chainlesschain.android.feature.knowledge.presentation.KnowledgeViewModel
import com.chainlesschain.android.test.DatabaseFixture
import com.chainlesschain.android.test.assertTextDoesNotExist
import com.chainlesschain.android.test.assertTextExists
import com.chainlesschain.android.test.scrollToText
import com.chainlesschain.android.test.waitForText
import com.chainlesschain.android.test.withKnowledgeItems
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Ignore
import org.junit.Rule
import org.junit.Test

/**
 * 知识库 E2E 测试（Phase 6 infra-reactivated）
 *
 * Hilt graph wiring lives in [com.chainlesschain.android.feature.knowledge.HiltGraphSmokeTest].
 * This file focuses on the end-to-end workflow itself; it deliberately
 * constructs `KnowledgeViewModel` + `KnowledgeRepository` by hand against an
 * in-memory Room database (via [DatabaseFixture]) rather than going through
 * the production DI graph, because that graph pulls in
 * `:core-database/DatabaseModule.provideDatabase` which `System.loadLibrary("sqlcipher")`
 * + opens the real SQLCipher-encrypted DB through `KeyManager` →
 * AndroidKeyStore. None of that is necessary to validate the knowledge
 * workflow itself.
 *
 * Workflow tests share the [TestActivity] / [DatabaseFixture] / shared
 * [ComposeTestExtensions] infrastructure landed in Phase 2-5 (see memory
 * `android_quarantined_tests_llm_hallucinated.md`).
 *
 * Original 8-test surface:
 *   testCompleteKnowledgeWorkflow / testMarkdownEditorFunctionality /
 *   testOfflineCreationAndSync / testFullTextSearch /
 *   testPaginationLoading / testFavoritesFunctionality /
 *   testTagFiltering / testMultiDeviceSync
 *
 * Reactivated: KB-01 testCompleteKnowledgeWorkflow + KB-05 testPaginationLoading
 * + KB-06 testFavoritesFunctionality. The other 5 remain `@Ignore` pending
 * per-test scope decisions (see KDoc on each).
 */
class KnowledgeE2ETest {

    @get:Rule(order = 0)
    val databaseFixture = DatabaseFixture()

    // KB-01 deliberately does NOT use createAndroidComposeRule<TestActivity>() —
    // TestActivity carries @AndroidEntryPoint, and launching it without an
    // active Hilt graph (no @HiltAndroidTest / HiltAndroidRule on this class
    // — see file KDoc on the avoid-SQLCipher rationale) crashes the
    // instrumentation process at onCreate with
    //   IllegalStateException: The component was not created. Check that you
    //   have added the HiltAndroidRule.
    // (run 26498143551 reproducer). createComposeRule() instead uses the debug
    // Activity supplied by `debugImplementation androidx.compose.ui:ui-test-manifest`
    // — a plain ComponentActivity, no Hilt expectation. TestActivity stays
    // around for future @HiltAndroidTest-based reactivations (KB-02..KB-08).
    @get:Rule(order = 1)
    val composeTestRule = createComposeRule()

    private lateinit var viewModel: KnowledgeViewModel
    private lateinit var repository: KnowledgeRepository

    private fun initViewModel() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        // DeviceIdManager uses EncryptedSharedPreferences (via AndroidKeyStore),
        // which works fine on the API 30 emulator. The `testSharedPreferences`
        // override is `internal` to :core-common so we can't swap from another
        // module — the prod path is acceptable here, just a small startup cost.
        val deviceIdManager = DeviceIdManager(context)
        repository = KnowledgeRepository(databaseFixture.database.knowledgeItemDao())
        viewModel = KnowledgeViewModel(repository, deviceIdManager)
    }

    @Test
    fun testCompleteKnowledgeWorkflow() {
        initViewModel()

        // 1) Render the list screen — empty DB, FAB visible, no items.
        composeTestRule.setContent {
            KnowledgeListScreen(
                onItemClick = {},
                onAddClick = {},
                viewModel = viewModel
            )
        }
        composeTestRule.onNodeWithContentDescription("添加知识库").assertIsDisplayed()

        // 2) Create an item via the ViewModel API (mimics user tapping FAB →
        //    editor → save). Verify it lands in the DB.
        viewModel.createItem(
            title = "测试笔记 1",
            content = "这是一条测试笔记内容",
            type = KnowledgeType.NOTE,
            tags = listOf("test", "kb-01")
        )

        // VM update is async (viewModelScope.launch). Wait for the success
        // toast/state to settle before reading DB. waitForText polls so it's
        // robust to coroutine scheduling jitter on slow emulators.
        composeTestRule.waitForText("测试笔记 1", timeoutMillis = 5000)
        composeTestRule.assertTextExists("测试笔记 1")

        // DB-level sanity: the item is persisted, not just rendered.
        val itemCount = runBlocking {
            // Allow the createItem coroutine to commit before we count.
            // The Compose waitForText above only proves the UI saw the
            // emission; the DB row should be there too. KnowledgeItemDao has
            // no count() — use getAllItemsSync().size; the in-memory DB is
            // freshly created per test so 1 row is the expected total.
            delay(50)
            databaseFixture.database.knowledgeItemDao().getAllItemsSync().size
        }
        assertEquals("Exactly one item should be persisted", 1, itemCount)

        // 3) Search — narrow to the just-created item by title substring.
        viewModel.searchKnowledge("测试")
        composeTestRule.waitForText("测试笔记 1", timeoutMillis = 3000)

        // Search query state is reflected on the VM.
        assertEquals("测试", viewModel.uiState.value.searchQuery)

        // 4) Clear search — VM state resets to empty query.
        viewModel.clearSearch()
        composeTestRule.waitForText("测试笔记 1", timeoutMillis = 3000)
        assertEquals("", viewModel.uiState.value.searchQuery)

        // 5) Confirm createItem reported success via uiState.
        assertTrue(
            "createItem should have set operationSuccess",
            viewModel.uiState.value.operationSuccess
        )
        assertNotNull(
            "successMessage should be populated after create",
            viewModel.uiState.value.successMessage
        )
    }

    @Ignore("Needs Markdown editor screen wired into TestActivity nav (Phase 6 follow-up KB-02)")
    @Test
    fun testMarkdownEditorFunctionality() {
        TODO("KB-02 — see KnowledgeEditorScreen + module-local NavHost")
    }

    @Ignore("Needs sync wiring (SyncManager → FakeSyncOutbound) + WorkManager harness (KB-03)")
    @Test
    fun testOfflineCreationAndSync() {
        TODO("KB-03 — pending FakeSyncOutbound assertions infra")
    }

    @Ignore("Needs FTS5 / search indexer setup with real corpus (KB-04)")
    @Test
    fun testFullTextSearch() {
        TODO("KB-04 — depends on FTS-backed KnowledgeItemDao.search() shape")
    }

    @Test
    fun testPaginationLoading() {
        // Pre-populate 50 items directly via DatabaseFixture (bypass the VM —
        // 50 createItem() calls would saturate viewModelScope and the test
        // would race the Compose first composition). Titles are zero-padded so
        // lexical ordering matches numeric ordering when scrolling. PAGE_SIZE
        // in KnowledgeRepository is 20, so 50 items = 3 pages.
        databaseFixture.withKnowledgeItems(50) { idx ->
            val padded = idx.toString().padStart(3, '0')
            KnowledgeItemEntity(
                id = "kb05-$padded",
                title = "分页测试条目 $padded",
                content = "内容 $padded",
                type = "note",
                deviceId = "kb05-device"
            )
        }

        initViewModel()
        composeTestRule.setContent {
            KnowledgeListScreen(
                onItemClick = {},
                onAddClick = {},
                viewModel = viewModel
            )
        }

        // 1) First page (0..19) renders without scrolling.
        composeTestRule.waitForText("分页测试条目 000", timeoutMillis = 5000)
        composeTestRule.assertTextExists("分页测试条目 005")
        composeTestRule.assertTextExists("分页测试条目 019")

        // 2) Scroll to an item on page 2 (20..39). scrollToText drives the
        //    LazyColumn far enough to materialize the item — which also
        //    triggers Paging3 to load the next page (PagingSource.load is
        //    invoked when the prefetch window is reached).
        composeTestRule.scrollToText("分页测试条目 025")
        composeTestRule.assertTextExists("分页测试条目 025")

        // 3) Scroll to page 3 (40..49) — full range loadable.
        composeTestRule.scrollToText("分页测试条目 045")
        composeTestRule.assertTextExists("分页测试条目 045")

        // DB-level sanity: all 50 rows are persisted (no insertAll dropped).
        val totalRows = runBlocking {
            databaseFixture.database.knowledgeItemDao().getAllItemsSync().size
        }
        assertEquals("All 50 items should be persisted", 50, totalRows)
    }

    @Test
    fun testFavoritesFunctionality() {
        initViewModel()

        // 1) Render list; create two items — one will be marked favorite, the
        //    other stays as a control to verify the filter actually filters.
        composeTestRule.setContent {
            KnowledgeListScreen(
                onItemClick = {},
                onAddClick = {},
                viewModel = viewModel
            )
        }
        viewModel.createItem(
            title = "可收藏笔记 A",
            content = "内容 A",
            type = KnowledgeType.NOTE,
            tags = listOf("kb-06")
        )
        viewModel.createItem(
            title = "普通笔记 B",
            content = "内容 B",
            type = KnowledgeType.NOTE,
            tags = listOf("kb-06")
        )
        composeTestRule.waitForText("可收藏笔记 A", timeoutMillis = 5000)
        composeTestRule.waitForText("普通笔记 B", timeoutMillis = 5000)

        // 2) Toggle favorite on item A via the VM. createItem doesn't return
        //    the id (Unit return); fetch it from the DAO by title.
        val favoriteId = runBlocking {
            delay(50)
            databaseFixture.database.knowledgeItemDao()
                .getAllItemsSync()
                .first { it.title == "可收藏笔记 A" }
                .id
        }
        viewModel.toggleFavorite(favoriteId)

        // DB-level sanity: exactly one row has isFavorite=true and it's A.
        val favoritedTitles = runBlocking {
            delay(50)
            databaseFixture.database.knowledgeItemDao()
                .getAllItemsSync()
                .filter { it.isFavorite }
                .map { it.title }
        }
        assertEquals("Exactly one item should be favorited", 1, favoritedTitles.size)
        assertEquals("Favorited item should be A", "可收藏笔记 A", favoritedTitles.first())

        // 3) Switch filter mode to FAVORITE — VM state and UI both update.
        viewModel.setFilterMode(FilterMode.FAVORITE)
        assertEquals(
            "filterMode should be FAVORITE after setFilterMode",
            FilterMode.FAVORITE,
            viewModel.uiState.value.filterMode
        )

        // The flatMapLatest re-emission swaps repository.getItems() →
        // repository.getFavoriteItems(), so the LazyColumn should drop B.
        composeTestRule.waitForText("可收藏笔记 A", timeoutMillis = 3000)
        composeTestRule.assertTextDoesNotExist("普通笔记 B")

        // 4) Switch back to ALL — both items reappear.
        viewModel.setFilterMode(FilterMode.ALL)
        assertEquals(FilterMode.ALL, viewModel.uiState.value.filterMode)
        composeTestRule.waitForText("普通笔记 B", timeoutMillis = 3000)
        composeTestRule.assertTextExists("可收藏笔记 A")
    }

    @Ignore("Needs tag-index data + filter chip assertions (KB-07)")
    @Test
    fun testTagFiltering() {
        TODO("KB-07")
    }

    @Ignore("Needs two-device emulator harness + sync mock (KB-08)")
    @Test
    fun testMultiDeviceSync() {
        TODO("KB-08 — likely requires multi-emulator CI matrix")
    }
}
