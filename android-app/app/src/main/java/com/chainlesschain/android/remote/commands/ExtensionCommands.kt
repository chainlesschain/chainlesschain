package com.chainlesschain.android.remote.commands

import com.chainlesschain.android.remote.client.RemoteCommandClient
import kotlinx.serialization.Serializable
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 浏览器扩展命令 API
 *
 * 提供类型安全的浏览器扩展控制命令（200+个命令）
 * 通过 WebSocket 连接桌面端浏览器扩展
 */
@Singleton
class ExtensionCommands @Inject constructor(
    private val client: RemoteCommandClient
) {
    // ==================== 基础状态 ====================

    /**
     * 获取扩展状态
     */
    suspend fun getStatus(): Result<ExtensionStatusResponse> {
        return client.invoke("extension.getStatus", emptyMap())
    }

    /**
     * 获取已连接的扩展客户端
     */
    suspend fun getClients(): Result<ExtensionClientsResponse> {
        return client.invoke("extension.getClients", emptyMap())
    }

    // ==================== 标签页管理 ====================

    /**
     * 列出所有标签页
     */
    suspend fun listTabs(): Result<ExtensionTabsResponse> {
        return client.invoke("extension.listTabs", emptyMap())
    }

    /**
     * 创建新标签页
     *
     * @param url 目标 URL
     * @param active 是否激活
     * @param windowId 窗口 ID
     */
    suspend fun createTab(
        url: String,
        active: Boolean = true,
        windowId: Int? = null
    ): Result<ExtensionTabResponse> {
        val params = mutableMapOf<String, Any>(
            "url" to url,
            "active" to active
        )
        windowId?.let { params["windowId"] = it }
        return client.invoke("extension.createTab", params)
    }

    /**
     * 关闭标签页
     *
     * @param tabId 标签页 ID
     */
    suspend fun closeTab(tabId: Int): Result<ExtensionOperationResponse> {
        return client.invoke("extension.closeTab", mapOf("tabId" to tabId))
    }

    /**
     * 聚焦标签页
     *
     * @param tabId 标签页 ID
     */
    suspend fun focusTab(tabId: Int): Result<ExtensionOperationResponse> {
        return client.invoke("extension.focusTab", mapOf("tabId" to tabId))
    }

    // ==================== 导航控制 ====================

    /**
     * 导航到 URL
     *
     * @param tabId 标签页 ID
     * @param url 目标 URL
     */
    suspend fun navigate(tabId: Int, url: String): Result<ExtensionOperationResponse> {
        return client.invoke("extension.navigate", mapOf(
            "tabId" to tabId,
            "url" to url
        ))
    }

    /**
     * 刷新页面
     *
     * @param tabId 标签页 ID
     * @param bypassCache 是否绕过缓存
     */
    suspend fun reload(tabId: Int, bypassCache: Boolean = false): Result<ExtensionOperationResponse> {
        return client.invoke("extension.reload", mapOf(
            "tabId" to tabId,
            "bypassCache" to bypassCache
        ))
    }

    /**
     * 后退
     *
     * @param tabId 标签页 ID
     */
    suspend fun goBack(tabId: Int): Result<ExtensionOperationResponse> {
        return client.invoke("extension.goBack", mapOf("tabId" to tabId))
    }

    /**
     * 前进
     *
     * @param tabId 标签页 ID
     */
    suspend fun goForward(tabId: Int): Result<ExtensionOperationResponse> {
        return client.invoke("extension.goForward", mapOf("tabId" to tabId))
    }

    // ==================== 页面内容 ====================

    /**
     * 获取页面内容
     *
     * @param tabId 标签页 ID
     */
    suspend fun getPageContent(tabId: Int): Result<PageContentResponse> {
        return client.invoke("extension.getPageContent", mapOf("tabId" to tabId))
    }

    /**
     * 执行脚本（需要 Admin 权限）
     *
     * @param tabId 标签页 ID
     * @param code JavaScript 代码
     */
    suspend fun executeScript(tabId: Int, code: String): Result<ScriptResultResponse> {
        return client.invoke("extension.executeScript", mapOf(
            "tabId" to tabId,
            "code" to code
        ))
    }

    /**
     * 截图
     *
     * @param tabId 标签页 ID
     * @param format 格式（png/jpeg）
     * @param quality JPEG 质量
     */
    suspend fun screenshot(
        tabId: Int,
        format: String = "png",
        quality: Int? = null
    ): Result<ExtensionScreenshotResponse> {
        val params = mutableMapOf<String, Any>(
            "tabId" to tabId,
            "format" to format
        )
        quality?.let { params["quality"] = it }
        return client.invoke("extension.screenshot", params)
    }

    // ==================== 书签管理 ====================

    /**
     * 获取书签
     */
    suspend fun getBookmarks(): Result<BookmarksResponse> {
        return client.invoke("extension.getBookmarks", emptyMap())
    }

    /**
     * 搜索书签
     *
     * @param query 搜索关键词
     */
    suspend fun searchBookmarks(query: String): Result<BookmarksResponse> {
        return client.invoke("extension.searchBookmarks", mapOf("query" to query))
    }

    /**
     * 创建书签（需要 Admin 权限）
     *
     * @param title 标题
     * @param url URL
     * @param parentId 父文件夹 ID
     */
    suspend fun createBookmark(
        title: String,
        url: String,
        parentId: String? = null
    ): Result<BookmarkResponse> {
        val params = mutableMapOf<String, Any>(
            "title" to title,
            "url" to url
        )
        parentId?.let { params["parentId"] = it }
        return client.invoke("extension.createBookmark", params)
    }

    // ==================== 历史记录 ====================

    /**
     * 获取浏览历史
     *
     * @param text 搜索文本
     * @param maxResults 最大结果数
     */
    suspend fun getHistory(
        text: String? = null,
        maxResults: Int = 100
    ): Result<HistoryItemsResponse> {
        val params = mutableMapOf<String, Any>("maxResults" to maxResults)
        text?.let { params["text"] = it }
        return client.invoke("extension.getHistory", params)
    }

    // ==================== 剪贴板 ====================

    /**
     * 读取剪贴板
     */
    suspend fun readClipboard(): Result<ClipboardResponse> {
        return client.invoke("extension.readClipboard", emptyMap())
    }

    /**
     * 写入剪贴板
     *
     * @param text 文本内容
     */
    suspend fun writeClipboard(text: String): Result<ExtensionOperationResponse> {
        return client.invoke("extension.writeClipboard", mapOf("text" to text))
    }

    // ==================== Cookie 管理 ====================

    /**
     * 获取 Cookie
     *
     * @param url 目标 URL
     * @param name Cookie 名称（可选）
     */
    suspend fun getCookies(url: String, name: String? = null): Result<CookiesResponse> {
        val params = mutableMapOf<String, Any>("url" to url)
        name?.let { params["name"] = it }
        return client.invoke("extension.getCookies", params)
    }

    /**
     * 设置 Cookie（需要 Admin 权限）
     *
     * @param url 目标 URL
     * @param name Cookie 名称
     * @param value Cookie 值
     */
    suspend fun setCookie(url: String, name: String, value: String): Result<CookieResponse> {
        return client.invoke("extension.setCookie", mapOf(
            "url" to url,
            "name" to name,
            "value" to value
        ))
    }

    // ==================== 下载管理 ====================

    /**
     * 列出下载
     *
     * @param limit 数量限制
     */
    suspend fun listDownloads(limit: Int = 50): Result<DownloadsResponse> {
        return client.invoke("extension.listDownloads", mapOf("limit" to limit))
    }

    /**
     * 下载文件
     *
     * @param url 下载 URL
     * @param filename 保存文件名
     */
    suspend fun download(url: String, filename: String? = null): Result<DownloadResponse> {
        val params = mutableMapOf<String, Any>("url" to url)
        filename?.let { params["filename"] = it }
        return client.invoke("extension.download", params)
    }

    // ==================== 窗口管理 ====================

    /**
     * 获取所有窗口
     */
    suspend fun getAllWindows(): Result<WindowsResponse> {
        return client.invoke("extension.getAllWindows", emptyMap())
    }

    /**
     * 获取当前窗口
     */
    suspend fun getCurrentWindow(): Result<WindowResponse> {
        return client.invoke("extension.getCurrentWindow", emptyMap())
    }

    /**
     * 创建窗口
     *
     * @param url 初始 URL
     * @param type 窗口类型（normal/popup/panel）
     */
    suspend fun createWindow(
        url: String? = null,
        type: String = "normal"
    ): Result<WindowResponse> {
        val params = mutableMapOf<String, Any>("type" to type)
        url?.let { params["url"] = it }
        return client.invoke("extension.createWindow", params)
    }

    // ==================== 存储管理 ====================

    /**
     * 获取 localStorage
     *
     * @param tabId 标签页 ID
     * @param key 键名（可选，不传则获取全部）
     */
    suspend fun getLocalStorage(tabId: Int, key: String? = null): Result<StorageResponse> {
        val params = mutableMapOf<String, Any>("tabId" to tabId)
        key?.let { params["key"] = it }
        return client.invoke("extension.getLocalStorage", params)
    }

    /**
     * 设置 localStorage（需要 Admin 权限）
     *
     * @param tabId 标签页 ID
     * @param key 键名
     * @param value 值
     */
    suspend fun setLocalStorage(tabId: Int, key: String, value: String): Result<ExtensionOperationResponse> {
        return client.invoke("extension.setLocalStorage", mapOf(
            "tabId" to tabId,
            "key" to key,
            "value" to value
        ))
    }

    // ==================== DOM 操作 ====================

    /**
     * 悬停元素
     *
     * @param tabId 标签页 ID
     * @param selector CSS 选择器
     */
    suspend fun hoverElement(tabId: Int, selector: String): Result<ExtensionOperationResponse> {
        return client.invoke("extension.hoverElement", mapOf(
            "tabId" to tabId,
            "selector" to selector
        ))
    }

    /**
     * 点击元素
     *
     * @param tabId 标签页 ID
     * @param selector CSS 选择器
     */
    suspend fun type(tabId: Int, selector: String, text: String): Result<ExtensionOperationResponse> {
        return client.invoke("extension.type", mapOf(
            "tabId" to tabId,
            "selector" to selector,
            "text" to text
        ))
    }

    /**
     * 等待选择器
     *
     * @param tabId 标签页 ID
     * @param selector CSS 选择器
     * @param timeout 超时时间（毫秒）
     */
    suspend fun waitForSelector(
        tabId: Int,
        selector: String,
        timeout: Int = 10000
    ): Result<WaitForSelectorResponse> {
        return client.invoke("extension.waitForSelector", mapOf(
            "tabId" to tabId,
            "selector" to selector,
            "timeout" to timeout
        ))
    }

    // ==================== 网络拦截 ====================

    /**
     * 启用网络拦截（需要 Admin 权限）
     */
    suspend fun enableNetworkInterception(): Result<ExtensionOperationResponse> {
        return client.invoke("extension.enableNetworkInterception", emptyMap())
    }

    /**
     * 禁用网络拦截（需要 Admin 权限）
     */
    suspend fun disableNetworkInterception(): Result<ExtensionOperationResponse> {
        return client.invoke("extension.disableNetworkInterception", emptyMap())
    }

    /**
     * 获取网络请求
     *
     * @param tabId 标签页 ID
     * @param limit 数量限制
     */
    suspend fun getNetworkRequests(tabId: Int, limit: Int = 100): Result<NetworkRequestsResponse> {
        return client.invoke("extension.getNetworkRequests", mapOf(
            "tabId" to tabId,
            "limit" to limit
        ))
    }

    // ==================== 性能监控 ====================

    /**
     * 获取性能指标
     *
     * @param tabId 标签页 ID
     */
    suspend fun getPerformanceMetrics(tabId: Int): Result<PerformanceMetricsResponse> {
        return client.invoke("extension.getPerformanceMetrics", mapOf("tabId" to tabId))
    }

    /**
     * 获取内存信息
     *
     * @param tabId 标签页 ID
     */
    suspend fun getMemoryInfo(tabId: Int): Result<MemoryInfoResponse> {
        return client.invoke("extension.getMemoryInfo", mapOf("tabId" to tabId))
    }

    // ==================== 无障碍检查 ====================

    /**
     * 获取无障碍树
     *
     * @param tabId 标签页 ID
     */
    suspend fun getAccessibilityTree(tabId: Int): Result<AccessibilityTreeResponse> {
        return client.invoke("extension.getAccessibilityTree", mapOf("tabId" to tabId))
    }

    /**
     * 运行无障碍审计
     *
     * @param tabId 标签页 ID
     */
    suspend fun runAccessibilityAudit(tabId: Int): Result<AccessibilityAuditResponse> {
        return client.invoke("extension.runAccessibilityAudit", mapOf("tabId" to tabId))
    }

    // ==================== WebRTC 调试 ====================

    /**
     * 获取 WebRTC 连接
     *
     * @param tabId 标签页 ID
     */
    suspend fun getWebRTCPeerConnections(tabId: Int): Result<WebRTCConnectionsResponse> {
        return client.invoke("extension.getWebRTCPeerConnections", mapOf("tabId" to tabId))
    }

    // ==================== 设备模拟 ====================

    /**
     * 模拟设备（需要 Admin 权限）
     *
     * @param tabId 标签页 ID
     * @param device 设备名称
     */
    suspend fun emulateDevice(tabId: Int, device: String): Result<ExtensionOperationResponse> {
        return client.invoke("extension.emulateDevice", mapOf(
            "tabId" to tabId,
            "device" to device
        ))
    }

    /**
     * 设置视口（需要 Admin 权限）
     *
     * @param tabId 标签页 ID
     * @param width 宽度
     * @param height 高度
     * @param deviceScaleFactor 设备像素比
     */
    suspend fun setViewport(
        tabId: Int,
        width: Int,
        height: Int,
        deviceScaleFactor: Float = 1f
    ): Result<ExtensionOperationResponse> {
        return client.invoke("extension.setViewport", mapOf(
            "tabId" to tabId,
            "width" to width,
            "height" to height,
            "deviceScaleFactor" to deviceScaleFactor
        ))
    }

    // ==================== 通知 ====================

    /**
     * 显示通知
     *
     * @param title 标题
     * @param message 消息内容
     */
    suspend fun showNotification(title: String, message: String): Result<NotificationResponse> {
        return client.invoke("extension.showNotification", mapOf(
            "title" to title,
            "message" to message
        ))
    }

    // ==================== WebSocket 调试 ====================

    /**
     * 启用 WebSocket 调试（需要 Admin 权限）
     */
    suspend fun enableWebSocketDebugging(): Result<ExtensionOperationResponse> {
        return client.invoke("extension.enableWebSocketDebugging", emptyMap())
    }

    /**
     * 禁用 WebSocket 调试（需要 Admin 权限）
     */
    suspend fun disableWebSocketDebugging(): Result<ExtensionOperationResponse> {
        return client.invoke("extension.disableWebSocketDebugging", emptyMap())
    }

    /**
     * 获取 WebSocket 连接列表
     */
    suspend fun getWebSocketConnections(tabId: Int): Result<WebSocketConnectionsResponse> {
        return client.invoke("extension.getWebSocketConnections", mapOf("tabId" to tabId))
    }

    /**
     * 获取 WebSocket 消息
     */
    suspend fun getWebSocketMessages(tabId: Int, connectionId: String): Result<WebSocketMessagesResponse> {
        return client.invoke("extension.getWebSocketMessages", mapOf(
            "tabId" to tabId,
            "connectionId" to connectionId
        ))
    }

    // ==================== Service Worker 管理 ====================

    /**
     * 列出 Service Workers
     */
    suspend fun listServiceWorkers(): Result<ServiceWorkersResponse> {
        return client.invoke("extension.listServiceWorkers", emptyMap())
    }

    /**
     * 获取 Service Worker 信息
     */
    suspend fun getServiceWorkerInfo(registrationId: String): Result<ServiceWorkerInfoResponse> {
        return client.invoke("extension.getServiceWorkerInfo", mapOf("registrationId" to registrationId))
    }

    /**
     * 注销 Service Worker（需要 Admin 权限）
     */
    suspend fun unregisterServiceWorker(registrationId: String): Result<ExtensionOperationResponse> {
        return client.invoke("extension.unregisterServiceWorker", mapOf("registrationId" to registrationId))
    }

    // ==================== Cache Storage ====================

    /**
     * 列出缓存
     */
    suspend fun listCaches(tabId: Int): Result<CacheListResponse> {
        return client.invoke("extension.listCaches", mapOf("tabId" to tabId))
    }

    /**
     * 列出缓存条目
     */
    suspend fun listCacheEntries(tabId: Int, cacheName: String): Result<CacheEntriesResponse> {
        return client.invoke("extension.listCacheEntries", mapOf(
            "tabId" to tabId,
            "cacheName" to cacheName
        ))
    }

    /**
     * 删除缓存（需要 Admin 权限）
     */
    suspend fun deleteCache(tabId: Int, cacheName: String): Result<ExtensionOperationResponse> {
        return client.invoke("extension.deleteCache", mapOf(
            "tabId" to tabId,
            "cacheName" to cacheName
        ))
    }

    // ==================== DOM 变更观察 ====================

    /**
     * 开始观察 DOM 变更
     */
    suspend fun observeMutations(tabId: Int, selector: String? = null): Result<ExtensionOperationResponse> {
        val params = mutableMapOf<String, Any>("tabId" to tabId)
        selector?.let { params["selector"] = it }
        return client.invoke("extension.observeMutations", params)
    }

    /**
     * 停止观察 DOM 变更
     */
    suspend fun stopObservingMutations(tabId: Int): Result<ExtensionOperationResponse> {
        return client.invoke("extension.stopObservingMutations", mapOf("tabId" to tabId))
    }

    /**
     * 获取 DOM 变更记录
     */
    suspend fun getMutations(tabId: Int): Result<MutationsResponse> {
        return client.invoke("extension.getMutations", mapOf("tabId" to tabId))
    }

    // ==================== 控制台捕获 ====================

    /**
     * 启用控制台捕获
     */
    suspend fun enableConsoleCapture(tabId: Int): Result<ExtensionOperationResponse> {
        return client.invoke("extension.enableConsoleCapture", mapOf("tabId" to tabId))
    }

    /**
     * 禁用控制台捕获
     */
    suspend fun disableConsoleCapture(tabId: Int): Result<ExtensionOperationResponse> {
        return client.invoke("extension.disableConsoleCapture", mapOf("tabId" to tabId))
    }

    /**
     * 获取捕获的控制台日志
     */
    suspend fun getCapturedConsoleLogs(tabId: Int): Result<ConsoleLogsResponse> {
        return client.invoke("extension.getCapturedConsoleLogs", mapOf("tabId" to tabId))
    }

    // ==================== IndexedDB ====================

    /**
     * 列出 IndexedDB 数据库
     */
    suspend fun listIndexedDBDatabases(tabId: Int): Result<IndexedDBDatabasesResponse> {
        return client.invoke("extension.listIndexedDBDatabases", mapOf("tabId" to tabId))
    }

    /**
     * 获取 IndexedDB 对象存储
     */
    suspend fun getIndexedDBObjectStores(tabId: Int, databaseName: String): Result<IndexedDBStoresResponse> {
        return client.invoke("extension.getIndexedDBObjectStores", mapOf(
            "tabId" to tabId,
            "databaseName" to databaseName
        ))
    }

    /**
     * 获取 IndexedDB 数据
     */
    suspend fun getIndexedDBStoreData(
        tabId: Int,
        databaseName: String,
        storeName: String,
        limit: Int = 100
    ): Result<IndexedDBDataResponse> {
        return client.invoke("extension.getIndexedDBStoreData", mapOf(
            "tabId" to tabId,
            "databaseName" to databaseName,
            "storeName" to storeName,
            "limit" to limit
        ))
    }

    // ==================== 网络节流 ====================

    /**
     * 设置网络节流（需要 Admin 权限）
     *
     * @param profile 预设配置：slow3g, fast3g, 4g, offline
     */
    suspend fun setNetworkThrottling(profile: String): Result<ExtensionOperationResponse> {
        return client.invoke("extension.setNetworkThrottling", mapOf("profile" to profile))
    }

    /**
     * 清除网络节流（需要 Admin 权限）
     */
    suspend fun clearNetworkThrottling(): Result<ExtensionOperationResponse> {
        return client.invoke("extension.clearNetworkThrottling", emptyMap())
    }

    /**
     * 获取节流配置列表
     */
    suspend fun getThrottlingProfiles(): Result<ThrottlingProfilesResponse> {
        return client.invoke("extension.getThrottlingProfiles", emptyMap())
    }

    /**
     * 设置离线模式（需要 Admin 权限）
     */
    suspend fun setOfflineMode(enabled: Boolean): Result<ExtensionOperationResponse> {
        return client.invoke("extension.setOfflineMode", mapOf("enabled" to enabled))
    }

    // ==================== 触摸模拟 ====================

    /**
     * 启用触摸模拟
     */
    suspend fun enableTouchEmulation(tabId: Int): Result<ExtensionOperationResponse> {
        return client.invoke("extension.enableTouchEmulation", mapOf("tabId" to tabId))
    }

    /**
     * 禁用触摸模拟
     */
    suspend fun disableTouchEmulation(tabId: Int): Result<ExtensionOperationResponse> {
        return client.invoke("extension.disableTouchEmulation", mapOf("tabId" to tabId))
    }

    /**
     * 模拟点击
     */
    suspend fun emulateTap(tabId: Int, x: Int, y: Int): Result<ExtensionOperationResponse> {
        return client.invoke("extension.emulateTap", mapOf(
            "tabId" to tabId,
            "x" to x,
            "y" to y
        ))
    }

    /**
     * 模拟滑动
     */
    suspend fun emulateSwipe(
        tabId: Int,
        startX: Int,
        startY: Int,
        endX: Int,
        endY: Int,
        duration: Int = 300
    ): Result<ExtensionOperationResponse> {
        return client.invoke("extension.emulateSwipe", mapOf(
            "tabId" to tabId,
            "startX" to startX,
            "startY" to startY,
            "endX" to endX,
            "endY" to endY,
            "duration" to duration
        ))
    }

    /**
     * 模拟捏合
     */
    suspend fun emulatePinch(
        tabId: Int,
        x: Int,
        y: Int,
        scale: Float
    ): Result<ExtensionOperationResponse> {
        return client.invoke("extension.emulatePinch", mapOf(
            "tabId" to tabId,
            "x" to x,
            "y" to y,
            "scale" to scale
        ))
    }

    // ==================== 传感器模拟 ====================

    /**
     * 设置设备方向（需要 Admin 权限）
     */
    suspend fun setSensorOrientation(
        alpha: Float,
        beta: Float,
        gamma: Float
    ): Result<ExtensionOperationResponse> {
        return client.invoke("extension.setSensorOrientation", mapOf(
            "alpha" to alpha,
            "beta" to beta,
            "gamma" to gamma
        ))
    }

    /**
     * 设置加速度计（需要 Admin 权限）
     */
    suspend fun setAccelerometer(x: Float, y: Float, z: Float): Result<ExtensionOperationResponse> {
        return client.invoke("extension.setAccelerometer", mapOf(
            "x" to x,
            "y" to y,
            "z" to z
        ))
    }

    /**
     * 设置地理位置（需要 Admin 权限）
     */
    suspend fun setGeolocationOverride(
        latitude: Double,
        longitude: Double,
        accuracy: Double = 100.0
    ): Result<ExtensionOperationResponse> {
        return client.invoke("extension.setGeolocationOverride", mapOf(
            "latitude" to latitude,
            "longitude" to longitude,
            "accuracy" to accuracy
        ))
    }

    /**
     * 清除地理位置覆盖（需要 Admin 权限）
     */
    suspend fun clearGeolocationOverride(): Result<ExtensionOperationResponse> {
        return client.invoke("extension.clearGeolocationOverride", emptyMap())
    }

    // ==================== 媒体模拟 ====================

    /**
     * 模拟颜色方案
     */
    suspend fun emulateColorScheme(scheme: String): Result<ExtensionOperationResponse> {
        return client.invoke("extension.emulateColorScheme", mapOf("scheme" to scheme))
    }

    /**
     * 模拟减少动效
     */
    suspend fun emulateReducedMotion(reduced: Boolean): Result<ExtensionOperationResponse> {
        return client.invoke("extension.emulateReducedMotion", mapOf("reduced" to reduced))
    }

    /**
     * 模拟视觉障碍
     */
    suspend fun emulateVisionDeficiency(type: String): Result<ExtensionOperationResponse> {
        return client.invoke("extension.emulateVisionDeficiency", mapOf("type" to type))
    }

    // ==================== 代码覆盖率 ====================

    /**
     * 启动 JS 覆盖率收集（需要 Admin 权限）
     */
    suspend fun startJSCoverage(tabId: Int): Result<ExtensionOperationResponse> {
        return client.invoke("extension.startJSCoverage", mapOf("tabId" to tabId))
    }

    /**
     * 停止 JS 覆盖率收集（需要 Admin 权限）
     */
    suspend fun stopJSCoverage(tabId: Int): Result<CoverageResultResponse> {
        return client.invoke("extension.stopJSCoverage", mapOf("tabId" to tabId))
    }

    /**
     * 启动 CSS 覆盖率收集（需要 Admin 权限）
     */
    suspend fun startCSSCoverage(tabId: Int): Result<ExtensionOperationResponse> {
        return client.invoke("extension.startCSSCoverage", mapOf("tabId" to tabId))
    }

    /**
     * 停止 CSS 覆盖率收集（需要 Admin 权限）
     */
    suspend fun stopCSSCoverage(tabId: Int): Result<CoverageResultResponse> {
        return client.invoke("extension.stopCSSCoverage", mapOf("tabId" to tabId))
    }

    // ==================== 内存分析 ====================

    /**
     * 获取堆快照（需要 Admin 权限）
     */
    suspend fun takeHeapSnapshot(tabId: Int): Result<HeapSnapshotResponse> {
        return client.invoke("extension.takeHeapSnapshot", mapOf("tabId" to tabId))
    }

    /**
     * 强制垃圾回收（需要 Admin 权限）
     */
    suspend fun forceGarbageCollection(tabId: Int): Result<ExtensionOperationResponse> {
        return client.invoke("extension.forceGarbageCollection", mapOf("tabId" to tabId))
    }

    // ==================== 事件监听 ====================

    /**
     * 获取元素事件监听器
     */
    suspend fun getEventListeners(tabId: Int, selector: String): Result<EventListenersResponse> {
        return client.invoke("extension.getEventListeners", mapOf(
            "tabId" to tabId,
            "selector" to selector
        ))
    }

    /**
     * 监控事件
     */
    suspend fun monitorEvents(tabId: Int, events: List<String>): Result<ExtensionOperationResponse> {
        return client.invoke("extension.monitorEvents", mapOf(
            "tabId" to tabId,
            "events" to events
        ))
    }

    /**
     * 停止监控事件
     */
    suspend fun stopMonitoringEvents(tabId: Int): Result<ExtensionOperationResponse> {
        return client.invoke("extension.stopMonitoringEvents", mapOf("tabId" to tabId))
    }

    // ==================== 输入录制 ====================

    /**
     * 开始输入录制
     */
    suspend fun startInputRecording(tabId: Int): Result<ExtensionOperationResponse> {
        return client.invoke("extension.startInputRecording", mapOf("tabId" to tabId))
    }

    /**
     * 停止输入录制
     */
    suspend fun stopInputRecording(tabId: Int): Result<InputRecordingResponse> {
        return client.invoke("extension.stopInputRecording", mapOf("tabId" to tabId))
    }

    /**
     * 回放输入（需要 Admin 权限）
     */
    suspend fun replayInputs(tabId: Int, recording: String): Result<ExtensionOperationResponse> {
        return client.invoke("extension.replayInputs", mapOf(
            "tabId" to tabId,
            "recording" to recording
        ))
    }

    // ==================== 安全检查 ====================

    /**
     * 获取证书信息
     */
    suspend fun getCertificateInfo(tabId: Int): Result<CertificateInfoResponse> {
        return client.invoke("extension.getCertificateInfo", mapOf("tabId" to tabId))
    }

    /**
     * 获取安全状态
     */
    suspend fun getSecurityState(tabId: Int): Result<SecurityStateResponse> {
        return client.invoke("extension.getSecurityState", mapOf("tabId" to tabId))
    }

    /**
     * 检查混合内容
     */
    suspend fun checkMixedContent(tabId: Int): Result<MixedContentResponse> {
        return client.invoke("extension.checkMixedContent", mapOf("tabId" to tabId))
    }

    // ==================== 标签页分组 ====================

    /**
     * 创建标签页分组
     */
    suspend fun createTabGroup(tabIds: List<Int>, title: String? = null, color: String? = null): Result<TabGroupResponse> {
        val params = mutableMapOf<String, Any>("tabIds" to tabIds)
        title?.let { params["title"] = it }
        color?.let { params["color"] = it }
        return client.invoke("extension.createTabGroup", params)
    }

    /**
     * 获取所有标签页分组
     */
    suspend fun getAllTabGroups(): Result<TabGroupsResponse> {
        return client.invoke("extension.getAllTabGroups", emptyMap())
    }

    /**
     * 取消标签页分组
     */
    suspend fun ungroupTabs(tabIds: List<Int>): Result<ExtensionOperationResponse> {
        return client.invoke("extension.ungroupTabs", mapOf("tabIds" to tabIds))
    }
}

// ==================== 响应数据类 ====================

@Serializable
data class ExtensionStatusResponse(
    val success: Boolean,
    val connected: Boolean,
    val version: String? = null,
    val browser: String? = null
)

@Serializable
data class ExtensionClientsResponse(
    val success: Boolean,
    val clients: List<ExtensionClient>,
    val total: Int
)

@Serializable
data class ExtensionClient(
    val id: String,
    val name: String,
    val version: String,
    val browser: String,
    val connectedAt: Long
)

@Serializable
data class ExtensionTabsResponse(
    val success: Boolean,
    val tabs: List<ExtensionTab>,
    val total: Int
)

@Serializable
data class ExtensionTab(
    val id: Int,
    val url: String,
    val title: String? = null,
    val active: Boolean,
    val windowId: Int,
    val index: Int,
    val favIconUrl: String? = null
)

@Serializable
data class ExtensionTabResponse(
    val success: Boolean,
    val tab: ExtensionTab
)

@Serializable
data class ExtensionOperationResponse(
    val success: Boolean,
    val message: String? = null
)

@Serializable
data class PageContentResponse(
    val success: Boolean,
    val html: String? = null,
    val text: String? = null,
    val title: String? = null,
    val url: String? = null
)

@Serializable
data class ScriptResultResponse(
    val success: Boolean,
    val result: String? = null,
    val error: String? = null
)

@Serializable
data class ExtensionScreenshotResponse(
    val success: Boolean,
    val data: String,  // Base64
    val format: String,
    val width: Int? = null,
    val height: Int? = null
)

@Serializable
data class BookmarksResponse(
    val success: Boolean,
    val bookmarks: List<BookmarkItem>,
    val total: Int
)

@Serializable
data class BookmarkItem(
    val id: String,
    val title: String,
    val url: String? = null,
    val parentId: String? = null,
    val dateAdded: Long? = null,
    val children: List<BookmarkItem>? = null
)

@Serializable
data class BookmarkResponse(
    val success: Boolean,
    val bookmark: BookmarkItem
)

@Serializable
data class HistoryItemsResponse(
    val success: Boolean,
    val items: List<HistoryItem>,
    val total: Int
)

@Serializable
data class HistoryItem(
    val id: String,
    val url: String,
    val title: String? = null,
    val lastVisitTime: Long,
    val visitCount: Int
)

@Serializable
data class ClipboardResponse(
    val success: Boolean,
    val text: String? = null,
    val html: String? = null
)

@Serializable
data class CookiesResponse(
    val success: Boolean,
    val cookies: List<CookieInfo>,
    val total: Int
)

@Serializable
data class CookieInfo(
    val name: String,
    val value: String,
    val domain: String,
    val path: String,
    val secure: Boolean,
    val httpOnly: Boolean,
    val expirationDate: Long? = null
)

@Serializable
data class CookieResponse(
    val success: Boolean,
    val cookie: CookieInfo
)

@Serializable
data class DownloadsResponse(
    val success: Boolean,
    val downloads: List<DownloadItem>,
    val total: Int
)

@Serializable
data class DownloadItem(
    val id: Int,
    val url: String,
    val filename: String,
    val state: String,
    val bytesReceived: Long,
    val totalBytes: Long,
    val startTime: Long
)

@Serializable
data class DownloadResponse(
    val success: Boolean,
    val downloadId: Int
)

@Serializable
data class WindowsResponse(
    val success: Boolean,
    val windows: List<BrowserWindow>,
    val total: Int
)

@Serializable
data class BrowserWindow(
    val id: Int,
    val focused: Boolean,
    val type: String,
    val state: String,
    val width: Int,
    val height: Int,
    val tabs: List<ExtensionTab>? = null
)

@Serializable
data class WindowResponse(
    val success: Boolean,
    val window: BrowserWindow
)

@Serializable
data class StorageResponse(
    val success: Boolean,
    val data: Map<String, String>,
    val total: Int
)

@Serializable
data class WaitForSelectorResponse(
    val success: Boolean,
    val found: Boolean,
    val element: ElementInfo? = null
)

@Serializable
data class ElementInfo(
    val tagName: String,
    val className: String? = null,
    val id: String? = null,
    val innerText: String? = null,
    val boundingRect: BoundingRect? = null
)

@Serializable
data class BoundingRect(
    val x: Float,
    val y: Float,
    val width: Float,
    val height: Float
)

@Serializable
data class NetworkRequestsResponse(
    val success: Boolean,
    val requests: List<NetworkRequest>,
    val total: Int
)

@Serializable
data class NetworkRequest(
    val url: String,
    val method: String,
    val status: Int? = null,
    val type: String,
    val size: Long? = null,
    val time: Long,
    val duration: Long? = null
)

@Serializable
data class PerformanceMetricsResponse(
    val success: Boolean,
    val metrics: PerformanceMetrics
)

@Serializable
data class PerformanceMetrics(
    val domContentLoaded: Long? = null,
    val loadTime: Long? = null,
    val firstPaint: Long? = null,
    val firstContentfulPaint: Long? = null,
    val largestContentfulPaint: Long? = null,
    val timeToInteractive: Long? = null
)

@Serializable
data class AccessibilityTreeResponse(
    val success: Boolean,
    val tree: AccessibilityNode? = null
)

@Serializable
data class AccessibilityNode(
    val role: String,
    val name: String? = null,
    val description: String? = null,
    val children: List<AccessibilityNode>? = null
)

@Serializable
data class AccessibilityAuditResponse(
    val success: Boolean,
    val violations: List<AccessibilityViolation>,
    val passes: Int,
    val incomplete: Int
)

@Serializable
data class AccessibilityViolation(
    val id: String,
    val impact: String,
    val description: String,
    val nodes: Int
)

@Serializable
data class WebRTCConnectionsResponse(
    val success: Boolean,
    val connections: List<WebRTCConnection>,
    val total: Int
)

@Serializable
data class WebRTCConnection(
    val id: String,
    val state: String,
    val localDescription: String? = null,
    val remoteDescription: String? = null
)

// ==================== 高级调试响应数据类 ====================

@Serializable
data class WebSocketConnectionsResponse(
    val success: Boolean,
    val connections: List<WebSocketConnectionInfo>,
    val total: Int
)

@Serializable
data class WebSocketConnectionInfo(
    val id: String,
    val url: String,
    val state: String,
    val protocol: String? = null,
    val messageCount: Int = 0
)

@Serializable
data class WebSocketMessagesResponse(
    val success: Boolean,
    val messages: List<WebSocketMessage>,
    val total: Int
)

@Serializable
data class WebSocketMessage(
    val id: String,
    val type: String,
    val data: String,
    val timestamp: Long,
    val direction: String  // sent/received
)

@Serializable
data class ServiceWorkersResponse(
    val success: Boolean,
    val workers: List<ServiceWorkerInfo>,
    val total: Int
)

@Serializable
data class ServiceWorkerInfo(
    val registrationId: String,
    val scriptUrl: String,
    val scope: String,
    val state: String,
    val runningStatus: String? = null
)

@Serializable
data class ServiceWorkerInfoResponse(
    val success: Boolean,
    val worker: ServiceWorkerInfo
)

@Serializable
data class CacheListResponse(
    val success: Boolean,
    val caches: List<CacheInfo>,
    val total: Int
)

@Serializable
data class CacheInfo(
    val name: String,
    val entryCount: Int? = null,
    val size: Long? = null
)

@Serializable
data class CacheEntriesResponse(
    val success: Boolean,
    val entries: List<CacheEntry>,
    val total: Int
)

@Serializable
data class CacheEntry(
    val url: String,
    val responseType: String? = null,
    val status: Int? = null,
    val contentType: String? = null,
    val size: Long? = null
)

@Serializable
data class MutationsResponse(
    val success: Boolean,
    val mutations: List<DomMutation>,
    val total: Int
)

@Serializable
data class DomMutation(
    val type: String,  // childList, attributes, characterData
    val target: String,
    val addedNodes: Int = 0,
    val removedNodes: Int = 0,
    val attributeName: String? = null,
    val oldValue: String? = null,
    val timestamp: Long
)

@Serializable
data class ConsoleLogsResponse(
    val success: Boolean,
    val logs: List<ConsoleLog>,
    val total: Int
)

@Serializable
data class ConsoleLog(
    val level: String,  // log, warn, error, info, debug
    val message: String,
    val timestamp: Long,
    val source: String? = null,
    val lineNumber: Int? = null
)

@Serializable
data class IndexedDBDatabasesResponse(
    val success: Boolean,
    val databases: List<IndexedDBDatabase>,
    val total: Int
)

@Serializable
data class IndexedDBDatabase(
    val name: String,
    val version: Int,
    val objectStoreCount: Int? = null
)

@Serializable
data class IndexedDBStoresResponse(
    val success: Boolean,
    val stores: List<IndexedDBStore>,
    val total: Int
)

@Serializable
data class IndexedDBStore(
    val name: String,
    val keyPath: String? = null,
    val autoIncrement: Boolean = false,
    val indexes: List<String>? = null
)

@Serializable
data class IndexedDBDataResponse(
    val success: Boolean,
    val data: List<Map<String, String>>,
    val total: Int,
    val hasMore: Boolean = false
)

@Serializable
data class ThrottlingProfilesResponse(
    val success: Boolean,
    val profiles: List<ThrottlingProfile>
)

@Serializable
data class ThrottlingProfile(
    val name: String,
    val downloadKbps: Int,
    val uploadKbps: Int,
    val latencyMs: Int
)

@Serializable
data class CoverageResultResponse(
    val success: Boolean,
    val coverage: List<CoverageEntry>,
    val totalBytes: Long,
    val usedBytes: Long,
    val percentage: Float
)

@Serializable
data class CoverageEntry(
    val url: String,
    val totalBytes: Long,
    val usedBytes: Long,
    val percentage: Float
)

@Serializable
data class HeapSnapshotResponse(
    val success: Boolean,
    val snapshotId: String,
    val totalSize: Long,
    val nodeCount: Int
)

@Serializable
data class EventListenersResponse(
    val success: Boolean,
    val listeners: List<EventListenerInfo>,
    val total: Int
)

@Serializable
data class EventListenerInfo(
    val type: String,
    val useCapture: Boolean,
    val passive: Boolean,
    val once: Boolean,
    val handler: String? = null
)

@Serializable
data class InputRecordingResponse(
    val success: Boolean,
    val recording: String,  // JSON string of recorded inputs
    val eventCount: Int,
    val duration: Long
)

@Serializable
data class CertificateInfoResponse(
    val success: Boolean,
    val certificate: CertificateInfo? = null,
    val error: String? = null
)

@Serializable
data class CertificateInfo(
    val issuer: String,
    val subject: String,
    val validFrom: Long,
    val validTo: Long,
    val fingerprint: String? = null
)

@Serializable
data class SecurityStateResponse(
    val success: Boolean,
    val securityState: String,  // secure, neutral, insecure
    val protocol: String? = null,
    val cipher: String? = null
)

@Serializable
data class MixedContentResponse(
    val success: Boolean,
    val hasMixedContent: Boolean,
    val blockedCount: Int,
    val optionallyBlockedCount: Int,
    val resources: List<MixedContentResource>? = null
)

@Serializable
data class MixedContentResource(
    val url: String,
    val type: String,
    val blocked: Boolean
)

@Serializable
data class TabGroupResponse(
    val success: Boolean,
    val groupId: Int,
    val title: String? = null,
    val color: String? = null
)

@Serializable
data class TabGroupsResponse(
    val success: Boolean,
    val groups: List<TabGroup>,
    val total: Int
)

@Serializable
data class TabGroup(
    val id: Int,
    val title: String? = null,
    val color: String? = null,
    val collapsed: Boolean = false,
    val tabIds: List<Int>
)
