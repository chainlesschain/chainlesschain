package com.chainlesschain.android.remote.commands

import com.chainlesschain.android.remote.client.RemoteCommandClient
import kotlinx.serialization.Serializable
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 用户浏览器控制命令 API
 *
 * 通过 Chrome DevTools Protocol (CDP) 连接和控制用户已安装的真实浏览器
 * 支持 Chrome、Edge、Brave 等基于 Chromium 的浏览器
 */
@Singleton
class UserBrowserCommands @Inject constructor(
    private val client: RemoteCommandClient
) {
    // ==================== 连接管理 ====================

    /**
     * 查找可用浏览器
     *
     * @return 可用浏览器列表
     */
    suspend fun findBrowsers(): Result<FindBrowsersResponse> {
        return client.invoke("userBrowser.findBrowsers", emptyMap())
    }

    /**
     * 连接到用户浏览器
     *
     * @param browserType 浏览器类型（chrome/edge/brave）
     * @param port 调试端口
     * @param autoLaunch 是否自动启动浏览器
     */
    suspend fun connect(
        browserType: String = "chrome",
        port: Int? = null,
        autoLaunch: Boolean = true
    ): Result<ConnectBrowserResponse> {
        val params = mutableMapOf<String, Any>(
            "browserType" to browserType,
            "autoLaunch" to autoLaunch
        )
        port?.let { params["port"] = it }

        return client.invoke("userBrowser.connect", params)
    }

    /**
     * 断开浏览器连接
     */
    suspend fun disconnect(): Result<DisconnectBrowserResponse> {
        return client.invoke("userBrowser.disconnect", emptyMap())
    }

    /**
     * 获取连接状态
     */
    suspend fun getStatus(): Result<BrowserConnectionStatus> {
        return client.invoke("userBrowser.getStatus", emptyMap())
    }

    // ==================== 标签页管理 ====================

    /**
     * 列出所有标签页
     */
    suspend fun listTabs(): Result<UserBrowserTabsResponse> {
        return client.invoke("userBrowser.listTabs", emptyMap())
    }

    /**
     * 获取当前活动标签页
     */
    suspend fun getActiveTab(): Result<UserBrowserTabResponse> {
        return client.invoke("userBrowser.getActiveTab", emptyMap())
    }

    /**
     * 创建新标签页
     *
     * @param url 目标 URL（可选）
     * @param active 是否激活
     */
    suspend fun createTab(
        url: String? = null,
        active: Boolean = true
    ): Result<UserBrowserTabResponse> {
        val params = mutableMapOf<String, Any>("active" to active)
        url?.let { params["url"] = it }

        return client.invoke("userBrowser.createTab", params)
    }

    /**
     * 关闭标签页
     *
     * @param targetId 标签页 ID
     */
    suspend fun closeTab(targetId: String): Result<CloseTabResult> {
        return client.invoke("userBrowser.closeTab", mapOf("targetId" to targetId))
    }

    /**
     * 聚焦标签页
     *
     * @param targetId 标签页 ID
     */
    suspend fun focusTab(targetId: String): Result<FocusTabResult> {
        return client.invoke("userBrowser.focusTab", mapOf("targetId" to targetId))
    }

    // ==================== 导航 ====================

    /**
     * 导航到 URL
     *
     * @param targetId 标签页 ID
     * @param url 目标 URL
     */
    suspend fun navigate(targetId: String, url: String): Result<NavigateResult> {
        return client.invoke("userBrowser.navigate", mapOf(
            "targetId" to targetId,
            "url" to url
        ))
    }

    /**
     * 后退
     *
     * @param targetId 标签页 ID
     */
    suspend fun goBack(targetId: String): Result<NavigationResult> {
        return client.invoke("userBrowser.goBack", mapOf("targetId" to targetId))
    }

    /**
     * 前进
     *
     * @param targetId 标签页 ID
     */
    suspend fun goForward(targetId: String): Result<NavigationResult> {
        return client.invoke("userBrowser.goForward", mapOf("targetId" to targetId))
    }

    /**
     * 刷新页面
     *
     * @param targetId 标签页 ID
     * @param ignoreCache 是否忽略缓存
     */
    suspend fun refresh(
        targetId: String,
        ignoreCache: Boolean = false
    ): Result<NavigationResult> {
        return client.invoke("userBrowser.refresh", mapOf(
            "targetId" to targetId,
            "ignoreCache" to ignoreCache
        ))
    }

    // ==================== 页面操作 ====================

    /**
     * 执行 JavaScript（需要 Admin 权限）
     *
     * @param targetId 标签页 ID
     * @param script JavaScript 代码
     */
    suspend fun executeScript(
        targetId: String,
        script: String
    ): Result<ScriptExecutionResult> {
        return client.invoke("userBrowser.executeScript", mapOf(
            "targetId" to targetId,
            "script" to script
        ))
    }

    /**
     * 获取页面内容
     *
     * @param targetId 标签页 ID
     * @param format 格式（html/text）
     */
    suspend fun getPageContent(
        targetId: String,
        format: String = "html"
    ): Result<PageContentResult> {
        return client.invoke("userBrowser.getPageContent", mapOf(
            "targetId" to targetId,
            "format" to format
        ))
    }

    /**
     * 截图
     *
     * @param targetId 标签页 ID
     * @param format 格式（png/jpeg）
     * @param quality JPEG 质量（1-100）
     * @param fullPage 是否全页截图
     */
    suspend fun screenshot(
        targetId: String,
        format: String = "png",
        quality: Int? = null,
        fullPage: Boolean = false
    ): Result<UserBrowserScreenshotResult> {
        val params = mutableMapOf<String, Any>(
            "targetId" to targetId,
            "format" to format,
            "fullPage" to fullPage
        )
        quality?.let { params["quality"] = it }

        return client.invoke("userBrowser.screenshot", params)
    }

    // ==================== 用户数据 ====================

    /**
     * 获取书签
     *
     * @param folderId 文件夹 ID（可选）
     */
    suspend fun getBookmarks(folderId: String? = null): Result<UserBrowserBookmarksResponse> {
        val params = mutableMapOf<String, Any>()
        folderId?.let { params["folderId"] = it }

        return client.invoke("userBrowser.getBookmarks", params)
    }

    /**
     * 获取历史记录
     *
     * @param query 搜索关键词
     * @param maxResults 最大结果数
     * @param startTime 开始时间戳
     * @param endTime 结束时间戳
     */
    suspend fun getHistory(
        query: String? = null,
        maxResults: Int = 100,
        startTime: Long? = null,
        endTime: Long? = null
    ): Result<UserBrowserHistoryResponse> {
        val params = mutableMapOf<String, Any>("maxResults" to maxResults)
        query?.let { params["query"] = it }
        startTime?.let { params["startTime"] = it }
        endTime?.let { params["endTime"] = it }

        return client.invoke("userBrowser.getHistory", params)
    }
}

// ==================== 响应数据类 ====================

@Serializable
data class FindBrowsersResponse(
    val success: Boolean = true,
    val browsers: List<AvailableBrowser>
)

@Serializable
data class AvailableBrowser(
    val type: String,
    val name: String,
    val executablePath: String,
    val defaultPort: Int,
    val userDataDir: String? = null
)

@Serializable
data class ConnectBrowserResponse(
    val success: Boolean,
    val browserType: String,
    val debugPort: Int,
    val wsEndpoint: String? = null,
    val message: String? = null
)

@Serializable
data class DisconnectBrowserResponse(
    val success: Boolean,
    val message: String? = null
)

@Serializable
data class BrowserConnectionStatus(
    val success: Boolean = true,
    val connected: Boolean,
    val browserType: String? = null,
    val debugPort: Int? = null,
    val tabCount: Int? = null,
    val connectTime: Long? = null,
    val commandCount: Int? = null
)

@Serializable
data class UserBrowserTabsResponse(
    val success: Boolean,
    val tabs: List<UserBrowserTab>,
    val total: Int
)

@Serializable
data class UserBrowserTab(
    val targetId: String,
    val url: String,
    val title: String? = null,
    val type: String,
    val attached: Boolean = false,
    val active: Boolean = false,
    val favIconUrl: String? = null
)

@Serializable
data class UserBrowserTabResponse(
    val success: Boolean,
    val tab: UserBrowserTab? = null,
    val message: String? = null
)

@Serializable
data class CloseTabResult(
    val success: Boolean,
    val targetId: String? = null,
    val message: String? = null
)

@Serializable
data class FocusTabResult(
    val success: Boolean,
    val targetId: String? = null,
    val message: String? = null
)

@Serializable
data class NavigateResult(
    val success: Boolean,
    val targetId: String? = null,
    val url: String? = null,
    val frameId: String? = null,
    val loaderId: String? = null,
    val errorText: String? = null
)

@Serializable
data class NavigationResult(
    val success: Boolean,
    val targetId: String? = null,
    val message: String? = null
)

@Serializable
data class ScriptExecutionResult(
    val success: Boolean,
    val result: String? = null,
    val type: String? = null,
    val error: String? = null,
    val exceptionDetails: String? = null
)

@Serializable
data class PageContentResult(
    val success: Boolean,
    val content: String? = null,
    val format: String? = null,
    val url: String? = null,
    val title: String? = null,
    val length: Int? = null
)

@Serializable
data class UserBrowserScreenshotResult(
    val success: Boolean,
    val data: String,  // Base64 编码的图片
    val format: String,
    val width: Int? = null,
    val height: Int? = null,
    val size: Int? = null
)

@Serializable
data class UserBrowserBookmarksResponse(
    val success: Boolean,
    val bookmarks: List<UserBrowserBookmark>,
    val total: Int
)

@Serializable
data class UserBrowserBookmark(
    val id: String,
    val title: String,
    val url: String? = null,
    val parentId: String? = null,
    val dateAdded: Long? = null,
    val dateGroupModified: Long? = null,
    val children: List<UserBrowserBookmark>? = null,
    val type: String = "bookmark"  // bookmark 或 folder
)

@Serializable
data class UserBrowserHistoryResponse(
    val success: Boolean,
    val items: List<UserBrowserHistoryItem>,
    val total: Int
)

@Serializable
data class UserBrowserHistoryItem(
    val id: String,
    val url: String,
    val title: String? = null,
    val lastVisitTime: Long,
    val visitCount: Int,
    val typedCount: Int? = null
)
