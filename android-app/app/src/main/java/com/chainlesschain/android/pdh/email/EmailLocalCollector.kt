package com.chainlesschain.android.pdh.email

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import timber.log.Timber
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.Properties
import javax.inject.Inject
import javax.inject.Singleton

/**
 * §2.3 D6.2 — IMAP fetch INBOX → snapshot.json → cc hub sync email-imap.
 *
 * Architecture：
 *  - 跟 BilibiliLocalCollector / WeChatLocalCollector 同 collector 模式 —
 *    用户 trigger sync → 本类 fetch + serialize → 写文件 → 调用方 (HubLocalViewModel)
 *    spawn cc syncAdapter("email-imap", path)
 *  - var session/store factory = test seam (JVM unit test inject mock)
 *
 * Sealed [SnapshotResult] 7 分支：
 *   NoCredentials / OAuthRequired / AuthFailed (用户授权码错) /
 *   ConnectFailed (DNS / TLS / 港口拒) / ProtocolFailed (IMAP 协议错) /
 *   Empty (INBOX 没邮件) / Ok(snapshotPath, fetchedCount)
 *
 * Jakarta Mail 用法：
 *   - javax.mail.Session.getInstance(Properties) — 静态工厂
 *   - Store store = session.getStore("imaps") — IMAP-TLS
 *   - store.connect(host, port, user, password) — auth + open socket
 *   - Folder inbox = store.getFolder("INBOX"); inbox.open(READ_ONLY)
 *   - Message[] msgs = inbox.messages — 反序 (最新在 [-1])
 *   - per Message: from / subject / sentDate / messageNumber / contentType /
 *                  text-body fallback to multipart parts
 *
 * Limits：默认 fetch 最新 200 封；v0.2 改增量 since 上次 lastSyncAt。Body
 * 截 8KB (推文 §"在本机" + 端侧 LLM 受 vault 大小约束)。BCC 不在 INBOX，
 * Sent folder v0.2 follow-up。
 *
 * 测试：var imapClient = ImapClient (DI seam)，单测注入 fake fetch list；
 * 跟 BilibiliApiClient 测试同 pattern。真 IMAP 集成测试 v0.2 mockwebserver。
 */
@Singleton
class EmailLocalCollector @Inject constructor(
    private val credentials: EmailCredentialsStore,
    @ApplicationContext private val context: Context,
) {

    sealed class SnapshotResult {
        data class Ok(val snapshotPath: String, val fetchedCount: Int) : SnapshotResult()
        object NoCredentials : SnapshotResult()
        object OAuthRequired : SnapshotResult()
        data class AuthFailed(val message: String) : SnapshotResult()
        data class ConnectFailed(val message: String) : SnapshotResult()
        data class ProtocolFailed(val message: String) : SnapshotResult()
        object Empty : SnapshotResult()
        data class Failed(val message: String) : SnapshotResult()
    }

    data class EmailRecord(
        val messageNumber: Int,
        val subject: String?,
        val from: String?,
        val to: String?,
        val sentDateMs: Long?,
        val bodyPreview: String?,
        val hasAttachments: Boolean,
    )

    /**
     * Test seam — production wires real Jakarta Mail.
     * Tests replace with stub that returns canned EmailRecord list.
     */
    internal var imapFetcher: ImapFetcher = JakartaMailFetcher()

    /**
     * snapshot(vendor) 入口。
     *  1. 读 credentials (NoCredentials 早返)
     *  2. Gmail + 无 OAuth token = OAuthRequired (v0.2.1)
     *  3. imapFetcher.fetchInbox 拿 EmailRecord 列表
     *  4. 序列化到 filesDir/staging/email-<vendor>-<ts>.json
     *  5. 返 Ok(path, count)
     */
    suspend fun snapshot(vendor: String, limit: Int = 200): SnapshotResult = withContext(Dispatchers.IO) {
        val v = EmailVendor.fromKey(vendor) ?: return@withContext SnapshotResult.Failed(
            message = "unknown vendor=$vendor",
        )
        val user = credentials.getUser(vendor)
        val password = credentials.getPassword(vendor)
        val host = credentials.getImapHost(vendor) ?: v.imapHost
        val port = credentials.getImapPort(vendor) ?: v.imapPort
        if (user.isNullOrBlank() || password.isNullOrBlank()) {
            return@withContext SnapshotResult.NoCredentials
        }
        if (v.usesOAuth) {
            // Gmail OAuth — v0.2.1。当前未实现 OAuth token 流程，所以即使用
            // 户填了密码也告诉他不行。但实际上如果用户填的是 Google App
            // Password (16-char) 也能走 plain IMAP (Google 还允许 App Password
            // 直登)。这里简化：v0.1 一律走 plain IMAP path，由用户决定填
            // App Password 还是 OAuth token。OAuth gated 在 v0.2.1。
            // ↑ 但是 if Gmail 走 plain 失败提示用户走 App Password。
        }
        val records = try {
            imapFetcher.fetchInbox(
                host = host,
                port = port,
                user = user,
                password = password,
                limit = limit,
            )
        } catch (e: ImapAuthException) {
            Timber.w("EmailLocalCollector.snapshot auth failed vendor=%s: %s", vendor, e.message)
            return@withContext SnapshotResult.AuthFailed(e.message ?: "认证失败")
        } catch (e: ImapConnectException) {
            Timber.w("EmailLocalCollector.snapshot connect failed vendor=%s: %s", vendor, e.message)
            return@withContext SnapshotResult.ConnectFailed(e.message ?: "连接失败")
        } catch (e: ImapProtocolException) {
            Timber.w("EmailLocalCollector.snapshot protocol failed vendor=%s: %s", vendor, e.message)
            return@withContext SnapshotResult.ProtocolFailed(e.message ?: "协议错误")
        } catch (t: Throwable) {
            Timber.w(t, "EmailLocalCollector.snapshot unknown error vendor=%s", vendor)
            return@withContext SnapshotResult.Failed(t.message ?: t.javaClass.simpleName)
        }
        if (records.isEmpty()) return@withContext SnapshotResult.Empty

        // Serialize to staging JSON. Shape mirrors packages/personal-data-hub
        // /lib/adapters/email-imap snapshot mode (Phase 5.8 LANDED, verified
        // 2026-06-11: adapter v0.7.0 has snapshotMode + CLI wiring registers
        // an EmailAdapter({snapshotMode:true}) instance — `cc hub sync
        // email-imap <path>` resolves; the old "unknown adapter" note is
        // obsolete).
        val staging = File(context.filesDir, "staging").apply { mkdirs() }
        val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())
        val outFile = File(staging, "email-$vendor-$stamp.json")
        val payload = JSONObject().apply {
            put("vendor", vendor)
            put("user", user)
            put("fetchedAt", System.currentTimeMillis())
            put("records", JSONArray().apply {
                for (r in records) {
                    put(
                        JSONObject().apply {
                            put("messageNumber", r.messageNumber)
                            put("subject", r.subject ?: JSONObject.NULL)
                            put("from", r.from ?: JSONObject.NULL)
                            put("to", r.to ?: JSONObject.NULL)
                            put("sentDateMs", r.sentDateMs ?: JSONObject.NULL)
                            put("bodyPreview", r.bodyPreview ?: JSONObject.NULL)
                            put("hasAttachments", r.hasAttachments)
                        },
                    )
                }
            })
        }
        outFile.writeText(payload.toString())
        SnapshotResult.Ok(snapshotPath = outFile.absolutePath, fetchedCount = records.size)
    }

    /** Test seam interface — production = JakartaMailFetcher. */
    internal interface ImapFetcher {
        @Throws(Throwable::class)
        fun fetchInbox(host: String, port: Int, user: String, password: String, limit: Int): List<EmailRecord>
    }

    class ImapAuthException(message: String, cause: Throwable? = null) : RuntimeException(message, cause)
    class ImapConnectException(message: String, cause: Throwable? = null) : RuntimeException(message, cause)
    class ImapProtocolException(message: String, cause: Throwable? = null) : RuntimeException(message, cause)
}

/**
 * Jakarta Mail (com.sun.mail:android-mail:1.6.7) IMAP-TLS fetcher。
 *
 * Wired by default to EmailLocalCollector. 测试 swap via internal var.
 *
 * Notes：
 *  - imaps:// 协议自动开 TLS (port 993)
 *  - body fetch 截 8KB；附件不下载 (太大 + 隐私)。仅 boolean hasAttachments.
 *  - Multipart：取 first text/plain part 作 bodyPreview；没 plain text 用
 *    text/html stripped → 100 char preview。
 *  - INBOX.messages 是反序 (1-indexed)，最新邮件 messageCount。取 [count
 *    - limit + 1 .. count] 拿最新 N 封。
 */
internal class JakartaMailFetcher : EmailLocalCollector.ImapFetcher {
    override fun fetchInbox(
        host: String,
        port: Int,
        user: String,
        password: String,
        limit: Int,
    ): List<EmailLocalCollector.EmailRecord> {
        val props = Properties().apply {
            setProperty("mail.store.protocol", "imaps")
            setProperty("mail.imap.host", host)
            setProperty("mail.imap.port", port.toString())
            setProperty("mail.imap.ssl.enable", "true")
            setProperty("mail.imap.ssl.checkserveridentity", "true")
            setProperty("mail.imap.connectiontimeout", "10000")
            setProperty("mail.imap.timeout", "20000")
        }
        val session = javax.mail.Session.getInstance(props)
        val store = try {
            session.getStore("imaps")
        } catch (e: javax.mail.NoSuchProviderException) {
            throw EmailLocalCollector.ImapProtocolException("Jakarta Mail no imaps provider", e)
        }
        try {
            store.connect(host, port, user, password)
        } catch (e: javax.mail.AuthenticationFailedException) {
            throw EmailLocalCollector.ImapAuthException(
                e.message ?: "authentication failed (检查授权码 / App Password)",
                e,
            )
        } catch (e: javax.mail.MessagingException) {
            // Connect failures (DNS / unreachable / TLS handshake) come as
            // MessagingException — disambiguate via cause type.
            val cause = e.cause
            if (cause is java.net.UnknownHostException || cause is java.net.ConnectException) {
                throw EmailLocalCollector.ImapConnectException(
                    "无法连接 $host:$port — ${cause.message ?: cause.javaClass.simpleName}",
                    e,
                )
            }
            throw EmailLocalCollector.ImapProtocolException(
                e.message ?: "IMAP connect failed",
                e,
            )
        }
        try {
            val inbox = store.getFolder("INBOX")
            inbox.open(javax.mail.Folder.READ_ONLY)
            val total = inbox.messageCount
            if (total == 0) return emptyList()
            val from = maxOf(1, total - limit + 1)
            val msgs = inbox.getMessages(from, total)
            return msgs.map { msg ->
                EmailLocalCollector.EmailRecord(
                    messageNumber = msg.messageNumber,
                    subject = safeStr { msg.subject },
                    from = safeStr { msg.from?.joinToString(", ") { it.toString() } },
                    to = safeStr {
                        msg.getRecipients(javax.mail.Message.RecipientType.TO)
                            ?.joinToString(", ") { it.toString() }
                    },
                    sentDateMs = safeStr { msg.sentDate?.time?.toString() }?.toLongOrNull(),
                    bodyPreview = extractBodyPreview(msg),
                    hasAttachments = safeStr {
                        if (msg.contentType?.startsWith("multipart", ignoreCase = true) == true) {
                            val multipart = msg.content as? javax.mail.Multipart ?: return@safeStr "false"
                            (0 until multipart.count).any { i ->
                                val part = multipart.getBodyPart(i)
                                javax.mail.Part.ATTACHMENT.equals(part.disposition, ignoreCase = true) ||
                                    !part.fileName.isNullOrBlank()
                            }.toString()
                        } else "false"
                    } == "true",
                )
            }
        } finally {
            try { store.close() } catch (_: Throwable) { /* best-effort */ }
        }
    }

    private fun extractBodyPreview(msg: javax.mail.Message): String? = try {
        val raw = when (val c = msg.content) {
            is String -> c
            is javax.mail.Multipart -> firstTextPart(c) ?: ""
            else -> ""
        }
        raw.take(BODY_PREVIEW_LIMIT)
    } catch (t: Throwable) {
        Timber.w(t, "JakartaMailFetcher.extractBodyPreview")
        null
    }

    private fun firstTextPart(mp: javax.mail.Multipart): String? {
        for (i in 0 until mp.count) {
            val part = mp.getBodyPart(i)
            val ct = part.contentType?.lowercase() ?: continue
            if (ct.startsWith("text/plain")) {
                return (part.content as? String)
            }
        }
        // Fallback to first text/html stripped (very crude — v0.2 use jsoup)
        for (i in 0 until mp.count) {
            val part = mp.getBodyPart(i)
            val ct = part.contentType?.lowercase() ?: continue
            if (ct.startsWith("text/html")) {
                val html = (part.content as? String) ?: continue
                return html.replace(Regex("<[^>]+>"), " ").replace(Regex("\\s+"), " ").trim()
            }
        }
        return null
    }

    private inline fun safeStr(block: () -> String?): String? = try {
        block()
    } catch (_: Throwable) {
        null
    }

    companion object {
        private const val BODY_PREVIEW_LIMIT = 8 * 1024  // 8KB cap
    }
}
