package com.chainlesschain.android.remote.commands

import com.chainlesschain.android.remote.client.RemoteCommandClient
import kotlinx.serialization.Serializable
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 个人数据中台 (Personal Data Hub) 命令 API — Phase 14.1
 *
 * 21 method typed wrapper，1:1 mirror 桌面 PDH IPC + WS 通道
 * ([`packages/personal-data-hub`](../../../../../../../../../packages/personal-data-hub)
 *  + [`desktop-app-vue/src/main/ipc/personal-data-hub-ipc.js`](../../../../../../../../../desktop-app-vue/src/main/ipc/personal-data-hub-ipc.js))。
 *
 * 设计文档：[`docs/design/Personal_Data_Hub_Phase_14_Mobile_Native_Entry.md`](../../../../../../../../../docs/design/Personal_Data_Hub_Phase_14_Mobile_Native_Entry.md)
 *
 * 21 method 分类（与 SeedRegistry.kt:386-555 一致）：
 *  - **Safe (15)**：ask / stats / health / listAdapters / queryEvents / recentAudit / eventDetail
 *    / testEmailAuth / listEmailAccounts / listAlipayAccounts （+ Mutating 中无需 approval 的 5 个：
 *    syncAdapter / syncAll / syncAdapterStream / importAlipayBill / syncAllStream + registerMock）
 *  - **Privileged (5)**：registerEmail / unregisterEmail / registerAlipay / unregisterAlipay / unregister
 *
 * v0.1 (Phase 14.1) UI 实际暴露 13 method；另 8 method (含 5 Privileged) typed wrapper 落地但
 * UI 不调用，留 v0.2 / 桌面端访问。详见设计文档 §4.3。
 *
 * 错误响应统一 envelope：桌面 handler 返回 `{ error: "..." }` 时，本类把它转换为 Result.failure
 * 抛 [HubApiException]，调用者用 `Result.fold` 或 `getOrElse` 处理。
 */
@Singleton
class PersonalDataHubCommands @Inject constructor(
    private val client: RemoteCommandClient
) {
    // ==================== 核心 Q&A / 健康 / 销毁 ====================

    /**
     * 自然语言提问中台数据。隐私 gate 默认拒非本地 LLM。
     *
     * @param question 用户问题文本
     * @param acceptNonLocal 是否同意在桌面 LLM 非本地时仍发送（默认 false → 拒绝）
     * @param useRag 是否做 BM25 RAG 召回扩展（默认 true）
     * @param topK RAG 召回条数（默认 10）
     */
    suspend fun ask(
        question: String,
        acceptNonLocal: Boolean? = null,
        useRag: Boolean? = null,
        topK: Int? = null
    ): Result<AskResult> {
        val options = mutableMapOf<String, Any>()
        acceptNonLocal?.let { options["acceptNonLocal"] = it }
        useRag?.let { options["useRag"] = it }
        topK?.let { options["topK"] = it }

        val params = mutableMapOf<String, Any>("question" to question)
        if (options.isNotEmpty()) params["options"] = options

        return client.invoke("personal-data-hub.ask", params)
    }

    /** Vault / Adapter / LLM provider 统计（只读）。 */
    suspend fun stats(): Result<HubStats> =
        client.invoke("personal-data-hub.stats", emptyMap())

    /** vault / LLM / KG / RAG 四件套健康检查（只读）。 */
    suspend fun health(): Result<HubHealth> =
        client.invoke("personal-data-hub.health", emptyMap())

    // ==================== Adapter 管理 ====================

    /** 枚举已注册 Adapter + 敏感度标签。 */
    suspend fun listAdapters(): Result<AdaptersResponse> =
        client.invoke("personal-data-hub.list-adapters", emptyMap())

    /**
     * 触发单 Adapter 同步（流水线 health→sync→vault→KG→RAG→audit）。
     *
     * @param name Adapter 名称（如 "email-imap" / "alipay-bill"）
     * @param options 同步选项（可选）：since / until / partitions 等
     */
    suspend fun syncAdapter(
        name: String,
        options: Map<String, Any>? = null
    ): Result<SyncReport> {
        val params = mutableMapOf<String, Any>("name" to name)
        options?.let { params["options"] = it }
        return client.invoke("personal-data-hub.sync-adapter", params)
    }

    /** 全部已注册 Adapter 并发同步。 */
    suspend fun syncAll(options: Map<String, Any>? = null): Result<SyncReportList> {
        val params = mutableMapOf<String, Any>()
        options?.let { params["options"] = it }
        return client.invoke("personal-data-hub.sync-all", params)
    }

    /**
     * 带进度推送的单 Adapter 同步（Phase 14.3）。返回 streamId 后通过
     * `HubSyncEventDispatcher` 订 `personal-data-hub.sync.progress` 事件流。
     */
    suspend fun syncAdapterStream(
        name: String,
        options: Map<String, Any>? = null
    ): Result<HubStreamStartResponse> {
        val params = mutableMapOf<String, Any>("name" to name)
        options?.let { params["options"] = it }
        return client.invoke("personal-data-hub.sync-adapter-stream", params)
    }

    /** 全 Adapter 同步带进度推送。 */
    suspend fun syncAllStream(options: Map<String, Any>? = null): Result<HubStreamStartResponse> {
        val params = mutableMapOf<String, Any>()
        options?.let { params["options"] = it }
        return client.invoke("personal-data-hub.sync-all-stream", params)
    }

    // ==================== 查询 / 审计（只读） ====================

    /** 按 subtype / 时间窗口 / actor / adapter 查 events（只读）。 */
    suspend fun queryEvents(
        subtype: String? = null,
        since: Long? = null,
        until: Long? = null,
        actor: String? = null,
        adapter: String? = null,
        limit: Int? = null
    ): Result<EventsResponse> {
        val filter = mutableMapOf<String, Any>()
        subtype?.let { filter["subtype"] = it }
        since?.let { filter["since"] = it }
        until?.let { filter["until"] = it }
        actor?.let { filter["actor"] = it }
        adapter?.let { filter["adapter"] = it }
        limit?.let { filter["limit"] = it }
        return client.invoke("personal-data-hub.query-events", filter)
    }

    /** 审计日志反查（最近 N 条，按 action / since 过滤）。 */
    suspend fun recentAudit(
        since: Long? = null,
        action: String? = null,
        limit: Int? = null
    ): Result<AuditRowsResponse> {
        val filter = mutableMapOf<String, Any>()
        since?.let { filter["since"] = it }
        action?.let { filter["action"] = it }
        limit?.let { filter["limit"] = it }
        return client.invoke("personal-data-hub.recent-audit", filter)
    }

    /** 按 eventId 取单事件详情（含 classification / extraction）。 */
    suspend fun eventDetail(eventId: String): Result<EventDetailResponse> =
        client.invoke("personal-data-hub.event-detail", mapOf("eventId" to eventId))

    // ==================== Email Adapter 管理（5 method） ====================

    /** 注册 IMAP 邮箱（持久化授权码）。**Privileged** — 桌面端二次 ApprovalUI。 */
    suspend fun registerEmail(
        account: EmailAccount,
        opts: Map<String, Any>? = null
    ): Result<AdapterRegisterResponse> {
        val accountMap = mutableMapOf<String, Any>(
            "provider" to account.provider,
            "email" to account.email,
            "authCode" to account.authCode
        )
        account.folders?.let { accountMap["folders"] = it }
        account.imapHost?.let { accountMap["imapHost"] = it }
        account.imapPort?.let { accountMap["imapPort"] = it }

        val params = mutableMapOf<String, Any>("account" to accountMap)
        opts?.let { params["opts"] = it }
        return client.invoke("personal-data-hub.register-email", params)
    }

    /** 注销邮箱配置（vault 数据保留）。**Privileged**。 */
    suspend fun unregisterEmail(email: String): Result<UnregisterResponse> =
        client.invoke("personal-data-hub.unregister-email", mapOf("email" to email))

    /** 测试 IMAP 授权码（不持久化）。 */
    suspend fun testEmailAuth(account: EmailAccount): Result<TestAuthResponse> {
        val accountMap = mutableMapOf<String, Any>(
            "provider" to account.provider,
            "email" to account.email,
            "authCode" to account.authCode
        )
        account.folders?.let { accountMap["folders"] = it }
        account.imapHost?.let { accountMap["imapHost"] = it }
        account.imapPort?.let { accountMap["imapPort"] = it }
        return client.invoke("personal-data-hub.test-email-auth", mapOf("account" to accountMap))
    }

    /** 枚举已注册邮箱。 */
    suspend fun listEmailAccounts(): Result<EmailAccountsResponse> =
        client.invoke("personal-data-hub.list-email-accounts", emptyMap())

    // ==================== Alipay Adapter 管理（4 method） ====================

    /** 注册支付宝账单导入账号（含 ZIP 密码）。**Privileged**。 */
    suspend fun registerAlipay(
        email: String,
        zipPassword: String? = null,
        opts: Map<String, Any>? = null
    ): Result<AdapterRegisterResponse> {
        val accountMap = mutableMapOf<String, Any>("email" to email)
        zipPassword?.let { accountMap["zipPassword"] = it }

        val params = mutableMapOf<String, Any>("account" to accountMap)
        opts?.let { params["opts"] = it }
        return client.invoke("personal-data-hub.register-alipay", params)
    }

    /** 注销支付宝配置。**Privileged**。 */
    suspend fun unregisterAlipay(email: String): Result<UnregisterResponse> =
        client.invoke("personal-data-hub.unregister-alipay", mapOf("email" to email))

    /** 导入支付宝 ZIP 或 CSV 账单。 */
    suspend fun importAlipayBill(
        zipPath: String? = null,
        csvPath: String? = null,
        zipPassword: String? = null
    ): Result<SyncReport> {
        val params = mutableMapOf<String, Any>()
        zipPath?.let { params["zipPath"] = it }
        csvPath?.let { params["csvPath"] = it }
        zipPassword?.let { params["zipPassword"] = it }
        require(params.isNotEmpty()) { "importAlipayBill requires at least one of zipPath / csvPath" }
        return client.invoke("personal-data-hub.import-alipay-bill", params)
    }

    /** 枚举已注册支付宝账号。 */
    suspend fun listAlipayAccounts(): Result<AlipayAccountsResponse> =
        client.invoke("personal-data-hub.list-alipay-accounts", emptyMap())

    // ==================== Dev / 通用 ====================

    /** 注册 MockAdapter 用于开发/smoke（仅 dev）。 */
    suspend fun registerMock(
        name: String? = null,
        count: Int? = null,
        seed: Int? = null
    ): Result<AdapterRegisterResponse> {
        val params = mutableMapOf<String, Any>()
        name?.let { params["name"] = it }
        count?.let { params["count"] = it }
        seed?.let { params["seed"] = it }
        return client.invoke("personal-data-hub.register-mock", params)
    }

    /** 通用 Adapter 注销。**Privileged**。 */
    suspend fun unregister(name: String): Result<UnregisterResponse> =
        client.invoke("personal-data-hub.unregister", mapOf("name" to name))

    // ==================== Analysis Skill (Phase 11) ====================

    /**
     * 跑内置分析 skill — `analysis.spending / relations / footprint / interests / timeline`。
     * Phase 14.2 v0.1 透传 raw JSON；UI 按 skillName 分支自行解析（iOS 同模式）。
     * 设计：docs/design/Personal_Data_Hub_Analysis_Skills.md。
     */
    suspend fun runSkill(
        name: String,
        options: Map<String, Any> = emptyMap()
    ): Result<HubSkillResult> {
        require(name.isNotEmpty()) { "runSkill: name empty" }
        val params = mapOf<String, Any>("name" to name, "options" to options)
        return client.invoke("personal-data-hub.run-skill", params)
    }
}

// ==================== 模型 ====================

// IMAP 账户输入（registerEmail / testEmailAuth）
data class EmailAccount(
    val provider: String,        // "qq" / "gmail" / "163" / "custom"
    val email: String,
    val authCode: String,
    val folders: List<String>? = null,
    val imapHost: String? = null,
    val imapPort: Int? = null
)

@Serializable
data class AskResult(
    val answer: String,
    val citations: List<Citation> = emptyList(),
    val llmName: String,
    val isLocal: Boolean
)

@Serializable
data class Citation(
    val eventId: String,
    val excerpt: String? = null,
    val confidence: Double? = null
)

@Serializable
data class HubStats(
    val vault: VaultStats,
    val adapters: List<AdapterMeta> = emptyList(),
    val hubDir: String? = null,
    val llm: LlmStats? = null
)

@Serializable
data class VaultStats(
    val events: Long = 0,
    val persons: Long = 0,
    val places: Long = 0,
    val items: Long = 0,
    val topics: Long = 0
)

@Serializable
data class AdapterMeta(
    val name: String,
    val version: String,
    val capabilities: List<String> = emptyList(),
    val sensitivity: String? = null
)

@Serializable
data class LlmStats(
    val provider: String,
    val name: String,
    val isLocal: Boolean
)

@Serializable
data class HubHealth(
    val vault: HealthVault,
    val llm: HealthLlm,
    val kgSink: HealthOk,
    val ragSink: HealthOk
)

@Serializable
data class HealthVault(val ok: Boolean, val schemaVersion: Int? = null)

@Serializable
data class HealthLlm(val ok: Boolean, val isLocal: Boolean, val name: String? = null)

@Serializable
data class HealthOk(val ok: Boolean)

@Serializable
data class AdaptersResponse(val adapters: List<AdapterMeta> = emptyList())

@Serializable
data class SyncReport(
    val adapter: String? = null,
    val ingested: Long = 0,
    val kgTriples: Long = 0,
    val ragDocs: Long = 0,
    val durationMs: Long = 0,
    val partitions: Map<String, PartitionReport> = emptyMap(),
    val errors: List<String> = emptyList()
)

@Serializable
data class PartitionReport(
    val ingested: Long = 0,
    val invalid: Long = 0,
    val watermark: String? = null
)

@Serializable
data class SyncReportList(val reports: List<SyncReport> = emptyList())

@Serializable
data class HubStreamStartResponse(
    val streamId: String,
    val name: String? = null
)

@Serializable
data class EventsResponse(val events: List<HubEvent> = emptyList())

@Serializable
data class HubEvent(
    val id: String,
    val subtype: String,
    val source: String,             // adapter name
    val ingestedAt: Long,
    val at: Long? = null,
    val actor: String? = null,
    val amount: Double? = null,
    val currency: String? = null,
    val title: String? = null,
    val confidence: Double? = null
)

@Serializable
data class AuditRowsResponse(val rows: List<AuditRow> = emptyList())

@Serializable
data class AuditRow(
    val at: Long,
    val action: String,             // "ingest" / "ask" / "register" / "unregister" / "sync"
    val adapter: String? = null,
    val eventId: String? = null,
    val actor: String? = null,
    val context: String? = null
)

@Serializable
data class EventDetailResponse(
    val event: HubEvent,
    val classification: Classification? = null,
    val extraction: Extraction? = null
)

@Serializable
data class Classification(
    val template: String? = null,
    val confidence: Double? = null,
    val labels: List<String> = emptyList()
)

@Serializable
data class Extraction(
    val template: String? = null,
    val confidence: Double? = null,
    val fields: Map<String, String> = emptyMap(),
    val warnings: List<String> = emptyList(),
    val pdfExtraction: PdfExtractionMeta? = null
)

@Serializable
data class PdfExtractionMeta(
    val ok: Boolean,
    val pageCount: Int? = null,
    val decrypted: Boolean? = null,
    val passwordHintUsed: String? = null
)

@Serializable
data class AdapterRegisterResponse(
    val name: String,
    val version: String? = null,
    val capabilities: List<String> = emptyList(),
    val sensitivity: String? = null
)

@Serializable
data class UnregisterResponse(
    val ok: Boolean,
    val removed: String? = null
)

@Serializable
data class TestAuthResponse(
    val ok: Boolean,
    val reason: String? = null,
    val error: String? = null
)

@Serializable
data class EmailAccountInfo(
    val email: String,
    val provider: String,
    val folders: List<String> = emptyList(),
    val registeredAt: Long,
    val pdfPasswordHints: List<String> = emptyList()
)

@Serializable
data class EmailAccountsResponse(val accounts: List<EmailAccountInfo> = emptyList())

@Serializable
data class AlipayAccountInfo(
    val email: String,
    val hasZipPassword: Boolean,
    val registeredAt: Long
)

@Serializable
data class AlipayAccountsResponse(val accounts: List<AlipayAccountInfo> = emptyList())

/**
 * `personal-data-hub.run-skill` 是动态结构 — 不同 skill 输出不同。
 * Phase 14.2 v0.1 透传 raw 输出；UI 按 skillName 分支自行解析。
 * v0.2 再加 typed sub-models (SpendingResult / RelationsResult 等)。
 */
@Serializable
data class HubSkillResult(
    val skill: String,
    // raw 字段集合 — UI 按 skill name 取需要的子结构
    val data: Map<String, kotlinx.serialization.json.JsonElement> = emptyMap()
)

/**
 * 桌面侧 IPC handler 拒绝时常以 `{ error: "..." }` 返回。本异常承载该错误文本，
 * 调用者通过 `Result.fold` 中的 onFailure 分支识别。
 */
class HubApiException(message: String) : RuntimeException(message)
