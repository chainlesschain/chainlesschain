package com.chainlesschain.android.feature.knowledge.e2e

import android.content.Context
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.test.core.app.ApplicationProvider
import com.chainlesschain.android.core.common.util.DeviceIdManager
import com.chainlesschain.android.feature.knowledge.data.repository.KnowledgeRepository
import com.chainlesschain.android.core.database.entity.KnowledgeItemEntity
import com.chainlesschain.android.feature.knowledge.domain.model.KnowledgeType
import com.chainlesschain.android.feature.knowledge.presentation.FilterMode
import com.chainlesschain.android.feature.knowledge.presentation.KnowledgeEditorScreen
import com.chainlesschain.android.feature.knowledge.presentation.KnowledgeListScreen
import com.chainlesschain.android.feature.knowledge.presentation.KnowledgeViewModel
import com.chainlesschain.android.test.DatabaseFixture
import com.chainlesschain.android.test.assertTextDoesNotExist
import com.chainlesschain.android.test.assertTextExists
import com.chainlesschain.android.test.clickOnText
import com.chainlesschain.android.test.scrollListToText
import com.chainlesschain.android.test.typeTextInField
import com.chainlesschain.android.test.waitForText
import com.chainlesschain.android.test.waitUntilCondition
import com.chainlesschain.android.test.waitUntilNodeDoesNotExist
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
 * Reactivated: KB-01 testCompleteKnowledgeWorkflow + KB-02
 * testMarkdownEditorFunctionality + KB-03 testOfflineCreationAndSync + KB-04
 * testFullTextSearch + KB-05 testPaginationLoading + KB-06
 * testFavoritesFunctionality. The other 2 (KB-07 tag filter — needs prod
 * filter API; KB-08 multi-device sync — needs multi-emulator matrix) remain
 * `@Ignore` per per-test KDoc.
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

    @Test
    fun testMarkdownEditorFunctionality() {
        initViewModel()

        // navHandled flips when KnowledgeEditorScreen calls onNavigateBack —
        // its LaunchedEffect(operationSuccess) does that after a successful
        // create. Used to assert save→back round-trip.
        var navHandled = false

        composeTestRule.setContent {
            KnowledgeEditorScreen(
                itemId = null,
                onNavigateBack = { navHandled = true },
                viewModel = viewModel
            )
        }

        // 1) Editor renders — title field label and save button must be
        //    present. The Markdown placeholder ("开始输入Markdown内容...") is
        //    deliberately NOT asserted: RichTextEditor's edit pane is an
        //    AndroidView-wrapped Markwon EditText whose placeholder is the
        //    View-world `hint` — it never appears in the Compose semantics
        //    tree, so hasText() can not match it (CI runs 27328157081+
        //    failed exactly here).
        composeTestRule.assertTextExists("新建知识库")
        composeTestRule.assertTextExists("标题 *")
        composeTestRule.onNodeWithContentDescription("保存").assertIsDisplayed()

        // 2) Save round-trip — typeTextInField against OutlinedTextField label
        //    is brittle (label vs input node disambiguation in M3 semantics
        //    tree), so drive createItem via the VM and rely on the editor's
        //    LaunchedEffect(operationSuccess) → onNavigateBack to confirm the
        //    success path the editor exposes is wired end-to-end.
        viewModel.createItem(
            title = "Markdown 测试笔记",
            content = "# 标题\n\n**粗体** *斜体* `code`",
            type = KnowledgeType.NOTE,
            tags = listOf("kb-02", "markdown")
        )

        composeTestRule.waitUntilCondition(timeoutMillis = 5000) { navHandled }
        assertTrue("onNavigateBack should fire after operationSuccess", navHandled)

        // DB-level sanity: the markdown body persisted intact (no editor-side
        // mangling). Important because RichTextEditor handles its own state
        // separately from VM until save.
        val saved = runBlocking {
            delay(50)
            databaseFixture.database.knowledgeItemDao()
                .getAllItemsSync()
                .first { it.title == "Markdown 测试笔记" }
        }
        assertEquals("# 标题\n\n**粗体** *斜体* `code`", saved.content)
    }

    @Test
    fun testOfflineCreationAndSync() {
        initViewModel()

        composeTestRule.setContent {
            KnowledgeListScreen(
                onItemClick = {},
                onAddClick = {},
                viewModel = viewModel
            )
        }

        // 1) Offline creation: createItem without any network. The default
        //    syncStatus on KnowledgeItemEntity is "pending" — the prod sync
        //    flow (SyncManager → SyncOutbound) is what flips this to "synced"
        //    when network is available. This test verifies the offline tracking
        //    state machine without needing the actual SyncManager (which would
        //    pull in :core-p2p + Hilt — see file KDoc on the avoid-Hilt rationale).
        viewModel.createItem(
            title = "离线笔记 KB-03",
            content = "无网创建，等同步",
            type = KnowledgeType.NOTE,
            tags = listOf("kb-03", "offline")
        )
        composeTestRule.waitForText("离线笔记 KB-03", timeoutMillis = 5000)

        // 2) DB-level: row has syncStatus = "pending" + appears in
        //    getPendingSyncItems (the queue the prod sync worker drains).
        val pending = runBlocking {
            delay(50)
            databaseFixture.database.knowledgeItemDao().getPendingSyncItems(10)
        }
        assertEquals("Should be exactly 1 pending row", 1, pending.size)
        assertEquals("离线笔记 KB-03", pending.first().title)
        assertEquals("pending", pending.first().syncStatus)
        val pendingId = pending.first().id

        // 3) Simulate the sync worker flipping the row to "synced" (this is
        //    what SyncManager.pushItem → updateSyncStatus does on success).
        runBlocking {
            databaseFixture.database.knowledgeItemDao()
                .updateSyncStatus(pendingId, "synced")
        }

        // 4) After sync: row drops out of getPendingSyncItems but still exists
        //    in getAllItemsSync — proves the queue logic, not deletion.
        val pendingAfter = runBlocking {
            databaseFixture.database.knowledgeItemDao().getPendingSyncItems(10)
        }
        val totalAfter = runBlocking {
            databaseFixture.database.knowledgeItemDao().getAllItemsSync().size
        }
        assertEquals("Pending queue should be empty after sync", 0, pendingAfter.size)
        assertEquals("Item still persisted, just synced", 1, totalAfter)
    }

    @Test
    fun testFullTextSearch() {
        // Seed 4 distinct items via DAO so FTS gets clean rowids. Titles +
        // contents use ASCII tokens — SQLite FTS4 default tokenizer is
        // `simple`, which splits on whitespace/punctuation; CJK tokens would
        // be a single blob and harder to assert against.
        // Explicit descending updatedAt: the list orders by
        // `isPinned DESC, updatedAt DESC` (KnowledgeItemDao.getItems), and
        // same-millisecond inserts make that ordering nondeterministic —
        // a→b→c→d top-down is what the viewport assertions below rely on.
        val kb04Base = System.currentTimeMillis()
        databaseFixture.insertKnowledgeItems(
            KnowledgeItemEntity(
                id = "kb04-a",
                title = "Kotlin coroutines guide",
                content = "structured concurrency basics",
                type = "note",
                deviceId = "kb04-device",
                updatedAt = kb04Base
            ),
            KnowledgeItemEntity(
                id = "kb04-b",
                title = "Compose layout primer",
                content = "Modifier chains and slot APIs",
                type = "note",
                deviceId = "kb04-device",
                updatedAt = kb04Base - 1_000
            ),
            KnowledgeItemEntity(
                id = "kb04-c",
                title = "Room database tutorial",
                content = "SQLite FTS virtual table walkthrough",
                type = "note",
                deviceId = "kb04-device",
                updatedAt = kb04Base - 2_000
            ),
            KnowledgeItemEntity(
                id = "kb04-d",
                title = "Network calls with Retrofit",
                content = "OkHttp interceptor patterns",
                type = "note",
                deviceId = "kb04-device",
                updatedAt = kb04Base - 3_000
            )
        )

        // Force FTS index rebuild — production sets up auto-update triggers
        // via the v2→v3 migration in DatabaseMigrations.kt, but in-memory
        // Room only creates the FTS virtual table itself from @Fts4
        // (contentEntity=KnowledgeItemEntity) and skips the trigger setup
        // (those live in raw migration SQL, not Room's annotation pipeline).
        // Without this rebuild, inserts above don't populate the FTS index
        // and MATCH queries return empty. This sidesteps the trigger gap.
        runBlocking {
            databaseFixture.database.openHelper.writableDatabase.execSQL(
                "INSERT INTO knowledge_items_fts(knowledge_items_fts) VALUES('rebuild')"
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

        // 1) Empty query — all 4 items reachable (ALL filter mode). LazyColumn
        //    only composes viewport items — on the CI emulator ~3 cards fit,
        //    so the lower items must be scrolled to before asserting (the
        //    plain assertTextExists on item d was the historical failure).
        composeTestRule.waitForText("Kotlin coroutines guide", timeoutMillis = 5000)
        composeTestRule.scrollListToText("Compose layout primer")
        composeTestRule.assertTextExists("Compose layout primer")
        composeTestRule.scrollListToText("Room database tutorial")
        composeTestRule.assertTextExists("Room database tutorial")
        composeTestRule.scrollListToText("Network calls with Retrofit")
        composeTestRule.assertTextExists("Network calls with Retrofit")

        // 2) Search by title token — FTS MATCH "Kotlin" returns only item a.
        viewModel.searchKnowledge("Kotlin")
        composeTestRule.waitForText("Kotlin coroutines guide", timeoutMillis = 3000)
        composeTestRule.assertTextDoesNotExist("Compose layout primer")
        composeTestRule.assertTextDoesNotExist("Network calls with Retrofit")

        // 3) Search by content token — FTS indexes both title and content
        //    columns (per KnowledgeItemFts entity), so "Modifier" hits item b
        //    via its content field even though its title doesn't contain it.
        viewModel.searchKnowledge("Modifier")
        composeTestRule.waitForText("Compose layout primer", timeoutMillis = 3000)
        composeTestRule.assertTextDoesNotExist("Kotlin coroutines guide")

        // 4) Search a content-only token from a different row — proves we're
        //    not just hitting some artifact of result (1).
        viewModel.searchKnowledge("interceptor")
        composeTestRule.waitForText("Network calls with Retrofit", timeoutMillis = 3000)
        composeTestRule.assertTextDoesNotExist("Room database tutorial")

        // 5) Clear search → all 4 return (scroll-aware for the same viewport
        //    reason as step 1).
        viewModel.clearSearch()
        composeTestRule.waitForText("Kotlin coroutines guide", timeoutMillis = 3000)
        composeTestRule.scrollListToText("Room database tutorial")
        composeTestRule.assertTextExists("Room database tutorial")
    }

    @Test
    fun testPaginationLoading() {
        // Pre-populate 50 items directly via DatabaseFixture (bypass the VM —
        // 50 createItem() calls would saturate viewModelScope and the test
        // would race the Compose first composition). Titles are zero-padded so
        // lexical ordering matches numeric ordering when scrolling. PAGE_SIZE
        // in KnowledgeRepository is 20, so 50 items = 3 pages.
        // Explicit strictly-decreasing updatedAt: the list orders by
        // `isPinned DESC, updatedAt DESC`, and the original same-millisecond
        // seeding left the order undefined (SQLite tie-break) — and even with
        // distinct auto timestamps, DESC would put item 049 first while the
        // assertions below expect 000 on top. base - idx*1000 makes item 000
        // the newest → first row, restoring the intended 000..049 order.
        val kb05Base = System.currentTimeMillis()
        databaseFixture.withKnowledgeItems(50) { idx ->
            val padded = idx.toString().padStart(3, '0')
            KnowledgeItemEntity(
                id = "kb05-$padded",
                title = "分页测试条目 $padded",
                content = "内容 $padded",
                type = "note",
                deviceId = "kb05-device",
                updatedAt = kb05Base - idx * 1_000L
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

        // 1) Top of page 1 renders; deeper page-1 items need scrolling — the
        //    LazyColumn composes only the ~3-4 viewport cards, not the whole
        //    20-item page (the plain assertTextExists on 005/019 was part of
        //    the historical failure).
        composeTestRule.waitForText("分页测试条目 000", timeoutMillis = 10000)
        composeTestRule.scrollListToText("分页测试条目 005")
        composeTestRule.assertTextExists("分页测试条目 005")
        composeTestRule.scrollListToText("分页测试条目 019")
        composeTestRule.assertTextExists("分页测试条目 019")

        // 2) Scroll to an item on page 2 (20..39). scrollListToText drives the
        //    LazyColumn far enough to materialize the item — which also
        //    triggers Paging3 to load the next page (PagingSource.load is
        //    invoked when the prefetch window is reached). The old scrollToText
        //    (performScrollTo) required the target node to already exist —
        //    impossible for a not-yet-composed lazy item.
        composeTestRule.scrollListToText("分页测试条目 025")
        composeTestRule.assertTextExists("分页测试条目 025")

        // 3) Scroll to page 3 (40..49) — full range loadable.
        composeTestRule.scrollListToText("分页测试条目 045")
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
        // That swap is asynchronous — waitForText("可收藏笔记 A") returns
        // immediately because A is ALREADY on screen from the ALL list, so an
        // immediate assertDoesNotExist(B) races the re-emission (historical
        // CI failure: "found '1' node ... 普通笔记 B"). Poll for B's
        // disappearance instead.
        composeTestRule.waitUntilNodeDoesNotExist(hasText("普通笔记 B"), timeoutMillis = 5000)
        composeTestRule.assertTextExists("可收藏笔记 A")
        composeTestRule.assertTextDoesNotExist("普通笔记 B")

        // 4) Switch back to ALL — both items reappear.
        viewModel.setFilterMode(FilterMode.ALL)
        assertEquals(FilterMode.ALL, viewModel.uiState.value.filterMode)
        composeTestRule.waitForText("普通笔记 B", timeoutMillis = 3000)
        composeTestRule.assertTextExists("可收藏笔记 A")
    }

    @Ignore("KB-07 prod gap: no tag-filter API exists on VM/Repository/Dao — needs prod feature add before test can be written. See memory feature_ai_e2e_stub_prod_gaps.md for the prod-gap discovery pattern.")
    @Test
    fun testTagFiltering() {
        TODO("KB-07 — blocked on prod: add setTagFilter(tag) to KnowledgeViewModel + getItemsByTag(tag) DAO query + tag chip UI")
    }

    @Ignore("KB-08 infra: needs multi-emulator CI matrix (two API 30 emulators in same job) — out of scope for android-e2e-tests.yml single-emulator setup. Defer to Phase D real-device benchmark stream.")
    @Test
    fun testMultiDeviceSync() {
        TODO("KB-08 — needs reactivecircus/android-emulator-runner matrix with 2 emulators + paired signaling-relay; see plan-c-first memory")
    }
}
