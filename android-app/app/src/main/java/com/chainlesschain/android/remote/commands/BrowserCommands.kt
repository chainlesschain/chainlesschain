package com.chainlesschain.android.remote.commands

import com.chainlesschain.android.remote.client.RemoteCommandClient
import kotlinx.serialization.Serializable
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 浏览器自动化命令 API
 *
 * 提供类型安全的浏览器自动化相关命令
 */
@Singleton
class BrowserCommands @Inject constructor(
    private val client: RemoteCommandClient
) {
    /**
     * 启动浏览器
     *
     * @param headless 是否无头模式
     * @param channel 浏览器通道（chrome/msedge 等）
     */
    suspend fun start(
        headless: Boolean = false,
        channel: String? = null
    ): Result<BrowserStartResponse> {
        val params = mutableMapOf<String, Any>(
            "headless" to headless
        )
        channel?.let { params["channel"] = it }

        return client.invoke("browser.start", params)
    }

    /**
     * 关闭浏览器
     */
    suspend fun stop(): Result<BrowserStopResponse> {
        return client.invoke("browser.stop", emptyMap())
    }

    /**
     * 打开 URL（简化接口）
     *
     * 自动启动浏览器、创建上下文、打开标签页并导航到指定 URL
     *
     * @param url 目标 URL
     * @param profile Profile 名称
     * @param headless 是否无头模式
     */
    suspend fun openUrl(
        url: String,
        profile: String? = null,
        headless: Boolean? = null
    ): Result<OpenUrlResponse> {
        val params = mutableMapOf<String, Any>("url" to url)
        profile?.let { params["profile"] = it }
        headless?.let { params["headless"] = it }

        return client.invoke("browser.openUrl", params)
    }

    /**
     * 导航到 URL
     *
     * @param targetId 标签页 ID
     * @param url 目标 URL
     * @param waitUntil 等待条件（load/domcontentloaded/networkidle）
     * @param timeout 超时时间（毫秒）
     */
    suspend fun navigate(
        targetId: String,
        url: String,
        waitUntil: String? = null,
        timeout: Int? = null
    ): Result<NavigateResponse> {
        val params = mutableMapOf<String, Any>(
            "targetId" to targetId,
            "url" to url
        )
        waitUntil?.let { params["waitUntil"] = it }
        timeout?.let { params["timeout"] = it }

        return client.invoke("browser.navigate", params)
    }

    /**
     * 截图
     *
     * @param targetId 标签页 ID
     * @param fullPage 是否全页截图
     * @param format 格式（png/jpeg）
     * @param quality JPEG 质量（1-100）
     */
    suspend fun screenshot(
        targetId: String,
        fullPage: Boolean = false,
        format: String = "png",
        quality: Int? = null
    ): Result<ScreenshotResponse> {
        val params = mutableMapOf<String, Any>(
            "targetId" to targetId,
            "fullPage" to fullPage,
            "format" to format
        )
        quality?.let { params["quality"] = it }

        return client.invoke("browser.screenshot", params)
    }

    /**
     * 执行操作（点击、输入等）
     *
     * @param targetId 标签页 ID
     * @param action 操作类型（click/type/select/drag/hover）
     * @param ref 元素引用
     * @param options 操作选项
     */
    suspend fun act(
        targetId: String,
        action: String,
        ref: String,
        options: Map<String, Any>? = null
    ): Result<ActResponse> {
        val params = mutableMapOf<String, Any>(
            "targetId" to targetId,
            "action" to action,
            "ref" to ref
        )
        options?.let { params["options"] = it }

        return client.invoke("browser.act", params)
    }

    /**
     * 获取浏览器状态
     */
    suspend fun getStatus(): Result<BrowserStatusResponse> {
        return client.invoke("browser.getStatus", emptyMap())
    }

    /**
     * 列出所有标签页
     *
     * @param profileName Profile 名称过滤
     */
    suspend fun listTabs(
        profileName: String? = null
    ): Result<ListTabsResponse> {
        val params = mutableMapOf<String, Any>()
        profileName?.let { params["profileName"] = it }

        return client.invoke("browser.listTabs", params)
    }

    /**
     * 关闭标签页
     *
     * @param targetId 标签页 ID
     */
    suspend fun closeTab(targetId: String): Result<CloseTabResponse> {
        val params = mapOf("targetId" to targetId)
        return client.invoke("browser.closeTab", params)
    }

    /**
     * 聚焦标签页
     *
     * @param targetId 标签页 ID
     */
    suspend fun focusTab(targetId: String): Result<FocusTabResponse> {
        val params = mapOf("targetId" to targetId)
        return client.invoke("browser.focusTab", params)
    }

    /**
     * 获取页面快照
     *
     * @param targetId 标签页 ID
     * @param interactive 是否只获取可交互元素
     * @param visible 是否只获取可见元素
     * @param roleRefs 是否包含角色引用
     */
    suspend fun takeSnapshot(
        targetId: String,
        interactive: Boolean = true,
        visible: Boolean = true,
        roleRefs: Boolean = true
    ): Result<SnapshotResponse> {
        val params = mapOf(
            "targetId" to targetId,
            "interactive" to interactive,
            "visible" to visible,
            "roleRefs" to roleRefs
        )
        return client.invoke("browser.takeSnapshot", params)
    }

    /**
     * 查找元素
     *
     * @param targetId 标签页 ID
     * @param ref 元素引用（CSS选择器、XPath等）
     */
    suspend fun findElement(
        targetId: String,
        ref: String
    ): Result<FindElementResponse> {
        val params = mapOf(
            "targetId" to targetId,
            "ref" to ref
        )
        return client.invoke("browser.findElement", params)
    }

    // ==================== Profile/Context 管理 ====================

    /**
     * 创建浏览器上下文（Profile）
     *
     * @param profileName Profile 名称
     * @param persistent 是否持久化
     */
    suspend fun createContext(
        profileName: String,
        persistent: Boolean = false
    ): Result<ContextResponse> {
        return client.invoke("browser.createContext", mapOf(
            "profileName" to profileName,
            "persistent" to persistent
        ))
    }

    /**
     * 关闭浏览器上下文
     *
     * @param profileName Profile 名称
     */
    suspend fun closeContext(profileName: String): Result<ContextResponse> {
        return client.invoke("browser.closeContext", mapOf("profileName" to profileName))
    }

    /**
     * 列出所有上下文
     */
    suspend fun listContexts(): Result<ContextsListResponse> {
        return client.invoke("browser.listContexts", emptyMap())
    }

    // ==================== 等待操作 ====================

    /**
     * 等待导航完成
     *
     * @param targetId 标签页 ID
     * @param timeout 超时时间（毫秒）
     * @param waitUntil 等待条件
     */
    suspend fun waitForNavigation(
        targetId: String,
        timeout: Int = 30000,
        waitUntil: String = "load"
    ): Result<WaitResponse> {
        return client.invoke("browser.waitForNavigation", mapOf(
            "targetId" to targetId,
            "timeout" to timeout,
            "waitUntil" to waitUntil
        ))
    }

    /**
     * 等待选择器出现
     *
     * @param targetId 标签页 ID
     * @param selector CSS 选择器
     * @param timeout 超时时间（毫秒）
     * @param visible 是否等待可见
     */
    suspend fun waitForSelector(
        targetId: String,
        selector: String,
        timeout: Int = 30000,
        visible: Boolean = true
    ): Result<WaitResponse> {
        return client.invoke("browser.waitForSelector", mapOf(
            "targetId" to targetId,
            "selector" to selector,
            "timeout" to timeout,
            "visible" to visible
        ))
    }

    /**
     * 等待指定时间
     *
     * @param targetId 标签页 ID
     * @param milliseconds 毫秒数
     */
    suspend fun waitForTimeout(
        targetId: String,
        milliseconds: Int
    ): Result<WaitResponse> {
        return client.invoke("browser.waitForTimeout", mapOf(
            "targetId" to targetId,
            "milliseconds" to milliseconds
        ))
    }

    // ==================== 表单操作 ====================

    /**
     * 填充表单
     *
     * @param targetId 标签页 ID
     * @param formData 表单数据（选择器 -> 值）
     */
    suspend fun fillForm(
        targetId: String,
        formData: Map<String, String>
    ): Result<FormFillResponse> {
        return client.invoke("browser.fillForm", mapOf(
            "targetId" to targetId,
            "formData" to formData
        ))
    }

    /**
     * 提交表单
     *
     * @param targetId 标签页 ID
     * @param formSelector 表单选择器
     */
    suspend fun submitForm(
        targetId: String,
        formSelector: String
    ): Result<FormSubmitResponse> {
        return client.invoke("browser.submitForm", mapOf(
            "targetId" to targetId,
            "formSelector" to formSelector
        ))
    }

    /**
     * 选择下拉选项
     *
     * @param targetId 标签页 ID
     * @param selector 下拉框选择器
     * @param value 选项值
     */
    suspend fun selectOption(
        targetId: String,
        selector: String,
        value: String
    ): Result<SelectOptionResponse> {
        return client.invoke("browser.selectOption", mapOf(
            "targetId" to targetId,
            "selector" to selector,
            "value" to value
        ))
    }

    /**
     * 设置复选框状态
     *
     * @param targetId 标签页 ID
     * @param selector 复选框选择器
     * @param checked 是否勾选
     */
    suspend fun setCheckbox(
        targetId: String,
        selector: String,
        checked: Boolean
    ): Result<CheckboxResponse> {
        return client.invoke("browser.setCheckbox", mapOf(
            "targetId" to targetId,
            "selector" to selector,
            "checked" to checked
        ))
    }

    // ==================== 高级操作 ====================

    /**
     * 执行 JavaScript
     *
     * @param targetId 标签页 ID
     * @param script JavaScript 代码
     */
    suspend fun evaluate(
        targetId: String,
        script: String
    ): Result<EvaluateResponse> {
        return client.invoke("browser.evaluate", mapOf(
            "targetId" to targetId,
            "script" to script
        ))
    }

    /**
     * 生成 PDF（需要 Admin 权限）
     *
     * @param targetId 标签页 ID
     * @param format 页面格式（A4, Letter 等）
     * @param landscape 是否横向
     */
    suspend fun generatePdf(
        targetId: String,
        format: String = "A4",
        landscape: Boolean = false
    ): Result<PdfResponse> {
        return client.invoke("browser.generatePdf", mapOf(
            "targetId" to targetId,
            "format" to format,
            "landscape" to landscape
        ))
    }

    /**
     * 提取页面数据
     *
     * @param targetId 标签页 ID
     * @param selectors 选择器映射（字段名 -> 选择器）
     */
    suspend fun extractData(
        targetId: String,
        selectors: Map<String, String>
    ): Result<ExtractDataResponse> {
        return client.invoke("browser.extractData", mapOf(
            "targetId" to targetId,
            "selectors" to selectors
        ))
    }

    /**
     * 获取页面 HTML
     *
     * @param targetId 标签页 ID
     * @param selector 可选，只获取指定元素的 HTML
     */
    suspend fun getHtml(
        targetId: String,
        selector: String? = null
    ): Result<HtmlResponse> {
        val params = mutableMapOf<String, Any>("targetId" to targetId)
        selector?.let { params["selector"] = it }
        return client.invoke("browser.getHtml", params)
    }

    /**
     * 获取页面文本
     *
     * @param targetId 标签页 ID
     * @param selector 可选，只获取指定元素的文本
     */
    suspend fun getText(
        targetId: String,
        selector: String? = null
    ): Result<TextResponse> {
        val params = mutableMapOf<String, Any>("targetId" to targetId)
        selector?.let { params["selector"] = it }
        return client.invoke("browser.getText", params)
    }

    // ==================== Cookie 管理 ====================

    /**
     * 获取页面 Cookie
     *
     * @param targetId 标签页 ID
     */
    suspend fun getCookies(targetId: String): Result<BrowserCookiesResponse> {
        return client.invoke("browser.getCookies", mapOf("targetId" to targetId))
    }

    /**
     * 设置 Cookie
     *
     * @param targetId 标签页 ID
     * @param name Cookie 名称
     * @param value Cookie 值
     * @param domain 域名
     */
    suspend fun setCookie(
        targetId: String,
        name: String,
        value: String,
        domain: String? = null
    ): Result<SetCookieResponse> {
        val params = mutableMapOf<String, Any>(
            "targetId" to targetId,
            "name" to name,
            "value" to value
        )
        domain?.let { params["domain"] = it }
        return client.invoke("browser.setCookie", params)
    }

    /**
     * 清除 Cookie
     *
     * @param targetId 标签页 ID
     */
    suspend fun clearCookies(targetId: String): Result<ClearCookiesResponse> {
        return client.invoke("browser.clearCookies", mapOf("targetId" to targetId))
    }

    // ==================== 网络拦截 ====================

    /**
     * 启用请求拦截
     *
     * @param targetId 标签页 ID
     * @param patterns URL 模式列表
     */
    suspend fun enableRequestInterception(
        targetId: String,
        patterns: List<String>? = null
    ): Result<InterceptionResponse> {
        val params = mutableMapOf<String, Any>("targetId" to targetId)
        patterns?.let { params["patterns"] = it }
        return client.invoke("browser.enableRequestInterception", params)
    }

    /**
     * 禁用请求拦截
     *
     * @param targetId 标签页 ID
     */
    suspend fun disableRequestInterception(targetId: String): Result<InterceptionResponse> {
        return client.invoke("browser.disableRequestInterception", mapOf("targetId" to targetId))
    }

    /**
     * 获取拦截的请求
     *
     * @param targetId 标签页 ID
     * @param limit 数量限制
     */
    suspend fun getInterceptedRequests(
        targetId: String,
        limit: Int = 100
    ): Result<InterceptedRequestsResponse> {
        return client.invoke("browser.getInterceptedRequests", mapOf(
            "targetId" to targetId,
            "limit" to limit
        ))
    }

    // ==================== 便捷方法 ====================

    /**
     * 点击元素
     */
    suspend fun click(targetId: String, selector: String): Result<ActResponse> {
        return act(targetId, "click", selector)
    }

    /**
     * 输入文本
     */
    suspend fun type(targetId: String, selector: String, text: String): Result<ActResponse> {
        return act(targetId, "type", selector, mapOf("text" to text))
    }

    /**
     * 悬停元素
     */
    suspend fun hover(targetId: String, selector: String): Result<ActResponse> {
        return act(targetId, "hover", selector)
    }

    /**
     * 双击元素
     */
    suspend fun doubleClick(targetId: String, selector: String): Result<ActResponse> {
        return act(targetId, "doubleClick", selector)
    }

    /**
     * 右键点击
     */
    suspend fun rightClick(targetId: String, selector: String): Result<ActResponse> {
        return act(targetId, "rightClick", selector)
    }

    /**
     * 滚动到元素
     */
    suspend fun scrollToElement(targetId: String, selector: String): Result<ActResponse> {
        return act(targetId, "scrollIntoView", selector)
    }

    /**
     * 清除输入框
     */
    suspend fun clearInput(targetId: String, selector: String): Result<ActResponse> {
        return act(targetId, "clear", selector)
    }
}

// 响应数据类

@Serializable
data class BrowserStartResponse(
    val success: Boolean,
    val message: String,
    val isRunning: Boolean? = null
)

@Serializable
data class BrowserStopResponse(
    val success: Boolean,
    val message: String
)

@Serializable
data class OpenUrlResponse(
    val success: Boolean,
    val url: String,
    val title: String? = null,
    val targetId: String,
    val profileName: String
)

@Serializable
data class NavigateResponse(
    val success: Boolean,
    val url: String? = null,
    val title: String? = null,
    val targetId: String? = null
)

@Serializable
data class ScreenshotResponse(
    val success: Boolean,
    val targetId: String,
    val format: String,
    val size: Int,
    val data: String  // Base64 编码的图片数据
)

@Serializable
data class ActResponse(
    val success: Boolean,
    val action: String? = null,
    val element: String? = null,
    val message: String? = null
)

@Serializable
data class BrowserStatusResponse(
    val success: Boolean,
    val isRunning: Boolean,
    val message: String? = null,
    val contextsCount: Int? = null,
    val tabsCount: Int? = null
)

@Serializable
data class ListTabsResponse(
    val success: Boolean,
    val tabs: List<TabInfo>,
    val total: Int,
    val message: String? = null
)

@Serializable
data class TabInfo(
    val targetId: String,
    val url: String,
    val title: String? = null,
    val type: String? = null,
    val profileName: String? = null
)

@Serializable
data class CloseTabResponse(
    val success: Boolean,
    val targetId: String? = null,
    val message: String? = null
)

@Serializable
data class FocusTabResponse(
    val success: Boolean,
    val targetId: String? = null,
    val message: String? = null
)

@Serializable
data class SnapshotResponse(
    val success: Boolean,
    val targetId: String,
    val html: String? = null,
    val elements: List<SnapshotElement>? = null,
    val timestamp: Long? = null
)

@Serializable
data class SnapshotElement(
    val ref: String,
    val tag: String,
    val role: String? = null,
    val text: String? = null,
    val attributes: Map<String, String>? = null,
    val bounds: ElementBounds? = null
)

@Serializable
data class ElementBounds(
    val x: Float,
    val y: Float,
    val width: Float,
    val height: Float
)

@Serializable
data class FindElementResponse(
    val success: Boolean,
    val element: FoundElement? = null,
    val message: String? = null
)

@Serializable
data class FoundElement(
    val ref: String,
    val tag: String,
    val role: String? = null,
    val text: String? = null,
    val visible: Boolean? = null,
    val bounds: ElementBounds? = null
)

// ==================== Profile/Context 响应 ====================

@Serializable
data class ContextResponse(
    val success: Boolean,
    val profileName: String,
    val message: String? = null
)

@Serializable
data class ContextsListResponse(
    val success: Boolean,
    val contexts: List<ContextInfo>,
    val total: Int
)

@Serializable
data class ContextInfo(
    val profileName: String,
    val persistent: Boolean,
    val tabCount: Int,
    val createdAt: Long? = null
)

// ==================== 等待操作响应 ====================

@Serializable
data class WaitResponse(
    val success: Boolean,
    val elapsed: Long? = null,
    val message: String? = null
)

// ==================== 表单操作响应 ====================

@Serializable
data class FormFillResponse(
    val success: Boolean,
    val filledFields: Int,
    val failedFields: List<String>? = null,
    val message: String? = null
)

@Serializable
data class FormSubmitResponse(
    val success: Boolean,
    val message: String? = null
)

@Serializable
data class SelectOptionResponse(
    val success: Boolean,
    val selectedValue: String? = null,
    val selectedText: String? = null,
    val message: String? = null
)

@Serializable
data class CheckboxResponse(
    val success: Boolean,
    val checked: Boolean,
    val message: String? = null
)

// ==================== 高级操作响应 ====================

@Serializable
data class EvaluateResponse(
    val success: Boolean,
    val result: String? = null,
    val type: String? = null,
    val error: String? = null
)

@Serializable
data class PdfResponse(
    val success: Boolean,
    val data: String,  // Base64 编码的 PDF
    val size: Int,
    val pages: Int? = null
)

@Serializable
data class ExtractDataResponse(
    val success: Boolean,
    val data: Map<String, String?>,
    val extractedCount: Int
)

@Serializable
data class HtmlResponse(
    val success: Boolean,
    val html: String,
    val length: Int
)

@Serializable
data class TextResponse(
    val success: Boolean,
    val text: String,
    val length: Int
)

// ==================== Cookie 响应 ====================

@Serializable
data class BrowserCookiesResponse(
    val success: Boolean,
    val cookies: List<BrowserCookie>,
    val total: Int
)

@Serializable
data class BrowserCookie(
    val name: String,
    val value: String,
    val domain: String,
    val path: String,
    val expires: Long? = null,
    val secure: Boolean = false,
    val httpOnly: Boolean = false,
    val sameSite: String? = null
)

@Serializable
data class SetCookieResponse(
    val success: Boolean,
    val message: String? = null
)

@Serializable
data class ClearCookiesResponse(
    val success: Boolean,
    val clearedCount: Int,
    val message: String? = null
)

// ==================== 网络拦截响应 ====================

@Serializable
data class InterceptionResponse(
    val success: Boolean,
    val enabled: Boolean,
    val message: String? = null
)

@Serializable
data class InterceptedRequestsResponse(
    val success: Boolean,
    val requests: List<InterceptedRequest>,
    val total: Int
)

@Serializable
data class InterceptedRequest(
    val id: String,
    val url: String,
    val method: String,
    val resourceType: String,
    val headers: Map<String, String>? = null,
    val postData: String? = null,
    val timestamp: Long
)
