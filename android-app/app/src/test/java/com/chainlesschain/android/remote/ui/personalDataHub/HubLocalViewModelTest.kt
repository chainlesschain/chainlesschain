package com.chainlesschain.android.remote.ui.personalDataHub

import android.content.Context
import com.chainlesschain.android.pdh.LocalCcRunner
import com.chainlesschain.android.pdh.LocalSystemDataSnapshotter
import com.chainlesschain.android.pdh.llm.LocalLlmServer
import com.chainlesschain.android.pdh.social.bilibili.BilibiliCredentialsStore
import com.chainlesschain.android.pdh.social.bilibili.BilibiliLocalCollector
import com.chainlesschain.android.pdh.social.wechat.WeChatCredentialsStore
import com.chainlesschain.android.pdh.social.wechat.WeChatLocalCollector
import io.mockk.coEvery
import io.mockk.every
import io.mockk.just
import io.mockk.mockk
import io.mockk.runs
import io.mockk.verify
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * A8 v0.1 — HubLocalViewModel unit cover. Mocks the 4 deps (snapshotter /
 * ccRunner / bilibiliCollector / bilibiliCredentials) and verifies state
 * transitions. Mirrors HubAdaptersViewModelTest pattern: StandardTestDispatcher
 * + Dispatchers.setMain + advanceUntilIdle.
 *
 * Tests cover the A8 surface (Bilibili card lifecycle + global mutex). System-
 * data card flows aren't covered here — they have separate
 * LocalSystemDataSnapshotter tests and LocalCcRunner parse tests.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class HubLocalViewModelTest {

    private val testDispatcher = StandardTestDispatcher()

    private lateinit var snapshotter: LocalSystemDataSnapshotter
    private lateinit var ccRunner: LocalCcRunner
    private lateinit var bilibiliCollector: BilibiliLocalCollector
    private lateinit var bilibiliCredentials: BilibiliCredentialsStore
    private lateinit var wechatCollector: WeChatLocalCollector
    private lateinit var wechatCredentials: WeChatCredentialsStore
    private lateinit var llmServer: LocalLlmServer
    private lateinit var appContext: Context

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
        snapshotter = mockk(relaxed = true)
        ccRunner = mockk(relaxed = false)
        bilibiliCollector = mockk(relaxed = false)
        bilibiliCredentials = mockk(relaxed = true)
        wechatCollector = mockk(relaxed = true)
        wechatCredentials = mockk(relaxed = true)
        llmServer = mockk(relaxed = true)
        appContext = mockk(relaxed = true)
        // A3 default: server "started" with deterministic baseUrl so ask
        // tests can assert ccRunner.askQuestion was called with this URL.
        every { llmServer.baseUrl } returns "http://127.0.0.1:18484"
        every { llmServer.boundPort } returns 18484
        // External-files-dir for export tests — relaxed mock returns null by
        // default; tests that exercise export override this with a tmp dir.
        every { appContext.getExternalFilesDir(any()) } returns null
        // Default: not logged in, no past sync
        every { bilibiliCredentials.hasCredentials() } returns false
        every { bilibiliCredentials.getUid() } returns null
        every { bilibiliCredentials.getLastSyncAt() } returns null
        every { bilibiliCredentials.getLastSyncCount() } returns 0
        every { snapshotter.hasContactsPermission() } returns false
    }

    @After
    fun tearDown() { Dispatchers.resetMain() }

    private fun newVm(): HubLocalViewModel =
        HubLocalViewModel(
            snapshotter,
            ccRunner,
            bilibiliCollector,
            bilibiliCredentials,
            wechatCollector,
            wechatCredentials,
            llmServer,
            appContext,
        )

    // ─── Initialization ─────────────────────────────────────────────────────

    @Test
    fun `init reads bilibili credentials state from store`() = runTest(testDispatcher) {
        every { bilibiliCredentials.hasCredentials() } returns true
        every { bilibiliCredentials.getUid() } returns 12345L
        every { bilibiliCredentials.getLastSyncAt() } returns 1716000000000L
        every { bilibiliCredentials.getLastSyncCount() } returns 99

        val vm = newVm()
        advanceUntilIdle()

        assertTrue(vm.state.value.bilibili.isLoggedIn)
        assertEquals(12345L, vm.state.value.bilibili.uid)
        assertEquals(1716000000000L, vm.state.value.bilibili.lastSyncAt)
        assertEquals(99, vm.state.value.bilibili.lastSyncCount)
    }

    @Test
    fun `init reads contacts permission state`() = runTest(testDispatcher) {
        every { snapshotter.hasContactsPermission() } returns true
        val vm = newVm()
        advanceUntilIdle()
        assertTrue(vm.state.value.systemData.contactsPermissionGranted)
    }

    @Test
    fun `init renders all 4 social cards (1 implemented + 3 stub)`() = runTest(testDispatcher) {
        val vm = newVm()
        advanceUntilIdle()
        assertTrue(vm.state.value.bilibili.implemented)
        assertFalse(vm.state.value.weibo.implemented)
        assertFalse(vm.state.value.douyin.implemented)
        assertFalse(vm.state.value.xiaohongshu.implemented)
    }

    // ─── Login lifecycle ────────────────────────────────────────────────────

    @Test
    fun `requestBilibiliLogin sets pendingLogin with correct URL`() = runTest(testDispatcher) {
        val vm = newVm()
        advanceUntilIdle()
        vm.requestBilibiliLogin()
        val pending = vm.state.value.pendingLogin
        assertNotNull(pending)
        assertEquals("social-bilibili", pending.adapterName)
        assertEquals("Bilibili", pending.displayName)
        assertTrue(pending.loginUrl.startsWith("https://passport.bilibili.com/"))
        assertTrue(pending.cookieDomain.contains("bilibili.com"))
    }

    @Test
    fun `isLoginSuccess accepts www-bilibili and rejects passport URL`() = runTest(testDispatcher) {
        val vm = newVm()
        advanceUntilIdle()
        vm.requestBilibiliLogin()
        val pending = vm.state.value.pendingLogin!!
        assertTrue(pending.isLoginSuccess("https://www.bilibili.com/"))
        assertTrue(pending.isLoginSuccess("https://m.bilibili.com/"))
        assertFalse(pending.isLoginSuccess("https://passport.bilibili.com/login"))
        // Pre-login redirects (e.g. captcha) should NOT match
        assertFalse(pending.isLoginSuccess("https://www.bilibili.com/passport.bilibili.com/captcha"))
    }

    @Test
    fun `onBilibiliLoginCookie accepts cookie + clears pendingLogin + refreshes state`() = runTest(testDispatcher) {
        every { bilibiliCollector.acceptLoginCookie(any()) } returns true
        // After acceptance, store now reflects logged-in
        every { bilibiliCredentials.hasCredentials() } returnsMany listOf(false, true)
        every { bilibiliCredentials.getUid() } returnsMany listOf(null, 12345L)

        val vm = newVm()
        advanceUntilIdle()
        vm.requestBilibiliLogin()
        vm.onBilibiliLoginCookie("SESSDATA=x; DedeUserID=12345")
        advanceUntilIdle()

        assertNull(vm.state.value.pendingLogin)
        assertTrue(vm.state.value.bilibili.isLoggedIn)
        assertEquals(12345L, vm.state.value.bilibili.uid)
        verify { bilibiliCollector.acceptLoginCookie("SESSDATA=x; DedeUserID=12345") }
    }

    @Test
    fun `onBilibiliLoginCookie surface error when DedeUserID missing`() = runTest(testDispatcher) {
        every { bilibiliCollector.acceptLoginCookie(any()) } returns false

        val vm = newVm()
        advanceUntilIdle()
        vm.requestBilibiliLogin()
        vm.onBilibiliLoginCookie("SESSDATA=expired")
        advanceUntilIdle()

        assertNull(vm.state.value.pendingLogin)
        assertFalse(vm.state.value.bilibili.isLoggedIn)
        assertNotNull(vm.state.value.bilibili.errorMessage)
        assertTrue(vm.state.value.bilibili.errorMessage!!.contains("DedeUserID"))
    }

    @Test
    fun `cancelLogin clears pendingLogin without touching credentials`() = runTest(testDispatcher) {
        val vm = newVm()
        advanceUntilIdle()
        vm.requestBilibiliLogin()
        vm.cancelLogin()
        assertNull(vm.state.value.pendingLogin)
        verify(exactly = 0) { bilibiliCollector.acceptLoginCookie(any()) }
    }

    // ─── syncBilibili paths ─────────────────────────────────────────────────

    @Test
    fun `syncBilibili when not logged in triggers requestBilibiliLogin instead`() = runTest(testDispatcher) {
        every { bilibiliCredentials.hasCredentials() } returns false

        val vm = newVm()
        advanceUntilIdle()
        vm.syncBilibili()
        advanceUntilIdle()

        // VM should have pendingLogin set, not actually run a sync
        assertNotNull(vm.state.value.pendingLogin)
        // Collector should NOT have been called
        coVerifyNoSnapshot()
    }

    @Test
    fun `syncBilibili NoCredentials path surfaces 未登录 error`() = runTest(testDispatcher) {
        // Logged in at boot but collector reports NoCredentials (race / cleared after init)
        every { bilibiliCredentials.hasCredentials() } returns true
        every { bilibiliCredentials.getUid() } returns 12345L
        coEvery { bilibiliCollector.snapshot() } returns
            BilibiliLocalCollector.SnapshotResult.NoCredentials

        val vm = newVm()
        advanceUntilIdle()
        vm.syncBilibili()
        advanceUntilIdle()

        assertFalse(vm.state.value.bilibili.isLoggedIn)
        assertNotNull(vm.state.value.bilibili.errorMessage)
        assertTrue(vm.state.value.bilibili.errorMessage!!.contains("未登录"))
        assertNull(vm.state.value.globalSyncingAdapter)
    }

    @Test
    fun `syncBilibili everythingEmpty path surfaces cookie expired hint`() = runTest(testDispatcher) {
        every { bilibiliCredentials.hasCredentials() } returns true
        every { bilibiliCredentials.getUid() } returns 12345L
        coEvery { bilibiliCollector.snapshot() } returns
            BilibiliLocalCollector.SnapshotResult.Ok(
                snapshotPath = "/tmp/x.json",
                historyCount = 0, favouriteCount = 0,
                dynamicCount = 0, followCount = 0,
                totalEvents = 0, everythingEmpty = true,
                snapshottedAt = 1L,
            )

        val vm = newVm()
        advanceUntilIdle()
        vm.syncBilibili()
        advanceUntilIdle()

        assertNotNull(vm.state.value.bilibili.errorMessage)
        assertTrue(vm.state.value.bilibili.errorMessage!!.contains("cookie 可能过期"))
        assertNull(vm.state.value.globalSyncingAdapter)
    }

    @Test
    fun `syncBilibili Ok path runs ccRunner and updates lastSync`() = runTest(testDispatcher) {
        every { bilibiliCredentials.hasCredentials() } returns true
        every { bilibiliCredentials.getUid() } returns 12345L
        val syncAt = 1716000000000L
        coEvery { bilibiliCollector.snapshot() } returns
            BilibiliLocalCollector.SnapshotResult.Ok(
                snapshotPath = "/tmp/snap.json",
                historyCount = 10, favouriteCount = 5,
                dynamicCount = 3, followCount = 7,
                totalEvents = 25, everythingEmpty = false,
                snapshottedAt = syncAt,
            )
        coEvery { ccRunner.syncAdapter("social-bilibili", "/tmp/snap.json") } returns
            LocalCcRunner.CcResult.Ok(
                report = LocalCcRunner.SyncReport(
                    adapter = "social-bilibili", status = "ok",
                    ingested = 25, invalidCount = 0,
                    kgTriples = 50, ragDocs = 10,
                    durationMs = 1500L, error = null,
                ),
                rawJson = "{}",
            )

        val vm = newVm()
        advanceUntilIdle()
        vm.syncBilibili()
        advanceUntilIdle()

        assertEquals(syncAt, vm.state.value.bilibili.lastSyncAt)
        assertEquals(25, vm.state.value.bilibili.lastSyncCount)
        assertNull(vm.state.value.bilibili.errorMessage)
        assertNull(vm.state.value.globalSyncingAdapter)
    }

    @Test
    fun `syncBilibili ccRunner Failed surfaces error`() = runTest(testDispatcher) {
        every { bilibiliCredentials.hasCredentials() } returns true
        every { bilibiliCredentials.getUid() } returns 12345L
        coEvery { bilibiliCollector.snapshot() } returns
            BilibiliLocalCollector.SnapshotResult.Ok(
                snapshotPath = "/tmp/snap.json",
                historyCount = 1, favouriteCount = 0,
                dynamicCount = 0, followCount = 0,
                totalEvents = 1, everythingEmpty = false,
                snapshottedAt = 1L,
            )
        coEvery { ccRunner.syncAdapter(any(), any()) } returns
            LocalCcRunner.CcResult.Failed(reason = "ENOENT bs3mc", exitCode = 1, stderr = "...")

        val vm = newVm()
        advanceUntilIdle()
        vm.syncBilibili()
        advanceUntilIdle()

        assertNotNull(vm.state.value.bilibili.errorMessage)
        assertTrue(vm.state.value.bilibili.errorMessage!!.contains("ENOENT bs3mc"))
        assertNull(vm.state.value.globalSyncingAdapter)
    }

    // ─── Logout ─────────────────────────────────────────────────────────────

    @Test
    fun `logoutBilibili calls collector and clears state`() = runTest(testDispatcher) {
        every { bilibiliCredentials.hasCredentials() } returns true
        every { bilibiliCredentials.getUid() } returns 12345L
        every { bilibiliCollector.logout() } just runs

        val vm = newVm()
        advanceUntilIdle()
        vm.logoutBilibili()
        advanceUntilIdle()

        verify { bilibiliCollector.logout() }
        assertFalse(vm.state.value.bilibili.isLoggedIn)
        assertNull(vm.state.value.bilibili.uid)
    }

    // ─── Other 3 social stubs ───────────────────────────────────────────────

    @Test
    fun `requestSocialLoginStub for weibo surfaces error on weibo card only`() = runTest(testDispatcher) {
        val vm = newVm()
        advanceUntilIdle()
        vm.requestSocialLoginStub("weibo")
        assertNotNull(vm.state.value.weibo.errorMessage)
        assertTrue(vm.state.value.weibo.errorMessage!!.contains("v0.2"))
        // Other cards untouched
        assertNull(vm.state.value.douyin.errorMessage)
        assertNull(vm.state.value.xiaohongshu.errorMessage)
        assertNull(vm.state.value.bilibili.errorMessage)
    }

    @Test
    fun `requestSocialLoginStub unknown platform is no-op`() = runTest(testDispatcher) {
        val vm = newVm()
        advanceUntilIdle()
        vm.requestSocialLoginStub("nonexistent")
        // All cards still clean
        assertNull(vm.state.value.weibo.errorMessage)
        assertNull(vm.state.value.douyin.errorMessage)
    }

    private fun coVerifyNoSnapshot() {
        io.mockk.coVerify(exactly = 0) { bilibiliCollector.snapshot() }
    }

    // ─── A3 — askQuestion ────────────────────────────────────────────────────

    @Test
    fun `askQuestion no-op when question blank`() = runTest(testDispatcher) {
        val vm = newVm()
        advanceUntilIdle()
        vm.askQuestion()
        advanceUntilIdle()
        assertFalse(vm.state.value.ask.isAsking)
        io.mockk.coVerify(exactly = 0) { ccRunner.askQuestion(any(), any(), any(), any()) }
    }

    @Test
    fun `askQuestion success populates answer + citations + llmName`() = runTest(testDispatcher) {
        coEvery { ccRunner.askQuestion(any(), any(), any(), any()) } returns LocalCcRunner.AskResult.Ok(
            report = LocalCcRunner.AskReport(
                answer = "上周妈妈给你打了 2 个电话。",
                citations = listOf(
                    LocalCcRunner.AskReport.Citation(
                        eventId = "evt_abc",
                        excerpt = "通话 · 2026-05-15",
                        source = "system-data-android",
                    ),
                    LocalCcRunner.AskReport.Citation(
                        eventId = "evt_def",
                        excerpt = null,
                        source = "system-data-android",
                    ),
                ),
                llmName = "ollama:qwen2.5-1.5b-instruct",
                isLocal = true,
                durationMs = 4200L,
            ),
            rawJson = "{...}",
        )
        val vm = newVm()
        advanceUntilIdle()

        vm.onAskQuestionChanged("上周谁给我打过电话")
        vm.askQuestion()
        advanceUntilIdle()

        val s = vm.state.value.ask
        assertFalse(s.isAsking)
        assertEquals("上周妈妈给你打了 2 个电话。", s.answer)
        assertEquals(2, s.citations.size)
        assertEquals("evt_abc", s.citations[0].eventId)
        assertTrue(s.isLocal)
        assertEquals("ollama:qwen2.5-1.5b-instruct", s.llmName)
        assertEquals(4200L, s.durationMs)
        assertNull(s.errorMessage)
    }

    @Test
    fun `askQuestion failure rewrites Ollama errors to friendly hint`() = runTest(testDispatcher) {
        coEvery { ccRunner.askQuestion(any(), any(), any(), any()) } returns LocalCcRunner.AskResult.Failed(
            reason = "OllamaClient.chat: request failed — fetch failed",
            exitCode = 1,
            stderr = null,
        )
        val vm = newVm()
        advanceUntilIdle()
        vm.onAskQuestionChanged("test")
        vm.askQuestion()
        advanceUntilIdle()

        val s = vm.state.value.ask
        assertFalse(s.isAsking)
        assertNotNull(s.errorMessage)
        assertTrue(s.errorMessage!!.contains("端侧 LLM 未启动"))
    }

    @Test
    fun `askQuestion failure surfaces other errors verbatim`() = runTest(testDispatcher) {
        coEvery { ccRunner.askQuestion(any(), any(), any(), any()) } returns LocalCcRunner.AskResult.Failed(
            reason = "vault locked: key missing",
            exitCode = 2,
            stderr = null,
        )
        val vm = newVm()
        advanceUntilIdle()
        vm.onAskQuestionChanged("test")
        vm.askQuestion()
        advanceUntilIdle()

        val s = vm.state.value.ask
        assertEquals("vault locked: key missing", s.errorMessage)
        assertFalse(s.errorMessage!!.contains("LLM 未启动"))
    }

    @Test
    fun `askQuestion forwards acceptNonLocal=false by default`() = runTest(testDispatcher) {
        coEvery { ccRunner.askQuestion(any(), any(), any(), any()) } returns LocalCcRunner.AskResult.Ok(
            report = LocalCcRunner.AskReport(
                answer = "ok",
                citations = emptyList(),
                llmName = null, isLocal = true, durationMs = 0L,
            ),
            rawJson = "{}",
        )
        val vm = newVm()
        advanceUntilIdle()
        vm.onAskQuestionChanged("q")
        vm.askQuestion()
        advanceUntilIdle()
        // Default toggle is OFF → cc gets acceptNonLocal=false → no --accept-non-local flag.
        io.mockk.coVerify(exactly = 1) {
            ccRunner.askQuestion(
                question = "q",
                ollamaUrl = "http://127.0.0.1:18484",
                acceptNonLocal = false,
                timeoutMs = any(),
            )
        }
    }

    @Test
    fun `askQuestion forwards acceptNonLocal=true when toggle ON`() = runTest(testDispatcher) {
        coEvery { ccRunner.askQuestion(any(), any(), any(), any()) } returns LocalCcRunner.AskResult.Ok(
            report = LocalCcRunner.AskReport(
                answer = "ok",
                citations = emptyList(),
                llmName = null, isLocal = false, durationMs = 0L,
            ),
            rawJson = "{}",
        )
        val vm = newVm()
        advanceUntilIdle()
        vm.setAllowCloudFallback(true)
        vm.onAskQuestionChanged("q")
        vm.askQuestion()
        advanceUntilIdle()
        // Toggle ON → cc gets acceptNonLocal=true → ccRunner appends --accept-non-local.
        io.mockk.coVerify(exactly = 1) {
            ccRunner.askQuestion(
                question = "q",
                ollamaUrl = "http://127.0.0.1:18484",
                acceptNonLocal = true,
                timeoutMs = any(),
            )
        }
    }

    @Test
    fun `clearAskAnswer wipes answer + citations + error`() = runTest(testDispatcher) {
        coEvery { ccRunner.askQuestion(any(), any(), any(), any()) } returns LocalCcRunner.AskResult.Ok(
            report = LocalCcRunner.AskReport(
                answer = "hi",
                citations = listOf(
                    LocalCcRunner.AskReport.Citation("evt_1", null, null),
                ),
                llmName = null, isLocal = true, durationMs = 100L,
            ),
            rawJson = "{}",
        )
        val vm = newVm()
        advanceUntilIdle()
        vm.onAskQuestionChanged("q")
        vm.askQuestion()
        advanceUntilIdle()
        assertNotNull(vm.state.value.ask.answer)

        vm.clearAskAnswer()
        assertNull(vm.state.value.ask.answer)
        assertTrue(vm.state.value.ask.citations.isEmpty())
        assertNull(vm.state.value.ask.errorMessage)
    }

    // ─── 三道锁 ─────────────────────────────────────────────────────────────

    @Test
    fun `setAllowCloudFallback toggles state`() = runTest(testDispatcher) {
        val vm = newVm()
        advanceUntilIdle()
        assertFalse(vm.state.value.threeLocks.allowCloudFallback)
        vm.setAllowCloudFallback(true)
        assertTrue(vm.state.value.threeLocks.allowCloudFallback)
        vm.setAllowCloudFallback(false)
        assertFalse(vm.state.value.threeLocks.allowCloudFallback)
    }

    @Test
    fun `requestDestroyVault success wipes systemData + sets lastDestroyedAt`() = runTest(testDispatcher) {
        coEvery { ccRunner.destroyVault(any()) } returns LocalCcRunner.DestroyResult.Ok
        val vm = newVm()
        advanceUntilIdle()

        vm.requestDestroyVault()
        // First tick: destroying=true + globalSyncingAdapter set
        assertTrue(vm.state.value.threeLocks.destroying)
        assertEquals("vault-destroy", vm.state.value.globalSyncingAdapter)

        advanceUntilIdle()
        val s = vm.state.value
        assertFalse(s.threeLocks.destroying)
        assertNull(s.threeLocks.destroyError)
        assertNotNull(s.threeLocks.lastDestroyedAt)
        assertNull(s.globalSyncingAdapter)
        // systemData reset
        assertEquals(0, s.systemData.contactsCount)
        assertEquals(0, s.systemData.appsCount)
        assertEquals(0, s.systemData.ingested)
    }

    @Test
    fun `requestDestroyVault failure surfaces error`() = runTest(testDispatcher) {
        coEvery { ccRunner.destroyVault(any()) } returns
            LocalCcRunner.DestroyResult.Failed("file system locked", 2)
        val vm = newVm()
        advanceUntilIdle()

        vm.requestDestroyVault()
        advanceUntilIdle()

        val s = vm.state.value
        assertFalse(s.threeLocks.destroying)
        assertEquals("file system locked", s.threeLocks.destroyError)
        assertNull(s.threeLocks.lastDestroyedAt)
        assertNull(s.globalSyncingAdapter)
    }

    @Test
    fun `requestDestroyVault no-op while already destroying or syncing`() = runTest(testDispatcher) {
        coEvery { ccRunner.destroyVault(any()) } coAnswers {
            kotlinx.coroutines.delay(1_000_000L)
            LocalCcRunner.DestroyResult.Ok
        }
        val vm = newVm()
        advanceUntilIdle()

        vm.requestDestroyVault()
        assertTrue(vm.state.value.threeLocks.destroying)

        // Second call should be ignored
        vm.requestDestroyVault()
        io.mockk.coVerify(exactly = 1) { ccRunner.destroyVault(any()) }
    }

    @Test
    fun `requestExportVault success populates lastExportPath`() = runTest(testDispatcher) {
        val tmpDir = java.io.File.createTempFile("hubexport-", "").apply {
            delete(); mkdirs()
        }
        every { appContext.getExternalFilesDir(any()) } returns tmpDir
        coEvery { ccRunner.exportVault(any(), any()) } answers {
            LocalCcRunner.ExportResult.Ok(
                outputPath = firstArg<String>(),
                bytes = 1024L * 1024L,
                encrypted = true,
            )
        }
        val vm = newVm()
        advanceUntilIdle()
        vm.requestExportVault()
        advanceUntilIdle()
        val s = vm.state.value
        assertFalse(s.threeLocks.exporting)
        assertNull(s.threeLocks.exportError)
        assertNotNull(s.threeLocks.lastExportPath)
        assertTrue(s.threeLocks.lastExportPath!!.contains("chainlesschain-vault-"))
        assertEquals(1024L * 1024L, s.threeLocks.lastExportBytes)
        tmpDir.deleteRecursively()
    }

    @Test
    fun `requestExportVault failure when external storage unavailable`() = runTest(testDispatcher) {
        every { appContext.getExternalFilesDir(any()) } returns null
        val vm = newVm()
        advanceUntilIdle()
        vm.requestExportVault()
        advanceUntilIdle()
        val s = vm.state.value
        assertFalse(s.threeLocks.exporting)
        assertNotNull(s.threeLocks.exportError)
        assertTrue(s.threeLocks.exportError!!.contains("External storage"))
    }

    @Test
    fun `requestExportVault failure surfaces cc error`() = runTest(testDispatcher) {
        val tmpDir = java.io.File.createTempFile("hubexport-", "").apply {
            delete(); mkdirs()
        }
        every { appContext.getExternalFilesDir(any()) } returns tmpDir
        coEvery { ccRunner.exportVault(any(), any()) } returns
            LocalCcRunner.ExportResult.Failed("disk full", 2)
        val vm = newVm()
        advanceUntilIdle()
        vm.requestExportVault()
        advanceUntilIdle()
        val s = vm.state.value
        assertFalse(s.threeLocks.exporting)
        assertEquals("disk full", s.threeLocks.exportError)
        assertNull(s.threeLocks.lastExportPath)
        tmpDir.deleteRecursively()
    }

    @Test
    fun `requestExportVault ignored while already exporting`() = runTest(testDispatcher) {
        val tmpDir = java.io.File.createTempFile("hubexport-", "").apply {
            delete(); mkdirs()
        }
        every { appContext.getExternalFilesDir(any()) } returns tmpDir
        coEvery { ccRunner.exportVault(any(), any()) } coAnswers {
            kotlinx.coroutines.delay(1_000_000L)
            LocalCcRunner.ExportResult.Ok("x", 0L, true)
        }
        val vm = newVm()
        advanceUntilIdle()
        vm.requestExportVault()
        assertTrue(vm.state.value.threeLocks.exporting)
        vm.requestExportVault()
        io.mockk.coVerify(exactly = 1) { ccRunner.exportVault(any(), any()) }
        tmpDir.deleteRecursively()
    }

    @Test
    fun `clearExportError wipes error`() = runTest(testDispatcher) {
        val tmpDir = java.io.File.createTempFile("hubexport-", "").apply {
            delete(); mkdirs()
        }
        every { appContext.getExternalFilesDir(any()) } returns tmpDir
        coEvery { ccRunner.exportVault(any(), any()) } returns
            LocalCcRunner.ExportResult.Failed("io error", 1)
        val vm = newVm()
        advanceUntilIdle()
        vm.requestExportVault()
        advanceUntilIdle()
        assertNotNull(vm.state.value.threeLocks.exportError)
        vm.clearExportError()
        assertNull(vm.state.value.threeLocks.exportError)
        tmpDir.deleteRecursively()
    }

    // ─── Citation detail (推文 §AI 给出处 · 点一下看原文) ───────────────────

    @Test
    fun `requestCitationDetail success populates event`() = runTest(testDispatcher) {
        val ev = LocalCcRunner.VaultEvent(
            id = "evt_abc",
            subtype = "wechat.message",
            source = "wechat-adapter",
            title = "上周通话",
            actor = "mother",
            amount = null,
            currency = null,
            startedAt = 1716000000000L,
        )
        coEvery { ccRunner.queryEvent(any(), any()) } returns
            LocalCcRunner.EventDetailResult.Ok(event = ev)
        val vm = newVm()
        advanceUntilIdle()

        vm.requestCitationDetail("evt_abc")
        assertTrue(vm.state.value.citationDetail.visible)
        assertTrue(vm.state.value.citationDetail.loading)

        advanceUntilIdle()
        val cd = vm.state.value.citationDetail
        assertTrue(cd.visible)
        assertFalse(cd.loading)
        assertEquals(ev, cd.event)
        assertFalse(cd.notFound)
        assertNull(cd.errorMessage)
    }

    @Test
    fun `requestCitationDetail not found surfaces notFound flag`() = runTest(testDispatcher) {
        coEvery { ccRunner.queryEvent(any(), any()) } returns
            LocalCcRunner.EventDetailResult.NotFound(eventId = "evt_xyz")
        val vm = newVm()
        advanceUntilIdle()
        vm.requestCitationDetail("evt_xyz")
        advanceUntilIdle()
        val cd = vm.state.value.citationDetail
        assertTrue(cd.notFound)
        assertNull(cd.event)
    }

    @Test
    fun `requestCitationDetail failure surfaces errorMessage`() = runTest(testDispatcher) {
        coEvery { ccRunner.queryEvent(any(), any()) } returns
            LocalCcRunner.EventDetailResult.Failed("io error", 1)
        val vm = newVm()
        advanceUntilIdle()
        vm.requestCitationDetail("evt_y")
        advanceUntilIdle()
        val cd = vm.state.value.citationDetail
        assertEquals("io error", cd.errorMessage)
        assertNull(cd.event)
    }

    @Test
    fun `dismissCitationDetail clears state`() = runTest(testDispatcher) {
        coEvery { ccRunner.queryEvent(any(), any()) } returns
            LocalCcRunner.EventDetailResult.NotFound(eventId = "evt_a")
        val vm = newVm()
        advanceUntilIdle()
        vm.requestCitationDetail("evt_a")
        advanceUntilIdle()
        assertTrue(vm.state.value.citationDetail.visible)
        vm.dismissCitationDetail()
        assertFalse(vm.state.value.citationDetail.visible)
        assertNull(vm.state.value.citationDetail.eventId)
    }

    @Test
    fun `requestCitationDetail blank eventId is no-op`() = runTest(testDispatcher) {
        val vm = newVm()
        advanceUntilIdle()
        vm.requestCitationDetail("")
        assertFalse(vm.state.value.citationDetail.visible)
        io.mockk.coVerify(exactly = 0) { ccRunner.queryEvent(any(), any()) }
    }

    @Test
    fun `clearDestroyError wipes error`() = runTest(testDispatcher) {
        coEvery { ccRunner.destroyVault(any()) } returns
            LocalCcRunner.DestroyResult.Failed("io error", 1)
        val vm = newVm()
        advanceUntilIdle()
        vm.requestDestroyVault()
        advanceUntilIdle()
        assertNotNull(vm.state.value.threeLocks.destroyError)
        vm.clearDestroyError()
        assertNull(vm.state.value.threeLocks.destroyError)
    }

    @Test
    fun `askQuestion ignored while already in flight`() = runTest(testDispatcher) {
        // First call hangs (never completes): use a slot to capture the call,
        // then assert second call is silently rejected.
        coEvery { ccRunner.askQuestion(any(), any(), any(), any()) } coAnswers {
            kotlinx.coroutines.delay(1_000_000)
            LocalCcRunner.AskResult.Failed("unreachable", null, null)
        }
        val vm = newVm()
        advanceUntilIdle()
        vm.onAskQuestionChanged("q")
        vm.askQuestion()
        // Don't advance — first call stays in flight
        assertTrue(vm.state.value.ask.isAsking)

        // Second call should be a no-op (still isAsking)
        vm.askQuestion()
        io.mockk.coVerify(exactly = 1) { ccRunner.askQuestion(any(), any(), any(), any()) }
    }

    // ─── §2.9 本机 audit (推文 §"每次操作都有账本") ──────────────────────────

    @Test
    fun `refreshAudit Ok populates rows + lastRefreshAt`() = runTest(testDispatcher) {
        val rows = listOf(
            LocalCcRunner.AuditRow(
                at = 1_716_000_000_000L,
                action = "ingest",
                adapter = "system-data-android",
                eventId = null,
            ),
            LocalCcRunner.AuditRow(
                at = 1_716_000_001_000L,
                action = "ask",
                adapter = null,
                eventId = "evt-abc123def456",
            ),
        )
        coEvery { ccRunner.queryRecentAudit(any(), any()) } returns
            LocalCcRunner.RecentAuditResult.Ok(rows = rows)

        val vm = newVm()
        advanceUntilIdle()
        vm.refreshAudit()
        advanceUntilIdle()

        val audit = vm.state.value.localAudit
        assertFalse(audit.isLoading)
        assertEquals(2, audit.rows.size)
        assertEquals("ingest", audit.rows[0].action)
        assertEquals("evt-abc123def456", audit.rows[1].eventId)
        assertNull(audit.errorMessage)
        assertNotNull(audit.lastRefreshAt)
    }

    @Test
    fun `refreshAudit Failed surfaces errorMessage and keeps rows`() = runTest(testDispatcher) {
        coEvery { ccRunner.queryRecentAudit(any(), any()) } returns
            LocalCcRunner.RecentAuditResult.Failed("bootstrap-failed: cc shim missing", null)

        val vm = newVm()
        advanceUntilIdle()
        vm.refreshAudit()
        advanceUntilIdle()

        val audit = vm.state.value.localAudit
        assertFalse(audit.isLoading)
        assertTrue(audit.rows.isEmpty())
        assertEquals("bootstrap-failed: cc shim missing", audit.errorMessage)
    }

    @Test
    fun `refreshAudit reentrancy guard — second call no-ops while loading`() = runTest(testDispatcher) {
        // First call hangs forever; second call must take the early-return
        // branch (`if (isLoading) return`) without spawning a second cc.
        //
        // We verify via state, not mockk coVerify — Kotlin lowers default-arg
        // calls (queryRecentAudit(limit = 50)) through a synthetic $default
        // method, and mockk coVerify's matcher arity doesn't line up with the
        // $default signature, producing spurious "was not called" failures
        // even when the call was made. State-based check sidesteps that.
        coEvery { ccRunner.queryRecentAudit(any(), any()) } coAnswers {
            kotlinx.coroutines.delay(1_000_000)
            LocalCcRunner.RecentAuditResult.Ok(rows = emptyList())
        }
        val vm = newVm()
        advanceUntilIdle()
        vm.refreshAudit()
        // First call set isLoading=true synchronously before viewModelScope.launch.
        assertTrue(vm.state.value.localAudit.isLoading)
        // Second call: guard returns early, state unchanged.
        vm.refreshAudit()
        assertTrue(vm.state.value.localAudit.isLoading)
        assertTrue(vm.state.value.localAudit.rows.isEmpty())
        assertNull(vm.state.value.localAudit.errorMessage)
    }

    @Test
    fun `clearAuditError nulls errorMessage`() = runTest(testDispatcher) {
        coEvery { ccRunner.queryRecentAudit(any(), any()) } returns
            LocalCcRunner.RecentAuditResult.Failed("io error", 1)
        val vm = newVm()
        advanceUntilIdle()
        vm.refreshAudit()
        advanceUntilIdle()
        assertNotNull(vm.state.value.localAudit.errorMessage)
        vm.clearAuditError()
        assertNull(vm.state.value.localAudit.errorMessage)
    }
}
