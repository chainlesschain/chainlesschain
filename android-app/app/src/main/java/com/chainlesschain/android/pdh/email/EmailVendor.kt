package com.chainlesschain.android.pdh.email

/**
 * §2.3 D6.2 — 4 邮箱 vendor 配置 (推文 §"邮箱: QQ / Gmail / 163 / Outlook")。
 *
 * 4 字段每 vendor：
 *  - key            : 唯一标识 (cc adapter --vendor + Credentials key prefix)
 *  - displayName    : 用户可见 (推文文案直照搬，带括号厂商前缀)
 *  - imapHost       : IMAP 服务器域名 (固定，用户不改；如果改了我们没法验证)
 *  - imapPort       : IMAP TLS 端口 (常 993)
 *  - usesOAuth      : Gmail 强求 OAuth (Google 砍了 less-secure-app 通道)；
 *                     其它 3 家 IMAP user/password (App-specific password) OK
 *  - authNote       : 用户授权指引 (推文用户多数不懂 IMAP，要在 dialog 上写
 *                     "QQ 邮箱要先到 web 端开 IMAP/SMTP 拿授权码")
 *
 * 真接通路径：用户提交 EmailCredentialsDialog → EmailCredentialsStore 存
 * cred (EncryptedSharedPreferences AES-256-GCM) → 同步时 EmailLocalCollector
 * 用 Jakarta Mail 连 imapHost:imapPort → FETCH INBOX → snapshot.json → cc
 * hub sync email-imap --input <path>。Gmail OAuth path (v0.2.1 follow-up)
 * 需 Google API console + WebView 拦截 redirect — 本 commit 占位 OAuth bool。
 *
 * 跟 AiChatVendor 模式对齐：单文件 enum + ORDERED list + fromKey() lookup，
 * UI 直 iterate。
 */
enum class EmailVendor(
    val key: String,
    val displayName: String,
    val imapHost: String,
    val imapPort: Int,
    val usesOAuth: Boolean,
    val authNote: String,
) {
    QQ(
        key = "qq",
        displayName = "QQ 邮箱",
        imapHost = "imap.qq.com",
        imapPort = 993,
        usesOAuth = false,
        authNote = "Web 端 mail.qq.com → 设置 → 账户 → 开启 IMAP/SMTP → 拿授权码 (16 位)，密码栏填授权码不是登录密码",
    ),
    GMAIL(
        key = "gmail",
        displayName = "Gmail",
        imapHost = "imap.gmail.com",
        imapPort = 993,
        usesOAuth = true,
        authNote = "Gmail 强求 OAuth — v0.2.1 加 Google 登录。临时用 App Password (myaccount.google.com → 安全 → 两步验证 → 应用专用密码)",
    ),
    NETEASE163(
        key = "netease163",
        displayName = "163 邮箱",
        imapHost = "imap.163.com",
        imapPort = 993,
        usesOAuth = false,
        authNote = "Web 端 mail.163.com → 设置 → POP3/SMTP/IMAP → 开启 IMAP → 客户端授权码 (16 位)，密码栏填授权码",
    ),
    OUTLOOK(
        key = "outlook",
        displayName = "Outlook",
        imapHost = "outlook.office365.com",
        imapPort = 993,
        usesOAuth = false,
        authNote = "微软账户密码可直接登 IMAP（如果两步验证已开则需用 App Password — account.live.com 创建）",
    );

    companion object {
        fun fromKey(key: String): EmailVendor? = entries.firstOrNull { it.key == key }
        val ORDERED: List<EmailVendor> = listOf(QQ, GMAIL, NETEASE163, OUTLOOK)
    }
}
