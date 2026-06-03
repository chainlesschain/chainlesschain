package com.chainlesschain.android.core.ui.util

import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat.startActivity

/**
 * 分享管理器
 *
 * 处理Android ShareSheet集成
 */
object ShareManager {

    /**
     * 分享动态
     *
     * @param context Context
     * @param authorName 作者名称
     * @param content 动态内容
     * @param postUrl 动态链接（可选）
     */
    fun sharePost(
        context: Context,
        authorName: String,
        content: String,
        postUrl: String? = null
    ) {
        val shareText = formatShareText(authorName, content, postUrl)

        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, shareText)
            putExtra(Intent.EXTRA_SUBJECT, "来自 ChainlessChain 的动态")
        }

        val chooser = Intent.createChooser(intent, "分享到")
        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(chooser)
    }

    /**
     * 分享文本
     *
     * @param context Context
     * @param text 要分享的文本
     * @param subject 主题（可选）
     */
    fun shareText(
        context: Context,
        text: String,
        subject: String? = null
    ) {
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, text)
            subject?.let { putExtra(Intent.EXTRA_SUBJECT, it) }
        }

        val chooser = Intent.createChooser(intent, "分享")
        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(chooser)
    }

    /**
     * 分享链接
     *
     * @param context Context
     * @param url 链接
     * @param title 标题（可选）
     */
    fun shareLink(
        context: Context,
        url: String,
        title: String? = null
    ) {
        val shareText = if (title != null) {
            "$title\n$url"
        } else {
            url
        }

        shareText(context, shareText, title)
    }

    /**
     * 格式化分享文本
     */
    private fun formatShareText(
        authorName: String,
        content: String,
        postUrl: String?
    ): String {
        val truncatedContent = if (content.length > 200) {
            content.take(200) + "..."
        } else {
            content
        }

        return buildString {
            appendLine("【$authorName 的动态】")
            appendLine()
            appendLine(truncatedContent)
            appendLine()

            if (postUrl != null) {
                appendLine("链接: $postUrl")
                appendLine()
            }

            append("来自 ChainlessChain")
        }
    }
}
