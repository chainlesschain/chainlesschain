package com.chainlesschain.android.remote.ui.personalDataHub

import android.content.Context
import com.chainlesschain.android.pdh.LocalCcRunner
import com.chainlesschain.android.pdh.LocalSystemDataSnapshotter
import com.chainlesschain.android.pdh.llm.LlmInferenceEngine
import com.chainlesschain.android.pdh.llm.LlmPreferences
import com.chainlesschain.android.pdh.llm.LocalLlmServer
import com.chainlesschain.android.pdh.llm.ModelManager
import com.chainlesschain.android.remote.commands.HealthLlm
import com.chainlesschain.android.remote.commands.HealthOk
import com.chainlesschain.android.remote.commands.HealthVault
import com.chainlesschain.android.remote.commands.HubHealth
import com.chainlesschain.android.remote.commands.PersonalDataHubCommands
import com.chainlesschain.android.pdh.messaging.qq.QQCredentialsStore
import com.chainlesschain.android.pdh.messaging.qq.QQLocalCollector
import com.chainlesschain.android.pdh.email.EmailCredentialsStore
import com.chainlesschain.android.pdh.email.EmailLocalCollector
import com.chainlesschain.android.pdh.social.aichat.AiChatCredentialsStore
import com.chainlesschain.android.pdh.social.bilibili.BilibiliCredentialsStore
import com.chainlesschain.android.pdh.social.bilibili.BilibiliLocalCollector
import com.chainlesschain.android.pdh.social.douyin.DouyinApiClient
import com.chainlesschain.android.pdh.social.douyin.DouyinCredentialsStore
import com.chainlesschain.android.pdh.social.douyin.DouyinLocalCollector
import com.chainlesschain.android.pdh.social.kuaishou.KuaishouCredentialsStore
import com.chainlesschain.android.pdh.social.kuaishou.KuaishouLocalCollector
import com.chainlesschain.android.pdh.social.toutiao.ToutiaoCredentialsStore
import com.chainlesschain.android.pdh.social.toutiao.ToutiaoLocalCollector
import com.chainlesschain.android.pdh.social.toutiao.ToutiaoSignBridge
import com.chainlesschain.android.pdh.social.weibo.WeiboCredentialsStore
import com.chainlesschain.android.pdh.social.weibo.WeiboLocalCollector
import com.chainlesschain.android.pdh.social.xiaohongshu.XhsCredentialsStore
import com.chainlesschain.android.pdh.social.xiaohongshu.XhsLocalCollector
import com.chainlesschain.android.pdh.social.wechat.WeChatCredentialsStore
import com.chainlesschain.android.pdh.social.wechat.WeChatLocalCollector
import com.chainlesschain.android.pdh.travel.TravelCredentialsStore
import io.mockk.coEvery
import io.mockk.coVerify
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
import kotlinx.coroutines.test.runCurrent
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
    private lateinit var aiChatCredentials: AiChatCredentialsStore
    private lateinit var emailCredentials: EmailCredentialsStore
    private lateinit var emailCollector: EmailLocalCollector
    private lateinit var travelCredentials: TravelCredentialsStore
    private lateinit var weiboCollector: WeiboLocalCollector
    private lateinit var weiboCredentials: WeiboCredentialsStore
    private lateinit var douyinCollector: DouyinLocalCollector
    private lateinit var douyinCredentials: DouyinCredentialsStore
    private lateinit var xhsCollector: XhsLocalCollector
    private lateinit var xhsCredentials: XhsCredentialsStore
    private lateinit var toutiaoCollector: ToutiaoLocalCollector
    private lateinit var toutiaoCredentials: ToutiaoCredentialsStore
    private lateinit var toutiaoSignBridge: ToutiaoSignBridge
    private lateinit var kuaishouCollector: KuaishouLocalCollector
    private lateinit var kuaishouCredentials: KuaishouCredentialsStore
    private lateinit var qqCollector: QQLocalCollector
    private lateinit var qqCredentials: QQCredentialsStore
    private lateinit var systemDataState: SystemDataSyncStateStore
    private lateinit var modelManager: ModelManager
    private lateinit var llmEngine: LlmInferenceEngine
    private lateinit var llmPreferences: LlmPreferences
    private lateinit var androidLlmExecutor: AndroidLocalLlmExecutor
    private lateinit var remoteHub: PersonalDataHubCommands
    private val lanUrlFlow = kotlinx.coroutines.flow.MutableStateFlow<String?>(null)
    private lateinit var appContext: Context

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
        snapshotter = mockk(relaxed = true)
        ccRunner = mockk(relaxed = false)
        bilibiliCollector = mockk(relaxed = false)
        // 2026-05-24: refreshBilibiliFromStore + snapshot now both call
        // clearIfStoredCookieStale to self-heal pre-2c8f41f9 cookies. Default
        // to "no stale cookie" so existing tests run unchanged — the dedicated
        // stale-cookie tests below override this.
        every { bilibiliCollector.clearIfStoredCookieStale() } returns null
        bilibiliCredentials = mockk(relaxed = true)
        wechatCollector = mockk(relaxed = true)
        wechatCredentials = mockk(relaxed = true)
        llmServer = mockk(relaxed = true)
        aiChatCredentials = mockk(relaxed = true)
        emailCredentials = mockk(relaxed = true)
        emailCollector = mockk(relaxed = true)
        travelCredentials = mockk(relaxed = true)
        weiboCollector = mockk(relaxed = false)
        weiboCredentials = mockk(relaxed = true)
        every { weiboCredentials.hasCredentials() } returns false
        every { weiboCredentials.getUid() } returns null
        every { weiboCredentials.getLastSyncAt() } returns null
        every { weiboCredentials.getLastSyncCount() } returns 0
        douyinCollector = mockk(relaxed = false)
        // Default-stub the lastLoginError* getters so the strict mock doesn't
        // throw on the success path (where VM never reads them). Failure-path
        // tests override these to assert correct surfacing.
        every { douyinCollector.lastLoginErrorCode } returns 0
        every { douyinCollector.lastLoginErrorMessage } returns null
        douyinCredentials = mockk(relaxed = true)
        every { douyinCredentials.hasCredentials() } returns false
        every { douyinCredentials.getSecUid() } returns null
        every { douyinCredentials.getShortId() } returns null
        every { douyinCredentials.getDisplayName() } returns null
        every { douyinCredentials.getCookie() } returns null
        every { douyinCredentials.getLastSyncAt() } returns null
        every { douyinCredentials.getLastSyncCount() } returns 0
        xhsCollector = mockk(relaxed = true)
        xhsCredentials = mockk(relaxed = true)
        toutiaoCollector = mockk(relaxed = true)
        toutiaoCredentials = mockk(relaxed = true)
        toutiaoSignBridge = mockk(relaxed = true)
        every { toutiaoCredentials.hasCredentials() } returns false
        every { toutiaoCredentials.getUid() } returns null
        every { toutiaoCredentials.getCookie() } returns null
        every { toutiaoCredentials.getDisplayName() } returns null
        every { toutiaoCredentials.getLastSyncAt() } returns null
        every { toutiaoCredentials.getLastSyncCount() } returns 0
        every { toutiaoCollector.lastLoginErrorCode } returns 0
        every { toutiaoCollector.lastLoginErrorMessage } returns null
        kuaishouCollector = mockk(relaxed = true)
        kuaishouCredentials = mockk(relaxed = true)
        every { kuaishouCredentials.hasCredentials() } returns false
        every { kuaishouCredentials.getUid() } returns null
        every { kuaishouCredentials.getCookie() } returns null
        every { kuaishouCredentials.getDisplayName() } returns null
        every { kuaishouCredentials.getLastSyncAt() } returns null
        every { kuaishouCredentials.getLastSyncCount() } returns 0
        every { kuaishouCollector.lastLoginErrorCode } returns 0
        every { kuaishouCollector.lastLoginErrorMessage } returns null
        qqCollector = mockk(relaxed = true)
        qqCredentials = mockk(relaxed = true)
        every { qqCredentials.hasCredentials() } returns false
        every { qqCredentials.getUin() } returns null
        every { qqCredentials.getImei() } returns null
        every { qqCredentials.getDisplayName() } returns null
        every { qqCredentials.getLastSyncAt() } returns null
        every { qqCredentials.getLastSyncCount() } returns 0
        systemDataState = mockk(relaxed = true)
        // Default: no past system-data sync. Specific tests override these.
        every { systemDataState.getLastSnapshotAt() } returns null
        every { systemDataState.getContactsCount() } returns 0
        every { systemDataState.getAppsCount() } returns 0
        every { systemDataState.getIngested() } returns 0
        // §2.1 A3.4 — default: model not downloaded. Tests overriding flow
        // (downloadModel triggers / state collector) can supply a real
        // MutableStateFlow if they need to drive state transitions.
        modelManager = mockk(relaxed = true)
        coEvery { modelManager.refresh(any()) } returns
            com.chainlesschain.android.pdh.llm.ModelManager.State.NotDownloaded
        // Explicit MutableStateFlow<State> type so the collect site in the VM
        // (which is StateFlow<ModelManager.State>) gets the widened generic;
        // without this the inferred type is the NotDownloaded singleton and
        // mockk's return-value type check rejects subsequent State subclasses.
        every { modelManager.state } returns
            kotlinx.coroutines.flow.MutableStateFlow<
                com.chainlesschain.android.pdh.llm.ModelManager.State
            >(com.chainlesschain.android.pdh.llm.ModelManager.State.NotDownloaded)
        // §2.1 A3.4 — default: native engine NOT ready (mirrors Win build
        // where .so isn't bundled). Tests overriding the "Ready engine"
        // scenario flip this in-place via `every { llmEngine.nativeReady } returns true`.
        llmEngine = mockk(relaxed = true)
        every { llmEngine.nativeReady } returns false
        // 2026-05-24 — 4-route ask dispatch deps. Defaults make all non-default
        // routes unavailable (LAN url null, no Android cloud key, health() failing).
        llmPreferences = mockk(relaxed = true)
        every { llmPreferences.getLanLlmBaseUrl() } returns null
        lanUrlFlow.value = null
        every { llmPreferences.lanLlmBaseUrl } returns lanUrlFlow
        androidLlmExecutor = mockk(relaxed = true)
        every { androidLlmExecutor.detectProvider() } returns null
        remoteHub = mockk(relaxed = true)
        coEvery { remoteHub.health() } returns Result.failure(RuntimeException("no desktop paired"))
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
            aiChatCredentials,
            emailCredentials,
            emailCollector,
            travelCredentials,
            weiboCollector,
            weiboCredentials,
            douyinCollector,
            douyinCredentials,
            xhsCollector,
            xhsCredentials,
            toutiaoCollector,
            toutiaoCredentials,
            toutiaoSignBridge,
            kuaishouCollector,
            kuaishouCredentials,
            qqCollector,
            qqCredentials,
            systemDataState,
            modelManager,
            llmEngine,
            llmPreferences,
            androidLlmExecutor,
            remoteHub,
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
    fun `init recalls system-data lastSync from store across process death`() = runTest(testDispatcher) {
        // Simulate a previous successful sync persisted to disk
        every { systemDataState.getLastSnapshotAt() } returns 1716000000000L
        every { systemDataState.getContactsCount() } returns 142
        every { systemDataState.getAppsCount() } returns 87
        every { systemDataState.getIngested() } returns 229

        val vm = newVm()
        advanceUntilIdle()

        assertEquals(1716000000000L, vm.state.value.systemData.lastSnapshotAt)
        assertEquals(142, vm.state.value.systemData.contactsCount)
        assertEquals(87, vm.state.value.systemData.appsCount)
        assertEquals(229, vm.state.value.systemData.ingested)
    }

    @Test
    fun `init leaves systemData defaults when store has no past sync`() = runTest(testDispatcher) {
        // Defaults from setUp: getLastSnapshotAt returns null → no recall
        val vm = newVm()
        advanceUntilIdle()

        assertNull(vm.state.value.systemData.lastSnapshotAt)
        assertEquals(0, vm.state.value.systemData.contactsCount)
        assertEquals(0, vm.state.value.systemData.appsCount)
        assertEquals(0, vm.state.value.systemData.ingested)
    }

    // ─── §2.1 A3.4 — model status wiring ────────────────────────────────────

    @Test
    fun `init observes ModelManager state — NotDownloaded surfaces as NOT_DOWNLOADED`() = runTest(testDispatcher) {
        val flow = kotlinx.coroutines.flow.MutableStateFlow<
            com.chainlesschain.android.pdh.llm.ModelManager.State
        >(com.chainlesschain.android.pdh.llm.ModelManager.State.NotDownloaded)
        every { modelManager.state } returns flow
        coEvery { modelManager.refresh(any()) } returns
            com.chainlesschain.android.pdh.llm.ModelManager.State.NotDownloaded

        val vm = newVm()
        advanceUntilIdle()

        assertEquals(
            HubLocalViewModel.ModelStatusState.Kind.NOT_DOWNLOADED,
            vm.state.value.modelStatus.kind,
        )
    }

    @Test
    fun `model status maps Ready → READY with model name`() = runTest(testDispatcher) {
        val ready = com.chainlesschain.android.pdh.llm.ModelManager.State.Ready(
            file = java.io.File("qwen2.5-1.5b-instruct-q4_k_m.gguf"),
            sha256 = "deadbeef",
        )
        val flow = kotlinx.coroutines.flow.MutableStateFlow<
            com.chainlesschain.android.pdh.llm.ModelManager.State
        >(ready)
        every { modelManager.state } returns flow
        coEvery { modelManager.refresh(any()) } returns ready

        val vm = newVm()
        advanceUntilIdle()

        assertEquals(HubLocalViewModel.ModelStatusState.Kind.READY, vm.state.value.modelStatus.kind)
        assertEquals("qwen2.5-1.5b-instruct-q4_k_m.gguf", vm.state.value.modelStatus.modelName)
    }

    @Test
    fun `model status maps Downloading → DOWNLOADING with fraction`() = runTest(testDispatcher) {
        val downloading = com.chainlesschain.android.pdh.llm.ModelManager.State.Downloading(
            receivedBytes = 500_000_000L,
            totalBytes = 1_000_000_000L,
        )
        val flow = kotlinx.coroutines.flow.MutableStateFlow<
            com.chainlesschain.android.pdh.llm.ModelManager.State
        >(downloading)
        every { modelManager.state } returns flow

        val vm = newVm()
        advanceUntilIdle()

        assertEquals(
            HubLocalViewModel.ModelStatusState.Kind.DOWNLOADING,
            vm.state.value.modelStatus.kind,
        )
        // Fraction is computed on the UI-side data class → assert it
        assertEquals(0.5f, vm.state.value.modelStatus.progressFraction)
    }

    @Test
    fun `model status maps Failed → FAILED with reason`() = runTest(testDispatcher) {
        val failed = com.chainlesschain.android.pdh.llm.ModelManager.State.Failed(
            reason = "空间不足：需要 1210MB，可用 200MB",
        )
        val flow = kotlinx.coroutines.flow.MutableStateFlow<
            com.chainlesschain.android.pdh.llm.ModelManager.State
        >(failed)
        every { modelManager.state } returns flow

        val vm = newVm()
        advanceUntilIdle()

        assertEquals(HubLocalViewModel.ModelStatusState.Kind.FAILED, vm.state.value.modelStatus.kind)
        assertEquals("空间不足：需要 1210MB，可用 200MB", vm.state.value.modelStatus.errorMessage)
    }

    @Test
    fun `downloadModel triggers ModelManager download`() = runTest(testDispatcher) {
        coEvery { modelManager.download(any()) } returns
            com.chainlesschain.android.pdh.llm.ModelManager.State.NotDownloaded
        val vm = newVm()
        advanceUntilIdle()

        vm.downloadModel()
        advanceUntilIdle()

        io.mockk.coVerify { modelManager.download(any()) }
    }

    @Test
    fun `downloadModel is a no-op while a download is already in flight`() = runTest(testDispatcher) {
        // Surface DOWNLOADING state — VM should skip launching another download.
        val flow = kotlinx.coroutines.flow.MutableStateFlow<
            com.chainlesschain.android.pdh.llm.ModelManager.State
        >(com.chainlesschain.android.pdh.llm.ModelManager.State.Downloading(
            receivedBytes = 100L, totalBytes = 1000L,
        ))
        every { modelManager.state } returns flow

        val vm = newVm()
        advanceUntilIdle()
        // Verify state is DOWNLOADING then trigger
        assertEquals(
            HubLocalViewModel.ModelStatusState.Kind.DOWNLOADING,
            vm.state.value.modelStatus.kind,
        )

        vm.downloadModel()
        advanceUntilIdle()

        // download() must NOT be invoked while DOWNLOADING (guard at action site)
        io.mockk.coVerify(exactly = 0) { modelManager.download(any()) }
    }

    @Test
    fun `deleteModel triggers ModelManager delete`() = runTest(testDispatcher) {
        coEvery { modelManager.delete(any()) } returns Unit
        val vm = newVm()
        advanceUntilIdle()

        vm.deleteModel()
        advanceUntilIdle()

        io.mockk.coVerify { modelManager.delete(any()) }
    }

    @Test
    fun `nativeEngineReady=false propagates to UI state — Ready model still warns v0_2`() = runTest(testDispatcher) {
        // Default setUp sets every { llmEngine.nativeReady } returns false →
        // Ready model state should still surface nativeEngineReady=false so
        // ModelStatusBanner shows the "⏳ 等 v0.2 推理引擎接通" disclaimer.
        val ready = com.chainlesschain.android.pdh.llm.ModelManager.State.Ready(
            file = java.io.File("qwen2.5-1.5b-instruct-q4_k_m.gguf"),
            sha256 = "deadbeef",
        )
        val flow = kotlinx.coroutines.flow.MutableStateFlow<
            com.chainlesschain.android.pdh.llm.ModelManager.State
        >(ready)
        every { modelManager.state } returns flow

        val vm = newVm()
        advanceUntilIdle()

        assertEquals(HubLocalViewModel.ModelStatusState.Kind.READY, vm.state.value.modelStatus.kind)
        assertFalse(vm.state.value.modelStatus.nativeEngineReady)
    }

    @Test
    fun `nativeEngineReady=true propagates so Ready model shows 已就绪 not v0_2 disclaimer`() = runTest(testDispatcher) {
        every { llmEngine.nativeReady } returns true
        val ready = com.chainlesschain.android.pdh.llm.ModelManager.State.Ready(
            file = java.io.File("qwen2.5-1.5b-instruct-q4_k_m.gguf"),
            sha256 = "deadbeef",
        )
        val flow = kotlinx.coroutines.flow.MutableStateFlow<
            com.chainlesschain.android.pdh.llm.ModelManager.State
        >(ready)
        every { modelManager.state } returns flow

        val vm = newVm()
        advanceUntilIdle()

        assertTrue(vm.state.value.modelStatus.nativeEngineReady)
    }

    @Test
    fun `init renders all 6 social cards (6 implemented)`() = runTest(testDispatcher) {
        val vm = newVm()
        advanceUntilIdle()
        // §A8 v0.2 + 头条+快手 v0.1: full 6-card lineup is real after Bilibili /
        // 微博 / 抖音 / 小红书 / 今日头条 / 快手 land. 抖音/头条/快手 have smaller
        // surface (profile or cookie-only — no X-Bogus / _signature / NS_sig3
        // path) but card.implemented is true because login + cookie + persist
        // actually do work end-to-end.
        assertTrue(vm.state.value.bilibili.implemented)
        assertTrue(vm.state.value.weibo.implemented)
        assertTrue(vm.state.value.douyin.implemented)
        assertTrue(vm.state.value.xiaohongshu.implemented)
        assertTrue(vm.state.value.toutiao.implemented)
        assertTrue(vm.state.value.kuaishou.implemented)
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
        every { bilibiliCollector.acceptLoginCookie(any()) } returns BilibiliLocalCollector.AcceptResult.Ok
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
        every {
            bilibiliCollector.acceptLoginCookie(any())
        } returns BilibiliLocalCollector.AcceptResult.MissingField("DedeUserID")

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
    fun `onBilibiliLoginCookie surface error when buvid3 missing (real-device 2026-05-23)`() = runTest(testDispatcher) {
        // Real-device repro: WebView grabbed cookie before post-onload JS wrote
        // buvid3, so DedeUserID parses fine but the API will silent-empty.
        every {
            bilibiliCollector.acceptLoginCookie(any())
        } returns BilibiliLocalCollector.AcceptResult.MissingField("buvid3")

        val vm = newVm()
        advanceUntilIdle()
        vm.requestBilibiliLogin()
        vm.onBilibiliLoginCookie("SESSDATA=x; DedeUserID=12345; bili_jct=jct")
        advanceUntilIdle()

        assertNull(vm.state.value.pendingLogin)
        assertFalse(vm.state.value.bilibili.isLoggedIn)
        // Message must name buvid3 + give user an actionable retry hint.
        val msg = vm.state.value.bilibili.errorMessage!!
        assertTrue(msg.contains("buvid3"))
        assertTrue(msg.contains("重新登录"))
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
        // f7e11d6a5 — error message reformatted to include actual Bilibili
        // response code. With lastErrorCode=0 (default, no code observed),
        // production emits "4 个 API 都返回空 — API 返回空 + 无错误码 — 可能
        // cookie 缺关键字段（bili_jct / buvid3）". Assert both the structural
        // prefix and the cookie hint substring.
        assertTrue(vm.state.value.bilibili.errorMessage!!.contains("4 个 API 都返回空"))
        assertTrue(vm.state.value.bilibili.errorMessage!!.contains("cookie"))
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

    // ─── Stale-cookie self-heal (2026-05-24 regression) ─────────────────────
    //
    // Pre-2c8f41f9 cookies sitting in EncryptedSharedPreferences sail through
    // hasCredentials() (cookie non-blank + uid > 0) but lack buvid3 /
    // bili_jct, so every sync returns 4 API empty + cryptic "可能 cookie 缺
    // 关键字段" forever. clearIfStoredCookieStale (called by both refresh AND
    // snapshot) wipes the store and routes the next sync to NoCredentials.

    @Test
    fun `init clears stale bilibili cookie state and surfaces re-login hint`() = runTest(testDispatcher) {
        // Real-device pattern: pre-fix cookie was in the encrypted store
        // missing buvid3. clearIfStoredCookieStale (mocked here — its real
        // body would call credentialsStore.clear()) is invoked first by the
        // VM; we model the post-clear store state with hasCredentials=false.
        // (The mock collector helper doesn't actually mutate the credentials
        // mock, so we stub the end state directly.)
        every { bilibiliCollector.clearIfStoredCookieStale() } returns "buvid3"
        every { bilibiliCredentials.hasCredentials() } returns false
        every { bilibiliCredentials.getUid() } returns null
        every { bilibiliCredentials.getLastSyncAt() } returns null
        every { bilibiliCredentials.getLastSyncCount() } returns 0

        val vm = newVm()
        advanceUntilIdle()

        assertFalse(vm.state.value.bilibili.isLoggedIn)
        assertNull(vm.state.value.bilibili.uid)
        assertNotNull(vm.state.value.bilibili.errorMessage)
        assertTrue(vm.state.value.bilibili.errorMessage!!.contains("buvid3"))
        assertTrue(vm.state.value.bilibili.errorMessage!!.contains("重新登录"))
        verify { bilibiliCollector.clearIfStoredCookieStale() }
    }

    @Test
    fun `syncBilibili StaleCookie path drops logged-in state and prompts re-login`() = runTest(testDispatcher) {
        // Init reads valid state (cookie not yet known stale — collector helper
        // only catches it during snapshot retry). At sync time, snapshot itself
        // re-validates and returns StaleCookie.
        every { bilibiliCredentials.hasCredentials() } returns true
        every { bilibiliCredentials.getUid() } returns 12345L
        coEvery { bilibiliCollector.snapshot() } returns
            BilibiliLocalCollector.SnapshotResult.StaleCookie("bili_jct, buvid3")

        val vm = newVm()
        advanceUntilIdle()
        vm.syncBilibili()
        advanceUntilIdle()

        assertFalse(vm.state.value.bilibili.isLoggedIn)
        assertNull(vm.state.value.bilibili.uid)
        assertNotNull(vm.state.value.bilibili.errorMessage)
        assertTrue(vm.state.value.bilibili.errorMessage!!.contains("bili_jct"))
        assertTrue(vm.state.value.bilibili.errorMessage!!.contains("buvid3"))
        assertTrue(vm.state.value.bilibili.errorMessage!!.contains("重新登录"))
        assertNull(vm.state.value.globalSyncingAdapter)
    }

    // ─── Weibo lifecycle (§A8 v0.2 — mirror of Bilibili) ────────────────────
    // Key behavioral diff: onWeiboLoginCookie is async (suspend) — UID needs
    // a /api/config HTTP roundtrip because Weibo cookie has no
    // DedeUserID-equivalent direct-read field. So the VM launches into
    // viewModelScope; tests must advanceUntilIdle() after invoking.

    @Test
    fun `init reads weibo credentials state from store`() = runTest(testDispatcher) {
        every { weiboCredentials.hasCredentials() } returns true
        every { weiboCredentials.getUid() } returns 9876L
        every { weiboCredentials.getLastSyncAt() } returns 1716000000000L
        every { weiboCredentials.getLastSyncCount() } returns 42

        val vm = newVm()
        advanceUntilIdle()

        assertTrue(vm.state.value.weibo.isLoggedIn)
        assertEquals(9876L, vm.state.value.weibo.uid)
        assertEquals(1716000000000L, vm.state.value.weibo.lastSyncAt)
        assertEquals(42, vm.state.value.weibo.lastSyncCount)
    }

    @Test
    fun `requestWeiboLogin sets pendingLogin with m_weibo_cn URL`() = runTest(testDispatcher) {
        val vm = newVm()
        advanceUntilIdle()
        vm.requestWeiboLogin()
        val pending = vm.state.value.pendingLogin
        assertNotNull(pending)
        assertEquals("social-weibo", pending.adapterName)
        assertEquals("微博", pending.displayName)
        assertTrue(pending.loginUrl.startsWith("https://passport.weibo.cn/"))
        assertTrue(pending.cookieDomain.contains("m.weibo.cn"))
    }

    @Test
    fun `weibo isLoginSuccess accepts m_weibo_cn home but rejects passport URL`() = runTest(testDispatcher) {
        val vm = newVm()
        advanceUntilIdle()
        vm.requestWeiboLogin()
        val pending = vm.state.value.pendingLogin!!
        assertTrue(pending.isLoginSuccess("https://m.weibo.cn/"))
        assertTrue(pending.isLoginSuccess("https://m.weibo.cn/u/123"))
        assertFalse(pending.isLoginSuccess("https://passport.weibo.cn/signin/login"))
        // login subpath inside m.weibo.cn should also reject (transient flow)
        assertFalse(pending.isLoginSuccess("https://m.weibo.cn/login"))
    }

    @Test
    fun `onWeiboLoginCookie accepts cookie + refreshes state when fetchUid returns uid`() = runTest(testDispatcher) {
        coEvery { weiboCollector.acceptLoginCookie(any(), any()) } returns true
        // After acceptance, store now reflects logged-in
        every { weiboCredentials.hasCredentials() } returnsMany listOf(false, true)
        every { weiboCredentials.getUid() } returnsMany listOf(null, 9876L)

        val vm = newVm()
        advanceUntilIdle()
        vm.requestWeiboLogin()
        vm.onWeiboLoginCookie("SUB=x; SUBP=y; _T_WM=z")
        advanceUntilIdle()

        assertNull(vm.state.value.pendingLogin)
        assertTrue(vm.state.value.weibo.isLoggedIn)
        assertEquals(9876L, vm.state.value.weibo.uid)
        assertNull(vm.state.value.weibo.errorMessage)
        io.mockk.coVerify { weiboCollector.acceptLoginCookie("SUB=x; SUBP=y; _T_WM=z", null) }
    }

    @Test
    fun `onWeiboLoginCookie surfaces error when fetchUid returns null`() = runTest(testDispatcher) {
        coEvery { weiboCollector.acceptLoginCookie(any(), any()) } returns false

        val vm = newVm()
        advanceUntilIdle()
        vm.requestWeiboLogin()
        vm.onWeiboLoginCookie("SUB=incomplete")
        advanceUntilIdle()

        assertNull(vm.state.value.pendingLogin)
        assertFalse(vm.state.value.weibo.isLoggedIn)
        assertNotNull(vm.state.value.weibo.errorMessage)
        assertTrue(vm.state.value.weibo.errorMessage!!.contains("UID"))
    }

    @Test
    fun `syncWeibo when not logged in triggers requestWeiboLogin instead`() = runTest(testDispatcher) {
        every { weiboCredentials.hasCredentials() } returns false

        val vm = newVm()
        advanceUntilIdle()
        vm.syncWeibo()
        advanceUntilIdle()

        assertNotNull(vm.state.value.pendingLogin)
        assertEquals("social-weibo", vm.state.value.pendingLogin!!.adapterName)
        io.mockk.coVerify(exactly = 0) { weiboCollector.snapshot(any()) }
    }

    @Test
    fun `syncWeibo NoCredentials path surfaces 未登录 error`() = runTest(testDispatcher) {
        every { weiboCredentials.hasCredentials() } returns true
        every { weiboCredentials.getUid() } returns 9876L
        // snapshot signature added optional onProgress callback (commit ca6dbff09).
        // Match any() so the named-arg call site `snapshot(onProgress = onProgress)`
        // routes to this stub.
        coEvery { weiboCollector.snapshot(any<(String) -> Unit>()) } returns
            WeiboLocalCollector.SnapshotResult.NoCredentials

        val vm = newVm()
        advanceUntilIdle()
        vm.syncWeibo()
        advanceUntilIdle()

        assertFalse(vm.state.value.weibo.isLoggedIn)
        assertNotNull(vm.state.value.weibo.errorMessage)
        assertTrue(vm.state.value.weibo.errorMessage!!.contains("未登录"))
        assertNull(vm.state.value.globalSyncingAdapter)
    }

    @Test
    fun `syncWeibo everythingEmpty path surfaces cookie expired hint`() = runTest(testDispatcher) {
        every { weiboCredentials.hasCredentials() } returns true
        every { weiboCredentials.getUid() } returns 9876L
        coEvery { weiboCollector.snapshot(any<(String) -> Unit>()) } returns
            WeiboLocalCollector.SnapshotResult.Ok(
                snapshotPath = "/tmp/weibo-empty.json",
                postCount = 0, favouriteCount = 0, followCount = 0,
                totalEvents = 0, everythingEmpty = true,
                snapshottedAt = 1L,
                lastErrorCode = -50101,
                lastErrorMessage = "passport expired",
            )

        val vm = newVm()
        advanceUntilIdle()
        vm.syncWeibo()
        advanceUntilIdle()

        assertNotNull(vm.state.value.weibo.errorMessage)
        assertTrue(vm.state.value.weibo.errorMessage!!.contains("cookie 过期"))
        assertNull(vm.state.value.globalSyncingAdapter)
    }

    @Test
    fun `syncWeibo Ok path runs ccRunner and updates lastSync`() = runTest(testDispatcher) {
        every { weiboCredentials.hasCredentials() } returns true
        every { weiboCredentials.getUid() } returns 9876L
        val syncAt = 1716000000000L
        coEvery { weiboCollector.snapshot(any<(String) -> Unit>()) } returns
            WeiboLocalCollector.SnapshotResult.Ok(
                snapshotPath = "/tmp/weibo-snap.json",
                postCount = 10, favouriteCount = 5, followCount = 3,
                totalEvents = 18, everythingEmpty = false,
                snapshottedAt = syncAt,
            )
        // Asserts limit is set to WEIBO_FIRST_PASS_LIMIT — the first-pass cap
        // that keeps Weibo cc sync inside 240s on Xiaomi 24115RA8EC. Other
        // named args use any() since timeoutMs / onProgress are runtime wiring
        // detail, not subject of this test.
        coEvery {
            ccRunner.syncAdapter(
                adapterName = "social-weibo",
                inputPath = "/tmp/weibo-snap.json",
                limit = HubLocalViewModel.WEIBO_FIRST_PASS_LIMIT,
                onProgress = any<(String) -> Unit>(),
            )
        } returns
            LocalCcRunner.CcResult.Ok(
                report = LocalCcRunner.SyncReport(
                    adapter = "social-weibo", status = "ok",
                    ingested = 18, invalidCount = 0,
                    kgTriples = 30, ragDocs = 8,
                    durationMs = 1200L, error = null,
                ),
                rawJson = "{}",
            )

        val vm = newVm()
        advanceUntilIdle()
        vm.syncWeibo()
        advanceUntilIdle()

        assertEquals(syncAt, vm.state.value.weibo.lastSyncAt)
        assertEquals(18, vm.state.value.weibo.lastSyncCount)
        assertNull(vm.state.value.weibo.errorMessage)
        assertNull(vm.state.value.globalSyncingAdapter)
    }

    @Test
    fun `syncWeibo ccRunner Failed surfaces error`() = runTest(testDispatcher) {
        every { weiboCredentials.hasCredentials() } returns true
        every { weiboCredentials.getUid() } returns 9876L
        coEvery { weiboCollector.snapshot(any<(String) -> Unit>()) } returns
            WeiboLocalCollector.SnapshotResult.Ok(
                snapshotPath = "/tmp/weibo-snap.json",
                postCount = 1, favouriteCount = 0, followCount = 0,
                totalEvents = 1, everythingEmpty = false,
                snapshottedAt = 1L,
            )
        coEvery { ccRunner.syncAdapter(any(), any(), any(), any<Int>(), any<(String) -> Unit>()) } returns
            LocalCcRunner.CcResult.Failed(
                reason = "bs3mc cold-load timeout",
                exitCode = 124, stderr = "...",
            )

        val vm = newVm()
        advanceUntilIdle()
        vm.syncWeibo()
        advanceUntilIdle()

        assertNotNull(vm.state.value.weibo.errorMessage)
        assertTrue(vm.state.value.weibo.errorMessage!!.contains("bs3mc cold-load timeout"))
        assertNull(vm.state.value.globalSyncingAdapter)
    }

    @Test
    fun `logoutWeibo calls collector and clears state`() = runTest(testDispatcher) {
        every { weiboCredentials.hasCredentials() } returns true
        every { weiboCredentials.getUid() } returns 9876L
        every { weiboCollector.logout() } just runs

        val vm = newVm()
        advanceUntilIdle()
        vm.logoutWeibo()
        advanceUntilIdle()

        verify { weiboCollector.logout() }
        assertFalse(vm.state.value.weibo.isLoggedIn)
        assertNull(vm.state.value.weibo.uid)
        assertEquals(0, vm.state.value.weibo.lastSyncCount)
    }

    @Test
    fun `syncWeibo passes WEIBO_FIRST_PASS_LIMIT to ccRunner`() = runTest(testDispatcher) {
        // Goal-of-session guardrail: regression on the first end-to-end win
        // would re-introduce 240s timeouts. Verify the limit param is
        // actually forwarded — mockk verify with a positive match (instead
        // of any()) means a future refactor that drops the arg fails here
        // first, not on a real device after a 4-minute spinner.
        every { weiboCredentials.hasCredentials() } returns true
        every { weiboCredentials.getUid() } returns 9876L
        coEvery { weiboCollector.snapshot(any<(String) -> Unit>()) } returns
            WeiboLocalCollector.SnapshotResult.Ok(
                snapshotPath = "/tmp/weibo-snap.json",
                postCount = 100, favouriteCount = 100, followCount = 100,
                totalEvents = 300, everythingEmpty = false,
                snapshottedAt = 1L,
            )
        coEvery {
            ccRunner.syncAdapter(
                adapterName = "social-weibo",
                inputPath = "/tmp/weibo-snap.json",
                limit = HubLocalViewModel.WEIBO_FIRST_PASS_LIMIT,
                onProgress = any<(String) -> Unit>(),
            )
        } returns
            LocalCcRunner.CcResult.Ok(
                report = LocalCcRunner.SyncReport(
                    adapter = "social-weibo", status = "ok",
                    ingested = HubLocalViewModel.WEIBO_FIRST_PASS_LIMIT,
                    invalidCount = 0, kgTriples = 0, ragDocs = 0,
                    durationMs = 8000L, error = null,
                ),
                rawJson = "{}",
            )

        val vm = newVm()
        advanceUntilIdle()
        vm.syncWeibo()
        advanceUntilIdle()

        coVerify {
            ccRunner.syncAdapter(
                adapterName = "social-weibo",
                inputPath = "/tmp/weibo-snap.json",
                limit = HubLocalViewModel.WEIBO_FIRST_PASS_LIMIT,
                onProgress = any<(String) -> Unit>(),
            )
        }
        assertEquals(
            HubLocalViewModel.WEIBO_FIRST_PASS_LIMIT,
            vm.state.value.weibo.lastSyncCount,
        )
    }

    // ─── Douyin lifecycle (§A8 v0.2 — mirror of Weibo, smaller surface) ─────
    // Key behavioral diffs from Weibo:
    //   - onDouyinLoginCookie is async (suspend) — sec_user_id needs a
    //     passport/info/v2 HTTP roundtrip (抖音 cookie has no
    //     DedeUserID-equivalent direct-read field).
    //   - SocialCardState.uid is Long? and 抖音 secUid is String; VM keeps
    //     uid=null and shows "已登录" rather than "已登录 UID:xxx".
    //   - sync emits 1 profile event (no history/like/favourite — those
    //     gate behind X-Bogus signature, v0.3+).

    @Test
    fun `init reads douyin credentials state from store`() = runTest(testDispatcher) {
        every { douyinCredentials.hasCredentials() } returns true
        every { douyinCredentials.getSecUid() } returns "MS4wLjABAAAA_alice"
        every { douyinCredentials.getShortId() } returns "12345678"
        every { douyinCredentials.getDisplayName() } returns "alice"
        every { douyinCredentials.getLastSyncAt() } returns 1716000000000L
        every { douyinCredentials.getLastSyncCount() } returns 1

        val vm = newVm()
        advanceUntilIdle()

        assertTrue(vm.state.value.douyin.isLoggedIn)
        // VM keeps uid=null because抖音 secUid is String not Long
        assertNull(vm.state.value.douyin.uid)
        assertEquals(1716000000000L, vm.state.value.douyin.lastSyncAt)
        assertEquals(1, vm.state.value.douyin.lastSyncCount)
    }

    @Test
    fun `requestDouyinLogin sets pendingLogin with www_douyin_com URL`() = runTest(testDispatcher) {
        val vm = newVm()
        advanceUntilIdle()
        vm.requestDouyinLogin()
        val pending = vm.state.value.pendingLogin
        assertNotNull(pending)
        assertEquals("social-douyin", pending.adapterName)
        assertEquals("抖音", pending.displayName)
        assertTrue(pending.loginUrl.startsWith("https://www.douyin.com"))
        assertTrue(pending.cookieDomain.contains("www.douyin.com"))
    }

    @Test
    fun `douyin isLoginSuccess accepts home but rejects showLogin URL`() = runTest(testDispatcher) {
        val vm = newVm()
        advanceUntilIdle()
        vm.requestDouyinLogin()
        val pending = vm.state.value.pendingLogin!!
        assertTrue(pending.isLoginSuccess("https://www.douyin.com/"))
        assertTrue(pending.isLoginSuccess("https://www.douyin.com/user/MS4wLjABA"))
        assertFalse(pending.isLoginSuccess("https://www.douyin.com/?showLogin=1"))
        assertFalse(pending.isLoginSuccess("https://passport.douyin.com/auth"))
    }

    @Test
    fun `onDouyinLoginCookie accepts cookie + refreshes state when fetchProfile returns uid`() = runTest(testDispatcher) {
        coEvery { douyinCollector.acceptLoginCookie(any(), any()) } returns true
        // After acceptance, store now reflects logged-in
        every { douyinCredentials.hasCredentials() } returnsMany listOf(false, true)
        every { douyinCredentials.getSecUid() } returnsMany listOf(null, "MS4wLjABAAAA_alice")

        val vm = newVm()
        advanceUntilIdle()
        vm.requestDouyinLogin()
        vm.onDouyinLoginCookie("sessionid=x; sid_guard=y; uid_tt=z")
        advanceUntilIdle()

        assertNull(vm.state.value.pendingLogin)
        assertTrue(vm.state.value.douyin.isLoggedIn)
        assertNull(vm.state.value.douyin.errorMessage)
        io.mockk.coVerify { douyinCollector.acceptLoginCookie("sessionid=x; sid_guard=y; uid_tt=z", null) }
    }

    @Test
    fun `onDouyinLoginCookie surfaces apiClient error code+message when fetchProfile fails`() = runTest(testDispatcher) {
        // Simulate the "ok but no sec_user_id" branch (anonymous shape) —
        // apiClient sets code=-7 + dataKeys hint; VM should surface both.
        coEvery { douyinCollector.acceptLoginCookie(any(), any()) } returns false
        every { douyinCollector.lastLoginErrorCode } returns -7
        every { douyinCollector.lastLoginErrorMessage } returns
            "ok but data lacks sec_user_id (cookie likely missing sessionid); dataKeys=[device_id,install_id]"

        val vm = newVm()
        advanceUntilIdle()
        vm.requestDouyinLogin()
        vm.onDouyinLoginCookie("sessionid=incomplete")
        advanceUntilIdle()

        assertNull(vm.state.value.pendingLogin)
        assertFalse(vm.state.value.douyin.isLoggedIn)
        val err = vm.state.value.douyin.errorMessage
        assertNotNull(err)
        assertTrue(err!!.contains("code=-7"), "expected error to expose code; got: $err")
        assertTrue(err.contains("sec_user_id"), "expected error to mention sec_user_id; got: $err")
        assertTrue(err.contains("dataKeys=[device_id,install_id]"), "expected error to expose dataKeys hint; got: $err")
    }

    @Test
    fun `onDouyinLoginCookie surfaces token-expired status_code 2154`() = runTest(testDispatcher) {
        coEvery { douyinCollector.acceptLoginCookie(any(), any()) } returns false
        every { douyinCollector.lastLoginErrorCode } returns 2154
        every { douyinCollector.lastLoginErrorMessage } returns "token expired"

        val vm = newVm()
        advanceUntilIdle()
        vm.requestDouyinLogin()
        vm.onDouyinLoginCookie("sessionid=expired")
        advanceUntilIdle()

        val err = vm.state.value.douyin.errorMessage
        assertNotNull(err)
        assertTrue(err!!.contains("code=2154"), "expected token-expired code surface; got: $err")
        assertTrue(err.contains("token expired"), "expected upstream msg surface; got: $err")
    }

    @Test
    fun `syncDouyin when not logged in triggers requestDouyinLogin instead`() = runTest(testDispatcher) {
        every { douyinCredentials.hasCredentials() } returns false

        val vm = newVm()
        advanceUntilIdle()
        vm.syncDouyin()
        advanceUntilIdle()

        assertNotNull(vm.state.value.pendingLogin)
        assertEquals("social-douyin", vm.state.value.pendingLogin!!.adapterName)
        io.mockk.coVerify(exactly = 0) { douyinCollector.snapshot() }
    }

    @Test
    fun `syncDouyin NoCredentials path surfaces 未登录 error`() = runTest(testDispatcher) {
        every { douyinCredentials.hasCredentials() } returns true
        every { douyinCredentials.getSecUid() } returns "MS4wLjABAAAA"
        coEvery { douyinCollector.snapshot() } returns
            DouyinLocalCollector.SnapshotResult.NoCredentials

        val vm = newVm()
        advanceUntilIdle()
        vm.syncDouyin()
        advanceUntilIdle()

        assertFalse(vm.state.value.douyin.isLoggedIn)
        assertNotNull(vm.state.value.douyin.errorMessage)
        assertTrue(vm.state.value.douyin.errorMessage!!.contains("未登录"))
        assertNull(vm.state.value.globalSyncingAdapter)
    }

    @Test
    fun `syncDouyin everythingEmpty path surfaces token expired hint`() = runTest(testDispatcher) {
        every { douyinCredentials.hasCredentials() } returns true
        every { douyinCredentials.getSecUid() } returns "MS4wLjABAAAA"
        coEvery { douyinCollector.snapshot() } returns
            DouyinLocalCollector.SnapshotResult.Ok(
                snapshotPath = "/tmp/douyin-empty.json",
                profileCount = 0, totalEvents = 0, everythingEmpty = true,
                snapshottedAt = 1L,
                lastErrorCode = 2154,
                lastErrorMessage = "token expired",
            )

        val vm = newVm()
        advanceUntilIdle()
        vm.syncDouyin()
        advanceUntilIdle()

        assertNotNull(vm.state.value.douyin.errorMessage)
        assertTrue(vm.state.value.douyin.errorMessage!!.contains("token expired"))
        assertNull(vm.state.value.globalSyncingAdapter)
    }

    @Test
    fun `syncDouyin Ok path runs ccRunner and surfaces honest v0_2 banner`() = runTest(testDispatcher) {
        every { douyinCredentials.hasCredentials() } returns true
        every { douyinCredentials.getSecUid() } returns "MS4wLjABAAAA"
        val syncAt = 1716000000000L
        coEvery { douyinCollector.snapshot() } returns
            DouyinLocalCollector.SnapshotResult.Ok(
                snapshotPath = "/tmp/douyin-snap.json",
                profileCount = 1, totalEvents = 1, everythingEmpty = false,
                snapshottedAt = syncAt,
            )
        coEvery { ccRunner.syncAdapter("social-douyin", "/tmp/douyin-snap.json") } returns
            LocalCcRunner.CcResult.Ok(
                report = LocalCcRunner.SyncReport(
                    adapter = "social-douyin", status = "ok",
                    ingested = 1, invalidCount = 0,
                    kgTriples = 2, ragDocs = 0,
                    durationMs = 800L, error = null,
                ),
                rawJson = "{}",
            )

        val vm = newVm()
        advanceUntilIdle()
        vm.syncDouyin()
        advanceUntilIdle()

        assertEquals(syncAt, vm.state.value.douyin.lastSyncAt)
        assertEquals(1, vm.state.value.douyin.lastSyncCount)
        // v0.2 honest banner — surfaces the X-Bogus limit so the small
        // ingest count (=1) isn't mistaken for a bug.
        assertNotNull(vm.state.value.douyin.errorMessage)
        assertTrue(vm.state.value.douyin.errorMessage!!.contains("v0.3"))
        assertNull(vm.state.value.globalSyncingAdapter)
    }

    @Test
    fun `syncDouyin ccRunner Failed surfaces error`() = runTest(testDispatcher) {
        every { douyinCredentials.hasCredentials() } returns true
        every { douyinCredentials.getSecUid() } returns "MS4wLjABAAAA"
        coEvery { douyinCollector.snapshot() } returns
            DouyinLocalCollector.SnapshotResult.Ok(
                snapshotPath = "/tmp/douyin-snap.json",
                profileCount = 1, totalEvents = 1, everythingEmpty = false,
                snapshottedAt = 1L,
            )
        coEvery { ccRunner.syncAdapter(any(), any()) } returns
            LocalCcRunner.CcResult.Failed(
                reason = "bs3mc cold-load timeout",
                exitCode = 124, stderr = "...",
            )

        val vm = newVm()
        advanceUntilIdle()
        vm.syncDouyin()
        advanceUntilIdle()

        assertNotNull(vm.state.value.douyin.errorMessage)
        assertTrue(vm.state.value.douyin.errorMessage!!.contains("bs3mc cold-load timeout"))
        assertNull(vm.state.value.globalSyncingAdapter)
    }

    @Test
    fun `logoutDouyin calls collector and clears state`() = runTest(testDispatcher) {
        every { douyinCredentials.hasCredentials() } returns true
        every { douyinCredentials.getSecUid() } returns "MS4wLjABAAAA"
        every { douyinCollector.logout() } just runs

        val vm = newVm()
        advanceUntilIdle()
        vm.logoutDouyin()
        advanceUntilIdle()

        verify { douyinCollector.logout() }
        assertFalse(vm.state.value.douyin.isLoggedIn)
        assertNull(vm.state.value.douyin.uid)
        assertEquals(0, vm.state.value.douyin.lastSyncCount)
    }

    // ─── Xiaohongshu login-cookie error surfacing ───────────────────────────
    // Previously zero coverage. The hardcoded "cookie 缺 a1 或 /user/me 调用
    // 失败" string swallowed 4+ distinct failure modes; tests below pin the
    // new surface: collector pre-flight (-10 missing a1) + apiClient-side
    // codes propagate verbatim into the card error message.

    @Test
    fun `onXhsLoginCookie surfaces code -10 when a1 cookie field missing`() = runTest(testDispatcher) {
        coEvery { xhsCollector.acceptLoginCookie(any(), any()) } returns false
        every { xhsCollector.lastLoginErrorCode } returns -10
        every { xhsCollector.lastLoginErrorMessage } returns
            "cookie 缺 a1 字段 (anti-bot fingerprint cookie 未捕到 — WebView 抓 cookie 时机问题或域不匹配)"

        val vm = newVm()
        advanceUntilIdle()
        vm.requestXhsLogin()
        vm.onXhsLoginCookie("web_session=x; webBuild=v1")  // no a1
        advanceUntilIdle()

        assertNull(vm.state.value.pendingLogin)
        assertFalse(vm.state.value.xiaohongshu.isLoggedIn)
        val err = vm.state.value.xiaohongshu.errorMessage
        assertNotNull(err)
        assertTrue(err!!.contains("code=-10"), "expected code surface; got: $err")
        assertTrue(err.contains("a1"), "expected a1 mention; got: $err")
    }

    @Test
    fun `onXhsLoginCookie surfaces apiClient HTTP 461 when fetchMe is rejected`() = runTest(testDispatcher) {
        // 461 = X-S signature failure / anti-bot ban — the most common
        // upstream-side failure. Verify code+message propagate verbatim.
        coEvery { xhsCollector.acceptLoginCookie(any(), any()) } returns false
        every { xhsCollector.lastLoginErrorCode } returns 461
        every { xhsCollector.lastLoginErrorMessage } returns "HTTP 461"

        val vm = newVm()
        advanceUntilIdle()
        vm.requestXhsLogin()
        vm.onXhsLoginCookie("web_session=ok; a1=fp")
        advanceUntilIdle()

        val err = vm.state.value.xiaohongshu.errorMessage
        assertNotNull(err)
        assertTrue(err!!.contains("code=461"), "expected upstream code surface; got: $err")
        assertTrue(err.contains("HTTP 461"), "expected upstream msg surface; got: $err")
    }

    @Test
    fun `onXhsLoginCookie clears error and refreshes state when accepted`() = runTest(testDispatcher) {
        coEvery { xhsCollector.acceptLoginCookie(any(), any()) } returns true
        every { xhsCredentials.hasCredentials() } returnsMany listOf(false, true)
        every { xhsCredentials.getUid() } returnsMany listOf(null, 99L)

        val vm = newVm()
        advanceUntilIdle()
        vm.requestXhsLogin()
        vm.onXhsLoginCookie("web_session=ok; a1=fp")
        advanceUntilIdle()

        assertNull(vm.state.value.pendingLogin)
        assertTrue(vm.state.value.xiaohongshu.isLoggedIn)
        assertNull(vm.state.value.xiaohongshu.errorMessage)
    }

    // ─── Other social stubs (xiaohongshu only — kept for forward-compat) ────
    // §A8 v0.2: weibo + douyin migrated out of stub path — see their lifecycle
    // tests above. requestSocialLoginStub still maps all 3 → forward-compat
    // but HubLocalScreen no longer routes weibo/douyin through it.

    @Test
    fun `requestSocialLoginStub for douyin surfaces error on douyin card only`() = runTest(testDispatcher) {
        val vm = newVm()
        advanceUntilIdle()
        vm.requestSocialLoginStub("douyin")
        assertNotNull(vm.state.value.douyin.errorMessage)
        assertTrue(vm.state.value.douyin.errorMessage!!.contains("v0.2"))
        // Other cards untouched
        assertNull(vm.state.value.weibo.errorMessage)
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
        coEvery {
            ccRunner.askQuestion(any(), any(), any(), any(), any(), any())
        } returns LocalCcRunner.AskResult.Ok(
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
        // 与此同时 maxFacts/maxQueryLimit 切到 CLOUD 档 (80/200) 因为大模型 32K+ 上下文撑得起。
        io.mockk.coVerify(exactly = 1) {
            ccRunner.askQuestion(
                question = "q",
                ollamaUrl = "http://127.0.0.1:18484",
                acceptNonLocal = true,
                maxFacts = 80,
                maxQueryLimit = 200,
                timeoutMs = any(),
            )
        }
    }

    @Test
    fun `askQuestion local model uses small budget maxFacts=20 maxQueryLimit=50`() =
        runTest(testDispatcher) {
            // 本机小模型分档：HubLocalViewModel 显式传 20/50 (FACTS_BUDGET_LOCAL
            // / QUERY_LIMIT_BUDGET_LOCAL)，防 Qwen2.5-1.5B / Gemma-2B 2-4K 窗口
            // 撑爆。toggle OFF (allowCloudFallback=false) 走这一档。
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
            io.mockk.coVerify(exactly = 1) {
                ccRunner.askQuestion(
                    question = "q",
                    ollamaUrl = any(),
                    acceptNonLocal = false,
                    maxFacts = 20,
                    maxQueryLimit = 50,
                    timeoutMs = any(),
                )
            }
        }

    @Test
    fun `askQuestion cloud model uses larger budget maxFacts=80 maxQueryLimit=200`() =
        runTest(testDispatcher) {
            // 云大模型分档：toggle ON (allowCloudFallback=true) 走 80/200 —
            // GPT/DeepSeek/Doubao 32K+ 上下文撑得起，召回更全。用户 2026-05-24
            // 反馈："用云模型时可以把更多上下文加入"。
            coEvery {
                ccRunner.askQuestion(any(), any(), any(), any(), any(), any())
            } returns LocalCcRunner.AskResult.Ok(
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
            io.mockk.coVerify(exactly = 1) {
                ccRunner.askQuestion(
                    question = "q",
                    ollamaUrl = any(),
                    acceptNonLocal = true,
                    maxFacts = 80,
                    maxQueryLimit = 200,
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

    // ─── A3 — meta-question 短路 (你是谁/你好/...) ───────────────────────────
    //
    // Fast-path 走 llmEngine.chat 直接进程内推理，跳过 cc 子进程 + RAG。覆盖：
    //  - 命中白名单：调 llmEngine 不调 ccRunner
    //  - 未命中：保留原 ccRunner 路径（旧测试群已覆盖，这里只确认混合调度未误伤）
    //  - llmEngine 抛错：errorMessage 透出"本机推理失败"

    @Test
    fun `askQuestion meta question 你是谁 takes fast path via llmEngine`() = runTest(testDispatcher) {
        every { llmEngine.name } returns "mediapipe-gemma-2b"
        coEvery { llmEngine.chat(any(), any()) } returns LlmInferenceEngine.ChatResponse(
            text = "我是 ChainlessChain 的本机助手。",
            promptTokens = 8,
            completionTokens = 14,
            totalDurationMs = 320L,
        )
        val vm = newVm()
        advanceUntilIdle()

        vm.onAskQuestionChanged("你是谁")
        vm.askQuestion()
        advanceUntilIdle()

        val s = vm.state.value.ask
        assertFalse(s.isAsking)
        assertEquals("我是 ChainlessChain 的本机助手。", s.answer)
        assertTrue(s.citations.isEmpty())
        assertTrue(s.isLocal)
        assertEquals("mediapipe-gemma-2b (本机·直答)", s.llmName)
        // Critical: cc 子进程没被打扰
        io.mockk.coVerify(exactly = 0) { ccRunner.askQuestion(any(), any(), any(), any()) }
        io.mockk.coVerify(exactly = 1) { llmEngine.chat(any(), any()) }
    }

    @Test
    fun `askQuestion meta question normalization with trailing qmark takes fast path`() = runTest(testDispatcher) {
        every { llmEngine.name } returns "mediapipe"
        coEvery { llmEngine.chat(any(), any()) } returns LlmInferenceEngine.ChatResponse(
            text = "你好！", promptTokens = 1, completionTokens = 1, totalDurationMs = 50L,
        )
        val vm = newVm()
        advanceUntilIdle()

        vm.onAskQuestionChanged("  你好？  ")
        vm.askQuestion()
        advanceUntilIdle()

        assertEquals("你好！", vm.state.value.ask.answer)
        io.mockk.coVerify(exactly = 0) { ccRunner.askQuestion(any(), any(), any(), any()) }
    }

    @Test
    fun `askQuestion non-meta question still uses cc subprocess path`() = runTest(testDispatcher) {
        coEvery { ccRunner.askQuestion(any(), any(), any(), any()) } returns LocalCcRunner.AskResult.Ok(
            report = LocalCcRunner.AskReport(
                answer = "data-driven answer",
                citations = emptyList(),
                llmName = "ollama:qwen", isLocal = true, durationMs = 1234L,
            ),
            rawJson = "{}",
        )
        val vm = newVm()
        advanceUntilIdle()

        vm.onAskQuestionChanged("上周妈妈给我打了几个电话")
        vm.askQuestion()
        advanceUntilIdle()

        assertEquals("data-driven answer", vm.state.value.ask.answer)
        io.mockk.coVerify(exactly = 1) { ccRunner.askQuestion(any(), any(), any(), any()) }
        io.mockk.coVerify(exactly = 0) { llmEngine.chat(any(), any()) }
    }

    @Test
    fun `askQuestion meta question surfaces error when llmEngine throws`() = runTest(testDispatcher) {
        every { llmEngine.name } returns "noop-llm"
        coEvery { llmEngine.chat(any(), any()) } throws
            com.chainlesschain.android.pdh.llm.LlmInferenceException("engine not wired")
        val vm = newVm()
        advanceUntilIdle()

        vm.onAskQuestionChanged("hi")
        vm.askQuestion()
        advanceUntilIdle()

        val s = vm.state.value.ask
        assertFalse(s.isAsking)
        assertNotNull(s.errorMessage)
        assertTrue(s.errorMessage!!.contains("本机推理失败"))
        assertTrue(s.errorMessage!!.contains("engine not wired"))
        io.mockk.coVerify(exactly = 0) { ccRunner.askQuestion(any(), any(), any(), any()) }
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
        // StandardTestDispatcher queues viewModelScope.launch — runCurrent
        // dispatches it so ccRunner.destroyVault is actually invoked. Without
        // this, the mocked call hasn't happened yet when coVerify runs.
        // delay(1_000_000) inside coAnswers keeps the coroutine suspended,
        // so destroying stays true (no advanceUntilIdle past the delay).
        runCurrent()
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
        // runCurrent dispatches viewModelScope.launch so ccRunner.exportVault
        // is invoked; delay(1_000_000) inside coAnswers keeps it suspended.
        runCurrent()
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

    // 2026-05-24 vault preview sheet — "看本机数据" entry point so users can
    // verify what actually landed in vault after a sync (vs trusting card
    // lastSyncCount / AI answer).

    @Test
    fun `requestVaultPreview success populates rows`() = runTest(testDispatcher) {
        val rows = listOf(
            LocalCcRunner.EventRow(
                id = "weibo:post:abc",
                subtype = "social.post",
                occurredAt = 1716000000000L,
                ingestedAt = 1716100000000L,
                sourceAdapter = "social-weibo",
                summary = "今天天气真好",
                rawJson = "{}",
            ),
            LocalCcRunner.EventRow(
                id = "weibo:follow:xyz",
                subtype = "social.follow",
                occurredAt = 1715900000000L,
                ingestedAt = 1716100000000L,
                sourceAdapter = "social-weibo",
                summary = "@另一个用户",
                rawJson = "{}",
            ),
        )
        coEvery { ccRunner.queryEvents(adapter = "social-weibo", limit = any(), timeoutMs = any()) } returns
            LocalCcRunner.QueryEventsResult.Ok(rows = rows)
        val vm = newVm()
        advanceUntilIdle()

        vm.requestVaultPreview(adapter = "social-weibo", displayName = "微博")
        assertTrue(vm.state.value.vaultPreview.open)
        assertTrue(vm.state.value.vaultPreview.isLoading)
        assertEquals("social-weibo", vm.state.value.vaultPreview.adapterFilter)
        assertEquals("微博", vm.state.value.vaultPreview.displayName)

        advanceUntilIdle()
        val p = vm.state.value.vaultPreview
        assertTrue(p.open)
        assertFalse(p.isLoading)
        assertEquals(2, p.rows.size)
        assertEquals("weibo:post:abc", p.rows[0].id)
        assertEquals("social.post", p.rows[0].subtype)
        assertEquals("今天天气真好", p.rows[0].summary)
        assertNull(p.errorMessage)
    }

    @Test
    fun `requestVaultPreview empty rows surfaces empty state`() = runTest(testDispatcher) {
        coEvery { ccRunner.queryEvents(adapter = "social-weibo", limit = any(), timeoutMs = any()) } returns
            LocalCcRunner.QueryEventsResult.Ok(rows = emptyList())
        val vm = newVm()
        advanceUntilIdle()
        vm.requestVaultPreview(adapter = "social-weibo", displayName = "微博")
        advanceUntilIdle()
        val p = vm.state.value.vaultPreview
        assertTrue(p.open)
        assertFalse(p.isLoading)
        assertEquals(0, p.rows.size)
        assertNull(p.errorMessage)
    }

    @Test
    fun `requestVaultPreview failure surfaces errorMessage`() = runTest(testDispatcher) {
        coEvery { ccRunner.queryEvents(adapter = any(), limit = any(), timeoutMs = any()) } returns
            LocalCcRunner.QueryEventsResult.Failed("bootstrap-failed: cc shim missing", null)
        val vm = newVm()
        advanceUntilIdle()
        vm.requestVaultPreview(adapter = "social-weibo", displayName = "微博")
        advanceUntilIdle()
        val p = vm.state.value.vaultPreview
        assertTrue(p.open)
        assertFalse(p.isLoading)
        assertEquals(0, p.rows.size)
        assertEquals("bootstrap-failed: cc shim missing", p.errorMessage)
    }

    @Test
    fun `requestVaultPreview truncates long summary to 160 chars`() = runTest(testDispatcher) {
        val longText = "x".repeat(500)
        coEvery { ccRunner.queryEvents(adapter = any(), limit = any(), timeoutMs = any()) } returns
            LocalCcRunner.QueryEventsResult.Ok(
                rows = listOf(
                    LocalCcRunner.EventRow(
                        id = "id-1",
                        subtype = "x.y",
                        occurredAt = 1L,
                        ingestedAt = 2L,
                        sourceAdapter = "social-weibo",
                        summary = longText,
                        rawJson = "{}",
                    ),
                )
            )
        val vm = newVm()
        advanceUntilIdle()
        vm.requestVaultPreview(adapter = "social-weibo")
        advanceUntilIdle()
        val row = vm.state.value.vaultPreview.rows.single()
        assertEquals(160, row.summary?.length)
    }

    @Test
    fun `dismissVaultPreview closes sheet`() = runTest(testDispatcher) {
        coEvery { ccRunner.queryEvents(adapter = any(), limit = any(), timeoutMs = any()) } returns
            LocalCcRunner.QueryEventsResult.Ok(rows = emptyList())
        val vm = newVm()
        advanceUntilIdle()
        vm.requestVaultPreview(adapter = "social-weibo")
        advanceUntilIdle()
        assertTrue(vm.state.value.vaultPreview.open)
        vm.dismissVaultPreview()
        assertFalse(vm.state.value.vaultPreview.open)
        assertNull(vm.state.value.vaultPreview.adapterFilter)
        assertEquals(0, vm.state.value.vaultPreview.rows.size)
    }

    @Test
    fun `requestVaultPreview stale guard drops late result for different filter`() = runTest(testDispatcher) {
        coEvery { ccRunner.queryEvents(adapter = "social-bilibili", limit = any(), timeoutMs = any()) } returns
            LocalCcRunner.QueryEventsResult.Ok(
                rows = listOf(
                    LocalCcRunner.EventRow(
                        id = "stale", subtype = "x", occurredAt = 1L, ingestedAt = 2L,
                        sourceAdapter = "social-bilibili", summary = "stale-row", rawJson = "{}",
                    ),
                )
            )
        coEvery { ccRunner.queryEvents(adapter = "social-weibo", limit = any(), timeoutMs = any()) } returns
            LocalCcRunner.QueryEventsResult.Ok(
                rows = listOf(
                    LocalCcRunner.EventRow(
                        id = "fresh", subtype = "x", occurredAt = 1L, ingestedAt = 2L,
                        sourceAdapter = "social-weibo", summary = "fresh-row", rawJson = "{}",
                    ),
                )
            )
        val vm = newVm()
        advanceUntilIdle()

        // User taps "看采集到的" on Bilibili card, then before result lands taps
        // 微博 card. The first response must NOT bleed into the 微博 sheet.
        vm.requestVaultPreview(adapter = "social-bilibili")
        vm.requestVaultPreview(adapter = "social-weibo")
        advanceUntilIdle()
        val p = vm.state.value.vaultPreview
        assertEquals("social-weibo", p.adapterFilter)
        assertEquals("fresh", p.rows.single().id)
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
        // runCurrent dispatches viewModelScope.launch so ccRunner.askQuestion
        // is invoked; delay(1_000_000) inside coAnswers keeps it suspended,
        // so isAsking stays true without advancing virtual time past the delay.
        runCurrent()
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

    // ─── §2.6 D10.2 — AI 助手 8 路 WebView (合并 wenxin+qianfan 后) ────────

    @Test
    fun `init renders 8 AI vendor cards in推文 order (wenxin+qianfan merged)`() = runTest(testDispatcher) {
        every { aiChatCredentials.hasCredentials(any()) } returns false
        every { aiChatCredentials.getLastSyncAt(any()) } returns null
        every { aiChatCredentials.getLastSyncCount(any()) } returns 0
        val vm = newVm()
        advanceUntilIdle()
        val keys = vm.state.value.aiChat.keys
        // 2026-05-22 推文原 9 家中独立"千帆" entry 合并到"文心一言" (key=qianfan
        // 对齐桌面 qianfan adapter BASE=yiyan.baidu.com)，UI 显 8 张。
        assertEquals(8, keys.size)
        assertTrue("doubao" in keys)
        assertTrue("qianfan" in keys)   // 文心一言 (WENXIN entry, key=qianfan)
        assertTrue("kimi" in keys)
        assertTrue("tongyi" in keys)
        assertTrue("deepseek" in keys)
        assertTrue("zhipu" in keys)
        assertTrue("hunyuan" in keys)
        assertTrue("coze" in keys)
        // 旧 "wenxin" key 已删 (合到 qianfan)
        assertTrue("wenxin" !in keys)
    }

    @Test
    fun `requestAiChatLogin sets pendingLogin with vendor prefix`() = runTest(testDispatcher) {
        every { aiChatCredentials.hasCredentials(any()) } returns false
        val vm = newVm()
        advanceUntilIdle()
        vm.requestAiChatLogin("kimi")
        val p = vm.state.value.pendingLogin
        assertNotNull(p)
        assertEquals("ai-chat:kimi", p.adapterName)
        assertEquals("Kimi (月之暗面)", p.displayName)
        assertTrue(p.loginUrl.contains("kimi.moonshot.cn"))
        assertTrue(p.cookieDomain.contains("kimi.moonshot.cn"))
        // isLoginSuccess: post-login URL hits the success domain without /auth/
        assertTrue(p.isLoginSuccess("https://kimi.moonshot.cn/chat/abc"))
        assertFalse(p.isLoginSuccess("https://kimi.moonshot.cn/auth/sign-in"))
    }

    @Test
    fun `requestAiChatLogin unknown vendor is no-op`() = runTest(testDispatcher) {
        val vm = newVm()
        advanceUntilIdle()
        vm.requestAiChatLogin("not-a-vendor")
        assertNull(vm.state.value.pendingLogin)
    }

    @Test
    fun `onAiChatLoginCookie saves cookie + refreshes hasCredentials`() = runTest(testDispatcher) {
        // First call: not logged in. After saveCookie + refresh: logged in.
        every { aiChatCredentials.hasCredentials("doubao") } returnsMany listOf(false, true)
        every { aiChatCredentials.getLastSyncAt(any()) } returns null
        every { aiChatCredentials.getLastSyncCount(any()) } returns 0
        every { aiChatCredentials.saveCookie(any(), any()) } just runs

        val vm = newVm()
        advanceUntilIdle()
        // Pre-condition: doubao card not logged in
        assertFalse(vm.state.value.aiChat["doubao"]?.isLoggedIn ?: true)

        vm.requestAiChatLogin("doubao")
        vm.onAiChatLoginCookie("doubao", "SESSION_KEY=abc; PASSPORT_KEY=def")
        advanceUntilIdle()

        io.mockk.verify { aiChatCredentials.saveCookie("doubao", "SESSION_KEY=abc; PASSPORT_KEY=def") }
        assertNull(vm.state.value.pendingLogin)
        assertTrue(vm.state.value.aiChat["doubao"]?.isLoggedIn == true)
    }

    @Test
    fun `onAiChatLoginCookie blank cookie surfaces error not saveCookie`() = runTest(testDispatcher) {
        every { aiChatCredentials.hasCredentials(any()) } returns false
        val vm = newVm()
        advanceUntilIdle()
        vm.requestAiChatLogin("kimi")
        vm.onAiChatLoginCookie("kimi", "")
        advanceUntilIdle()
        assertNull(vm.state.value.pendingLogin)
        io.mockk.verify(exactly = 0) { aiChatCredentials.saveCookie(any(), any()) }
        assertTrue(vm.state.value.aiChat["kimi"]?.errorMessage?.contains("cookie") == true)
    }

    @Test
    fun `syncAiChat when not logged in triggers requestAiChatLogin instead`() = runTest(testDispatcher) {
        every { aiChatCredentials.hasCredentials(any()) } returns false
        val vm = newVm()
        advanceUntilIdle()
        vm.syncAiChat("deepseek")
        advanceUntilIdle()
        // Not logged in → routed to login flow, no cc call
        assertNotNull(vm.state.value.pendingLogin)
        assertEquals("ai-chat:deepseek", vm.state.value.pendingLogin?.adapterName)
        io.mockk.coVerify(exactly = 0) { ccRunner.syncAdapter(any(), any(), any()) }
    }

    @Test
    fun `syncAiChat Ok records lastSync + clears error`() = runTest(testDispatcher) {
        val filesDir = java.io.File.createTempFile("files", "").let { it.delete(); it.mkdirs(); it }
        every { appContext.filesDir } returns filesDir
        every { aiChatCredentials.hasCredentials("tongyi") } returns true
        every { aiChatCredentials.getCookie("tongyi") } returns "session_token=stub"
        every { aiChatCredentials.getLastSyncAt(any()) } returns null
        every { aiChatCredentials.getLastSyncCount(any()) } returns 0
        every { aiChatCredentials.recordSync(any(), any(), any()) } just runs
        coEvery { ccRunner.syncAdapter("ai-chat-history", any(), any()) } returns
            LocalCcRunner.CcResult.Ok(
                report = LocalCcRunner.SyncReport(
                    adapter = "ai-chat-history",
                    status = "ok",
                    ingested = 42,
                    invalidCount = 0,
                    kgTriples = 0,
                    ragDocs = 0,
                    durationMs = 100L,
                    error = null,
                ),
                rawJson = "{}",
            )

        val vm = newVm()
        advanceUntilIdle()
        vm.syncAiChat("tongyi")
        advanceUntilIdle()

        val card = vm.state.value.aiChat["tongyi"]!!
        assertFalse(card.isSyncing)
        assertNotNull(card.lastSyncAt)
        assertEquals(42, card.lastSyncCount)
        assertNull(card.errorMessage)
        io.mockk.verify { aiChatCredentials.recordSync("tongyi", any(), 42) }
    }

    @Test
    fun `syncAiChat cc failure with not-found surfaces v0_2 hint`() = runTest(testDispatcher) {
        val filesDir = java.io.File.createTempFile("files", "").let { it.delete(); it.mkdirs(); it }
        every { appContext.filesDir } returns filesDir
        every { aiChatCredentials.hasCredentials("doubao") } returns true
        every { aiChatCredentials.getCookie("doubao") } returns "cookie-stub"
        every { aiChatCredentials.getLastSyncAt(any()) } returns null
        every { aiChatCredentials.getLastSyncCount(any()) } returns 0
        coEvery { ccRunner.syncAdapter(any(), any(), any()) } returns
            LocalCcRunner.CcResult.Failed("adapter doubao not found in registry", 1, null)

        val vm = newVm()
        advanceUntilIdle()
        vm.syncAiChat("doubao")
        advanceUntilIdle()

        val card = vm.state.value.aiChat["doubao"]!!
        assertFalse(card.isSyncing)
        assertTrue(card.errorMessage?.contains("v0.2") == true)
    }

    @Test
    fun `logoutAiChat clears one vendor without disturbing others`() = runTest(testDispatcher) {
        // Initial: kimi + deepseek both logged in
        every { aiChatCredentials.hasCredentials("kimi") } returnsMany listOf(true, false)
        every { aiChatCredentials.hasCredentials("deepseek") } returns true
        every { aiChatCredentials.getLastSyncAt(any()) } returns null
        every { aiChatCredentials.getLastSyncCount(any()) } returns 0
        every { aiChatCredentials.clear("kimi") } just runs

        val vm = newVm()
        advanceUntilIdle()
        assertTrue(vm.state.value.aiChat["kimi"]?.isLoggedIn == true)
        assertTrue(vm.state.value.aiChat["deepseek"]?.isLoggedIn == true)

        vm.logoutAiChat("kimi")
        advanceUntilIdle()

        io.mockk.verify { aiChatCredentials.clear("kimi") }
        // kimi cleared (second hasCredentials returns false), deepseek untouched
        assertFalse(vm.state.value.aiChat["kimi"]?.isLoggedIn ?: true)
        assertTrue(vm.state.value.aiChat["deepseek"]?.isLoggedIn == true)
    }

    // ─── §2.3 D6.2 — Email IMAP 4 vendor ─────────────────────────────────

    @Test
    fun `init renders 4 email vendor cards`() = runTest(testDispatcher) {
        every { emailCredentials.hasCredentials(any()) } returns false
        val vm = newVm()
        advanceUntilIdle()
        val keys = vm.state.value.email.keys
        assertEquals(4, keys.size)
        assertTrue("qq" in keys)
        assertTrue("gmail" in keys)
        assertTrue("netease163" in keys)
        assertTrue("outlook" in keys)
    }

    @Test
    fun `requestEmailLogin flips pendingDialog for vendor`() = runTest(testDispatcher) {
        every { emailCredentials.hasCredentials(any()) } returns false
        val vm = newVm()
        advanceUntilIdle()
        vm.requestEmailLogin("qq")
        assertTrue(vm.state.value.email["qq"]?.pendingDialog == true)
        assertFalse(vm.state.value.email["gmail"]?.pendingDialog ?: false)
    }

    @Test
    fun `submitEmailCredentials saves + triggers sync + records ingested`() = runTest(testDispatcher) {
        every { emailCredentials.hasCredentials("qq") } returnsMany listOf(false, true)
        every { emailCredentials.hasCredentials(match<String> { it != "qq" }) } returns false
        io.mockk.coEvery {
            emailCollector.snapshot("qq", any())
        } returns EmailLocalCollector.SnapshotResult.Ok(
            snapshotPath = "/tmp/snap.json", fetchedCount = 12,
        )
        coEvery { ccRunner.syncAdapter("email-imap", "/tmp/snap.json", any()) } returns
            LocalCcRunner.CcResult.Ok(
                report = LocalCcRunner.SyncReport(
                    adapter = "email-imap",
                    status = "ok",
                    ingested = 12,
                    invalidCount = 0,
                    kgTriples = 0,
                    ragDocs = 0,
                    durationMs = 200L,
                    error = null,
                ),
                rawJson = "{}",
            )
        every { emailCredentials.saveCredentials(any(), any(), any(), any(), any()) } just runs
        every { emailCredentials.recordSync(any(), any(), any()) } just runs

        val vm = newVm()
        advanceUntilIdle()
        vm.requestEmailLogin("qq")
        vm.submitEmailCredentials(
            vendorKey = "qq",
            user = "me@qq.com",
            password = "AUTHCODE123456",
            imapHost = "imap.qq.com",
            imapPort = 993,
        )
        advanceUntilIdle()

        io.mockk.verify {
            emailCredentials.saveCredentials(
                "qq", "me@qq.com", "AUTHCODE123456", "imap.qq.com", 993,
            )
        }
        val card = vm.state.value.email["qq"]!!
        assertFalse(card.pendingDialog)
        assertFalse(card.isSyncing)
        assertNotNull(card.lastSyncAt)
        assertEquals(12, card.lastSyncCount)
        assertNull(card.errorMessage)
        io.mockk.verify { emailCredentials.recordSync("qq", any(), 12) }
    }

    @Test
    fun `submitEmailCredentials rejects empty user`() = runTest(testDispatcher) {
        every { emailCredentials.hasCredentials(any()) } returns false
        val vm = newVm()
        advanceUntilIdle()
        vm.submitEmailCredentials(
            vendorKey = "qq", user = "", password = "x", imapHost = "imap.qq.com", imapPort = 993,
        )
        advanceUntilIdle()
        assertTrue(vm.state.value.email["qq"]?.errorMessage?.contains("不完整") == true)
        io.mockk.verify(exactly = 0) {
            emailCredentials.saveCredentials(any(), any(), any(), any(), any())
        }
    }

    @Test
    fun `syncEmail surface AuthFailed friendly message`() = runTest(testDispatcher) {
        every { emailCredentials.hasCredentials("gmail") } returns true
        every { emailCredentials.hasCredentials(match<String> { it != "gmail" }) } returns false
        io.mockk.coEvery {
            emailCollector.snapshot("gmail", any())
        } returns EmailLocalCollector.SnapshotResult.AuthFailed("invalid credentials")
        val vm = newVm()
        advanceUntilIdle()
        vm.syncEmail("gmail")
        advanceUntilIdle()
        val card = vm.state.value.email["gmail"]!!
        assertFalse(card.isSyncing)
        assertTrue(card.errorMessage?.contains("认证失败") == true)
    }

    @Test
    fun `syncEmail Empty path surfaces inbox-empty hint`() = runTest(testDispatcher) {
        every { emailCredentials.hasCredentials("outlook") } returns true
        every { emailCredentials.hasCredentials(match<String> { it != "outlook" }) } returns false
        io.mockk.coEvery {
            emailCollector.snapshot("outlook", any())
        } returns EmailLocalCollector.SnapshotResult.Empty
        val vm = newVm()
        advanceUntilIdle()
        vm.syncEmail("outlook")
        advanceUntilIdle()
        assertTrue(vm.state.value.email["outlook"]?.errorMessage?.contains("空") == true)
    }

    @Test
    fun `syncEmail Ok but cc adapter not-found surfaces v0_2 hint`() = runTest(testDispatcher) {
        every { emailCredentials.hasCredentials("netease163") } returns true
        every { emailCredentials.hasCredentials(match<String> { it != "netease163" }) } returns false
        io.mockk.coEvery {
            emailCollector.snapshot("netease163", any())
        } returns EmailLocalCollector.SnapshotResult.Ok("/tmp/snap.json", 5)
        coEvery { ccRunner.syncAdapter("email-imap", any(), any()) } returns
            LocalCcRunner.CcResult.Failed("unknown adapter: email-imap", 1, null)
        val vm = newVm()
        advanceUntilIdle()
        vm.syncEmail("netease163")
        advanceUntilIdle()
        val card = vm.state.value.email["netease163"]!!
        assertFalse(card.isSyncing)
        assertTrue(card.errorMessage?.contains("v0.2") == true)
    }

    @Test
    fun `logoutEmail clears one vendor without disturbing others`() = runTest(testDispatcher) {
        every { emailCredentials.hasCredentials("qq") } returnsMany listOf(true, false)
        every { emailCredentials.hasCredentials("gmail") } returns true
        every { emailCredentials.hasCredentials(match<String> { it !in setOf("qq", "gmail") }) } returns false
        every { emailCredentials.clear("qq") } just runs
        val vm = newVm()
        advanceUntilIdle()
        assertTrue(vm.state.value.email["qq"]?.hasCredentials == true)
        vm.logoutEmail("qq")
        advanceUntilIdle()
        io.mockk.verify { emailCredentials.clear("qq") }
        assertFalse(vm.state.value.email["qq"]?.hasCredentials ?: true)
        assertTrue(vm.state.value.email["gmail"]?.hasCredentials == true)
    }

    // ─── §2.5 D8.2 + §2.5b 地图扩展 — Travel (高德 / 百度 / 腾讯 / 携程 / 12306) ──

    @Test
    fun `init renders 5 travel vendor cards including 3 maps and 12306`() = runTest(testDispatcher) {
        every { travelCredentials.hasCredentials(any()) } returns false
        val vm = newVm()
        advanceUntilIdle()
        val keys = vm.state.value.travel.keys
        // 3 地图 + 2 出行 (携程 + 12306) = 5 卡
        assertEquals(5, keys.size)
        assertTrue("travel-amap" in keys)
        assertTrue("travel-baidu-map" in keys)
        assertTrue("travel-tencent-map" in keys)
        assertTrue("travel-ctrip" in keys)
        assertTrue("travel-12306" in keys)
    }

    @Test
    fun `requestTravelLogin for 12306 uses kyfw URL + isLoginSuccess excludes login captcha`() =
        runTest(testDispatcher) {
            every { travelCredentials.hasCredentials(any()) } returns false
            val vm = newVm()
            advanceUntilIdle()
            vm.requestTravelLogin("travel-12306")
            val p = vm.state.value.pendingLogin
            assertNotNull(p)
            assertEquals("travel:travel-12306", p.adapterName)
            assertEquals("12306", p.displayName)
            assertTrue(p.loginUrl.contains("kyfw.12306.cn"))
            // isLoginSuccess: 已到 kyfw.12306.cn 主路径视为成功；login / passport /
            // captcha 中间页判 false (12306 滑块验证码走 /captcha-conf 子路径)
            assertTrue(p.isLoginSuccess("https://kyfw.12306.cn/otn/view/index.html"))
            assertTrue(p.isLoginSuccess("https://kyfw.12306.cn/otn/leftTicket/init"))
            assertFalse(p.isLoginSuccess("https://kyfw.12306.cn/otn/resources/login.html"))
            assertFalse(p.isLoginSuccess("https://kyfw.12306.cn/passport/web/login"))
            assertFalse(p.isLoginSuccess("https://kyfw.12306.cn/captcha-conf/captcha-image"))
        }

    @Test
    fun `requestTravelLogin for baidu-map uses map_baidu_com URL + isLoginSuccess excludes passport`() =
        runTest(testDispatcher) {
            every { travelCredentials.hasCredentials(any()) } returns false
            val vm = newVm()
            advanceUntilIdle()
            vm.requestTravelLogin("travel-baidu-map")
            val p = vm.state.value.pendingLogin
            assertNotNull(p)
            assertEquals("travel:travel-baidu-map", p.adapterName)
            assertEquals("百度地图", p.displayName)
            assertTrue(p.loginUrl.contains("map.baidu.com"))
            // isLoginSuccess: 已到 map.baidu.com 视为成功；passport / sso / login
            // 中间页判 false
            assertTrue(p.isLoginSuccess("https://map.baidu.com/"))
            assertFalse(p.isLoginSuccess("https://passport.baidu.com/v2/?login"))
            assertFalse(p.isLoginSuccess("https://sso.baidu.com/login"))
        }

    @Test
    fun `requestTravelLogin for tencent-map uses map_qq_com URL + isLoginSuccess excludes ptlogin`() =
        runTest(testDispatcher) {
            every { travelCredentials.hasCredentials(any()) } returns false
            val vm = newVm()
            advanceUntilIdle()
            vm.requestTravelLogin("travel-tencent-map")
            val p = vm.state.value.pendingLogin
            assertNotNull(p)
            assertEquals("travel:travel-tencent-map", p.adapterName)
            assertEquals("腾讯地图", p.displayName)
            assertTrue(p.loginUrl.contains("map.qq.com"))
            // isLoginSuccess: 回到 map.qq.com 视为成功；ptlogin / login 中间页 false
            assertTrue(p.isLoginSuccess("https://map.qq.com/"))
            assertFalse(p.isLoginSuccess("https://xui.ptlogin2.qq.com/cgi-bin/login"))
            assertFalse(p.isLoginSuccess("https://map.qq.com/login"))
        }

    @Test
    fun `requestTravelLogin sets pendingLogin with travel prefix`() = runTest(testDispatcher) {
        every { travelCredentials.hasCredentials(any()) } returns false
        val vm = newVm()
        advanceUntilIdle()
        vm.requestTravelLogin("travel-ctrip")
        val p = vm.state.value.pendingLogin
        assertNotNull(p)
        assertEquals("travel:travel-ctrip", p.adapterName)
        assertEquals("携程", p.displayName)
        assertTrue(p.loginUrl.contains("accounts.ctrip.com"))
        // isLoginSuccess: 已到 www.ctrip.com / my.ctrip.com 为登录成功
        assertTrue(p.isLoginSuccess("https://www.ctrip.com/"))
        assertTrue(p.isLoginSuccess("https://my.ctrip.com/orders"))
        assertFalse(p.isLoginSuccess("https://accounts.ctrip.com/sso/login"))
    }

    @Test
    fun `onTravelLoginCookie saves cookie + refreshes isLoggedIn`() = runTest(testDispatcher) {
        every { travelCredentials.hasCredentials("travel-amap") } returnsMany listOf(false, true)
        every { travelCredentials.saveCookie(any(), any()) } just runs
        val vm = newVm()
        advanceUntilIdle()
        assertFalse(vm.state.value.travel["travel-amap"]?.isLoggedIn ?: true)
        vm.requestTravelLogin("travel-amap")
        vm.onTravelLoginCookie("travel-amap", "_uab_collina=stub; passport=abc")
        advanceUntilIdle()
        io.mockk.verify { travelCredentials.saveCookie("travel-amap", "_uab_collina=stub; passport=abc") }
        assertNull(vm.state.value.pendingLogin)
        assertTrue(vm.state.value.travel["travel-amap"]?.isLoggedIn == true)
    }

    @Test
    fun `onTravelLoginCookie blank cookie surfaces error not saveCookie`() = runTest(testDispatcher) {
        every { travelCredentials.hasCredentials(any()) } returns false
        val vm = newVm()
        advanceUntilIdle()
        vm.requestTravelLogin("travel-ctrip")
        vm.onTravelLoginCookie("travel-ctrip", "")
        advanceUntilIdle()
        assertNull(vm.state.value.pendingLogin)
        io.mockk.verify(exactly = 0) { travelCredentials.saveCookie(any(), any()) }
        assertTrue(vm.state.value.travel["travel-ctrip"]?.errorMessage?.contains("cookie") == true)
    }

    @Test
    fun `syncTravel when not logged in triggers requestTravelLogin instead`() = runTest(testDispatcher) {
        every { travelCredentials.hasCredentials(any()) } returns false
        val vm = newVm()
        advanceUntilIdle()
        vm.syncTravel("travel-amap")
        advanceUntilIdle()
        assertNotNull(vm.state.value.pendingLogin)
        assertEquals("travel:travel-amap", vm.state.value.pendingLogin?.adapterName)
        io.mockk.coVerify(exactly = 0) { ccRunner.syncAdapter(any(), any(), any()) }
    }

    @Test
    fun `syncTravel Ok records lastSync + clears error`() = runTest(testDispatcher) {
        val filesDir = java.io.File.createTempFile("files", "").let { it.delete(); it.mkdirs(); it }
        every { appContext.filesDir } returns filesDir
        every { travelCredentials.hasCredentials("travel-ctrip") } returns true
        every { travelCredentials.hasCredentials(match<String> { it != "travel-ctrip" }) } returns false
        every { travelCredentials.getCookie("travel-ctrip") } returns "cookie-stub"
        every { travelCredentials.recordSync(any(), any(), any()) } just runs
        coEvery { ccRunner.syncAdapter("travel-ctrip", any(), any()) } returns
            LocalCcRunner.CcResult.Ok(
                report = LocalCcRunner.SyncReport(
                    adapter = "travel-ctrip",
                    status = "ok",
                    ingested = 18,
                    invalidCount = 0,
                    kgTriples = 0,
                    ragDocs = 0,
                    durationMs = 90L,
                    error = null,
                ),
                rawJson = "{}",
            )
        val vm = newVm()
        advanceUntilIdle()
        vm.syncTravel("travel-ctrip")
        advanceUntilIdle()

        val card = vm.state.value.travel["travel-ctrip"]!!
        assertFalse(card.isSyncing)
        assertNotNull(card.lastSyncAt)
        assertEquals(18, card.lastSyncCount)
        assertNull(card.errorMessage)
        io.mockk.verify { travelCredentials.recordSync("travel-ctrip", any(), 18) }
    }

    @Test
    fun `syncTravel cc not-found surfaces v0_2 hint`() = runTest(testDispatcher) {
        val filesDir = java.io.File.createTempFile("files", "").let { it.delete(); it.mkdirs(); it }
        every { appContext.filesDir } returns filesDir
        every { travelCredentials.hasCredentials("travel-amap") } returns true
        every { travelCredentials.hasCredentials(match<String> { it != "travel-amap" }) } returns false
        every { travelCredentials.getCookie("travel-amap") } returns "cookie-stub"
        coEvery { ccRunner.syncAdapter(any(), any(), any()) } returns
            LocalCcRunner.CcResult.Failed("unknown adapter: travel-amap", 1, null)
        val vm = newVm()
        advanceUntilIdle()
        vm.syncTravel("travel-amap")
        advanceUntilIdle()
        val card = vm.state.value.travel["travel-amap"]!!
        assertFalse(card.isSyncing)
        assertTrue(card.errorMessage?.contains("v0.2") == true)
    }

    @Test
    fun `logoutTravel clears one vendor without disturbing the other`() = runTest(testDispatcher) {
        // 4 vendor 中只 stub amap + ctrip 已登录；其余 2 个地图 default false
        every { travelCredentials.hasCredentials(any()) } returns false
        every { travelCredentials.hasCredentials("travel-amap") } returnsMany listOf(true, false)
        every { travelCredentials.hasCredentials("travel-ctrip") } returns true
        every { travelCredentials.clear("travel-amap") } just runs
        val vm = newVm()
        advanceUntilIdle()
        assertTrue(vm.state.value.travel["travel-amap"]?.isLoggedIn == true)
        assertTrue(vm.state.value.travel["travel-ctrip"]?.isLoggedIn == true)
        vm.logoutTravel("travel-amap")
        advanceUntilIdle()
        io.mockk.verify { travelCredentials.clear("travel-amap") }
        assertFalse(vm.state.value.travel["travel-amap"]?.isLoggedIn ?: true)
        assertTrue(vm.state.value.travel["travel-ctrip"]?.isLoggedIn == true)
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

    // ─── §2.7 D11 SAF picker polish — requestExportVaultToUri ────────────────

    @Test
    fun `requestExportVaultToUri Ok copies temp to SAF Uri + records lastExportPath`() = runTest(testDispatcher) {
        // Pre-populate temp file so the cc mock can "succeed" referencing it.
        val tempDir = java.io.File.createTempFile("cache-stub", "").let { it.delete(); it.mkdirs(); it }
        every { appContext.cacheDir } returns tempDir

        // cc writes 4 bytes to the temp path
        coEvery { ccRunner.exportVault(any()) } coAnswers {
            val path = firstArg<String>()
            java.io.File(path).apply {
                parentFile?.mkdirs()
                writeBytes(byteArrayOf(0x01, 0x02, 0x03, 0x04))
            }
            LocalCcRunner.ExportResult.Ok(path, bytes = 4L, encrypted = true)
        }
        // ContentResolver.openOutputStream → in-memory ByteArrayOutputStream
        val resolver = io.mockk.mockk<android.content.ContentResolver>(relaxed = true)
        val captured = java.io.ByteArrayOutputStream()
        every { appContext.contentResolver } returns resolver
        val fakeUri = io.mockk.mockk<android.net.Uri>(relaxed = true)
        every { fakeUri.toString() } returns "content://stub/vault.db"
        every { resolver.openOutputStream(fakeUri, "wt") } returns captured

        val vm = newVm()
        advanceUntilIdle()
        vm.requestExportVaultToUri(fakeUri)
        advanceUntilIdle()

        val st = vm.state.value.threeLocks
        assertFalse(st.exporting)
        assertNull(st.exportError)
        assertEquals("content://stub/vault.db", st.lastExportPath)
        assertEquals(4L, st.lastExportBytes)
        // bytes round-tripped — 4 written by cc, 4 copied to SAF
        assertEquals(4, captured.toByteArray().size)
    }

    @Test
    fun `requestExportVaultToUri surfaces cc error and leaves lastExportPath null`() = runTest(testDispatcher) {
        every { appContext.cacheDir } returns java.io.File(System.getProperty("java.io.tmpdir"), "hub-test-${System.nanoTime()}").apply { mkdirs() }
        coEvery { ccRunner.exportVault(any()) } returns
            LocalCcRunner.ExportResult.Failed("vault locked", 1)

        val fakeUri = io.mockk.mockk<android.net.Uri>(relaxed = true)

        val vm = newVm()
        advanceUntilIdle()
        vm.requestExportVaultToUri(fakeUri)
        advanceUntilIdle()

        val st = vm.state.value.threeLocks
        assertFalse(st.exporting)
        assertEquals("vault locked", st.exportError)
        assertNull(st.lastExportPath)
    }

    // ─── §2.4 D7.2 — importPaymentShoppingFile ───────────────────────────

    @Test
    fun `importPaymentShoppingFile alipay-bill Ok updates lastImportAt + lastImportBytes`() = runTest(testDispatcher) {
        val filesDir = java.io.File.createTempFile("files", "").let { it.delete(); it.mkdirs(); it }
        every { appContext.filesDir } returns filesDir
        // Mock resolver returns an InputStream with 8 bytes
        val resolver = io.mockk.mockk<android.content.ContentResolver>(relaxed = true)
        every { appContext.contentResolver } returns resolver
        val fakeUri = io.mockk.mockk<android.net.Uri>(relaxed = true)
        every { resolver.openInputStream(fakeUri) } answers {
            java.io.ByteArrayInputStream("date,amt\n2026-01,99".toByteArray())
        }
        // cc.syncAdapter returns Ok with 5 ingested
        coEvery { ccRunner.syncAdapter("alipay-bill", any(), any()) } returns
            LocalCcRunner.CcResult.Ok(
                report = LocalCcRunner.SyncReport(
                    adapter = "alipay-bill",
                    status = "ok",
                    ingested = 5,
                    invalidCount = 0,
                    kgTriples = 0,
                    ragDocs = 0,
                    durationMs = 50L,
                    error = null,
                ),
                rawJson = "{}",
            )

        val vm = newVm()
        advanceUntilIdle()
        vm.importPaymentShoppingFile("alipay-bill", fakeUri)
        advanceUntilIdle()

        val card = vm.state.value.paymentShopping.alipayBill
        assertFalse(card.isImporting)
        assertNull(card.errorMessage)
        assertNotNull(card.lastImportAt)
        assertTrue(card.lastImportBytes > 0)
        assertNull(vm.state.value.globalSyncingAdapter)
        // Staged file actually written
        val staging = java.io.File(filesDir, "staging")
        val staged = staging.listFiles()?.firstOrNull { it.name.startsWith("alipay-bill-") && it.name.endsWith(".csv") }
        assertNotNull(staged)
    }

    @Test
    fun `importPaymentShoppingFile shopping-taobao writes HTML extension`() = runTest(testDispatcher) {
        val filesDir = java.io.File.createTempFile("files", "").let { it.delete(); it.mkdirs(); it }
        every { appContext.filesDir } returns filesDir
        val resolver = io.mockk.mockk<android.content.ContentResolver>(relaxed = true)
        every { appContext.contentResolver } returns resolver
        val fakeUri = io.mockk.mockk<android.net.Uri>(relaxed = true)
        every { resolver.openInputStream(fakeUri) } answers {
            java.io.ByteArrayInputStream("<html>orders</html>".toByteArray())
        }
        coEvery { ccRunner.syncAdapter("shopping-taobao", any(), any()) } returns
            LocalCcRunner.CcResult.Ok(
                report = LocalCcRunner.SyncReport(
                    adapter = "shopping-taobao",
                    status = "ok",
                    ingested = 3,
                    invalidCount = 0,
                    kgTriples = 0,
                    ragDocs = 0,
                    durationMs = 50L,
                    error = null,
                ),
                rawJson = "{}",
            )

        val vm = newVm()
        advanceUntilIdle()
        vm.importPaymentShoppingFile("shopping-taobao", fakeUri)
        advanceUntilIdle()

        assertNotNull(vm.state.value.paymentShopping.taobaoOrder.lastImportAt)
        val staging = java.io.File(filesDir, "staging")
        val staged = staging.listFiles()?.firstOrNull { it.name.startsWith("shopping-taobao-") && it.name.endsWith(".html") }
        assertNotNull(staged)
    }

    @Test
    fun `importPaymentShoppingFile empty file surfaces error + deletes staging`() = runTest(testDispatcher) {
        val filesDir = java.io.File.createTempFile("files", "").let { it.delete(); it.mkdirs(); it }
        every { appContext.filesDir } returns filesDir
        val resolver = io.mockk.mockk<android.content.ContentResolver>(relaxed = true)
        every { appContext.contentResolver } returns resolver
        val fakeUri = io.mockk.mockk<android.net.Uri>(relaxed = true)
        every { resolver.openInputStream(fakeUri) } answers {
            java.io.ByteArrayInputStream(byteArrayOf())  // empty
        }

        val vm = newVm()
        advanceUntilIdle()
        vm.importPaymentShoppingFile("alipay-bill", fakeUri)
        advanceUntilIdle()

        val card = vm.state.value.paymentShopping.alipayBill
        assertFalse(card.isImporting)
        assertTrue(card.errorMessage?.contains("空") == true)
        // Staged file must not linger (we delete on empty)
        val staging = java.io.File(filesDir, "staging")
        val stagedAfter = staging.listFiles()?.toList().orEmpty()
        assertTrue(stagedAfter.isEmpty(), "Expected staging dir empty, got: $stagedAfter")
    }

    @Test
    fun `importPaymentShoppingFile unknown providerKey is no-op`() = runTest(testDispatcher) {
        val fakeUri = io.mockk.mockk<android.net.Uri>(relaxed = true)
        val vm = newVm()
        advanceUntilIdle()
        vm.importPaymentShoppingFile("alipay-foo-typo", fakeUri)
        advanceUntilIdle()
        // No state mutation, no cc call
        assertFalse(vm.state.value.paymentShopping.alipayBill.isImporting)
        assertFalse(vm.state.value.paymentShopping.taobaoOrder.isImporting)
    }

    @Test
    fun `clearPaymentImportError nulls per-card errorMessage`() = runTest(testDispatcher) {
        val filesDir = java.io.File.createTempFile("files", "").let { it.delete(); it.mkdirs(); it }
        every { appContext.filesDir } returns filesDir
        val resolver = io.mockk.mockk<android.content.ContentResolver>(relaxed = true)
        every { appContext.contentResolver } returns resolver
        val fakeUri = io.mockk.mockk<android.net.Uri>(relaxed = true)
        every { resolver.openInputStream(fakeUri) } answers {
            java.io.ByteArrayInputStream(byteArrayOf())  // empty → error
        }
        val vm = newVm()
        advanceUntilIdle()
        vm.importPaymentShoppingFile("alipay-bill", fakeUri)
        advanceUntilIdle()
        assertNotNull(vm.state.value.paymentShopping.alipayBill.errorMessage)
        vm.clearPaymentImportError("alipay-bill")
        assertNull(vm.state.value.paymentShopping.alipayBill.errorMessage)
    }

    @Test
    fun `requestExportVaultToUri reentrancy guard — second call no-ops while exporting`() = runTest(testDispatcher) {
        every { appContext.cacheDir } returns java.io.File(System.getProperty("java.io.tmpdir"), "hub-test-${System.nanoTime()}").apply { mkdirs() }
        // First export hangs forever
        coEvery { ccRunner.exportVault(any()) } coAnswers {
            kotlinx.coroutines.delay(1_000_000)
            LocalCcRunner.ExportResult.Ok("", 0L, encrypted = true)
        }
        val fakeUri = io.mockk.mockk<android.net.Uri>(relaxed = true)
        val vm = newVm()
        advanceUntilIdle()
        vm.requestExportVaultToUri(fakeUri)
        assertTrue(vm.state.value.threeLocks.exporting)
        // Second call must early-return — state unchanged
        vm.requestExportVaultToUri(fakeUri)
        assertTrue(vm.state.value.threeLocks.exporting)
        assertNull(vm.state.value.threeLocks.exportError)
    }

    // ─── Phase 13.5 v0.2 — QQ HubLocal UI wire ─────────────────────────────

    @Test
    fun `qq init renders not-logged-in card when store empty`() = runTest(testDispatcher) {
        val vm = newVm()
        advanceUntilIdle()
        val s = vm.state.value.qq
        assertFalse(s.isLoggedIn)
        assertNull(s.uin)
        assertNull(s.lastSyncAt)
        assertFalse(s.pendingUinEntry)
    }

    @Test
    fun `qq init reads stored uin + lastSync on app start`() = runTest(testDispatcher) {
        every { qqCredentials.hasCredentials() } returns true
        every { qqCredentials.getUin() } returns "10086"
        every { qqCredentials.getLastSyncAt() } returns 1_700_000_000_000L
        every { qqCredentials.getLastSyncCount() } returns 42
        val vm = newVm()
        advanceUntilIdle()
        val s = vm.state.value.qq
        assertTrue(s.isLoggedIn)
        assertEquals("10086", s.uin)
        assertEquals(1_700_000_000_000L, s.lastSyncAt)
        assertEquals(42, s.lastSyncCount)
    }

    @Test
    fun `requestQQLogin opens the uin+imei dialog`() = runTest(testDispatcher) {
        val vm = newVm()
        advanceUntilIdle()
        assertFalse(vm.state.value.qq.pendingUinEntry)
        vm.requestQQLogin()
        assertTrue(vm.state.value.qq.pendingUinEntry)
        assertNull(vm.state.value.qq.errorMessage)
    }

    @Test
    fun `confirmQQUinImei rejects non-digit uin`() = runTest(testDispatcher) {
        val vm = newVm()
        advanceUntilIdle()
        vm.requestQQLogin()
        vm.confirmQQUinImei("abc123", "123456789012345")
        val s = vm.state.value.qq
        assertTrue(s.pendingUinEntry, "dialog must stay open on validation fail")
        assertEquals("UIN 必须是纯数字", s.errorMessage)
        io.mockk.verify(exactly = 0) { qqCredentials.saveAccount(any(), any(), any()) }
    }

    @Test
    fun `confirmQQUinImei rejects imei that is not 15 digits`() = runTest(testDispatcher) {
        val vm = newVm()
        advanceUntilIdle()
        vm.requestQQLogin()
        vm.confirmQQUinImei("10086", "12345")
        val s = vm.state.value.qq
        assertTrue(s.pendingUinEntry)
        assertTrue(s.errorMessage!!.contains("15 位"))
        io.mockk.verify(exactly = 0) { qqCredentials.saveAccount(any(), any(), any()) }
    }

    @Test
    fun `confirmQQUinImei persists + closes dialog + refreshes state on success`() =
        runTest(testDispatcher) {
            every { qqCredentials.hasCredentials() } returnsMany listOf(false, true)
            every { qqCredentials.getUin() } returnsMany listOf(null, "10086")
            every { qqCredentials.saveAccount(any(), any(), any()) } just runs
            val vm = newVm()
            advanceUntilIdle()
            vm.requestQQLogin()
            vm.confirmQQUinImei("10086", "123456789012345")
            advanceUntilIdle()
            val s = vm.state.value.qq
            assertFalse(s.pendingUinEntry)
            assertTrue(s.isLoggedIn)
            assertEquals("10086", s.uin)
            assertNull(s.errorMessage)
            io.mockk.verify { qqCredentials.saveAccount("10086", "123456789012345", null) }
        }

    @Test
    fun `syncQQ when not logged in opens login dialog instead of running`() =
        runTest(testDispatcher) {
            val vm = newVm()
            advanceUntilIdle()
            vm.syncQQ()
            advanceUntilIdle()
            assertTrue(vm.state.value.qq.pendingUinEntry)
            coEvery { qqCollector.snapshot() } returns QQLocalCollector.SnapshotResult.NoCredentials
            // collector.snapshot must NOT be invoked when not logged in
            io.mockk.coVerify(exactly = 0) { qqCollector.snapshot() }
        }

    @Test
    fun `syncQQ NoRoot surfaces 改用桌面端 hint`() = runTest(testDispatcher) {
        every { qqCredentials.hasCredentials() } returns true
        every { qqCredentials.getUin() } returns "10086"
        coEvery { qqCollector.snapshot() } returns QQLocalCollector.SnapshotResult.NoRoot
        val vm = newVm()
        advanceUntilIdle()
        vm.syncQQ()
        advanceUntilIdle()
        val s = vm.state.value.qq
        assertFalse(s.isSyncing)
        assertTrue(s.errorMessage!!.contains("未 root"))
        assertTrue(s.errorMessage!!.contains("桌面端"))
        assertNull(vm.state.value.globalSyncingAdapter)
    }

    @Test
    fun `syncQQ Ok then cc Ok records lastSyncAt + count`() = runTest(testDispatcher) {
        every { qqCredentials.hasCredentials() } returns true
        every { qqCredentials.getUin() } returns "10086"
        coEvery { qqCollector.snapshot() } returns QQLocalCollector.SnapshotResult.Ok(
            snapshotPath = "/tmp/staging.json",
            contactCount = 10,
            groupCount = 2,
            messageCount = 88,
            totalEvents = 100,
            snapshottedAt = 1_700_000_000_000L,
        )
        coEvery { ccRunner.syncAdapter(adapterName = "messaging-qq", inputPath = any()) } returns
            LocalCcRunner.CcResult.Ok(
                report = LocalCcRunner.SyncReport(
                    adapter = "messaging-qq", status = "ok",
                    ingested = 100, invalidCount = 0,
                    kgTriples = 0, ragDocs = 0,
                    durationMs = 1500L, error = null,
                ),
                rawJson = "{}",
            )
        val vm = newVm()
        advanceUntilIdle()
        vm.syncQQ()
        advanceUntilIdle()
        val s = vm.state.value.qq
        assertFalse(s.isSyncing)
        assertEquals(1_700_000_000_000L, s.lastSyncAt)
        assertEquals(100, s.lastSyncCount)
        assertNull(s.errorMessage)
        assertNull(vm.state.value.globalSyncingAdapter)
    }

    @Test
    fun `logoutQQ clears store + resets card state`() = runTest(testDispatcher) {
        every { qqCredentials.hasCredentials() } returns true
        every { qqCredentials.getUin() } returns "10086"
        every { qqCredentials.clear() } just runs
        val vm = newVm()
        advanceUntilIdle()
        assertTrue(vm.state.value.qq.isLoggedIn)
        vm.logoutQQ()
        val s = vm.state.value.qq
        assertFalse(s.isLoggedIn)
        assertNull(s.uin)
        assertNull(s.lastSyncAt)
        io.mockk.verify { qqCredentials.clear() }
    }

    @Test
    fun `cancelQQLogin closes dialog without persisting`() = runTest(testDispatcher) {
        val vm = newVm()
        advanceUntilIdle()
        vm.requestQQLogin()
        assertTrue(vm.state.value.qq.pendingUinEntry)
        vm.cancelQQLogin()
        assertFalse(vm.state.value.qq.pendingUinEntry)
        io.mockk.verify(exactly = 0) { qqCredentials.saveAccount(any(), any(), any()) }
    }

    // ─── Toutiao v0.1 placeholder card ─────────────────────────────────────

    @Test
    fun `toutiao init renders 今日头条 card not logged in`() = runTest(testDispatcher) {
        val vm = newVm()
        advanceUntilIdle()
        val s = vm.state.value.toutiao
        assertEquals("social-toutiao", s.adapterName)
        assertEquals("今日头条", s.displayName)
        assertTrue(s.implemented)
        assertFalse(s.isLoggedIn)
        assertNull(s.uid)
    }

    @Test
    fun `toutiao init reads stored uid + lastSync from store`() = runTest(testDispatcher) {
        every { toutiaoCredentials.hasCredentials() } returns true
        every { toutiaoCredentials.getUid() } returns "12345678"
        every { toutiaoCredentials.getLastSyncAt() } returns 1_700_000_000_000L
        every { toutiaoCredentials.getLastSyncCount() } returns 0
        val vm = newVm()
        advanceUntilIdle()
        val s = vm.state.value.toutiao
        assertTrue(s.isLoggedIn)
        assertEquals(12_345_678L, s.uid)
        assertEquals(1_700_000_000_000L, s.lastSyncAt)
    }

    @Test
    fun `requestToutiaoLogin pushes pendingLogin with toutiao_com URL`() = runTest(testDispatcher) {
        val vm = newVm()
        advanceUntilIdle()
        vm.requestToutiaoLogin()
        val p = vm.state.value.pendingLogin
        assertNotNull(p)
        assertEquals("social-toutiao", p.adapterName)
        assertEquals("今日头条", p.displayName)
        assertTrue(p.loginUrl.contains("toutiao.com"))
        // isLoginSuccess: 已到 www.toutiao.com 视为成功；sso/passport/login 中间页 false
        assertTrue(p.isLoginSuccess("https://www.toutiao.com/"))
        assertFalse(p.isLoginSuccess("https://sso.toutiao.com/login"))
        assertFalse(p.isLoginSuccess("https://passport.toutiao.com/auth"))
    }

    @Test
    fun `onToutiaoLoginCookie success persists + refreshes`() = runTest(testDispatcher) {
        coEvery { toutiaoCollector.acceptLoginCookie(any(), any()) } returns true
        every { toutiaoCredentials.hasCredentials() } returnsMany listOf(false, true)
        every { toutiaoCredentials.getUid() } returnsMany listOf(null, "99999")
        val vm = newVm()
        advanceUntilIdle()
        vm.requestToutiaoLogin()
        vm.onToutiaoLoginCookie("passport_uid=99999; tt_webid=abc")
        advanceUntilIdle()
        val s = vm.state.value.toutiao
        assertTrue(s.isLoggedIn)
        assertEquals(99_999L, s.uid)
        assertNull(s.errorMessage)
        assertNull(vm.state.value.pendingLogin)
    }

    @Test
    fun `onToutiaoLoginCookie acceptance failure surfaces login incomplete error`() =
        runTest(testDispatcher) {
            coEvery { toutiaoCollector.acceptLoginCookie(any(), any()) } returns false
            every { toutiaoCollector.lastLoginErrorCode } returns -7
            every { toutiaoCollector.lastLoginErrorMessage } returns "cookie 缺 passport_uid"
            val vm = newVm()
            advanceUntilIdle()
            vm.requestToutiaoLogin()
            vm.onToutiaoLoginCookie("tt_webid=anon-only")
            advanceUntilIdle()
            val s = vm.state.value.toutiao
            assertFalse(s.isLoggedIn)
            assertTrue(s.errorMessage!!.contains("登录未完成"))
            assertTrue(s.errorMessage!!.contains("passport_uid"))
        }

    @Test
    fun `syncToutiao when not logged in opens login instead of running`() = runTest(testDispatcher) {
        val vm = newVm()
        advanceUntilIdle()
        vm.syncToutiao()
        advanceUntilIdle()
        // Not logged in → requestToutiaoLogin runs → pendingLogin set
        assertNotNull(vm.state.value.pendingLogin)
        coVerify(exactly = 0) { toutiaoCollector.snapshot() }
    }

    @Test
    fun `syncToutiao v0_2 Ok path records lastSync + honest v0_3 hint`() =
        runTest(testDispatcher) {
            every { toutiaoCredentials.hasCredentials() } returns true
            every { toutiaoCredentials.getUid() } returns "12345"
            coEvery { toutiaoCollector.snapshot() } returns
                ToutiaoLocalCollector.SnapshotResult.Ok(
                    snapshotPath = "/tmp/social-toutiao.json",
                    profileCount = 1,
                    readCount = 0,
                    collectionCount = 0,
                    searchCount = 0,
                    totalEvents = 1,
                    everythingEmpty = false,
                    snapshottedAt = 1_700_000_000_000L,
                )
            coEvery { ccRunner.syncAdapter(adapterName = "social-toutiao", inputPath = any()) } returns
                LocalCcRunner.CcResult.Ok(
                    report = LocalCcRunner.SyncReport(
                        adapter = "social-toutiao", status = "ok",
                        ingested = 0, invalidCount = 0,
                        kgTriples = 0, ragDocs = 0,
                        durationMs = 100L, error = null,
                    ),
                    rawJson = "{}",
                )
            val vm = newVm()
            advanceUntilIdle()
            vm.syncToutiao()
            advanceUntilIdle()
            val s = vm.state.value.toutiao
            assertFalse(s.isSyncing)
            assertEquals(1_700_000_000_000L, s.lastSyncAt)
            assertEquals(0, s.lastSyncCount)
            // v0.2 honest banner ON — 透出 _signature v0.3 限制
            assertTrue(s.errorMessage!!.contains("v0.2"))
            assertTrue(s.errorMessage!!.contains("v0.3"))
            assertTrue(s.errorMessage!!.contains("_signature"))
            assertNull(vm.state.value.globalSyncingAdapter)
        }

    @Test
    fun `syncToutiao Failed surfaces reason`() = runTest(testDispatcher) {
        every { toutiaoCredentials.hasCredentials() } returns true
        every { toutiaoCredentials.getUid() } returns "12345"
        coEvery { toutiaoCollector.snapshot() } returns
            ToutiaoLocalCollector.SnapshotResult.Failed("write failed: disk full")
        val vm = newVm()
        advanceUntilIdle()
        vm.syncToutiao()
        advanceUntilIdle()
        val s = vm.state.value.toutiao
        assertFalse(s.isSyncing)
        assertTrue(s.errorMessage!!.contains("disk full"))
    }

    @Test
    fun `logoutToutiao clears collector + resets card`() = runTest(testDispatcher) {
        every { toutiaoCredentials.hasCredentials() } returns true
        every { toutiaoCredentials.getUid() } returns "12345"
        val vm = newVm()
        advanceUntilIdle()
        assertTrue(vm.state.value.toutiao.isLoggedIn)
        vm.logoutToutiao()
        val s = vm.state.value.toutiao
        assertFalse(s.isLoggedIn)
        assertNull(s.uid)
        assertNull(s.lastSyncAt)
        io.mockk.verify { toutiaoCollector.logout() }
    }

    // ─── Kuaishou v0.1 placeholder card ────────────────────────────────────

    @Test
    fun `kuaishou init renders 快手 card not logged in`() = runTest(testDispatcher) {
        val vm = newVm()
        advanceUntilIdle()
        val s = vm.state.value.kuaishou
        assertEquals("social-kuaishou", s.adapterName)
        assertEquals("快手", s.displayName)
        assertTrue(s.implemented)
        assertFalse(s.isLoggedIn)
        assertNull(s.uid)
    }

    @Test
    fun `kuaishou init reads stored uid + lastSync from store`() = runTest(testDispatcher) {
        every { kuaishouCredentials.hasCredentials() } returns true
        every { kuaishouCredentials.getUid() } returns "98765432"
        every { kuaishouCredentials.getLastSyncAt() } returns 1_700_000_000_000L
        every { kuaishouCredentials.getLastSyncCount() } returns 0
        val vm = newVm()
        advanceUntilIdle()
        val s = vm.state.value.kuaishou
        assertTrue(s.isLoggedIn)
        assertEquals(98_765_432L, s.uid)
        assertEquals(1_700_000_000_000L, s.lastSyncAt)
    }

    @Test
    fun `requestKuaishouLogin pushes pendingLogin with kuaishou_com URL`() = runTest(testDispatcher) {
        val vm = newVm()
        advanceUntilIdle()
        vm.requestKuaishouLogin()
        val p = vm.state.value.pendingLogin
        assertNotNull(p)
        assertEquals("social-kuaishou", p.adapterName)
        assertEquals("快手", p.displayName)
        assertTrue(p.loginUrl.contains("kuaishou.com"))
        // isLoginSuccess: 已到 www.kuaishou.com 视为成功；passport/login 中间页 false
        assertTrue(p.isLoginSuccess("https://www.kuaishou.com/"))
        assertFalse(p.isLoginSuccess("https://passport.kuaishou.com/auth"))
        assertFalse(p.isLoginSuccess("https://www.kuaishou.com/login"))
    }

    @Test
    fun `onKuaishouLoginCookie success persists + refreshes`() = runTest(testDispatcher) {
        coEvery { kuaishouCollector.acceptLoginCookie(any(), any()) } returns true
        every { kuaishouCredentials.hasCredentials() } returnsMany listOf(false, true)
        every { kuaishouCredentials.getUid() } returnsMany listOf(null, "77777")
        val vm = newVm()
        advanceUntilIdle()
        vm.requestKuaishouLogin()
        vm.onKuaishouLoginCookie("userId=77777; did=abc")
        advanceUntilIdle()
        val s = vm.state.value.kuaishou
        assertTrue(s.isLoggedIn)
        assertEquals(77_777L, s.uid)
        assertNull(s.errorMessage)
        assertNull(vm.state.value.pendingLogin)
    }

    @Test
    fun `onKuaishouLoginCookie acceptance failure surfaces login incomplete error`() =
        runTest(testDispatcher) {
            coEvery { kuaishouCollector.acceptLoginCookie(any(), any()) } returns false
            every { kuaishouCollector.lastLoginErrorCode } returns -7
            every { kuaishouCollector.lastLoginErrorMessage } returns "cookie 缺 userId"
            val vm = newVm()
            advanceUntilIdle()
            vm.requestKuaishouLogin()
            vm.onKuaishouLoginCookie("did=anon-only; kpf=PC_WEB")
            advanceUntilIdle()
            val s = vm.state.value.kuaishou
            assertFalse(s.isLoggedIn)
            assertTrue(s.errorMessage!!.contains("登录未完成"))
            assertTrue(s.errorMessage!!.contains("userId"))
        }

    @Test
    fun `syncKuaishou when not logged in opens login instead of running`() =
        runTest(testDispatcher) {
            val vm = newVm()
            advanceUntilIdle()
            vm.syncKuaishou()
            advanceUntilIdle()
            assertNotNull(vm.state.value.pendingLogin)
            coVerify(exactly = 0) { kuaishouCollector.snapshot() }
        }

    @Test
    fun `syncKuaishou v0_2 Ok path records lastSync + honest v0_3 hint`() =
        runTest(testDispatcher) {
            every { kuaishouCredentials.hasCredentials() } returns true
            every { kuaishouCredentials.getUid() } returns "98765"
            coEvery { kuaishouCollector.snapshot() } returns
                KuaishouLocalCollector.SnapshotResult.Ok(
                    snapshotPath = "/tmp/social-kuaishou.json",
                    profileCount = 1,
                    totalEvents = 1,
                    everythingEmpty = false,
                    snapshottedAt = 1_700_000_000_000L,
                )
            coEvery { ccRunner.syncAdapter(adapterName = "social-kuaishou", inputPath = any()) } returns
                LocalCcRunner.CcResult.Ok(
                    report = LocalCcRunner.SyncReport(
                        adapter = "social-kuaishou", status = "ok",
                        ingested = 0, invalidCount = 0,
                        kgTriples = 0, ragDocs = 0,
                        durationMs = 100L, error = null,
                    ),
                    rawJson = "{}",
                )
            val vm = newVm()
            advanceUntilIdle()
            vm.syncKuaishou()
            advanceUntilIdle()
            val s = vm.state.value.kuaishou
            assertFalse(s.isSyncing)
            assertEquals(1_700_000_000_000L, s.lastSyncAt)
            assertEquals(0, s.lastSyncCount)
            // v0.2 honest banner — 透出 NS_sig3 v0.3 限制
            assertTrue(s.errorMessage!!.contains("v0.2"))
            assertTrue(s.errorMessage!!.contains("v0.3"))
            assertTrue(s.errorMessage!!.contains("NS_sig3"))
            assertNull(vm.state.value.globalSyncingAdapter)
        }

    @Test
    fun `syncKuaishou Failed surfaces reason`() = runTest(testDispatcher) {
        every { kuaishouCredentials.hasCredentials() } returns true
        every { kuaishouCredentials.getUid() } returns "98765"
        coEvery { kuaishouCollector.snapshot() } returns
            KuaishouLocalCollector.SnapshotResult.Failed("write failed: disk full")
        val vm = newVm()
        advanceUntilIdle()
        vm.syncKuaishou()
        advanceUntilIdle()
        val s = vm.state.value.kuaishou
        assertFalse(s.isSyncing)
        assertTrue(s.errorMessage!!.contains("disk full"))
    }

    @Test
    fun `logoutKuaishou clears collector + resets card`() = runTest(testDispatcher) {
        every { kuaishouCredentials.hasCredentials() } returns true
        every { kuaishouCredentials.getUid() } returns "98765"
        val vm = newVm()
        advanceUntilIdle()
        assertTrue(vm.state.value.kuaishou.isLoggedIn)
        vm.logoutKuaishou()
        val s = vm.state.value.kuaishou
        assertFalse(s.isLoggedIn)
        assertNull(s.uid)
        assertNull(s.lastSyncAt)
        io.mockk.verify { kuaishouCollector.logout() }
    }

    // ─── 2026-05-24 Ask route dispatch ───────────────────────────────────────

    @Test
    fun `default route LOCAL_DEVICE dispatches to ccRunner with llmServer baseUrl`() =
        runTest(testDispatcher) {
            every { llmEngine.nativeReady } returns true
            coEvery {
                ccRunner.askQuestion(
                    question = any(),
                    ollamaUrl = "http://127.0.0.1:18484",
                    acceptNonLocal = any(),
                    maxFacts = any(),
                    maxQueryLimit = any(),
                )
            } returns LocalCcRunner.AskResult.Ok(
                LocalCcRunner.AskReport(
                    answer = "本机答",
                    citations = emptyList(),
                    llmName = "qwen2.5",
                    isLocal = true,
                    durationMs = 200L,
                ),
                rawJson = "{}",
            )
            val vm = newVm()
            advanceUntilIdle()
            vm.onAskQuestionChanged("本机数据 Q")
            vm.askQuestion()
            advanceUntilIdle()

            val s = vm.state.value.ask
            assertEquals("本机答", s.answer)
            assertEquals("qwen2.5", s.llmName)
            coVerify(exactly = 1) {
                ccRunner.askQuestion(
                    question = "本机数据 Q",
                    ollamaUrl = "http://127.0.0.1:18484",
                    acceptNonLocal = any(),
                    maxFacts = any(),
                    maxQueryLimit = any(),
                )
            }
        }

    @Test
    fun `LAN_OLLAMA route routes ccRunner to user-supplied URL`() = runTest(testDispatcher) {
        every { llmPreferences.getLanLlmBaseUrl() } returns "http://192.168.1.7:11434"
        lanUrlFlow.value = "http://192.168.1.7:11434"
        coEvery {
            ccRunner.askQuestion(
                question = any(),
                ollamaUrl = "http://192.168.1.7:11434",
                acceptNonLocal = true,
                maxFacts = any(),
                maxQueryLimit = any(),
            )
        } returns LocalCcRunner.AskResult.Ok(
            LocalCcRunner.AskReport(
                answer = "LAN 答",
                citations = emptyList(),
                llmName = "llama3",
                isLocal = false,
                durationMs = 150L,
            ),
            rawJson = "{}",
        )
        val vm = newVm()
        advanceUntilIdle()
        assertTrue(vm.state.value.ask.lanAvailable)

        vm.setAskRoute(LlmRoute.LAN_OLLAMA)
        vm.onAskQuestionChanged("局域网 Q")
        vm.askQuestion()
        advanceUntilIdle()

        val s = vm.state.value.ask
        assertEquals("LAN 答", s.answer)
        // llmName 是 cc 报回的原始名（路由由 selectedRoute 表达，不污染 llmName）
        assertEquals("llama3", s.llmName)
        assertFalse(s.isLocal)
    }

    @Test
    fun `setAskRoute persists selection in state`() = runTest(testDispatcher) {
        every { llmEngine.nativeReady } returns true
        val vm = newVm()
        advanceUntilIdle()
        assertEquals(LlmRoute.LOCAL_DEVICE, vm.state.value.ask.selectedRoute)
        vm.setAskRoute(LlmRoute.CLOUD_ANDROID)
        assertEquals(LlmRoute.CLOUD_ANDROID, vm.state.value.ask.selectedRoute)
    }
}
