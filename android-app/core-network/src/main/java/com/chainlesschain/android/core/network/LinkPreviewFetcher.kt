package com.chainlesschain.android.core.network

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.jsoup.Jsoup
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 链接预览数据
 */
data class LinkPreview(
    val url: String,
    val title: String?,
    val description: String?,
    val imageUrl: String?,
    val siteName: String?
)

/**
 * 链接预览获取器
 *
 * 使用 Jsoup 解析网页的 Open Graph 标签
 */
@Singleton
class LinkPreviewFetcher @Inject constructor() {

    private val client = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(5, TimeUnit.SECONDS)
        .build()

    // LRU 缓存 (max 50, thread-safe)
    private val cache: MutableMap<String, LinkPreview> = java.util.Collections.synchronizedMap(
        object : LinkedHashMap<String, LinkPreview>(50, 0.75f, true) {
            override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, LinkPreview>?): Boolean {
                return size > 50
            }
        }
    )

    /**
     * 获取链接预览
     *
     * @param url 链接 URL
     * @return 链接预览数据，失败返回 null
     */
    suspend fun fetchPreview(url: String): LinkPreview? = withContext(Dispatchers.IO) {
        // 检查缓存
        cache[url]?.let { return@withContext it }

        try {
            // 发送 HTTP 请求
            val request = Request.Builder()
                .url(url)
                .header("User-Agent", "Mozilla/5.0 (compatible; ChainlessChain/1.0)")
                .build()

            val response = client.newCall(request).execute()

            if (!response.isSuccessful) {
                return@withContext null
            }

            val html = response.body?.string() ?: return@withContext null

            // 解析 HTML
            val document = Jsoup.parse(html)

            // 提取 Open Graph 标签
            val ogTitle = document.select("meta[property=og:title]").attr("content")
            val ogDescription = document.select("meta[property=og:description]").attr("content")
            val ogImage = document.select("meta[property=og:image]").attr("content")
            val ogSiteName = document.select("meta[property=og:site_name]").attr("content")

            // 如果没有 OG 标签，尝试使用普通标签
            val title = ogTitle.ifBlank {
                document.select("meta[name=title]").attr("content").ifBlank {
                    document.title()
                }
            }

            val description = ogDescription.ifBlank {
                document.select("meta[name=description]").attr("content")
            }

            val imageUrl = ogImage.ifBlank {
                // 尝试找到第一张合适的图片
                document.select("img").firstOrNull()?.attr("src")
            }

            // 创建预览对象
            val preview = LinkPreview(
                url = url,
                title = title.takeIf { it.isNotBlank() },
                description = description.takeIf { it.isNotBlank() },
                imageUrl = imageUrl?.let { resolveImageUrl(url, it) },
                siteName = ogSiteName.takeIf { it.isNotBlank() }
            )

            // 缓存结果
            cache[url] = preview

            preview
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
    }

    /**
     * 解析图片 URL（处理相对路径）
     */
    private fun resolveImageUrl(baseUrl: String, imageUrl: String): String {
        return when {
            imageUrl.startsWith("http://") || imageUrl.startsWith("https://") -> imageUrl
            imageUrl.startsWith("//") -> "https:$imageUrl"
            imageUrl.startsWith("/") -> {
                val base = baseUrl.substringBefore("?").substringBefore("#")
                val domain = base.substringAfter("://").substringBefore("/")
                val protocol = base.substringBefore("://")
                "$protocol://$domain$imageUrl"
            }
            else -> {
                val base = baseUrl.substringBefore("?").substringBefore("#")
                    .substringBeforeLast("/")
                "$base/$imageUrl"
            }
        }
    }

    /**
     * 清除缓存
     */
    fun clearCache() {
        cache.clear()
    }

    /**
     * 从文本中提取 URL
     */
    fun extractUrls(text: String): List<String> {
        val urlPattern = Regex(
            """https?://[^\s<>"{}|\\^`\[\]]+""",
            RegexOption.IGNORE_CASE
        )
        return urlPattern.findAll(text).map { it.value }.toList()
    }
}
