package com.chainlesschain.android.remote.ui.personalDataHub

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import android.content.Context
import com.chainlesschain.android.pdh.LocalCcRunner
import com.chainlesschain.android.pdh.LocalSystemDataSnapshotter
import com.chainlesschain.android.pdh.llm.LocalLlmServer
import com.chainlesschain.android.pdh.social.bilibili.BilibiliCredentialsStore
import com.chainlesschain.android.pdh.social.bilibili.BilibiliLocalCollector
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

/**
 * Plan A v0.1 + A8 — driver for the "本机数据" tab inside PersonalDataHubScreen.
 *
 * Originally a single-CTA driver around [LocalSystemDataSnapshotter] +
 * [LocalCcRunner]. A8 v0.1 (2026-05-22) extends it to a multi-adapter card
 * list so users see Bilibili / 微博 / 抖音 / 小红书 cards alongside the
 * existing 本机数据 (contacts+apps) card. Each social card:
 *
 *  - "登录" — opens an in-app WebView (SocialCookieWebViewScreen) for the
 *            user to authenticate with the platform directly
 *  - "同步" — runs the collector → snapshot.json → in-APK cc → local SQLCipher
 *            vault. No desktop connection required.
 *  - "退出" — clears stored credentials so the user can re-login (or stop
 *            syncing entirely)
 *
 * Why not separate VMs per card? Adapter cards share the LocalCcRunner +
 * are gated against running in parallel (LocalCcRunner spawns a Termux-style
 * subprocess and serializes vault access). A single VM also lets the UI
 * surface a global "syncingCard" lock without per-VM coordination.
 */
@HiltViewModel
class HubLocalViewModel @Inject constructor(
    private val snapshotter: LocalSystemDataSnapshotter,
    private val ccRunner: LocalCcRunner,
    private val bilibiliCollector: BilibiliLocalCollector,
    private val bilibiliCredentials: BilibiliCredentialsStore,
    private val llmServer: LocalLlmServer,
    @ApplicationContext private val appContext: Context,
) : ViewModel() {

    @Immutable
    data class SystemDataCardState(
        val isLoading: Boolean = false,
        val phase: String? = null,
        val lastSnapshotAt: Long? = null,
        val contactsCount: Int = 0,
        val appsCount: Int = 0,
        val ingested: Int = 0,
        val contactsPermissionGranted: Boolean = false,
        val errorMessage: String? = null,
    )

    @Immutable
    data class SocialCardState(
        /** matches the JS adapter name (e.g. "social-bilibili"). */
        val adapterName: String,
        val displayName: String,
        val implemented: Boolean,
        val isLoggedIn: Boolean = false,
        val uid: Long? = null,
        val isSyncing: Boolean = false,
        val lastSyncAt: Long? = null,
        val lastSyncCount: Int = 0,
        val errorMessage: String? = null,
    )

    @Immutable
    data class LoginRequest(
        val adapterName: String,
        val displayName: String,
        val loginUrl: String,
        val cookieDomain: String,
        /** URL-pattern detector run by the WebView screen — true ⇒ extract cookie + return. */
        val isLoginSuccess: (String) -> Boolean,
    )

    /**
     * 三道锁 state — 推文 §"三道锁，缺一不可" 的三把硬约束在 UI 上的呈现。
     *  - vaultEncrypted: 加密金库（永远 true — SQLCipher AES-256，不可关）
     *  - allowCloudFallback: 拒云开关（默认 false = 默认拒云端 AI 兜底）
     *  - destroying: 一键销毁 in-flight
     *  - destroyError: 销毁报错（极少出现，文件系统错）
     *  - lastDestroyedAt: 上次销毁成功时间（用户重新采集后重置）
     *  - exporting: 一键导出 in-flight
     *  - exportError: 导出报错
     *  - lastExportPath: 上次成功导出的文件绝对路径（user-accessible external-files-dir）
     *  - lastExportBytes: 上次导出文件大小（含 WAL/SHM sidecars）
     */
    @Immutable
    data class ThreeLocksState(
        val vaultEncrypted: Boolean = true,
        val allowCloudFallback: Boolean = false,
        val destroying: Boolean = false,
        val destroyError: String? = null,
        val lastDestroyedAt: Long? = null,
        val exporting: Boolean = false,
        val exportError: String? = null,
        val lastExportPath: String? = null,
        val lastExportBytes: Long = 0L,
    )

    /**
     * A3 — "提问" card state. Drives the local LLM ask flow via
     * [LocalCcRunner.askQuestion] which spawns `cc hub ask --json` against
     * the Kotlin-hosted Ollama-compat LLM server (A3.2 — pending wire).
     */
    @Immutable
    data class AskCardState(
        val question: String = "",
        val isAsking: Boolean = false,
        val answer: String? = null,
        val citations: List<LocalCcRunner.AskReport.Citation> = emptyList(),
        val llmName: String? = null,
        val isLocal: Boolean = true,
        val durationMs: Long = 0L,
        val errorMessage: String? = null,
    )

    @Immutable
    data class UiState(
        val systemData: SystemDataCardState = SystemDataCardState(),
        val bilibili: SocialCardState = SocialCardState(
            adapterName = "social-bilibili",
            displayName = "Bilibili",
            implemented = true,
        ),
        val weibo: SocialCardState = SocialCardState(
            adapterName = "social-weibo",
            displayName = "微博",
            implemented = false,
        ),
        val douyin: SocialCardState = SocialCardState(
            adapterName = "social-douyin",
            displayName = "抖音",
            implemented = false,
        ),
        val xiaohongshu: SocialCardState = SocialCardState(
            adapterName = "social-xiaohongshu",
            displayName = "小红书",
            implemented = false,
        ),
        val pendingLogin: LoginRequest? = null,
        val globalSyncingAdapter: String? = null,
        val ask: AskCardState = AskCardState(),
        val threeLocks: ThreeLocksState = ThreeLocksState(),
    )

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    init {
        refreshPermissionState()
        refreshBilibiliFromStore()
    }

    // ─── System data (contacts + apps) ──────────────────────────────────────

    fun refreshPermissionState() {
        _state.update {
            it.copy(
                systemData = it.systemData.copy(
                    contactsPermissionGranted = snapshotter.hasContactsPermission(),
                ),
            )
        }
    }

    fun refreshSystemData() {
        if (_state.value.globalSyncingAdapter != null) return
        viewModelScope.launch {
            _state.update {
                it.copy(
                    globalSyncingAdapter = "system-data-android",
                    systemData = it.systemData.copy(
                        isLoading = true,
                        phase = "正在读取通讯录与已装应用…",
                        errorMessage = null,
                    ),
                )
            }
            val snapshot = try {
                snapshotter.snapshotAll()
            } catch (e: Exception) {
                Timber.w(e, "HubLocalViewModel: snapshot failed")
                _state.update {
                    it.copy(
                        globalSyncingAdapter = null,
                        systemData = it.systemData.copy(
                            isLoading = false,
                            phase = null,
                            errorMessage = "快照失败: ${e.message ?: e.javaClass.simpleName}",
                        ),
                    )
                }
                return@launch
            }
            _state.update {
                it.copy(
                    systemData = it.systemData.copy(
                        phase = "正在写入本地数据库…",
                        contactsCount = snapshot.contactsCount,
                        appsCount = snapshot.appsCount,
                        lastSnapshotAt = snapshot.snapshottedAt,
                        contactsPermissionGranted = snapshot.contactsPermissionGranted,
                    ),
                )
            }
            when (val r = ccRunner.syncAdapter(
                adapterName = "system-data-android",
                inputPath = snapshot.snapshotPath,
            )) {
                is LocalCcRunner.CcResult.Ok -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            systemData = it.systemData.copy(
                                isLoading = false,
                                phase = null,
                                ingested = r.report.ingested,
                                errorMessage = if (r.report.status != "ok" && r.report.error != null) {
                                    "同步状态: ${r.report.status} (${r.report.error})"
                                } else null,
                            ),
                        )
                    }
                }
                is LocalCcRunner.CcResult.Failed -> {
                    Timber.w(
                        "HubLocalViewModel: cc syncAdapter failed: %s (exit=%s)",
                        r.reason, r.exitCode,
                    )
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            systemData = it.systemData.copy(
                                isLoading = false,
                                phase = null,
                                errorMessage = "写入本地数据库失败: ${r.reason}",
                            ),
                        )
                    }
                }
            }
        }
    }

    // ─── Ask (A3 — on-device LLM) ───────────────────────────────────────────
    //
    // Wraps LocalCcRunner.askQuestion (cc hub ask --json) which drives the
    // existing AnalysisEngine.ask() — same RAG + citations contract as the
    // desktop. In v0.1 the Kotlin-hosted LLM server (A3.2) is not yet wired,
    // so cc will fail with "OllamaClient.chat: request failed" — surfaced
    // to the UI as "端侧 LLM 未启动 (A3.2)". Wire happens in a follow-up.

    fun onAskQuestionChanged(text: String) {
        _state.update { it.copy(ask = it.ask.copy(question = text, errorMessage = null)) }
    }

    fun askQuestion() {
        val q = _state.value.ask.question.trim()
        if (q.isEmpty() || _state.value.ask.isAsking) return
        _state.update {
            it.copy(
                ask = it.ask.copy(
                    isAsking = true,
                    answer = null,
                    citations = emptyList(),
                    errorMessage = null,
                ),
            )
        }
        viewModelScope.launch {
            // A3.2 — LocalLlmServer baseUrl is "http://127.0.0.1:<port>" once
            // ChainlessChainApplication.delayedInit started it. If start failed
            // (rare port-exhaustion) baseUrl=null and we pass null → cc falls
            // back to localhost:11434 default, which then fails fast.
            val result = ccRunner.askQuestion(q, ollamaUrl = llmServer.baseUrl)
            _state.update { st ->
                when (result) {
                    is LocalCcRunner.AskResult.Ok -> st.copy(
                        ask = st.ask.copy(
                            isAsking = false,
                            answer = result.report.answer,
                            citations = result.report.citations,
                            llmName = result.report.llmName,
                            isLocal = result.report.isLocal,
                            durationMs = result.report.durationMs,
                        ),
                    )
                    is LocalCcRunner.AskResult.Failed -> {
                        Timber.w(
                            "HubLocalViewModel.askQuestion: cc failed reason=%s exit=%s",
                            result.reason, result.exitCode,
                        )
                        // Friendlier message for the common A3.2-not-wired case
                        val hint = if (
                            result.reason.contains("OllamaClient", ignoreCase = true) ||
                            result.reason.contains("ECONNREFUSED", ignoreCase = true) ||
                            result.reason.contains("fetch failed", ignoreCase = true)
                        ) {
                            "端侧 LLM 未启动 (A3.2 待落地) — 原始错误: ${result.reason}"
                        } else {
                            result.reason
                        }
                        st.copy(ask = st.ask.copy(isAsking = false, errorMessage = hint))
                    }
                }
            }
        }
    }

    fun clearAskAnswer() {
        _state.update { it.copy(ask = it.ask.copy(answer = null, citations = emptyList(), errorMessage = null)) }
    }

    // ─── 三道锁 (推文 §三道锁，缺一不可) ──────────────────────────────────
    //
    // 第一把：加密金库 — SQLCipher 永远开，无 toggle
    // 第二把：默认拒云 — toggle，OFF = 完全离线 / ON = 允许云端兜底
    // 第三把：一键销毁 — cc hub destroy --confirm

    fun setAllowCloudFallback(allow: Boolean) {
        // v0.1: 状态只存内存，重启重置为 OFF（推文 §"默认不许问云端"安全侧
        // 默认）。v0.2 持久化到 DataStore 并在 OllamaClient 选择路径时遵守
        // 此 flag — 当前 cc 端尚无 CC_HUB_ALLOW_NON_LOCAL env 路径，A3.10
        // 真接通时一并加。
        _state.update { it.copy(threeLocks = it.threeLocks.copy(allowCloudFallback = allow)) }
    }

    fun requestDestroyVault() {
        if (_state.value.threeLocks.destroying) return
        if (_state.value.globalSyncingAdapter != null) return
        _state.update {
            it.copy(
                threeLocks = it.threeLocks.copy(destroying = true, destroyError = null),
                globalSyncingAdapter = "vault-destroy",
            )
        }
        viewModelScope.launch {
            val r = ccRunner.destroyVault()
            _state.update { st ->
                when (r) {
                    is LocalCcRunner.DestroyResult.Ok -> st.copy(
                        threeLocks = st.threeLocks.copy(
                            destroying = false,
                            destroyError = null,
                            lastDestroyedAt = System.currentTimeMillis(),
                        ),
                        // 重置 system-data 卡到 fresh 状态，提示用户重新同步
                        systemData = SystemDataCardState(
                            contactsPermissionGranted = snapshotter.hasContactsPermission(),
                        ),
                        globalSyncingAdapter = null,
                    )
                    is LocalCcRunner.DestroyResult.Failed -> {
                        Timber.w("HubLocalViewModel.destroy failed: %s", r.reason)
                        st.copy(
                            threeLocks = st.threeLocks.copy(
                                destroying = false,
                                destroyError = r.reason,
                            ),
                            globalSyncingAdapter = null,
                        )
                    }
                }
            }
        }
    }

    fun clearDestroyError() {
        _state.update { it.copy(threeLocks = it.threeLocks.copy(destroyError = null)) }
    }

    fun requestExportVault() {
        if (_state.value.threeLocks.exporting) return
        if (_state.value.globalSyncingAdapter != null) return
        _state.update {
            it.copy(
                threeLocks = it.threeLocks.copy(
                    exporting = true,
                    exportError = null,
                ),
                globalSyncingAdapter = "vault-export",
            )
        }
        viewModelScope.launch {
            // Write under app external-files-dir — user-accessible via File
            // Manager at /Android/data/<pkg>/files/exports/ without requiring
            // any runtime storage permission. SAF picker is v0.2 polish.
            val externalRoot = appContext.getExternalFilesDir(null)
            if (externalRoot == null) {
                _state.update { st ->
                    st.copy(
                        threeLocks = st.threeLocks.copy(
                            exporting = false,
                            exportError = "External storage unavailable. Mount SD/emulated storage and retry.",
                        ),
                        globalSyncingAdapter = null,
                    )
                }
                return@launch
            }
            val exportsDir = File(externalRoot, "exports").apply { mkdirs() }
            val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())
            val outFile = File(exportsDir, "chainlesschain-vault-$stamp.db")

            when (val r = ccRunner.exportVault(outFile.absolutePath)) {
                is LocalCcRunner.ExportResult.Ok -> {
                    Timber.i(
                        "HubLocalViewModel.export OK: path=%s bytes=%d",
                        r.outputPath, r.bytes,
                    )
                    _state.update { st ->
                        st.copy(
                            threeLocks = st.threeLocks.copy(
                                exporting = false,
                                exportError = null,
                                lastExportPath = r.outputPath,
                                lastExportBytes = r.bytes,
                            ),
                            globalSyncingAdapter = null,
                        )
                    }
                }
                is LocalCcRunner.ExportResult.Failed -> {
                    Timber.w("HubLocalViewModel.export failed: %s", r.reason)
                    _state.update { st ->
                        st.copy(
                            threeLocks = st.threeLocks.copy(
                                exporting = false,
                                exportError = r.reason,
                            ),
                            globalSyncingAdapter = null,
                        )
                    }
                }
            }
        }
    }

    fun clearExportError() {
        _state.update { it.copy(threeLocks = it.threeLocks.copy(exportError = null)) }
    }

    // ─── Bilibili ───────────────────────────────────────────────────────────

    fun refreshBilibiliFromStore() {
        val loggedIn = bilibiliCredentials.hasCredentials()
        val uid = bilibiliCredentials.getUid()
        val lastSync = bilibiliCredentials.getLastSyncAt()
        val lastCount = bilibiliCredentials.getLastSyncCount()
        _state.update {
            it.copy(
                bilibili = it.bilibili.copy(
                    isLoggedIn = loggedIn,
                    uid = uid,
                    lastSyncAt = lastSync,
                    lastSyncCount = lastCount,
                ),
            )
        }
    }

    fun requestBilibiliLogin() {
        _state.update {
            it.copy(
                pendingLogin = LoginRequest(
                    adapterName = "social-bilibili",
                    displayName = "Bilibili",
                    loginUrl = "https://passport.bilibili.com/login",
                    cookieDomain = "https://www.bilibili.com",
                    // Bilibili lands on https://www.bilibili.com/ (or m.bilibili.com)
                    // after passport redirect. Avoid matching while still on
                    // passport.bilibili.com — that's the login page itself.
                    isLoginSuccess = { url ->
                        (url.startsWith("https://www.bilibili.com/") ||
                            url.startsWith("https://m.bilibili.com/") ||
                            url == "https://www.bilibili.com" ||
                            url == "https://m.bilibili.com") &&
                            !url.contains("passport.bilibili.com")
                    },
                ),
            )
        }
    }

    fun onBilibiliLoginCookie(cookie: String) {
        val accepted = bilibiliCollector.acceptLoginCookie(cookie)
        _state.update {
            it.copy(
                pendingLogin = null,
                bilibili = it.bilibili.copy(
                    errorMessage = if (!accepted) "登录未完成 — 未找到 DedeUserID，请重试" else null,
                ),
            )
        }
        if (accepted) refreshBilibiliFromStore()
    }

    fun cancelLogin() {
        _state.update { it.copy(pendingLogin = null) }
    }

    fun syncBilibili() {
        if (_state.value.globalSyncingAdapter != null) return
        if (!_state.value.bilibili.isLoggedIn) {
            requestBilibiliLogin()
            return
        }
        viewModelScope.launch {
            _state.update {
                it.copy(
                    globalSyncingAdapter = "social-bilibili",
                    bilibili = it.bilibili.copy(isSyncing = true, errorMessage = null),
                )
            }
            val result = bilibiliCollector.snapshot()
            when (result) {
                is BilibiliLocalCollector.SnapshotResult.NoCredentials -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            bilibili = it.bilibili.copy(
                                isSyncing = false,
                                isLoggedIn = false,
                                errorMessage = "未登录 — 请先登录",
                            ),
                        )
                    }
                }
                is BilibiliLocalCollector.SnapshotResult.Failed -> {
                    _state.update {
                        it.copy(
                            globalSyncingAdapter = null,
                            bilibili = it.bilibili.copy(
                                isSyncing = false,
                                errorMessage = "采集失败: ${result.reason}",
                            ),
                        )
                    }
                }
                is BilibiliLocalCollector.SnapshotResult.Ok -> {
                    if (result.everythingEmpty) {
                        // Surface the actual Bilibili response code if any was
                        // captured during the 4 API calls (anti-spider -412 /
                        // not-logged-in -101 / IO error are very different
                        // fixes). Real-device 2026-05-22 hit -412 because
                        // BilibiliApiClient was missing User-Agent header.
                        val detail = when (result.lastErrorCode) {
                            0 -> "API 返回空 + 无错误码 — 可能 cookie 缺关键字段（bili_jct / buvid3）"
                            -101 -> "Bilibili 返回 -101（账号未登录）— 请重新登录"
                            -412, 412 -> "Bilibili 返回 -412（反爬触发）— 升级 User-Agent 或稍后重试"
                            -509 -> "Bilibili 返回 -509（限流）— 稍后再试"
                            else -> "Bilibili 返回 code=${result.lastErrorCode}" +
                                (result.lastErrorMessage?.let { " ($it)" } ?: "")
                        }
                        _state.update {
                            it.copy(
                                globalSyncingAdapter = null,
                                bilibili = it.bilibili.copy(
                                    isSyncing = false,
                                    errorMessage = "4 个 API 都返回空 — $detail",
                                ),
                            )
                        }
                        return@launch
                    }
                    when (val r = ccRunner.syncAdapter(
                        adapterName = "social-bilibili",
                        inputPath = result.snapshotPath,
                    )) {
                        is LocalCcRunner.CcResult.Ok -> {
                            _state.update {
                                it.copy(
                                    globalSyncingAdapter = null,
                                    bilibili = it.bilibili.copy(
                                        isSyncing = false,
                                        lastSyncAt = result.snapshottedAt,
                                        lastSyncCount = r.report.ingested,
                                        errorMessage = if (r.report.status != "ok" && r.report.error != null) {
                                            "入库状态: ${r.report.status} (${r.report.error})"
                                        } else null,
                                    ),
                                )
                            }
                        }
                        is LocalCcRunner.CcResult.Failed -> {
                            Timber.w(
                                "HubLocalViewModel: bilibili cc syncAdapter failed: %s",
                                r.reason,
                            )
                            _state.update {
                                it.copy(
                                    globalSyncingAdapter = null,
                                    bilibili = it.bilibili.copy(
                                        isSyncing = false,
                                        errorMessage = "写入本地数据库失败: ${r.reason}",
                                    ),
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    fun logoutBilibili() {
        bilibiliCollector.logout()
        _state.update {
            it.copy(
                bilibili = it.bilibili.copy(
                    isLoggedIn = false,
                    uid = null,
                    lastSyncAt = null,
                    lastSyncCount = 0,
                    errorMessage = null,
                ),
            )
        }
    }

    // ─── Weibo / Douyin / Xiaohongshu — stubs (Task #10) ────────────────────

    fun requestSocialLoginStub(platform: String) {
        val (adapter, name) = when (platform) {
            "weibo" -> "social-weibo" to "微博"
            "douyin" -> "social-douyin" to "抖音"
            "xiaohongshu" -> "social-xiaohongshu" to "小红书"
            else -> return
        }
        // v0.1 stub: surface "尚未实现" on the relevant card without launching
        // WebView; the cookie-auth flow framework is in place (see Bilibili)
        // but per-platform API wiring is a follow-up.
        _state.update {
            when (platform) {
                "weibo" -> it.copy(weibo = it.weibo.copy(errorMessage = "$name 同步 v0.2 开放，敬请期待"))
                "douyin" -> it.copy(douyin = it.douyin.copy(errorMessage = "$name 同步 v0.2 开放，敬请期待"))
                "xiaohongshu" -> it.copy(xiaohongshu = it.xiaohongshu.copy(errorMessage = "$name 同步 v0.2 开放，敬请期待"))
                else -> it
            }
        }
        Timber.i("HubLocalViewModel: %s login stub triggered (adapter=%s)", platform, adapter)
    }
}
